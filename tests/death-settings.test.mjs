import test from 'node:test';
import assert from 'node:assert/strict';
import { deathSettingDefinitions, resolveDeathSettings, validateDeathSetting } from '../app/core/death-settings.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';

const clock = () => '2026-10-07T12:00:00.000Z';
const state = () => createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);





test('invalid death preferences reject commands and restores before changing history', () => {
  const original = state();
  for (const [preferenceId, value] of [['deathThresholdHours', 0], ['defaultSecondsPerKill', '60'], ['monsterSecondsPerKill', { Goblin: -1 }], ['showDeathChunks', 1]]) {
    assert.throws(() => applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId, value }, { now: () => { throw Error('Clock must not run'); } }), TypeError);
    const invalid = structuredClone(original); invalid.members[0].preferences = { [preferenceId]: value };
    assert.throws(() => validateState(invalid), TypeError);
  }
  assert.deepEqual(original, state());
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
  }, 'actor1');
  const walk = node => [node, ...node.children.flatMap(walk)];
  const input = label => walk(node).find(node => node.tag === 'input' && node.attributes['aria-label'] === label);
  const button = label => walk(node).find(node => node.tag === 'button' && node.textContent === label);
  return { node, input, button, commands, errors, saved };
}


