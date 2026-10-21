import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixture, cases, evaluate, requestContext, token, contextHost, publicOrigin, lanes } from './fixtures/frontdoor/helpers.mjs';
import { forwardHeaders, createIngressContext, ingressHeader } from '../scripts/private-companion/live-swap/ingress.mjs';
const through = createIngressContext({ token, contextHost, requestContext });
test('rel5 equivalence matrix uses unchanged bridge security and invite authentication', async t => {
  const { store } = await fixture(t), rows = [];
  for (const c of cases()) {
    const headers = Object.fromEntries(Object.entries(c.headers).filter(([,value]) => value !== undefined));
    const request = { method: 'POST', url: '/security-probe', headers, socket: { remoteAddress: c.peer } };
    const before = evaluate(request, store);
    const forwarded = { ...request, headers: forwardHeaders(request, c.lane, token, contextHost), socket: { remoteAddress: '127.0.0.1' } };
    const after = evaluate(forwarded, store, through(forwarded, { host: '127.0.0.1', publicOrigin }));
    assert.deepEqual(after, before, c.name);
    for (const [key,value] of Object.entries(c.expected)) assert.equal(before[key], value, `${c.name}: ${key}`);
    rows.push({ name: c.name, mode: 'unit', ...before });
  }
  if (process.env.FRONTDOOR_EVIDENCE) await writeFile(process.env.FRONTDOOR_EVIDENCE, JSON.stringify(rows, null, 2));
  assert.equal(rows.length, 52);
});
test('direct ingress strips every proxy header, overwrites provenance, and authenticates the envelope', () => {
  const request = { method: 'POST', url: '/security-probe', socket: { remoteAddress: '100.64.0.8' }, headers: { host: 'fixture', cookie: 'fixture-cookie', origin: 'http://fixture',
    'x-forwarded-for': '127.0.0.1', 'x-forwarded-future': 'evil', forwarded: 'evil', 'x-real-ip': 'evil', 'tailscale-funnel-request': '1', [ingressHeader]: 'forged' } };
  const headers = forwardHeaders(request, lanes[1], token, contextHost);
  for (const name of ['forwarded', 'x-real-ip', 'tailscale-funnel-request', 'x-forwarded-future']) assert.equal(headers[name], undefined);
  assert.equal(headers['x-forwarded-for'], request.socket.remoteAddress);
  for (const name of ['host','cookie','origin']) assert.equal(headers[name], request.headers[name]);
  const forwarded = { ...request, headers, socket: { remoteAddress: '127.0.0.1' } };
  assert.doesNotThrow(() => through(forwarded, { publicOrigin }));
  for (const bad of [{ ...forwarded, url: '/other' }, { ...forwarded, method: 'GET' }, { ...forwarded, socket: { remoteAddress: '100.64.0.8' } },
    { ...forwarded, headers: { ...headers, [ingressHeader]: headers[ingressHeader] + '0' } }, { ...forwarded, headers: { ...headers, [ingressHeader]: 'forged' } }])
    assert.throws(() => through(bad, { publicOrigin }), { code: 'LIVE_SWAP_INGRESS_AUTH' });
  const local = forwardHeaders(request, lanes[0], token, contextHost);
  assert.ok(local[ingressHeader]); assert.equal(local['tailscale-funnel-request'], '1');
});

test('bridge security fixture bytes match the recorded core pin', async () => {
  const provenance=JSON.parse(await readFile(new URL('./fixtures/frontdoor/PROVENANCE.json',import.meta.url)));
  for(const file of provenance.files) assert.equal(createHash('sha256').update(await readFile(new URL('./fixtures/frontdoor/core/'+file.path,import.meta.url))).digest('hex'),file.sha256);
});
