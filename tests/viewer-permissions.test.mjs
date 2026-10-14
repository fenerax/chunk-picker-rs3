import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer, routePermissions, commandPermissions, apiPermission, redactInviteTokens, serverReadyMessage, gzipSavedTaskResult } from '../app/server.mjs';
import { openInviteStore } from '../app/storage/invites.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { prepareGameStorage } from '../app/game-profile.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

const root = fileURLToPath(new URL('../.local/viewer-permissions-tests/', import.meta.url));
const definitions = {
  chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Quest: { Present: { Chunks: ['12341'] } } },
};
const publicOrigin = 'https://picker.example';
const funnel = { Host: 'picker.example', 'Tailscale-Funnel-Request': '?1', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.9' };
const id = '00000000-0000-0000-0000-000000000000';
const concrete = route => route.replace(':id', id);
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];

function checkRoutes(method, section) {
  const routes = new Set([...section.matchAll(/['"](\/api\/[^'"]+)['"]/g)].map(match => match[1]).filter(route => !route.endsWith('/')));
  for (const route of routes) assert.ok(routePermissions[method][route], `${method} ${route} needs a permission decision`);
  for (const match of section.matchAll(/if\s*\(\s*route\.startsWith\(['"](\/api\/[^'"]+)['"]\)/g)) {
    const template = match[1] + ':id';
    assert.ok(routePermissions[method][template], `${method} ${template} needs a prefix permission decision`);
  }
  for (const match of section.matchAll(/const \w+ = (\/\^.*?\$\/)\.exec\(route\)/g)) {
    const template = match[1].replace(/^\/\^|\$\/$/g, '').replaceAll('\\/', '/').replace('([a-f0-9-]{36})', ':id');
    assert.ok(routePermissions[method][template], `${method} ${template} needs a dynamic permission decision`);
  }
}
function checkDispatchMethods(source) {
  // This audit understands the current GET/HEAD and POST dispatch blocks. A new
  // method or a different dispatch shape must extend the audit before it passes.
  for (const match of source.matchAll(/request\.method\s*===\s*['"]([A-Z]+)['"]/g)) {
    assert.ok(['GET', 'HEAD', 'POST'].includes(match[1]), `${match[1]} dispatch needs route permission coverage`);
  }
  assert.ok([...source.matchAll(/request\.method\s*===\s*['"]POST['"]/g)].length <= 1,
    'additional POST dispatch blocks need route permission coverage');
  assert.doesNotMatch(source, /switch\s*\(\s*request\.method\s*\)/, 'method switches need route permission coverage');
  assert.deepEqual(Object.keys(routePermissions).sort(), ['GET', 'POST'], 'additional method registries need dispatch audit coverage');
}
async function until(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(predicate(), message);
}
async function openEvents(t, f) {
  const events = [], stream = { events, ended: false };
  await new Promise((resolve, reject) => {
    const request = http.request(f.origin + '/api/events', { headers: { ...funnel, Cookie: f.viewerCookie } }, response => {
      assert.equal(response.statusCode, 200);
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += chunk;
        let boundary;
        while ((boundary = text.indexOf('\n\n')) !== -1) {
          const record = text.slice(0, boundary); text = text.slice(boundary + 2);
          const event = /^event: ([^\n]+)/m.exec(record)?.[1], data = /^data: (.+)/m.exec(record)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
        resolve();
      });
      response.on('end', () => { stream.ended = true; }); response.on('error', reject);
    });
    request.on('error', reject); request.end();
    t.after(() => request.destroy());
  });
  return stream;
}

async function dataDirectory(t, cleanup = true) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'fixture-'));
  if (cleanup) t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function fixture(t, options = {}) {
  const dataDir = await dataDirectory(t, false);
  const { feedbackDocument, ...serverOptions } = options;
  if (feedbackDocument) {
    await prepareGameStorage(dataDir, selectedDataset);
    await writeFile(path.join(dataDir, 'feedback.json'), JSON.stringify(feedbackDocument));
  }
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  let application = await createServer({ dataDir, port: 0, definitions, taskMap: {}, initialState, predictionPrewarm: false, publicOrigin, shutdownDeadlineMs: 500, ...serverOptions });
  t.after(async () => {
    try { await application?.close(); }
    finally { application = undefined; await rm(dataDir, { recursive: true, force: true }); }
  });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  function request(route, { cookie, body, method = body === undefined ? 'GET' : 'POST', publicRequest = false, malformed = false, acceptEncoding } = {}) {
    // Native HTTP preserves the simulated Funnel Host. No external proxy is used.
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : malformed ? '{invalid' : JSON.stringify(body);
      const headers = { ...(publicRequest ? funnel : {}), ...(cookie ? { Cookie: cookie } : {}),
        ...(acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding }),
        ...(bytes === undefined ? {} : { 'Content-Type': malformed ? 'text/plain' : 'application/json', 'Content-Length': Buffer.byteLength(bytes), Origin: publicRequest ? publicOrigin : origin }) };
      const request = http.request(origin + route, { method, headers }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
          headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
      });
      request.on('error', reject); request.end(bytes);
    });
  }
  const joinedMaster = await request('/join/' + application.store.getAccessToken());
  assert.equal(joinedMaster.status, 303);
  const masterCookie = cookieFrom(joinedMaster);
  const admin = (route, body) => request(route, { cookie: masterCookie, body });
  const createdResponse = await admin('/api/invites', { label: 'Spectator', viewer: true });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const joinedViewer = await request(new URL(created.link).pathname, { publicRequest: true });
  assert.equal(joinedViewer.status, 303);
  const viewerCookie = cookieFrom(joinedViewer);
  return { application, origin, dataDir, request, admin, masterCookie, created, viewerCookie,
    viewer: (route, body, extra = {}) => request(route, { cookie: viewerCookie, publicRequest: true, body, ...extra }) };
}

test('every dispatched API route and gameplay command has an explicit permission decision', async () => {
  const source = await readFile(new URL('../app/server.mjs', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const server = http.createServer'), source.indexOf('const loopbackServer ='));
  checkDispatchMethods(handler);
  const readStart = handler.indexOf("if (request.method === 'GET' || request.method === 'HEAD')");
  const writeStart = handler.indexOf("} else if (request.method === 'POST')");
  const writeEnd = handler.indexOf('throw httpError(404, \'API route not found.\');', writeStart);
  for (const [method, section] of [['GET', handler.slice(readStart, writeStart)], ['POST', handler.slice(writeStart, writeEnd)]]) {
    checkRoutes(method, section);
    for (const [route, permission] of Object.entries(routePermissions[method])) {
      assert.ok(['read', 'admin', 'write', 'saved-tasks', 'usage'].includes(permission), `${method} ${route} has a recognized permission`);
      if (permission === 'usage') assert.equal(`${method} ${route}`, 'POST /api/usage', 'viewer telemetry has one exact route');
      assert.equal(apiPermission(method, concrete(route)), permission);
    }
  }
  assert.throws(() => checkRoutes('GET', "if (route === '/api/new-read') {}"), /needs a permission decision/);
  assert.throws(() => checkRoutes('GET', "if (route.startsWith('/api/new-prefix/')) {}"), /needs a prefix permission decision/);
  assert.throws(() => checkRoutes('POST', String.raw`const newRoute = /^\/api\/future\/([a-f0-9-]{36})\/write$/.exec(route);`), /needs a dynamic permission decision/);
  assert.throws(() => checkDispatchMethods("if (request.method === 'DELETE') { if (route === '/api/state') {} }"), /dispatch needs route permission coverage/);
  assert.throws(() => checkDispatchMethods('switch (request.method) { case "PUT": break; }'), /method switches need route permission coverage/);
  assert.throws(() => checkDispatchMethods("if (request.method === 'POST') {} if (request.method === 'POST') {}"), /additional POST dispatch blocks need route permission coverage/);
  const stateSource = await readFile(new URL('../app/core/state.mjs', import.meta.url), 'utf8');
  const commands = new Set([...stateSource.matchAll(/case '([^']+)':/g)].map(match => match[1]));
  commands.delete('prune-task-claims');
  assert.equal(Object.hasOwn(commandPermissions, 'prune-task-claims'), false, 'automatic claim cleanup is internal');
  assert.equal(commandPermissions['claim-task'], 'write');
  assert.equal(commandPermissions['clear-task-claim'], 'write');
  assert.deepEqual(Object.keys(commandPermissions).sort(), [...commands].sort(), 'new commands require a reviewed access decision');
});

test('view-only invite persistence rejects privilege combinations and player assignment and reads legacy invites', async t => {
  const dataDir = await dataDirectory(t), masterToken = 'synthetic-master';
  let store = await openInviteStore({ dataDir, masterToken });
  t.after(() => store.close());
  const context = { masterAllowed: false, secure: true };
  for (const input of [{ viewer: true, admin: true }, { viewer: true, memberId: 'actor1' }, { viewer: 'yes' }]) {
    assert.throws(() => store.create({ label: 'Spectator', ...input }), { status: 400 });
  }
  const created = await store.create({ label: 'Spectator', viewer: true, admin: false });
  assert.equal(created.invite.viewer, true); assert.equal(created.invite.admin, false);
  const session = await store.join(created.token, context), request = { headers: { cookie: `duo_access=${session}` } };
  assert.equal(store.authenticate(request, context).readOnly, true);
  assert.equal(store.authenticate(request, context).capabilities.canWrite, false);
  await assert.rejects(store.setMember(created.invite.id, 'reed'), { status: 400 });
  await store.close(); store = await openInviteStore({ dataDir, masterToken });
  assert.equal(store.authenticate(request, context).readOnly, true);
  await store.revoke(created.invite.id);
  assert.equal(store.authenticate(request, context), null);
  assert.equal(await store.join(created.token, context), null);
  const editor = await store.create({ label: 'Legacy', admin: false, memberId: 'reed' });
  const editorSession = await store.join(editor.token, context);
  await store.close();
  const file = path.join(dataDir, 'invites.json'), document = JSON.parse(await readFile(file, 'utf8'));
  delete document.invites.find(invite => invite.id === editor.invite.id).viewer;
  await writeFile(file, JSON.stringify(document));
  store = await openInviteStore({ dataDir, masterToken });
  const legacy = store.authenticate({ headers: { cookie: `duo_access=${editorSession}` } }, context);
  assert.equal(legacy.readOnly, false); assert.equal(legacy.capabilities.canWrite, true); assert.equal(legacy.memberId, 'reed');
  const text = await readFile(file, 'utf8');
  assert.equal(text.includes(created.token), false); assert.equal(text.includes(session), false);
  const redacted = await store.create({ label: '/join/synthetic-secret' });
  assert.equal(redacted.invite.label, '/join/[redacted]');
  assert.equal((await readFile(file, 'utf8')).includes('synthetic-secret'), false);
});

test('view-only Funnel sessions deny gameplay writes and accept only private usage counts', async t => {
  const f = await fixture(t);
  const session = await (await f.viewer('/api/session')).json();
  assert.equal(session.admin, false); assert.equal(session.readOnly, true); assert.equal(session.capabilities.canWrite, false); assert.equal(session.memberId, null);
  const stateBefore = JSON.stringify(f.application.store.getState());
  const invitesBefore = await readFile(path.join(f.dataDir, 'invites.json'), 'utf8');
  const countRoutes = Object.entries(routePermissions.POST).filter(([, permission]) => permission === 'usage');
  assert.deepEqual(countRoutes, [['/api/usage', 'usage']], 'usage is the sole viewer POST exception');
  for (const [route, permission] of Object.entries(routePermissions.POST)) {
    if (permission === 'usage') continue;
    const response = await f.viewer(concrete(route), {}, { malformed: true });
    assert.equal(response.status, 403, `${route} denied before Content-Type / malformed JSON`);
  }
  for (const type of [...Object.keys(commandPermissions), 'future-command']) {
    assert.equal((await f.viewer('/api/command', { expectedRevision: 0, command: { type } })).status, 403, type);
  }
  const memberId = f.application.store.getState().members[0].id;
  assert.equal((await f.viewer('/api/usage', { counts: [{ id: 'dom:more-tools', actor: memberId, device: 'phone',
    day: new Date().toISOString().slice(0, 10), count: 1 }] })).status, 200);
  const usage = JSON.parse(await readFile(path.join(f.dataDir, 'usage.json'), 'utf8'));
  assert.equal(usage.counts.length, 1); assert.equal(usage.counts[0].actor, 'viewer');
  for (const value of [true, false]) {
    assert.equal((await f.viewer('/api/command', { expectedRevision: 0, command: { type: 'set-preference', memberId, preferenceId: 'advanced', value } })).status, 403);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await f.viewer('/api/future-write', {}, { method, malformed: true })).status, 403, method);
  for (const route of ['/', '/future-write', '/main.mjs']) assert.equal((await f.viewer(route, {}, { malformed: true })).status, 403, route);
  for (const [route, permission] of Object.entries(routePermissions.GET)) {
    if (['admin', 'write'].includes(permission)) {
      for (const method of ['GET', 'HEAD']) assert.equal((await f.viewer(concrete(route), undefined, { method })).status, 403, `${method} ${route}`);
    }
  }
  assert.equal(JSON.stringify(f.application.store.getState()), stateBefore);
  assert.equal(await readFile(path.join(f.dataDir, 'invites.json'), 'utf8'), invitesBefore);
  assert.equal((await f.admin('/api/health')).status, 200, 'denied shutdown cannot stop the server');
  for (const body of [{ label: 'Invalid', viewer: true, admin: true }, { label: 'Invalid', viewer: true, memberId: 'reed' }]) assert.equal((await f.admin('/api/invites', body)).status, 400);
  assert.equal((await f.admin(`/api/invites/${f.created.invite.id}/player`, { memberId: 'reed' })).status, 400);
  assert.equal((await f.admin(`/api/invites/${f.created.invite.id}/revoke`, {})).status, 200);
  assert.equal((await f.viewer('/api/state')).status, 401);
  assert.equal((await f.request(new URL(f.created.link).pathname, { publicRequest: true })).status, 401);
});

test('advanced mode writes through the existing preference command for one player and undoes exactly', async t => {
  const f = await fixture(t), before = f.application.store.getState(), [owner, partner] = before.members;
  const command = { type: 'set-preference', memberId: owner.id, preferenceId: 'advanced', value: true };
  for (const value of ['true', 1, null]) {
    const rejected = await f.admin('/api/command', { expectedRevision: before.revision, command: { ...command, value } });
    assert.equal(rejected.status, 400);
  }
  assert.deepEqual(f.application.store.getState(), before);
  const saved = await f.admin('/api/command', { expectedRevision: before.revision, command });
  assert.equal(saved.status, 200);
  const changed = (await saved.json()).state;
  assert.equal(changed.members.find(row => row.id === owner.id).preferences.advanced, true);
  assert.deepEqual(changed.members.find(row => row.id === partner.id), partner);
  assert.equal(changed.history.at(-1).command.preferenceId, 'advanced');
  assert.equal((await f.viewer('/api/command', { expectedRevision: changed.revision, command: { ...command, value: false } })).status, 403);
  const undone = await f.admin('/api/command', { expectedRevision: changed.revision, command: { type: 'undo' } });
  assert.equal(undone.status, 200);
  assert.deepEqual((await undone.json()).state.members, before.members);
});

test('Backlog chunk search reads only the selected player and never submits viewer calculations', async t => {
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  const first = 'rs3:task:backlog-one', second = 'rs3:task:backlog-two';
  initialState.tasks = [{ id: first, label: 'Mine ore', category: 'Mining' }, { id: second, label: 'Chop wood', category: 'Woodcutting' }];
  initialState.members[0].taskStatus = { [first]: { backlogged: true, backlogReason: 'Later' } };
  initialState.members[1].taskStatus = { [second]: { backlogged: true } };
  const f = await fixture(t, { initialState, port: 0, taskWorkerOptions: { idleMs: 100 }, definitions: {
    chunks: { '12341': { Nickname: 'Lumbridge', Sections: { 2: {} } }, '12342': { Nickname: 'Varrock' } },
    walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
    challenges: { Mining: { 'Mine ore': { PickerId: first, Chunks: ['12341-2[+]'] } }, Woodcutting: { 'Chop wood': { PickerId: second, Chunks: ['12342'] } } },
  } });
  const diagnostics = () => f.admin('/api/diagnostics').then(response => response.json());
  const before = await diagnostics(), saved = f.application.store.getState();
  for (const [memberId, id, chunk] of [['actor1', first, '12341-2'], ['reed', second, '12342']]) {
    const response = await f.viewer(`/api/backlog-search?memberId=${memberId}`); assert.equal(response.status, 200);
    const value = await response.json(); assert.equal(value.memberId, memberId); assert.equal(value.stateRevision, saved.revision);
    assert.deepEqual(value.tasks.map(task => task.id), [id]); assert.ok(value.tasks[0].locations.some(location => location.id === chunk));
  }
  assert.equal((await f.viewer('/api/backlog-search?memberId=missing')).status, 400);
  assert.equal((await f.viewer('/api/backlog-search?memberId=actor1', {})).status, 403);
  const deadline = Date.now() + 10000;
  while ((await diagnostics()).worker.status !== 'sleeping' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await f.viewer('/api/backlog-search?memberId=actor1')).status, 200);
  const after = await diagnostics(); assert.equal(after.worker.status, 'sleeping'); assert.deepEqual(after.counts, before.counts);
  assert.deepEqual(f.application.store.getState(), saved, 'search never changes saved tasks, revisions or History');
});

test('view-only requests read completed tasks without submitting work, including after calculator sleep', async t => {
  const f = await fixture(t, { taskWorkerOptions: { idleMs: 100 } });
  const memberId = f.application.store.getState().members[0].id;
  const route = `/api/tasks?memberId=${memberId}`;
  const diagnostics = () => f.admin('/api/diagnostics').then(response => response.json());
  const before = await diagnostics();
  const unavailable = await f.viewer(route);
  assert.equal(unavailable.status, 409); assert.equal((await unavailable.json()).code, 'TASK_RESULTS_UNAVAILABLE');
  assert.equal((await f.viewer('/api/state')).status, 200);
  assert.equal((await diagnostics()).counts.requested, before.counts.requested);
  const calculated = await f.admin(route); assert.equal(calculated.status, 200);
  const expected = await calculated.json();
  // Results are kept just after the player's response, off its critical path.
  let loaded = await f.viewer(route);
  for (const until = Date.now() + 3000; loaded.status === 409 && Date.now() < until;) { await loaded.arrayBuffer(); await new Promise(resolve => setTimeout(resolve, 20)); loaded = await f.viewer(route); }
  assert.equal(loaded.status, 200);
  const actual = await loaded.json();
  const { cache: expectedCache, ...expectedResult } = expected, { cache: actualCache, ...actualResult } = actual;
  assert.deepEqual(actualResult, expectedResult); assert.equal(actualCache.savedResult, true);
  const compact = await f.viewer(route + '&view=play-v1'); assert.equal(compact.status, 200);
  await compact.arrayBuffer();
  const browserStyle = await fetch(f.origin + route, { headers: { Cookie: f.viewerCookie } });
  assert.equal(browserStyle.status, 200); assert.equal(browserStyle.headers.get('content-encoding'), 'gzip');
  assert.equal((await browserStyle.json()).memberId, memberId, 'fetch automatically decodes the complete single gzip stream');
  const secondId = f.application.store.getState().members[1].id, revision = expected.stateRevision;
  const secondCalculated = await f.admin(`/api/tasks?memberId=${secondId}`); assert.equal(secondCalculated.status, 200); await secondCalculated.arrayBuffer();
  await new Promise(resolve => setTimeout(resolve, 200));
  const groupRoute = `/api/tasks?memberId=${secondId}&view=play-v1&lane=duo-v1&peerFor=${memberId}&revision=${revision}`;
  const sidebarRoute = route + `&view=play-v1&projection=duo-sidebar-v1&revision=${revision}`;
  for (const request of [groupRoute, sidebarRoute]) {
    const response = await f.viewer(request); assert.equal(response.status, 200); await response.arrayBuffer();
  }
  for (const [acceptEncoding, encoding, status] of [['br, gzip', 'gzip', 200], ['gzip;q=0, identity', null, 200], ['br, gzip;q=0, identity;q=0', null, 406]]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await f.viewer(route, undefined, { acceptEncoding, method });
      assert.equal(response.status, status, `${method} ${acceptEncoding}`);
      assert.equal(response.headers.get('content-encoding'), encoding);
      if (method === 'GET' && status === 200) {
        const bytes = Buffer.from(await response.arrayBuffer()), value = JSON.parse((encoding ? gunzipSync(bytes) : bytes).toString());
        assert.equal(value.memberId, memberId); assert.equal(value.stateRevision, revision);
      }
    }
  }
  const deadline = Date.now() + 10000;
  while ((await diagnostics()).worker.status !== 'sleeping' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  const asleep = await diagnostics(); assert.equal(asleep.worker.status, 'sleeping');
  for (let index = 0; index < 3; index++) {
    const response = await f.viewer(route); assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal((await f.viewer('/api/state')).status, 200);
  }
  for (const request of [groupRoute, sidebarRoute]) {
    const response = await f.viewer(request); assert.equal(response.status, 200); await response.arrayBuffer();
  }
  const after = await diagnostics();
  assert.equal(after.worker.status, 'sleeping'); assert.deepEqual(after.counts, asleep.counts);
  const state = f.application.store.getState();
  assert.equal((await f.admin('/api/command', { expectedRevision: state.revision, command: { type: 'set-preference', memberId, preferenceId: 'taskSidebar', value: false } })).status, 200);
  const currentRevision = f.application.store.getInfo().revision;
  for (const currentRoute of [route, route + '&view=play-v1', `/api/tasks?memberId=${secondId}`]) {
    const response = await f.viewer(currentRoute); assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-rs3-state-revision'), String(currentRevision), 'display-only edits rebind authoritative revision metadata');
    const value = await response.json();
    assert.equal(value.stateRevision, currentRoute.includes('view=play-v1') ? currentRevision : revision,
      'full bytes remain valid and unchanged; compact results carry the current revision directly');
  }
  const zipped = await f.viewer(route, undefined, { acceptEncoding: 'gzip' }); assert.equal(zipped.status, 200);
  assert.equal(zipped.headers.get('x-rs3-state-revision'), String(currentRevision));
  assert.equal(JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString()).stateRevision, revision);
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(f.origin + route, { method, headers: { Cookie: f.viewerCookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('x-rs3-state-revision'), String(currentRevision));
    if (method === 'GET') {
      const value = await response.json(); assert.equal(value.stateRevision, revision); assert.equal(value.memberId, memberId);
      value.stateRevision = Number(response.headers.get('x-rs3-state-revision'));
      assert.equal(value.stateRevision, currentRevision, 'viewer applies authoritative header without re-encoding unchanged evidence');
    }
  }
  assert.equal((await f.admin('/api/command', { expectedRevision: currentRevision, command: { type: 'set-rule', ruleId: 'access.shared', value: false } })).status, 200);
  assert.equal((await f.viewer(route)).status, 409, 'gameplay changes invalidate existing calculations');
});

test('view-only SSE delivers saves and completed task availability and closes immediately on revocation', async t => {
  const f = await fixture(t), stream = await openEvents(t, f);
  const state = f.application.store.getState(), memberId = state.members[0].id;
  assert.equal((await f.admin('/api/command', { expectedRevision: state.revision,
    command: { type: 'set-preference', memberId, preferenceId: 'taskSidebar', value: false } })).status, 200);
  const revision = f.application.store.getInfo().revision;
  await until(() => stream.events.some(event => event.event === 'revision' && event.data.revision === revision), 'viewer gets current save revision');
  assert.equal((await f.viewer(`/api/tasks?memberId=${memberId}`)).status, 409);
  const response = await f.admin(`/api/tasks?memberId=${memberId}`); assert.equal(response.status, 200); await response.arrayBuffer();
  await until(() => stream.events.some(event => event.event === 'task-ready' && event.data.revision === revision && event.data.memberId === memberId), 'viewer gets task readiness for the committed revision');
  assert.equal((await f.viewer(`/api/tasks?memberId=${memberId}`)).status, 200);
  assert.equal((await f.admin(`/api/invites/${f.created.invite.id}/revoke`, {})).status, 200);
  await until(() => stream.ended, 'revoking viewer closes its open SSE connection');
  assert.equal((await f.viewer('/api/state')).status, 401);
});

test('invitation links in feedback text, context and sender labels are redacted before persistence and display', async t => {
  const f = await fixture(t), secret = 'synthetic-feedback-secret';
  const createdResponse = await f.admin('/api/invites', { label: `/join/${secret}` }); assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json(); assert.equal(created.invite.label, '/join/[redacted]');
  const joined = await f.request(new URL(created.link).pathname, { publicRequest: true }); assert.equal(joined.status, 303);
  const response = await f.request('/api/feedback', { publicRequest: true, cookie: cookieFrom(joined),
    body: { kind: 'bug', text: `Open https://picker.example/join/${secret}`, context: { url: `/join%2f${secret}`, detail: `%2fjoin/${secret}` } } });
  assert.equal(response.status, 201);
  assert.equal(JSON.stringify(await response.json()).includes(secret), false);
  assert.equal((await readFile(path.join(f.dataDir, 'feedback.json'), 'utf8')).includes(secret), false);
  const list = await f.admin('/api/feedback'); assert.equal(list.status, 200); assert.equal((await list.text()).includes(secret), false);
  assert.equal((await readFile(path.join(f.dataDir, 'invites.json'), 'utf8')).includes(secret), false);
});

test('previously stored feedback redacts invitation credentials on listing and status responses', async t => {
  const secret = 'synthetic-legacy-feedback-secret';
  const record = { id, kind: 'bug', text: `Previous link /join/${secret}`, context: { url: `%2fjoin/${secret}` },
    from: { label: `/join%2f${secret}` }, status: 'new', at: '2026-10-08T12:00:00Z' };
  const f = await fixture(t, { feedbackDocument: { schemaVersion: 1, items: [record] } });
  const response = await f.admin('/api/feedback'); assert.equal(response.status, 200);
  const listed = await response.json();
  assert.equal(JSON.stringify(listed).includes(secret), false); assert.equal(listed.total, 1); assert.equal(listed.open, 1);
  assert.equal(listed.items[0].text, 'Previous link /join/[redacted]');
  const marked = await f.admin(`/api/feedback/${id}/status`, { status: 'done' }); assert.equal(marked.status, 200);
  const value = await marked.json();
  assert.equal(JSON.stringify(value).includes(secret), false); assert.equal(value.item.status, 'done');
});

test('join credentials are redacted from error text, including encoded paths', () => {
  const secret = 'synthetic-secret';
  for (const value of [`Missing /join/${secret}`, `Bad https://picker.example/join/${secret}?x=1`, `Unknown %2fjoin%2f${secret}`, `/join%2f${secret}`, `%2fjoin/${secret}`]) {
    const redacted = redactInviteTokens(value);
    assert.equal(redacted.includes(secret), false); assert.match(redacted, /\[redacted\]/);
  }
});

test('CLI startup and error logging never print administrator invitation credentials', async () => {
  const token = 'synthetic-cli-secret', message = serverReadyMessage(`http://127.0.0.1:8788/join/${token}`);
  assert.equal(message.includes(token), false);
  assert.match(message, /http:\/\/127\.0\.0\.1:8788/);
  assert.match(message, /saved private administrator link/);
  const source = await readFile(new URL('../app/server.mjs', import.meta.url), 'utf8');
  const cli = source.slice(source.lastIndexOf('if (process.argv[1]'));
  assert.match(cli, /process\.stdout\.write\(serverReadyMessage\(application\.inviteUrl\)\)/);
  assert.match(cli, /process\.stderr\.write\(`\$\{redactInviteTokens\(error\.message\)\}/);
  assert.equal([...cli.matchAll(/process\.stdout\.write\(/g)].length, 1);
  assert.equal([...cli.matchAll(/process\.stderr\.write\(/g)].length, 1);
});

test('retained full task results compress exact evidence and metadata without parsing the task graph', async () => {
  const evidence = { tasks: [{ id: 'synthetic', record: { evidence: 'repeated-source-evidence '.repeat(200000) } }], activityInfo: { skills: [{ skill: 'Smithing' }] } };
  const bytes = Buffer.from(JSON.stringify(evidence)), compressed = await gzipSavedTaskResult(bytes, 10, 'actor1');
  assert.ok(compressed.length < bytes.length / 20);
  const { stateRevision, memberId, cache, ...result } = JSON.parse(gunzipSync(compressed).toString());
  assert.deepEqual(result, evidence); assert.equal(stateRevision, 10); assert.equal(memberId, 'actor1'); assert.equal(cache.savedResult, true);
});
