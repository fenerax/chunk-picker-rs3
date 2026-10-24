// Pure evidence collector. Raw identity keys stay in memory; sink receives sanitized NDJSON.
const ROUTES = new Set(['/api/events', '/overlay/events', '/api/usage', '/api/state',
  '/api/tasks', '/api/command', '/api/diagnostics', '/__measure37_probe']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const TYPES = new Set(['Document', 'Fetch', 'XHR', 'EventSource', 'Ping', 'Other',
  'Script', 'Stylesheet', 'Image', 'Font', 'Media', 'Preflight']);
function route(url, ownedOrigin) {
  try { const u = new URL(url, ownedOrigin), p = u.pathname;
    return { path: ROUTES.has(p) ? p : p.startsWith('/join/') ? '/join/[redacted]' : '[other]', owned: u.origin === ownedOrigin };
  } catch { return { path: '[other]', owned: false }; }
}
export function createLedger({ sink, ownedOrigin, expectedTargets, maxEvents, maxActive = 512,
  maxRecent = 512, maxSessions = 16, maxWrites = 64, maxDocumentsPerSession = 64,
  expectedSseRoutes = ['/api/events', '/overlay/events'], maxExpectedSsePerTarget = 1 }) {
  for (const n of [expectedTargets, maxEvents, maxActive, maxRecent, maxSessions, maxWrites, maxDocumentsPerSession])
    if (!Number.isSafeInteger(n) || n < 1) throw Error('positive bounded counts required');
  if (typeof sink !== 'function') throw Error('persistent NDJSON sink required');
  let validOrigin = false;
  try { validOrigin = typeof ownedOrigin === 'string' && new URL(ownedOrigin).origin === ownedOrigin && /^https?:/.test(ownedOrigin); } catch {}
  if (!validOrigin) throw Error('freeze an exact owned HTTP origin');
  if (!Number.isSafeInteger(maxExpectedSsePerTarget) || maxExpectedSsePerTarget < 0) throw Error('SSE capacity required');
  if (expectedSseRoutes.some(p => !ROUTES.has(p))) throw Error('unknown SSE route contract');
  const sseRoutes = new Set(expectedSseRoutes);
  const sessions = new Map(), targets = new Map(), active = new Map(), latest = new Map();
  const recent = new Map(), writes = new Set(), faults = new Set();
  const counts = { events: 0, requests: 0, responses: 0, finished: 0, failed: 0,
    redirected: 0, bodyConsumed: 0, dropped: 0 };
  let seq = 0, req = 0, doc = 0, lastAt = -Infinity, drainBounds;
  let deadlineMissed = false, onTimeVerifiedAt = null;
  const bad = code => { faults.add(code); };
  function emit(row) {
    if (writes.size >= maxWrites) { counts.dropped++; bad('sink-backpressure'); return; }
    try {
      // Fixed-schema rows never include caller objects, headers, error text, URLs or raw IDs.
      const result = sink(JSON.stringify({ seq: ++seq, ...row }) + '\n');
      if (result === false) bad('sink-backpressure');
      if (result?.then) {
        const p = Promise.resolve(result).then(value => { if (value === false) bad('sink-backpressure'); })
          .catch(() => bad('sink-failed')).finally(() => writes.delete(p));
        writes.add(p);
      }
    } catch { bad('sink-failed'); }
  }
  function remember(key, r) {
    recent.set(r.id, r);
    if (recent.size > maxRecent) { recent.delete(recent.keys().next().value); bad('recent-history-overflow'); }
  }
  function finish(r, state, at) {
    active.delete(r.id); if (latest.get(r.key) === r.id) latest.delete(r.key);
    remember(r.key, r); r.terminal = state;
    emit({ event: state, at, target: r.target, session: r.session, request: r.id,
      document: r.document, hop: r.hop });
  }
  function ingest(e) {
    counts.events++;
    const counters = { request: 'requests', response: 'responses', finished: 'finished', failed: 'failed', bodyConsumed: 'bodyConsumed' };
    const rawCounter = Object.hasOwn(counters, e.event) ? counters[e.event] : null;
    if (rawCounter) counts[rawCounter]++;
    if (e.event === 'request' && e.redirect === true) counts.redirected++;
    if (counts.events > maxEvents) { counts.dropped++; bad('event-cap'); return; }
    if (!Number.isFinite(e.at) || e.at < lastAt) { bad('invalid-time-order'); return; }
    lastAt = e.at;
    // Callers supply opaque identity aliases. Export our local aliases instead of echoing them.
    if (![e.target, e.session].every(x => typeof x === 'string' && x.length <= 256)) { bad('identity-missing'); return; }
    const sk = JSON.stringify([e.target, e.session]);
    let s = sessions.get(sk);
    if (e.event === 'attach') {
      if (s) { bad('duplicate-attach'); return; }
      if (sessions.size >= maxSessions || (!targets.has(e.target) && targets.size >= expectedTargets)) {
        counts.dropped++; bad('session-cap'); return;
      }
      if (!targets.has(e.target)) targets.set(e.target, `t${targets.size + 1}`);
      s = { id: `s${sessions.size + 1}`, target: targets.get(e.target), enabled: false, closed: false, documents: new Map() };
      sessions.set(sk, s); emit({ event: 'attach', at: e.at, target: s.target, session: s.id }); return;
    }
    if (!s) { bad('unattached-event'); return; }
    if (e.event === 'enabled') { s.enabled = true; emit({ event: 'enabled', at: e.at, session: s.id }); return; }
    if (e.event === 'close') {
      s.closed = true; bad('coverage-closed');
      for (const r of active.values()) if (r.session === s.id) r.closedUnknown = true;
      emit({ event: 'close-unknown', at: e.at, target: s.target, session: s.id }); return;
    }
    if (!s.enabled || s.closed) bad('coverage-gap');
    if (typeof e.requestId !== 'string' || e.requestId.length > 256) { bad('request-identity-missing'); return; }
    const key = JSON.stringify([sk, e.requestId]);
    let r = active.get(latest.get(key));
    if (e.event === 'request') {
      onTimeVerifiedAt = null; // New work requires a fresh on-time observation, not an earlier quiet snapshot.
      if (typeof e.document !== 'string' || e.document.length > 256) { bad('document-identity-missing'); return; }
      if (!s.documents.has(e.document)) {
        if (s.documents.size >= maxDocumentsPerSession) { counts.dropped++; bad('document-cap'); return; }
        s.documents.set(e.document, `d${++doc}`);
      }
      const validRedirect = e.redirect === true && Number.isInteger(e.redirectStatus) && e.redirectStatus >= 300 && e.redirectStatus < 400;
      if (e.redirect === true && !validRedirect) bad('invalid-redirect-evidence');
      let hop = 0, redirectFrom = null;
      if (r) {
        if (validRedirect) {
          hop = r.hop + 1; redirectFrom = r.id; finish(r, 'redirected', e.at);
        } else { bad('ambiguous-active-id-reuse'); r.ambiguous = true; }
      } else if (e.redirect === true) bad('orphan-redirect');
      else if ([...recent.values()].some(x => x.key === key)) bad('ambiguous-terminal-id-reuse');
      if (active.size >= maxActive) { counts.dropped++; bad('active-cap'); return; }
      r = { id: `r${++req}`, key, target: s.target, session: s.id, document: s.documents.get(e.document),
        hop, ...route(e.url, ownedOrigin), method: METHODS.has(e.method) ? e.method : '[other]',
        type: TYPES.has(e.type) ? e.type : '[other]', initiatedAt: e.at, headersAt: null,
        sse: false, closedUnknown: false };
      active.set(r.id, r); latest.set(key, r.id);
      emit({ event: 'request', at: e.at, request: r.id, target: r.target, session: r.session,
        document: r.document, hop, redirectFrom,
        redirectStatus: Number.isInteger(e.redirectStatus) && e.redirectStatus >= 300 && e.redirectStatus < 400 ? e.redirectStatus : null,
        path: r.path, owned: r.owned, method: r.method, type: r.type }); return r.id;
    }
    if (e.event === 'bodyConsumed') {
      // Body-read instrumentation must retain its request alias across terminal/reuse events.
      const body = [...active.values(), ...recent.values()].find(x => x.id === e.requestAlias && x.key === key);
      if (!body || body.bodyConsumed) { bad('unassociated-or-duplicate-body'); return; }
      body.bodyConsumed = true;
      emit({ event: 'body-consumed', at: e.at, request: body.id }); return;
    }
    if (!r) {
      bad([...recent.values()].some(x => x.key === key) ? 'duplicate-or-late-event' : 'orphan-event');
      emit({ event: 'unassociated', at: e.at, session: s.id }); return;
    }
    if (e.event === 'response') {
      if (r.headersAt !== null) bad('duplicate-response');
      if (!Number.isInteger(e.status) || e.status < 100 || e.status > 599) bad('invalid-response-status');
      r.headersAt = e.at;
      const eventStream = typeof e.mime === 'string' && e.mime.split(';')[0].trim().toLowerCase() === 'text/event-stream';
      const type = TYPES.has(e.type) ? e.type : '[other]';
      r.sse = eventStream && r.type === 'EventSource' && type === 'EventSource' && Number.isInteger(e.status) && e.status >= 200 && e.status < 300;
      emit({ event: 'headers', at: e.at, request: r.id, status: Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : null,
        type, mime: eventStream ? 'text/event-stream' : '[other]', sse: r.sse }); return r.id;
    }
    if (e.event === 'finished' || e.event === 'failed') {
      if (e.event === 'finished' && r.headersAt === null) bad('finished-without-response');
      emit({ event: e.event === 'failed' ? 'failure-detail' : 'body-network-complete', at: e.at,
        request: r.id, canceled: e.event === 'failed' ? e.canceled === true : null });
      finish(r, e.event, e.at); return;
    }
    bad('unknown-event');
  }
  function snapshot() {
    const pending = [...active.values()].map(r => ({ request: r.id, target: r.target,
      session: r.session, document: r.document, hop: r.hop, path: r.path, owned: r.owned, method: r.method,
      type: r.type, initiatedAt: r.initiatedAt, headersAt: r.headersAt,
      classification: r.closedUnknown || r.ambiguous ? 'unknown' : r.sse ? 'sse' : 'finite-or-unknown',
      expectedSse: r.sse && r.owned && r.method === 'GET' && sseRoutes.has(r.path) && !r.closedUnknown && !r.ambiguous }));
    const readyTargets = new Set([...sessions.values()].filter(s => s.enabled && !s.closed).map(s => s.target));
    return { counts: { ...counts }, faults: [...faults], pending,
      pendingSse: pending.filter(r => r.classification === 'sse'),
      pendingFiniteOrUnknown: pending.filter(r => r.classification !== 'sse'), pendingWrites: writes.size,
      targets: targets.size, readyTargets: readyTargets.size,
      sessionsReady: [...sessions.values()].filter(s => s.enabled && !s.closed).length };
  }
  function drain({ at, startedAt, budgetMs }) {
    if (![at, startedAt, budgetMs, startedAt + budgetMs].every(Number.isFinite) || budgetMs < 0 || at < startedAt || at < lastAt)
      throw Error('caller must supply valid predeclared monotonic drain bounds');
    if (drainBounds && (drainBounds.startedAt !== startedAt || drainBounds.budgetMs !== budgetMs))
      throw Error('drain budget is frozen on first observation');
    drainBounds ??= { startedAt, budgetMs };
    lastAt = at; // Checkpoint barrier: later-arriving backdated evidence cannot repair a verdict.
    const result = snapshot(), blocking = result.pending.filter(r => !r.expectedSse);
    const sseCounts = new Map();
    for (const r of result.pending.filter(r => r.expectedSse)) {
      const n = (sseCounts.get(r.target) ?? 0) + 1; sseCounts.set(r.target, n);
      if (n > maxExpectedSsePerTarget) blocking.push(r);
    }
    const coverage = result.targets === expectedTargets && result.readyTargets === expectedTargets;
    const deadline = startedAt + budgetMs;
    const currentlyDrained = !result.faults.length && coverage && !blocking.length && !result.pendingWrites;
    if ((at > deadline && onTimeVerifiedAt === null) || (at >= deadline && !currentlyDrained)) deadlineMissed = true;
    if (currentlyDrained && at <= deadline && !deadlineMissed) onTimeVerifiedAt ??= at;
    const status = result.faults.length || !coverage ? 'inconclusive' :
      deadlineMissed ? 'not-drained' : currentlyDrained ? 'drained' : 'waiting';
    return { ...result, status, blocking, at, deadline, deadlineMissed, onTimeVerifiedAt, currentlyDrained };
  }
  return { ingest, snapshot, drain, flush: async () => { await Promise.all([...writes]); return snapshot(); } };
}
