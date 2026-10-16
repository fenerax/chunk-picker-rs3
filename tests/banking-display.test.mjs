import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBankingComparison, bankingRateText } from '../app/web/banking-display.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';
import { calculatorBankingSettingDefinitions as bankingSettingDefinitions } from '../app/core/gathering-settings.mjs';

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

test('normal comparison shows Drop and Bank with kept resources and round-trip walk', () => {
  const view = renderBankingComparison(el, sample, { resourceLabel: 'logs' }), copy = text(view);
  assert.match(copy, /Drop 25,000 XP\/hour · 800 logs\/hour gathered/);
  assert.match(copy, /Bank 22,000 XP\/hour · 704 logs\/hour kept/);
  assert.match(copy, /Al Kharid bank/); assert.match(copy, /1.6 min round-trip walk/);
  assert.doesNotMatch(copy, /coordinates|tile steps|Capacity|cycle|Running|click delay/);
  assert.equal(nodes(view).some(node => ['input', 'select', 'button'].includes(node.tag)), false);
});

test('Advanced reveals technical banking evidence without changing the normal comparison', () => {
  const copy = text(renderBankingComparison(el, sample, { advanced: true, resourceLabel: 'logs' }));
  assert.match(copy, /Spot coordinates: 3309, 3247/); assert.match(copy, /160 tile steps/);
  assert.match(copy, /Route chunks: 13106, 13105/); assert.match(copy, /Capacity: 147 logs/);
  assert.match(copy, /Storing and banking: 5 seconds/); assert.match(copy, /Running scenario: 24,000 XP\/hour/);
  assert.match(copy, /Tile routes do not measure click delay/);
});

test('unreachable banks and missing coordinates stay explicit with no fabricated zero rate', () => {
  assert.match(text(renderBankingComparison(el, { spots: [{ status: 'unreachable' }] })), /No bank reachable in your chunks/);
  const copy = text(renderBankingComparison(el, { status: 'unknown-location' }));
  assert.match(copy, /Banking time unknown/); assert.doesNotMatch(copy, /0 XP/);
  assert.equal(renderBankingComparison(el, null), null);
  assert.equal(bankingRateText({ xpPerHour: 0, resourcesPerHour: 0 }), '0 XP/hour · 0 resources/hour gathered');
});

function settingsHarness({ canWrite = true, fail = false, skill = 'Mining', advanced = false } = {}) {
  let prefs = {}, dialog = 1; const calls = [], errors = [], changes = [];
  const ctx = { el, canWrite: () => canWrite, preferences: () => prefs, showError: error => errors.push(error),
    dialogGeneration: () => dialog, dialogCurrent: value => value === dialog,
    select: (options, value) => { const control = el('select'); control.options = options; control.value = value; return control; },
    command: async command => { calls.push(command); if (fail) throw Error('Save failed'); prefs = { ...prefs, [command.preferenceId]: command.value }; },
  };
  const view = createBankingSettings(ctx, 'actor1', { inline: true, skill, advanced, onChange: value => changes.push(value) });
  const visible = node => node.hidden ? [] : [node, ...node.children.flatMap(visible)];
  const control = title => visible(view).find(node => node.attributes['aria-label'] === title);
  return { view, control, calls, errors, changes, prefs: () => prefs, stale: () => { dialog++; } };
}

test('viewers receive no banking write controls', () => {
  const h = settingsHarness({ canWrite: false });
  assert.equal(h.view.hidden, true); assert.equal(nodes(h.view).some(node => node.tag === 'select'), false);
});




test('large spot collections keep three comparisons up front and all others inspectable', () => {
  const spots = Array.from({ length: 1000 }, (_, index) => ({ ...sample.spots[0], label: `Spot ${index}` }));
  const view = renderBankingComparison(el, { spots }), more = view.children.find(node => node.className === 'helper-training-banking-more');
  assert.equal(view.children.filter(node => node.className === 'helper-training-banking-spot').length, 3);
  assert.equal(more.children[0].textContent, 'More spots (997)'); assert.equal(more.children.length, 998);
  assert.match(text(more), /Spot 999/); assert.equal(more.open, undefined);
});

test('processing uses plain separate XP, preserves level context and hides source details until Advanced', () => {
  const processing = { mode: 'cook-drop', status: 'bounded', xpPerHour: 20000, resourcesPerHour: 400,
    processingXpPerHour: { Cooking: null }, processingXpBoundsPerHour: { Cooking: { min: 0, max: 30000 } },
    assumptions: ['Unmeasured menus.'], sources: [{ title: 'Cooking', oldid: 37179285, url: 'https://runescape.wiki/w/Cooking?oldid=37179285' }] };
  const data = { ...sample, level: 50, processing };
  const copy = text(renderBankingComparison(el, data));
  assert.match(copy, /at level 50/); assert.match(copy, /Cook and drop 20,000 XP\/hour/);
  assert.match(copy, /0–30,000 Cooking XP\/hour; burn chance unknown/);
  assert.doesNotMatch(copy, /revision|Unmeasured/);
  assert.match(text(renderBankingComparison(el, data, { advanced: true })), /Cooking · revision 37179285/);
  const unknown = text(renderBankingComparison(el, { processing: { mode: 'cook-drop', status: 'unavailable', unavailableReason: 'Confirm a cooker.' } }));
  assert.match(unknown, /Confirm a cooker/); assert.doesNotMatch(unknown, /0 XP/);
});

test('processing controls follow the skill, and detailed burn scenarios require Advanced', async () => {
  const h = settingsHarness({ skill: 'Fishing' }), processing = h.control('Process before dropping');
  assert.equal(processing.options.find(row => row.value === 'fletch-drop').disabled, true);
  assert.equal(h.control('Cooking at the spot'), undefined);
  processing.value = 'cook-drop'; await processing.events.change();
  assert.ok(h.control('Cooking at the spot')); assert.equal(h.control('Cooking success estimate'), undefined);
  const advanced = settingsHarness({ skill: 'Fishing', advanced: true });
  const control = advanced.control('Process before dropping'); control.value = 'cook-drop'; await control.events.change();
  assert.ok(advanced.control('Cooking success estimate'));
  const mode = h.control(bankingSettingDefinitions.find(row => row.id === 'gatheringMode').label); mode.value = 'bank'; await mode.events.change();
  assert.ok(h.control('Use Surge')); assert.ok(h.control('Use unlocked lodestones'));
});
