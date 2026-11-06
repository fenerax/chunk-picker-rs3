import test, { beforeEach } from 'node:test';
import { blockUnmockedFetch } from './helpers/block-unmocked-fetch.mjs';
import assert from 'node:assert/strict';
import { createProgressSources as createSources, createPluginProgressSource, createOfficialApiSource, previewProgress } from '../app/integrations/progress-sources.mjs';
import { platformResponse } from './helpers/platform-api-fixtures.mjs';
import { createQuestMapping } from '../app/integrations/quest-mapping.mjs';
import { PROGRESS_UNAVAILABLE_MESSAGE, PLUGIN_PROGRESS_FRESH_MS } from '../app/integrations/progress-source-policy.mjs';
import { applyCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { progressBelongsToMember } from '../app/core/game-progress.mjs';
import { trainingProgress, buildTrainingAvailability } from '../app/tasks/training-availability.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { personalSkillProgress } from '../app/web/helper-model.mjs';
import { customTaskDoable } from '../app/web/custom-tasks-model.mjs';

beforeEach(t => blockUnmockedFetch(t));

const createProgressSources = options => createSources({ webSource: 'runemetrics', hiscores: { async snapshot() { throw new Error('Synthetic hiscores unavailable'); } }, ...options });
const RUNE_METRICS_SUNSET_AT = Date.parse('2026-11-10T00:00:00Z');
const beforeSunset = RUNE_METRICS_SUNSET_AT - 1000;
const owner = { id: 'actor1', runescapeName: 'Player x' };
const live = (at, extra = {}) => ({ sentAt: new Date(at).toISOString(), world: { beta: false },
  skills: [{ skill: 'Attack', level: 5, xp: 400 }], ...extra });
const legacyFetch = platformResponse;

test('fresh live plugin observations win per member; stale observations fall back to the web', async t => {
  let now = beforeSunset - PLUGIN_PROGRESS_FRESH_MS, calls = 0;
  const plugin = createPluginProgressSource({ clock: () => now });
  const sources = createProgressSources({ clock: () => now, pluginSnapshot: member => plugin.snapshot(member),
    runeMetrics: { fetchImpl: async url => { calls++; return legacyFetch(url); } } });
  t.after(() => sources.close());
  plugin.receive(owner.id, live(now));
  const mixed = await sources.snapshot(owner);
  assert.equal(mixed.skills[0].level, 5); assert.equal(mixed.skills[0].provenance.source, 'game-plugin'); assert.equal(calls, 2);
  assert.equal((await sources.snapshot({ ...owner, id: 'other' })).source, 'platform-api'); assert.equal(calls, 4);
  now += PLUGIN_PROGRESS_FRESH_MS;
  assert.equal((await sources.snapshot(owner)).source, 'platform-api'); assert.equal(calls, 6);
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

test('the official API compatibility factory supplies Platform progress', async t => {
  const source = createOfficialApiSource({ fetchImpl: platformResponse });
  t.after(() => source.close());
  assert.equal((await source.snapshot(owner)).source, 'platform-api');
});

for (const at of [RUNE_METRICS_SUNSET_AT - 1, RUNE_METRICS_SUNSET_AT, RUNE_METRICS_SUNSET_AT + 1]) {
  for (const webSource of ['runemetrics', 'official-api']) test(`${webSource} configuration uses Platform at ${at}`, async t => {
    const urls = [];
    const sources = createProgressSources({ webSource, clock: () => at, runeMetricsEnabled: false,
      runeMetrics: { fetchImpl: async url => { urls.push(String(url)); assert.equal(url.origin, 'https://secure.runescape.com'); return platformResponse(url); } } });
    t.after(() => sources.close());
    assert.equal((await sources.snapshot(owner)).source, 'platform-api');
    assert.equal(urls.length, 2);
  });
}

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
  for (const source of ['runemetrics', 'platform-api', 'official-api', 'hiscores', 'game-plugin']) {
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


test('default Platform web source overlays plugin facts and keeps transient QP', async t => {
  const calls = [];
  const sources = createSources({ runeMetrics: { fetchImpl: async url => { calls.push(url.origin); return platformResponse(url); } },
    pluginSnapshot: () => ({ source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: '2026-11-04T12:00:00Z',
      skills: [{ skill: 'Attack', level: 8, xp: 850.5 }], quests: [] }),
    hiscores: { async snapshot() { throw new Error('Fallback must not run on a successful pair'); } } });
  t.after(() => sources.close());
  const member = { id: 'actor1', runescapeName: 'ExampleHero' };
  const snapshot = await sources.snapshot(member);
  assert.deepEqual(calls, ['https://secure.runescape.com', 'https://secure.runescape.com'], 'Healthy Platform sync never contacts RuneMetrics');
  assert.equal(snapshot.source, 'platform-api'); assert.equal(snapshot.sourceLabel, 'Platform API + game plugin');
  assert.equal(snapshot.skills.find(row => row.skill === 'Attack').level, 8);
  assert.equal(snapshot.skills.find(row => row.skill === 'Attack').provenance.source, 'game-plugin');
  assert.equal(snapshot.skills.find(row => row.skill === 'Defence').level, 9);
  assert.deepEqual(snapshot.questPoints, { current: 17, max: 450 });
  const review = previewProgress({ revision: 0, members: [{ ...member, completedTasks: [] }], tasks: [] }, member.id, snapshot, new Map());
  assert.equal(review.command.skills.find(row => row.skill === 'Attack').xp, 850.5, 'Plugin XP precision survives the Platform overlay');
});

test('default Platform failure retains the nondecreasing Hiscores fallback', async t => {
  const calls = [];
  const sources = createSources({ runeMetrics: { fetchImpl: async url => {
    calls.push(url.origin);
    assert.equal(url.origin, 'https://secure.runescape.com');
    throw new Error('Synthetic Platform outage');
  } },
    hiscores: { async snapshot() { return { source: 'hiscores', sourceLabel: 'RS3 hiscores', fetchedAt: '2026-11-04T12:00:00Z', cached: false,
      skills: [{ skill: 'Attack', level: 4, xp: 300 }, { skill: 'Defence', level: 9, xp: 1000 }], quests: [] }; } } });
  t.after(() => sources.close());
  const member = { id: 'actor1', runescapeName: 'ExampleHero',
    skillProgress: { Attack: { source: 'official-api', runescapeName: 'ExampleHero', level: 7, xp: 700 } } };
  const before = structuredClone(member), snapshot = await sources.snapshot(member);
  assert.equal(snapshot.source, 'hiscores');
  assert.deepEqual(calls, ['https://secure.runescape.com', 'https://secure.runescape.com']);
  assert.equal(snapshot.message, undefined, 'Platform failure does not report RuneMetrics closure');
  assert.deepEqual(snapshot.skills.map(row => row.skill), ['Attack', 'Defence']);
  const review = previewProgress({ revision: 0, members: [{ ...member, completedTasks: [] }], tasks: [] }, member.id, snapshot, new Map());
  assert.deepEqual(review.preview.skills.map(row => row.skill), ['Defence']);
  assert.deepEqual(review.command.skills.map(row => row.skill), ['Defence']);
  assert.equal(snapshot.questPoints, undefined); assert.deepEqual(member, before);
});

// Both Platform endpoints may fail independently; no path can revive the dead host.
for (const failure of ['404', '410', 'HTML', 'timeout', 'DNS']) {
  for (const webSource of ['platform-api', 'runemetrics', 'official-api']) {
    test(`${webSource}: ${failure} preserves saved progress and never contacts RuneMetrics`, async t => {
      const calls = [], signals = [];
      const fetchImpl = async (url, { signal }) => {
        calls.push(String(url)); signals.push(signal);
        assert.equal(url.origin, 'https://secure.runescape.com');
        if (failure === 'timeout') return new Promise(() => {});
        if (failure === 'DNS') throw Object.assign(new Error('Synthetic DNS failure'), { code: 'ENOTFOUND' });
        return new Response('<html>Unavailable</html>', { status: failure === 'HTML' ? 200 : Number(failure) });
      };
      const sources = createSources({ webSource, platformApi: { fetchImpl, timeoutMs: 15 },
        hiscores: { async snapshot() { throw new Error('Synthetic Hiscores outage'); } } });
      t.after(() => sources.close());
      const member = { ...owner, completedTasks: ['quest:synthetic'], skillProgress: {
        Attack: { source: 'runemetrics', runescapeName: owner.runescapeName, level: 9, xp: 1000.5 } } };
      const before = structuredClone(member);
      for (let attempt = 0; attempt < 2; attempt++) {
        const value = await sources.snapshot(member);
        assert.equal(value.available, false); assert.equal(value.message, PROGRESS_UNAVAILABLE_MESSAGE);
        assert.equal(value.skills, undefined); assert.equal(value.quests, undefined);
        assert.deepEqual(member, before);
      }
      assert.equal(calls.length, 4, 'One pair per explicit sync; no legacy requests or automatic retries');
      assert.ok(calls.every(url => new URL(url).origin === 'https://secure.runescape.com'));
      assert.ok(signals.every(signal => signal.aborted));
    });
  }
}

test('Platform failure retains stored and newly arriving plugin observations without Hiscores', async t => {
  const at = new Date(beforeSunset).toISOString();
  const member = { ...owner, skillProgress: { Attack: { level: 8, xp: 850.5, source: 'game-plugin', memberId: owner.id, fetchedAt: at } } };
  const sources = createSources({ platformApi: { fetchImpl: async () => { throw new Error('Synthetic outage'); } },
    pluginSnapshot: () => ({ source: 'game-plugin', sourceLabel: 'Game plugin', fetchedAt: at,
      skills: [{ skill: 'Cooking', level: 6, xp: 600.5 }], quests: [] }),
    hiscores: { snapshot() { assert.fail('Plugin observations suppress Hiscores'); } } });
  t.after(() => sources.close());
  const snapshot = await sources.snapshot(member);
  assert.equal(snapshot.source, 'game-plugin');
  assert.equal(snapshot.skills.find(row => row.skill === 'Attack').xp, 850.5);
  assert.equal(snapshot.skills.find(row => row.skill === 'Cooking').xp, 600.5);
  assert.equal(snapshot.message, PROGRESS_UNAVAILABLE_MESSAGE);
});
