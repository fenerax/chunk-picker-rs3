import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A real process exits from the OAuth callback while holding the registry and
// legacy writer locks. A new process must recover through OAuth and HTTP again.
const program = String.raw`
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const [root, mode, point] = process.argv.slice(1);
process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const secret = path.join(root, 'secret'); await writeFile(secret, 'synthetic-secret');
process.env.RS3_DISCORD_CLIENT_ID = 'synthetic'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = secret;
const { createServer } = await import('./app/server.mjs');
const { createGroupState } = await import('./app/core/state.mjs');
const origin = 'https://picker.example';
const headers = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
let armed = false;
const app = await createServer({ dataDir: path.join(root, 'legacy'), port: 0, loopbackPort: 0,
  loopbackRole: 'public', publicOrigin: origin, signIn: 'optional', predictionPrewarm: false,
  definitions: { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] }, taskMap: {},
  initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
  signInProvider: { fetch: async url => url.endsWith('/oauth2/token') ? Response.json({ access_token: 'synthetic' }) : Response.json({ id: '101' }) },
  multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'),
    crashPoint: name => { if (mode === 'crash' && armed && name === point) process.exit(86); } },
});
await app.listen(); armed = true;
const base = 'http://127.0.0.1:' + app.loopbackAddress().port;
const get = (route, cookie) => new Promise((resolve, reject) => {
  const request = http.get(base + route, { agent: false, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, response => {
    const parts = []; response.on('data', part => parts.push(part)); response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode, json: () => JSON.parse(Buffer.concat(parts)),
      headers: { get: name => response.headers[name], getSetCookie: () => response.headers['set-cookie'] ?? [] } }));
  }); request.on('error', reject);
});
try {
  const start = await get('/auth/discord'); assert.equal(start.status, 303);
  const url = new URL(start.headers.get('location')), pending = start.headers.getSetCookie()[0].split(';')[0];
  const callback = await get('/auth/discord/callback?state=' + url.searchParams.get('state') + '&code=synthetic', pending);
  assert.equal(mode, 'recover', 'The crash callback must terminate its process'); assert.equal(callback.status, 303);
  const cookie = callback.headers.getSetCookie().find(value => value.startsWith('duo_access=')).split(';')[0];
  const response = await get('/api/state', cookie); assert.equal(response.status, 200);
  const { state } = await response.json();
  assert.equal(state.revision, 0); assert.deepEqual(state.members.map(m => m.id), ['owner']);
  assert.deepEqual(state.members[0].unlocked, []); assert.deepEqual(state.members[0].completedTasks, []); assert.deepEqual(state.tasks, []);
  const registry = JSON.parse(await readFile(path.join(root, 'registry', 'registry.json')));
  assert.equal(registry.accounts.length, 1); assert.equal(registry.pickers.length, 2);
  assert.equal(registry.pickers.filter(p => p.kind === 'default').length, 1);
  assert.equal(registry.pickers.find(p => p.kind === 'legacy-shared').ownerAccountId, null);
  const secondStart = await get('/auth/discord');
  const secondURL = new URL(secondStart.headers.get('location'));
  const second = await get('/auth/discord/callback?state=' + secondURL.searchParams.get('state') + '&code=synthetic', secondStart.headers.getSetCookie()[0].split(';')[0]);
  assert.equal(second.status, 303);
  const after = JSON.parse(await readFile(path.join(root, 'registry', 'registry.json')));
  assert.equal(after.accounts.length, 1); assert.equal(after.pickers.length, 2);
} finally { await app.close(); }
`;
function run(root, mode, point) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, root, mode, point], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, text: Buffer.concat(chunks).toString() }));
  });
}
for (const point of ['account-recorded', 'id-reserved', 'registry-reserved', 'directory-created', 'directory-synced', 'registry-ready']) {
  test(`real process death in the OAuth callback at ${point} recovers exactly one owned picker`, { timeout: 20000 }, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'picker-routing-crash-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const crashed = await run(root, 'crash', point); assert.equal(crashed.code, 86, crashed.text); assert.equal(crashed.signal, null);
    const recovered = await run(root, 'recover', point); assert.equal(recovered.code, 0, recovered.text); assert.equal(recovered.signal, null);
  });
}
