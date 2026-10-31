import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProgressSources, previewProgress, RUNE_METRICS_CLOSED_MESSAGE } from '../app/integrations/progress-sources.mjs';
import { createHiscoresSource, parseHiscoresLite } from '../app/integrations/hiscores.mjs';
import { createQuestMapping } from '../app/integrations/quest-mapping.mjs';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';

const recorded = JSON.parse(await readFile(new URL('./fixtures/progress-sources/runemetrics.json', import.meta.url), 'utf8'));
const lite = await readFile(new URL('./fixtures/progress-sources/hiscores.txt', import.meta.url), 'utf8');
const clock = () => Date.parse(recorded.fetchedAt);
const mapping = createQuestMapping({ challenges: { Quest: { 'Synthetic Quest': { QuestPoints: 1 } } } });
const questId = [...mapping.values()][0][0].taskId;
const webFetch = async url => new Response(JSON.stringify(url.pathname.endsWith('/quests') ? recorded.quests : recorded.profile));
const offline = { async snapshot() { throw new Error('Synthetic fallback offline'); } };
const plugin = (skills = [{ skill: 'Attack', level: 20, xp: 5000 }], quests = []) => ({
  source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: recorded.fetchedAt, cached: true, skills, quests });
function state() {
  const value = createGroupState([{ id: 'player', name: 'Player x' }]);
  value.members[0].runescapeName = 'Player x';
  value.tasks = [{ id: questId, label: 'Synthetic Quest', category: 'Quest' }];
  return value;
}
const apply = (value, command) => applyCommand(value, command, { expectedRevision: value.revision, now: recorded.fetchedAt });
const sources = options => createProgressSources({ clock, hiscores: offline, runeMetrics: { fetchImpl: webFetch }, ...options });

for (const [kind, fetchImpl] of [
  ['404', async () => new Response('', { status: 404 })],
  ['410', async () => new Response('', { status: 410 })],
  ['DNS', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }],
  ['connection closed', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); }],
  ['timeout', async () => new Promise(() => {})],
]) test(`${kind}: closed message, no proposal and byte-identical last-known state`, async t => {
  const value = state();
  value.members[0].skillProgress = { Attack: { level: 30, xp: 20000, source: 'runemetrics', fetchedAt: recorded.fetchedAt, runescapeName: 'Player x' } };
  value.members[0].questProgress = { [questId]: { title: 'Synthetic Quest', source: 'runemetrics', fetchedAt: recorded.fetchedAt, runescapeName: 'Player x' } };
  value.members[0].completedTasks = [questId];
  const before = JSON.stringify(value);
  const client = sources({ runeMetrics: { fetchImpl, timeoutMs: 5 } }); t.after(() => client.close());
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.snapshot(value.members[0]);
    assert.equal(result.available, false); assert.equal(result.message, RUNE_METRICS_CLOSED_MESSAGE);
    assert.equal(result.skills, undefined); assert.equal(JSON.stringify(value), before);
  }
});

test('switch disables even cached RuneMetrics immediately; reenabling restores the adapter', async t => {
  let enabled = true, calls = 0;
  const client = sources({ runeMetricsEnabled: () => enabled, runeMetrics: { fetchImpl: async url => { calls++; return webFetch(url); } } });
  t.after(() => client.close());
  const member = state().members[0];
  assert.equal((await client.snapshot(member)).source, 'runemetrics'); assert.equal(calls, 2);
  enabled = false;
  assert.equal((await client.snapshot(member)).available, false); assert.equal(calls, 2);
  enabled = true;
  assert.equal((await client.snapshot(member)).source, 'runemetrics'); assert.equal(calls, 2);
});

test('environment switch works without changing source configuration', async t => {
  const prior = process.env.RS3_RUNEMETRICS_ENABLED;
  t.after(() => { if (prior === undefined) delete process.env.RS3_RUNEMETRICS_ENABLED; else process.env.RS3_RUNEMETRICS_ENABLED = prior; });
  process.env.RS3_RUNEMETRICS_ENABLED = '0';
  const client = sources({ runeMetrics: { fetchImpl: () => { throw new Error('Adapter must be disabled'); } } }); t.after(() => client.close());
  assert.equal((await client.snapshot(state().members[0])).message, RUNE_METRICS_CLOSED_MESSAGE);
});

test('partial live plugin fields override web rows, other web fields fill gaps, one apply and undo preserve provenance', async t => {
  const value = state();
  const client = sources({ pluginSnapshot: () => plugin(undefined, [{ title: 'Synthetic Quest', status: 'COMPLETED' }]) }); t.after(() => client.close());
  const proposal = previewProgress(value, 'player', await client.snapshot(value.members[0]), mapping);
  assert.deepEqual(proposal.command.skills.map(row => row.skill), ['Mining']);
  assert.deepEqual(proposal.command.plugin.skills, [{ skill: 'Attack', level: 20, xp: 5000 }]);
  assert.equal(proposal.preview.quests.length, 1); assert.equal(proposal.preview.counts.matchedQuests, 1);
  const result = apply(value, proposal.command), member = result.members[0]; validateState(result);
  assert.equal(member.skillProgress.Attack.source, 'game-plugin'); assert.equal(member.skillProgress.Attack.level, 20);
  assert.equal(member.skillProgress.Mining.source, 'runemetrics'); assert.equal(member.questProgress[questId].source, 'game-plugin');
  assert.equal(result.revision, value.revision + 1);
  assert.deepEqual(importBackup(exportBackup(result)).members, result.members);
  assert.deepEqual(apply(result, { type: 'undo' }).members, value.members);
});

test('plugin started quest overrides web completion without removing a saved completion', async t => {
  const value = state(); value.members[0].completedTasks = [questId];
  const client = sources({ pluginSnapshot: () => plugin([], [{ title: 'Synthetic Quest', status: 'STARTED' }]) }); t.after(() => client.close());
  const proposal = previewProgress(value, 'player', await client.snapshot(value.members[0]), mapping);
  assert.deepEqual(proposal.command.quests, []); assert.deepEqual(proposal.command.plugin.quests, []);
  assert.deepEqual(apply(value, proposal.command).members[0].completedTasks, [questId]);
});

test('saved plugin fields survive restart, stale live reports and web disagreement field by field', async t => {
  let value = state();
  value = apply(value, { type: 'apply-game-progress', memberId: 'player', fetchedAt: recorded.fetchedAt,
    skills: [{ skill: 'Attack', level: 30, xp: 20000 }], quests: [{ taskId: questId, title: 'Synthetic Quest' }] });
  value = importBackup(exportBackup(value));
  const client = sources(); t.after(() => client.close());
  const proposal = previewProgress(value, 'player', await client.snapshot(value.members[0]), mapping);
  assert.deepEqual(proposal.command.skills.map(row => row.skill), ['Mining']); assert.deepEqual(proposal.command.quests, []);
  const result = apply(value, proposal.command);
  assert.deepEqual(result.members[0].skillProgress.Attack, value.members[0].skillProgress.Attack);
  assert.deepEqual(result.members[0].questProgress, value.members[0].questProgress);
  assert.equal(result.members[0].skillProgress.Mining.source, 'runemetrics');
});

test('hiscores format maps 29 skill rows, ignores activities, skips unranked rows and rejects corrupt responses', () => {
  const rows = parseHiscoresLite(lite);
  assert.equal(rows.length, 29); assert.equal(rows[0].skill, 'Attack'); assert.equal(rows[28].skill, 'Necromancy'); assert.equal(rows[0].xp, 1000);
  assert.equal(parseHiscoresLite(lite.replace('1,10,1000', '-1,-1,-1')).length, 28);
  assert.equal(parseHiscoresLite(lite.replace('1,10,1000', '-1,10,1000')).length, 29);
  for (const text of ['<html>closed</html>', lite.split('\n').slice(0, 29).join('\n'), lite.replace('1,10,1000', '1,121,1000'), lite.replace('1,10,1000', '1,10,NaN')]) {
    assert.throws(() => parseHiscoresLite(text));
  }
});

test('hiscores is used only after failure with no plugin, uses whole XP and never regresses saved values or quests', async t => {
  const value = state(), member = value.members[0];
  member.skillProgress = { Attack: { level: 30, xp: 20000, source: 'runemetrics', fetchedAt: recorded.fetchedAt, runescapeName: 'Player x' } };
  member.completedTasks = [questId];
  let calls = 0;
  const hiscores = createHiscoresSource({ clock, fetchImpl: async url => {
    calls++; assert.equal(url.origin + url.pathname, 'https://secure.runescape.com/m=hiscore/index_lite.ws');
    assert.equal(url.searchParams.get('player'), 'Player x'); return new Response(lite);
  } });
  const client = sources({ hiscores, runeMetrics: { fetchImpl: async () => new Response('', { status: 410 }) } }); t.after(() => client.close());
  const snapshot = await client.snapshot(member); assert.equal(snapshot.source, 'hiscores'); assert.equal(calls, 1);
  assert.equal(snapshot.message, RUNE_METRICS_CLOSED_MESSAGE);
  const proposal = previewProgress(value, 'player', snapshot, mapping);
  assert.equal(proposal.command.skills.length, 28); assert.deepEqual(proposal.command.quests, []);
  const result = apply(value, proposal.command); validateState(result);
  assert.deepEqual(result.members[0].skillProgress.Attack, member.skillProgress.Attack);
  assert.equal(result.members[0].skillProgress.Mining.source, 'hiscores'); assert.equal(result.members[0].skillProgress.Mining.xp, 1000);
  assert.deepEqual(result.members[0].completedTasks, member.completedTasks);
  assert.deepEqual(importBackup(exportBackup(result)).members, result.members);
  assert.deepEqual(apply(result, { type: 'undo' }).members, value.members);
});

test('hiscores is never fetched on web success or when any live or stored plugin data exists', async t => {
  let calls = 0;
  const hiscores = { async snapshot() { calls++; throw new Error('Must not be requested'); } };
  for (const kind of ['web', 'live', 'saved skill', 'saved quest']) {
    const member = state().members[0];
    if (kind === 'saved skill') member.skillProgress = { Attack: { level: 20, xp: 5000, source: 'game-plugin', memberId: member.id, fetchedAt: recorded.fetchedAt } };
    if (kind === 'saved quest') member.questProgress = { [questId]: { title: 'Synthetic Quest', source: 'game-plugin', memberId: member.id, fetchedAt: recorded.fetchedAt } };
    const client = sources({ hiscores, runeMetricsEnabled: kind === 'web', pluginSnapshot: () => kind === 'live' ? plugin() : null }); t.after(() => client.close());
    await client.snapshot(member);
  }
  assert.equal(calls, 0);
});

test('malformed mixed reports validate atomically and leave state unchanged', async t => {
  const value = state(), before = JSON.stringify(value), client = sources({ pluginSnapshot: () => plugin() }); t.after(() => client.close());
  const proposal = previewProgress(value, 'player', await client.snapshot(value.members[0]), mapping);
  proposal.command.plugin.skills.push({ skill: 'Mining', level: 0, xp: 0 });
  assert.throws(() => apply(value, proposal.command)); assert.equal(JSON.stringify(value), before);
});


test('temporary web failure also permits levels fallback; private and unknown-player errors retain meaning if it fails', async t => {
  const client = sources({ runeMetrics: { fetchImpl: async () => new Response('', { status: 503 }) },
    hiscores: createHiscoresSource({ clock, fetchImpl: async () => new Response(lite) }) }); t.after(() => client.close());
  assert.equal((await client.snapshot(state().members[0])).source, 'hiscores');
  for (const error of ['PROFILE_PRIVATE', 'NO_PROFILE']) {
    const unavailable = sources({ runeMetrics: { fetchImpl: async () => new Response(JSON.stringify({ error })) } }); t.after(() => unavailable.close());
    await assert.rejects(unavailable.snapshot(state().members[0]), { code: error === 'NO_PROFILE' ? 'UNKNOWN_NAME' : error });
  }
});

test('a plugin report arriving during hiscores fetch wins and no fallback observation overwrites it', async t => {
  let latest = null;
  const client = sources({ runeMetricsEnabled: false, pluginSnapshot: () => latest,
    hiscores: { async snapshot() { latest = plugin(); return { source: 'hiscores', sourceLabel: 'RS3 hiscores', fetchedAt: recorded.fetchedAt, skills: parseHiscoresLite(lite), quests: [] }; } } });
  t.after(() => client.close());
  const value = state(), proposal = previewProgress(value, 'player', await client.snapshot(value.members[0]), mapping);
  assert.ok(!proposal.command.skills.some(row => row.skill === 'Attack'));
  assert.equal(apply(value, proposal.command).members[0].skillProgress.Attack.source, 'game-plugin');
});
