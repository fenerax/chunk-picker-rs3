import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformApiClient } from '../app/integrations/platform-api.mjs';
import { createHiscoresSource } from '../app/integrations/hiscores.mjs';
import { MAX_PROGRESS_RESPONSE_BYTES as limit } from '../app/integrations/bounded-response.mjs';
import { platformProfile, platformResponse } from './helpers/platform-api-fixtures.mjs';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';

beforeEach(t => blockUnmockedFetch(t));
const member = { id: 'synthetic-member', runescapeName: 'FixtureActor' };
const cases = [
  { name: 'Platform API', create: createPlatformApiClient,
    profile: JSON.stringify(platformProfile(member.runescapeName)),
    isProfile: url => url.pathname.endsWith('index_lite.json'), other: platformResponse },
  { name: 'Hiscores', create: createHiscoresSource,
    profile: ['100,203,20300', ...Array.from({ length: 29 }, () => '100,7,700')].join('\n'),
    isProfile: () => true },
];

for (const fixture of cases) {
  function client(t, response) {
    const value = fixture.create({ fetchImpl: async url => fixture.isProfile(url) ? response() : fixture.other(url) });
    t.after(() => value.close()); return value;
  }
  const rejectsSize = operation => assert.rejects(operation,
    error => fixture.name === 'Hiscores' ? /too large/.test(error.message) : error.code === 'BAD_RESPONSE');

  test(`${fixture.name} rejects multibyte text exceeding the byte limit but below the character limit`, async t => {
    const text = fixture.name === 'Hiscores' ? fixture.profile + '\n' + 'é'.repeat(600_000)
      : JSON.stringify({ ...JSON.parse(fixture.profile), syntheticPadding: 'é'.repeat(600_000) });
    assert.ok(text.length < limit && Buffer.byteLength(text) > limit);
    await rejectsSize(client(t, () => new Response(text)).snapshot(member));
  });

  test(`${fixture.name} cancels an endless stream immediately after crossing the byte limit`, { timeout: 2000 }, async t => {
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(64 * 1024).fill(32)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await rejectsSize(client(t, () => new Response(body)).snapshot(member));
    assert.equal(pulls, 17);
    assert.equal(cancelled, true);
  });

  test(`${fixture.name} refuses a large Content-Length before reading the body`, async t => {
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await rejectsSize(client(t, () => new Response(body, { headers: { 'Content-Length': String(limit + 1) } })).snapshot(member));
    assert.equal(pulls, 0);
    assert.equal(cancelled, true);
  });

  test(`${fixture.name} accepts a valid response exactly at the byte limit`, async t => {
    const text = fixture.profile.padEnd(limit, ' ');
    assert.equal(Buffer.byteLength(text), limit);
    const data = await client(t, () => new Response(text, { headers: { 'Content-Length': String(limit) } })).snapshot(member);
    const skills = data.profile?.skillvalues ?? data.skills;
    assert.equal(skills[0].level, 7);
  });
}
