import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressSources as createSources, createPluginProgressSource, createOfficialApiSource, previewProgress } from '../app/integrations/progress-sources.mjs';
import { createRuneMetricsClient } from '../app/integrations/runemetrics.mjs';
import { createQuestMapping } from '../app/integrations/quest-mapping.mjs';
import { RUNE_METRICS_SUNSET_AT, PLUGIN_PROGRESS_FRESH_MS } from '../app/integrations/progress-source-policy.mjs';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { progressBelongsToMember } from '../app/core/game-progress.mjs';
import { trainingProgress, buildTrainingAvailability } from '../app/tasks/training-availability.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { personalSkillProgress } from '../app/web/helper-model.mjs';
import { customTaskDoable } from '../app/web/custom-tasks-model.mjs';

const createProgressSources = options => createSources({ hiscores: { async snapshot() { throw new Error('Synthetic hiscores unavailable'); } }, ...options });
const beforeSunset = RUNE_METRICS_SUNSET_AT - 1000;
const owner = { id: 'actor1', runescapeName: 'Player x' };
const live = (at, extra = {}) => ({ sentAt: new Date(at).toISOString(), world: { beta: false },
  skills: [{ skill: 'Attack', level: 5, xp: 400 }], ...extra });
const legacyFetch = async url => new Response(JSON.stringify(url.pathname.endsWith('/quests') ? { quests: [] }
  : { name: owner.runescapeName, skillvalues: [{ id: 0, level: 4, xp: 3000 }] }));

test('fresh live plugin observations win per member; stale observations fall back to the web', async t => {
  let now = beforeSunset - PLUGIN_PROGRESS_FRESH_MS, calls = 0;
  const plugin = createPluginProgressSource({ clock: () => now });
  const sources = createProgressSources({ clock: () => now, pluginSnapshot: member => plugin.snapshot(member),
    runeMetrics: { fetchImpl: async url => { calls++; return legacyFetch(url); } } });
  t.after(() => sources.close());
  plugin.receive(owner.id, live(now));
  const mixed = await sources.snapshot(owner);
  assert.equal(mixed.skills[0].level, 5); assert.equal(mixed.skills[0].provenance.source, 'game-plugin'); assert.equal(calls, 2);
  assert.equal((await sources.snapshot({ ...owner, id: 'other' })).source, 'runemetrics'); assert.equal(calls, 4);
  now += PLUGIN_PROGRESS_FRESH_MS;
  assert.equal((await sources.snapshot(owner)).source, 'runemetrics'); assert.equal(calls, 6);
});

test('position pings, unrelated progress and delta updates never refresh old skill observations', () => {
  let now = beforeSunset - PLUGIN_PROGRESS_FRESH_MS;
  const plugin = createPluginProgressSource({ clock: () => now });
  plugin.receive(owner.id, live(now));
  now += PLUGIN_PROGRESS_FRESH_MS - 1;
  plugin.receive(owner.id, live(now, { skills: undefined, quests: { finished: ['Vampire_Slayer'], started: [] } }));
  now++;
  plugin.receive(owner.id, live(now, { skills: undefined }));
  const snapshot = plugin.snapshot(owner);
  assert.deepEqual(snapshot.skills, []); assert.equal(snapshot.quests[0].title, 'Vampire Slayer');
  now += PLUGIN_PROGRESS_FRESH_MS;
  assert.equal(plugin.snapshot(owner), null);
});

test('beta, unknown world, old and far-future reports cannot become the main source', () => {
  const plugin = createPluginProgressSource({ clock: () => beforeSunset });
  for (const report of [live(beforeSunset, { world: { beta: true } }), live(beforeSunset, { world: undefined }),
    live(beforeSunset - PLUGIN_PROGRESS_FRESH_MS), live(beforeSunset + 60_001)]) {
    plugin.receive(owner.id, report); assert.equal(plugin.snapshot(owner), null);
  }
  plugin.receive(owner.id, live(beforeSunset));
  plugin.receive(owner.id, live(beforeSunset, { world: { beta: true }, skills: undefined }));
  assert.equal(plugin.snapshot(owner), null);
});

test('the placeholder returns a calm unavailable state without fetching', async () => {
  const value = await createOfficialApiSource().snapshot(owner);
  assert.equal(value.available, false); assert.equal(value.source, 'official-api');
  assert.match(value.message, /RuneMetrics has closed.*game plugin/);
});

test('the sunset boundary skips RuneMetrics including a cached result', async t => {
  let now = beforeSunset, calls = 0;
  const sources = createProgressSources({ clock: () => now, runeMetrics: { fetchImpl: async url => { calls++; return legacyFetch(url); } } });
  t.after(() => sources.close());
  assert.equal((await sources.snapshot(owner)).source, 'runemetrics');
  now = RUNE_METRICS_SUNSET_AT;
  assert.equal((await sources.snapshot(owner)).available, false); assert.equal(calls, 2);
  now++;
  assert.equal((await sources.snapshot(owner)).available, false); assert.equal(calls, 2);
});

test('HTTP missing and Gone latch retirement; ordinary service failures keep their meaning', async t => {
  let calls = 0;
  const sources = createProgressSources({ clock: () => beforeSunset, runeMetrics: { fetchImpl: async () => { calls++; return new Response('', { status: 410 }); } } });
  t.after(() => sources.close());
  assert.equal((await sources.snapshot(owner)).available, false);
  assert.equal((await sources.snapshot(owner)).available, false); assert.equal(calls, 2);
  for (const status of [429, 503]) {
    const failing = createProgressSources({ clock: () => beforeSunset, runeMetrics: { fetchImpl: async () => new Response('', { status }) } });
    try { await assert.rejects(failing.snapshot(owner), error => error.code !== 'SOURCE_RETIRED'); }
    finally { failing.close(); }
  }
});

test('the RuneMetrics adapter refuses cache and in-flight replies after the sunset', async t => {
  let now = beforeSunset, release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createRuneMetricsClient({ clock: () => now, fetchImpl: async url => { await gate; return legacyFetch(url); } });
  t.after(() => client.close());
  const request = client.snapshot(owner);
  now = RUNE_METRICS_SUNSET_AT; release();
  await assert.rejects(request, { code: 'SOURCE_RETIRED' });
  await assert.rejects(client.snapshot(owner), { code: 'SOURCE_RETIRED' });
});

test('fresh plugin data remains available after sunset', async t => {
  const plugin = createPluginProgressSource({ clock: () => RUNE_METRICS_SUNSET_AT });
  plugin.receive(owner.id, live(RUNE_METRICS_SUNSET_AT));
  const sources = createProgressSources({ clock: () => RUNE_METRICS_SUNSET_AT, pluginSnapshot: member => plugin.snapshot(member),
    runeMetrics: { fetchImpl: () => { throw new Error('No web fetch expected'); } } });
  t.after(() => sources.close());
  assert.equal((await sources.snapshot(owner)).source, 'game-plugin');
});

test('one configured replacement adapter supplies normalized progress with truthful, undoable provenance', async t => {
  const state = createGroupState([{ id: owner.id, name: 'Player', runescapeName: owner.runescapeName }]);
  state.members[0].runescapeName = owner.runescapeName;
  const mapping = createQuestMapping({ challenges: { Quest: { 'Vampyre Slayer': { QuestPoints: 3 } } } });
  state.tasks = [...mapping.values()].flat().map(row => ({ id: row.taskId, label: row.label, category: 'Quest' }));
  const sources = createProgressSources({ clock: () => beforeSunset, webSource: 'official-api',
    officialApi: { async snapshot(member) { assert.equal(member.id, owner.id); return { source: 'official-api', sourceLabel: 'RuneScape API',
      fetchedAt: new Date(beforeSunset).toISOString(), skills: live(beforeSunset).skills, quests: [{ title: 'Vampire Slayer', status: 'COMPLETED' }] }; } },
    runeMetrics: { fetchImpl: () => { throw new Error('Legacy source must not run'); } } });
  t.after(() => sources.close());
  const proposal = previewProgress(state, owner.id, await sources.snapshot(owner), mapping);
  assert.equal(proposal.preview.sourceLabel, 'RuneScape API'); assert.equal(proposal.preview.quests.length, 1);
  const apply = (current, command) => applyCommand(current, command, { expectedRevision: current.revision });
  const applied = apply(state, proposal.command);
  validateState(applied);
  assert.equal(applied.members[0].skillProgress.Attack.source, 'official-api');
  assert.equal(applied.members[0].questProgress[state.tasks[0].id].source, 'official-api');
  assert.deepEqual(importBackup(exportBackup(applied)).members, applied.members);
  assert.deepEqual(apply(applied, { type: 'undo' }).members, state.members);
});

test('all progress sources feed account levels, training and quest availability with their binding intact', () => {
  const engine = createTaskEngine({ chunks: { '100': {} }, challenges: { Extra: { 'Cook requirement': { SkillsNeeded: { Cooking: 30 } } } } });
  for (const source of ['runemetrics', 'official-api', 'game-plugin']) {
    const state = createGroupState([{ id: owner.id, name: 'Player', unlocked: ['100'] }]);
    const member = state.members[0]; member.runescapeName = owner.runescapeName;
    const provenance = { source, fetchedAt: new Date(beforeSunset).toISOString(),
      ...(source === 'game-plugin' ? { memberId: owner.id } : { runescapeName: owner.runescapeName }) };
    member.skillProgress = { Cooking: { level: 30, xp: 13400.5, ...provenance } };
    member.questProgress = { 'quest:test': { title: 'Synthetic Quest', ...provenance } };
    member.completedTasks = ['quest:test'];
    assert.equal(trainingProgress(member, 'Cooking').level, 30);
    assert.equal(trainingProgress(member, 'Cooking').source, source);
    assert.equal(personalSkillProgress(member).Cooking.level, 30);
    assert.equal(customTaskDoable({ id: 'custom:test', skill: 'Cooking', level: 30 }, member), true);
    assert.equal(engine.evaluate(state, owner.id).training.Cooking.observedLevel, 30);
    const availability = buildTrainingAvailability({ tasks: [] }, { state, memberId: owner.id });
    assert.equal(availability.skills.Cooking, 30); assert.ok(availability.completedQuests.includes('Synthetic Quest'));
    const wrongBinding = source === 'game-plugin' ? { ...member, id: 'other' } : { ...member, runescapeName: 'Other' };
    assert.equal(progressBelongsToMember(member.skillProgress.Cooking, wrongBinding), false);
    assert.equal(trainingProgress(wrongBinding, 'Cooking').level, null);
    assert.equal(personalSkillProgress(wrongBinding).Cooking, undefined);
  }
});

test('plugin progress arriving during a web failure still takes priority', async t => {
  let latest = null, fail;
  const gate = new Promise((resolve, reject) => { fail = reject; });
  const sources = createProgressSources({ clock: () => beforeSunset, pluginSnapshot: () => latest,
    runeMetrics: { fetchImpl: () => gate } });
  t.after(() => sources.close());
  const request = sources.snapshot(owner);
  latest = { source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: new Date(beforeSunset).toISOString(), skills: live(beforeSunset).skills, quests: [] }; fail(new Error('Web offline'));
  const result = await request; assert.equal(result.source, 'game-plugin'); assert.equal(result.skills[0].level, 5);
});

test('plugin progress works without a web account name and older reports cannot replace newer observations', async t => {
  const plugin = createPluginProgressSource({ clock: () => beforeSunset });
  plugin.receive(owner.id, live(beforeSunset));
  plugin.receive(owner.id, live(beforeSunset - 1000, { skills: [{ skill: 'Attack', level: 4, xp: 300 }] }));
  const unnamed = { id: owner.id };
  const sources = createProgressSources({ clock: () => beforeSunset, pluginSnapshot: member => plugin.snapshot(member),
    runeMetrics: { fetchImpl: () => { throw new Error('No web request expected'); } } });
  t.after(() => sources.close());
  assert.equal((await sources.snapshot(unnamed)).skills[0].level, 5);
  plugin.clear();
  assert.equal((await sources.snapshot(unnamed)).available, false);
});
