import test from 'node:test';
import assert from 'node:assert/strict';
import { deathSettingDefinitions, resolveDeathSettings, validateDeathSetting } from '../app/core/death-settings.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';

const clock = () => '2026-10-07T12:00:00.000Z';
const state = () => createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);

test('death settings have explicit personal defaults without writing saved values', () => {
  const member = state().members[0], before = structuredClone(member);
  assert.deepEqual(resolveDeathSettings(member), { deathThresholdHours: 1000, defaultSecondsPerKill: 60, monsterSecondsPerKill: {}, showDeathChunks: true });
  assert.deepEqual(member, before);
  const definition = deathSettingDefinitions.find(row => row.id === 'defaultSecondsPerKill');
  assert.match(definition.label, /placeholder/); assert.match(definition.description, /starting guess until you time yourself/);
  assert.match(deathSettingDefinitions[0].description, /longer than this/);
});

test('death settings reject coercion, nonfinite or nonpositive inputs and preserve fractional values', () => {
  for (const id of ['deathThresholdHours', 'defaultSecondsPerKill']) {
    for (const value of ['60', '', null, true, 0, -1, NaN, Infinity, -Infinity]) assert.throws(() => validateDeathSetting(id, value), /finite number/);
    assert.equal(validateDeathSetting(id, 0.125), 0.125);
  }
  assert.throws(() => validateDeathSetting('defaultSecondsPerKill', 86401));
  assert.throws(() => validateDeathSetting('deathThresholdHours', 1e9 + 1));
  for (const value of [0, 1, 'true', null]) assert.throws(() => validateDeathSetting('showDeathChunks', value), /boolean/);
  assert.throws(() => validateDeathSetting('unknown', 1), /Unknown/);
});

test('kill-time overrides retain exact variant identity and reject unsafe dictionaries', () => {
  const overrides = { 'Goblin (level 2)': 5, 'Goblin (level 5)': 12.5 };
  assert.equal(validateDeathSetting('monsterSecondsPerKill', overrides), overrides);
  const resolved = resolveDeathSettings({ preferences: { monsterSecondsPerKill: overrides } });
  assert.deepEqual(resolved.monsterSecondsPerKill, overrides);
  resolved.monsterSecondsPerKill['Goblin (level 2)'] = 20;
  assert.equal(overrides['Goblin (level 2)'], 5);
  for (const value of [null, [], new Date(), Object.create({ Goblin: 5 }), { Goblin: 0 }, { Goblin: '5' }, { '': 5 }, { ' Goblin': 5 }, { 'Goblin ': 5 }, { ['x'.repeat(201)]: 5 }, JSON.parse('{"__proto__":5}'), { constructor: 5 }, { prototype: 5 }, { [Symbol('Goblin')]: 5 }]) {
    assert.throws(() => validateDeathSetting('monsterSecondsPerKill', value), TypeError);
  }
  const accessor = Object.defineProperty({}, 'Goblin', { enumerable: true, get() { throw Error('Getter must not execute'); } });
  assert.throws(() => validateDeathSetting('monsterSecondsPerKill', accessor), /safe monster names/);
});

test('death preferences persist for one member through validation, backups and undo', () => {
  const original = state(); original.legacy = { maps: { qxa: { settings: { ids: false, custom: 'kept' } } } };
  let saved = original;
  for (const [preferenceId, value] of Object.entries({ deathThresholdHours: 200.5, defaultSecondsPerKill: 7.25, monsterSecondsPerKill: { Goblin: 2.5 }, showDeathChunks: false })) {
    saved = applyCommand(saved, { type: 'set-preference', memberId: 'player1', preferenceId, value }, { now: clock });
  }
  const restored = importBackup(exportBackup(saved));
  assert.deepEqual(resolveDeathSettings(restored.members[0]), { deathThresholdHours: 200.5, defaultSecondsPerKill: 7.25, monsterSecondsPerKill: { Goblin: 2.5 }, showDeathChunks: false });
  assert.equal(restored.members[1].preferences, undefined); assert.deepEqual(restored.legacy, original.legacy);
  let undone = restored;
  for (let i = 0; i < 4; i++) undone = applyCommand(undone, { type: 'undo' }, { now: clock });
  assert.deepEqual(undone.members, original.members);
});

function harness() {
  class Node {
    constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.value = ''; this.children = []; this.events = {}; this.attributes = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, callback) { this.events[key] = callback; }
  }
  const saved = state(), commands = [], errors = [];
  const el = (tag, text) => new Node(tag, text);
  const node = createDeathSettings({
    el, state: () => saved, showError: error => errors.push(error),
    input: (type, value = '') => { const node = el('input'); node.type = type; node.value = String(value); return node; },
    button: (text, action) => { const node = el('button', text); node.events.click = action; return node; },
    field: (text, input) => { const node = el('label'); node.append(el('span', text), input); return node; },
    details: (title, ...children) => { const node = el('details'); node.append(el('summary', title), ...children); return node; },
    command: async command => { commands.push(command); saved.members[0].preferences = { ...saved.members[0].preferences, [command.preferenceId]: command.value }; },
  }, 'player1');
  const walk = node => [node, ...node.children.flatMap(walk)];
  const input = label => walk(node).find(node => node.tag === 'input' && node.attributes['aria-label'] === label);
  const button = label => walk(node).find(node => node.tag === 'button' && node.textContent === label);
  return { node, input, button, commands, errors, saved };
}

test('time estimate controls save typed personal values with plain labels', async () => {
  const h = harness(), threshold = h.input('Warning threshold (hours)'), killTime = h.input('Default seconds per kill');
  assert.equal(threshold.value, '1000'); assert.equal(killTime.value, '60');
  threshold.value = '500.25'; await threshold.events.change();
  assert.deepEqual(h.commands[0], { type: 'set-preference', memberId: 'player1', preferenceId: 'deathThresholdHours', value: 500.25 });
  const toggle = h.input('Show time warnings'); toggle.checked = false; await toggle.events.change();
  assert.equal(h.commands[1].value, false);
  h.input('Exact monster name or variant').value = 'Goblin (level 2)'; h.input('Monster seconds per kill').value = '4.5';
  await h.button('Save kill time').events.click();
  assert.deepEqual(h.commands[2].value, { 'Goblin (level 2)': 4.5 });
  await h.button('Remove').events.click(); assert.deepEqual(h.commands[3].value, {});
});

test('invalid death settings UI inputs are explained without issuing commands', async () => {
  const h = harness(), threshold = h.input('Warning threshold (hours)');
  threshold.value = ''; await threshold.events.change();
  assert.equal(h.commands.length, 0); assert.equal(threshold.value, '1000'); assert.match(h.errors[0].message, /finite number/);
  await h.button('Save kill time').events.click();
  assert.equal(h.commands.length, 0); assert.match(h.errors[1].message, /safe monster names/);
});
