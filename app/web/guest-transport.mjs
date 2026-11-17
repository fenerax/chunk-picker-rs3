import { createGuestSave } from './guest-save.mjs';

// The picker sees its usual read/command contract. Only this adapter owns the
// portable browser save; it never uses authenticated routes or a command outbox.
export async function createGuestTransport({ fetch: network = globalThis.fetch.bind(globalThis), storage = localStorage,
  tabStorage = sessionStorage, locks = navigator.locks, changed = () => {} } = {}) {
  const post = async (route, body, token, signal) => {
    const response = await network(route, { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Guest-Token': token } : {}) },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message), { status: response.status,
      retryAfterMs: Number(response.headers.get('Retry-After') ?? 0) * 1000 });
    return value;
  };
  let previousToken;
  try { previousToken = tabStorage.getItem('rs3:guest-admission'); } catch { /* Admission can be reopened. */ }
  const session = await post('/guest/api/session', {}, previousToken);
  try { tabStorage.setItem('rs3:guest-admission', session.token); } catch { /* Browser save has its own error path. */ }
  const save = createGuestSave(storage, session.dataset);
  let backup = save.load(), queue = Promise.resolve(), taskRead, stale = false;
  const check = () => { if (stale || save.changed()) throw Object.assign(new Error('This save changed in another tab. Reload before making another change.'), { status: 409 }); };
  const run = (operation, extra = {}, signal) => {
    const work = queue.then(() => {
      if (signal?.aborted) throw new DOMException('Request abandoned.', 'AbortError');
      check();
      return post('/guest/api/run', { operation, ...(backup ? { backup } : {}), ...extra }, session.token, signal);
    });
    queue = work.catch(() => {}); return work;
  };
  async function commit(value) {
    if (!locks) throw new Error('This browser cannot safely save guest progress across tabs. Use a current browser with Web Locks support.');
    await locks.request(save.key, () => { check(); save.commit(value); });
    backup = value; taskRead = undefined;
  }
  const loaded = await run(backup ? 'load' : 'new');
  if (!backup) await commit(loaded.backup);
  const bootstrap = loaded.bootstrap;
  let pool = loaded.pool;
  let coordination = loaded.coordination;
  const envelope = () => ({ state: backup.state, pools: { [backup.state.members[0].id]: pool } });
  const tasks = signal => {
    const revision = backup.state.revision;
    if (taskRead?.revision === revision) return taskRead.promise;
    const entry = { revision, promise: run('tasks', {}, signal).then(value => value.result) };
    taskRead = entry;
    entry.promise.catch(() => { if (taskRead === entry) taskRead = undefined; });
    return entry.promise;
  };
  const unavailable = () => { throw Object.assign(new Error('Sign in to use this account feature. Guest saves stay only in this browser.'), { status: 404 }); };
  async function api(path, body, signal) {
    const url = new URL(path, 'http://localhost'), route = url.pathname, query = url.searchParams;
    if (route === '/api/session') return { kind: 'guest', memberId: backup.state.members[0].id, admin: false, adminAvailable: false, readOnly: false, canWrite: true, capabilities: { canWrite: true }, signIn: { mode: 'off' } };
    if (route === '/api/state') return envelope();
    if (route === '/api/definitions') return bootstrap.definitions;
    if (route === '/api/display-world') return bootstrap.world;
    if (route === '/api/rules') return bootstrap.rules;
    if (route === '/api/members-start') return { data: bootstrap.membersStartBanks };
    if (route === '/api/art-status') return (await network('/guest/art-status.json', { credentials: 'omit', cache: 'no-store', signal })).json();
    if (route === '/api/coordination') return coordination;
    if (route.startsWith('/api/history/')) return { stateRevision: backup.state.revision, event: backup.state.history.find(event => event.revision === Number(route.split('/').at(-1))) };
    if (route === '/api/tasks') return tasks(signal);
    if (route === '/api/task-how') return (await run('how', { taskId: query.get('taskId') }, signal)).how;
    if (route === '/api/task-why') return (await run('why', { taskId: query.get('taskId') }, signal)).why;
    if (route === '/api/chunk-sections') return (await run('chunk-sections', { chunkId: query.get('chunk') }, signal)).sections;
    if (route === '/api/chunk-planning') return (await run('chunk-planning', { chunkId: query.get('chunkId') }, signal)).planning;
    if (route === '/api/predict') return (await run('predict', { chunkId: query.get('chunkId') }, signal)).prediction;
    if (route === '/api/teleports') return (await run('teleports', {}, signal)).teleports;
    if (route === '/api/profile/preview') return (await run('profile-preview', { profile: body.profile }, signal)).profile;
    if (route === '/api/command') {
      check();
      if (body.expectedRevision !== undefined && body.expectedRevision !== backup.state.revision) throw Object.assign(new Error('Your browser save changed. Review the change again.'), { status: 409 });
      const result = await run('command', { command: body.command }, signal);
      await commit(result.backup); pool = result.pool; coordination = result.coordination;
      return envelope();
    }
    if (route === '/api/game-plugin') return { active: false };
    if (route === '/api/prediction-intent' || route === '/api/pool-ranking-intent') return { accepted: false };
    if (route === '/api/changelog') return { entries: [] };
    if (route === '/api/roadmap') return { items: [] };
    return unavailable();
  }
  const transportFetch = async (path, options = {}) => {
    if (String(path).startsWith('/api/')) {
      try { return Response.json(await api(path, options.body ? JSON.parse(options.body) : undefined, options.signal)); }
      catch (error) { if (error.name === 'AbortError') throw error; return Response.json({ message: error.message }, { status: error.status ?? 422 }); }
    }
    const target = String(path).startsWith('/') && !String(path).startsWith('/guest/') ? `/guest${path}` : path;
    return network(target, { ...options, credentials: 'omit', cache: 'no-store' });
  };
  const commandClient = { pending: () => null, paused: () => false, connectionMessage: () => null, confirm: async () => {}, stop() {},
    async send(body, { signal } = {}) { return { response: new Response(), value: await api('/api/command', body, signal) }; } };
  return { api, fetch: transportFetch, commandClient, save,
    get backup() { return backup; },
    markStale() { stale = true; changed(); },
    async importText(text) { check(); const incoming = save.parseImport(text); const result = await run('load', { backup: incoming }); await commit(result.backup); pool = result.pool; coordination = result.coordination; return envelope(); },
  };
}
