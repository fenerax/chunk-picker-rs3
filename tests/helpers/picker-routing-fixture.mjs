import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_LOOPBACK_ROLE', 'RS3_SIGNIN', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE']) delete process.env[key];
const { createServer } = await import('../../app/server.mjs');
const { createGroupState } = await import('../../app/core/state.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
export const origin = 'https://picker.example';
const proxy = { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https' };
const definitions = { challenges: {}, chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] };
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
export async function fixture(t, { initiallyEnabled = true, beforeCommit, ...limits } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-routing-'));
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
  const multiPicker = { admission: 'open', registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones'),
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
    const name = new URL(route, origin).pathname.endsWith('/google') ? 'google' : 'discord';
    grants.set(code, { subject, name, nonce: auth.searchParams.get('nonce'), challenge: auth.searchParams.get('code_challenge') });
    return () => send(`/auth/${name}/callback?state=${auth.searchParams.get('state')}&code=${code}`, [response.headers['set-cookie'][0].split(';')[0], ...(cookie ?? '').split(';').filter(part => part.trim() && !part.trim().startsWith('__Host-rs3_preauth='))].join('; '));
  }
  async function login(subject, cookie, route) {
    const response = await (await begin(subject, cookie, route))(); assert.equal(response.status, 303, response.text);
    return response.headers['set-cookie'].find(value => value.startsWith('duo_access=')).split(';')[0];
  }
  const registry = async () => JSON.parse(await readFile(path.join(multiPicker.registryDir, 'registry.json')));
  const picker = async subject => { const doc = await registry(); return doc.accounts.find(a => a.identities.some(i => i.subject === subject)).defaultPickerId; };
  t.after(async () => { await app.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.match(path.basename(root), /^picker-routing-/);
    await rm(root, { recursive: true });
    for (const [i, key] of envKeys.entries()) {
      if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i];
    }
  });
  return { root, send, login, begin, picker, registry, multiPicker, handler: () => handler,
    private: (route, options = {}) => request(`http://127.0.0.1:${app.address().port}`, route, { ...options, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), Origin: `http://127.0.0.1:${app.address().port}`, ...options.headers } }),
    app: () => app, restart: async edit => { await app.close(); await edit?.(); await start(multiPicker); },
    note: (cookie, text, revision, extra = {}) => send('/api/command', cookie, { body: { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: text }, expectedRevision: revision, ...extra } }),
  };
}

export { selectedDataset };

export async function viewerFixture(t, { migrated = false } = {}) {
  const f = await fixture(t), owner = await f.login('90315'), groupId = await f.picker('90315');
  await f.note(owner, 'Viewed map', 0);
  let viewerCookie = migrated ? null : await f.login('90316');
  const viewerId = '00000000-0000-4000-8000-000000000315';
  await f.restart(async () => {
    const doc = await f.registry();
    if (migrated) {
      // Recreate the shipped pre-character registry, retaining real schema-1
      // gameplay produced by this synthetic server, then exercise migration.
      doc.schemaVersion = 1;
      delete doc.characters; delete doc.groupInvites;
      doc.accounts = doc.accounts.map(({ id, identities, memberships, defaultPickerId, createdAt }) => ({ id, identities, memberships, defaultPickerId, createdAt }));
      doc.pickers = doc.pickers.map(({ id, kind, ownerAccountId, lifecycle, provisioning, memberIds, createdAt }) => ({ id, kind, ownerAccountId, lifecycle, provisioning, memberIds, createdAt }));
      doc.accounts.push({ id: viewerId, identities: [{ provider: 'discord', subject: '90316' }], memberships: [], defaultPickerId: null, createdAt: doc.accounts[0].createdAt });
      await writeFile(path.join(f.multiPicker.tombstoneDir, 'ledger.json'), JSON.stringify({ schemaVersion: 1, issuedPickerIds: doc.pickers.map(p => p.id), pickers: [], accounts: [] }));
    }
    doc.accounts.find(a => a.identities.some(i => i.subject === '90316')).memberships.push({ pickerId: groupId, role: 'viewer', memberId: null });
    await writeFile(path.join(f.multiPicker.registryDir, 'registry.json'), JSON.stringify(doc));
  });
  viewerCookie ??= await f.login('90316');
  return Object.assign(f, { viewerCookie, groupId });
}
