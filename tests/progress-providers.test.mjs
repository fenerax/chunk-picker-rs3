import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProgressSources, createPluginProgressSource, RUNE_METRICS_CLOSED_MESSAGE, previewProgress } from '../app/integrations/progress-sources.mjs';
import { createHiscoresSource, parseHiscoresLite } from '../app/integrations/hiscores.mjs';
import { createQuestMapping } from '../app/integrations/quest-mapping.mjs';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { progressBelongsToMember } from '../app/core/game-progress.mjs';
import { syncFixture } from '../scripts/perf/progress-sync.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/progress/player-x.json', import.meta.url)));
const lite = await readFile(new URL('./fixtures/progress/player-x-hiscores.txt', import.meta.url), 'utf8');
const clock = () => Date.parse(fixture.fetchedAt);
const pluginAt = '2026-10-30T00:00:00.000Z';
const provenance = { source: 'game-plugin', fetchedAt: pluginAt, memberId: 'player-x' };
const webFetch = async url => new Response(JSON.stringify(url.pathname.endsWith('/quests') ? fixture.quests : fixture.profile));
const mapping = createQuestMapping(fixture.definitions);
const questId = [...mapping.values()][0][0].taskId;
const unavailableHiscores = { async snapshot() { throw new Error('Synthetic outage'); } };
function group() {
  const state = createGroupState([{ id: 'player-x', name: 'Player x', runescapeName: 'Player x' }]);
  state.members[0].runescapeName = 'Player x';
  state.tasks = [...mapping.values()].flat().map(row => ({ id: row.taskId, label: row.label, category: 'Quest' }));
  return state;
}
function apply(state, command) { return applyCommand(state, command, { now: () => fixture.fetchedAt }); }
function source(t, options = {}) {
  const client = createProgressSources({ clock, hiscores: unavailableHiscores, ...options });
  t.after(() => client.close()); return client;
}
function savedState() {
  return apply(group(), { type: 'apply-runemetrics', memberId: 'player-x', runescapeName: 'Player x', fetchedAt: pluginAt,
    skills: [{ skill: 'Attack', level: 10, xp: 1500 }], quests: [{ taskId: questId, title: 'Synthetic Quest' }] });
}

test('healthy web sync preview, command, members and history match START byte for byte on two synthetic cases', async () => {
  const expected = await readFile(new URL('./fixtures/progress/sync-start.json', import.meta.url));
  const actual = Buffer.from(await syncFixture(fileURLToPath(new URL('..', import.meta.url)), fixture));
  assert.deepEqual(actual, expected);
});

test('plugin levels and quest statuses win individually; web fills absent fields and keeps truthful provenance', async t => {
  const state = group(), owner = state.members[0];
  owner.skillProgress = { Attack: { level: 9, xp: 1000, ...provenance } };
  const client = source(t, { runeMetrics: { fetchImpl: webFetch }, pluginSnapshot: () => ({
    source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: fixture.fetchedAt, cached: true,
    skills: [{ skill: 'Cooking', level: 6, xp: 600 }], quests: [{ title: 'Synthetic Quest', status: 'STARTED' }] }) });
  const snapshot = await client.snapshot(owner);
  assert.equal(snapshot.skills.find(row => row.skill === 'Attack').level, 9);
  assert.equal(snapshot.skills.find(row => row.skill === 'Necromancy').level, 2);
  const { command } = previewProgress(state, owner.id, snapshot, mapping);
  assert.deepEqual(command.quests, []);
  const applied = apply(state, command); validateState(applied);
  assert.equal(applied.members[0].skillProgress.Attack.source, 'game-plugin');
  assert.equal(applied.members[0].skillProgress.Attack.fetchedAt, pluginAt);
  assert.equal(applied.members[0].skillProgress.Cooking.source, 'game-plugin');
  assert.equal(applied.members[0].skillProgress.Necromancy.source, 'runemetrics');
  assert.deepEqual(importBackup(exportBackup(applied)).members, applied.members);
  assert.deepEqual(apply(applied, { type: 'undo' }).members, state.members);
});

test('stored plugin quests and levels survive restart, disconnection and a web account rename', async t => {
  const state = apply(group(), { type: 'apply-game-progress', memberId: 'player-x', fetchedAt: pluginAt,
    skills: [{ skill: 'Attack', level: 8, xp: 800 }], quests: [{ taskId: questId, title: 'Synthetic Quest' }] });
  const owner = importBackup(exportBackup(state)).members[0]; owner.runescapeName = 'Player y';
  const client = source(t, { runeMetricsEnabled: false, hiscores: { snapshot() { assert.fail('Plugin observations suppress hiscores'); } } });
  const snapshot = await client.snapshot(owner);
  assert.equal(snapshot.source, 'game-plugin'); assert.equal(snapshot.message, RUNE_METRICS_CLOSED_MESSAGE);
  assert.equal(snapshot.skills[0].level, 8); assert.equal(snapshot.quests[0].status, 'COMPLETED');
});

for (const [kind, fetchImpl] of [
  ['HTTP 404', async () => new Response('', { status: 404 })],
  ['HTTP 410', async () => new Response('', { status: 410 })],
  ['DNS failure', async () => { throw Object.assign(new Error('Synthetic DNS failure'), { cause: { code: 'ENOTFOUND' } }); }],
  ['closed connection', async () => { throw Object.assign(new Error('Synthetic connection failure'), { cause: { code: 'ECONNREFUSED' } }); }],
]) {
  test(`${kind}: one closure message and byte-identical saved progress when both web sources fail`, async t => {
    const state = savedState(), before = JSON.stringify(state);
    const client = source(t, { runeMetrics: { fetchImpl } });
    const result = await client.snapshot(state.members[0]);
    assert.equal(result.available, false); assert.equal(result.message, RUNE_METRICS_CLOSED_MESSAGE);
    assert.equal(JSON.stringify(state), before);
  });
  test(`${kind}: hiscores supplies only levels and XP without losing saved quests or reducing progress`, async t => {
    const state = savedState(), owner = state.members[0];
    const client = source(t, { runeMetrics: { fetchImpl }, hiscores: createHiscoresSource({ clock, fetchImpl: async () => new Response(lite) }) });
    const result = await client.snapshot(owner);
    assert.equal(result.source, 'hiscores'); assert.deepEqual(result.quests, []);
    assert.equal(result.message, RUNE_METRICS_CLOSED_MESSAGE);
    assert.ok(!result.skills.some(row => row.skill === 'Attack'));
    const applied = apply(state, previewProgress(state, owner.id, result, mapping).command); validateState(applied);
    assert.deepEqual(applied.members[0].skillProgress.Attack, owner.skillProgress.Attack);
    assert.deepEqual(applied.members[0].questProgress, owner.questProgress);
    assert.deepEqual(applied.members[0].completedTasks, owner.completedTasks);
    assert.equal(applied.members[0].skillProgress.Cooking.source, 'hiscores');
    assert.equal(progressBelongsToMember(applied.members[0].skillProgress.Cooking, owner), true);
    assert.deepEqual(importBackup(exportBackup(applied)).members, applied.members);
    assert.deepEqual(apply(applied, { type: 'undo' }).members, state.members);
  });
}

test('runtime off switch bypasses RuneMetrics cache; environment switch also works without rebuilding', async t => {
  let enabled = true, calls = 0;
  const client = source(t, { runeMetricsEnabled: () => enabled, runeMetrics: { fetchImpl: async url => { calls++; return webFetch(url); } } });
  assert.equal((await client.snapshot(group().members[0])).source, 'runemetrics');
  enabled = false;
  assert.equal((await client.snapshot(group().members[0])).available, false); assert.equal(calls, 2);
  enabled = true;
  assert.equal((await client.snapshot(group().members[0])).source, 'runemetrics'); assert.equal(calls, 2);
  const previous = process.env.RS3_RUNEMETRICS_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.RS3_RUNEMETRICS_ENABLED; else process.env.RS3_RUNEMETRICS_ENABLED = previous; });
  process.env.RS3_RUNEMETRICS_ENABLED = '0';
  assert.equal((await source(t, { runeMetrics: { fetchImpl: () => assert.fail('Adapter disabled') } }).snapshot(group().members[0])).available, false);
});

test('hiscores parses documented RS3 skill ordering, ignores activities, and omits unranked skills', () => {
  const rows = parseHiscoresLite(lite);
  assert.equal(rows.length, 29); assert.equal(rows[28].skill, 'Necromancy'); assert.equal(rows[0].xp, 450);
  assert.equal(parseHiscoresLite(lite.replace('123,5,450', '-1,-1,-1')).length, 28);
  for (const value of ['<html>gone</html>', '1,2,3', lite.replace('123,5,450', '123,121,0'),
    lite.replace('123,5,450', '123,5,200000001'), lite.replace('123,5,450', 'bad')]) assert.throws(() => parseHiscoresLite(value));
});

test('fallback is never contacted for healthy RuneMetrics, or when any plugin field exists', async t => {
  const forbidden = { snapshot() { assert.fail('Unexpected hiscores request'); } };
  await source(t, { runeMetrics: { fetchImpl: webFetch }, hiscores: forbidden }).snapshot(group().members[0]);
  const owner = group().members[0]; owner.skillProgress = { Attack: { level: 5, xp: 450, ...provenance } };
  const client = source(t, { runeMetrics: { fetchImpl: async () => { throw new Error('Synthetic outage'); } }, hiscores: forbidden });
  assert.equal((await client.snapshot(owner)).source, 'game-plugin');
});

test('per-row provenance rejects another member, extra keys and a forged web binding atomically', () => {
  const state = group(), before = JSON.stringify(state);
  for (const value of [{ ...provenance, memberId: 'player-y' }, { ...provenance, level: 100 },
    { source: 'runemetrics', fetchedAt: pluginAt, runescapeName: 'Player y' }]) {
    assert.throws(() => apply(state, { type: 'apply-runemetrics', memberId: 'player-x', runescapeName: 'Player x',
      fetchedAt: fixture.fetchedAt, skills: [{ skill: 'Attack', level: 5, xp: 450, provenance: value }], quests: [] }));
  }
  assert.equal(JSON.stringify(state), before);
});

test('the off switch changed during a fetch discards its late successful reply', async t => {
  let enabled = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = source(t, { runeMetricsEnabled: () => enabled,
    runeMetrics: { fetchImpl: async url => { await gate; return webFetch(url); } } });
  const result = client.snapshot(group().members[0]); enabled = false; release();
  assert.equal((await result).available, false);
});

test('ordinary service failure can fall back to hiscores; a corrupt fallback preserves the original saved facts', async t => {
  const state = savedState(), before = JSON.stringify(state);
  for (const body of [lite, '<html>unavailable</html>']) {
    const client = source(t, { runeMetrics: { fetchImpl: async () => new Response('', { status: 503 }) },
      hiscores: createHiscoresSource({ clock, fetchImpl: async () => new Response(body) }) });
    if (body === lite) assert.equal((await client.snapshot(state.members[0])).source, 'hiscores');
    else await assert.rejects(client.snapshot(state.members[0]), { code: 'UPSTREAM_ERROR' });
    assert.equal(JSON.stringify(state), before);
  }
});

test('sparse plugin reports keep each skill and quest observation date', async t => {
  let now = clock();
  const plugin = createPluginProgressSource({ clock: () => now });
  plugin.receive('player-x', { sentAt: new Date(now).toISOString(), world: { beta: false },
    skills: [{ skill: 'Attack', level: 5, xp: 450 }] });
  now += 1000;
  plugin.receive('player-x', { sentAt: new Date(now).toISOString(), world: { beta: false },
    skills: [{ skill: 'Cooking', level: 5, xp: 450 }], quests: { finished: ['Synthetic_Quest'], started: [] } });
  const state = group();
  const client = source(t, { runeMetricsEnabled: false, pluginSnapshot: member => plugin.snapshot(member) });
  const command = previewProgress(state, 'player-x', await client.snapshot(state.members[0]), mapping).command;
  const member = apply(state, command).members[0];
  assert.equal(member.skillProgress.Attack.fetchedAt, fixture.fetchedAt);
  assert.equal(member.skillProgress.Cooking.fetchedAt, new Date(now).toISOString());
  assert.equal(member.questProgress[questId].fetchedAt, new Date(now).toISOString());
});

test('a fallback fetched before another progress save cannot lower the latest preview state', async t => {
  const initial = group();
  const client = source(t, { runeMetricsEnabled: false,
    hiscores: createHiscoresSource({ clock, fetchImpl: async () => new Response(lite) }) });
  const snapshot = await client.snapshot(initial.members[0]);
  const current = apply(initial, { type: 'apply-runemetrics', memberId: 'player-x', runescapeName: 'Player x',
    fetchedAt: fixture.fetchedAt, skills: [{ skill: 'Cooking', level: 10, xp: 1500 }], quests: [] });
  const proposal = previewProgress(current, 'player-x', snapshot, mapping);
  assert.ok(!proposal.preview.skills.some(row => row.skill === 'Cooking'));
  assert.ok(!proposal.command.skills.some(row => row.skill === 'Cooking'));
  assert.deepEqual(apply(current, proposal.command).members[0].skillProgress.Cooking, current.members[0].skillProgress.Cooking);
});

test('replacing the official adapter alone connects the new source after RuneMetrics closes', async t => {
  let calls = 0;
  const client = source(t, { runeMetrics: { fetchImpl: async () => new Response('', { status: 410 }) },
    officialApi: { async snapshot(member) { calls++; assert.equal(member.runescapeName, 'Player x');
      return { source: 'official-api', sourceLabel: 'RuneScape API', fetchedAt: fixture.fetchedAt, cached: false,
        skills: [{ skill: 'Cooking', level: 5, xp: 450 }], quests: [] }; } },
    hiscores: { snapshot() { assert.fail('Replacement API is available'); } } });
  const state = group(), snapshot = await client.snapshot(state.members[0]);
  assert.equal(calls, 1); assert.equal(snapshot.source, 'official-api');
  assert.equal(apply(state, previewProgress(state, 'player-x', snapshot, mapping).command).members[0].skillProgress.Cooking.source, 'official-api');
});

test('a plugin-only player without a web name still sees the closure message', async t => {
  const owner = group().members[0]; delete owner.runescapeName;
  owner.skillProgress = { Attack: { level: 5, xp: 450, ...provenance } };
  const client = source(t, { runeMetricsEnabled: false });
  const snapshot = await client.snapshot(owner);
  assert.equal(snapshot.source, 'game-plugin'); assert.equal(snapshot.message, RUNE_METRICS_CLOSED_MESSAGE);
});
