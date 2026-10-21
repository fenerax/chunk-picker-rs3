import test from 'node:test';
import assert from 'node:assert/strict';
import { helperDrops } from '../app/helper-drops.mjs';
import { dataTable, levelChart, chanceChart } from '../app/web/helper-charts.mjs';
import { renderGoals } from '../app/web/helper-goals.mjs';
import { renderUtilities } from '../app/web/helper-utilities.mjs';
import { renderDrops } from '../app/web/helper-drops.mjs';
import { createHelperView } from '../app/web/helper.mjs';
import { dropChance, skillGoals, combatProjection } from '../app/web/helper-model.mjs';
import { xpForLevel } from '../app/core/experience.mjs';

function dom() {
  const roots = [];
  class Node {
    constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, events: {}, dataset: {}, value: '', textContent: '', hidden: false }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(key, callback) { this.events[key] = callback; }
    removeEventListener(key, callback) { if (this.events[key] === callback) delete this.events[key]; }
    dispatchEvent(event) { return this.events[event.type]?.(event); }
    focus() { this.focused = true; }
    after(node) { roots.push(node); }
    checkValidity() {
      return walk([this]).filter(node => node.tag === 'input' && node.type === 'number').every(node => {
        if (!node.required && node.value === '') return true;
        const value = Number(node.value);
        return node.value !== '' && Number.isFinite(value) && (node.min === undefined || value >= Number(node.min))
          && (node.max === undefined || value <= Number(node.max)) && (node.step !== 1 || Number.isInteger(value));
      });
    }
    reportValidity() { this.reportedInvalid = true; }
  }
  const document = {
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag),
    getElementById: id => walk(roots).find(node => node.id === id),
    querySelector: selector => walk(roots).find(node => selector === '.workspace' && node.className === 'workspace'),
    addEventListener: () => {}, head: new Node('head'),
  };
  roots.push(document.head);
  return { document, host: new Node('div'), addRoot: node => roots.push(node), nodes: () => walk(roots) };
}
function walk(nodes) { return nodes.flatMap(node => [node, ...walk(node.children ?? [])]); }
const text = node => [String(node.textContent ?? ''), ...node.children.map(text)].filter(Boolean).join(' ');
const find = (host, tag, label) => walk([host]).find(node => node.tag === tag && (label === undefined || node.textContent === label));
const submit = form => form.dispatchEvent({ type: 'submit', preventDefault() {} });
const observed = (level, xp = xpForLevel(level)) => ({ level, xp, source: 'runemetrics', runescapeName: 'DemoExplorer', fetchedAt: '2026-10-11T12:00:00Z' });
const member = () => ({ id: 'actor1', name: 'Player', runescapeName: 'DemoExplorer', skillProgress: { Mining: observed(10), Attack: observed(40) }, completedTasks: [] });
async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate());
}

test('chart data tables have captions, semantic column headings and row headings', () => {
  const h = dom();
  const table = dataTable(h.document, 'Skill levels and task targets', ['Skill', 'Saved level', 'Task level'], [['Mining', 10, 30], ['Smithing', 'Not synced', 20]]);
  assert.equal(find(table, 'caption').textContent, 'Skill levels and task targets');
  assert.deepEqual(find(table, 'thead').children[0].children.map(node => [node.tag, node.scope, node.textContent]),
    [['th', 'col', 'Skill'], ['th', 'col', 'Saved level'], ['th', 'col', 'Task level']]);
  const rows = find(table, 'tbody').children;
  assert.deepEqual(rows.map(row => [row.children[0].tag, row.children[0].scope]), [['th', 'row'], ['th', 'row']]);
  assert.equal(rows[1].children[1].textContent, 'Not synced');
});

test('level chart identifies itself, preserves unknown personal levels, and omits skills without goals', () => {
  const h = dom();
  const svg = levelChart(h.document, [{ skill: 'Mining', currentLevel: 10, targetLevel: 30 },
    { skill: 'Smithing', currentLevel: null, targetLevel: 20 }, { skill: 'Cooking', currentLevel: 99, targetLevel: null }]);
  assert.equal(svg.attributes.role, 'img');
  assert.match(svg.attributes['aria-label'], /skill levels/);
  assert.ok(find(svg, 'title'));
  assert.match(text(svg), /10 \/ 30/);
  assert.match(text(svg), /\? \/ 20/);
  assert.doesNotMatch(text(svg), /Cooking/);
  assert.equal(walk([svg]).filter(node => node.tag === 'circle').length, 2);
});

test('chance chart draws finite coordinates for ordinary, enormous and guaranteed drop odds', () => {
  const h = dom();
  for (const odds of [dropChance(128, 10, 20), dropChance(1e308, 1), dropChance(1, 0), dropChance(1, 1)]) {
    const svg = chanceChart(h.document, odds);
    assert.equal(svg.attributes.role, 'img');
    assert.match(svg.attributes['aria-label'], /at least one drop/);
    assert.ok(find(svg, 'title'));
    assert.doesNotMatch(find(svg, 'polyline').attributes.points, /NaN|Infinity/);
    assert.ok(Number.isFinite(Number(find(svg, 'circle').attributes.cx)));
    assert.ok(Number.isFinite(Number(find(svg, 'circle').attributes.cy)));
  }
});

test('goals pair the chart with exact table data and describe level payoff without completing tasks', () => {
  const h = dom(), owner = member(), planned = [];
  const task = { id: 'mine', label: 'Mine ore', category: 'Mining', level: 30, record: { Level: 30, Items: ['Pickaxe'] }, status: 'available', obligation: true };
  const result = { memberId: owner.id, tasks: [task], presentation: { tasks: [task] } }, before = structuredClone({ owner, result });
  renderGoals(h.host, { document: h.document, member: owner, getResult: () => result, onPlan: (...args) => planned.push(args) });
  const expected = skillGoals(owner, result).find(row => row.skill === 'Mining');
  const data = find(h.host, 'tbody').children[0].children.map(node => node.textContent);
  assert.deepEqual(data, ['Mining', 10, 30, expected.xpRemaining.toLocaleString(), 1]);
  assert.match(text(h.host), /level requirements only/);
  assert.match(text(h.host), /Quests, supplies and other steps still need doing/);
  find(h.host, 'button', 'Plan Mining to 30').dispatchEvent({ type: 'click' });
  assert.deepEqual(planned, [['Mining', 30]]);
  assert.deepEqual({ owner, result }, before);
  const met = dom(), trainedOwner = { ...owner, skillProgress: { Mining: observed(40) } };
  renderGoals(met.host, { document: met.document, member: trainedOwner, getResult: () => result, onPlan: (...args) => planned.push(args) });
  assert.equal(find(met.host, 'button', 'Plan Mining to 30'), undefined);
  assert.equal(find(met.host, 'tbody').children[0].children[3].textContent, '0');
});

test('grind payoffs count new level goals and never suggest training to level one', () => {
  const tasks = [1, 10, 30].map(level => ({ id: `mine-${level}`, label: `Mine at ${level}`, category: 'Mining', level, status: 'available', obligation: true }));
  const owner = { ...member(), skillProgress: { Mining: observed(20) } }, result = { memberId: owner.id, tasks, presentation: { tasks } };
  const known = dom(); renderGoals(known.host, { document: known.document, member: owner, getResult: () => result, onPlan() {} });
  assert.match(text(known.host), /Mining to 30 meets 1 more level goal/);
  assert.equal(find(known.host, 'button', 'Plan Mining to 10'), undefined);
  const unknown = dom(); renderGoals(unknown.host, { document: unknown.document, member: { ...owner, skillProgress: {} }, getResult: () => result, onPlan() {} });
  assert.equal(find(unknown.host, 'button', 'Plan Mining to 1'), undefined);
  assert.match(text(unknown.host), /Mining to 30 could meet up to 2 more level goals/);
});

test('utilities use the model XP shape, existing combat formula and temporary inputs without saving', () => {
  const h = dom(), owner = member(), before = structuredClone(owner);
  renderUtilities(h.host, { document: h.document, member: owner });
  const forms = walk([h.host]).filter(node => node.tag === 'form');
  const xp = find(forms[0], 'input'); xp.value = '83'; submit(forms[0]);
  assert.match(text(h.host), /Level 2 · 91 XP to level 3/);
  xp.value = String(xpForLevel(120)); submit(forms[0]);
  assert.match(text(h.host), /Standard curve ends at 120/);
  const level = find(forms[1], 'input'); level.value = '99'; submit(forms[1]);
  assert.match(text(h.host), new RegExp(`Level 99 starts at ${xpForLevel(99).toLocaleString()} XP`));
  const combatInputs = walk([forms[2]]).filter(node => node.tag === 'input');
  assert.equal(combatInputs[0].value, '40');
  combatInputs[0].value = '50'; combatInputs[1].value = '50'; submit(forms[2]);
  assert.match(text(h.host), new RegExp(`F2P combat level ${combatProjection({ Attack: 50, Strength: 50 })}`));
  const caption = walk([h.host]).find(node => node.tag === 'caption' && node.textContent === 'Saved personal levels');
  assert.ok(caption);
  assert.deepEqual(owner, before);
});

test('typed XP, level and combat drafts survive remount without changing personal progress', () => {
  const h = dom(), owner = member(), before = structuredClone(owner);
  const dispose = renderUtilities(h.host, { document: h.document, member: owner });
  const forms = walk([h.host]).filter(node => node.tag === 'form');
  find(forms[0], 'input').value = '12345.6'; find(forms[1], 'input').value = '75';
  const combat = walk([forms[2]]).filter(node => node.tag === 'input');
  combat[0].value = '57'; combat[7].value = '19';
  const draft = dispose.getDraft(); dispose();
  const restored = dom(), updatedOwner = { ...owner, skillProgress: { ...owner.skillProgress, Defence: observed(30) } };
  const restoredDispose = renderUtilities(restored.host, { document: restored.document, member: updatedOwner, draft });
  const restoredForms = walk([restored.host]).filter(node => node.tag === 'form');
  assert.equal(find(restoredForms[0], 'input').value, '12345.6');
  assert.equal(find(restoredForms[1], 'input').value, '75');
  const restoredCombat = walk([restoredForms[2]]).filter(node => node.tag === 'input');
  assert.equal(restoredCombat[0].value, '57');
  assert.equal(restoredCombat[7].value, '19');
  assert.equal(restoredCombat[2].value, '30'); // Untouched defaults follow new observations.
  assert.deepEqual(owner, before);
  assert.equal(updatedOwner.skillProgress.Defence.level, 30);
  restoredDispose();
});

test('drop projection uses admitted drop evidence, deduplicates location copies and omits unknown rates', () => {
  const source = { kind: 'drop', source: 'Goblin', probability: 1 / 128, rate: '1/128', location: '12341' };
  const result = { items: [
    { name: 'Ore', sources: [source, { ...source, location: '12342' }, { ...source, probability: 1 / 64, rate: '1/64' }] },
    { name: 'Bones', sources: [{ ...source, source: 'Chicken', probability: 1, rate: 'Always' }] },
    { name: 'Unknown', sources: [{ ...source, probability: null }, { ...source, probability: 0 }, { ...source, probability: 2 }, { ...source, probability: NaN }, { ...source, probability: Infinity }] },
    { name: 'Bought', sources: [{ ...source, kind: 'shop' }] },
  ] }, before = structuredClone(result);
  const rows = helperDrops(result);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => [row.monster, row.item, row.denominator]), [['Chicken', 'Bones', 1], ['Goblin', 'Ore', 128], ['Goblin', 'Ore', 64]]);
  assert.equal(rows[1].wiki, 'https://runescape.wiki/w/Goblin');
  assert.equal(rows[1].rate, '1/128');
  assert.deepEqual(result, before);
  assert.deepEqual(helperDrops({}), []);
});

test('drop renderer refuses newer server rows against an older local save while keeping manual odds usable', async () => {
  const h = dom(), owner = member(), before = structuredClone(owner), reads = [];
  const api = (path, body, signal) => {
    reads.push({ path, body, signal });
    return Promise.resolve({ memberId: owner.id, stateRevision: 8, f2p: true,
      drops: [{ monster: 'Goblin', item: 'Ore', denominator: 128, rate: '1/128' }] });
  };
  const dispose = renderDrops(h.host, { document: h.document, member: owner, api, stateRevision: 7, isCurrent: () => true });
  try {
    await new Promise(resolve => setImmediate(resolve));
    const source = find(h.host, 'select');
    assert.deepEqual(source.children.map(node => node.textContent), ['Enter a rate']);
    assert.doesNotMatch(text(h.host), /Goblin|Ore/);
    assert.match(text(h.host), /save changed while loading drops/);
    const form = find(h.host, 'form'), [denominator, own, partner] = walk([form]).filter(node => node.tag === 'input' && node.type === 'number');
    denominator.value = '2'; own.value = '1'; partner.value = '0'; submit(form);
    assert.match(text(h.host), /50\.00% chance of at least one drop after 1 combined kills/);
    assert.ok(find(h.host, 'caption', 'Drop chance by kill count'));
    assert.equal(reads.length, 1);
    assert.equal(reads[0].path, '/api/helper-drops?memberId=actor1');
    assert.equal(reads[0].body, undefined);
    assert.deepEqual(owner, before);
  } finally { dispose(); }
  assert.equal(reads[0].signal.aborted, true);
});

test('drop drafts retain kills and selected rates across reordered source data, while manual rate edits clear the loot-roll label', async () => {
  const owner = member(), before = structuredClone(owner), h = dom();
  const goblin = { monster: 'Goblin', item: 'Ore', denominator: 128, rate: '1/128' };
  const chicken = { monster: 'Chicken', item: 'Bones', denominator: 1, rate: 'Always' };
  const api = (revision, drops) => () => Promise.resolve({ memberId: owner.id, stateRevision: revision, drops, f2p: true });
  const dispose = renderDrops(h.host, { document: h.document, member: owner, api: api(7, [goblin, chicken]), stateRevision: 7, isCurrent: () => true });
  await new Promise(resolve => setImmediate(resolve));
  const form = find(h.host, 'form'), source = find(form, 'select');
  source.value = '0'; source.dispatchEvent({ type: 'change' });
  const [denominator, own, partner] = walk([form]).filter(node => node.tag === 'input' && node.type === 'number');
  own.value = '300'; partner.value = '200'; submit(form);
  assert.match(text(h.host), /from this loot roll after 500 combined kills/);
  const draft = dispose.getDraft(); dispose();
  const restored = dom(), restoredDispose = renderDrops(restored.host, { document: restored.document, member: owner,
    api: api(8, [chicken, goblin]), stateRevision: 8, isCurrent: () => true, draft });
  try {
    await new Promise(resolve => setImmediate(resolve));
    const restoredForm = find(restored.host, 'form'), restoredSource = find(restoredForm, 'select');
    const restoredInputs = walk([restoredForm]).filter(node => node.tag === 'input' && node.type === 'number');
    assert.deepEqual(restoredInputs.map(input => input.value), ['128', '300', '200']);
    assert.equal(restoredSource.value, '1');
    assert.match(text(restored.host), /from this loot roll after 500 combined kills/);
    restoredInputs[0].value = '512'; restoredInputs[0].dispatchEvent({ type: 'input' });
    assert.equal(restoredSource.value, '');
    submit(restoredForm);
    assert.doesNotMatch(text(restored.host), /from this loot roll/);
    const manualDraft = restoredDispose.getDraft();
    assert.equal(manualDraft.selectedRoll, null);
    assert.equal(manualDraft.denominator, '512');
    assert.deepEqual(owner, before);
  } finally { restoredDispose(); }
});

test('a numerically equal manual rate typed during source refresh keeps the restored drop draft custom', async () => {
  const h = dom(), owner = member(), before = structuredClone(owner);
  let resolveSources;
  const api = () => new Promise(resolve => { resolveSources = resolve; });
  const dispose = renderDrops(h.host, { document: h.document, api, member: owner, stateRevision: 8, isCurrent: () => true,
    draft: { denominator: '128', ownKills: '10', partnerKills: '20', filter: '',
      selectedRoll: { monster: 'Goblin', item: 'Ore', denominator: 128 } } });
  try {
    const form = find(h.host, 'form'), denominator = walk([form]).find(node => node.tag === 'input' && node.type === 'number');
    denominator.value = '128.0'; denominator.dispatchEvent({ type: 'input' });
    resolveSources({ memberId: owner.id, stateRevision: 8, f2p: true,
      drops: [{ monster: 'Goblin', item: 'Ore', denominator: 128, rate: '1/128' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(find(form, 'select').value, '');
    assert.equal(denominator.value, '128.0');
    assert.doesNotMatch(text(h.host), /from this loot roll/);
    submit(form);
    assert.match(text(h.host), /after 30 combined kills/);
    assert.doesNotMatch(text(h.host), /from this loot roll/);
    assert.equal(dispose.getDraft().selectedRoll, null);
    assert.deepEqual(owner, before);
  } finally { dispose(); }
});

test('shell opening only reads a catalogue, and closing aborts pending work without changing the save', async () => {
  const h = dom(), owner = member(), state = { revision: 7, members: [owner] }, before = structuredClone(state), reads = [];
  const launch = h.document.createElement('button'); launch.id = 'helper-open';
  const picker = h.document.createElement('main'); picker.className = 'workspace'; h.addRoot(launch); h.addRoot(picker);
  const api = (path, body, signal) => { reads.push({ path, body, signal }); return new Promise(() => {}); };
  const helper = createHelperView({ document: h.document, api, getState: () => state, getMemberId: () => owner.id, getResult: () => undefined });
  helper.open();
  try {
    for (let i = 0; i < 100 && !reads.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(picker.hidden, true);
    assert.equal(launch.attributes['aria-pressed'], 'true');
    assert.equal(reads.length, 1);
    assert.equal(reads[0].path, '/api/training-catalogue');
    assert.equal(reads[0].body, undefined);
    assert.equal(reads[0].signal.aborted, false);
  } finally { helper.close(); }
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(picker.hidden, false);
  assert.equal(h.document.getElementById('helper-page').hidden, true);
  assert.equal(launch.attributes['aria-pressed'], 'false');
  assert.equal(launch.focused, true);
  assert.deepEqual(state, before);
});

test('shell discards reads from the previous player or revision while open', async () => {
  const h = dom(), owner = member(), partner = { ...member(), id: 'reed', name: 'Reed', skillProgress: {} };
  const state = { revision: 7, members: [owner, partner] }, before = structuredClone(state.members), reads = [];
  let selectedMember = owner.id;
  const launch = h.document.createElement('button'); launch.id = 'helper-open';
  const picker = h.document.createElement('main'); picker.className = 'workspace';
  const mapSelect = h.document.createElement('select'); mapSelect.id = 'member'; mapSelect.value = selectedMember;
  mapSelect.addEventListener('change', () => { selectedMember = mapSelect.value; });
  h.addRoot(launch); h.addRoot(picker); h.addRoot(mapSelect);
  const api = (path, body, signal) => new Promise(resolve => { reads.push({ path, body, signal, resolve }); });
  const helper = createHelperView({ document: h.document, api, getState: () => state, getMemberId: () => selectedMember, getResult: () => undefined });
  const catalogue = { skills: [{ skill: 'Mining', status: 'f2p', f2pCap: 110 }], methods: [] };
  async function until(predicate) {
    for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate());
  }
  helper.open();
  try {
    await until(() => reads.length === 1);
    const selector = h.document.getElementById('helper-player'); selector.value = partner.id; selector.dispatchEvent({ type: 'change' });
    await until(() => reads.length === 2);
    assert.equal(selectedMember, partner.id);
    assert.equal(reads[0].signal.aborted, true);
    reads[0].resolve(catalogue); await new Promise(resolve => setImmediate(resolve));
    assert.equal(find(h.document.getElementById('helper-content'), 'form').hidden, true);
    // The revision changes before this player's pending response comes back.
    // The shell rejects it immediately, then its watcher mounts the new scope.
    state.revision = 8; reads[1].resolve(catalogue); await new Promise(resolve => setImmediate(resolve));
    assert.equal(find(h.document.getElementById('helper-content'), 'form').hidden, true);
    await until(() => reads.length === 3);
    assert.equal(reads[1].signal.aborted, true);
    reads[2].resolve(catalogue); await new Promise(resolve => setImmediate(resolve));
    const content = h.document.getElementById('helper-content');
    assert.equal(find(content, 'form').hidden, false);
    assert.match(text(content), /personal level is not saved/);
    assert.doesNotMatch(text(content), /Player: Mining/);
    assert.ok(reads.every(read => read.path === '/api/training-catalogue' && read.body === undefined));
    assert.deepEqual(state.members, before);
  } finally { helper.close(); }
});

test('shell keeps calculator inputs when task results finish, retains drafts across revisions and players, and clears them on close', async () => {
  const h = dom(), owner = member(), partner = { ...member(), id: 'reed', name: 'Reed' };
  const state = { revision: 7, members: [owner, partner] }, before = structuredClone(state.members), reads = [], results = new Map();
  let selectedMember = owner.id;
  const launch = h.document.createElement('button'); launch.id = 'helper-open';
  const picker = h.document.createElement('main'); picker.className = 'workspace';
  const mapSelect = h.document.createElement('select'); mapSelect.id = 'member'; mapSelect.value = owner.id;
  mapSelect.addEventListener('change', () => { selectedMember = mapSelect.value; });
  h.addRoot(launch); h.addRoot(picker); h.addRoot(mapSelect);
  const api = (path, body, signal) => { reads.push({ path, body, signal }); return new Promise(() => {}); };
  const helper = createHelperView({ document: h.document, api, getState: () => state, getMemberId: () => selectedMember, getResult: id => results.get(id) });
  const currentXp = () => find(h.document.getElementById('helper-content'), 'input');
  helper.open();
  try {
    const utilities = h.nodes().find(node => node.tag === 'button' && node.dataset.section === 'utilities');
    utilities.dispatchEvent({ type: 'click' }); await until(() => currentXp()?.value === '0');
    const typed = currentXp(); typed.value = '50000';
    results.set(owner.id, { memberId: owner.id, stateRevision: 7, tasks: [] });
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(currentXp(), typed);
    assert.equal(currentXp().value, '50000');
    state.revision = 8; results.clear();
    await until(() => currentXp() && currentXp() !== typed);
    assert.equal(currentXp().value, '50000');
    const selector = h.document.getElementById('helper-player'), actor1Xp = currentXp();
    selector.value = partner.id; selector.dispatchEvent({ type: 'change' });
    await until(() => currentXp() && currentXp() !== actor1Xp);
    assert.equal(currentXp().value, '0');
    const reedXp = currentXp(); reedXp.value = '90000';
    selector.value = owner.id; selector.dispatchEvent({ type: 'change' });
    await until(() => currentXp() && currentXp() !== reedXp);
    assert.equal(currentXp().value, '50000');
    const returnedXp = currentXp();
    selector.value = partner.id; selector.dispatchEvent({ type: 'change' });
    await until(() => currentXp() && currentXp() !== returnedXp);
    assert.equal(currentXp().value, '90000');
    helper.close(); helper.open(); await until(() => currentXp()?.value === '0');
    assert.deepEqual(state.members, before);
    assert.ok(reads.every(read => read.path === '/api/training-catalogue' && read.body === undefined));
  } finally { helper.close(); }
});
