import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { loadRulesCatalogue, rulesCatalogue, buildRulesSections, taskRuleValue, ruleEnabled, filterRulesSections, planTaskRuleChange, reviewPreset } from '../app/web/rules-model.mjs';
import { createRulesPanel } from '../app/web/rules-panel.mjs';
import { isKeptTaskRule, visibleRulesSections, keptRulesSectionId, keptRulesSectionName } from '../app/web/kept-rules.mjs';

const owners = [{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }];
const clock = () => '2026-10-08T12:00:00.000Z';
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const definitionsFor = state => buildRulesSections(rulesCatalogue, state).flatMap(section => section.rules);
const definitionFor = (state, id) => { const definition = definitionsFor(state).find(rule => rule.id === id); assert.ok(definition, id); return definition; };
const effectiveValues = (state, memberId) => new Map(definitionsFor(state).map(definition => [definition.id, taskRuleValue(state, memberId, definition).value]));

test('captured catalogue validates without execution and preserves source section, label and hierarchy order', async () => {
  const raw = JSON.parse(await readFile(new URL('../app/data/original-rules-ui.2026-10-08.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(loadRulesCatalogue(raw), rulesCatalogue);
  assert.deepEqual(raw.sections.map(section => section.name), ['Visible Tasks', 'Overall Skill', 'Agility', 'Combat', 'Construction', 'Farming', 'Herblore', 'Hunter', 'Invention', 'Magic', 'Mining', 'Prayer', 'Ranged', 'Runecrafting', 'Slayer', 'Smithing', 'Achievements', 'Collections', 'Item Sources', 'Miscellaneous']);
  assert.deepEqual(raw.presets.map(preset => preset.name), ['Vanilla Chunker', 'Extreme Chunker', 'Supreme Chunker']);
  const sections = buildRulesSections(raw, createGroupState(owners));
  assert.deepEqual(sections.slice(0, raw.sections.length).map(section => [section.id, section.name]), raw.sections.map(section => [section.id, section.name]));
  for (const [index, source] of raw.sections.entries()) {
    const rendered = sections[index].rules.filter(rule => rule.original);
    assert.deepEqual(rendered.map(rule => rule.id), source.rows.map(row => row.key), source.name);
    for (const [position, row] of source.rows.entries()) {
      assert.equal(rendered[position].label, row.key === 'Achievement' ? 'Show Achievement Tasks' : row.key === 'Rare Drop' ? 'Include drops rarer than my cutoff' : row.label ?? row.key);
      assert.equal(rendered[position].parent, row.parentKey ?? null);
      assert.equal(rendered[position].depth, row.depth ?? (row.parentKey ? 1 : 0));
    }
  }
  for (const [amount, inclusive] of [['Rare Drop Amount', 'Rare Drop Inclusive'], ['Secondary Primary Amount', 'Secondary Primary Inclusive']]) {
    const rows = sections.find(section => section.rules.some(rule => rule.id === amount)).rules;
    const index = rows.findIndex(rule => rule.id === amount);
    assert.equal(rows[index + 1].id, inclusive);
    assert.equal(rows[index + 1].parent, amount);
  }
  assert.equal(sections.flatMap(section => section.rules).find(rule => rule.id === 'Multi Step Processing').tooltips.length, 1);
  const malformed = edit => { const value = structuredClone(raw); edit(value); return value; };
  assert.throws(() => loadRulesCatalogue(malformed(value => value.rules.push(value.rules[0]))), /Duplicate/);
  assert.throws(() => loadRulesCatalogue(malformed(value => value.sections[0].rows[0].key = 'missing-source-key')), /Unknown.*section rule/);
  const setParent = (value, parent) => {
    value.rules[0].parentKey = parent;
    for (const section of value.sections) for (const row of section.rows) if (row.key === value.rules[0].key) row.parentKey = parent;
  };
  assert.throws(() => loadRulesCatalogue(malformed(value => setParent(value, value.rules[0].key))), /Cyclic/);
  assert.throws(() => loadRulesCatalogue(malformed(value => setParent(value, 'missing-parent'))), /Unknown parent/);
  assert.throws(() => loadRulesCatalogue(malformed(value => value.sections[0].rows[0].parentKey = value.sections[0].rows[0].key)), /Cyclic|hierarchy|mismatch/i);
});

test('absent imported rules stay automatic while explicit, inherited and migrated values retain their provenance', () => {
  const state = createGroupState(owners), skills = definitionFor(state, 'Show Skill Tasks');
  assert.deepEqual(taskRuleValue(state, 'player1', skills), { value: true, source: 'Automatic', explicit: false });
  state.taskRules = { 'Show Skill Tasks': false };
  assert.deepEqual(taskRuleValue(state, 'player1', skills), { value: false, source: 'Inherited', explicit: false });
  state.members[0].taskRules = { 'Show Skill Tasks': true };
  assert.deepEqual(taskRuleValue(state, 'player1', skills), { value: true, source: 'Personal override', explicit: true });
  delete state.taskRules; state.members[0].taskRules = {}; state.members[0].sourceMapId = 'qxa';
  state.legacy = { maps: { qxa: { rules: { 'Show Skill Tasks': false } } } };
  assert.deepEqual(taskRuleValue(state, 'player1', skills), { value: false, source: 'Imported', explicit: false });
  state.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'player1', sourceMapId: 'qxa' }] };
  assert.equal(taskRuleValue(state, 'player1', skills).value, true);
  for (const [id, value] of [['Rare Drop Amount', '1000'], ['Rare Drop Inclusive', false], ['Secondary Primary Inclusive', true], ['Non-permanent BiS', true], ['House storage tasks', false]]) {
    assert.equal(taskRuleValue(state, 'player1', definitionFor(state, id)).value, value, id);
  }
  assert.throws(() => taskRuleValue(state, 'missing-member', skills), /Unknown rules player/);
});

test('parent changes disable descendants while keeping personal values and custom cutoffs across off and on', () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'Show Quest Tasks': true, 'Show Quest Tasks Complete': true, 'Rare Drop': false, 'Rare Drop Amount': '1/777' };
  initial.members[1].taskRules = { 'Show Quest Tasks': false, 'Rare Drop Amount': '1/22' };
  const baseline = structuredClone(initial), parent = definitionFor(initial, 'Show Quest Tasks'), child = definitionFor(initial, 'Show Quest Tasks Complete');
  const plan = planTaskRuleChange(initial, ['player1'], parent, false);
  assert.deepEqual(initial, baseline, 'Planning has no state side effects');
  assert.deepEqual(plan.commands, [{ type: 'set-task-rule', memberId: 'player1', ruleId: parent.id, value: false }]);
  let saved = applyCommand(initial, plan.commands[0], { now: clock });
  assert.equal(ruleEnabled(child, effectiveValues(saved, 'player1'), definitionsFor(saved)), false);
  assert.equal(saved.members[0].taskRules[child.id], true);
  saved = applyCommand(saved, planTaskRuleChange(saved, ['player1'], parent, true).commands[0], { now: clock });
  assert.equal(ruleEnabled(child, effectiveValues(saved, 'player1'), definitionsFor(saved)), true);
  assert.equal(saved.members[0].taskRules[child.id], true);
  const rare = definitionFor(saved, 'Rare Drop'), amount = definitionFor(saved, 'Rare Drop Amount');
  for (const [value, editable] of [[true, true], [false, true]]) {
    saved = applyCommand(saved, planTaskRuleChange(saved, ['player1'], rare, value).commands[0], { now: clock });
    assert.equal(ruleEnabled(amount, effectiveValues(saved, 'player1'), definitionsFor(saved)), editable);
    assert.equal(saved.members[0].taskRules[amount.id], '1/777');
  }
  assert.deepEqual(saved.members[1], initial.members[1], 'Player 2 retains his own overrides');
});

test('search and Rules On keep matching child ancestry without enabling or mutating its disabled parent', () => {
  const state = createGroupState(owners), sections = buildRulesSections(rulesCatalogue, state);
  state.members[0].taskRules = { 'Show Quest Tasks': false, 'Show Quest Tasks Complete': true };
  const values = effectiveValues(state, 'player1'), baseline = structuredClone(state);
  for (const filter of [{ query: 'Show Quest Tasks Complete' }, { query: 'Show Quest Tasks Complete', onlyOn: true }]) {
    const visible = filterRulesSections(sections, values, filter).flatMap(section => section.rules);
    const parent = visible.find(rule => rule.id === 'Show Quest Tasks'), child = visible.find(rule => rule.id === 'Show Quest Tasks Complete');
    assert.ok(parent); assert.ok(child); assert.equal(parent.contextOnly, true); assert.equal(child.contextOnly, false);
    assert.equal(ruleEnabled(child, values, definitionsFor(state)), false);
  }
  assert.equal(filterRulesSections(sections, values, { query: 'no-such-rule-zzzz' }).length, 0);
  assert.deepEqual(state, baseline);
});

test('Collection Log enable defaults fill automatic children while preserving chosen child overrides', () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'Collection Log': false, 'Boss Collection Log': false, 'Slayer Collection Log': true, 'custom retained key': 'kept' };
  initial.members[1].taskRules = { 'Collection Log': false, 'Boss Collection Log': true };
  const parent = definitionFor(initial, 'Collection Log'), plan = planTaskRuleChange(initial, ['player1'], parent, true);
  assert.equal(plan.commands.length, 1); assert.equal(plan.commands[0].type, 'set-task-rule');
  let saved = applyCommand(initial, plan.commands[0], { now: clock });
  assert.equal(saved.members[0].taskRules['Boss Collection Log'], false, 'Explicit disabled choice survives parent enable');
  assert.equal(saved.members[0].taskRules['Slayer Collection Log'], true);
  assert.equal(saved.members[0].taskRules['custom retained key'], 'kept');
  for (const row of rulesCatalogue.rules.filter(rule => rule.parentKey === parent.id && rule.key !== 'Boss Collection Log')) {
    assert.equal(taskRuleValue(saved, 'player1', { id: row.key }).value, true, row.key);
    if (row.key !== 'Slayer Collection Log') assert.equal(Object.hasOwn(saved.members[0].taskRules, row.key), false, 'Automatic children need no stored override');
  }
  const children = { ...saved.members[0].taskRules };
  saved = applyCommand(saved, planTaskRuleChange(saved, ['player1'], parent, false).commands[0], { now: clock });
  assert.deepEqual(saved.members[0].taskRules, { ...children, 'Collection Log': false });
  assert.deepEqual(saved.members[1], initial.members[1]);
});

test('preset review names the selected player, preserves retained keys and applies as one undoable save', () => {
  const initial = createGroupState(owners), preset = rulesCatalogue.presets[0];
  initial.members[0].taskRules = { 'custom retained key': 'kept', 'Show Skill Tasks': false, 'Non-permanent BiS': false, 'House storage tasks': true, 'Rare Drop Inclusive': true };
  initial.members[1].taskRules = { 'custom partner key': 'Player 2 value', 'Show Skill Tasks': false };
  const baseline = structuredClone(initial), review = reviewPreset(initial, ['player1'], preset);
  assert.equal(review.name, preset.name); assert.equal(review.revision, initial.revision); assert.deepEqual(review.memberIds, ['player1']);
  assert.ok(review.changes.length); assert.equal(review.commands.length, 1); assert.deepEqual(initial, baseline);
  assert.equal(review.commands[0].type, 'set-profile'); assert.equal(review.commands[0].memberId, 'player1');
  assert.equal(review.commands[0].taskRules['custom retained key'], 'kept');
  let saved = applyCommand(initial, review.commands[0], { expectedRevision: review.revision, now: clock });
  assert.equal(saved.revision, initial.revision + 1); assert.equal(saved.history.length, initial.history.length + 1);
  for (const [key, value] of Object.entries(preset.effectiveValues ?? preset.values)) {
    if (isKeptTaskRule(key)) continue;
    assert.equal(key === 'F2P' ? saved.rules['content.f2p'] : saved.members[0].taskRules[key], value, key);
  }
  assert.deepEqual(saved.members[1], initial.members[1]);
  for (const id of ['Non-permanent BiS', 'House storage tasks', 'Rare Drop Inclusive']) assert.equal(saved.members[0].taskRules[id], initial.members[0].taskRules[id], id);
  saved = applyCommand(saved, { type: 'undo' }, { now: clock });
  assert.deepEqual(saved.rules, initial.rules); assert.deepEqual(saved.members.map(member => member.taskRules), initial.members.map(member => member.taskRules));
  const player2Review = reviewPreset(initial, ['player2'], preset);
  assert.equal(player2Review.commands[0].memberId, 'player2'); assert.equal(player2Review.commands[0].taskRules['custom partner key'], 'Player 2 value');
  assert.throws(() => reviewPreset(initial, ['player1'], { name: 'Missing preset', values: {} }), /Unknown rules preset/);
});

test('all captured presets produce valid primitive task values, including Supreme array membership', () => {
  const state = createGroupState(owners);
  for (const preset of rulesCatalogue.presets) {
    const review = reviewPreset(state, ['player1'], preset);
    assert.equal(review.commands.length, 1, preset.name);
    const saved = applyCommand(state, review.commands[0], { now: clock });
    for (const value of Object.values(saved.members[0].taskRules)) assert.ok(value === null || ['boolean', 'number', 'string'].includes(typeof value), preset.name);
    if (preset.name === 'Supreme Chunker') {
      assert.equal(saved.members[0].taskRules['All Droptables'], true);
      assert.equal(Object.hasOwn(saved.members[0].taskRules, 'All Droptables Nest'), false, 'Inert nest preference stays unset');
    }
    for (const row of rulesCatalogue.rules) if (!isKeptTaskRule(row.key) && !Object.hasOwn(preset.values, row.key) && !rulesCatalogue.inputs.numeric.some(input => input.key === row.key) && row.key !== 'F2P') {
      assert.equal(saved.members[0].taskRules[row.key], false, `${preset.name}: omitted ${row.key}`);
    }
  }
});

// The panel runs unchanged against a minimal DOM and the real state command
// boundary. All gameplay in these tests is synthetic and remains in memory.
function panelHarness(factory, { initialState = createGroupState(owners) } = {}) {
  let state = initialState, memberId = 'player1', generation = 0, currentDialog;
  const registry = createRuleRegistry(), calls = [], errors = [], downloads = [];
  class Node {
    constructor(tag, text, className) { Object.assign(this, { tagName: tag.toUpperCase(), textContent: text ?? '', className: className ?? '', children: [], events: {}, attributes: {}, dataset: {}, value: '', style: { setProperty() {} } }); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') { node.remove?.(); node.parent = this; } this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) if (typeof node === 'object') node.parent = undefined; this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    emit(key, event = {}) { return Promise.all((this.events[key] ?? []).map(action => action(event))); }
    contains(node) { return this === node || this.children.some(child => typeof child === 'object' && child.contains?.(node)); }
    get isConnected() { return currentDialog?.content.contains(this) ?? false; }
    focus() { activeElement = this; }
    scrollIntoView() {}
  }
  let activeElement;
  const el = (tag, text, className) => new Node(tag, text, className);
  const button = (text, action, className) => { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
  const input = (type, value = '') => { const node = el('input'); node.type = type; node.value = value; return node; };
  const select = (options, value) => { const node = el('select'); for (const option of options) { const entry = typeof option === 'string' ? { value: option, label: option } : option; const child = el('option', entry.label); child.value = entry.value; node.append(child); } node.value = value; return node; };
  const field = (text, control) => { const node = el('label'); node.append(el('span', text), control); return node; };
  const details = (text, ...content) => { const node = el('details'); node.append(el('summary', text), ...content); return node; };
  let responder = async (payload, revision) => { state = applyCommand(state, payload, { expectedRevision: revision, registry, now: clock }); };
  const ctx = {
    registry: () => registry, state: () => state, memberId: () => memberId, preferences: () => state.members.find(member => member.id === memberId)?.preferences ?? {},
    el, button, input, select, field, details,
    openDialog(title, ...nodes) { const content = el('div'); content.append(...nodes); currentDialog = { title, content }; return ++generation; },
    dialogGeneration: () => generation, dialogCurrent: value => !!currentDialog && value === generation,
    beginDialogRequest: () => ++generation,
    closeDialog(value) { if (value !== undefined && value !== generation) return; generation++; currentDialog = undefined; },
    async command(payload, revision) { calls.push({ payload, revision }); return responder(payload, revision); },
    api: async () => { throw new Error('Unexpected API request'); },
    readJSON: async file => JSON.parse(await file.files[0].text()),
    download: (value, name) => downloads.push({ value, name }),
    jsonPreview: value => el('pre', JSON.stringify(value)), showError: error => errors.push(error),
  };
  const panel = factory(ctx), walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  const all = () => currentDialog ? walk(currentDialog.content) : [];
  const find = (tag, text) => all().find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
  const control = label => all().find(node => node.attributes['aria-label'] === label);
  const click = async text => { const node = find('button', text); assert.ok(node, text); await node.emit('click'); };
  return { panel, ctx, all, find, control, click, calls, errors, downloads, snapshot: () => structuredClone(state),
    dialog: () => currentDialog, generation: () => generation, activeElement: () => activeElement,
    adopt(next) { state = next; }, member(id) { memberId = id; }, route(action) { responder = action; } };
}

const nodeById = (h, id) => { const node = h.all().find(node => node.id === id); assert.ok(node, id); return node; };
const rowByRule = (h, id) => h.all().find(node => node.dataset.ruleId === id);
const controlByRule = (h, id) => {
  const row = rowByRule(h, id); assert.ok(row, id);
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  const control = walk(row).find(node => ['INPUT', 'SELECT'].includes(node.tagName)); assert.ok(control, id); return control;
};

test('all 25 inert catalogue rules have one Advanced group and functional rules keep their sections', () => {
  const state = createGroupState(owners), sections = buildRulesSections(rulesCatalogue, state, createRuleRegistry().definitions);
  const kept = [...new Set(sections.flatMap(section => section.rules).filter(rule => !rule.sharedRuleId && isKeptTaskRule(rule.id)).map(rule => rule.id))];
  assert.equal(kept.length, 25);
  const ordinary = visibleRulesSections(sections), advanced = visibleRulesSections(sections, true);
  assert.equal(ordinary.flatMap(section => section.rules).some(rule => kept.includes(rule.id)), false);
  assert.deepEqual(advanced.slice(0, -1), ordinary);
  const group = advanced.at(-1); assert.equal(group.id, keptRulesSectionId); assert.equal(group.name, keptRulesSectionName);
  assert.deepEqual(group.rules.map(rule => rule.id), kept);
  for (const section of sections) assert.deepEqual(ordinary.find(item => item.id === section.id)?.rules ?? [], section.rules.filter(rule => rule.sharedRuleId || !isKeptTaskRule(rule.id)));
  for (const id of ['Skiller', 'BIS Skilling', 'BIS Skilling Relics', 'Primary Spawns', 'Misc Combat achievements', 'Boss Collection Log']) assert.equal(isKeptTaskRule(id), false, id);
  for (const id of ['PvM Relics', 'KeyItem Bosses', 'All Droptables Nest']) assert.equal(isKeptTaskRule(id), true, id);
});

test('Advanced keeps inert rules read-only with visible explanations and folded examples, including saved historical keys', async () => {
  const state = createGroupState(owners); state.members[0].taskRules = { Pouch: true, 'Wield Crafted Items Override': false, 'Cleaning herbs': true };
  state.members[1].taskRules = { Pouch: false }; const baseline = structuredClone(state);
  const h = panelHarness(createRulesPanel, { initialState: state }); h.panel.open();
  assert.equal(rowByRule(h, 'Pouch'), undefined); assert.equal(rowByRule(h, 'Wield Crafted Items Override'), undefined); assert.equal(rowByRule(h, 'Cleaning herbs'), undefined);
  h.adopt({ ...h.snapshot(), members: h.snapshot().members.map((member, index) => index ? member : { ...member, preferences: { advanced: true } }) }); h.panel.open();
  const group = h.all().find(node => node.dataset.sectionId === keptRulesSectionId); assert.ok(group); assert.equal(group.open, false);
  const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
  const rows = descendants(group).filter(node => node.dataset.ruleId); assert.equal(rows.length, 26);
  assert.equal(descendants(group).some(node => ['INPUT', 'SELECT', 'BUTTON'].includes(node.tagName)), false);
  for (const row of rows) {
    assert.equal(descendants(row).filter(node => node.className === 'rules-explanation').length, 1);
    assert.equal(descendants(row).filter(node => node.className === 'rules-example').length, 1);
    assert.equal(descendants(row).find(node => node.className === 'rules-example').open, undefined);
  }
  assert.equal(rowByRule(h, 'Pouch').children[1].textContent, 'On · Personal override');
  const target = nodeById(h, 'rules-target'); target.value = 'both'; await target.emit('change');
  assert.equal(rowByRule(h, 'Pouch').children[1].textContent, 'Player 1: On · Player 2: Off');
  const search = nodeById(h, 'rules-search'); search.value = 'Pouch'; await search.emit('input');
  assert.ok(rowByRule(h, 'Pouch')); assert.equal(h.all().filter(node => node.dataset.ruleId === 'Pouch').length, 1);
  await h.click('Export rule profile'); assert.deepEqual(h.downloads[0].value.taskRules, baseline.members[0].taskRules);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.snapshot().members.map(member => member.taskRules), baseline.members.map(member => member.taskRules));
});

test('presets preserve every inert override and absence; sync and backup still round-trip them', () => {
  const initial = createGroupState(owners), ids = definitionsFor(initial).filter(rule => isKeptTaskRule(rule.id)).map(rule => rule.id);
  initial.members[0].sourceMapId = 'qxa';
  initial.members[0].taskRules = Object.fromEntries(ids.map((id, index) => [id, index % 2 === 0]));
  const before = structuredClone(initial);
  for (const preset of rulesCatalogue.presets) {
    const review = reviewPreset(initial, ['player1', 'player2'], preset);
    assert.equal(review.changes.some(change => isKeptTaskRule(change.ruleId)), false);
    let saved = initial;
    for (const command of review.commands) saved = applyCommand(saved, command, { expectedRevision: saved.revision, now: clock });
    for (const id of ids) {
      assert.equal(saved.members[0].taskRules[id], initial.members[0].taskRules[id], id);
      assert.equal(Object.hasOwn(saved.members[1].taskRules, id), false, id);
    }
  }
  const syncedValues = Object.fromEntries(ids.map((id, index) => [id, index % 2 !== 0]));
  const synced = applyCommand(initial, { type: 'sync-original', capturedAt: clock(), sourceHash: `sha256:${'a'.repeat(64)}`, members: [{ memberId: 'player1', sourceMapId: 'qxa', groups: ['rules'], taskRules: syncedValues }] }, { expectedRevision: initial.revision, now: clock });
  for (const id of ids) assert.equal(synced.members[0].taskRules[id], syncedValues[id], id);
  assert.deepEqual(importBackup(exportBackup(synced)).members[0].taskRules, synced.members[0].taskRules);
  assert.deepEqual(applyCommand(synced, { type: 'undo' }, { now: clock }).members[0].taskRules, before.members[0].taskRules);
  assert.deepEqual(initial, before);
});

test('view-only links can read rules without write controls or the Advanced kept group', () => {
  const h = panelHarness(createRulesPanel); h.ctx.canWrite = () => false;
  const state = h.snapshot(); state.members[0].preferences = { advanced: true }; h.adopt(state);
  h.panel.open(); assert.equal(h.dialog().title, 'Chunk Rules'); assert.equal(h.calls.length, 0);
  assert.equal(h.all().some(node => node.id?.startsWith('rules-control-')), false);
  assert.equal(h.all().some(node => node.dataset.sectionId === keptRulesSectionId), false);
  for (const label of ['Review preset', 'Apply preset', 'Export rule profile']) assert.equal(h.find('button', label), undefined);
  const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
  const row = rowByRule(h, 'Primary Spawns');
  assert.ok(descendants(row).some(node => node.textContent.startsWith('What it does:')));
  assert.equal(descendants(row).find(node => node.className === 'rules-example').open, undefined);
});

test('Rules list shows new copy, folds examples and retains the original words under More', () => {
  const h = panelHarness(createRulesPanel); h.panel.open();
  const row = rowByRule(h, 'Primary Spawns');
  const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
  const nodes = descendants(row), example = nodes.find(node => node.className === 'rules-example');
  assert.ok(nodes.some(node => node.textContent.startsWith('What it does:')));
  assert.ok(descendants(example).some(node => node.textContent.includes('white berries')));
  assert.equal(example.open, undefined);
  const more = nodes.find(node => node.className === 'rules-help');
  assert.ok(descendants(more).some(node => node.className === 'rules-original-tooltip'));
  assert.equal(h.calls.length, 0);
});

test('ordinary rules show coverage warnings, truthful rare-drop polarity and inactive saved children', () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'Collection Log': false, 'Arc Log': true };
  const h = panelHarness(createRulesPanel, { initialState: initial }); h.panel.open();
  const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
  const skiller = descendants(rowByRule(h, 'Skiller'));
  assert.ok(skiller.some(node => node.className === 'rules-coverage' && node.textContent === 'Partly supported'));
  assert.ok(skiller.some(node => node.className === 'rules-coverage-detail' && /Combat-level goals can still appear/.test(node.textContent)));
  assert.equal(skiller.filter(node => node.className === 'rules-coverage-detail').length, 1);
  const rare = rowByRule(h, 'Rare Drop');
  assert.equal(controlByRule(h, 'Rare Drop').attributes['aria-label'], 'Include drops rarer than my cutoff');
  assert.ok(descendants(rare).some(node => /On includes all drop rates.*Off applies Rare Drop Amount/.test(node.textContent)));
  const arc = controlByRule(h, 'Arc Log');
  assert.equal(arc.checked, true); assert.equal(arc.disabled, true);
  assert.ok(descendants(rowByRule(h, 'Arc Log')).some(node => /Inactive while a parent is Off.*value is kept/.test(node.textContent)));
  assert.equal(h.snapshot().members[0].taskRules['Arc Log'], true);
  assert.equal(h.calls.length, 0);
});

test('Advanced explains inert relics, keys and dataset-specific nests without changing saved values', () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'PvM Relics': true, 'KeyItem Bosses': true, 'All Droptables Nest': true, 'Cleaning herbs': true, 'Cleaning Herbs': false };
  initial.members[0].preferences = { advanced: true };
  const h = panelHarness(createRulesPanel, { initialState: initial }); h.panel.open();
  const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
  for (const [id, message] of [['PvM Relics', /No effect.*no combat-relic goals/], ['KeyItem Bosses', /No effect.*key rarity/], ['All Droptables Nest', /No effect.*no matching nest-loot task/]]) {
    const nodes = descendants(rowByRule(h, id));
    assert.ok(nodes.some(node => node.className === 'rules-coverage-detail' && message.test(node.textContent)), id);
    assert.equal(nodes.some(node => ['INPUT', 'SELECT'].includes(node.tagName)), false, id);
  }
  assert.ok(rowByRule(h, 'Cleaning herbs'));
  assert.deepEqual(h.snapshot().members[0].taskRules, initial.members[0].taskRules);
  assert.equal(h.calls.length, 0);
});

test('Chunk Rules cutoff switches save, reset to automatic and Undo without changing retained values', async () => {
  const state = createGroupState(owners); state.members[0].taskRules = { Pouch: true, 'Rare Drop Inclusive': false, 'Secondary Primary Inclusive': true };
  const h = panelHarness(createRulesPanel, { initialState: state }); h.panel.open();
  for (const [id, defaultValue] of [['Rare Drop Inclusive', false], ['Secondary Primary Inclusive', true]]) {
    const control = controlByRule(h, id); assert.equal(control.type, 'checkbox'); assert.equal(control.checked, defaultValue);
    control.checked = !defaultValue; await control.emit('change');
    assert.equal(h.snapshot().members[0].taskRules[id], !defaultValue);
    const descendants = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(descendants)];
    const reset = descendants(rowByRule(h, id)).find(node => node.tagName === 'BUTTON' && node.textContent === `Use automatic (${defaultValue ? 'On' : 'Off'})`); assert.ok(reset); await reset.emit('click');
    assert.equal(Object.hasOwn(h.snapshot().members[0].taskRules, id), false);
    assert.equal(controlByRule(h, id).checked, defaultValue);
    await h.ctx.command({ type: 'undo' }, h.snapshot().revision);
    assert.equal(h.snapshot().members[0].taskRules[id], !defaultValue);
    h.panel.open();
  }
  assert.equal(h.snapshot().members[0].taskRules.Pouch, true);
});

test('panel exposes labelled phone section navigation, native boolean switches and automatic values', async () => {
  const h = panelHarness(createRulesPanel); const advancedState = h.snapshot(); advancedState.members[0].preferences = { advanced: true }; h.adopt(advancedState); h.panel.open();
  assert.equal(h.dialog().title, 'Chunk Rules');
  const target = nodeById(h, 'rules-target'), preset = nodeById(h, 'rules-preset'), jump = nodeById(h, 'rules-jump');
  assert.deepEqual(target.children.map(option => option.value), ['player1', 'player2', 'both']);
  assert.deepEqual(preset.children.map(option => option.value), rulesCatalogue.presets.map(row => row.name));
  assert.equal(jump.attributes['aria-label'], 'Jump to a rule section');
  for (const source of visibleRulesSections(buildRulesSections(rulesCatalogue, h.snapshot()), true)) assert.ok(jump.children.some(option => option.value === source.id), source.name);
  const control = controlByRule(h, 'Show Skill Tasks');
  assert.equal(control.type, 'checkbox'); assert.equal(control.checked, true); assert.equal(control.indeterminate, false);
  assert.ok(h.find('p', 'Current: On · Automatic. Automatic default: On.'));
  assert.equal(control.attributes['aria-label'], definitionFor(h.snapshot(), 'Show Skill Tasks').label);
  assert.ok(h.all().find(node => node.id === control.attributes['aria-describedby']));
  assert.equal(h.all().filter(node => node.dataset.ruleId === 'F2P').length, 1, 'One authoritative shared F2P switch');
  const destination = rulesCatalogue.sections.find(section => section.name === 'Item Sources');
  jump.value = destination.id; await jump.emit('change');
  assert.equal(h.all().find(node => node.dataset.sectionId === destination.id).open, true);
  assert.equal(h.calls.length, 0, 'Navigation never saves rules');
});

test('panel search and On filter expose a saved child with its disabled parent and keep values intact', async () => {
  const state = createGroupState(owners); state.members[0].taskRules = { 'Show Quest Tasks': false, 'Show Quest Tasks Complete': true };
  const h = panelHarness(createRulesPanel, { initialState: state }); h.panel.open();
  const search = nodeById(h, 'rules-search'); search.value = 'Show Quest Tasks Complete'; await search.emit('input');
  const on = nodeById(h, 'rules-only-on'); on.checked = true; await on.emit('change');
  assert.ok(rowByRule(h, 'Show Quest Tasks'));
  assert.equal(controlByRule(h, 'Show Quest Tasks Complete').checked, true);
  assert.equal(controlByRule(h, 'Show Quest Tasks Complete').disabled, true);
  assert.equal(rowByRule(h, 'Show Quest Tasks').className.includes('rules-context'), true);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.snapshot().members[0].taskRules, state.members[0].taskRules);
  search.value = 'missing-rule-zzzz'; await search.emit('input');
  assert.ok(h.find('p', 'No matching rules. Clear the search or turn off the On filter.'));
});

test('panel saves a selected player independently and changing a parent preserves her numeric cutoff', async () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'Rare Drop': false, 'Rare Drop Amount': '1/777' };
  initial.members[1].taskRules = { 'Rare Drop': false, 'Rare Drop Amount': '1/22' };
  const h = panelHarness(createRulesPanel, { initialState: initial }); h.panel.open();
  const rare = controlByRule(h, 'Rare Drop'); rare.checked = true; await rare.emit('change');
  assert.equal(controlByRule(h, 'Rare Drop Amount').disabled, false, 'Original numeric inputs remain editable');
  assert.equal(h.snapshot().members[0].taskRules['Rare Drop Amount'], '1/777');
  assert.deepEqual(h.calls[0].payload, { type: 'set-task-rule', memberId: 'player1', ruleId: 'Rare Drop', value: true });
  const target = nodeById(h, 'rules-target'); target.value = 'player2'; await target.emit('change');
  const amount = controlByRule(h, 'Rare Drop Amount'); assert.equal(amount.value, '1/22'); amount.value = '1/88'; await amount.emit('change');
  assert.equal(h.calls[1].payload.memberId, 'player2');
  assert.equal(h.snapshot().members[1].taskRules['Rare Drop Amount'], '1/88');
  assert.equal(h.snapshot().members[0].taskRules['Rare Drop Amount'], '1/777');
});

test('preset UI reviews before saving and rejects a review after a remote revision changes', async () => {
  const h = panelHarness(createRulesPanel); h.panel.open();
  const target = nodeById(h, 'rules-target'); target.value = 'player2'; await target.emit('change');
  await h.click('Review preset');
  assert.equal(h.calls.length, 0); assert.ok(h.find('h3', `Review ${rulesCatalogue.presets[0].name}`));
  assert.ok(h.all().some(node => node.tagName === 'LI' && node.textContent.startsWith('Player 2 · ')));
  const changed = h.snapshot(); changed.revision++; h.adopt(changed);
  await h.click('Apply preset'); assert.equal(h.calls.length, 0); assert.equal(h.find('button', 'Apply preset').disabled, true);
  assert.ok(h.find('p', 'Rules changed since this review. Review the preset again.'));
  await h.click('Review preset'); await h.click('Apply preset');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].payload.memberId, 'player2'); assert.equal(h.calls[0].revision, changed.revision);
  assert.equal(h.snapshot().revision, changed.revision + 1);
  assert.ok(h.find('p', 'Saved. Undo is available in History.'));
  await h.ctx.command({ type: 'undo' }, h.snapshot().revision);
  assert.deepEqual(h.snapshot().members.map(member => member.taskRules), changed.members.map(member => member.taskRules));
});

test('Both players UI captures distinct task overrides and saves each selected member at successive revisions', async () => {
  const initial = createGroupState(owners);
  initial.members[0].taskRules = { 'Show Skill Tasks': false, 'custom retained key': 'Player 1 value' };
  initial.members[1].taskRules = { 'Show Skill Tasks': true, 'custom retained key': 'Player 2 value' };
  const h = panelHarness(createRulesPanel, { initialState: initial }); h.panel.open();
  const target = nodeById(h, 'rules-target'); target.value = 'both'; await target.emit('change');
  assert.equal(controlByRule(h, 'Show Skill Tasks').indeterminate, true);
  await h.click('Review preset'); assert.equal(h.calls.length, 0); await h.click('Apply preset');
  assert.deepEqual(h.calls.map(call => call.payload.memberId), ['player1', 'player2']);
  assert.deepEqual(h.calls.map(call => call.revision), [initial.revision, initial.revision + 1]);
  assert.equal(h.snapshot().revision, initial.revision + 2);
  assert.equal(h.snapshot().members[0].taskRules['custom retained key'], 'Player 1 value');
  assert.equal(h.snapshot().members[1].taskRules['custom retained key'], 'Player 2 value');
  await h.ctx.command({ type: 'undo' }, h.snapshot().revision);
  await h.ctx.command({ type: 'undo' }, h.snapshot().revision);
  assert.deepEqual(h.snapshot().members.map(member => member.taskRules), initial.members.map(member => member.taskRules));
});

test('late rule save and failure leave a replacement dialog unchanged', async () => {
  for (const succeeds of [true, false]) {
    const h = panelHarness(createRulesPanel), response = deferred(); h.panel.open();
    h.route(async (payload, revision) => { await response.promise; if (!succeeds) throw new Error('Injected rule save failure'); h.adopt(applyCommand(h.snapshot(), payload, { expectedRevision: revision, now: clock })); });
    const control = controlByRule(h, 'Show Skill Tasks'); control.checked = true;
    const saving = control.emit('change'); await flush();
    h.ctx.openDialog('Newer dialog', h.ctx.el('p', 'Keep this content')); const replacement = h.dialog();
    response.resolve(); await saving;
    assert.equal(h.dialog(), replacement); assert.equal(h.dialog().title, 'Newer dialog');
    assert.equal(h.errors.length, 0, 'Obsolete errors cannot replace the new view');
    assert.equal(h.snapshot().members[0].taskRules?.['Show Skill Tasks'], succeeds ? true : undefined);
  }
});

test('a stale child change or reset refreshes a remotely disabled parent without issuing a command', async () => {
  for (const action of ['change', 'reset']) {
    const initial = createGroupState(owners);
    initial.members[0].taskRules = { 'Show Quest Tasks': true, 'Show Quest Tasks Complete': true };
    const h = panelHarness(createRulesPanel, { initialState: initial }); h.panel.open();
    const control = controlByRule(h, 'Show Quest Tasks Complete'); assert.equal(control.disabled, false);
    const row = rowByRule(h, 'Show Quest Tasks Complete');
    // "Use automatic" sits inside the row's More details.
    const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
    const reset = descendants(row).find(node => node.tagName === 'BUTTON' && node.textContent === 'Use automatic (Off)'); assert.ok(reset);
    const remote = h.snapshot(); remote.revision++; remote.members[0].taskRules['Show Quest Tasks'] = false; h.adopt(remote);
    if (action === 'change') { control.checked = false; await control.emit('change'); }
    else await reset.emit('click');
    assert.equal(h.calls.length, 0, action);
    assert.equal(h.snapshot().members[0].taskRules['Show Quest Tasks Complete'], true);
    assert.equal(controlByRule(h, 'Show Quest Tasks').checked, false);
    assert.equal(controlByRule(h, 'Show Quest Tasks Complete').disabled, true);
    assert.notEqual(controlByRule(h, 'Show Quest Tasks Complete'), control, 'The panel shows the latest controls');
    assert.ok(h.find('p', 'Rules changed since this row was shown. Review the latest value and try again.'));
  }
});

test('a pending direct save disables preset apply and keeps its review until the newer revision is reviewed', async () => {
  const initial = createGroupState(owners); initial.members[0].taskRules = { 'Show Skill Tasks': false };
  const h = panelHarness(createRulesPanel, { initialState: initial }), response = deferred(); h.panel.open();
  await h.click('Review preset'); const review = h.find('h3', `Review ${rulesCatalogue.presets[0].name}`).parent;
  const apply = h.find('button', 'Apply preset'); assert.equal(apply.disabled, false);
  h.route(async (payload, revision) => { await response.promise; h.adopt(applyCommand(h.snapshot(), payload, { expectedRevision: revision, now: clock })); });
  const control = controlByRule(h, 'Show Skill Tasks'); control.checked = true; const saving = control.emit('change'); await flush();
  assert.equal(h.calls.length, 1); assert.equal(apply.disabled, true);
  await apply.emit('click');
  assert.equal(h.calls.length, 1, 'Even an already queued click cannot start another save');
  assert.ok(h.all().includes(review), 'The pending save does not consume the preset review');
  response.resolve(); await saving;
  assert.ok(h.all().includes(review)); assert.equal(h.snapshot().revision, initial.revision + 1);
  await apply.emit('click'); assert.equal(h.calls.length, 1); assert.equal(apply.disabled, true);
  assert.ok(h.all().includes(review));
  assert.ok(h.find('p', 'Rules changed since this review. Review the preset again.'));
});

for (const fail of [false, true]) test(`pending rule keeps its chosen value and Saving feedback until ${fail ? 'failure' : 'confirmation'}`, async () => {
  const h = panelHarness(createRulesPanel), response = deferred(); h.panel.open();
  const initial = controlByRule(h, 'Show Best in Slot Tasks').checked;
  h.route(async payload => { await response.promise; if (fail) throw new Error('Refused'); h.adopt(applyCommand(h.snapshot(), payload, { now: clock })); });
  const control = controlByRule(h, 'Show Best in Slot Tasks'); control.checked = !initial;
  const saving = control.emit('change'); await flush();
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').checked, !initial);
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').disabled, true);
  assert.ok(h.find('p', 'Saving…'));
  assert.ok(h.all().some(node => node.className === 'rules-value-source' && node.textContent.startsWith(`Saving…: ${initial ? 'Off' : 'On'}`)));
  assert.equal(h.calls[0].revision, undefined, 'simple toggles choose their revision inside the command queue');
  response.resolve(); await saving;
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').checked, fail ? initial : !initial);
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').disabled, false);
  assert.equal(h.errors.length, fail ? 1 : 0);
});

test('an unconfirmed rule save keeps the pending choice until recovery rather than claiming failure', async () => {
  const h = panelHarness(createRulesPanel); h.panel.open();
  h.route(async () => { throw Object.assign(new Error('Save confirmation needed'), {pendingCommand:true}); });
  const control = controlByRule(h, 'Show Best in Slot Tasks'), initial = control.checked; control.checked = !initial; await control.emit('change');
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').checked, !initial);
  assert.equal(controlByRule(h, 'Show Best in Slot Tasks').disabled, true);
  assert.ok(h.find('p', 'Save not confirmed. Use Retry save to confirm this choice.'));
});
