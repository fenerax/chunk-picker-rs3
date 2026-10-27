import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { openSignIn } from '../app/signin.mjs';

const security = { ingressRole: 'public', publicRequest: true, secure: true, origin: 'https://picker.example', rateKey: 'fixture' };
function response() {
  return { headers: {}, status: 0, body: '', setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    getHeader(key) { return this.headers[key.toLowerCase()]; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers ?? {})) this.setHeader(key, value); },
    end(value = '') { this.body = String(value); } };
}
const request = (url, cookie) => ({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}) } });
test('pending sign-in attempts have a hard capacity, expire, and do not call a provider before a valid callback', async t => {
  const root = path.resolve('.local/signin-provider-tests'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')), file = path.join(directory, 'secret');
  await writeFile(file, randomBytes(32).toString('base64url'));
  const keys = ['RS3_DISCORD_CLIENT_ID', 'RS3_DISCORD_CLIENT_SECRET_FILE', 'RS3_GOOGLE_CLIENT_ID', 'RS3_GOOGLE_CLIENT_SECRET_FILE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.RS3_DISCORD_CLIENT_ID = 'fixture-client'; process.env.RS3_DISCORD_CLIENT_SECRET_FILE = file;
  delete process.env.RS3_GOOGLE_CLIENT_ID; delete process.env.RS3_GOOGLE_CLIENT_SECRET_FILE;
  let at = Date.now(), calls = 0, flow;
  t.after(async () => { flow?.close(); for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await rm(directory, { recursive: true, force: true }); });
  flow = await openSignIn({ mode: 'required', publicOrigin: security.origin, provider: { now: () => at, fetch: async () => { calls++; throw Error('Unexpected provider call'); } } });
  let first;
  for (let index = 0; index < 1000; index++) {
    const res = response(); await flow.handle(request('/auth/discord'), res, { route: '/auth/discord', security });
    assert.equal(res.status, 303); first ??= res;
  }
  await assert.rejects(() => flow.handle(request('/auth/discord'), response(), { route: '/auth/discord', security }), { status: 429 });
  const preauth = first.getHeader('set-cookie')[0];
  assert.match(preauth, /^__Host-rs3_preauth=/); assert.match(preauth, /HttpOnly; Secure; SameSite=Lax; Max-Age=600$/); assert.doesNotMatch(preauth, /Domain=/);
  at += 600001;
  const state = new URL(first.getHeader('location')).searchParams.get('state');
  const callback = `/auth/discord/callback?state=${state}&code=fixture-code`;
  await assert.rejects(() => flow.handle(request(callback, preauth.split(';')[0]), response(), { route: '/auth/discord/callback', security }), { status: 400 });
  const retry = response(); await flow.handle(request('/auth/discord'), retry, { route: '/auth/discord', security }); assert.equal(retry.status, 303);
  assert.equal(calls, 0);
});
