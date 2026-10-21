import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import http from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { resolveDataset } from '../app/datasets.mjs';

const root = fileURLToPath(new URL('../.local/invite-tests/', import.meta.url));
const selectedDataset = await resolveDataset();
const dataset = { ...selectedDataset, gameDefaults: { ...selectedDataset.gameDefaults, masterLabel: 'Player 1' } };
const definitions = { chunks: { '100': {}, '101': {} }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] };
const publicOrigin = 'https://picker.example';
const funnel = { Host: 'picker.example', 'Tailscale-Funnel-Request': '?1', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
const tokenFrom = link => new URL(link).pathname.split('/').at(-1);

async function fixture(t, options = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'server-'));
  let application, origin;
  async function start() {
    const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
    application = await createServer({ dataDir, dataset, definitions, taskMap: {}, initialState, host: '127.0.0.1', port: 0, predictionPrewarm: false, ...options });
    await application.listen(); origin = `http://127.0.0.1:${application.address().port}`;
  }
  await start();
  t.after(async () => { await application.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { cookie, body, headers = {}, ...extra } = {}) {
    // Node fetch intentionally replaces Host; use HTTP when exercising proxy hosts.
    if (Object.keys(headers).some(key => key.toLowerCase() === 'host')) {
      return new Promise((resolve, reject) => {
        const bytes = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(`${origin}${route}`, { method: bytes === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { Cookie: cookie } : {}), ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin, 'Content-Length': Buffer.byteLength(bytes) }), ...headers } }, res => {
          const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('error', reject);
          res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
        });
        req.on('error', reject); req.end(bytes);
      });
    }
    return fetch(`${origin}${route}`, { redirect: 'manual', ...extra,
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...headers } });
  }
  const master = await request(`/join/${application.store.getAccessToken()}`);
  assert.equal(master.status, 303);
  const masterCookie = cookieFrom(master);
  return { dataDir, get application() { return application; }, get origin() { return origin; }, masterCookie, request,
    admin: (route, body, headers) => request(route, { cookie: masterCookie, body, headers }),
    async invite(label = 'Player 2', admin = false) {
      const response = await request('/api/invites', { cookie: masterCookie, body: { label, admin } });
      assert.equal(response.status, 201); return response.json();
    },
    async join(link, headers = {}) {
      const response = await request(new URL(link).pathname, { headers });
      assert.equal(response.status, 303); return { response, cookie: cookieFrom(response) };
    },
    async restart() { await application.close(); await start(); },
  };
}

async function storedDocuments(directory) {
  const documents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) documents.push(...await storedDocuments(file));
    else if (/\.json(?:\.gz)?$/.test(entry.name)) {
      const bytes = await readFile(file);
      documents.push({ file, text: (entry.name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8') });
    }
  }
  return documents;
}

test('original picker import replaces the whole save, so it is administrator-only', async t => {
  const f = await fixture(t);
  const joined = await f.join((await f.invite('Player 2')).link);
  for (const route of ['/api/import/preview', '/api/import']) {
    assert.equal((await f.request(route, { cookie: joined.cookie, body: { expectedRevision: 0, document: {} } })).status, 403, route);
  }
});

