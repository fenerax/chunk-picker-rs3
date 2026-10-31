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
function harness({ f2p = true, saved = true, account = 'Account', result, apiOverride, target, stateRevision, draft, savedXp = 1200, advanced = false, canWrite = false, command, preferences = {}, miningLevel, woodcuttingLevel } = {}) {
  const host = new Node('div'), document = { createElement: tag => new Node(tag) }, calls = [];
  const member = { id: 'a', name: 'Player 1', runescapeName: account, skillProgress: saved ? { Firemaking: { level: 10, xp: savedXp, source: 'runemetrics', runescapeName: 'Account', fetchedAt: '2026-10-10T00:00:00Z' } } : {} };
  if (miningLevel) member.skillProgress.Mining = { level: miningLevel, xp: 10000, source: 'runemetrics', runescapeName: 'Account' };
  if (woodcuttingLevel) member.skillProgress.Woodcutting = { level: woodcuttingLevel, xp: 10000, source: 'runemetrics', runescapeName: 'Account' };
  const initial = structuredClone(member); let current = true, resultReads = 0;
  let tasks = result ?? { presentation: { tasks: [{ label: 'Achievement goal', category: 'Diary', status: 'available', record: { Skills: { Firemaking: 20 } } }] } };
  const api = async (path, body, signal) => { calls.push({ path, body, signal }); return apiOverride ? apiOverride(path, signal) : path === '/api/training-catalogue' ? structuredClone(catalogue) : structuredClone(plan); };
  const dispose = renderTraining(host, { document, api, member, f2p, target, stateRevision, draft, advanced, canWrite: () => canWrite, command, getPreferences: () => preferences, getResult: () => { resultReads++; return tasks; }, isCurrent: () => current });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nodes = () => walk(host);
  const find = (tag, text) => nodes().find(node => node.tag === tag && (text === undefined || node.textContent === text));
  // A field is a label holding its text and its control, in either order (checkboxes come first).
  const field = label => nodes().find(node => node.tag === 'label' && node.children.some(child => child.textContent === label))?.children.find(child => child.textContent !== label);
  const text = () => nodes().map(node => node.textContent).filter(Boolean).join('\n');
  const submit = () => find('form').events.submit({ preventDefault() {} });
  return { host, calls, member, initial, dispose, nodes, find, field, text, submit, setResult: value => { tasks = value; }, resultReads: () => resultReads, stale: () => { current = false; } };
}

test('Woodcutting hatchet saves personally without altering the temporary plan draft or account progress', async () => {
  const commands = [], preferences = {};
  const h = harness({ canWrite: true, command: async command => { commands.push(command); preferences[command.preferenceId] = command.value; }, preferences, apiOverride: path => path === '/api/training-catalogue' ? woodcuttingCatalogue() : woodcuttingPlan() });
  await tick(); const settings = h.nodes().find(node => node.className === 'helper-training-woodcutting'); assert.equal(settings.hidden, true);
  h.field('Skill').value = 'Woodcutting'; h.field('Skill').events.change(); assert.equal(settings.hidden, false);
  h.field('Temporary starting level').value = '75'; h.field('Temporary starting level').events.input();
  h.field('Custom target level').value = '80'; h.field('Custom target level').events.input();
  const hatchet = h.nodes().find(node => node.attributes['aria-label'] === 'Hatchet');
  assert.equal(hatchet.value, 'auto'); assert.equal(hatchet.children[0].textContent, 'Best for my level (Rune hatchet)');
  const before = h.dispose.getDraft(); hatchet.value = 'rune'; await hatchet.events.change();
  assert.deepEqual(commands, [{ type: 'set-preference', memberId: 'a', preferenceId: 'woodcuttingHatchet', value: 'rune' }]);
  assert.deepEqual(h.dispose.getDraft(), before); assert.deepEqual(h.member, h.initial); assert.match(h.text(), /Woodcutting settings saved/);
  h.field('Skill').value = 'Mining'; h.field('Skill').events.change(); assert.equal(settings.hidden, true); h.dispose();
});

test('Mining controls are personal saved choices and only visible for Mining, preserving temporary draft inputs', async () => {
  const commands = [], preferences = {};
  const h = harness({ canWrite: true, command: async command => { commands.push(command); preferences[command.preferenceId] = command.value; }, preferences, apiOverride: path => path === '/api/training-catalogue' ? miningCatalogue() : miningPlan() });
  await tick(); const settings = h.nodes().find(node => node.className === 'helper-training-mining'); assert.equal(settings.hidden, true);
  h.field('Skill').value = 'Mining'; h.field('Skill').events.change(); assert.equal(settings.hidden, false);
  h.field('Temporary starting level').value = '55'; h.field('Temporary starting level').events.input();
  h.field('Custom target level').value = '65'; h.field('Custom target level').events.input();
  const pick = h.nodes().find(node => node.attributes['aria-label'] === 'Pickaxe');
  const attention = h.nodes().find(node => node.attributes['aria-label'] === 'Attention');
  assert.equal(pick.value, 'auto'); assert.equal(pick.children[0].textContent, 'Best for my level (Rune pickaxe +3)'); assert.equal(attention.value, 'active');
  const before = h.dispose.getDraft(); attention.value = 'occasional'; await attention.events.change();
  assert.deepEqual(commands, [{ type: 'set-preference', memberId: 'a', preferenceId: 'miningAttention', value: 'occasional' }]);
  assert.deepEqual(h.dispose.getDraft(), before); assert.match(h.text(), /Mining settings saved/); assert.deepEqual(h.member, h.initial); h.dispose();
});



test('members planning accepts targets beyond a trial cap while F2P retains the cap', async () => {
  for (const f2p of [true, false]) {
    const h = harness({ f2p, saved: false, target: { skill: 'Agility', level: 50 } });
    await tick();
    const cap = Number(h.field('Custom target level').max);
    assert.equal(f2p ? cap === 5 : cap >= 99, true);
    assert.equal(Number(h.field('Temporary starting level').max), cap);
    assert.equal(h.field('Skill').children.find(node => node.value === 'Agility').textContent.includes('F2P trial'), f2p);
    if (!f2p) {
      h.field('Temporary starting level').value = '10';
      h.field('Custom target level').value = '50';
      await h.submit();
      assert.ok(h.calls.some(call => call.path.startsWith('/api/training-plan?') && call.path.includes('targetLevel=50')));
      assert.doesNotMatch(h.text(), /F2P target limit|F2P training stops/);
    }
    h.dispose();
  }
});


test('members can see a faster members method below the members cap', () => {
  const method = { methodId: 'members', level: 10, xpPerHour: 3000, blockers: [{ kind: 'chunk' }] };
  const value = { ...plan, availableMethods: [{ eligibleNow: true, xpPerHour: 1000 }], lockedMethods: [method] };
  assert.equal(nextBetterTrainingMethod(value, { ...catalogue, f2p: true }), null);
  assert.equal(nextBetterTrainingMethod(value, { ...catalogue, f2p: false }), method);
});
