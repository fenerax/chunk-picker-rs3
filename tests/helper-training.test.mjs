import { createRequestReader, requestError } from '../app/web/live-swap-client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTraining, trainingTargets, trainingActionsPerHour, nextBetterTrainingMethod } from '../app/web/helper-training.mjs';

class Node {
  constructor(tag) { Object.assign(this, { tag, textContent: '', children: [], events: {}, attributes: {}, value: '', hidden: false, checked: false }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, callback) { this.events[event] = callback; }
  removeEventListener(event, callback) { if (this.events[event] === callback) delete this.events[event]; }
}
const catalogue = {
  skills: [{ skill: 'Firemaking', status: 'trainable', f2pCap: 110, sourceIds: ['skills'] }, { skill: 'Mining', status: 'trainable', f2pCap: 110 }, { skill: 'Agility', status: 'trial', f2pCap: 5 }, { skill: 'Invention', status: 'unavailable', f2pCap: 1 }],
  methods: [
    { id: 'burn', skill: 'Firemaking', label: 'Burn logs', level: 1, members: false, xpPerAction: 100, inputs: [{ item: 'Logs', quantity: 1 }], assumptions: ['Processing model assumes 80% uptime.', 'GE guide price is opportunity cost.'], sourceIds: ['logs', 'ge'] },
    { id: 'fast', skill: 'Firemaking', label: 'Burn better logs', level: 15, members: false, xpPerAction: 200, sourceIds: ['logs'] },
    { id: 'members', skill: 'Firemaking', label: 'Members bonfire', level: 10, members: true, xpPerAction: 400 },
  ], sources: [{ id: 'logs', title: 'Logs', url: 'https://runescape.wiki/w/Logs', revision: 1234 }, { id: 'skills', title: 'Skills', url: 'https://runescape.wiki/w/Skills?oldid=5678', revision: 5678 }, { id: 'ge', title: 'GE prices', url: 'https://api.weirdgloop.org/prices' }],
};
const plan = {
  memberId: 'a', skill: 'Firemaking', fromLevel: 10, toLevel: 20, cap: 110, xpNeeded: 1000, status: 'partial', progress: { source: 'runemetrics' },
  plans: { 'best-xp': { complete: true, hours: 1, segments: [{ methodId: 'burn', label: 'Burn logs', fromLevel: 10, toLevel: 20, xpPerHour: 1000, xpPerAction: 100, actions: 10, hours: 1, inputs: [{ item: 'Logs', totalQuantity: 10 }], outputs: [], netGp: 900000, priceDate: '2026-10-07' }] }, balanced: { segments: [] }, 'money-making': { segments: [] } },
  availableMethods: [{ methodId: 'burn', label: 'Burn logs', level: 1, eligibleNow: true, xpPerHour: 1000 }],
  lockedMethods: [{ methodId: 'fast', label: 'Burn better logs', level: 15, xpPerHour: 2000, maxLevel: 110, blockers: [{ kind: 'quest', name: 'Example quest' }, { kind: 'object', name: 'Better tree[+]', locations: [{ locationId: '1234-1', label: 'Forest' }] }] }],
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const miningCatalogue = () => ({ ...structuredClone(catalogue), methods: [...catalogue.methods, { id: 'mining.runite', skill: 'Mining', label: 'Mine runite ore', level: 50, members: false, xpPerAction: null, miningCurve: { rockId: 'runite' }, sourceIds: ['mining'] }], sources: [...catalogue.sources, { id: 'mining', title: 'Mining', url: 'https://runescape.wiki/w/Mining', revision: 37194674 }] });
const miningPlan = () => {
  const method = { methodId: 'mining.runite', label: 'Mine runite ore', level: 50, eligibleNow: true, xpPerHour: 85000, orePerHour: 550,
    mining: { pickaxeId: 'rune+3', pickaxeLabel: 'Rune pickaxe + 3', profileId: 'active', damagePerSwing: 100, swingsPerOre: 6, staminaMultiplier: 1, miningLevel: 50, sourceVersion: 'mining-v1', strengthSource: 'conservative-default' } };
  return { memberId: 'a', skill: 'Mining', fromLevel: 50, toLevel: 55, xpNeeded: 100000, status: 'ready', progress: { source: 'runemetrics' },
    plans: { 'best-xp': { complete: true, hours: 1.2, segments: [{ ...method, fromLevel: 50, toLevel: 55, hours: 1.2, actions: null, inputs: [], outputs: [{ item: 'Runite ore', totalQuantity: 660 }], xpPerHourStart: 80000, xpPerHourEnd: 90000, orePerHourStart: 500, orePerHourEnd: 600 }] } }, availableMethods: [method], lockedMethods: [] };
};
const woodcuttingCatalogue = () => ({ ...structuredClone(catalogue), skills: [...catalogue.skills, { skill: 'Woodcutting', status: 'trainable', f2pCap: 99 }],
  methods: [...catalogue.methods, { id: 'woodcutting.yew', skill: 'Woodcutting', label: 'Cut yew logs', level: 70, members: false, xpPerAction: 187.5, woodcuttingCurve: { treeId: 'yew' }, sourceIds: ['woodcutting'] }],
  sources: [...catalogue.sources, { id: 'woodcutting', title: 'Woodcutting', url: 'https://runescape.wiki/w/Woodcutting', revision: 37196294 }] });
const woodcuttingPlan = () => {
  const method = { methodId: 'woodcutting.yew', label: 'Cut yew logs', level: 70, eligibleNow: true, xpPerHour: 12000.3, logsPerHour: 64.2,
    woodcutting: { hatchetId: 'rune', hatchetLabel: 'Rune hatchet', chopChance: 0.1, attemptsPerLog: 10, fellingChance: 0.125, respawnSeconds: 15, downtimePerLogSeconds: 1.875, sourceVersion: 'woodcutting-v1' } };
  return { memberId: 'a', skill: 'Woodcutting', fromLevel: 75, toLevel: 80, xpNeeded: 100000, status: 'ready', progress: { source: 'runemetrics' },
    plans: { 'best-xp': { complete: true, hours: 8.3, segments: [{ ...method, fromLevel: 75, toLevel: 80, hours: 8.3, actions: null, inputs: [], outputs: [{ item: 'Yew logs', totalQuantity: 533.3 }], logsProduced: 533.3, xpPerHourStart: 10000.3, xpPerHourEnd: 14000.2, logsPerHourStart: 53.3, logsPerHourEnd: 74.7 }] } }, availableMethods: [method], lockedMethods: [] };
};
function harness({ saved = true, account = 'Account', result, apiOverride, target, stateRevision, draft, savedXp = 1200, advanced = false, canWrite = false, command, preferences = {}, miningLevel, woodcuttingLevel } = {}) {
  const host = new Node('div'), document = { createElement: tag => new Node(tag) }, calls = [];
  const member = { id: 'a', name: 'Player', runescapeName: account, skillProgress: saved ? { Firemaking: { level: 10, xp: savedXp, source: 'runemetrics', runescapeName: 'Account', fetchedAt: '2026-10-10T00:00:00Z' } } : {} };
  if (miningLevel) member.skillProgress.Mining = { level: miningLevel, xp: 10000, source: 'runemetrics', runescapeName: 'Account' };
  if (woodcuttingLevel) member.skillProgress.Woodcutting = { level: woodcuttingLevel, xp: 10000, source: 'runemetrics', runescapeName: 'Account' };
  const initial = structuredClone(member); let current = true, resultReads = 0;
  let tasks = result ?? { presentation: { tasks: [{ label: 'Achievement goal', category: 'Diary', status: 'available', record: { Skills: { Firemaking: 20 } } }] } };
  const api = async (path, body, signal) => { calls.push({ path, body, signal }); return apiOverride ? apiOverride(path, signal) : path === '/api/training-catalogue' ? structuredClone(catalogue) : structuredClone(plan); };
  const dispose = renderTraining(host, { document, api, member, target, stateRevision, draft, advanced, canWrite: () => canWrite, command, getPreferences: () => preferences, getResult: () => { resultReads++; return tasks; }, isCurrent: () => current });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nodes = () => walk(host);
  const find = (tag, text) => nodes().find(node => node.tag === tag && (text === undefined || node.textContent === text));
  // A field is a label holding its text and its control, in either order (checkboxes come first).
  const field = label => nodes().find(node => node.tag === 'label' && node.children.some(child => child.textContent === label))?.children.find(child => child.textContent !== label);
  const text = () => nodes().map(node => node.textContent).filter(Boolean).join('\n');
  const submit = () => find('form').events.submit({ preventDefault() {} });
  return { host, calls, member, initial, dispose, nodes, find, field, text, submit, setResult: value => { tasks = value; }, resultReads: () => resultReads, stale: () => { current = false; } };
}

test('active targets use personal unfinished tasks and requirements without training ceilings', () => {
  const task = (level, extra = {}) => ({ category: 'Firemaking', status: 'available', level, label: `Level ${level}`, ...extra });
  const result = { training: { Firemaking: { level: 99 } }, presentation: { tasks: [task(20), task(20, { label: 'Other task' }), task(30, { personalCompleted: true }), task(40, { challengeSatisfied: true }), task(50, { obligation: false }), task(120), { category: 'Diary', status: 'available', label: 'Diary', record: { Skills: { Firemaking: 60 } } }] } };
  assert.deepEqual(trainingTargets(result, 'Firemaking', 110, 10), [{ level: 20, labels: ['Level 20', 'Other task'] }, { level: 60, labels: ['Diary'] }]);
});

test('Mining shows separate XP and ore rates, assumed tool and attention with Advanced-only mechanics', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ target: { skill: 'Mining', level: 55 }, miningLevel: 50, advanced, apiOverride: path => path === '/api/training-catalogue' ? miningCatalogue() : miningPlan() });
    await tick(); await h.submit();
    assert.match(h.text(), /80,000–90,000 XP\/hour estimated/); assert.match(h.text(), /500–600 ore\/hour estimated/);
    assert.match(h.text(), /85,000 XP\/hour estimated · 550 ore\/hour estimated/);
    assert.match(h.text(), /Assumed: Rune pickaxe \+3 · Active clicking · at the rock, no banking/);
    assert.match(h.text(), /Produces 660 Runite ore/); assert.doesNotMatch(h.text(), /actions\/hour|XP\/action|Action count/);
    assert.match(h.text(), /Strength is not synced/);
    if (advanced) { assert.match(h.text(), /100 damage per swing/); assert.match(h.text(), /6 swings per ore/); assert.match(h.text(), /Stamina damage: 100%/); assert.match(h.text(), /revision 37194674/); }
    else assert.doesNotMatch(h.text(), /damage per swing|swings per ore|Stamina damage|Rate source version|revision 37194674/);
    assert.equal(h.nodes().some(node => node.attributes['aria-label'] === 'Pickaxe'), false); h.dispose();
  }
});

test('Woodcutting uses whole XP/log rates and produced logs, with Advanced-only mechanics and no viewer controls', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ target: { skill: 'Woodcutting', level: 80 }, woodcuttingLevel: 75, advanced, apiOverride: path => path === '/api/training-catalogue' ? woodcuttingCatalogue() : woodcuttingPlan() });
    await tick(); await h.submit();
    assert.match(h.text(), /10,000–14,000 XP\/hour estimated · 53–75 logs\/hour estimated/);
    assert.match(h.text(), /12,000 XP\/hour estimated · 64 logs\/hour estimated/);
    assert.match(h.text(), /Assumed: Rune hatchet · at the tree, no banking/); assert.match(h.text(), /Produces about 533 Yew logs/);
    assert.doesNotMatch(h.text(), /actions\/hour|XP\/action|Action count unknown|ore\/hour/);
    assert.match(h.text(), /one tree, waiting for it to respawn and clicking again immediately/);
    assert.equal(h.nodes().some(node => node.attributes['aria-label'] === 'Hatchet'), false);
    if (advanced) {
      assert.match(h.text(), /Chop chance: 10%/); assert.match(h.text(), /10 attempts per log/); assert.match(h.text(), /Felling chance: 12.5%/);
      assert.match(h.text(), /Respawn: 15 seconds/); assert.match(h.text(), /Downtime per log: 1.9 seconds/); assert.match(h.text(), /revision 37196294/);
    } else assert.doesNotMatch(h.text(), /Chop chance|attempts per log|Felling chance|Respawn:|Downtime per log|Rate source version|revision 37196294/);
    h.dispose();
  }
});

test('Fishing shows whole mixed-catch rates, assumptions once and Advanced-only chances without new settings', async () => {
  const record = { id: 'fishing.fly-mixed', skill: 'Fishing', label: 'Fly fish trout and salmon', level: 30, members: false,
    fishingCurve: { methodId: 'fly-fishing' }, inputs: [{ item: 'Feather', quantity: 1 }], sourceIds: ['fishing'] };
  const fishingCatalogue = { ...catalogue, skills: [...catalogue.skills, { skill: 'Fishing', status: 'trainable', f2pCap: 99 }],
    methods: [...catalogue.methods, record], sources: [...catalogue.sources, { id: 'fishing', title: 'Fishing calculator', url: 'https://runescape.wiki/w/Module:Fishing_chance_calculator?oldid=37011173', revision: 37011173 }] };
  const species = [{ id: 'salmon', label: 'Salmon', fishPerHour: 100.4, fishProduced: 200.8, rawChance: .1, catchChance: .1 },
    { id: 'trout', label: 'Trout', fishPerHour: 300.2, fishProduced: 600.4, rawChance: .3, catchChance: .27 }];
  const method = { methodId: record.id, label: record.label, level: 30, eligibleNow: true, xpPerHour: 25000.3, fishPerHour: 400.6,
    species, fishing: { attemptTicks: 4, species, sourceVersion: 'fishing-v1' } };
  const data = { ...plan, skill: 'Fishing', fromLevel: 30, toLevel: 32, lockedMethods: [], availableMethods: [method],
    plans: { 'best-xp': { complete: true, hours: 2, segments: [{ ...method, fromLevel: 30, toLevel: 32, hours: 2,
      actions: null, inputs: [{ item: 'Feather', totalQuantity: 801.2 }], outputs: [] }] } } };
  for (const advanced of [false, true]) {
    const h = harness({ target: { skill: 'Fishing', level: 32 }, advanced, apiOverride: path => path === '/api/training-catalogue' ? fishingCatalogue : data });
    await tick(); h.field('Temporary starting level').value = '30'; await h.submit();
    assert.match(h.text(), /25,000 XP\/hour estimated · 401 fish\/hour estimated \(100 salmon\/hour, 300 trout\/hour\)/);
    assert.equal(h.text().split('At the spot, no banking, not counting spot moves.').length - 1, 1);
    assert.equal(h.text().split('Dropping, storing the catch, travel').length - 1, 1);
    assert.match(h.text(), /Catches about 201 salmon/); assert.match(h.text(), /Catches about 600 trout/);
    assert.match(h.text(), /Gather or obtain about 801 feathers/); assert.match(h.text(), /Per catch: 1 feather/);
    assert.doesNotMatch(h.text(), /actions\/hour|XP\/action|Action count|Tool tier|Fishing settings/);
    if (advanced) { assert.match(h.text(), /Salmon roll chance: 10%/); assert.match(h.text(), /catch chance per attempt: 27%/); assert.match(h.text(), /revision 37011173/); }
    else assert.doesNotMatch(h.text(), /roll chance|Rate source version|revision 37011173/);
    assert.deepEqual(h.member, h.initial); h.dispose();
  }
});


test('Woodcutting saving cancels an old plan, rolls back failure and ignores detached saves', async () => {
  const pendingPlan = deferred(), pendingSave = deferred(), preferences = { woodcuttingHatchet: 'auto' };
  const h = harness({ canWrite: true, command: () => pendingSave.promise, preferences, woodcuttingLevel: 75, target: { skill: 'Woodcutting', level: 80 }, apiOverride: path => path === '/api/training-catalogue' ? woodcuttingCatalogue() : pendingPlan.promise });
  await tick(); const request = h.submit(), hatchet = h.nodes().find(node => node.attributes['aria-label'] === 'Hatchet');
  hatchet.value = 'rune'; const saving = hatchet.events.change(); assert.equal(h.calls[1].signal.aborted, true); assert.equal(hatchet.disabled, true);
  assert.equal(h.find('button', 'Plan my grind').disabled, true);
  pendingSave.reject(Error('Save rejected')); await saving; assert.equal(hatchet.value, 'auto'); assert.equal(hatchet.disabled, false); assert.match(h.text(), /Save rejected/);
  pendingPlan.resolve(woodcuttingPlan()); await request; assert.equal(h.find('h3', 'Woodcutting 75 → 80'), undefined);
  const detachedSave = deferred(), detached = harness({ canWrite: true, command: () => detachedSave.promise, target: { skill: 'Woodcutting', level: 80 }, apiOverride: () => woodcuttingCatalogue() });
  await tick(); const control = detached.nodes().find(node => node.attributes['aria-label'] === 'Hatchet'); control.value = 'rune'; const late = control.events.change(); detached.dispose(); const before = detached.text();
  detachedSave.reject(Error('Late save error')); await late; assert.equal(detached.text(), before); h.dispose();
});


test('Mining save aborts pending plan, rolls back failures and ignores late detached errors', async () => {
  const pendingPlan = deferred(), pendingSave = deferred(), preferences = { miningAttention: 'active' };
  const h = harness({ canWrite: true, command: () => pendingSave.promise, preferences, miningLevel: 50, target: { skill: 'Mining', level: 55 }, apiOverride: path => path === '/api/training-catalogue' ? miningCatalogue() : pendingPlan.promise });
  await tick(); const request = h.submit(), attention = h.nodes().find(node => node.attributes['aria-label'] === 'Attention');
  attention.value = 'afk'; const saving = attention.events.change(); assert.equal(h.calls[1].signal.aborted, true); assert.equal(attention.disabled, true);
  pendingSave.reject(Error('Save rejected')); await saving; assert.equal(attention.value, 'active'); assert.equal(attention.disabled, false); assert.match(h.text(), /Save rejected/);
  pendingPlan.resolve(miningPlan()); await request; assert.equal(h.find('h3', 'Mining 50 → 55'), undefined);
  const detachedSave = deferred(), detached = harness({ canWrite: true, command: () => detachedSave.promise, target: { skill: 'Mining', level: 55 } });
  await tick(); const control = detached.nodes().find(node => node.attributes['aria-label'] === 'Attention'); control.value = 'afk'; const late = control.events.change(); detached.dispose(); const before = detached.text();
  detachedSave.reject(Error('Late save error')); await late; assert.equal(detached.text(), before); h.dispose();
});

test('actions per hour requires a reviewed rate and known XP/action', () => {
  assert.equal(trainingActionsPerHour({ xpPerAction: 100 }, 1000), 10);
  assert.equal(trainingActionsPerHour({ xpPerAction: null, processingSeconds: 1 }, 1000), null);
  assert.equal(trainingActionsPerHour({ xpPerAction: 100, processingSeconds: 1 }, null), null);
});

test('targets recover cross-skill requirements from full rows behind compact active tasks', () => {
  const result = { presentation: { tasks: [{ id: 'goal', label: 'Goal', category: 'Diary' }] }, tasks: [{ id: 'goal', status: 'available', category: 'Diary', record: { Skills: { Mining: 20 }, SkillsNeeded: { Mining: 30 } } }] };
  assert.deepEqual(trainingTargets(result, 'Mining', 110, 10), [{ level: 30, labels: ['Goal'] }]);
});

test('compact active quest and achievement rows supply cross-skill targets without full records', () => {
  const tasks = [
    { id: 'quest', category: 'Quest', status: 'available', label: 'Quest goal', skillRequirements: { Mining: 20, Smithing: 10 } },
    { id: 'diary', category: 'Diary', status: 'available', label: 'Achievement goal', skillRequirements: { Mining: 30 } },
    { id: 'done', category: 'Diary', status: 'available', label: 'Completed goal', challengeSatisfied: true, skillRequirements: { Mining: 40 } },
  ];
  const result = { format: 'play-v1', tasks, presentation: { tasks } };
  assert.deepEqual(trainingTargets(result, 'Mining', 110, 10), [{ level: 20, labels: ['Quest goal'] }, { level: 30, labels: ['Achievement goal'] }]);
  assert.deepEqual(trainingTargets(result, 'Smithing', 110, 1), [{ level: 10, labels: ['Quest goal'] }]);
});

test('active targets omit blocked, hidden, shared completed families and placeholder alternative levels', () => {
  const task = (id, extra = {}) => ({ id, category: 'Firemaking', status: 'available', level: 20, label: id, ...extra });
  const tasks = [task('active'), task('blocked', { status: 'blocked' }), task('hidden', { hidden: true }), task('ledger'), task('saved'), task('alias', { aliases: ['done-alias'] }), task('family', { completionGroup: 'group' }), task('alternative', { level: 1, record: { RequirementAlternatives: [{ Skills: { Firemaking: 20 } }] } })];
  const result = { memberId: 'a', presentation: { tasks, completedTasks: [task('ledger')] }, collectionPlanning: { completionGroups: { group: ['group-done'] } } };
  const member = { id: 'a', completedTasks: ['saved', 'done-alias'], taskStatus: { 'group-done': { challengeCompleted: true } } };
  assert.deepEqual(trainingTargets(result, 'Firemaking', 110, 0, member), [{ level: 20, labels: ['active'] }]);
  assert.deepEqual(trainingTargets(result, 'Firemaking', 110, 0, { ...member, id: 'b' }), []);
});

test('next better method considers beyond-target unlocks within the F2P cap and ignores members', () => {
  const data = structuredClone(plan); data.toLevel = 12;
  data.lockedMethods.push({ methodId: 'members', level: 10, xpPerHour: 9000 }, { methodId: 'fast', level: 120, xpPerHour: 3000 });
  assert.equal(nextBetterTrainingMethod(data, catalogue).methodId, 'fast');
  assert.equal(nextBetterTrainingMethod(data, catalogue).level, 15);
  data.availableMethods[0].xpPerHour = 3000;
  assert.equal(nextBetterTrainingMethod(data, catalogue), null);
});

test('beyond-target method explains its later level while preserving the selected route', async () => {
  const future = structuredClone(plan); future.toLevel = 15; future.plans['best-xp'].segments[0].toLevel = 15; future.lockedMethods[0].level = 20;
  const h = harness({ target: { skill: 'Firemaking', level: 15 }, apiOverride: path => path === '/api/training-catalogue' ? catalogue : future });
  await tick(); await h.submit();
  assert.ok(h.find('h3', 'Firemaking 10 → 15')); assert.ok(h.find('h4', '10 → 15: Burn logs'));
  assert.ok(h.find('h4', 'Burn better logs · level 20')); assert.match(h.text(), /starts after your level 15 target/); h.dispose();
});

test('mount loads only catalogue; saved progress preserves exact XP and Ironman output excludes prices', async () => {
  const h = harness(); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, '/api/training-catalogue'); assert.equal(h.resultReads(), 1);
  assert.equal(h.field('Target').value, '20'); assert.ok(h.find('option', 'Agility · F2P trial to 5')); assert.equal(h.find('option', 'Invention'), undefined);
  assert.match(h.text(), /1,200 XP/); await h.submit();
  const query = new URL(h.calls[1].path, 'http://test').searchParams;
  assert.equal(query.get('memberId'), 'a'); assert.equal(query.get('preference'), 'best-xp'); assert.equal(query.has('fromLevel'), false); assert.equal(h.calls[1].body, undefined);
  assert.match(h.text(), /1,000 XP\/hour estimated/); assert.match(h.text(), /10 actions\/hour estimated/); assert.match(h.text(), /Gather or obtain 10 Logs/); assert.match(h.text(), /Complete Example quest on your account/); assert.match(h.text(), /Forest \(1234-1\)/);
  assert.doesNotMatch(h.text(), /Grand Exchange|\bGE\b|\bGP\b|Makes money|Balanced|900,000/);
  assert.equal(h.find('a', 'Logs').href, 'https://runescape.wiki/w/Logs?oldid=1234'); assert.equal(h.find('a', 'GE prices'), undefined);
  assert.deepEqual(h.member, h.initial); h.dispose();
});

test('sync date and rate assumptions use player wording in closed rate and supply details', async () => {
  const data = structuredClone(catalogue);
  data.methods[0].assumptions = [
    'Hourly processing estimate = sourced base recipe XP / action interval × 3,600 × 0.8. The 80% uptime for banking/interface/repair overhead is an authored assumption, not a measurement; material gathering and travel outside the facility still add unknown time.',
    'Uses the sourced solo bonfire baseline and exact 11/7/7 tick action interval; excludes bonfire level/player boosts and fire-spirit rewards.',
    'Uses current recipe XP per one-log action and 3 ticks; knife access is established by the engine, interface time outside the action interval is not measured.',
  ];
  const h = harness({ apiOverride: path => path === '/api/training-catalogue' ? data : plan }); await tick(); await h.submit();
  const date = new Date(h.member.skillProgress.Firemaking.fetchedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  assert.ok(h.text().includes(`Synced ${date}`)); assert.doesNotMatch(h.text(), /2026-10-10T00:00:00Z/);
  assert.match(h.text(), /80% of the time training/); assert.match(h.text(), /Gathering supplies and travel add extra time/);
  assert.match(h.text(), /Extra XP from your level, other players and fire spirits is excluded/);
  assert.doesNotMatch(h.text(), /\b(engines?|eligible|obligations?|derived|unresolved|components?|baseline|authored|modelled)\b/i);
  const details = h.nodes().filter(node => node.tag === 'details' && node.children[0]?.textContent === 'Rate and supply notes');
  assert.ok(details.length >= 2); assert.ok(details.every(node => node.open === false));
  assert.ok(h.find('p', 'Gather or obtain 10 Logs') || h.find('li', 'Gather or obtain 10 Logs')); h.dispose();
});

test('unknown or renamed personal account requests temporary start and never saves it', async () => {
  for (const options of [{ saved: false }, { account: 'New account' }]) {
    const h = harness(options); await tick();
    assert.match(h.text(), /personal level is not saved/); await h.submit(); assert.equal(h.calls.length, 1); assert.match(h.text(), /Starting level must be a whole level/);
    h.field('Temporary starting level').value = '12'; await h.submit();
    assert.equal(new URL(h.calls[1].path, 'http://test').searchParams.get('fromLevel'), '12'); assert.deepEqual(h.member, h.initial); h.dispose();
  }
});

test('temporary inputs reject fractional, blank and capped targets before requests', async () => {
  const h = harness({ saved: false }); await tick();
  const from = h.field('Temporary starting level'), target = h.field('Target'), custom = h.field('Custom target level');
  from.value = '1'; target.value = 'custom'; target.events.change();
  for (const value of ['', '1.5', '0', '111', 'Infinity', '1e2']) { custom.value = value; await h.submit(); assert.equal(h.calls.length, 1, value); }
  const skill = h.field('Skill'); skill.value = 'Agility'; skill.events.change();
  assert.match(h.text(), /F2P training stops at level 5/); from.value = '1'; custom.value = '6'; await h.submit(); assert.equal(h.calls.length, 1);
  from.value = '6'; custom.value = '5'; await h.submit(); assert.equal(h.calls.length, 1); assert.match(h.text(), /Starting level must be a whole level from 1 to 5/);
  h.dispose();
});

test('graph target prefill selects its skill and temporary target without an automatic plan', async () => {
  const h = harness({ target: { skill: 'Mining', level: 30 } }); await tick();
  assert.equal(h.field('Skill').value, 'Mining'); assert.equal(h.field('Target').value, 'custom'); assert.equal(h.field('Custom target level').value, '30');
  assert.ok(h.find('button', 'Plan my grind')); assert.equal(h.calls.length, 1); h.dispose();
  const capped = harness({ target: { skill: 'Agility', level: 30 } }); await tick();
  assert.equal(capped.field('Custom target level').value, '5'); assert.match(capped.text(), /F2P training stops at level 5/); capped.dispose();
});

test('input changes abort a pending plan and reject late response', async () => {
  const pending = deferred(); const h = harness({ apiOverride: path => path === '/api/training-catalogue' ? catalogue : pending.promise }); await tick();
  const request = h.submit(); const target = h.field('Target'); target.value = 'custom'; target.events.change();
  assert.equal(h.calls[1].signal.aborted, true); pending.resolve(plan); await request;
  assert.equal(h.find('h3', 'Firemaking 10 → 20'), undefined); assert.match(h.text(), /Target changed/); h.dispose();
});

test('newer plan wins even when an aborted request finishes later', async () => {
  const older = deferred(), newer = deferred(); let requests = 0;
  const h = harness({ apiOverride: path => path === '/api/training-catalogue' ? catalogue : ++requests === 1 ? older.promise : newer.promise }); await tick();
  const first = h.submit(), target = h.field('Target'); target.value = 'custom'; target.events.change(); h.field('Custom target level').value = '25';
  const second = h.submit(); newer.resolve({ ...plan, toLevel: 25 }); await second; older.resolve(plan); await first;
  assert.ok(h.find('h3', 'Firemaking 10 → 25')); assert.equal(h.find('h3', 'Firemaking 10 → 20'), undefined); h.dispose();
});

test('new task results preserve typed fields and pending plan without an API request', async () => {
  const pending = deferred(), h = harness({ apiOverride: path => path === '/api/training-catalogue' ? catalogue : pending.promise }); await tick();
  const override = h.field('Plan from a different starting level'); override.checked = true; override.events.change();
  h.field('Temporary starting level').value = '12'; h.field('Temporary starting level').events.input();
  const target = h.field('Target'); target.value = 'custom'; target.events.change();
  h.field('Custom target level').value = '25'; h.field('Custom target level').events.input();
  const request = h.submit();
  h.setResult({ presentation: { tasks: [{ id: 'new', label: 'New task', category: 'Firemaking', status: 'available', level: 30 }] } });
  h.dispose.refreshResult();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].signal.aborted, false);
  assert.equal(h.field('Temporary starting level').value, '12'); assert.equal(h.field('Custom target level').value, '25'); assert.equal(target.value, 'custom'); assert.equal(override.checked, true);
  assert.ok(h.find('option', 'Level 30 · New task')); assert.match(h.text(), /Planning with your current chunks/);
  pending.resolve({ ...plan, fromLevel: 12, toLevel: 25 }); await request;
  assert.ok(h.find('h3', 'Firemaking 12 → 25')); assert.deepEqual(h.member, h.initial); h.dispose();
});

test('a disappearing task target becomes custom at its old level without aborting the plan', async () => {
  const pending = deferred(), h = harness({ apiOverride: path => path === '/api/training-catalogue' ? catalogue : pending.promise }); await tick();
  const request = h.submit();
  h.setResult({ presentation: { tasks: [{ id: 'new', label: 'Later target', category: 'Firemaking', status: 'available', level: 30 }] } });
  h.dispose.refreshResult();
  assert.equal(h.field('Target').value, 'custom'); assert.equal(h.field('Custom target level').value, '20'); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].signal.aborted, false);
  pending.resolve(plan); await request; assert.ok(h.find('h3', 'Firemaking 10 → 20')); h.dispose();
});

test('temporary drafts restore controls and use fresh saved XP without saving', async () => {
  const draft = { skill: 'Firemaking', targetLevel: '25', manualFrom: '12', override: true };
  const h = harness({ draft, savedXp: 1300 }); await tick();
  assert.equal(h.field('Skill').value, 'Firemaking'); assert.equal(h.field('Custom target level').value, '25'); assert.equal(h.field('Temporary starting level').value, '12'); assert.equal(h.field('Plan from a different starting level').checked, true);
  assert.match(h.text(), /1,300 XP/); assert.deepEqual(h.dispose.getDraft(), draft); assert.equal(h.calls.length, 1); assert.deepEqual(h.member, h.initial); h.dispose();
  const fresh = harness({ draft: { ...draft, override: false }, savedXp: 1300, apiOverride: path => path === '/api/training-catalogue' ? catalogue : { ...plan, toLevel: 25 } });
  await tick(); await fresh.submit(); assert.equal(new URL(fresh.calls[1].path, 'http://test').searchParams.has('fromLevel'), false); assert.deepEqual(fresh.member, fresh.initial); fresh.dispose();
});

test('graph target replaces draft target and only keeps manual start for the same skill', async () => {
  const draft = { skill: 'Firemaking', targetLevel: '25', manualFrom: '12', override: true };
  const same = harness({ draft, target: { skill: 'Firemaking', level: 30 } }); await tick();
  assert.equal(same.field('Custom target level').value, '30'); assert.equal(same.field('Temporary starting level').value, '12'); assert.equal(same.field('Plan from a different starting level').checked, true); same.dispose();
  const other = harness({ draft, target: { skill: 'Mining', level: 30 } }); await tick();
  assert.deepEqual(other.dispose.getDraft(), { skill: 'Mining', targetLevel: '30', manualFrom: '', override: false }); assert.deepEqual(other.member, other.initial); other.dispose();
});

test('newer server save revision cannot render a plan before local picker refreshes', async () => {
  const h = harness({ stateRevision: 7, apiOverride: path => path === '/api/training-catalogue' ? catalogue : { ...plan, stateRevision: 8 } });
  await tick(); await h.submit();
  assert.equal(h.find('h3', 'Firemaking 10 → 20'), undefined);
  const message = h.find('p', 'The save changed while planning. Wait for the picker to refresh, then plan again.');
  assert.ok(message); assert.equal(message.attributes.role, 'alert'); assert.deepEqual(h.member, h.initial); h.dispose();
});

test('disposal and shell member change reject catalogue and plan responses', async () => {
  const loading = deferred(), first = harness({ apiOverride: () => loading.promise }); first.dispose(); loading.resolve(catalogue); await tick();
  assert.equal(first.calls[0].signal.aborted, true); assert.equal(first.find('option'), undefined); assert.equal(first.find('form').events.submit, undefined);
  const pending = deferred(), second = harness({ apiOverride: path => path === '/api/training-catalogue' ? catalogue : pending.promise }); await tick();
  const request = second.submit(); second.stale(); pending.resolve(plan); await request; assert.equal(second.find('h3'), undefined); second.dispose();
});

test('missing rate and variable material quantity stay unknown rather than zero', async () => {
  const unknown = { ...plan, plans: { 'best-xp': { complete: false, segments: [], hours: null } }, availableMethods: [{ methodId: 'burn', label: 'Burn logs', eligibleNow: true, xpPerHour: null }], lockedMethods: [] };
  const data = structuredClone(catalogue); data.methods[0].inputs[0].quantity = null;
  const h = harness({ apiOverride: path => path === '/api/training-catalogue' ? data : unknown }); await tick(); await h.submit();
  assert.match(h.text(), /Training time unknown/); assert.match(h.text(), /XP\/hour unknown · actions\/hour unknown · 100 base XP\/action/); assert.match(h.text(), /quantity unknown Logs/); assert.doesNotMatch(h.text(), /0 actions|0 minutes/); h.dispose();
});

test('request failure announces accessible error and allows retry', async () => {
  let attempt = 0;
  const h = harness({ apiOverride: path => { if (path === '/api/training-catalogue') return catalogue; if (++attempt === 1) throw new Error('Network unavailable. Try again.'); return plan; } });
  await tick(); await h.submit(); assert.match(h.text(), /Network unavailable/);
  assert.equal(h.find('p', 'Network unavailable. Try again.').attributes.role, 'alert');
  await h.submit(); assert.ok(h.find('h3', 'Firemaking 10 → 20')); h.dispose();
});

test('technical API error wording is translated for players', async () => {
  const h = harness({ apiOverride: path => { if (path === '/api/training-catalogue') return catalogue; throw new Error('Engines components unresolved; eligible obligations derived.'); } });
  await tick(); await h.submit(); assert.doesNotMatch(h.text(), /\b(engines?|components?|unresolved|eligible|obligations?|derived)\b/i); h.dispose();
});

test('Advanced reveals source revision numbers while Wiki evidence remains linked in both modes', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ advanced }); await tick(); await h.submit();
    assert.equal(h.text().includes('revision 1234'), advanced);
    assert.ok(h.nodes().some(node => node.tag === 'a' && node.href === 'https://runescape.wiki/w/Logs?oldid=1234'));
    assert.match(h.text(), /Gather or obtain 10 Logs/);
    assert.deepEqual(h.member, h.initial); h.dispose();
  }
});

for (const kind of [429, 503, 409, 413, 'offline', 'ECONNRESET']) test(`request failure ${kind}: training plan clears busy, retains inputs, and can plan again`, async () => {
  let failed = true;
  const read = createRequestReader({ fetch: async () => {
    if (failed && typeof kind === 'string') throw new TypeError(kind);
    return new Response(JSON.stringify(failed ? { message: 'Error: secret stack\n at internal (/private/file:1)' } : plan), { status: failed ? kind : 200 });
  } });
  const h = harness({ target: { skill: 'Firemaking', level: 20 }, apiOverride: async path => {
    if (path === '/api/training-catalogue') return structuredClone(catalogue);
    const { response, value } = await read(path); if (!response.ok) throw requestError(response, value); return value;
  } });
  await tick(); await h.submit();
  assert.doesNotMatch(h.text(), /Error:|secret stack|internal|ECONN/);
  assert.match(h.text(), /Too many requests|busy or restarting|saved map changed|too large|Check your internet/);
  assert.ok(h.nodes().filter(node => node.attributes['aria-busy']).every(node => node.attributes['aria-busy'] === 'false'));
  assert.equal(h.field('Skill').value, 'Firemaking');
  failed = false; await h.submit(); assert.match(h.text(), /Plan ready/);
  assert.deepEqual(h.member, h.initial); h.dispose();
});
