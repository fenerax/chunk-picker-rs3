import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeShadow, shadowHash, shadowCapabilities, compareShadowProfiles, validateOverlayPayload, safeShadowFailure,
  shadowAddonRoutes, checkShadowAddonAccess, recordedOriginalSync } from '../scripts/lib/public-shadow-profile.mjs';
import { classifyTest } from '../scripts/test-selection.mjs';

test('shadow normalization removes only measured timing and retains order and gameplay values', () => {
  const first = { z: 1, metrics: { elapsedMs: 3, count: 2 }, cache: { evaluationMs: 1, requestMs: 4, hit: false },
    timingMs: { all: 9 }, revision: 8, at: '2026-10-14T12:00:00Z', elapsedMs: 23, rows: [{ id: 'b' }, { id: 'a' }] };
  assert.deepEqual(normalizeShadow(first), { at: first.at, cache: { hit: false }, elapsedMs: 23,
    metrics: { count: 2 }, revision: 8, rows: [{ id: 'b' }, { id: 'a' }], z: 1 });
  assert.equal(shadowHash(first), shadowHash({ ...first, timingMs: { other: 0 }, metrics: { elapsedMs: 99, count: 2 } }));
  assert.notEqual(shadowHash(first), shadowHash({ ...first, rows: [...first.rows].reverse() }));
  assert.notEqual(shadowHash(first), shadowHash({ ...first, cache: { ...first.cache, hit: true } }));
  assert.notEqual(shadowHash(first), shadowHash({ ...first, revision: 9 }));
});

test('M7 requires restored utilities and compares capabilities without rewriting feature fields', () => {
  const capabilities = { cacheWalking: true, features: { originalSync: true, gallery: true, projectUpdates: true } };
  for (const mode of ['private', 'public']) {
    assert.equal(shadowCapabilities(capabilities, mode), capabilities);
    for (const [feature, code] of [['originalSync', 'ORIGINAL_SYNC_CAPABILITY'], ['gallery', 'GALLERY_CAPABILITY'], ['projectUpdates', 'PROJECT_UPDATES_CAPABILITY']]) {
      assert.throws(() => shadowCapabilities({ ...capabilities, features: { ...capabilities.features, [feature]: false } }, mode), error => error.shadowCode === code);
    }
  }
  assert.notDeepEqual(shadowCapabilities(capabilities, 'private'), shadowCapabilities({ ...capabilities, cacheWalking: false }, 'public'));
  assert.notDeepEqual(shadowCapabilities(capabilities, 'private'), shadowCapabilities({ ...capabilities, features: { ...capabilities.features, unexpected: true } }, 'public'));
  assert.notEqual(shadowHash(shadowCapabilities({ cacheWalking: true }, 'private')), shadowHash(shadowCapabilities(capabilities, 'public')));
});

test('comparison exposes safe assertion names and requires every workflow check', () => {
  const baseline = { hashes: { taskOrder: 'abc', save: 'def' }, counts: { members: 2 }, readOnlyUnchanged: true,
    undoRestored: true, accessChecked: true, artChecked: true, backupChecked: true, originalSyncCapabilityChecked: true, originalSyncRoutesChecked: true,
    originalSyncWorkflowChecked: true, galleryChecked: true, projectUpdatesChecked: true };
  assert.deepEqual(compareShadowProfiles(baseline, structuredClone(baseline)), { passed: true, differences: [], countDifferences: [] });
  assert.deepEqual(compareShadowProfiles(baseline, { ...baseline, hashes: { ...baseline.hashes, taskOrder: 'PRIVATE RESPONSE VALUE' } }),
    { passed: false, differences: ['taskOrder'], countDifferences: [] });
  for (const key of ['readOnlyUnchanged', 'undoRestored', 'accessChecked', 'artChecked', 'backupChecked', 'originalSyncCapabilityChecked', 'originalSyncRoutesChecked',
    'originalSyncWorkflowChecked', 'galleryChecked', 'projectUpdatesChecked']) {
    assert.equal(compareShadowProfiles(baseline, { ...baseline, [key]: false }).passed, false);
  }
  assert.deepEqual(compareShadowProfiles(baseline, { ...baseline, counts: { members: 1 } }).countDifferences, ['members']);
});

test('original-sync double serves the existing recorded capture and rejects every non-fixture request', async () => {
  const capture = JSON.parse(await readFile(new URL('./fixtures/original-sync/capture.json', import.meta.url), 'utf8'));
  const instant = '2026-10-14T12:00:00.000Z', recorded = recordedOriginalSync(capture, instant);
  assert.equal(recorded.reads(), 0); assert.equal(recorded.options.now().toISOString(), instant); assert.equal(recorded.options.retries, 0);
  for (const [route, value] of [['/maps/qxa/chunks.json', capture.maps.qxa.chunks], ['/maps/qxb/rules.json', capture.maps.qxb.rules], ['/version.json', capture.metadata.sourceVersion]]) {
    assert.deepEqual(await (await recorded.options.fetchImpl(capture.metadata.sourceOrigin + route, { method: 'GET' })).json(), value);
  }
  assert.equal(recorded.reads(), 3);
  for (const [url, method] of [[capture.metadata.sourceOrigin + '/maps/qxa/chunks.json', 'POST'],
    ['https://external.invalid/maps/qxa/chunks.json', 'GET'], [capture.metadata.sourceOrigin + '/maps/private/chunks.json', 'GET'],
    [capture.metadata.sourceOrigin + '/maps/qxa/credentials.json', 'GET'], [capture.metadata.sourceOrigin + '/version.json?auth=private', 'GET']]) {
    await assert.rejects(recorded.options.fetchImpl(url, { method }), error => error.shadowCode === 'ORIGINAL_FIXTURE_REQUEST');
  }
  assert.equal(recorded.reads(), 3);
});

test('add-on access probes cover restored modules, feeds and every gallery route for all identities', async () => {
  assert.ok(shadowAddonRoutes.gallery.includes('/gallery/preview'));
  assert.ok(shadowAddonRoutes.gallery.includes('/gallery-fixture-data.json'));
  assert.deepEqual(shadowAddonRoutes.feeds, ['/api/migration', '/api/changelog', '/api/roadmap']);
  for (const role of ['admin', 'member', 'viewer', 'overlay', 'unauthenticated']) {
    const calls = [];
    const request = async (route, options) => {
      calls.push([route, options]);
      const gallery = route.startsWith('/gallery');
      const denied = role === 'overlay' || role === 'unauthenticated';
      const status = role === 'overlay' ? 401 : gallery ? role === 'admin' ? 200 : 404 : denied ? 401
        : route === '/api/original-sync/preview' ? role === 'viewer' ? 403 : 400 : 200;
      assert.equal(options.expected, status, `${role}: ${route}`);
      return new Response(null, { status });
    };
    const rows = await checkShadowAddonAccess(request, role === 'unauthenticated' ? {} : { Authorization: `Bearer synthetic-${role}` }, role);
    for (const route of [...shadowAddonRoutes.modules, ...shadowAddonRoutes.feeds, ...shadowAddonRoutes.gallery]) assert.ok(rows.some(row => row[1] === route));
    assert.ok(calls.some(([route, options]) => route === '/gallery-fixtures.mjs' && options.method === 'HEAD'));
    assert.ok(calls.some(([route, options]) => route === '/gallery-fixtures.mjs' && options.headers['If-None-Match']));
    assert.deepEqual(calls.at(-1)[1].body, { forbidden: true });
  }
});

test('overlay scope rejects private or unexpected fields at every payload boundary', () => {
  const payload = { revision: 2, widget: 'count', heading: 'Unlocked chunks', unlocked: 1, total: 4 };
  assert.equal(validateOverlayPayload(payload), true);
  for (const extra of ['journal', 'legacy', 'members', 'history', 'tokenHash']) {
    assert.throws(() => validateOverlayPayload({ ...payload, [extra]: 'private' }), error => error.shadowCode === 'OVERLAY_PAYLOAD_SCOPE');
  }
  const goals = { revision: 2, widget: 'goals', heading: 'Goals', players: [{ name: 'Synthetic', goals: [{ label: 'Goal' }] }] };
  assert.equal(validateOverlayPayload(goals, 'goals'), true);
  assert.throws(() => validateOverlayPayload({ ...goals, players: [{ ...goals.players[0], journal: 'private' }] }, 'goals'));
  assert.throws(() => validateOverlayPayload({ ...goals, players: [{ name: 'Synthetic', goals: [{ label: 'Goal', note: 'private' }] }] }, 'goals'));
});

test('safe failures do not serialize messages, paths, tokens, response values or stacks', () => {
  const failure = Object.assign(new Error('secret /join/private-token C:/private/save.json'), { code: 'PRIVATE_VALUE', body: { private: 'value' } });
  assert.deepEqual(safeShadowFailure('tasks-and-roll-pools', failure), { failureStage: 'tasks-and-roll-pools', code: 'PROFILE_FAILURE' });
  assert.deepEqual(safeShadowFailure('secret /join/token', { shadowCode: '/private/token' }), { failureStage: 'unknown', code: 'PROFILE_FAILURE' });
  assert.deepEqual(safeShadowFailure('runtime-contract', { shadowCode: 'ORIGINAL_SYNC_CAPABILITY' }),
    { failureStage: 'runtime-contract', code: 'ORIGINAL_SYNC_CAPABILITY' });
});

test('cheap helpers are quick classified and app imports remain deferred to the selected root', async () => {
  assert.equal(classifyTest('public-shadow.test.mjs'), 'quick');
  const source = await readFile(new URL('../scripts/lib/public-shadow-profile.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]\.\.\/\.\.\/app\//);
  assert.match(source, /createServer\(\{ dataDir: saveRoot/);
  assert.match(source, /port: await freeShadowPort\(\)/);
  assert.match(source, /originalSync: original.options/);
  assert.doesNotMatch(source, /globalThis\.fetch/);
  const launcher = await readFile(new URL('../scripts/public-shadow.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /'--addons': 'addons'/); assert.match(launcher, /'--addons-sha256': 'addonsSha256'/);
  assert.match(launcher, /env\.RS3_PRIVATE_ADDON = options.addons/);
  assert.match(launcher, /env\.RS3_PRIVATE_ADDON_SHA256 = options.addonsSha256/);
});
