import { openPluginKeys } from './plugin-keys.mjs';
import { openPluginAchievements } from './plugin-achievements.mjs';
import { fields, validatePluginReport, pluginProposal, matchPluginAchievements, ACHIEVEMENT_REVIEW_LIMIT } from './integrations/game-plugin.mjs';
import { pluginTaskRows, pluginTaskList } from './game-plugin-tasks.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const LIFETIME = 10 * 60 * 1000;
// Status also describes the block of map squares centred on the player (2 each way: 5x5).
const NEARBY_RADIUS = 2;
const COMPLETED_SNAPSHOT_LIMIT = 8;
const HANDLED_RETRY_INTERVAL = 60 * 1000;
const PLUGIN_ROUTES = new Map([['/api/plugin/v1/report', 'POST'], ['/api/plugin/v1/status', 'GET'], ['/api/plugin/v1/tasks', 'GET']]);

/** Positions, assemblies and proposals are ephemeral. Ticks use store.command. */
export async function openGamePlugin({ dataDir, store, world, registry, questMapping, bodyJSON, json,
  serializeMutation, checkRequestOrigin, notify = () => {}, clock = Date.now, savedTasks = () => null, log = console.warn }) {
  const keys = await openPluginKeys({ dataDir, clock });
  const handled = await openPluginAchievements({ dataDir, members: () => state().members, clock, log });
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
    if (!rows.length && prior?.skills === undefined && prior?.quests === undefined) { pending.delete(player); return; }
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
  function status(player) {
    const owner = member(player), revision = store.getInfo().revision;
    if (revision !== statusRevision) { statuses.clear(); statusRevision = revision; }
    const pool = store.peekRollPool(player);
    // Nobody may have the picker page open. Warm the pool after this response, outside the
    // mutation queue, so a later status can say "can be picked next".
    if (!pool && store.rollPool && !warming) {
      warming = true;
      setTimeout(() => { warming = false; if (!closed) try { store.rollPool(player); } catch {} }, 0).unref?.();
    }
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
        const id = String(nx * 256 + nz), row = { chunkId: id, state: stateOf(id) };
        if (row.state === 'unlocked' && cached.partner.size) row.by = !cached.partner.has(id) ? 'me' : cached.own.has(id) ? 'both' : 'partner';
        nearby.push(row);
      }
    }
    return { v: 1, accepts: ['achievements'], achievements: achievementStatus(player), player: { id: player, name: owner.name }, chunkId, chunkName: chunk?.name ?? null,
      state: !position ? 'unknown' : stateOf(chunkId),
      activeTaskCount: taskRows.get(player)?.revision === revision && !taskRows.get(player).stale ? taskRows.get(player).rows.length : null, unlockedChunkCount: cached.count, pendingProgress: !!liveReview(player), seenAt: position?.seenAt ?? null, nearby,
      pickableCount: pool ? pool.eligible.length : null,
      pendingRoll: (owner.pendingRoll ?? []).map(id => ({ chunkId: id, chunkName: world.chunks.get(id.split('-')[0])?.name ?? null })),
      partners: partners(player) };
  }
  function hasActiveKey(player) { return keys.list(player).some(record => !record.revoked); }
  // Reads the saved task list only. A missing list is reported, never calculated.
  function tasks(player) {
    member(player);
    const revision = store.getInfo().revision, fresh = savedTasks(player);
    if (fresh?.bytes) retainedTasks.set(player, fresh.bytes);
    const current = fresh?.bytes && fresh.revision === revision, bytes = current ? fresh.bytes : retainedTasks.get(player);
    const latest = positions.get(player), chunkId = latest && clock() - Date.parse(latest.seenAt) < LIFETIME ? latest.chunkId : null;
    if (!bytes) return pluginTaskList({ rows: null, chunkId, stateRevision: revision, stale: false });
    let cached = taskRows.get(player);
    if (cached?.bytes !== bytes || cached.revision !== revision) {
      const state = store.getTaskClaimState?.() ?? store.getCalculationSnapshot().state;
      cached = { bytes, revision, stale: !current,
        rows: pluginTaskRows({ state, result: JSON.parse(bytes.toString('utf8')), registry, memberId: player, stale: !current }) };
      taskRows.set(player, cached);
    }
    return pluginTaskList({ rows: cached.rows, chunkId, stateRevision: revision, stale: cached.stale });
  }
  // Other players' last reported chunks, from their own plugins. Never their exact tiles.
  function partners(player) {
    return state().members.filter(other => other.id !== player).map(other => {
      const latest = positions.get(other.id), fresh = latest && clock() - Date.parse(latest.seenAt) < LIFETIME;
      return { name: other.name, chunkId: fresh ? latest.chunkId : null, chunkName: fresh ? world.chunks.get(latest.chunkId)?.name ?? null : null,
        seenAt: fresh ? latest.seenAt : null };
    });
  }
  return {
    async handle(request, response, { route, security, closed: serverClosed }) {
      if (!PLUGIN_ROUTES.has(route)) {
        // A prefixed explicit key cannot fall back to a cookie, even after revocation/restart.
        if (keys.isCredential(request)) throw fail(401, 'Game plugin keys cannot open picker routes.');
        return false;
      }
      const credential = keys.authenticate(request); member(credential.player); rate(credential.id);
      if (request.method !== PLUGIN_ROUTES.get(route)) throw fail(405, 'Method not allowed.');
      if (new URL(request.url, 'http://localhost').search) throw fail(400, 'Game plugin routes take no query parameters.');
      if (request.method === 'GET' && (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'])) {
        throw fail(Number(request.headers['content-length']) > 16384 ? 413 : 400, 'Plugin reads take no body.');
      }
      if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
      // This exact authenticated boundary never reads browser credentials. Missing
      // Origin is allowed, including Funnel; supplied origins retain normal checks.
      if (request.headers.origin || request.headers['sec-fetch-site'] === 'cross-site') checkRequestOrigin(request, security);
      if (route === '/api/plugin/v1/tasks') {
        // Outside the mutation queue: parsing a saved list must not delay commands.
        keys.touch(credential.id); await json(request, response, 200, tasks(credential.player)); return true;
      }
      const report = route === '/api/plugin/v1/report' ? validatePluginReport(await bodyJSON(request, 16384)) : null;
      const result = await serializeMutation(async () => {
        if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
        keys.authenticate(request); member(credential.player);
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
          positions.set(credential.player, { memberId: credential.player, chunkId: String(report.position.x * 256 + report.position.z),
            position: report.position, seenAt: new Date(clock()).toISOString() });
          if (report.diagnostics) diagnostics.set(credential.id, { lines: [...report.diagnostics], receivedAt: new Date(clock()).toISOString() });
          if (report.skills !== undefined || report.quests !== undefined) {
            const prior = liveReview(credential.player)?.report;
            const previous = report.world && prior?.world && report.world.beta !== prior.world.beta ? null : prior;
            // Optional fields are deltas: preserve other unapplied observations.
            const observations = new Map((previous?.skills ?? []).map(row => [row.skill, row]));
            for (const row of report.skills ?? []) observations.set(row.skill, row);
            const merged = { ...report, skills: [...observations.values()], quests: report.quests ?? previous?.quests,
              world: report.world ?? previous?.world, achievementReview: previous?.achievementReview, achievementsMore: previous?.achievementsMore };
            pending.set(credential.player, { report: merged, proposal: null });
          }
          if (report.achievements) await receiveAchievements(credential.player, report);
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
      return { keys: visible.map(record => ({ ...record, diagnostics: diagnostics.get(record.id) ?? null,
        achievements: assemblies.has(record.player) ? { ...achievementStatus(record.player), completeCount: null, matchedTaskCount: null, lastTickedCount: 0, lastTickedAt: null, ...achievementSummaries.get(record.player) } : null })), positions: latest, active: latest.length > 0 };
    },
    review(identity, player) {
      member(player); const review = liveReview(player);
      if (!review) return { preview: null };
      if (!review.proposal || review.proposal.preview.stateRevision !== store.getInfo().revision) review.proposal = pluginProposal(state(), player, review.report, questMapping);
      return review.proposal.preview;
    },
    async create(identity, body) {
      fields(body, ['memberId', 'label'], 'key'); authorize(identity, body.memberId);
      if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80 || /[\x00-\x1f\x7f]/.test(body.label)) throw fail(400, 'Use a key label from 1 to 80 characters.');
      const result = await keys.create(body.memberId, body.label.trim()); notify(); return result;
    },
    async revoke(identity, id, body) {
      fields(body, [], 'revocation');
      if (identity.readOnly || !identity.admin && !identity.memberId) throw fail(403, 'Player access required.');
      const result = await keys.revoke(id, identity.admin ? undefined : identity.memberId); notify(); return { record: result };
    },
    findReview(identity, body, apply = false) {
      fields(body, apply ? ['previewId', 'expectedRevision', 'achievements'] : ['previewId'], 'review');
      if (typeof body.previewId !== 'string') throw fail(400, 'A reviewed preview ID is required.');
      const review = [...pending.keys()].map(liveReview).find(review => review?.proposal?.preview.previewId === body.previewId);
      if (!review) throw fail(410, 'This game progress review expired or changed. Review it again.');
      authorize(identity, review.proposal.preview.memberId);
      if (apply && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== review.proposal.preview.stateRevision || body.expectedRevision !== store.getInfo().revision)) throw fail(409, 'The save changed. Review game progress again.');
      if (!apply || body.achievements === undefined) return review.proposal;
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
      return { ...review.proposal, command: { ...review.proposal.command, achievements } };
    },
    async finish(memberId) {
      const review = liveReview(memberId);
      // Apply and Dismiss both make the player's choice final for every live
      // row shown, including skipped rows. Beta/unknown copies may report live later.
      const ids = (review?.proposal?.preview.achievements ?? []).filter(row => row.world === 'live').map(row => row.achievementId);
      if (ids.length) rememberHandled(memberId, ids);
      pending.delete(memberId); notify();
    },
    rememberTasks(memberId, bytes) {
      if (closed || !bytes) return;
      if (hasActiveKey(memberId)) retainedTasks.set(memberId, bytes); else { retainedTasks.delete(memberId); taskRows.delete(memberId); }
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await handledFlush;
        await flushHandled(true);
        await Promise.all([keys.close(), handled.close()]);
        positions.clear(); pending.clear(); diagnostics.clear(); retainedTasks.clear(); taskRows.clear(); assemblies.clear(); completedSnapshots.clear(); achievementSummaries.clear();
      })();
      return closePromise;
    },
  };
}
