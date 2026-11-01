import { createRequestReader, requestError } from '../app/web/live-swap-client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInfoPanels } from '../app/web/info-panels.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { plainLabel } from '../app/tasks/engine.mjs';
import { createScreenUi } from '../app/web/screen-ui.mjs';
import { caveFixture } from './fixtures/why-chain.mjs';
import { buildWhyChain } from '../app/tasks/why-chain.mjs';

// Exercise the shipped module with small DOM collaborators. Saves are captured,
// never sent to a server or live member state.
function harness(preferences = {}, storage) {
  class Node {
    constructor(tag, text, cls) { Object.assign(this, { tag, textContent: text ?? '', className: cls ?? '', children: [], events: {}, attributes: {}, value: '' }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
    focus() {}
  }
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const state = { revision: 7, members: [{ id: 'a', name: 'Player', primaryOverrides: {}, completedTasks: [] }, { id: 'b', name: 'Reed', completedTasks: [] }] };
  const result = { stateRevision: 7, tasks: [], playerControls: { primaryOverrides: {}, passiveLevels: { Mining: 5 }, maxLevels: { Mining: 90 }, slayerLock: null }, activityInfo: {
    skills: [{ skill: 'Mining', reachableLevel: 90, cap: 90, passiveLevel: 5, primaryMethods: [], availableTasks: [], blockedTasks: [], selectedGoals: [], explanation: 'Planning ceiling.' }], quests: [], achievements: [], activities: [], slayer: { masters: [], limitations: [], lockOptions: { monsters: ['Bats'], bosses: ['Giant Mole'] } }, clues: { tiers: [], limitations: [] }, coverage: { limitations: [] },
  } };
  const ui = { nodes: [], memberId: 'a', generation: 0, open: false, attempts: [], calculations: 0, shownTasks: [] };
  const helpers = {
    storage,
    preferences: () => preferences,
    el, plain: value => value,
    button: (text, action, cls) => { const node = el('button', text, cls); node.events.click = action; return node; },
    details: (title, ...children) => { const node = el('details'); node.append(el('summary', title), ...children); return node; },
    list: rows => { const node = el('ul'); node.append(...rows.map(value => el('li', value))); return node; },
    openDialog: (title, ...nodes) => { ui.title = title; ui.nodes = nodes; ui.generation++; ui.open = true; },
    itemIcon: name => name === 'Acadia longbow' ? '/assets/map/icons-items.2026-10-08.v1/acadia.png' : null,
    showTask(task) { ui.shownTasks.push(task); }, state: () => state, memberId: () => ui.memberId, ensureResult: async () => { ui.calculations++; return ui.pendingResult ? await ui.pendingResult : result; },
    dialogGeneration: () => ui.generation, isDialogOpen: () => ui.open,
    beginDialogRequest: () => ++ui.generation,
    command: async (command, revision) => { ui.attempts.push({ command, revision }); },
  };
  const panels = createInfoPanels(helpers);
  const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
  const find = (tag, text) => walk(ui.nodes).find(node => node.tag === tag && (text === undefined || node.textContent === text));
  const inputFor = label => find('span', label) && walk(ui.nodes).find(node => node.tag === 'label' && node.children[0]?.textContent === label)?.children[1];
  const openDetails = title => { const node = walk(ui.nodes).find(node => node.tag === 'details' && node.children[0]?.textContent.startsWith(title)); assert.ok(node, title); node.open = true; node.events.toggle?.(); };
  // Skills open as tiles; the Mining tile leads to its detail, where manual controls sit at the bottom.
  const openTraining = async () => { await panels.activityInfo(); const tile = walk(ui.nodes).find(node => node.tag === 'button' && node.attributes?.['aria-label']?.startsWith('Mining:')); assert.ok(tile, 'Mining tile'); await tile.events.click(); openDetails('Training assumptions'); };
  return { state, result, ui, panels, ctx: helpers, find, inputFor, openTraining, openDetails, nodes: () => walk(ui.nodes) };
}

test('Activity Info skill methods hide unmatched Wiki delimiters without changing task references or goals', async () => {
  const controls = [
    ['rs3:task:000038', 'Enter the Polar eagle eyrie|~', 'Enter the Polar eagle eyrie'],
    ['missing-opening', 'Climb the wall|~', 'Climb the wall'],
    ['missing-closing', 'Climb ~|the wall', 'Climb the wall'],
    ['balanced', 'Climb ~|Example wall|~', 'Climb Example wall'],
    ['variant', 'Climb ~|Example wall#North|~', 'Climb Example wall'],
    ['alias', 'Climb ~|Walls|~[+]2', 'Climb Walls2'],
    ['mixed', 'Climb ~|Example wall#North|~ then ~|the fence', 'Climb Example wall then the fence'],
    ['literal', 'Climb | walk ~ rest', 'Climb | walk ~ rest'],
  ];
  for (const [id, rawLabel, displayed] of controls) {
    const h = harness(), screen = {}; createScreenUi(screen); h.ctx.plain = screen.plain;
    const task = { id, rawLabel, label: plainLabel(rawLabel), category: 'Agility', level: 35, primary: false,
      status: 'blocked', obligation: true, personalCompleted: false, challengeSatisfied: false,
      blockers: [{ kind: 'tasks', detail: 'Complete the prerequisite first.' }] };
    Object.assign(h.result, { tasks: [task], training: { Agility: { level: 1, cap: 99 } }, presentation: { tasks: [] } });
    h.result.activityInfo = buildActivityInfo(h.result, h.state, 'a');
    const beforeState = structuredClone(h.state), beforeResult = structuredClone(h.result);
    await h.panels.activityInfo();
    const tile = h.nodes().find(node => node.attributes['aria-label']?.startsWith('Agility:'));
    assert.ok(tile, id); await tile.events.click();
    const name = h.nodes().find(node => node.className === 'method-name');
    assert.equal(name.textContent, displayed, id);
    assert.ok(h.find('span', 'Blocked'), id);
    const goals = h.nodes().find(node => node.className === 'skill-stat' && node.children.some(child => child.textContent === 'active goals'));
    assert.equal(goals.children[0].textContent, '0');
    await name.events.click();
    const summary = h.result.activityInfo.skills[0].blockedTasks[0];
    assert.equal(h.ui.shownTasks[0], summary, 'opening keeps the original summary');
    assert.equal(summary.id, id); assert.equal(summary.evidenceTaskId, id);
    assert.equal(summary.label, task.label, 'only the button text is repaired');
    assert.deepEqual(h.state, beforeState); assert.deepEqual(h.result, beforeResult);
    assert.deepEqual(h.ui.attempts, []);
  }
});

test('saved Slayer chains request full server evidence despite partial browser definitions; sandbox stays local', async () => {
  for (const sandbox of [false, true]) {
    const h = harness(), { result, definitions } = caveFixture(), requests = [];
    Object.assign(h.result, { tasks: result.tasks, memberId: 'a' });
    h.result.activityInfo.slayer.masters = result.activityInfo.slayer.masters;
    h.ctx.isSandbox = () => sandbox;
    h.ctx.definitions = () => sandbox ? definitions : { chunks: {} };
    h.ctx.api = async url => {
      requests.push(url);
      return { ...buildWhyChain(result, definitions, { master: 'Example master', assignment: 'Cave bugs' }), memberId: 'a', stateRevision: 7 };
    };
    Object.assign(h.result.activityInfo.slayer.masters[0], { reachable: false, eligibleCount: 0, totalCount: 1 });
    Object.assign(h.result.activityInfo.slayer.masters[0].tasks[0], { reachableMonsters: [], weight: 1 });
    await h.panels.activityInfo('Slayer');
    h.openDetails('Example master ·');
    const why = h.nodes().find(node => node.tag === 'details' && node.children[0]?.textContent === 'Why not?');
    assert.ok(why);
    assert.equal(requests.length, 0);
    why.open = true; await why.events.toggle();
    assert.equal(requests.length, sandbox ? 0 : 1);
    if (!sandbox) assert.match(requests[0], /\/api\/task-why\?.*master=Example\+master/);
    const text = h.nodes().map(node => node.textContent).join(' ');
    assert.match(text, /Need Rope/);
    assert.doesNotMatch(text, /No location is identified/);
    assert.deepEqual(h.ui.attempts, []);
  }
});

test('Quests expose a read-only map control for the full quest despite step filters, guarded by the panel snapshot', async () => {
  const h = harness(), controls = [];
  h.ctx.questMapControls = options => { controls.push(options); return h.ctx.el('button', 'Show on map'); };
  h.ctx.dialogCurrent = generation => h.ui.open && h.ui.generation === generation;
  h.result.activityInfo.quests = [{ name: 'Example', tasks: [{ id: 'step', label: 'Example step', category: 'Quest', status: 'blocked' }], availableCount: 0, wholeCompletion: [] }];
  await h.panels.activityInfo('Quests'); h.openDetails('Example ·');
  assert.ok(h.find('button', 'Show on map')); assert.equal(controls[0].quest, 'Example');
  assert.equal(controls[0].guard(), true); h.ui.generation++; assert.equal(controls[0].guard(), false);
  h.state.revision++; assert.throws(controls[0].guard, /Saved state changed/);
  assert.deepEqual(h.ui.attempts, []);
});

test('Activity Info tabs filter in place, retain browser choices and never issue a gameplay command', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const h = harness({}, storage);
  h.result.activityInfo.activities = [{ id: 'ready', label: 'Ready activity', category: 'Activity', status: 'available', blockers: [], level: 20 },
    { id: 'blocked', label: 'Blocked activity', category: 'Activity', status: 'blocked', blockers: [], level: 5 }];
  await h.panels.activityInfo('Activities');
  const group = () => h.nodes().find(node => node.attributes['aria-label'] === 'Activity status');
  const chip = name => group().children.find(node => node.tag === 'button' && node.textContent === name);
  await chip('Blocked').events.click();
  assert.equal(h.find('strong', 'Ready activity'), undefined);
  assert.ok(h.find('strong', 'Blocked activity'));
  const image = h.nodes().find(node => node.className === 'task-icon');
  assert.equal(image.src, '/assets/SVG/rs3/minigame-rs3.svg');
  assert.equal(image.width, 22); assert.equal(image.height, 22);
  assert.equal(chip('Blocked').attributes['aria-pressed'], 'true');
  assert.equal(h.ui.calculations, 1, 'chips reuse the current calculation');
  const sort = h.nodes().find(node => node.attributes['aria-label'] === 'Sort activities');
  sort.value = 'level'; sort.events.change();
  for (const tab of ['Skills', 'Quests', 'Achievements', 'Slayer', 'Clues']) {
    await h.find('button', tab).events.click();
    assert.ok(group(), `${tab} status filters`);
    assert.ok(h.nodes().some(node => node.attributes['aria-label'] === 'Sort activities'), `${tab} level sort`);
  }
  await h.find('button', 'Activities').events.click();
  assert.equal(chip('Blocked').attributes['aria-pressed'], 'true');
  assert.equal(h.nodes().find(node => node.attributes['aria-label'] === 'Sort activities').value, 'level');
  await h.panels.activityInfo('Activities');
  assert.equal(chip('Blocked').attributes['aria-pressed'], 'true', 'reopening retains browser preference');
  assert.equal(h.ui.attempts.length, 0);
});

function achievementFixture(h) {
  const step = (id, label, extra = {}) => ({ id, label, category: 'Diary', status: 'blocked', selected: false, personalCompleted: false, challengeSatisfied: false, blockers: [], ...extra });
  const completed = step('achievement:completed', 'Completed required step', { personalCompleted: true, challengeSatisfied: true });
  const blocked = step('achievement:blocked', 'Blocked required step', { blockers: [{ detail: 'Unlock the missing chunk first.' }] });
  const optional = step('achievement:optional', 'Optional family step', { status: 'available', selected: true });
  const group = (name, required, tasks) => ({ name, required, tasks, availableCount: tasks.filter(task => task.status === 'available').length, personallyCompletedCount: tasks.filter(task => task.personalCompleted).length, challengeSatisfiedCount: tasks.filter(task => task.challengeSatisfied).length });
  h.result.tasks = [completed, blocked, optional];
  h.result.activityInfo.achievements = [group('Completed required family', true, [completed]), group('Blocked required family', true, [blocked]), group('Optional family', false, [optional])];
  // An Achievement category hidden from the active task list can leave no selected tasks.
  h.result.presentation = { tasks: [] };
  return { completed, blocked, optional };
}

test('source method navigation uses the explicit owner callback instead of the selected-map task opener', async () => {
  const h = harness(), opened = [], method = { id: 'reed-method', label: 'Reed mining method', category: 'Mining', status: 'available' };
  const partnerResult = { memberId: 'b', stateRevision: 7, tasks: [method] };
  h.ui.nodes = [h.panels.sourceView([{ kind: 'spawn', name: 'Reed rock', taskId: method.id }], partnerResult, task => opened.push(task))];
  const action = h.find('button', 'View source method: Reed mining method'); assert.ok(action);
  await action.events.click();
  assert.deepEqual(opened, [method]); assert.deepEqual(h.ui.shownTasks, []);
});

test('required achievements include completed and blocked families when Achievement has no active tasks', async () => {
  const h = harness({ hideAchievements: true }); achievementFixture(h);
  await h.panels.activityInfo('Achievements');
  const chooser = h.inputFor('Show achievement groups');
  assert.equal(chooser.value, 'selected');
  assert.ok(h.find('option', 'Required achievement groups (2)'));
  assert.ok(h.find('p', 'The required view follows your achievement family rules and includes completed or currently blocked groups. Use all groups to inspect other families.'));
  assert.ok(h.find('summary', 'Completed required family · 0 of 1 steps doable now'));
  assert.ok(h.find('summary', 'Blocked required family · 0 of 1 steps doable now'));
  assert.equal(h.find('summary', 'Optional family · 1 of 1 steps doable now'), undefined);
  h.openDetails('Completed required family'); h.openDetails('Blocked required family');
  assert.ok(h.find('strong', 'Completed required step'));
  assert.ok(h.find('p', 'Done · you did it in-game'));
  assert.ok(h.find('strong', 'Blocked required step'));
  assert.ok(h.find('p', 'Not done yet'));
  assert.ok(h.find('p', 'Unlock the missing chunk first.'));
  assert.ok(h.find('p', 'Steps you marked done: 1/1 · Steps that count for your group: 1/1. This does not mean the whole quest or achievement is complete.'));
  assert.equal(h.ui.attempts.length, 0);
});

test('an active task cannot add a non-required family to required achievements, and All exposes it', async () => {
  const h = harness({ hideAchievements: true }); const { optional } = achievementFixture(h);
  h.result.presentation.tasks = [optional];
  await h.panels.activityInfo('Achievements');
  assert.ok(h.find('summary', 'Completed required family · 0 of 1 steps doable now'));
  assert.ok(h.find('summary', 'Blocked required family · 0 of 1 steps doable now'));
  assert.equal(h.find('summary', 'Optional family · 1 of 1 steps doable now'), undefined);
  const chooser = h.inputFor('Show achievement groups');
  chooser.value = 'all'; chooser.events.change();
  assert.ok(h.find('option', 'All achievement groups (3)'));
  assert.ok(h.find('summary', 'Optional family · 1 of 1 steps doable now'));
  h.openDetails('Optional family');
  assert.ok(h.find('p', 'Doable now · Active goal'));
  assert.ok(h.find('p', 'Not done yet'));
  chooser.value = 'selected'; chooser.events.change();
  assert.equal(h.find('summary', 'Optional family · 1 of 1 steps doable now'), undefined);
  assert.equal(h.find('strong', 'Optional family step'), undefined);
  assert.ok(h.find('summary', 'Completed required family · 0 of 1 steps doable now'));
  assert.equal(h.ui.calculations, 1, 'changing visibility uses the current calculation');
});

test('hideAchievements false defaults to All while the required choice keeps family and row wording', async () => {
  const h = harness({ hideAchievements: false }); achievementFixture(h);
  await h.panels.activityInfo('Achievements');
  const chooser = h.inputFor('Show achievement groups');
  assert.equal(chooser.value, 'all');
  assert.ok(h.find('summary', 'Optional family · 1 of 1 steps doable now'));
  chooser.value = 'selected'; chooser.events.change();
  assert.ok(h.find('summary', 'Blocked required family · 0 of 1 steps doable now'));
  assert.equal(h.find('summary', 'Optional family · 1 of 1 steps doable now'), undefined);
  h.openDetails('Blocked required family');
  assert.ok(h.find('p', 'Blocked · Other option'));
  assert.ok(h.find('p', 'Not done yet'));
  assert.equal(h.nodes().some(node => /Groups with selected active requirements|The selected view follows active task presentation/.test(node.textContent)), false);
  assert.equal(h.ui.calculations, 1);
  assert.equal(h.ui.attempts.length, 0);
});

function bisFixture(h) {
  const rec = (name, style, slot, data, extra = {}) => ({ style, slot, equipment: { name, slot, tier: data.tier, data, sources: [{ kind: 'shop', name: 'Champion shop', location: '12345', quantity: 1 }] }, score: [10, 5], comparison: 'Declared comparison.', challenge: { personalCompleted: false, challengeSatisfied: true, satisfiedBy: ['b'], explanation: 'Challenge explanation.' }, sourceAccess: { personalLocations: ['12345'], sharedLocations: [{ location: '54321', memberIds: ['b'] }], connectedAreas: ['Cave'], explanation: 'Access explanation.' }, rewardSharing: 'Reward sharing explanation.', ...extra });
  const bow = rec('Acadia longbow', 'Ranged', '2h weapon', { tier: 50, damage_tier: 50, accuracy_tier: 50, requirements: { Ranged: 50 }, charges: 100 }, { loadoutMode: 'two-handed', alternatives: ['Other bow'] });
  const arrows = rec('Rune arrow', 'Ranged', 'ammo', { tier: 50 }, { loadoutMode: 'two-handed' });
  const hat = rec('Ranger hat', 'Ranged', 'head', { tier: 40, armour: 20, lp: 10, ranged_damage: 5 });
  const plate = rec('Rune platebody', 'Melee', 'torso', { tier: 50, armour: 100, weight: 9 });
  const chosen = { mode: 'two-handed', mainHand: bow.equipment.name, offHand: null, ammunition: arrows.equipment.name, score: 92.5, components: { accuracy: 50, damage: 50, bonus: 0 }, defence: { armour: 0, lifePoints: 0 }, items: [bow.equipment.name, arrows.equipment.name], alternatives: [{ items: ['Other bow', 'Rune arrow'], score: 92.5 }] };
  const loadouts = [{ style: 'Ranged', selected: [chosen], tradeoffs: [{ mode: 'shield', items: ['Crossbow', 'Shield'], score: 80, scoreDifference: 12.5, defence: { armour: 20, lifePoints: 5 } }] }];
  h.result.tasks = [{ id: 'bow', label: 'Obtain Acadia longbow', equipmentName: bow.equipment.name, record: {}, sources: bow.equipment.sources }];
  h.result.equipment = [bow.equipment, arrows.equipment, hat.equipment, plate.equipment];
  h.result.currentBiS = { accessPolicy: 'shared', completionScope: 'any', obtainable: { loadouts, recommendations: [bow, arrows, hat, plate] }, owned: { explanation: 'Current possession is unconfirmed.', recordedObtained: [{ name: 'Historical hat', slot: 'head', evidence: 'Personal obtain record.' }], recordedBest: { loadouts: [], recommendations: [hat], diagnostics: [{ kind: 'missing-stat', item: 'Ranger hat', detail: 'Missing stat evidence.' }], coverage: { eligibleRecordedItems: 1, excludedRecordedItems: [{ name: 'Historical hat', reason: 'Currently ineligible.' }], limitations: ['Recorded ranking limit.'] } } }, importedSelections: [{ name: 'Imported bow', meaning: 'Source override only.' }], coverage: { limitations: ['Ranking limit.'] } };
  return { bow, arrows, hat, plate, loadouts };
}

test('Current BiS renders per-style tables with one coupled weapon and ammunition row', async () => {
  const h = harness(); bisFixture(h); await h.panels.currentBiS();
  assert.deepEqual(h.nodes().filter(node => node.className === 'bis-style-heading').map(node => node.textContent), ['Ranged', 'Melee']);
  const rows = h.nodes().filter(node => node.className.includes('bis-gear-row'));
  assert.equal(rows.length, 3, 'bow and arrows occupy one comparison row');
  const coupled = rows.find(node => node.className.includes('bis-coupled-row'));
  const within = node => [node, ...node.children.flatMap(within)];
  assert.deepEqual(within(coupled).filter(node => node.className === 'bis-item-name').map(node => node.textContent), ['Acadia longbow', 'Rune arrow']);
  assert.ok(h.find('p', 'Acadia longbow: Tier 50 · Damage tier 50 · Accuracy tier 50'));
  assert.ok(h.find('p', 'Rune arrow: Tier 50'));
  assert.equal(h.nodes().some(node => node.className === 'bis-score'), false);
  assert.equal(h.nodes().some(node => /^(?:Picker (?:score|rank)|accuracy: 50)/.test(node.textContent)), false);
  assert.deepEqual(h.nodes().filter(node => node.className === 'bis-slot-cell').map(node => node.children[1].textContent), ['Weapon loadout', 'Head', 'Torso']);
  assert.ok(h.find('p', 'Off-hand: None'));
  assert.ok(h.nodes().some(node => node.tag === 'img' && node.src === '/assets/2h_weapon_slot.png'));
  assert.ok(h.nodes().some(node => node.tag === 'img' && node.src === '/assets/map/icons-items.2026-10-08.v1/acadia.png' && node.alt === ''));
  assert.ok(h.nodes().filter(node => node.tag === 'table').every(table => table.attributes['aria-labelledby']));
  assert.equal(h.ui.calculations, 1, 'rendering rows does not request calculation or sources');
});

test('Current BiS uses plain completion statuses and keeps hand, off-hand and ammo together', async () => {
  const h = harness(); const { bow, arrows, hat, loadouts } = bisFixture(h);
  bow.equipment.name = loadouts[0].selected[0].mainHand = 'Crossbow';
  bow.equipment.slot = bow.slot = 'main hand weapon';
  bow.challenge.personalCompleted = true;
  bow.loadoutMode = arrows.loadoutMode = 'dual-wield';
  hat.challenge.challengeSatisfied = false;
  loadouts[0].selected[0].offHand = 'Off-hand crossbow';
  loadouts[0].selected[0].mode = 'dual-wield';
  h.result.equipment.push({ name: 'Off-hand crossbow', slot: 'off-hand', data: { tier: 50 }, sources: [] });
  await h.panels.currentBiS();
  const coupled = h.nodes().find(node => node.className.includes('bis-coupled-row'));
  const within = node => [node, ...node.children.flatMap(within)];
  assert.deepEqual(within(coupled).filter(node => node.className === 'bis-item-name').map(node => node.textContent), ['Crossbow', 'Off-hand crossbow', 'Rune arrow']);
  assert.equal(h.nodes().filter(node => node.className.includes('bis-gear-row')).length, 3);
  assert.deepEqual(h.nodes().filter(node => node.className === 'bis-item-progress').map(node => node.textContent), ['Done', 'Done (counts for the duo)', 'Not done yet', 'Done (counts for the duo)']);
  assert.equal(h.find('p', 'Off-hand: None'), undefined);
});

test('Current BiS hides zero gear and loadout defence stats while retaining nonzero values', async () => {
  const h = harness(); const { hat, loadouts } = bisFixture(h);
  hat.equipment.tier = 0;
  hat.equipment.data = { tier: 0, armour: 0, lp: '0', damage_tier: 0, accuracy_tier: '0', ability_damage: 0, accuracy: 0, prayer: '0', weight: -0.5, ranged_damage: 0, ranged_accuracy: '0' };
  await h.panels.currentBiS();
  assert.ok(h.find('p', 'Weight -0.5'));
  assert.equal(h.find('p', 'Declared armour 0 · Life points 0'), undefined);
  assert.equal(h.nodes().some(node => node.className === 'bis-declared-stats' && /(?:^| · )(?:Tier|Armour|Life points|Damage tier|Accuracy tier|Ability damage|Accuracy|Prayer|Ranged damage|Ranged accuracy) 0(?: · |$)/.test(node.textContent)), false);
  loadouts[0].selected[0].defence = { armour: '0', lifePoints: 7 };
  await h.panels.currentBiS(); assert.ok(h.find('p', 'Life points 7'));
  loadouts[0].selected[0].defence = { armour: 20, lifePoints: 0 };
  await h.panels.currentBiS(); assert.ok(h.find('p', 'Armour 20'));
  assert.equal(h.nodes().some(node => node.tag === 'p' && /(?:Armour|Life points) 0(?: · |$)/.test(node.textContent)), false);
  hat.equipment.data.weight = '0';
  await h.panels.currentBiS(); assert.ok(h.find('p', 'No known stats.'));
});

test('Current BiS renders item and source names as literal text', async () => {
  const h = harness(); const { hat } = bisFixture(h);
  const itemName = '<img src=x onerror=alert(1)>', sourceName = '<script>alert(1)</script>';
  hat.equipment.name = itemName; hat.equipment.sources[0].name = sourceName;
  await h.panels.currentBiS();
  assert.ok(h.find('strong', itemName));
  assert.ok(h.find('p', `${sourceName} · 12345`));
  h.openDetails(`Details: ${itemName}`); h.openDetails('Sources, equip requirements and alternatives');
  assert.ok(h.find('strong', sourceName));
  assert.equal(h.nodes().some(node => node.innerHTML != null || node.tag === 'script'), false);
});

test('BiS filters work across items, source locations, declared stats and styles', async () => {
  const h = harness(); bisFixture(h); await h.panels.currentBiS();
  const search = h.nodes().find(node => node.attributes['aria-label'] === 'Filter gear recommendations');
  const style = h.nodes().find(node => node.attributes['aria-label'] === 'Filter gear recommendations by style');
  search.value = 'Rune arrow'; search.events.input();
  assert.equal(h.nodes().filter(node => node.className.includes('bis-gear-row')).length, 1);
  assert.ok(h.find('strong', 'Acadia longbow'), 'a matching ammunition item retains its whole loadout');
  search.value = 'armour 100'; search.events.input(); assert.ok(h.find('strong', 'Rune platebody'));
  search.value = '12345'; search.events.input(); assert.equal(h.nodes().filter(node => node.className.includes('bis-gear-row')).length, 3);
  style.value = 'Melee'; style.events.change(); assert.equal(h.nodes().filter(node => node.className.includes('bis-gear-row')).length, 1);
  search.value = 'missing'; search.events.input(); assert.ok(h.find('p', 'No matches. Try a different filter.'));
  search.value = ''; style.value = ''; search.events.input(); assert.equal(h.nodes().filter(node => node.className.includes('bis-gear-row')).length, 3);
  assert.equal(h.ui.calculations, 1);
});

test('BiS disclosures preserve completion, shared access, requirements, sources and alternatives', async () => {
  const h = harness({ advanced: true }); bisFixture(h); await h.panels.currentBiS();
  h.openDetails('Details: Acadia longbow');
  assert.ok(h.find('p', 'You marked obtained: no · Task: done · Checked by Reed'));
  assert.ok(h.find('p', 'Picker ranking components: 10 / 5 · Declared comparison.'));
  assert.ok(h.find('p', 'Challenge explanation.')); assert.ok(h.find('p', 'Access explanation.'));
  h.openDetails('Sources, equip requirements and alternatives');
  assert.ok(h.find('p', 'Sources on Player’s own unlocked map: 12345'));
  assert.ok(h.find('p', 'Shared source 54321 · Unlocked by Reed'));
  assert.ok(h.find('p', 'Connected interiors and other areas: Cave'));
  assert.ok(h.find('li', 'Ranged: 50'));
  assert.ok(h.find('p', 'Degrades after 100 charges. Upkeep is not subtracted from the ranking.'));
  assert.ok(h.find('p', 'Tied alternatives: Other bow')); assert.ok(h.find('p', 'Reward sharing explanation.'));
  assert.ok(h.find('strong', 'Champion shop'));
  h.openDetails('Ranged: tied alternatives');
  assert.ok(h.find('strong', 'Other bow + Rune arrow')); assert.ok(h.find('strong', 'Crossbow + Shield'));
  assert.ok(h.find('p', 'shield · Score 80.00 · 12.50 below selected score'));
  h.openDetails('Imported source overrides'); assert.ok(h.find('li', 'Imported bow: Source override only.'));
  assert.ok(h.find('li', 'Ranking limit.'));
  await h.find('button', 'View obtain task and progress').events.click(); assert.equal(h.ui.shownTasks[0].id, 'bow');
  h.state.revision = 8; await assert.rejects(h.find('button', 'View obtain task and progress').events.click(), /Saved state changed/);
});

test('Recorded gear keeps ranking exclusions, issues and historical records in separate collapsibles', async () => {
  const h = harness({ advanced: true }); bisFixture(h); await h.panels.currentBiS('Recorded obtained');
  assert.ok(h.find('strong', 'Ranger hat')); assert.equal(h.find('strong', 'Acadia longbow'), undefined);
  assert.equal(h.find('strong', 'Historical hat'), undefined);
  h.openDetails('All items you marked obtained'); assert.ok(h.find('strong', 'Historical hat'));
  h.openDetails('Historical records excluded from ranking'); assert.ok(h.find('p', 'Currently ineligible.'));
  h.openDetails('Personal-record ranking issues'); assert.ok(h.find('p', 'Missing stat evidence.'));
  assert.ok(h.find('li', 'Recorded ranking limit.'));
});

test('hide obtained remembers a browser choice and hides only the recorded parts of a weapon setup', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const h = harness({}, storage); bisFixture(h);
  h.result.currentBiS.owned.recordedObtained = [{ name: 'Acadia longbow' }, { name: 'Ranger hat' }];
  const before = structuredClone(h.result);
  await h.panels.currentBiS();
  const hide = h.nodes().find(node => node.tag === 'input' && node.type === 'checkbox');
  hide.checked = true; hide.events.change();
  assert.equal(h.find('strong', 'Acadia longbow'), undefined); assert.equal(h.find('strong', 'Ranger hat'), undefined);
  assert.ok(h.find('strong', 'Rune arrow'), 'the missing supporting gear remains visible');
  assert.ok(h.find('strong', 'Rune platebody'));
  h.openDetails('Ranged: tied alternatives'); assert.ok(h.find('strong', 'Other bow + Rune arrow'), 'unobtained alternatives remain available');
  assert.equal(h.ui.calculations, 1); assert.deepEqual(h.ui.attempts, []); assert.deepEqual(h.result, before);
  await h.panels.currentBiS(); assert.equal(h.nodes().find(node => node.tag === 'input' && node.type === 'checkbox').checked, true);
});

test('hand-recorded rows have an own-player remove control while task rows and viewers keep read-only evidence', async () => {
  const h = harness(); bisFixture(h);
  h.result.currentBiS.owned.recordedObtained = [{ name: 'Rune pickaxe', slot: 'main hand weapon', evidence: 'Personal obtain record.', addedByHand: true }, { name: 'Historical hat', slot: 'head', evidence: 'Task completion.' }];
  await h.panels.currentBiS('Recorded obtained'); h.openDetails('All items you marked obtained');
  assert.ok(h.find('small', 'Added by hand')); assert.equal(h.nodes().filter(node => node.tag === 'button' && node.textContent === 'Remove').length, 1);
  await h.find('button', 'Remove').events.click();
  assert.deepEqual(h.ui.attempts[0], { command: { type: 'set-obtained-equipment', memberId: 'a', equipmentName: 'Rune pickaxe', obtained: false }, revision: 7 });
  h.ctx.canWrite = () => false;
  await h.panels.currentBiS('Recorded obtained'); h.openDetails('All items you marked obtained');
  assert.ok(h.find('small', 'Added by hand')); assert.equal(h.find('button', 'Remove'), undefined);
  assert.equal(h.find('h3', 'Record gear you got elsewhere'), undefined);
  h.ctx.canWrite = () => true; h.ctx.canWriteMember = () => false;
  await h.panels.currentBiS('Recorded obtained'); h.openDetails('All items you marked obtained');
  assert.equal(h.find('button', 'Remove'), undefined); assert.equal(h.find('h3', 'Record gear you got elsewhere'), undefined);
});

test('hide obtained retains unowned ties when the chosen gear and full weapon setup are recorded', async () => {
  const h = harness(), fixture = bisFixture(h), values = new Map();
  h.ctx.storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  fixture.hat.alternatives = ['Equal hat'];
  h.result.currentBiS.obtainable.recommendations = [fixture.bow, fixture.arrows, fixture.hat];
  h.result.currentBiS.owned.recordedObtained = ['Acadia longbow', 'Rune arrow', 'Ranger hat'].map(name => ({ name }));
  await h.panels.currentBiS(); const hide = h.nodes().find(node => node.tag === 'input' && node.type === 'checkbox'); hide.checked = true; hide.events.change();
  assert.ok(h.find('strong', 'Equal hat'));
  h.openDetails('Ranged: tied alternatives'); assert.ok(h.find('strong', 'Other bow')); assert.ok(h.find('strong', 'Crossbow + Shield'));
  assert.equal(h.find('strong', 'Acadia longbow'), undefined); assert.equal(h.find('strong', 'Rune arrow'), undefined);
});

test('comparison loads only on demand and discards a late result after a panel or saved-state change', async () => {
  const h = harness(); bisFixture(h); let loads = 0, resolve;
  h.ctx.ensureMemberResult = async id => { loads++; assert.equal(id, 'b'); return new Promise(done => { resolve = done; }); };
  await h.panels.currentBiS(); assert.equal(loads, 0);
  await h.find('button', 'Compare with Reed').events.click(); assert.equal(loads, 1);
  h.ui.generation++;
  resolve({ ...h.result, memberId: 'b' }); await new Promise(done => setImmediate(done));
  assert.equal(h.nodes().some(node => node.className === 'bis-comparison'), false);
  await h.panels.currentBiS(); await h.find('button', 'Compare with Reed').events.click();
  resolve({ ...h.result, memberId: 'b' }); await new Promise(done => setImmediate(done));
  assert.ok(h.nodes().some(node => node.className === 'bis-comparison')); assert.equal(h.ui.calculations, 2);
  assert.deepEqual(h.ui.attempts, []);
});

test('record and removal saves cannot reopen a closed or superseded BiS panel', async () => {
  for (const action of ['add', 'remove']) {
    const h = harness(); bisFixture(h); let finish;
    h.ctx.definitions = () => ({ equipment: { 'Rune pickaxe': {} } });
    h.ctx.command = () => new Promise(resolve => { finish = resolve; });
    h.result.currentBiS.owned.recordedObtained = [{ name: 'Rune pickaxe', slot: 'main hand weapon', evidence: 'Manual.', addedByHand: true }];
    await h.panels.currentBiS('Recorded obtained');
    let pending;
    if (action === 'add') {
      const search = h.nodes().find(node => node.attributes['aria-label'] === 'Search equipment to record as obtained');
      search.value = 'pickaxe'; search.events.input();
      pending = h.nodes().find(node => node.attributes['aria-label'] === 'Record Rune pickaxe as obtained').events.click();
    } else { h.openDetails('All items you marked obtained'); pending = h.find('button', 'Remove').events.click(); }
    h.ui.generation++; h.ui.open = false; h.state.revision++;
    finish(); await pending;
    assert.equal(h.ui.calculations, 1); assert.equal(h.ui.open, false);
  }
});

test('BiS empty views and shared supporting gear remain readable without inferred obtains', async () => {
  const h = harness(); const fixture = bisFixture(h);
  h.result.currentBiS.obtainable.recommendations = [fixture.hat];
  await h.panels.currentBiS(); assert.ok(h.find('strong', 'Rune arrow'));
  h.openDetails('Sources: Rune arrow');
  assert.ok(h.find('p', 'This item supports the weapon setup. Being able to reach it does not mean you own it or have to obtain it.'));
  h.result.currentBiS.obtainable = { loadouts: [], recommendations: [] };
  h.result.currentBiS.owned.recordedObtained = [];
  await h.panels.currentBiS(); assert.ok(h.find('p', 'No gear recommendations in this view.'));
  await h.find('button', 'Recorded obtained').events.click(); h.openDetails('All items you marked obtained');
  assert.ok(h.find('p', 'No items you marked obtained in this view.'));
});

test('manual training saves bind explicit personal inputs to the reviewed member and revision', async () => {
  const h = harness(); await h.openTraining();
  assert.equal(h.inputFor('Level possible without a main method (1–120)').value, '5');
  assert.equal(h.inputFor('Training level limit (1–120)').value, '90');
  h.inputFor('Assume a main training method').value = 'false';
  await h.find('button', 'Save training assumption').events.click();
  assert.deepEqual(h.ui.attempts[0], { command: { type: 'set-primary-override', memberId: 'a', skill: 'Mining', enabled: false }, revision: 7 });
  await h.openTraining(); h.inputFor('Level possible without a main method (1–120)').value = '12'; h.inputFor('Training level limit (1–120)').value = '';
  await h.find('button', 'Save training levels').events.click();
  assert.deepEqual(h.ui.attempts[1], { command: { type: 'set-skill-levels', memberId: 'a', skill: 'Mining', passiveLevel: 12, maxLevel: null }, revision: 7 });
});

test('invalid levels and stale manual training panels cannot issue commands', async () => {
  const h = harness(); await h.openTraining();
  const save = h.find('button', 'Save training levels');
  h.inputFor('Level possible without a main method (1–120)').value = '5.5';
  assert.throws(() => save.events.click(), /whole level/);
  h.inputFor('Level possible without a main method (1–120)').value = '5';
  h.ui.memberId = 'b'; await assert.rejects(save.events.click(), /selected member changed/);
  h.ui.memberId = 'a'; h.state.revision = 8; await assert.rejects(save.events.click(), /Saved state changed/);
  assert.equal(h.ui.attempts.length, 0);
});

test('Slayer locking uses manual reported levels and declared assignments, with an explicit unlock', async () => {
  const h = harness(); await h.panels.activityInfo('Slayer');
  const enabled = h.inputFor('Slayer locked for Player'); enabled.checked = true; enabled.events.change();
  h.inputFor('Manually reported Slayer level (1–120)').value = '21';
  h.inputFor('Locked Slayer task').value = 'Bats'; h.inputFor('Locked Reaper task').value = 'None';
  await h.find('button', 'Save Slayer lock').events.click();
  assert.deepEqual(h.ui.attempts[0], { command: { type: 'set-slayer-lock', memberId: 'a', lock: { level: 21, monster: 'Bats', boss: 'None' } }, revision: 7 });
  assert.equal(h.find('button', 'Slayer').attributes['aria-selected'], 'true');
  h.inputFor('Slayer locked for Player').checked = false;
  await h.find('button', 'Save Slayer lock').events.click();
  assert.deepEqual(h.ui.attempts[1].command, { type: 'set-slayer-lock', memberId: 'a', lock: null });
});

test('specialist evidence resolves canonical requirements and keeps personal-record comparisons separate', async () => {
  const h = harness();
  const relic = { id: 'relic:test', label: 'Obtainable relic goal', category: 'Extra', status: 'available', record: { Skills: { Archaeology: 30 } }, sources: [] };
  h.result.tasks = [relic];
  const specialist = tasks => ({ tank: { loadouts: [], recommendations: [] }, weight: { recommendations: [], coverage: { supported: false, declaredWeightRecords: 0, eligibleWeightRecords: 0, explanation: 'No declared weight metadata.' } }, skilling: { sets: [], unranked: [] }, relics: { tasks, coverage: { limitations: ['Activation energy is unconfirmed.'] } }, misc: { tasks: [] }, upgradePaths: [], coverage: { limitations: [] } });
  h.result.currentBiS = { accessPolicy: 'shared', completionScope: 'any', obtainable: { loadouts: [], recommendations: [], specialist: specialist([{ id: relic.id, evidenceTaskId: relic.id, label: relic.label, status: 'available' }]) }, owned: { explanation: 'Possession unconfirmed.', recordedObtained: [], recordedBest: { loadouts: [], recommendations: [], specialist: specialist([]), coverage: { limitations: [], excludedRecordedItems: [], eligibleRecordedItems: 0 } } } };
  await h.panels.currentBiS(); h.openDetails('Specialist comparisons');
  await h.find('button', 'Relics').events.click(); h.openDetails('Requirements and sources');
  assert.ok(h.find('li', 'Archaeology: 30'));
  await h.find('button', 'Recorded obtained').events.click(); h.openDetails('Specialist comparisons');
  await h.find('button', 'Relics').events.click();
  assert.equal(h.find('strong', relic.label), undefined);
  assert.ok(h.find('p', 'No relic prerequisite goals in this view.'));
  await h.find('button', 'Weight').events.click();
  assert.equal(h.find('p', 'Item weights are unknown.').className, 'warning');
});

test('closed or superseded panel failures stay quiet, while active calculation failures propagate', async () => {
  for (const panel of ['currentBiS', 'activityInfo']) {
    for (const invalidation of ['close', 'replace', 'member']) {
      const h = harness(); let reject;
      h.ui.open = true; h.ui.title = 'Existing panel';
      h.ui.pendingResult = new Promise((resolve, fail) => { reject = fail; });
      const request = h.panels[panel]();
      if (invalidation === 'close') h.ui.open = false;
      else if (invalidation === 'replace') { h.ui.generation++; h.ui.title = 'Newer dialog'; }
      else h.ui.memberId = 'b';
      reject(new Error('Selected map changed while loading'));
      await assert.doesNotReject(request, `${panel}: ${invalidation}`);
      // Current BiS opens its own Loading… dialog before the calculation.
      assert.equal(h.ui.title, invalidation === 'replace' ? 'Newer dialog' : panel === 'currentBiS' ? 'Current BiS' : 'Existing panel');
    }
    const active = harness();
    active.ui.pendingResult = Promise.reject(new Error('Task calculation failed'));
    await assert.rejects(active.panels[panel](), /Task calculation failed/, `${panel}: current error is preserved`);
  }
});

test('successful late info panels cannot replace a newer dialog or a newer panel request', async () => {
  for (const panel of ['currentBiS', 'activityInfo']) {
    const h = harness(); let resolve;
    h.ui.pendingResult = new Promise(done => { resolve = done; });
    const old = h.panels[panel](); h.ui.generation++; h.ui.title = 'Settings'; h.ui.open = true;
    resolve(h.result); await old; assert.equal(h.ui.title, 'Settings');
  }
  const h = harness(); let resolveOld, resolveNew;
  h.ui.pendingResult = new Promise(done => { resolveOld = done; }); const old = h.panels.activityInfo();
  h.ui.pendingResult = new Promise(done => { resolveNew = done; }); const newer = h.panels.currentBiS();
  resolveNew(h.result); await newer; resolveOld(h.result); await old;
  assert.equal(h.ui.title, 'Current BiS');
});

test('Advanced controls BiS ranking diagnostics while useful comparisons and limitations stay visible', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ advanced }); bisFixture(h); const before = structuredClone(h.result);
    await h.panels.currentBiS(); h.openDetails('Details: Acadia longbow');
    assert.equal(!!h.find('p', 'Picker ranking components: 10 / 5 · Declared comparison.'), advanced);
    assert.ok(h.find('p', 'You marked obtained: no · Task: done · Checked by Reed'));
    h.openDetails('Ranged: tied alternatives');
    assert.equal(!!h.find('p', 'shield · Score 80.00 · 12.50 below selected score'), advanced);
    assert.equal(!!h.find('p', 'shield · Lower ranked alternative'), !advanced);
    await h.find('button', 'Recorded obtained').events.click();
    assert.equal(h.nodes().some(node => node.textContent.startsWith('Personal-record ranking issues')), advanced);
    h.openDetails('Historical records excluded from ranking'); assert.ok(h.find('p', 'Currently ineligible.'));
    assert.deepEqual(h.result, before); assert.equal(h.ui.attempts.length, 0);
  }
});

test('known chunk names replace IDs in sources and default views keep unknown gameplay requirements', async () => {
  const h = harness();
  h.ctx.world = () => ({ chunks: new Map([['12345', { name: 'Lumbridge' }]]) });
  const source = h.panels.sourceView([{ kind: 'task', sourceKind: 'raw-source-kind', name: 'Useful tool', probability: 0.01, location: '12345' }], { tasks: [] });
  h.ui.nodes = [source];
  assert.ok(h.find('p', 'Training or task')); assert.ok(h.find('p', 'Location: Lumbridge'));
  assert.equal(h.nodes().some(node => node.textContent.includes('12345')), false);
  assert.equal(h.nodes().some(node => /raw-source-kind|Probability:/.test(node.textContent)), false);
  h.result.activityInfo.slayer.limitations = ['Eligibility uses reachable training ceilings. Current combat/Slayer levels and the in-game assignment are not independently verified by manual declarations. Personal quest requirements are not satisfied by another member’s completion.'];
  await h.panels.activityInfo('Slayer');
  assert.ok(h.find('li', 'Possible assignments use the levels your chunks can support. Your current combat and Slayer levels and in-game assignment may differ. You must complete required quests yourself.'));
  const meter = h.nodes().find(node => node.tag === 'progress');
  assert.equal(meter, undefined, 'Slayer view does not draw the skill meter');
  await h.panels.activityInfo();
  const progress = h.nodes().find(node => node.tag === 'progress'); assert.equal(progress.max, 90); assert.equal(progress.value, 90); assert.equal(progress.style, undefined);
});

for (const kind of [429, 503, 409, 413, 'offline', 'ECONNRESET']) test(`request failure ${kind}: Activity Info training plan keeps its form and recovers`, async () => {
  const h = harness(); let failed = true;
  const read = createRequestReader({ fetch: async () => {
    if (failed && typeof kind === 'string') throw new TypeError(kind);
    return new Response(JSON.stringify(failed ? { message: 'Error: internal stack\n at server (/private/file:1)' } : { status: 'estimated', fromLevel: 10, toLevel: 20, xpNeeded: 1000, plans: {} }), { status: failed ? kind : 200 });
  } });
  h.ctx.api = async path => { const { response, value } = await read(path); if (!response.ok) throw requestError(response, value); return value; };
  await h.openTraining();
  h.inputFor('From level').value = '10'; h.inputFor('To level').value = '20';
  const run = h.find('button', 'Plan training'); await run.events.click();
  const output = h.nodes().find(node => node.className === 'plan-output');
  assert.match(output.children[0].textContent, /Too many requests|busy or restarting|saved map changed|too large|Check your internet/);
  assert.doesNotMatch(output.children[0].textContent, /Error:|stack|ECONN|private/);
  assert.equal(h.inputFor('From level').value, '10'); failed = false; await run.events.click();
  assert.ok(h.find('p', '1,000 XP from level 10 to 20')); assert.equal(h.ui.attempts.length, 0);
});

test('Slayer chances show before expansion, with exact weights in advanced details and quest conditions on assignments', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ advanced });
    const planning = { line: "About 1 in 4 of Jacquelyn's tasks can't be done in your chunks yet (Cows).", weightsKnown: true, stuckWeight: 15, poolWeight: 60, unknownWeight: 0 };
    h.result.activityInfo.slayer.masters = [{ name: 'Jacquelyn', reachable: true, eligibleCount: 1, totalCount: 2,
      warnings: { planning, current: { line: 'Sync your levels to see your chances right now.' } },
      tasks: [{ name: 'Bats', weight: 10, planningEligible: true, afterQuests: ['The Blood Pact'], reachableMonsters: ['Warped bat'], blockers: [], requirements: {} }] }];
    await h.panels.activityInfo('Slayer');
    assert.ok(h.find('p', planning.line));
    assert.ok(h.find('p', 'Sync your levels to see your chances right now.'));
    assert.equal(h.find('p', 'Possible after The Blood Pact.'), undefined);
    h.openDetails('Jacquelyn');
    assert.ok(h.find('p', 'Possible after The Blood Pact.'));
    const exact = h.find('p', "Planning: 15 / 60 assignment weight can't be done (25.00%); 0 / 60 can't be checked.");
    assert.equal(!!exact, advanced);
  }
});
