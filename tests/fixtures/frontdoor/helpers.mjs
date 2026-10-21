import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { requestContext, checkRequestOrigin } from './core/app/security/request.mjs';
import { openInviteStore } from './core/app/storage/invites.mjs';
export { requestContext };
export const contextHost = '100.64.0.7'; // Synthetic fixture, never a live address.
export const publicOrigin = 'https://public.example.invalid';
export const localHost = '127.0.0.1:8901';
export const tailHost = `${contextHost}:8902`;
export const token = 'synthetic-ingress-control-key-'.repeat(2);
export const master = 'A'.repeat(43), member = 'B'.repeat(43), viewer = 'C'.repeat(43);
export const lanes = [{ name: 'local', host: '127.0.0.1', port: 8901, trust: 'loopback-proxy' },
  { name: 'tail', host: contextHost, port: 8902, trust: 'direct-peer' }];
export async function fixture(t) {
  const root = path.join(process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(),'rs3-live-swap-tests'), 'frontdoor'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'run-'));
  const sha = value => createHash('sha256').update(value).digest('hex');
  const now = '2026-10-18T12:00:00.000Z';
  const invites = [member, viewer].map((value, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, label: `Synthetic ${i}`, admin: false,
    viewer: !!i, createdAt: now, lastUsedAt: null, revoked: false, tokenHash: sha(value) }));
  await writeFile(path.join(directory, 'invites.json'), JSON.stringify({ schemaVersion: 1, invites,
    sessions: [member, viewer].map((value,i) => ({ tokenHash: sha(value), inviteId: invites[i].id, expiresAt: '2030-01-01T00:00:00.000Z' })) }));
  const store = await openInviteStore({ dataDir: directory, masterToken: master, masterLabel: 'Synthetic master', now: () => Date.parse(now) });
  const resources = [];
  t.after(async () => { for (const cleanup of resources.reverse()) await cleanup(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, resources };
}
export function evaluate(request, store, context = requestContext(request, { host: contextHost, publicOrigin })) {
  const identity = store.authenticate(request, context);
  let originStatus = 200; try { checkRequestOrigin(request, context); } catch (error) { originStatus = error.status; }
  const status = !identity ? 401 : identity.readOnly && request.method === 'POST' ? 403 : originStatus;
  return { address: context.address, rateKey: context.rateKey, funnel: context.funnel, secure: context.secure,
    masterAllowed: context.masterAllowed, publicRequest: context.publicRequest, trustedProxy: context.trustedProxy,
    identity: identity?.kind ?? null, readOnly: identity?.readOnly ?? null, originStatus, status };
}
export function cases() {
  const result = [];
  for (const lane of lanes) {
    const host = lane.name === 'local' ? localHost : tailHost;
    const peer = lane.name === 'local' ? '127.0.0.1' : '100.64.0.8';
    const add = (name, headers, expected = {}) => result.push({ name: `${lane.name}: ${name}`, lane, peer,
      headers: { host, origin: `http://${host}`, cookie: `duo_access=${member}`, ...headers }, expected });
    add('invite', {}, { identity: 'invite', status: 200 });
    add('viewer', { cookie: `duo_access=${viewer}` }, { identity: 'invite', status: 403 });
    add('master cookie', { cookie: `duo_access=${master}` }, { identity: 'master', status: 200 });
    add('master bearer', { cookie: '', authorization: `Bearer ${master}` }, { identity: 'master', status: 200 });
    add('anonymous', { cookie: '' }, { identity: null, status: 401 });
    add('spoof XFF', { cookie: '', 'x-forwarded-for': '127.0.0.1' }, { identity: null, status: 401 });
    add('spoof Funnel', { cookie: '', 'tailscale-funnel-request': '1' }, { identity: null, masterAllowed: false, status: 401 });
    add('spoof both', { cookie: '', 'x-forwarded-for': '127.0.0.1', 'tailscale-funnel-request': '1' }, { identity: null, masterAllowed: false, status: 401 });
    add('spoof XFF with existing master', { cookie: `duo_access=${master}`, 'x-forwarded-for': '127.0.0.1' }, { identity: 'master', status: 200 });
    add('spoof Funnel with existing master', { cookie: `duo_access=${master}`, 'tailscale-funnel-request': '1' }, { identity: null, masterAllowed: false, status: 401 });
    add('wrong Host', { host: 'wrong.example.invalid' }, { originStatus: 403, status: 403 });
    add('cross-site Origin', { origin: 'https://cross.example.invalid', 'sec-fetch-site': 'cross-site' }, { originStatus: 403, status: 403 });
    add('missing Origin cookie', { origin: undefined }, { originStatus: 403, status: 403 });
    for (const other of lane.name === 'local' ? [tailHost, new URL(publicOrigin).host] : [localHost, 'localhost:8901', new URL(publicOrigin).host]) {
      for (const change of ['Host', 'Origin', 'both']) {
        const origin = other === new URL(publicOrigin).host ? publicOrigin : `http://${other}`;
        add(`cross-lane ${other === new URL(publicOrigin).host ? 'public' : other.startsWith('localhost') ? 'localhost' : 'other'} ${change}`,
          { ...(change !== 'Origin' ? { host: other } : {}), ...(change !== 'Host' ? { origin } : {}) },
          { originStatus: change === 'both' && origin.startsWith('http:') ? 200 : 403 });
      }
    }
  }
  for (const cookie of ['', `duo_access=${member}`, `duo_access=${viewer}`, `duo_access=${master}`]) {
    result.push({ name: `local: Funnel ${cookie === '' ? 'anonymous' : cookie.includes(member) ? 'invite' : cookie.includes(viewer) ? 'viewer' : 'master'}`, lane: lanes[0], peer: '127.0.0.1',
      headers: { host: new URL(publicOrigin).host, origin: publicOrigin, cookie, 'x-forwarded-for': '203.0.113.8', 'x-forwarded-proto': 'https', 'x-forwarded-host': new URL(publicOrigin).host, 'tailscale-funnel-request': '1' },
      expected: { masterAllowed: false, funnel: true, originStatus: 200, status: cookie.includes(member) ? 200 : cookie.includes(viewer) ? 403 : 401 } });
  }
  for (const peer of ['100.64.0.7', 'fd7a:115c:a1e0::8', '::ffff:100.64.0.8', '203.0.113.8']) {
    result.push({ name: `tail: peer variant ${peer.includes(':') ? 'v6' : peer === contextHost ? 'bound' : 'public'}`, lane: lanes[1], peer,
      headers: { host: tailHost, origin: `http://${tailHost}`, cookie: `duo_access=${member}`, 'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https' }, expected: {} });
  }
  for (const peer of ['127.0.0.9', '::1', '::ffff:127.0.0.9']) result.push({ name: 'local: peer variant ' + peer, lane: lanes[0], peer,
    headers: { host: localHost, origin: 'http://' + localHost, cookie: 'duo_access=' + master }, expected: { identity: 'master', status: 200 } });
  return result;
}
