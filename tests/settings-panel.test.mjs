import { datasetStatusText } from '../app/web/dataset-status.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { originalSettings, settingDefinitions } from '../app/data/settings.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';
import { createMiningSettings } from '../app/web/mining-settings.mjs';
import { createWoodcuttingSettings } from '../app/web/woodcutting-settings.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';
import { artStatusText } from '../app/web/art-status.mjs';

test('Advanced dataset status shows only safe ID, version and health labels', () => {
  assert.equal(datasetStatusText({ id: 'duo-legacy', version: '1.0.0', health: 'healthy', path: 'C:/private/pack' }), 'Game data: duo-legacy · 1.0.0 · healthy');
  assert.equal(datasetStatusText({ id: 'C:/private/pack', version: '../receipt', health: '<bad>' }), 'Game data: unknown · unknown · unknown');
});

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
  let saved = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  let content, opened = 0; const calls = [], errors = [], store = new Map(remembered ? [['picker.settings-section', remembered]] : []);
  const el = (tag, text, className) => new Node(tag, text, className), title = el('h2');
  const ctx = {
    el, memberId: () => 'actor1', state: () => saved, canWrite: () => writable, supportsFeature,
    preferences: (id = 'actor1') => ({ ...originalSettings, advanced: false, ...saved.members.find(owner => owner.id === id).preferences }),
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
  const panel = runInNewContext(`${source}\ncreateSettingsPanel(ctx)`, { ctx, settingDefinitions: [...settingDefinitions, { id: 'futureOption', label: 'Future option', type: 'boolean' }], createDeathSettings, createMiningSettings, createWoodcuttingSettings, createBankingSettings, artStatusText, datasetStatusText,
    localStorage: { getItem: key => { if (storageFails) throw Error('No storage'); return store.get(key); }, setItem: (key, value) => { if (storageFails) throw Error('No storage'); store.set(key, value); } } });
  const walk = node => node ? [node, ...node.children.flatMap(walk)] : [];
  const nodes = () => walk(content);
  const button = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const control = label => nodes().find(node => ['input', 'select'].includes(node.tag) && node.attributes['aria-label'] === label);
  const headings = () => nodes().filter(node => node.tag === 'h3').map(node => node.textContent);
  return { panel, ctx, nodes, button, control, headings, calls, errors, store, title, state: () => saved, content: () => content, opened: () => opened };
}

test('Settings opens one remembered section, labelled for the player, with mobile Back navigation', () => {
  const h = harness({ remembered: 'rolling' }); h.panel.settings();
  assert.equal(h.title.textContent, 'Settings'); assert.equal(h.title.children[0].textContent, 'For Player');
  assert.deepEqual(h.headings(), ['Rolling']); assert.equal(h.content().dataset.mobileView, 'list');
  h.button('Tasks').events.click(); assert.deepEqual(h.headings(), ['Tasks']); assert.equal(h.content().dataset.mobileView, 'detail');
  assert.equal(h.store.get('picker.settings-section'), 'tasks');
  assert.equal(h.nodes().find(node => node.tag === 'h3' && node.textContent === 'Tasks').focused, true);
  h.button('‹ All settings').events.click(); assert.equal(h.content().dataset.mobileView, 'list'); assert.equal(h.button('Tasks').focused, true);
  h.panel.settings(); assert.deepEqual(h.headings(), ['Tasks']);
});

test('unsupported game catalogue settings disappear while ordinary settings remain usable', () => {
  const h = harness({ remembered: 'time', supportsFeature: () => false });
  h.panel.settings();
  assert.deepEqual(h.headings(), ['Map']);
  assert.ok(h.control('Theme')); assert.ok(h.button('Choose chunk'));
  assert.equal(h.button('Time estimates'), undefined);
  h.button('Panels').events.click();
  assert.ok(h.control('Chunk Info panel')); assert.ok(h.control('Recent Chunks and History'));
  for (const label of ['BiS and Activity Info', 'Intermediate skill tasks', 'Required achievements only', 'Open Chunk Info at']) assert.equal(h.control(label), undefined);
  const search = h.control('Find a setting'); search.value = 'pickaxe'; search.events.input();
  assert.deepEqual(h.headings(), []);
});


test('map settings hand off to the existing editors and omit duplicate display preferences', () => {
  const h = harness(); h.panel.settings(); assert.ok(h.control('Theme'));
  for (const id of ['ids', 'highvis', 'unlockedBorderColor', 'defaultStickerColor']) assert.equal(h.nodes().some(node => node.id === `setting-actor1-${id}`), false);
  h.button('Map display…').events.click(); h.button('Choose chunk').events.click();
  assert.deepEqual(h.calls, ['close', 'map-display', 'close', 'starting-flag']);
});



test('unavailable storage and invalid remembered values fall back to Map; viewers cannot open Settings', () => {
  for (const options of [{ storageFails: true }, { remembered: 'nonexistent' }]) { const h = harness(options); h.panel.settings(); assert.deepEqual(h.headings(), ['Map']); h.button('Tasks').events.click(); }
  const h = harness({ writable: false }); h.panel.settings(); assert.equal(h.opened(), 0);
});










test('the Top bar section lists the button switches only when the top bar module is present', async () => {
  const { createTopBarSettings } = await import('../app/web/top-bar-buttons.mjs');
  const without = harness(); without.panel.settings();
  assert.equal(without.button('Top bar'), undefined);
  // Time estimates need the full catalogue harness, so this search leaves them out.
  const h = harness({ remembered: 'topbar', supportsFeature: feature => feature !== 'training' });
  h.ctx.topBar = createTopBarSettings({ ...h.ctx, preferences: id => h.ctx.preferences(id) });
  h.panel.settings();
  assert.deepEqual(h.headings(), ['Top bar']);
  assert.ok(h.control('Show Search')); assert.equal(h.control('Show More').disabled, true);
  h.control('Show Search').checked = false; await h.control('Show Search').events.change();
  assert.deepEqual(h.calls.at(-1), { type: 'set-preference', memberId: 'actor1', preferenceId: 'topBarHidden', value: ['search'] });
  assert.deepEqual(h.state().members[0].preferences.topBarHidden, ['search']);
  const search = h.control('Find a setting'); search.value = 'sync levels'; search.events.input();
  assert.deepEqual(h.headings(), ['Top bar']);
});
