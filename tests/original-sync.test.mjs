import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGroupState } from '../app/core/state.mjs';
import { normalizeOriginalMap, previewOriginalSync, originalSyncCommand, createOriginalSyncClient } from '../app/integrations/original-sync.mjs';

const capture = JSON.parse(await readFile(new URL('./fixtures/original-sync/capture.json', import.meta.url), 'utf8'));
const owners = [{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2', sourceMapId: 'QXB' }];
function stateFromCapture() {
  return createGroupState(owners.map(owner => {
    const source = normalizeOriginalMap(capture.maps[owner.sourceMapId.toLowerCase()], owner.sourceMapId.toLowerCase());
    return { ...owner, unlocked: source.unlocked, selected: source.selected, blacklisted: source.blacklisted, pendingRoll: source.pendingRoll, taskRules: source.taskRules };
  }));
}
const recordedFetch = async url => {
  const match = /\/maps\/(qxa|qxb)\/(\w+)\.json$/.exec(url);
  return new Response(JSON.stringify(match ? capture.maps[match[1]][match[2]] ?? null : capture.metadata.sourceVersion ?? null));
};

test('recorded public maps diff unlock/lock, selections in source rank order, blacklist and offers by sourceMapId', () => {
  const state = stateFromCapture(), member = state.members[0], source = normalizeOriginalMap(capture.maps.qxa, 'qxa');
  const first = member.unlocked.shift(); member.unlocked.push('99999');
  member.selected.reverse(); const selected = member.selected.shift(); member.selected.push('99998');
  member.blacklisted = ['99997']; member.pendingRoll = ['99996'];
  member.originalPickerSync = { appliedAt: '2026-10-07T00:00:00Z' };
  const proposal = previewOriginalSync(state, capture), preview = proposal.preview.members[0];
  assert.deepEqual(preview.chunks, { unlock: [first], lock: ['99999'], keepLocal: [] });
  assert.deepEqual(preview.selections.add, [selected]); assert.deepEqual(preview.selections.remove, ['99998']);
  assert.deepEqual(preview.selections.after, source.selected); assert.equal(preview.selections.orderChanged, true);
  assert.deepEqual(preview.blacklist.remove, ['99997']);
  assert.deepEqual(preview.pendingRoll, { before: ['99996'], after: source.pendingRoll, changed: true });
  assert.equal(preview.lastSynced, '2026-10-07T00:00:00Z');
  assert.deepEqual(proposal.preview.members[1].chunks, { unlock: [], lock: [], keepLocal: [] });
  assert.deepEqual(proposal.preview.members[1].rules, []);
  assert.equal(state.members[0].unlocked.includes('99999'), true);
});

test('selection order matches the original numeric ranks and older string saves; pending offers stay distinct', () => {
  const map = { chunks: { unlocked: { '100': '100' }, selected: { '*fb*_103': 1, '*fb*_101': 3, '*fb*_102': 2 },
    potential: { '*fb*_104': '104', '*fb*_105': '105' } }, rules: { 'Kill-_-20X-_-20Amount': '3' } };
  const source = normalizeOriginalMap(map, 'qxa');
  assert.deepEqual(source.selected, ['103', '102', '101']); assert.deepEqual(source.pendingRoll, ['104', '105']);
  assert.deepEqual(source.taskRules, { 'Kill X Amount': '3' });
  map.chunks.selected = { '101': '101', '102': '102', '103': '103' };
  assert.deepEqual(normalizeOriginalMap(map, 'qxa').selected, ['103', '102', '101']);
  map.chunks.potential = { '104': '104' };
  const warnings = []; normalizeOriginalMap(map, 'qxa', warnings); assert.match(warnings[0], /one pending choice/);
  map.chunks.selected['103-1'] = '103-1';
  assert.deepEqual(normalizeOriginalMap(map, 'qxa', warnings).selected, ['103', '102', '101']);
  assert.ok(warnings.some(warning => warning.includes('section 103-1')));
});

test('rule preview uses member precedence, shared F2P and engine fallback for invalid saved cutoffs', () => {
  const state = stateFromCapture(); state.rules['content.f2p'] = false;
  state.members[0].taskRules = { F2P: true, Skills: false, 'Rare Drop Amount': 'invalid', 'app-only-rule': true };
  state.legacy = { maps: { qxa: { rules: { Skills: true } } } };
  const document = structuredClone(capture); document.maps.qxa.rules = { F2P: true, Skills: true, 'Rare Drop Amount': '1000' };
  const preview = previewOriginalSync(state, document).preview.members[0];
  assert.deepEqual(preview.rules.map(row => row.id), ['F2P', 'Skills']);
  assert.equal(preview.rules[0].before, false); assert.equal(preview.rules[0].shared, true);
  assert.equal(preview.rules.some(row => row.id === 'app-only-rule'), false);
  document.maps.qxb.rules.F2P = false;
  const disagreement = previewOriginalSync(state, document).preview;
  assert.ok(disagreement.warnings.some(warning => warning.includes('different F2P')));
  assert.deepEqual(disagreement.members.map(member => member.originalF2P), [true, false]);
});

test('captured notes, checks and user tasks are decoded review evidence; trusted commands contain selected fields only', () => {
  const document = structuredClone(capture);
  document.maps.qxa.chunkNotes = { '*fb*_100': 'Keep-_-20this', pin: 'excluded' };
  document.maps.qxa.chunks.stickeredNotes = { '*fb*_101': 'Sticker-_-20note' };
  document.maps.qxa.chunkinfo = { checkedAllTasks: { Quest: { t_1: true } }, backlog: { Quest: { t_2: 'Later-_-20on' } } };
  document.maps.qxa.userTasks = { Extra: { 'Do-_-20this': true } };
  const proposal = previewOriginalSync(stateFromCapture(), document), observations = proposal.preview.members[0].observations;
  assert.deepEqual(observations.notes.chunkNotes, { '100': 'Keep this' });
  assert.deepEqual(observations.notes.stickeredNotes, { '101': 'Sticker note' });
  assert.equal(observations.taskChecks.checkedAllTasks.Quest.t_1, true);
  assert.equal(observations.userTasks.Extra['Do this'], true);
  const command = originalSyncCommand(proposal, [{ memberId: 'player1', groups: ['selections'] }]);
  assert.deepEqual(Object.keys(command.members[0]), ['memberId', 'sourceMapId', 'groups', 'selected']);
  assert.deepEqual(command.members[0].selected, proposal.targets[0].selected);
  command.members[0].selected.length = 0; assert.ok(proposal.targets[0].selected.length);
  for (const selections of [[], [{ memberId: 'stranger', groups: ['chunks'] }], [{ memberId: 'player1', groups: ['notes'] }], [{ memberId: 'player1', groups: ['chunks'], unlocked: [] }]]) assert.throws(() => originalSyncCommand(proposal, selections), TypeError);
});

test('capture cache is short, request-only, concurrent and uses only whitelisted GET endpoints', async () => {
  let reads = 0, clock = new Date(capture.metadata.capturedAt);
  const client = createOriginalSyncClient({ now: () => clock, cacheTtlMs: 1000, retries: 0, fetchImpl: async (url, options) => {
    reads++; assert.equal(options.method, 'GET');
    assert.match(url, /^https:\/\/chunkpickerrs3\.firebaseio\.com\/(?:maps\/(?:qxa|qxb)\/(?:rules|chunkOrder|settings|chunkinfo|chunks|activeSubTabs|topbarSelection|manualPrimary|recentFancyRollTime|recent|recentTime|randomLoot|chunkNotes|userTasks|friends|friendsAlt)|version)\.json$/);
    return recordedFetch(url);
  } });
  assert.equal(reads, 0); const snapshots = await Promise.all([client.snapshot(), client.snapshot()]);
  assert.equal(reads, 33); assert.equal(snapshots[0].cached, false);
  const cached = await client.snapshot(); assert.equal(cached.cached, true); assert.equal(reads, 33);
  cached.document.maps.qxa.chunks = {}; assert.ok((await client.snapshot()).document.maps.qxa.chunks.unlocked);
  clock = new Date(clock.getTime() + 1001); await client.snapshot(); assert.equal(reads, 66);
  client.close(); await assert.rejects(client.snapshot(), /stopping/);
});

test('network failure, timeout, unexpected map/rule/chunk shapes and invalid provenance are clear errors', async () => {
  for (const mutation of [map => { map.chunks = null; }, map => { map.chunks.selected = 'bad'; }, map => { map.chunks.selected = { '99999': {} }; }, map => { map.chunks.potential = { 1: '1', 2: '2', 3: '3' }; }, map => { map.rules = { Skills: 'true' }; }, map => { map.chunks.unlocked = { nope: true }; }, map => { map.chunks.selected = map.chunks.unlocked; }]) {
    const document = structuredClone(capture); mutation(document.maps.qxa);
    assert.throws(() => previewOriginalSync(stateFromCapture(), document), error => error.code === 'ORIGINAL_DATA_SHAPE' && /Nothing was applied/.test(error.message));
  }
  const network = createOriginalSyncClient({ retries: 0, fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(network.snapshot(), error => error.status === 502 && error.code === 'ORIGINAL_NETWORK');
  const timeout = createOriginalSyncClient({ retries: 0, timeoutMs: 5, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  await assert.rejects(timeout.snapshot(), error => error.status === 504 && error.code === 'ORIGINAL_TIMEOUT');
  const bad = structuredClone(capture); delete bad.metadata.capturedAt;
  assert.throws(() => previewOriginalSync(stateFromCapture(), bad), /provenance/);
  for (const field of ['unlocked', 'blacklisted', 'potential']) for (const value of [false, { nonsense: true }, 'not-a-chunk', null]) {
    assert.throws(() => normalizeOriginalMap({ chunks: { [field]: { '99999': value } } }, 'qxa'), /invalid chunk-set value/);
  }
  assert.throws(() => previewOriginalSync(createGroupState([{ id: 'other', name: 'Other' }]), capture), /No player is linked/);
});

test('the same capture client retries a malformed response and never serves an expired snapshot after a failure', async () => {
  let malformed = true, clock = new Date(capture.metadata.capturedAt);
  const client = createOriginalSyncClient({ retries: 0, cacheTtlMs: 10, now: () => clock, fetchImpl: async url =>
    malformed && url.endsWith('/qxa/chunks.json') ? new Response('null') : recordedFetch(url) });
  await assert.rejects(client.snapshot(), error => error.code === 'ORIGINAL_DATA_SHAPE');
  malformed = false; assert.equal((await client.snapshot()).cached, false);
  assert.equal((await client.snapshot()).cached, true);
  clock = new Date(clock.getTime() + 11); malformed = true;
  await assert.rejects(client.snapshot(), error => error.code === 'ORIGINAL_DATA_SHAPE');
  malformed = false; assert.equal((await client.snapshot()).cached, false);
  client.close();
});
