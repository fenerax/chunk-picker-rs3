import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

const definitions = { challenges: { Extra: { Alpha: { Chunks: ['12341'] }, Beta: { Chunks: ['12342'] }, Draft: { Chunks: ['12343'] } } },
  drops: {}, equipment: {}, codeItems: {}, chunks: { '12341': {}, '12342': {}, '12343': {} },
  walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'] };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'engine-cache-routing-'));
  const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
  const keys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE'];
  const original = keys.map(key => process.env[key]);
  process.env.RS3_DISCORD_CLIENT_ID = 'synthetic-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
  const workers = [], replies = [], grants = new Map(), access = new Map();
  const workerFactory = workerData => {
    const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData });
    workers.push(worker); worker.on('message', message => { if (message.id !== undefined) replies.push(message); });
    return worker;
  };
  let app;
  t.after(async () => {
    await app?.close(); await rm(root, { recursive: true, force: true });
    for (const [i, key] of keys.entries()) {
      if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i];
    }
  });
  const provider = { async fetch(url, options) {
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(options.body), grant = grants.get(form.get('code'));
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), grant.challenge);
      const token = 'synthetic-' + form.get('code'); access.set(token, grant.subject);
      return Response.json({ access_token: token });
    }
    assert.equal(url, 'https://discord.com/api/users/@me');
    return Response.json({ id: access.get(options.headers.Authorization.slice(7)) });
  } };
  const origin = 'https://picker.example';
  app = await createServer({ dataDir: path.join(root, 'legacy'), dataset: selectedDataset, definitions, taskMap: {},
    initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]), port: 0, loopbackPort: 0, loopbackRole: 'public',
    publicOrigin: origin, signIn: 'optional', signInProvider: provider, predictionPrewarm: false,
    taskWorkerOptions: { workerFactory }, multiPicker: { registryDir: path.join(root, 'registry'),
      pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'), maxCalculators: 1 } });
  await app.listen();
  function send(route, cookie, { body } = {}) {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request(`http://127.0.0.1:${app.loopbackAddress().port}` + route, { agent: false,
        method: body === undefined ? 'GET' : 'POST', headers: { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7',
          'X-Forwarded-Proto': 'https', Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
          ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) }) } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) });
        });
      });
      request.on('error', reject); request.end(bytes);
    });
  }
  async function login(subject) {
    const start = await send('/auth/discord'); assert.equal(start.status, 303, start.text);
    const auth = new URL(start.headers.location), code = String(grants.size + 1);
    grants.set(code, { subject, challenge: auth.searchParams.get('code_challenge') });
    const response = await send(`/auth/discord/callback?state=${auth.searchParams.get('state')}&code=${code}`,
      start.headers['set-cookie'][0].split(';')[0]);
    assert.equal(response.status, 303, response.text);
    return response.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  return { send, login, workers, replies };
}

// The router, per-picker scheduler scopes and one real calculator all remain
// enabled. Identical member IDs/revisions/drafts must preserve each map's proof.
test('multiPicker isolates shared snapshot and eligibility results through one real calculator', { timeout: 30000 }, async t => {
  const f = await fixture(t), cookies = [await f.login('101'), await f.login('102')];
  for (const [index, cookie] of cookies.entries()) {
    const response = await f.send('/api/state', cookie);
    const member = response.json().state.members[0];
    assert.equal(member.id, 'owner');
    const changed = await f.send('/api/command', cookie, { body: { expectedRevision: 0,
      command: { type: 'set-chunk', memberId: 'owner', chunkId: index ? '12342' : '12341', status: 'unlocked' } } });
    assert.equal(changed.status, 200, changed.text);
  }
  const expected = [];
  for (const [index, cookie] of cookies.entries()) {
    const response = await f.send('/api/tasks?memberId=owner', cookie);
    assert.equal(response.status, 200, response.text);
    const tasks = response.json().tasks;
    assert.equal(tasks.find(row => row.label === (index ? 'Beta' : 'Alpha')).status, 'available');
    assert.equal(tasks.find(row => row.label === (index ? 'Alpha' : 'Beta')).status, 'blocked');
    expected.push(tasks);
  }
  const draft = { memberId: 'owner', baseRevision: 1, changes: { unlockChunks: ['12343'] } };
  const sandbox = [];
  for (const cookie of cookies) {
    const response = await f.send('/api/sandbox/evaluate', cookie, { body: draft });
    assert.equal(response.status, 200, response.text);
    sandbox.push(response.json().result);
  }
  assert.notDeepEqual(...expected);
  assert.notDeepEqual(...sandbox);
  for (const [index, cookie] of cookies.entries()) {
    const tasks = await f.send('/api/tasks?memberId=owner', cookie);
    assert.deepEqual(tasks.json().tasks, expected[index]);
    // A new preview key bypasses the scheduler result cache while retaining
    // the same hypothetical state inside the calculator.
    const response = await f.send('/api/sandbox/evaluate', cookie, { body: { ...draft, previewChunkId: '12343' } });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json().cache.hypotheticalHit, true, 'each picker reuses its own hypothetical snapshot');
    assert.deepEqual(response.json().result, sandbox[index]);
  }
  assert.equal(f.workers.length, 1, 'both routed pickers share the globally capped calculator');
  assert.ok(f.replies.some(reply => (reply.resultCache ?? reply.result?.cache)?.hypotheticalHit), 'sandbox repeat reaches the worker snapshot cache');
});
