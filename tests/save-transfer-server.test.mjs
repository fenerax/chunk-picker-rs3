import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Isolate these fixtures from the CI/operator dataset selection.
process.env.RS3_DATASET = 'open-starter';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { createServer } = await import('../app/server.mjs');
const { exportBackup, createGroupState } = await import('../app/core/state.mjs');
const { createTaskFactsIndex } = await import('../app/core/progress-index.mjs');
const { createRuleRegistry } = await import('../app/core/rules.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');
const origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const definitions = { challenges: {}, chunks: { '100': {}, '116': {} }, walkableChunks: ['100', '116'], walkableChunksF2P: ['100', '116'] };
function request(base, route, { body, headers = {}, method = body === undefined ? 'GET' : 'POST', stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + route, { method, agent: false, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), Origin: origin }), ...headers,
    } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      const result = () => ({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString(),
        json: () => JSON.parse(Buffer.concat(chunks).toString()), res, req, chunks });
      if (stream) { resolve(result()); return; }
      res.on('end', () => resolve(result()));
    });
    req.on('error', reject); req.end(bytes);
  });
}
async function fixture(t, { initiallyEnabled = true, beforeCommit, ...limits } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'save-transfer-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const envKeys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
  const env = envKeys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  process.env.RS3_GOOGLE_CLIENT_ID = 'synthetic-google-client'; process.env.RS3_GOOGLE_CLIENT_SECRET_FILE = secret;
  const grants = new Map(), access = new Map(); let codeId = 0;
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token') || url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.ok(grant); assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), grant.challenge);
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      if (grant.name === 'google') {
        const claims = { iss: 'https://accounts.google.com', aud: 'synthetic-google-client', sub: grant.subject,
          nonce: grant.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        return Response.json({ id_token: [encode({ alg: 'RS256' }), encode(claims), encode('synthetic-signature')].join('.') });
      }
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'),
    // Linking starts share the sign-in budget; these flows sign in and link many times.
    registrationsPerAccount: 20, registrationsGlobal: 40, ...limits };
  let app, handler;
  const start = async (multi) => {
    app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
      port: 0, loopbackPort: 0, loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', signInProvider: provider,
      onRequestHandler: value => { handler = value; }, beforeCommit, now: () => Date.parse('2026-10-21T12:00:00.000Z'), multiPicker: multi, predictionPrewarm: false, shutdownDeadlineMs: 500,
      rateLimits: { unauthenticated: 10000, expensivePerIdentity: 10000 } });
    await app.listen();
  };
  await start(initiallyEnabled ? multiPicker : undefined);
  const base = () => `http://127.0.0.1:${app.loopbackAddress().port}`;
  const send = (route, cookie, options = {}) => request(base(), route, { ...options, headers: { ...proxy, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  async function begin(subject, cookie, route = '/auth/discord') {
    const response = await send(route, cookie); assert.equal(response.status, 303);
    const auth = new URL(response.headers.location), code = String(++codeId);
    const name = route.endsWith('/google') ? 'google' : 'discord';
    grants.set(code, { subject, name, nonce: auth.searchParams.get('nonce'), challenge: auth.searchParams.get('code_challenge') });
    return () => send(`/auth/${name}/callback?state=${auth.searchParams.get('state')}&code=${code}`, [response.headers['set-cookie'][0].split(';')[0], ...(cookie ?? '').split(';').filter(part => part.trim() && !part.trim().startsWith('__Host-rs3_preauth='))].join('; '));
  }
  async function login(subject, cookie, route) {
    const response = await (await begin(subject, cookie, route))(); assert.equal(response.status, 303, response.text);
    return response.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  const registry = async () => JSON.parse(await readFile(path.join(multiPicker.registryDir, 'registry.json')));
  const picker = async subject => { const doc = await registry(); return doc.accounts.find(a => a.identities.some(i => i.subject === subject)).defaultPickerId; };
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of envKeys.entries()) {
      if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i];
    }
  });
  return { root, send, login, begin, picker, registry, multiPicker, handler: () => handler,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async edit => { await app.close(); await edit?.(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '100', note: text }, expectedRevision: revision, ...extra } }),
  };
}

test('public signed-in player exports and imports identical gameplay into a fresh owned picker', async t => {
  const f = await fixture(t), a = await f.login(String(1101)), b = await f.login(String(1102));
  assert.equal((await f.note(a, 'Synthetic journal cell', 0)).status, 200);
  const backupResponse = await f.send('/api/backup', a); assert.equal(backupResponse.status, 200);
  const backup = backupResponse.json();
  assert.equal(backup.transfer.dataset.coordinateSystem, selectedDataset.coordinateSystem);
  assert.ok(backup.transfer.coverage.excluded.length);
  const previewResponse = await f.send('/api/restore/preview', b, { body: { backup } });
  assert.equal(previewResponse.status, 200, previewResponse.text); const preview = previewResponse.json();
  assert.equal((await f.send('/api/restore', b, { body: { backup, expectedRevision: 0 } })).status, 409);
  const applied = await f.send('/api/restore', b, { body: { backup, expectedRevision: 0, previewToken: preview.previewToken } });
  assert.equal(applied.status, 200, applied.text);
  const after = (await f.send('/api/backup', b)).json();
  assert.deepEqual(after.state.members, backup.state.members);
  assert.deepEqual(after.state.rules, backup.state.rules);
  assert.deepEqual(after.state.tasks, backup.state.tasks);
  assert.equal(after.state.history.length, 1); assert.equal(after.state.history[0].type, 'restore');
  assert.deepEqual(after.state.provenance.restore.incomingHistory, backup.state.history);
  assert.equal(applied.json().transferReport.counts.dropped, 0);
  assert.equal((await f.send('/api/backups', b)).json().backups.length, 1);
  await f.restart();
  assert.equal((await f.send('/api/backup', b)).json().state.members[0].notes['100'], 'Synthetic journal cell');
});

test('public group transfer requires explicit roster mapping, keeps both maps, and reloads safely', async t => {
  const f = await fixture(t), cookie = await f.login(String(1201));
  const state = createGroupState([{ id: 'first', name: 'Player 1', unlocked: ['100'] }, { id: 'second', name: 'Player 2', unlocked: ['116'] }]);
  state.members[0].journal = 'first stays literal';
  state.provenance = { dataset: { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest } };
  const backup = exportBackup(state);
  const unmapped = await f.send('/api/restore/preview', cookie, { body: { backup } });
  assert.equal(unmapped.status, 200, unmapped.text); assert.equal(unmapped.json().mappingRequired, true);
  const rosterMapping = { first: 'owner', second: 'partner' };
  const preview = await f.send('/api/restore/preview', cookie, { body: { backup, rosterMapping } });
  assert.equal(preview.status, 200, preview.text);
  const changed = await f.send('/api/restore', cookie, { body: { backup, rosterMapping: { first: 'partner', second: 'owner' }, expectedRevision: 0, previewToken: preview.json().previewToken } });
  assert.equal(changed.status, 409, changed.text);
  const applied = await f.send('/api/restore', cookie, { body: { backup, rosterMapping, expectedRevision: 0, previewToken: preview.json().previewToken } });
  assert.equal(applied.status, 200, applied.text);
  const after = (await f.send('/api/backup', cookie)).json().state;
  assert.deepEqual(after.members.map(m => [m.id, m.unlocked]), [['owner', ['100']], ['partner', ['116']]]);
  assert.equal(after.members[0].journal, 'first stays literal');
  await f.restart();
  assert.deepEqual((await f.send('/api/backup', cookie)).json().state.members, after.members);
  const registry = await f.registry();
  const picker = registry.pickers.find(p => p.id === registry.accounts[0].defaultPickerId);
  assert.deepEqual(picker.memberIds, ['owner', 'partner']);
  assert.equal(registry.accounts[0].memberships.length, 1);
  // Retained pre-import saves remain usable after the roster grows.
  const previous = (await f.send('/api/backups', cookie)).json().backups[0];
  const restoreBody = { backupId: previous.id, rosterMapping: { owner: 'owner' } };
  const revertPreview = await f.send('/api/restore/preview', cookie, { body: restoreBody });
  assert.equal(revertPreview.status, 200, revertPreview.text);
  const reverted = await f.send('/api/restore', cookie, { body: { ...restoreBody, expectedRevision: 1, previewToken: revertPreview.json().previewToken } });
  assert.equal(reverted.status, 200, reverted.text);
  await f.restart();
  assert.deepEqual((await f.send('/api/backup', cookie)).json().state.members.map(m => m.id), ['owner']);
});

test('dataset and cross-picker mismatches refuse preview and apply without changing gameplay', async t => {
  const f = await fixture(t), a = await f.login(String(1301)), b = await f.login(String(1302));
  const backup = (await f.send('/api/backup', a)).json();
  for (const field of ['id', 'contractVersion', 'digest']) {
    const wrong = structuredClone(backup); wrong.state.provenance.dataset[field] = 'different';
    const response = await f.send('/api/restore/preview', b, { body: { backup: wrong } });
    assert.equal(response.status, 422, response.text); assert.match(response.json().message, /Dataset mismatch/);
  }
  const wrong = structuredClone(backup); wrong.transfer.dataset.coordinateSystem = 'different';
  assert.equal((await f.send('/api/restore/preview', b, { body: { backup: wrong } })).status, 422);
  assert.equal((await f.send('/api/restore/preview', a, { body: { backup, pickerId: await f.picker(String(1302)) } })).status, 403);
  assert.equal((await f.send('/api/state', b)).json().state.revision, 0);
  assert.equal((await f.send('/api/invites', b)).status, 403);
  assert.equal((await f.send('/api/export/original-chunks?memberId=owner', b)).status, 422);
});

test('view-only invites cannot export private backups or restore; members restore only their own map', async t => {
  const f = await fixture(t);
  const invite = async properties => {
    const created = await f.private('/api/invites', { body: { label: 'Synthetic invitation', ...properties } });
    assert.equal(created.status, 201, created.text);
    const joined = await f.private(new URL(created.json().link).pathname);
    assert.equal(joined.status, 303, joined.text);
    return joined.headers['set-cookie'][0].split(';')[0];
  };
  const viewer = await invite({ viewer: true });
  for (const route of ['/api/backup', '/api/backup?download=gzip', '/api/backups', '/api/export/original-chunks?memberId=one']) {
    assert.equal((await f.send(route, viewer)).status, 403, route);
  }
  const player = await invite({ memberId: 'one' });
  const backup = (await f.private('/api/backup')).json();
  assert.equal((await f.send('/api/backup', player)).status, 200);
  assert.equal((await f.send('/api/restore/preview', player, { body: { backup } })).status, 403);
  assert.equal((await f.send('/api/member-restore/preview', player, { body: { backup, memberId: 'two' } })).status, 403);
  const response = await f.send('/api/member-restore/preview', player, { body: { backup, memberId: 'one' } });
  assert.equal(response.status, 200, response.text);
  const applied = await f.send('/api/member-restore', player, { body: { backup, memberId: 'one', expectedRevision: 0, previewToken: response.json().previewToken } });
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json().transferReport.counts.dropped, 0);
  assert.equal((await f.send('/api/member-restore/preview', viewer, { body: { backup, memberId: 'one' } })).status, 403);
});

test('changed destination revision invalidates a public transfer preview', async t => {
  const f = await fixture(t), cookie = await f.login(String(1401));
  const backup = (await f.send('/api/backup', cookie)).json();
  const preview = (await f.send('/api/restore/preview', cookie, { body: { backup } })).json();
  assert.equal((await f.note(cookie, 'Synthetic concurrent change', 0)).status, 200);
  const response = await f.send('/api/restore', cookie, { body: { backup, expectedRevision: 1, previewToken: preview.previewToken } });
  assert.equal(response.status, 409, response.text);
  assert.equal((await f.send('/api/backup', cookie)).json().state.members[0].notes['100'], 'Synthetic concurrent change');
});
test('member transfer carries missing task definitions in one undoable restore command', async t => {
  const f = await fixture(t), backup = (await f.private('/api/backup')).json();
  backup.state.tasks.push({ id: 'custom:transfer', label: 'Synthetic task', category: 'Custom', memberIds: ['one'] });
  backup.state.members[0].completedTasks = ['custom:transfer'];
  backup.state.members[0].taskStatus = { 'custom:transfer': { backlogged: true, backlogReason: '' } };
  const body = { backup, memberId: 'one' };
  const preview = await f.private('/api/member-restore/preview', { body });
  assert.equal(preview.status, 200, preview.text);
  const applied = await f.private('/api/member-restore', { body: { ...body, expectedRevision: 0, previewToken: preview.json().previewToken } });
  assert.equal(applied.status, 200, applied.text);
  const after = (await f.private('/api/backup')).json().state;
  assert.deepEqual(after.members[0].completedTasks, ['custom:transfer']);
  assert.ok(after.tasks.some(task => task.id === 'custom:transfer'));
  assert.equal(after.members[0].taskStatus['custom:transfer'].backlogReason, '');
  const undo = await f.private('/api/command', { body: { command: { type: 'undo' }, expectedRevision: 1 } });
  assert.equal(undo.status, 200, undo.text);
  const restored = (await f.private('/api/backup')).json().state;
  assert.deepEqual(restored.members[0].completedTasks, []);
  assert.ok(!restored.tasks.some(task => task.id === 'custom:transfer'));
});

test('unknown chunks are quarantined, unknown task rules retained, and the report preserves raw records', async t => {
  const f = await fixture(t), cookie = await f.login(String(1501));
  const backup = (await f.send('/api/backup', cookie)).json();
  backup.state.members[0].unlocked = ['999999'];
  backup.state.members[0].taskRules = { UnknownSyntheticRule: true };
  const preview = await f.send('/api/restore/preview', cookie, { body: { backup } });
  assert.equal(preview.status, 200, preview.text);
  assert.ok(preview.json().transferReport.records.some(row => row.key === '999999' && row.rawValue === '999999'));
  assert.ok(preview.json().transferReport.records.some(row => row.key === 'UnknownSyntheticRule'));
  const applied = await f.send('/api/restore', cookie, { body: { backup, expectedRevision: 0, previewToken: preview.json().previewToken } });
  assert.equal(applied.status, 200, applied.text);
  const after = (await f.send('/api/backup', cookie)).json().state;
  assert.deepEqual(after.members[0].unlocked, []);
  assert.equal(after.members[0].taskRules.UnknownSyntheticRule, true);
  assert.equal(after.provenance.restore.incomingProvenance.transferQuarantine.records[0].id, '999999');
  const archivedPreview = await f.send('/api/restore/preview', cookie, { body: { backup: (await f.send('/api/backup', cookie)).json() } });
  assert.equal(archivedPreview.status, 200, archivedPreview.text);
  assert.ok(archivedPreview.json().transferReport.records.some(row => row.key === '999999' && /Previously quarantined/.test(row.reason)));
  assert.equal(applied.json().transferReport.counts.dropped, 0);
});

async function importSyntheticMember(f, backup, memberId, revision) {
  const body = { backup, memberId };
  const preview = await f.private('/api/member-restore/preview', { body });
  assert.equal(preview.status, 200, preview.text);
  const applied = await f.private('/api/member-restore', { body: { ...body, expectedRevision: revision, previewToken: preview.json().previewToken } });
  assert.equal(applied.status, 200, applied.text);
  return preview.json().preview;
}
const assertCounted = (state, memberId, taskId) => {
  const facts = createTaskFactsIndex(state, memberId, createRuleRegistry()).get(taskId);
  assert.equal(facts.actual, true);
  assert.ok(facts.completedBy.includes(memberId));
};

test('two member imports from a shared custom task count both completions and undo the assignment', async t => {
  const f = await fixture(t), backup = (await f.private('/api/backup')).json();
  const task = { id: 'custom:synthetic-shared', label: 'Synthetic shared task', category: 'Custom', memberIds: ['one', 'two'] };
  backup.state.tasks.push(task);
  for (const member of backup.state.members) member.completedTasks = [task.id];
  await importSyntheticMember(f, backup, 'one', 0);
  const preview = await importSyntheticMember(f, backup, 'two', 1);
  assert.deepEqual(preview.tasks.changed[0].after.memberIds, ['one', 'two']);
  let state = (await f.private('/api/backup')).json().state;
  assert.deepEqual(state.tasks.find(row => row.id === task.id).memberIds, ['one', 'two']);
  for (const memberId of ['one', 'two']) assertCounted(state, memberId, task.id);
  const undo = await f.private('/api/command', { body: { command: { type: 'undo' }, expectedRevision: 2 } });
  assert.equal(undo.status, 200, undo.text);
  state = (await f.private('/api/backup')).json().state;
  assert.deepEqual(state.tasks.find(row => row.id === task.id).memberIds, ['one']);
  assert.deepEqual(state.members[1].completedTasks, []);
  assertCounted(state, 'one', task.id);
});

test('member import extends an otherwise matching task assigned only to another destination member', async t => {
  const f = await fixture(t), backup = (await f.private('/api/backup')).json();
  const task = { id: 'custom:synthetic-assigned', label: 'Synthetic assigned task', category: 'Custom' };
  const added = await f.private('/api/command', { body: { command: { type: 'add-task', task: { ...task, memberIds: ['two'] } }, expectedRevision: 0 } });
  assert.equal(added.status, 200, added.text);
  backup.state.tasks.push({ ...task, memberIds: ['one'] });
  backup.state.members[0].completedTasks = [task.id];
  const preview = await importSyntheticMember(f, backup, 'one', 1);
  assert.deepEqual(preview.tasks.changed[0].after.memberIds, ['two', 'one']);
  let state = (await f.private('/api/backup')).json().state;
  assert.deepEqual(state.tasks.find(row => row.id === task.id).memberIds, ['two', 'one']);
  assertCounted(state, 'one', task.id);
  const undo = await f.private('/api/command', { body: { command: { type: 'undo' }, expectedRevision: 2 } });
  assert.equal(undo.status, 200, undo.text);
  state = (await f.private('/api/backup')).json().state;
  assert.deepEqual(state.tasks.find(row => row.id === task.id).memberIds, ['two']);
  assert.deepEqual(state.members[0].completedTasks, []);
});

test('member import rejects a conflicting task definition in preview and apply without stranding progress', async t => {
  const f = await fixture(t), backup = (await f.private('/api/backup')).json();
  const task = { id: 'custom:synthetic-conflict', label: 'Synthetic destination task', category: 'Custom', memberIds: ['two'] };
  assert.equal((await f.private('/api/command', { body: { command: { type: 'add-task', task }, expectedRevision: 0 } })).status, 200);
  backup.state.tasks.push({ ...task, label: 'Synthetic different task', memberIds: ['one'] });
  backup.state.members[0].completedTasks = [task.id];
  const before = (await f.private('/api/backup')).json().state;
  for (const route of ['/api/member-restore/preview', '/api/member-restore']) {
    const response = await f.private(route, { body: { backup, memberId: 'one', expectedRevision: 1 } });
    assert.equal(response.status, 422, response.text);
    assert.match(response.json().message, /different destination definition/);
  }
  assert.deepEqual((await f.private('/api/backup')).json().state, before);
});
