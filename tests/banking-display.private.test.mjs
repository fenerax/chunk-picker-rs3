import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBankingComparison, bankingRateText } from '../app/web/banking-display.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';

class Node {
  constructor(tag, text = '', className = '') { this.tag = tag; this.textContent = text ?? ''; this.className = className; this.children = []; this.attributes = {}; this.events = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, action) { this.events[key] = action; }
  removeEventListener(key) { delete this.events[key]; }
}
const el = (tag, text, className) => new Node(tag, text, className);
const nodes = node => [node, ...node.children.flatMap(nodes)];
const text = node => nodes(node).map(item => item.textContent).join(' ');
const sample = { limitations: ['Tile routes do not measure click delay.'], spots: [{
  id: 'acadia', label: 'Acadia trees', x: 3309, y: 3247, status: 'available', tileSteps: 160, walkingSeconds: 96,
  destination: { name: 'Al Kharid bank', kind: 'bank' }, chunkIds: ['13106', '13105'],
  drop: { xpPerHour: 25000, resourcesPerHour: 800 },
  rates: { walking: { xpPerHour: 22000, resourcesPerHour: 704, capacity: 147, gatheringSeconds: 650, cycleSeconds: 751, handlingSeconds: 5 },
    running: { xpPerHour: 24000, resourcesPerHour: 768 } },
}] };

function settingsHarness({ canWrite = true, fail = false, skill = 'Mining', advanced = false } = {}) {
  let prefs = {}, dialog = 1; const calls = [], errors = [], changes = [];
  const ctx = { el, canWrite: () => canWrite, preferences: () => prefs, showError: error => errors.push(error),
    dialogGeneration: () => dialog, dialogCurrent: value => value === dialog,
    select: (options, value) => { const control = el('select'); control.options = options; control.value = value; return control; },
    command: async command => { calls.push(command); if (fail) throw Error('Save failed'); prefs = { ...prefs, [command.preferenceId]: command.value }; },
  };
  const view = createBankingSettings(ctx, 'player1', { inline: true, skill, advanced, onChange: value => changes.push(value) });
  const visible = node => node.hidden ? [] : [node, ...node.children.flatMap(visible)];
  const control = title => visible(view).find(node => node.attributes['aria-label'] === title);
  return { view, control, calls, errors, changes, prefs: () => prefs, stale: () => { dialog++; } };
}

test('inline choices save personal mode and owned box, default to none, and refresh', async () => {
  const h = settingsHarness(), mode = h.control('Finish each backpack'), ore = h.control('Ore box owned');
  assert.equal(mode.value, 'drop'); assert.equal(ore.value, 'none'); assert.equal(h.control('Wood box owned'), undefined);
  mode.value = 'bank'; await mode.events.change();
  assert.deepEqual(h.calls[0], { type: 'set-preference', memberId: 'player1', preferenceId: 'gatheringMode', value: 'bank' });
  assert.deepEqual(h.changes, ['saving', 'saved']); assert.equal(mode.disabled, false);
  ore.value = 'rune'; await ore.events.change(); assert.equal(h.prefs().gatheringOreBox, 'rune');
  ore.value = 'bronze'; h.view.refresh(); assert.equal(ore.value, 'rune');
  h.view.dispose(); assert.equal(ore.events.change, undefined);
  const wood = settingsHarness({ skill: 'Woodcutting' }); assert.ok(wood.control('Wood box owned')); assert.equal(wood.control('Ore box owned'), undefined);
  const fish = settingsHarness({ skill: 'Fishing' }); assert.ok(fish.control('Finish each backpack')); assert.equal(fish.control('Ore box owned'), undefined); assert.equal(fish.control('Wood box owned'), undefined);
});

test('failed saves restore preferences and leave controls usable', async () => {
  const h = settingsHarness({ fail: true }), ore = h.control('Ore box owned');
  ore.value = 'rune'; await ore.events.change();
  assert.equal(ore.value, 'none'); assert.equal(ore.disabled, false); assert.equal(h.errors[0].message, 'Save failed');
  assert.deepEqual(h.changes, ['saving', 'error']);
});

test('inline box fields follow skill changes after initial catalogue loading', () => {
  let skill = ''; const h = settingsHarness({ skill: () => skill });
  skill = 'Mining'; h.view.refresh(); assert.ok(h.control('Ore box owned')); assert.equal(h.control('Wood box owned'), undefined);
  skill = 'Woodcutting'; h.view.refresh(); assert.ok(h.control('Wood box owned')); assert.equal(h.control('Ore box owned'), undefined);
  skill = 'Fishing'; h.view.refresh(); assert.ok(h.control('Finish each backpack')); assert.equal(h.control('Wood box owned'), undefined);
});

