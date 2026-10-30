import { openPluginKeys } from './plugin-keys.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openPluginAchievements } from './plugin-achievements.mjs';
import { openPluginItems } from './plugin-items.mjs';
import { GAME_ITEMS, GAME_TOOLBELT, GAME_WORN_TASKS, COINS, COIN_BILLIONS, ITEM_REVIEW_LIMIT, matchGameItems } from './integrations/game-items.mjs';
import { fields, validatePluginReport, pluginProposal, matchPluginAchievements, ACHIEVEMENT_REVIEW_LIMIT } from './integrations/game-plugin.mjs';
import { pluginTaskRows, pluginTaskList, pluginTaskFrom, pluginDoneRows, pluginDoneList, pluginDoneLocations, PLUGIN_DONE_AGE_MS, pluginRollSummary } from './game-plugin-tasks.mjs';
import { createPluginProgressSource } from './integrations/progress-sources.mjs';
import { createGameCoordinates } from './core/game-coords.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const LIFETIME = 10 * 60 * 1000;
// Status also describes the block of map squares centred on the player (2 each way: 5x5).
const NEARBY_RADIUS = 2;
const COMPLETED_SNAPSHOT_LIMIT = 8;
const HANDLED_RETRY_INTERVAL = 60 * 1000;
const COIN_WRITE_INTERVAL = 60 * 1000;
const positionGameId = latest => latest ? String(latest.position.x * 256 + latest.position.z) : null;
function selectItems(preview, selections) {
  if (!Array.isArray(selections) || selections.length > preview.items.length) throw fail(400, 'Choose item tasks from this review.');
  const tasks = new Set();
  return selections.map(selection => {
    fields(selection, ['taskId'], 'item selection');
    const row = preview.items.find(row => row.taskId === selection.taskId);
    if (!row || tasks.has(row.taskId)) throw fail(400, 'Choose each reviewed item task once.');
    tasks.add(row.taskId);
    return itemCommand(row);
  });
}
const itemCommand = row => ({ taskId: row.taskId, title: row.gameName, gameItemId: row.gameItemId, evidence: row.evidence, seen: row.seen });
const PLUGIN_ROUTES = new Map([['/api/plugin/v1/report', 'POST'], ['/api/plugin/v1/status', 'GET'], ['/api/plugin/v1/tasks', 'GET']]);

/** Positions, assemblies and proposals are ephemeral. Ticks use store.command. */
export async function openGamePlugin({ dataDir, store, world, registry, questMapping, bodyJSON, json,
  serializeMutation, checkRequestOrigin, unauthenticated = () => {}, notify = () => {}, clock = Date.now, savedTasks = () => null, peekPrediction = () => null, taskCatalogue = () => [], itemsBetaAsLive = false, log = console.warn, indexKey, removeKey, authorizeKey }) {
  const progressSource = createPluginProgressSource({ clock });
  const coordinates = createGameCoordinates(world);
  const gameId = id => coordinates.pickerChunkToGameId(id);
  const keys = await openPluginKeys({ dataDir, clock });
  const handled = await openPluginAchievements({ dataDir, members: () => state().members, clock, log });
  const itemStore = await openPluginItems({ dataDir, members: () => state().members, clock, log });
  // Beta and unknown-world item evidence stays in memory, apart from live evidence.
  const itemMemory = new Map(), itemAcks = new Map(), itemHandled = new Map();
  // One unfinished bank set per player, the last complete one, and coin counts by container.
  const bankAssemblies = new Map(), bankAcks = new Map(), itemCoins = new Map();
  let itemTasks;
  const positions = new Map(), pending = new Map(), sequences = new Map(), buckets = new Map(), diagnostics = new Map();
  const assemblies = new Map(), completedSnapshots = new Map(), achievementSummaries = new Map();
  const pendingHandled = new Map();
  let handledFlush, handledRetryAt = 0, handledFailure = false, closePromise;
  let statusRevision = -1; const statuses = new Map(); let closed = false, warming = false;
  // Last saved task list per plugin player. The bytes are the server's own saved
  // play result, so a fresh list costs no extra memory; after a tick clears the
  // saved results, this reference keeps the list readable until the next load.
  const retainedTasks = new Map(), taskRows = new Map();
  function state() { return store.getCalculationSnapshot().state; }
  function member(player) {
    const owner = state().members.find(owner => owner.id === player);
    if (!owner) throw fail(403, 'This player is no longer available.'); return owner;
  }
  function rate(id) {
    const at = clock(); let entry = buckets.get(id);
    if (!entry || at >= entry.until) { entry = { until: at + 1000, count: 0 }; buckets.set(id, entry); }
    if (++entry.count > 4) throw Object.assign(fail(429, 'The game plugin can make four requests per second per key.'), { retryAfter: 1 });
  }
  function authorize(identity, player) {
    if (!identity || identity.readOnly || !identity.admin && (!identity.memberId || identity.memberId !== player)) throw fail(403, 'Choose your own player for the game plugin.');
    member(player);
  }
  function liveReview(player) {
    // One bounded proposal per player waits for explicit review. The plugin
    // sends progress only when it changes, so position expiry must not lose it.
    return pending.get(player) ?? null;
  }
  function achievementStatus(player) {
    const assembly = assemblies.get(player);
    return assembly ? { snapshot: assembly.snapshot, received: assembly.received, parts: assembly.parts } : null;
  }
  function isHandled(player, id) { return handled.has(player, id) || pendingHandled.get(player)?.has(id); }
  function flushHandled(force = false) {
    if (handledFlush) return handledFlush;
    if (!pendingHandled.size || !force && (closed || clock() < handledRetryAt)) return Promise.resolve();
    handledFlush = (async () => {
      try {
        for (const [player, waiting] of pendingHandled) {
          // New reports may add IDs while this write is in flight. Remove only
          // the attempted IDs; the remaining ones need their own durable write.
          while (waiting.size) {
            const ids = [...waiting];
            await handled.add(player, ids);
            for (const id of ids) waiting.delete(id);
          }
          pendingHandled.delete(player);
        }
        handledRetryAt = 0; handledFailure = false;
      } catch {
        handledRetryAt = clock() + HANDLED_RETRY_INTERVAL;
        if (!handledFailure) log('Could not save handled plugin achievement IDs; keeping them in memory and retrying in the background.');
        handledFailure = true;
      }
    })().finally(() => { handledFlush = undefined; });
    return handledFlush;
  }
  function rememberHandled(player, ids) {
    const waiting = pendingHandled.get(player) ?? new Set();
    for (const id of ids) waiting.add(id);
    if (!waiting.size) return;
    // Pending IDs count as handled even if the sidecar stays unavailable. A late
    // successful command after close must not reject because storage is closed.
    pendingHandled.set(player, waiting);
    void flushHandled();
  }
  function achievementReview(player, report, rows) {
    const prior = liveReview(player)?.report;
    // Keep other progress waiting for review. Every completed set replaces only
    // its own achievement section and invalidates the old review token.
    if (!rows.length && prior?.skills === undefined && prior?.quests === undefined && !prior?.itemReview?.length) { pending.delete(player); return; }
    const hasProgress = prior?.skills !== undefined || prior?.quests !== undefined;
    pending.set(player, { report: { ...prior, sentAt: report.sentAt, world: hasProgress ? prior.world : report.world,
      achievementReview: rows.slice(0, ACHIEVEMENT_REVIEW_LIMIT), achievementsMore: Math.max(0, rows.length - ACHIEVEMENT_REVIEW_LIMIT) }, proposal: null });
  }
  async function receiveAchievements(player, report) {
    const part = report.achievements;
    let assembly = assemblies.get(player);
    const cachedWorld = completedSnapshots.get(player)?.get(part.snapshot);
    if (cachedWorld && (cachedWorld === 'live' || report.world?.beta !== false)) {
      // The plugin resumes from status only when it describes its own snapshot.
      assemblies.set(player, { snapshot: part.snapshot, received: part.parts, parts: part.parts,
        live: cachedWorld === 'live', beta: cachedWorld === 'beta' });
      return;
    }
    if (assembly?.snapshot === part.snapshot && assembly.parts === part.parts && part.part <= assembly.received) return;
    if (part.part === 1) {
      assembly = { snapshot: part.snapshot, received: 0, parts: part.parts, complete: [], live: true, beta: false };
      assemblies.set(player, assembly);
    }
    if (!assembly || assembly.snapshot !== part.snapshot || assembly.parts !== part.parts || part.part !== assembly.received + 1) return;
    assembly.complete.push(...part.complete); assembly.received++;
    assembly.live &&= report.world?.beta === false;
    if (report.world?.beta === true) assembly.betaWorld = report.world;
    assembly.beta ||= report.world?.beta === true;
    if (assembly.received !== assembly.parts) return;
    const matches = matchPluginAchievements(state(), player, assembly.complete);
    // Release rows after matching. Durable handled IDs make evicting old
    // snapshots safe: this small cache only acknowledges recent replays quickly.
    assembly.complete = [];
    const previous = achievementSummaries.get(player);
    const summary = { completeCount: matches.completeCount, matchedTaskCount: matches.matchedTaskCount, unmatchedCount: matches.unmatchedCount,
      lastTickedCount: previous?.lastTickedCount ?? 0, lastTickedAt: previous?.lastTickedAt ?? null };
    const world = assembly.live ? 'live' : assembly.beta ? 'beta' : 'unknown';
    const candidates = matches.candidates.filter(row => !isHandled(player, row.achievementId));
    const review = matches.unclear.filter(row => !isHandled(player, row.achievementId));
    let appliedIds = [];
    if (assembly.live && candidates.length) {
      const achievements = [...new Map(candidates.map(row => [row.candidates[0].taskId,
        { taskId: row.candidates[0].taskId, title: row.title, achievementId: row.achievementId }])).values()];
      try {
        // Already inside the server's mutation queue. This is the same checked
        // command path as review Apply, one History/Undo entry for the batch.
        await store.command({ type: 'apply-game-progress', memberId: player, fetchedAt: report.sentAt, skills: [], quests: [], achievements }, store.getInfo().revision);
        appliedIds = candidates.map(row => row.achievementId);
        summary.lastTickedCount = achievements.length; summary.lastTickedAt = new Date(clock()).toISOString();
      } catch {
        // A failed write must not reject the report or lose the candidates.
        review.push(...candidates.map(row => ({ ...row, reason: 'retry' })));
      }
    } else review.push(...candidates.map(row => ({ ...row, reason: assembly.beta ? 'beta' : 'world-unknown' })));
    const seen = completedSnapshots.get(player) ?? new Map(); seen.set(part.snapshot, world);
    while (seen.size > COMPLETED_SNAPSHOT_LIMIT) seen.delete(seen.keys().next().value);
    completedSnapshots.set(player, seen);
    achievementSummaries.set(player, summary);
    achievementReview(player, { ...report, world: assembly.live ? report.world : assembly.betaWorld }, review.map(row => ({ ...row, world })));
    if (appliedIds.length) rememberHandled(player, appliedIds);
  }
  function itemTask(id) {
    // Only goal and Wear rows named by the reviewed table can ever be proposed.
    if (!itemTasks) {
      const goals = new Set([...GAME_ITEMS.values()].map(item => item.goalId));
      itemTasks = new Map([...taskCatalogue()].filter(row => row && (goals.has(row.id) || GAME_WORN_TASKS.has(row.id))).map(row => [row.id, { id: row.id, label: row.label }]));
    }
    return state().tasks.find(task => task.id === id) ?? itemTasks.get(id) ?? null;
  }
  function itemReview(player, report, result) {
    const prior = liveReview(player)?.report;
    if (!result.rows.length && prior?.skills === undefined && prior?.quests === undefined && !prior?.achievementReview?.length) { pending.delete(player); return; }
    const hasProgress = prior?.skills !== undefined || prior?.quests !== undefined;
    pending.set(player, { report: { ...prior, sentAt: report.sentAt, world: hasProgress ? prior.world : report.world, itemReview: result.rows,
      itemsMore: result.more, unmappedItems: result.unmapped, unmappedItemsMore: result.unmappedMore }, proposal: null });
  }
  // itemsBetaAsLive is for a synthetic scratch save only: beta items then tick it as live ones would.
  const itemWorld = report => report.world?.beta === false || itemsBetaAsLive && report.world?.beta === true ? 'live' : report.world?.beta === true ? 'beta' : 'unknown';
  function itemRecord(player, world) {
    const memory = itemMemory.get(player);
    return world === 'live' ? itemStore.get(player) : memory?.world === world ? structuredClone(memory.record) : null;
  }
  // Live records are saved; beta and unknown ones stay in memory. False when the write failed.
  async function keepItemRecord(player, world, record) {
    if (world !== 'live') { itemMemory.set(player, { world, record }); return true; }
    try { await itemStore.put(player, record); return true; }
    catch { log('Could not save plugin item evidence; the plugin will send it again.'); return false; }
  }
  // Evidence entries are [id, name or null, worn]. Only reviewed IDs are kept; named others are returned.
  function addEvidence(record, entries, now, fresh) {
    let changed = false;
    const unmapped = new Map();
    for (const [id, name, worn] of entries) {
      const item = GAME_ITEMS.get(id);
      if (!item) { if (name && !unmapped.has(id)) unmapped.set(id, name); continue; }
      const key = String(id);
      if (!record.items[key]) { record.items[key] = { name: name ?? item.name, ownedAt: now, wornAt: null, first: fresh }; changed = true; }
      if (worn && !item.noted && !record.items[key].wornAt) { record.items[key].wornAt = now; changed = true; }
    }
    return { changed, unmapped: [...unmapped].map(([gameItemId, name]) => ({ gameItemId, name })) };
  }
  async function matchItems(player, report, record, world, unmapped) {
    const owner = member(player), dismissed = itemHandled.get(player);
    const evidence = new Map(Object.entries(record.items).map(([id, fact]) => [Number(id), fact]));
    const result = matchGameItems({ evidence, task: itemTask, completed: new Set(owner.completedTasks), world, autoTick: world === 'live',
      handled: id => record.handled.includes(id) || !!dismissed?.has(id), unmapped: unmapped ?? [] });
    // null keeps the unmapped list from the last items report.
    if (unmapped === null) { const prior = liveReview(player)?.report; result.unmapped = prior?.unmappedItems ?? []; result.unmappedMore = prior?.unmappedItemsMore ?? 0; }
    if (result.ticks.length) {
      try {
        // Live owned items tick their BiS goals. Already inside the server's mutation queue: the
        // same checked command as review Apply, one History/Undo entry for the batch.
        await store.command({ type: 'apply-game-progress', memberId: player, fetchedAt: report.sentAt, skills: [], quests: [], achievements: [],
          items: result.ticks.map(itemCommand) }, store.getInfo().revision);
        // Handled, so a later Undo or untick isn't ticked again by the next report.
        await rememberItemsHandled(player, result.ticks);
      } catch {
        // A failed write must not reject the report or lose the matches.
        result.rows = [...result.ticks, ...result.rows].slice(0, ITEM_REVIEW_LIMIT);
      }
    }
    itemReview(player, report, result);
  }
  const coinCount = (rows, billions = false) => (rows ?? []).reduce((sum, [, id, count]) => sum + (id === COINS ? count : billions && id === COIN_BILLIONS ? count * 1e9 : 0), 0);
  // Coins on hand: pouch, backpack and the last bank the plugin saw. Live worlds only, written
  // only when the total changes and at most once a minute, so History isn't one entry per drop.
  async function updateCoins(player, world) {
    const coins = itemCoins.get(player);
    if (world !== 'live' || !coins || coins.pouch === null || coins.backpack === null) return;
    const total = Math.min(1e12, coins.pouch + coins.backpack + (coins.bank ?? 0)), owner = member(player);
    if (owner.transportFacts?.currencies?.coins === total || clock() - (coins.writtenAt ?? -Infinity) < COIN_WRITE_INTERVAL) return;
    const facts = structuredClone(owner.transportFacts ?? {});
    facts.currencies = { ...facts.currencies, coins: total };
    try { await store.command({ type: 'set-transport-facts', memberId: player, facts }, store.getInfo().revision); coins.writtenAt = clock(); }
    catch { log('Could not save coins from the game plugin; the next report tries again.'); }
  }
  function coinParts(player, world, bank) {
    const coins = itemCoins.get(player);
    if (coins?.world === world) return coins;
    const fresh = { world, pouch: null, backpack: null, bank };
    itemCoins.set(player, fresh); return fresh;
  }
  async function receiveItems(player, report) {
    const value = report.items, now = new Date(clock()).toISOString(), world = itemWorld(report);
    const saved = itemRecord(player, world);
    const ack = { snapshot: value.snapshot, journal: itemAcks.get(player)?.journal ?? null };
    // The first look needs both containers; until then only the snapshot is acknowledged.
    if (!saved && (value.worn === null || value.backpack === null)) { itemAcks.set(player, ack); return; }
    const record = saved ?? { baselineAt: now, items: {}, handled: [], journal: null }, fresh = !saved;
    const entries = [...(value.worn ?? []).map(([, id, , name]) => [id, name, true]), ...(value.backpack ?? []).map(([, id, , name]) => [id, name, false])];
    // Worn events the plugin saw while the picker was away; a new journal ID restarts the count.
    const after = record.journal?.id === value.journal.id ? record.journal.event : 0;
    for (const [event, id, name] of value.journal.events) if (event > after) entries.push([id, name, true]);
    // Tool belt entries name tools, not items: only reviewed name=value pairs become owned items.
    // The rest aren't listed; a full belt is about 60 entries and would bury the review.
    for (const [name, level] of value.toolbelt ?? []) {
      const id = GAME_TOOLBELT.get(`${name}=${level}`);
      if (id !== undefined) entries.push([id, null, false]);
    }
    const added = addEvidence(record, entries, now, fresh);
    let changed = fresh || added.changed;
    const last = Math.max(after, value.journal.events.at(-1)?.[0] ?? 0);
    if (record.journal?.id !== value.journal.id || last > after) { record.journal = { id: value.journal.id, event: last }; changed = true; }
    if (changed && !await keepItemRecord(player, world, record)) { itemAcks.set(player, ack); return; }
    itemAcks.set(player, { snapshot: value.snapshot, journal: record.journal });
    // A container the plugin couldn't read keeps its last coin count.
    const coins = coinParts(player, world, record.bank?.coins ?? null);
    if (value.pouch) coins.pouch = coinCount(value.pouch, true);
    if (value.backpack) coins.backpack = coinCount(value.backpack);
    await matchItems(player, report, record, world, added.unmapped);
    await updateCoins(player, world);
  }
  // Bank parts arrive in order, part 1 first; a new part 1 replaces an unfinished set. Status
  // acknowledges the last complete snapshot only.
  async function receiveBank(player, report) {
    // A held set sent again in full is the bank seen open again: it only moves "bank as of" on.
    const part = report.bank, world = itemWorld(report);
    let assembly = bankAssemblies.get(player);
    if (part.part === 1) { assembly = { snapshot: part.snapshot, parts: part.parts, received: 0, rows: [], world }; bankAssemblies.set(player, assembly); }
    if (!assembly || assembly.snapshot !== part.snapshot || assembly.parts !== part.parts || assembly.world !== world || part.part !== assembly.received + 1) return;
    assembly.rows.push(...part.rows); assembly.received++;
    if (assembly.received !== assembly.parts) return;
    bankAssemblies.delete(player);
    const now = new Date(clock()).toISOString(), seenAt = new Date(Date.parse(report.sentAt) - part.age * 1000).toISOString();
    const saved = itemRecord(player, world), record = saved ?? { baselineAt: now, items: {}, handled: [], journal: null };
    // Bank rows carry no names, so unmapped bank items aren't listed for review.
    addEvidence(record, assembly.rows.map(([id]) => [id, null, false]), now, !saved);
    record.bank = { snapshot: part.snapshot, seenAt, coins: Math.min(1e12, coinCount(assembly.rows.map(([id, count]) => [0, id, count]))) };
    if (!await keepItemRecord(player, world, record)) return;
    bankAcks.set(player, { snapshot: part.snapshot, world, seenAt });
    coinParts(player, world, null).bank = record.bank.coins;
    await matchItems(player, report, record, world, null);
    await updateCoins(player, world);
  }
  async function rememberItemsHandled(player, rows) {
    const dismissed = itemHandled.get(player) ?? new Set();
    for (const row of rows) dismissed.add(row.taskId);
    if (dismissed.size) itemHandled.set(player, dismissed);
    const live = rows.filter(row => row.world === 'live').map(row => row.taskId);
    const record = live.length ? itemStore.get(player) : null;
    if (!record) return;
    record.handled = [...new Set([...record.handled, ...live])].sort().slice(-2000);
    // The in-memory set still hides these rows if the write fails.
    try { await itemStore.put(player, record); } catch { log('Could not save handled plugin item tasks; keeping them in memory.'); }
  }
  function status(player) {
    const owner = member(player), revision = store.getInfo().revision;
    if (revision !== statusRevision) { statuses.clear(); rollSummaries = new WeakMap(); statusRevision = revision; }
    const pool = store.peekRollPool(player);
    // Nobody may have the picker page open. Warm the pool after this response, outside the
    // mutation queue, so a later status can say "can be picked next".
    if (!pool) warmRollPool(player);
    if (!statuses.has(player) || statuses.get(player).pool !== pool) {
      const shared = registry.resolve(state().rules)['access.shared'];
      const base = id => id.split('-')[0], others = state().members.filter(other => other.id !== player);
      statuses.set(player, { pool, unlocked: new Set((shared ? state().members : [owner]).flatMap(owner => owner.unlocked).map(base)),
        // Shared access only: who unlocked each chunk, so the game can mark a partner's chunks.
        own: new Set(owner.unlocked.map(base)), partner: shared ? new Set(others.flatMap(other => other.unlocked).map(base)) : new Set(),
        available: new Set([...(pool?.eligible ?? []).map(row => row.id), ...(owner.pendingRoll ?? []), ...(owner.selected ?? [])].map(id => id.split('-')[0])), count: owner.unlocked.length });
    }
    const cached = statuses.get(player), latest = positions.get(player);
    const position = latest && clock() - Date.parse(latest.seenAt) < LIFETIME ? latest : null;
    const chunkId = position?.chunkId ?? null, chunk = chunkId === null ? null : world.chunks.get(chunkId);
    // Set lookups only: the same cached sets answer the current chunk and its neighbours.
    const stateOf = id => cached.unlocked.has(id) ? 'unlocked' : !world.chunks.get(id) ? 'unknown' : cached.available.has(id) ? 'available' : 'locked';
    let nearby = null;
    if (position) {
      nearby = [];
      const { x, z } = position.position;
      for (let dz = -NEARBY_RADIUS; dz <= NEARBY_RADIUS; dz++) for (let dx = -NEARBY_RADIUS; dx <= NEARBY_RADIUS; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx > 199 || nz < 0 || nz > 199) continue;
        // Lua decodes chunkId into map squares for shading. Lookup ownership in
        // picker space, but leave the row at the reported game's coordinates.
        const id = coordinates.gameSquareToPickerChunk(nx, nz), row = { chunkId: String(nx * 256 + nz), state: stateOf(id) };
        if (row.state === 'unlocked' && cached.partner.size) row.by = !cached.partner.has(id) ? 'me' : cached.own.has(id) ? 'both' : 'partner';
        nearby.push(row);
      }
    }
    return { v: 1, accepts: ['achievements', 'items', 'toolbelt', 'pouch', 'bank'], achievements: achievementStatus(player), items: itemAcks.get(player) ?? null, bank: bankStatus(player), player: { id: player, name: owner.name }, chunkId: positionGameId(position), chunkName: chunk?.name ?? null,
      state: !position ? 'unknown' : stateOf(chunkId),
      activeTaskCount: taskRows.get(player)?.revision === revision && !taskRows.get(player).stale ? taskRows.get(player).rows.length : null, unlockedChunkCount: cached.count, pendingProgress: !!liveReview(player), seenAt: position?.seenAt ?? null, nearby,
      pickableCount: pool ? pool.eligible.length : null,
      pendingRoll: (owner.pendingRoll ?? []).map(id => ({ chunkId: gameId(id), chunkName: world.chunks.get(id.split('-')[0])?.name ?? null, summary: rollSummary(player, id) })),
      rollChoice: !!(owner.preferences?.roll2 ?? state().legacy?.maps?.[owner.sourceMapId]?.settings?.roll2 ?? true),
      partners: partners(player) };
  }
  // Cache only compact summaries; a late prediction can fill the same revision.
  let rollSummaries = new WeakMap();
  function rollSummary(player, id) {
    const prediction = peekPrediction(player, id);
    if (!prediction) return null;
    let summaries = rollSummaries.get(prediction);
    if (!summaries) { summaries = new Map(); rollSummaries.set(prediction, summaries); }
    if (summaries.has(id)) return summaries.get(id);
    const summary = pluginRollSummary(prediction, world.definitions?.chunks?.[id]);
    summaries.set(id, summary);
    return summary;
  }
  function warmRollPool(player) {
    if (!store.peekRollPool(player) && store.rollPool && !warming) {
      warming = true;
      setTimeout(() => { warming = false; if (!closed) try { store.rollPool(player); } catch {} }, 0).unref?.();
    }
  }
  // The last complete bank this picker holds; after a restart, the saved live one.
  function bankStatus(player) {
    const snapshot = bankAcks.get(player)?.snapshot ?? itemStore.get(player)?.bank?.snapshot;
    return snapshot ? { snapshot } : null;
  }
  function bankSeenAt(player) { return bankAcks.get(player)?.seenAt ?? itemStore.get(player)?.bank?.seenAt ?? null; }
  function hasActiveKey(player) { return keys.list(player).some(record => !record.revoked); }
  // Reads the saved task list only. A missing list is reported, never calculated.
  function tasks(player, from) {
    member(player);
    const revision = store.getInfo().revision, fresh = savedTasks(player);
    if (fresh?.bytes) retainedTasks.set(player, fresh.bytes);
    const current = fresh?.bytes && fresh.revision === revision, bytes = current ? fresh.bytes : retainedTasks.get(player);
    const latest = positions.get(player), position = latest && clock() - Date.parse(latest.seenAt) < LIFETIME ? latest : null;
    const chunkId = position?.chunkId ?? null;
    if (!bytes) return { ...pluginTaskList({ rows: null, chunkId, stateRevision: revision, stale: false }), chunkId: positionGameId(position),
      done: pluginDoneList({ chunkId, now: clock() }) };
    let cached = taskRows.get(player);
    // The getter returns a stable live-history view immediately. Background archive
    // completion replaces that view, invalidating only the finished-row projection.
    const history = store.getTaskCompletionHistory?.(player, { since: clock() - PLUGIN_DONE_AGE_MS });
    let snapshot, result;
    if (cached?.bytes !== bytes || cached.revision !== revision) {
      snapshot = store.getTaskClaimState?.() ?? store.getCalculationSnapshot().state;
      result = JSON.parse(bytes.toString('utf8'));
      const doneLocations = cached?.revision === revision ? cached.doneLocations : new Map();
      cached = { bytes, revision, stale: !current, doneLocations,
        rows: pluginTaskRows({ state: snapshot, result, registry, memberId: player, stale: !current }) };
      taskRows.set(player, cached);
    }
    if (!cached.doneRows || cached.history !== history) {
      cached.history = history;
      // Reparse only if the background ledger changed; do not keep a second
      // expanded copy of every saved task and the gameplay snapshot in memory.
      snapshot ??= store.getTaskClaimState?.() ?? store.getCalculationSnapshot().state;
      result ??= JSON.parse(bytes.toString('utf8'));
      const rows = pluginDoneRows({ state: { ...snapshot, history: history ?? snapshot.history ?? [] },
        result, registry, memberId: player });
      cached.doneRows = pluginDoneLocations({ rows, state: snapshot, result, world, now: clock(), cache: cached.doneLocations });
    }
    // Filter tasks in picker space, then keep the wire's current-chunk identity
    // consistent with status and the plugin's position/debounce checks.
    return { ...pluginTaskList({ rows: cached.rows, chunkId, stateRevision: revision, stale: cached.stale, from }), chunkId: positionGameId(position),
      done: pluginDoneList({ rows: cached.doneRows, chunkId, now: clock() }) };
  }
  // Other players' last reported chunks, from their own plugins. Never their exact tiles.
  function partners(player) {
    return state().members.filter(other => other.id !== player).map(other => {
      const latest = positions.get(other.id), fresh = latest && clock() - Date.parse(latest.seenAt) < LIFETIME;
      return { name: other.name, chunkId: fresh ? positionGameId(latest) : null, chunkName: fresh ? world.chunks.get(latest.chunkId)?.name ?? null : null,
        seenAt: fresh ? latest.seenAt : null };
    });
  }
  function credentialFor(request) {
    const credential = keys.authenticate(request);
    authorizeKey?.(request, credential.player);
    return credential;
  }
  return {
    authenticate: credentialFor,
    async handle(request, response, { route, security, closed: serverClosed }) {
      if (!PLUGIN_ROUTES.has(route)) {
        // A prefixed explicit key cannot fall back to a cookie, even after revocation/restart.
        if (keys.isCredential(request)) { unauthenticated(security.rateKey); throw fail(401, 'Game plugin keys cannot open picker routes.'); }
        return false;
      }
      let credential;
      try { credential = credentialFor(request); }
      catch (error) { if (error.status === 401) unauthenticated(security.rateKey); throw error; }
      member(credential.player); rate(credential.id);
      if (request.method !== PLUGIN_ROUTES.get(route)) throw fail(405, 'Method not allowed.');
      // Only the task list takes a query: `from` pages through the whole active list.
      const search = new URL(request.url, 'http://localhost').search, from = route === '/api/plugin/v1/tasks' ? pluginTaskFrom(search) : search ? null : 0;
      if (from === null) throw fail(400, route === '/api/plugin/v1/tasks' ? 'The task list takes only a from row number.' : 'Game plugin routes take no query parameters.');
      if (request.method === 'GET' && (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'])) {
        throw fail(Number(request.headers['content-length']) > 16384 ? 413 : 400, 'Plugin reads take no body.');
      }
      if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
      // This exact authenticated boundary never reads browser credentials. Missing
      // Origin is allowed, including Funnel; supplied origins retain normal checks.
      if (request.headers.origin || request.headers['sec-fetch-site'] === 'cross-site') checkRequestOrigin(request, security);
      if (route === '/api/plugin/v1/tasks') {
        // Outside the mutation queue: parsing a saved list must not delay commands.
        keys.touch(credential.id); await json(request, response, 200, tasks(credential.player, from)); return true;
      }
      const report = route === '/api/plugin/v1/report' ? validatePluginReport(await bodyJSON(request, 16384)) : null;
      const result = await serializeMutation(async () => {
        if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
        credentialFor(request); member(credential.player);
        void flushHandled();
        if (report) {
          if (report.seq <= (sequences.get(credential.id) ?? -1)) throw fail(409, 'The report seq must increase for this key.');
          sequences.set(credential.id, report.seq);
          const assembly = assemblies.get(credential.player);
          if (report.world?.beta === false && assembly && assembly.received === assembly.parts && !assembly.live) {
            // World is absent from the plugin's snapshot hash. Ordinary live
            // reports must also reset status so its next sync resends the set.
            assemblies.delete(credential.player);
            completedSnapshots.get(credential.player)?.delete(assembly.snapshot);
          }
          positions.set(credential.player, { memberId: credential.player, chunkId: coordinates.gameSquareToPickerChunk(report.position.x, report.position.z),
            position: report.position, seenAt: new Date(clock()).toISOString() });
          progressSource.receive(credential.player, report);
          if (report.diagnostics) diagnostics.set(credential.id, { lines: [...report.diagnostics], receivedAt: new Date(clock()).toISOString() });
          if (report.skills !== undefined || report.quests !== undefined) {
            const prior = liveReview(credential.player)?.report;
            const previous = report.world && prior?.world && report.world.beta !== prior.world.beta ? null : prior;
            // Optional fields are deltas: preserve other unapplied observations.
            const observations = new Map((previous?.skills ?? []).map(row => [row.skill, row]));
            for (const row of report.skills ?? []) observations.set(row.skill, row);
            const merged = { ...report, skills: [...observations.values()], quests: report.quests ?? previous?.quests,
              world: report.world ?? previous?.world, achievementReview: previous?.achievementReview, achievementsMore: previous?.achievementsMore,
              itemReview: previous?.itemReview, itemsMore: previous?.itemsMore, unmappedItems: previous?.unmappedItems, unmappedItemsMore: previous?.unmappedItemsMore };
            pending.set(credential.player, { report: merged, proposal: null });
          }
          if (report.achievements) await receiveAchievements(credential.player, report);
          if (report.items) await receiveItems(credential.player, report);
          if (report.bank) await receiveBank(credential.player, report);
          notify();
        }
        keys.touch(credential.id, report?.world);
        return status(credential.player);
      });
      await json(request, response, 200, result); return true;
    },
    list(identity) {
      const latest = [...positions.values()].filter(position => clock() - Date.parse(position.seenAt) < LIFETIME && store.getCalculationSnapshot().members.some(owner => owner.id === position.memberId));
      const visible = identity.readOnly || !identity.admin && !identity.memberId ? [] : keys.list(identity.admin ? undefined : identity.memberId);
      return { keys: visible.map(record => ({ ...record, diagnostics: diagnostics.get(record.id) ?? null, bankSeenAt: bankSeenAt(record.player),
        achievements: assemblies.has(record.player) ? { ...achievementStatus(record.player), completeCount: null, matchedTaskCount: null, lastTickedCount: 0, lastTickedAt: null, ...achievementSummaries.get(record.player) } : null })), positions: latest, active: latest.length > 0 };
    },
    review(identity, player) {
      member(player); const review = liveReview(player);
      if (!review) return { preview: null };
      if (!review.proposal || review.proposal.preview.stateRevision !== store.getInfo().revision) review.proposal = pluginProposal(state(), player, review.report, questMapping);
      return review.proposal.preview;
    },
    progressSnapshot(owner) { return hasActiveKey(owner.id) ? progressSource.snapshot(owner) : null; },
    async create(identity, body) {
      fields(body, ['memberId', 'label'], 'key'); authorize(identity, body.memberId);
      if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80 || /[\x00-\x1f\x7f]/.test(body.label)) throw fail(400, 'Use a key label from 1 to 80 characters.');
      const result = await keys.create(body.memberId, body.label.trim());
      try { await indexKey?.(identity, result.key, result.record.player); }
      catch (error) { await keys.revoke(result.record.id, result.record.player); throw error; }
      notify(); return result;
    },
    async revoke(identity, id, body) {
      fields(body, [], 'revocation');
      if (identity.readOnly || !identity.admin && !identity.memberId) throw fail(403, 'Player access required.');
      const result = await keys.revoke(id, identity.admin ? undefined : identity.memberId);
      if (removeKey) {
        // The public key record redacts its hash. Read only this already-selected
        // context's durable record, after local authorization and revocation.
        const document = JSON.parse(await readFile(path.join(dataDir, 'plugin-keys.json'), 'utf8'));
        const record = document.keys.find(record => record.id === result.id);
        if (!record) throw fail(503, 'Retry revoking this key to finish removing its capability.');
        await removeKey(identity, record.tokenHash, result.player);
      }
      notify(); return { record: result };
    },
    findReview(identity, body, apply = false) {
      fields(body, apply ? ['previewId', 'expectedRevision', 'skills', 'quests', 'achievements', 'items'] : ['previewId'], 'review');
      if (typeof body.previewId !== 'string') throw fail(400, 'A reviewed preview ID is required.');
      const review = [...pending.keys()].map(liveReview).find(review => review?.proposal?.preview.previewId === body.previewId);
      if (!review) throw fail(410, 'This game progress review expired or changed. Review it again.');
      authorize(identity, review.proposal.preview.memberId);
      if (apply && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== review.proposal.preview.stateRevision || body.expectedRevision !== store.getInfo().revision)) throw fail(409, 'The save changed. Review game progress again.');
      if (!apply) return review.proposal;
      // Skipping levels or quests leaves them out of the command; omitted means apply, as before.
      if (['skills', 'quests'].some(key => body[key] !== undefined && body[key] !== false)) throw fail(400, 'Skills and quests can only be skipped with false.');
      // Item rows apply only when chosen; nothing from items ticks by default.
      const items = body.items === undefined ? [] : selectItems(review.proposal.preview, body.items);
      const command = { ...review.proposal.command, ...(body.skills === false ? { skills: [] } : {}), ...(body.quests === false ? { quests: [] } : {}), items };
      const nothing = rows => body.skills === false && body.quests === false && !rows.length && !items.length;
      if (body.achievements === undefined) { if (nothing([])) throw fail(400, 'Nothing is selected. Dismiss the review instead.'); return { ...review.proposal, command }; }
      if (!Array.isArray(body.achievements) || body.achievements.length > ACHIEVEMENT_REVIEW_LIMIT) throw fail(400, 'Choose at most 200 achievements.');
      const ids = new Set(), tasks = new Set();
      const achievements = body.achievements.map(selection => {
        fields(selection, ['achievementId', 'taskId'], 'achievement selection');
        if (!Number.isSafeInteger(selection.achievementId) || selection.achievementId < 0 || typeof selection.taskId !== 'string'
          || ids.has(selection.achievementId) || tasks.has(selection.taskId)) throw fail(400, 'Choose each achievement and task once.');
        const row = review.proposal.preview.achievements.find(row => row.achievementId === selection.achievementId && row.candidates.some(task => task.taskId === selection.taskId));
        if (!row) throw fail(400, 'Choose a task from the reviewed achievement candidates.');
        ids.add(selection.achievementId); tasks.add(selection.taskId);
        return { taskId: selection.taskId, achievementId: selection.achievementId, title: row.title };
      });
      if (nothing(achievements)) throw fail(400, 'Nothing is selected. Dismiss the review instead.');
      return { ...review.proposal, command: { ...command, achievements } };
    },
    async finish(memberId) {
      const review = liveReview(memberId);
      // Apply and Dismiss both make the player's choice final for every live
      // row shown, including skipped rows. Beta/unknown copies may report live later.
      const ids = (review?.proposal?.preview.achievements ?? []).filter(row => row.world === 'live').map(row => row.achievementId);
      if (ids.length) rememberHandled(memberId, ids);
      await rememberItemsHandled(memberId, review?.proposal?.preview.items ?? []);
      pending.delete(memberId); notify();
    },
    rememberTasks(memberId, bytes) {
      if (closed || !bytes) return;
      if (hasActiveKey(memberId)) retainedTasks.set(memberId, bytes); else { retainedTasks.delete(memberId); taskRows.delete(memberId); }
    },
    revokeDeletion() { return keys.revokeDeletion(); },
    async prepareSnapshot() { await handledFlush; await flushHandled(true); await keys.flush(); },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await handledFlush;
        await flushHandled(true);
        await Promise.all([keys.close(), handled.close(), itemStore.close()]);
        itemMemory.clear(); itemAcks.clear(); itemHandled.clear(); bankAssemblies.clear(); bankAcks.clear(); itemCoins.clear();
        progressSource.clear(); itemTasks = undefined;
        sequences.clear(); buckets.clear(); statuses.clear(); pendingHandled.clear();
        rollSummaries = new WeakMap(); positions.clear(); pending.clear(); diagnostics.clear(); retainedTasks.clear(); taskRows.clear(); assemblies.clear(); completedSnapshots.clear(); achievementSummaries.clear();
      })();
      return closePromise;
    },
  };
}
