import { openPluginKeys } from './plugin-keys.mjs';
import { fields, validatePluginReport, pluginProposal } from './integrations/game-plugin.mjs';
import { pluginTaskRows, pluginTaskList } from './game-plugin-tasks.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const LIFETIME = 10 * 60 * 1000;
// Status also describes the block of map squares centred on the player (2 each way: 5x5).
const NEARBY_RADIUS = 2;
const PLUGIN_ROUTES = new Map([['/api/plugin/v1/report', 'POST'], ['/api/plugin/v1/status', 'GET'], ['/api/plugin/v1/tasks', 'GET']]);

/** Positions/proposals are ephemeral. Only reviewed progress can reach store.command. */
export async function openGamePlugin({ dataDir, store, world, registry, questMapping, bodyJSON, json,
  serializeMutation, checkRequestOrigin, notify = () => {}, clock = Date.now, savedTasks = () => null }) {
  const keys = await openPluginKeys({ dataDir, clock });
  const positions = new Map(), pending = new Map(), sequences = new Map(), buckets = new Map(), diagnostics = new Map();
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
    return { v: 1, player: { id: player, name: owner.name }, chunkId, chunkName: chunk?.name ?? null,
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
        if (report) {
          if (report.seq <= (sequences.get(credential.id) ?? -1)) throw fail(409, 'The report seq must increase for this key.');
          sequences.set(credential.id, report.seq);
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
              world: report.world ?? previous?.world };
            pending.set(credential.player, { report: merged, proposal: null });
          }
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
      return { keys: visible.map(record => ({ ...record, diagnostics: diagnostics.get(record.id) ?? null })), positions: latest, active: latest.length > 0 };
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
      fields(body, apply ? ['previewId', 'expectedRevision'] : ['previewId'], 'review');
      if (typeof body.previewId !== 'string') throw fail(400, 'A reviewed preview ID is required.');
      const review = [...pending.keys()].map(liveReview).find(review => review?.proposal?.preview.previewId === body.previewId);
      if (!review) throw fail(410, 'This game progress review expired or changed. Review it again.');
      authorize(identity, review.proposal.preview.memberId);
      if (apply && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== review.proposal.preview.stateRevision || body.expectedRevision !== store.getInfo().revision)) throw fail(409, 'The save changed. Review game progress again.');
      return review.proposal;
    },
    finish(memberId) { pending.delete(memberId); notify(); },
    rememberTasks(memberId, bytes) {
      if (closed || !bytes) return;
      if (hasActiveKey(memberId)) retainedTasks.set(memberId, bytes); else { retainedTasks.delete(memberId); taskRows.delete(memberId); }
    },
    async close() { closed = true; await keys.close(); positions.clear(); pending.clear(); diagnostics.clear(); retainedTasks.clear(); taskRows.clear(); },
  };
}
