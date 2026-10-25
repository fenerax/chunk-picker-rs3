import { createStreamLimits } from './security/request.mjs';
import { parseRequestJSON } from './security/json.mjs';
import { open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { overlayPayload, overlayRollCandidate, overlayText } from './overlay-model.mjs';

const WIDGETS = new Set(['goals', 'roll', 'count']);
const VARIANTS = new Set(['full', 'compact']);
const SIZES = new Set(['small', 'medium', 'large']);
const GOALS = new Set(['personal', 'group', 'both']);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const PLAYER = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[a-f0-9-]{36}$/;
const ROLL_EVENTS = new Set(['roll', 'random-start', 'cancel-roll', 'unlock-selection', 'pick-for-me', 'unlock-both']);
const ROLL_UNCHANGED = new Set(['set-journal', 'set-note', 'set-preference', 'complete-task', 'set-task-status', 'add-task', 'update-task', 'delete-task', 'set-rule', 'set-task-rule', 'reset-task-rule', 'clear-backlog', 'clear-challenge-ticks', 'tick-active-tasks']);
const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = token => createHash('sha256').update(token).digest('hex');
const equals = (a, b) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const metadata = ({ tokenHash, ...record }) => ({ ...record });
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function validate(document) {
  if (!document || Object.keys(document).some(key => !['schemaVersion', 'links'].includes(key)) || document.schemaVersion !== 1 || !Array.isArray(document.links) || document.links.length > 1000) throw new TypeError('Invalid overlay store.');
  const ids = new Set(), hashes = new Set();
  for (const record of document.links) {
    if (!record || Object.keys(record).some(key => !['id', 'label', 'widget', 'player', 'goals', 'createdAt', 'revoked', 'tokenHash'].includes(key))
      || !ID.test(record.id ?? '') || ids.has(record.id) || !HASH.test(record.tokenHash ?? '') || hashes.has(record.tokenHash)
      || typeof record.label !== 'string' || !record.label || record.label !== overlayText(record.label, 80)
      || !WIDGETS.has(record.widget) || !PLAYER.test(record.player ?? '') || typeof record.revoked !== 'boolean' || !validDate(record.createdAt)
      || record.goals !== undefined && (record.widget !== 'goals' || !GOALS.has(record.goals))) throw new TypeError('Invalid overlay record.');
    ids.add(record.id); hashes.add(record.tokenHash);
  }
  return document;
}

async function atomicWrite(file, document) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(validate(document))}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(20 * 2 ** attempt);
      }
    }
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
}

async function bodyJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw fail(415, 'Use application/json.');
  if (Number(request.headers['content-length']) > 8192) throw fail(413, 'Request body is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 8192) throw fail(413, 'Request body is too large.'); chunks.push(chunk); }
  const value = parseRequestJSON(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Request body must be a JSON object.');
  return value;
}

function send(request, response, status, bytes, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length,
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}
const json = (request, response, status, value) => send(request, response, status, Buffer.from(JSON.stringify(value)));

function options(query, widget) {
  if ([...query.keys()].some(key => !['widget', 'player', 'goals', 'variant', 'size'].includes(key)) || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) throw fail(400, 'Unknown overlay option.');
  const value = { widget: widget ?? query.get('widget'), player: query.get('player') ?? 'duo', variant: query.get('variant') ?? 'full', size: query.get('size') ?? 'medium' };
  if (!WIDGETS.has(value.widget) || !PLAYER.test(value.player) || !VARIANTS.has(value.variant) || !SIZES.has(value.size)) throw fail(400, 'Choose a valid overlay widget, player, variant and size.');
  if (widget && query.has('widget') && query.get('widget') !== widget) throw fail(400, 'The overlay widget cannot be changed.');
  if (value.widget === 'goals') {
    value.goals = query.get('goals') ?? 'personal';
    if (!GOALS.has(value.goals)) throw fail(400, 'Choose personal pins, group goals or both.');
    if (value.goals === 'group' && value.player !== 'duo') throw fail(400, 'Group goals include both players.');
  } else if (query.has('goals')) throw fail(400, 'Goal choices apply only to Active goals.');
  return value;
}

/** Sidecar credentials live under the existing exclusive save-directory lock. */
export async function openOverlays({ dataDir, store, world, webRoot, publicOrigin, authenticateAdmin, checkRequestOrigin,
  serializeMutation = operation => operation(), unauthenticated = () => {}, admitStream = createStreamLimits() }) {
  const file = path.join(dataDir, 'overlays.json');
  let current;
  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; current = { schemaVersion: 1, links: [] }; }
  let queue = Promise.resolve(), closed = false;
  const clients = new Set();
  const payloads = new Map();
  function savedGroupGoals() {
    // Calculation inputs deliberately omit shared plans. Select their existing
    // JSON field before parsing, without cloning retained saves or Undo graphs.
    if (!store.getStateJSONParts) return store.getState().groupGoals ?? [];
    const parts = store.getStateJSONParts(), index = parts.indexOf('"groupGoals"');
    if (index < 0) return [];
    if (parts[index + 1] !== ':') throw new TypeError('Invalid saved goal field.');
    return JSON.parse(parts[index + 2]);
  }
  // Finished display results and bounded archive cursors survive unrelated task edits.
  const rollResults = new Map(), rollLookups = new Map();
  let rollEpoch = 0;
  const members = () => store.getCalculationSnapshot?.().members ?? store.getState().members;
  const publicFiles = new Map([
    ['/overlay/goals', ['overlay.html', 'text/html; charset=utf-8']],
    ['/overlay/roll', ['overlay.html', 'text/html; charset=utf-8']],
    ['/overlay/count', ['overlay.html', 'text/html; charset=utf-8']],
    ['/overlay/overlay.css', ['overlay.css', 'text/css; charset=utf-8']],
    ['/overlay/overlay-client.mjs', ['overlay-client.mjs', 'text/javascript; charset=utf-8']],
  ]);
  function requireAdmin(request, security) {
    const identity = authenticateAdmin(request, security);
    if (!identity) { unauthenticated(security.rateKey); throw fail(401, 'Access required.'); }
    if (!identity.admin || identity.readOnly) throw fail(403, 'Administrator access required.');
    return identity;
  }
  function credential(request, scope, security) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token || !TOKEN.test(token)) { unauthenticated(security.rateKey); throw fail(401, 'Overlay access required.'); }
    const hash = digest(token), record = current.links.find(record => !record.revoked && equals(record.tokenHash, hash));
    if (!record) { unauthenticated(security.rateKey); throw fail(401, 'Overlay access required.'); }
    if (record.widget !== scope.widget || record.player !== scope.player) throw fail(403, 'This link does not allow that overlay.');
    if (scope.widget === 'goals' && (record.goals ?? 'personal') !== scope.goals) throw fail(403, 'This link does not allow those goals.');
    if (record.player !== 'duo' && !members().some(member => member.id === record.player)) throw fail(403, 'This overlay player is no longer available.');
    return record;
  }
  function stop(client, slow = false) { clearInterval(client.heartbeat); clients.delete(client); if (slow) client.response.destroy(); else client.response.end(); }
  const unsubscribe = store.subscribe(({ revision }) => {
    payloads.clear();
    const event = store.getHistoryEvent?.(revision);
    if (!event || !ROLL_UNCHANGED.has(event.type)) { rollEpoch++; rollResults.clear(); rollLookups.clear(); }
    for (const client of clients) {
      if (closed || !current.links.some(record => record.id === client.id && !record.revoked)) { stop(client); continue; }
      // An OBS source cannot make a slow client grow an unbounded write buffer.
      if (!client.response.write(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`)) stop(client, true);
    }
  });
  async function archivedRoll(state, player) {
    if (rollResults.has(player)) return rollResults.get(player);
    const active = overlayRollCandidate({ state, world, player });
    if (active?.revision >= 0 || !store.queryHistory) { rollResults.set(player, active); return active; }
    const epoch = rollEpoch;
    let lookup = rollLookups.get(player);
    if (!lookup) {
      lookup = { history: state.history.filter(event => ROLL_EVENTS.has(event.type)), before: undefined };
      rollLookups.set(player, lookup);
    }
    // Each request has bounded work. A very deep search resumes its cursor on
    // the next read rather than inventing an empty result or restarting at page one.
    for (let page = 0; page < 10; page++) {
      let result;
      try { result = await store.queryHistory({ type: 'map', player, limit: 100, stateRevision: state.revision, ...(lookup.before === undefined ? {} : { before: lookup.before }) }); }
      catch (error) {
        // The ordinary server conflict response includes a full save. Overlay
        // conflicts must cross this boundary as a small, credential-free error.
        if (error.code === 'REVISION_CONFLICT') throw fail(409, 'Saved state changed. Retry the overlay.');
        throw error;
      }
      if (closed) throw fail(503, 'The picker is stopping.');
      if (rollEpoch !== epoch || store.getInfo().revision !== state.revision) throw fail(409, 'Saved state changed. Retry the overlay.');
      const byRevision = new Map(lookup.history.map(event => [event.revision, event]));
      for (const event of result.history) if (ROLL_EVENTS.has(event.type)) byRevision.set(event.revision, event);
      lookup.history = [...byRevision.values()].sort((a, b) => a.revision - b.revision);
      const candidate = overlayRollCandidate({ state: { ...state, history: lookup.history }, world, player });
      if (candidate?.revision >= 0 || !result.hasMore) {
        rollResults.set(player, candidate); rollLookups.delete(player); return candidate;
      }
      lookup.before = result.nextBefore;
    }
    throw fail(409, 'Looking up the last roll. Retry the overlay.');
  }
  async function rollPayload(state, player) {
    const owners = player === 'duo' ? state.members : state.members.filter(member => member.id === player);
    const candidates = [];
    for (const owner of owners) {
      const candidate = await archivedRoll(state, owner.id);
      if (candidate) candidates.push(candidate);
    }
    const latest = candidates.sort((a, b) => b.revision - a.revision)[0];
    return { revision: state.revision, widget: 'roll', heading: 'Last roll', roll: latest?.roll ?? null };
  }
  function mutate(request, security, operation) {
    const pending = queue.then(() => serializeMutation(async () => {
      if (closed) throw fail(503, 'The picker is stopping.');
      requireAdmin(request, security);
      const next = structuredClone(current), result = operation(next);
      await atomicWrite(file, next); current = next;
      for (const client of clients) if (!next.links.some(record => record.id === client.id && !record.revoked)) stop(client);
      return result;
    }));
    queue = pending.catch(() => {}); return pending;
  }
  return {
    async handle(request, response, { route, security, closed: serverClosed = false }) {
      const management = route === '/api/overlays' || route.startsWith('/api/overlays/');
      const overlay = route.startsWith('/overlay/');
      // An explicit overlay credential stays scoped even in a signed-in browser.
      // Include revoked records so a stale source cannot fall back to a cookie.
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
      const presentedHash = !overlay && bearer ? digest(bearer) : null;
      if (presentedHash && current.links.some(record => equals(record.tokenHash, presentedHash))) throw fail(401, 'Overlay links cannot open picker routes.');
      if (!management && !overlay) return false;
      const reading = request.method === 'GET' || request.method === 'HEAD';
      if (management) {
        requireAdmin(request, security);
        if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
        if (reading && route === '/api/overlays') { json(request, response, 200, { links: current.links.map(metadata) }); return true; }
        const revokeId = /^\/api\/overlays\/([a-f0-9-]{36})\/revoke$/.exec(route)?.[1];
        if (request.method !== 'POST' || route !== '/api/overlays' && !revokeId) throw fail(reading ? 404 : 403, reading ? 'Not found.' : 'Unknown overlay mutation.');
        checkRequestOrigin(request, security);
        const input = await bodyJSON(request);
        if (revokeId) {
          if (Object.keys(input).length) throw fail(400, 'Revocation takes an empty object.');
          const record = await mutate(request, security, next => {
            const record = next.links.find(record => record.id === revokeId);
            if (!record) throw fail(404, 'Overlay link not found.');
            record.revoked = true; return metadata(record);
          });
          json(request, response, 200, { overlay: record }); return true;
        }
        if (Object.keys(input).some(key => !['label', 'widget', 'player', 'goals', 'variant', 'size'].includes(key))) throw fail(400, 'Use label, widget, player, goals, variant and size.');
        const scope = options(new URLSearchParams(Object.entries(input).filter(([key]) => key !== 'label')));
        if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80)) throw fail(400, 'Use an overlay label from 1 to 80 characters.');
        const label = overlayText(input.label ?? `${scope.widget} · ${scope.player}`, 80);
        if (!label) throw fail(400, 'Use an overlay label from 1 to 80 characters.');
        const result = await mutate(request, security, next => {
          if (scope.player !== 'duo' && !members().some(member => member.id === scope.player)) throw fail(400, 'Choose a known player.');
          if (next.links.length >= 1000) throw fail(409, 'The overlay link limit has been reached.');
          const key = randomBytes(32).toString('base64url');
          const record = { id: randomUUID(), label, widget: scope.widget, player: scope.player,
            ...(scope.widget === 'goals' ? { goals: scope.goals } : {}), createdAt: new Date().toISOString(), revoked: false, tokenHash: digest(key) };
          next.links.push(record);
          const query = new URLSearchParams({ player: scope.player, variant: scope.variant, size: scope.size });
          if (scope.widget === 'goals') query.set('goals', scope.goals);
          return { overlay: metadata(record), link: `${publicOrigin ?? security.origin}/overlay/${scope.widget}?${query}#key=${key}` };
        });
        json(request, response, 201, result); return true;
      }
      if (!reading) throw fail(403, 'Overlays are read only.');
      if (publicFiles.has(route)) {
        const [filename, type] = publicFiles.get(route);
        if (route === '/overlay/goals' || route === '/overlay/roll' || route === '/overlay/count') options(new URL(request.url, 'http://localhost').searchParams, route.split('/').at(-1));
        const base = await realpath(webRoot), target = await realpath(path.join(webRoot, filename));
        if (path.dirname(target) !== base) throw fail(404, 'Not found.');
        send(request, response, 200, await readFile(target), type); return true;
      }
      if (route !== '/overlay/data' && route !== '/overlay/events') throw fail(404, 'Not found.');
      if (closed || serverClosed) throw fail(503, 'The picker is stopping.');
      const scope = options(new URL(request.url, 'http://localhost').searchParams), record = credential(request, scope, security);
      if (route === '/overlay/data') {
        const revision = store.getInfo().revision, key = `${revision}:${scope.widget}:${scope.player}:${scope.goals ?? ''}`;
        if (!payloads.has(key)) {
          let state = store.getCalculationState?.() ?? store.getState();
          if (scope.widget === 'goals' && scope.goals !== 'personal') state = { ...state, groupGoals: savedGroupGoals() };
          if (scope.widget === 'roll' && store.getRecentHistory) state = { ...state, history: store.getRecentHistory(Number.MAX_SAFE_INTEGER) };
          const payload = scope.widget === 'roll' ? await rollPayload(state, scope.player) : overlayPayload({ state, world, ...scope });
          credential(request, scope, security);
          if (closed) throw fail(503, 'The picker is stopping.');
          if (revision !== store.getInfo().revision) throw fail(409, 'Saved state changed. Retry the overlay.');
          if (payloads.size >= 100) payloads.delete(payloads.keys().next().value);
          payloads.set(key, payload);
        }
        json(request, response, 200, payloads.get(key)); return true;
      }
      if (request.method !== 'HEAD' && !admitStream(`overlay:${record.id}`, response)) return true;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', Connection: 'keep-alive' });
      if (request.method === 'HEAD') { response.end(); return true; }
      response.write(`event: revision\ndata: ${JSON.stringify({ revision: store.getInfo().revision })}\n\n`);
      const client = { id: record.id, response };
      clients.add(client);
      client.heartbeat = setInterval(() => { if (!response.write(': heartbeat\n\n')) stop(client, true); }, 20000);
      client.heartbeat.unref();
      response.once('close', () => { clearInterval(client.heartbeat); clients.delete(client); });
      return true;
    },
    async close() { closed = true; unsubscribe(); payloads.clear(); rollResults.clear(); rollLookups.clear(); for (const client of clients) stop(client); await queue; },
  };
}
