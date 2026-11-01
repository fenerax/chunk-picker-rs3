import { datasetStatusText } from '../app/web/dataset-status.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { originalSettings, settingDefinitions, taskHowPreference } from '../app/data/settings.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';
import { createMiningSettings } from '../app/web/mining-settings.mjs';
import { createWoodcuttingSettings } from '../app/web/woodcutting-settings.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';
import { artStatusText } from '../app/web/art-status.mjs';

const source = (await readFile(new URL('../app/web/settings-panel.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function harness({ writable = true, storageFails = false, remembered = null, failSave = false, supportsFeature } = {}) {
  class Node {
    constructor(tag, text = '', className = '') { this.tag = tag; this.textContent = text ?? ''; this.className = className; this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
    focus() { this.focused = true; }
  }
  let saved = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
  let content, opened = 0; const calls = [], errors = [], store = new Map(remembered ? [['picker.settings-section', remembered]] : []);
  const el = (tag, text, className) => new Node(tag, text, className), title = el('h2');
  const ctx = {
    el, memberId: () => 'player1', state: () => saved, canWrite: () => writable, supportsFeature,
    preferences: (id = 'player1') => ({ ...originalSettings, advanced: false, showTaskHow: true, ...saved.members.find(owner => owner.id === id).preferences }),
    input: (type, value = '') => { const node = el('input'); node.type = type; node.value = String(value); return node; },
    select: (options, value) => { const node = el('select'); node.options = options; node.value = value; return node; },
    button: (text, action, className) => { const node = el('button', text, className); node.events.click = action; return node; },
    field: (text, control) => { const node = el('label', text); node.append(control); return node; },
    details: (text, ...children) => { const node = el('details', text); node.append(...children); return node; },
    $: () => title, openDialog: (text, node) => { title.textContent = text; content = node; opened++; },
    closeDialog: () => calls.push('close'), mapDisplay: () => calls.push('map-display'), startingChunk: () => calls.push('starting-flag'), rulesDialog: () => calls.push('rules'),
    showError: error => errors.push(error),
    command: async command => { command = structuredClone(command); calls.push(command); if (failSave) throw Error('Save failed'); saved = applyCommand(saved, command); },
  };
  const panel = runInNewContext(`${source}\ncreateSettingsPanel(ctx)`, { ctx, taskHowPreference, datasetSettings: [...settingDefinitions, { id: 'futureOption', label: 'Future option', type: 'boolean' }], createDeathSettings, createMiningSettings, createWoodcuttingSettings, createBankingSettings, artStatusText, datasetStatusText,
    localStorage: { getItem: key => { if (storageFails) throw Error('No storage'); return store.get(key); }, setItem: (key, value) => { if (storageFails) throw Error('No storage'); store.set(key, value); } } });
  const walk = node => node ? [node, ...node.children.flatMap(walk)] : [];
  const nodes = () => walk(content);
  const button = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const control = label => nodes().find(node => ['input', 'select'].includes(node.tag) && node.attributes['aria-label'] === label);
  const headings = () => nodes().filter(node => node.tag === 'h3').map(node => node.textContent);
  return { panel, ctx, nodes, button, control, headings, calls, errors, store, title, state: () => saved, content: () => content, opened: () => opened };
}

test('search groups matches across sections and clear or Escape restores the selected section', () => {
  const h = harness(); h.panel.settings(); h.button('Rolling').events.click();
  const search = h.control('Find a setting'); search.value = 'tasks'; search.events.input();
  assert.deepEqual(h.headings(), ['Rolling', 'Tasks', 'Panels']);
  h.button('Clear').events.click(); assert.deepEqual(h.headings(), ['Rolling']); assert.equal(search.focused, true);
  search.value = 'seconds'; search.events.input(); assert.deepEqual(h.headings(), ['Time estimates']); assert.ok(h.control('Default seconds per kill'));
  let prevented = false, stopped = false; search.events.keydown({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(prevented && stopped, true); assert.equal(search.focused, true); assert.equal(search.value, ''); assert.deepEqual(h.headings(), ['Rolling']);
});

test('Advanced uses the personal preference command and reveals retained settings only when enabled', async () => {
  const h = harness(); h.panel.settings(); h.button('Panels').events.click();
  assert.equal(h.control('Future option'), undefined);
  const advanced = h.control('Advanced'); advanced.checked = true; await advanced.events.change();
  assert.deepEqual(h.calls[0], { type: 'set-preference', memberId: 'player1', preferenceId: 'advanced', value: true });
  assert.equal(h.state().members[0].preferences.advanced, true); assert.equal(h.state().members[1].preferences, undefined);
  assert.equal(h.control('Future option').disabled, true);
  assert.ok(h.nodes().some(node => !node.hidden && node.textContent.startsWith('Game data: duo-legacy')));
  advanced.checked = false; await advanced.events.change(); assert.equal(h.control('Future option'), undefined);
});

test('preference controls stay on the right and failed saves restore the current personal value', async () => {
  const h = harness({ failSave: true }); h.panel.settings(); h.button('Rolling').events.click();
  const roll = h.control('Roll 2'), row = h.nodes().find(node => node.children.includes(roll));
  assert.equal(row.children[1], roll); roll.checked = true; await roll.events.change();
  assert.equal(roll.checked, false); assert.equal(roll.disabled, false); assert.equal(h.errors[0].message, 'Save failed');
});

test('Stream-safe is a browser control in Panels and search, independent of player preferences', () => {
  const h = harness(); let disposed = 0;
  h.ctx.streamSafe = { settingsRow() { const row = h.ctx.el('div', undefined, 'settings-option'); row.append(h.ctx.el('strong', 'Stream-safe mode')); row.dispose = () => { disposed++; }; return row; } };
  h.panel.settings(); h.button('Panels').events.click();
  assert.ok(h.nodes().find(node => node.textContent === 'Stream-safe mode'));
  const search = h.control('Find a setting'); search.value = 'stream-safe'; search.events.input();
  assert.deepEqual(h.headings(), ['Panels']); assert.ok(disposed > 0);
  assert.equal(h.calls.some(call => typeof call === 'object'), false);
});

test('search finds saved monster names and visible Map display help and control names', () => {
  const h = harness(); h.state().members[0].preferences = { monsterSecondsPerKill: { 'Goblin (level 2)': 5, Skeleton: 20 } }; h.panel.settings();
  const search = h.control('Find a setting'); search.value = 'goblin'; search.events.input();
  assert.deepEqual(h.headings(), ['Time estimates']); assert.equal(h.control('Goblin (level 2): seconds per kill').value, '5'); assert.equal(h.control('Skeleton: seconds per kill'), undefined);
  for (const query of ['chunk labels', 'default sticker colour', 'roll numbers']) {
    search.value = query; search.events.input(); assert.deepEqual(h.headings(), ['Map']); assert.ok(h.button('Map display\u2026'));
  }
});

test('Settings uses plain labels and human enum choices without changing saved values', () => {
  const h = harness(); h.panel.settings();
  assert.deepEqual(Array.from(h.control('Theme').options, option => option.value), settingDefinitions.find(item => item.id === 'theme').options);
  assert.equal(h.control('Theme').options.find(option => option.value === 'dark').label, 'Dark');
  h.button('Rolling').events.click(); assert.ok(h.control('Roll anywhere on walkable terrain'));
  assert.equal(h.nodes().some(node => node.textContent === 'Reveal your new chunk with an animation.'), true);
  h.button('Tasks').events.click(); assert.ok(h.control('Wide task list'));
  h.button('Panels').events.click(); assert.ok(h.control('Chunk Info panel'));
  const choices = h.control('Open Chunk Info at').options;
  assert.equal(choices.find(option => option.value === 'npcs').label, 'NPCs');
  assert.equal(choices.find(option => option.value === 'spawns').label, 'Item spawns');
  assert.equal(choices.find(option => option.value === 'challenges').label, 'Tasks');
});

test('Time estimates includes personal Mining choices with dynamic F2P assumed tool and saved defaults', async () => {
  const h = harness(); h.state().members[0].runescapeName = 'Account'; h.state().members[0].skillProgress = { Mining: { level: 55, xp: 166636, source: 'runemetrics', runescapeName: 'Account', fetchedAt: '2026-10-12T00:00:00Z' } }; h.panel.settings(); h.button('Time estimates').events.click();
  const pick = h.control('Pickaxe'), attention = h.control('Attention');
  assert.equal(pick.value, 'auto'); assert.equal(attention.value, 'active');
  assert.equal(pick.options[0].label, 'Best for my level (Rune pickaxe +3)');
  assert.equal(pick.options.some(option => /Orikalkum|Dragon/.test(option.label)), false);
  assert.equal(h.nodes().some(node => node.textContent === 'Mining'), true);
  attention.value = 'afk'; await attention.events.change();
  assert.deepEqual(h.calls.at(-1), { type: 'set-preference', memberId: 'player1', preferenceId: 'miningAttention', value: 'afk' });
  assert.equal(h.state().members[0].preferences.miningAttention, 'afk'); assert.equal(h.state().members[1].preferences, undefined);
});

test('Time estimates saves the personal Woodcutting hatchet and uses only current-account observed levels', async () => {
  const h = harness(); h.state().members[0].runescapeName = 'Account';
  h.state().members[0].skillProgress = { Woodcutting: { level: 75, xp: 1210421, source: 'runemetrics', runescapeName: 'Account', fetchedAt: '2026-10-12T00:00:00Z' } };
  h.panel.settings(); h.button('Time estimates').events.click();
  const hatchet = h.control('Hatchet'); assert.equal(hatchet.value, 'auto');
  assert.equal(hatchet.options[0].label, 'Best for my level (Rune hatchet)');
  assert.equal(hatchet.options.some(option => /Dragon|Crystal/.test(option.label)), false);
  assert.equal(h.nodes().filter(node => node.attributes['aria-label'] === 'Attention').length, 1);
  hatchet.value = 'steel'; await hatchet.events.change();
  assert.deepEqual(h.calls.at(-1), { type: 'set-preference', memberId: 'player1', preferenceId: 'woodcuttingHatchet', value: 'steel' });
  assert.equal(h.state().members[0].preferences.woodcuttingHatchet, 'steel'); assert.equal(h.state().members[1].preferences, undefined);
  h.state().members[0].runescapeName = 'New account'; h.button('Time estimates').events.click();
  assert.equal(h.control('Hatchet').options[0].label, 'Best for my level');
});

test('Woodcutting search isolates the hatchet choice and failed saves restore it', async () => {
  const h = harness({ failSave: true }); h.panel.settings(); const search = h.control('Find a setting');
  search.value = 'woodcutting'; search.events.input();
  assert.deepEqual(h.headings(), ['Time estimates']); assert.ok(h.control('Hatchet')); assert.equal(h.control('Pickaxe'), undefined);
  const hatchet = h.control('Hatchet'); hatchet.value = 'rune'; await hatchet.events.change();
  assert.equal(hatchet.value, 'auto'); assert.equal(hatchet.disabled, false); assert.equal(h.errors.at(-1).message, 'Save failed');
});

test('Mining search finds tool and attention settings and failed writes restore the saved choice', async () => {
  const h = harness({ failSave: true }); h.panel.settings();
  const search = h.control('Find a setting'); search.value = 'mining'; search.events.input();
  assert.deepEqual(h.headings(), ['Time estimates']); assert.ok(h.control('Pickaxe')); assert.ok(h.control('Attention')); assert.equal(h.control('Default seconds per kill'), undefined);
  const pick = h.control('Pickaxe'); pick.value = 'rune+3'; await pick.events.change();
  assert.equal(pick.value, 'auto'); assert.equal(pick.disabled, false); assert.equal(h.errors.at(-1).message, 'Save failed');
  search.value = 'afk'; search.events.input(); assert.ok(h.control('Attention'));
});

test('assumed Mining pickaxe ignores missing, invalid and renamed-account observations', () => {
  const observation = { level: 55, xp: 166636, source: 'runemetrics', runescapeName: 'Old account', fetchedAt: '2026-10-12T00:00:00Z' };
  for (const value of [undefined, observation, { ...observation, source: 'manual' }, { ...observation, xp: NaN }]) {
    const h = harness(); h.state().members[0].runescapeName = 'New account'; h.state().members[0].skillProgress = { Mining: value }; h.panel.settings(); h.button('Time estimates').events.click();
    assert.equal(h.control('Pickaxe').options[0].label, 'Best for my level');
    assert.equal(h.nodes().some(node => /Assumed: Rune/.test(node.textContent)), false);
  }
  const h = harness(); h.state().members[0].runescapeName = 'OLD_ACCOUNT'; h.state().members[0].skillProgress = { Mining: observation }; h.panel.settings(); h.button('Time estimates').events.click();
  assert.equal(h.control('Pickaxe').options[0].label, 'Best for my level (Rune pickaxe +3)');
});
