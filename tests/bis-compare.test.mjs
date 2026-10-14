import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBiSComparison, renderBiSComparison } from '../app/web/bis-compare.mjs';

const rec = (name, score, style = 'Melee', slot = 'head', alternatives = []) => ({ style, slot, equipment: { name, slot }, score, alternatives });
const plan = (recommendations = [], loadouts = []) => ({ recommendations, loadouts });
const pair = (id, recorded, obtainable = plan()) => ({ member: { id, name: id }, result: { currentBiS: { owned: { recordedBest: recorded }, obtainable } } });
const rowOf = (model, style = 'Melee', slot = 'head') => model.styles.find(group => group.style === style).rows.find(row => row.slot === slot);
const weapon = (score, mainHand, offHand = null, ammunition = null, options = {}) => ({ style: 'Ranged', best: {
  mode: offHand ? 'dual-wield' : 'two-handed', score, mainHand, offHand, ammunition,
  items: [mainHand, offHand, ammunition].filter(Boolean), defence: { armour: 0, lifePoints: 0 }, ...options,
} });

test('ordinary comparisons retain ties and use the engine vector without a sum', () => {
  const pairs = [pair('Player', plan([rec('Hat A', [4, 1, 0], 'Melee', 'head', ['Hat B'])])), pair('Reed', plan([rec('Hat C', [4, 1, 0])]))];
  const before = JSON.stringify(pairs);
  const row = rowOf(buildBiSComparison(pairs));
  assert.equal(row.comparison.status, 'tie');
  assert.deepEqual(row.cells[0].recorded.items, ['Hat A', 'Hat B']);
  assert.equal(JSON.stringify(pairs), before);
  pairs[1].result.currentBiS.owned.recordedBest.recommendations[0].score = [3, 1000, 1000];
  assert.equal(rowOf(buildBiSComparison(pairs)).comparison.winner, 0);
});

test('missing personal records stay unknown despite obtainable gear', () => {
  const row = rowOf(buildBiSComparison([pair('A', plan([rec('Hat', [2, 0, 0])])), pair('B', plan(), plan([rec('Better hat', [9, 0, 0])]))]));
  assert.equal(row.comparison.status, 'unknown');
  assert.equal(row.comparison.winner, null);
  assert.equal(row.cells[1].recorded, null);
  assert.deepEqual(row.cells[1].obtainable.items, ['Better hat']);
});

test('weapon rows share one coupled ranking and preserve compatible ammo', () => {
  const pairs = [pair('A', plan([], [weapon(50, 'Bow', null, 'Arrow')])), pair('B', plan([], [weapon(45, 'Crossbow', 'Off-hand crossbow', 'Bolt')]))];
  const rows = buildBiSComparison(pairs).styles[0].rows;
  assert.deepEqual(rows.map(row => row.label), ['Main hand', 'Off-hand', 'Ammunition']);
  for (const row of rows) {
    assert.equal(row.comparison.winner, 0);
    assert.match(row.comparison.label, /loadout/);
    assert.match(row.explanation, /both hands and ammunition/);
  }
  assert.equal(rows[1].cells[0].recorded.unused, true);
  assert.deepEqual(rows[2].cells[0].recorded.items, ['Arrow']);
});

test('weapon score ties compare declared defensive vectors, not item or mode', () => {
  const a = pair('A', plan([], [weapon(50, 'Bow')]));
  const b = pair('B', plan([], [weapon(50 + 1e-10, 'Main', 'Off')]));
  assert.equal(rowOf(buildBiSComparison([a, b]), 'Ranged', 'main hand').comparison.status, 'tie');
  b.result.currentBiS.owned.recordedBest.loadouts[0].best.defence.armour = 2;
  assert.equal(rowOf(buildBiSComparison([a, b]), 'Ranged', 'main hand').comparison.winner, 1);
});

test('tank and prayer comparisons stay distinct and tank life points break armour ties', () => {
  const a = plan([rec('Prayer hat', [2], 'Prayer')]);
  a.specialist = { tank: { recommendations: [rec('Tank hat', [5, 100], 'Melee Tank')] } };
  const b = plan([rec('Prayer hat B', [3], 'Prayer')]);
  b.specialist = { tank: { recommendations: [rec('Tank hat B', [5, 99], 'Melee Tank')] } };
  const model = buildBiSComparison([pair('A', a), pair('B', b)]);
  assert.equal(rowOf(model, 'Prayer').comparison.winner, 1);
  assert.equal(rowOf(model, 'Melee Tank').comparison.winner, 0);
});

test('tied weapon alternatives retain complete loadouts and known component slots', () => {
  const loadout = weapon(50, 'Bow', null, 'Arrow', { alternatives: [{ score: 50, items: ['Other bow', 'Other arrow'] }] });
  const recorded = plan([rec('Other bow', [50], 'Ranged', '2h weapon'), rec('Other arrow', [50], 'Ranged', 'ammo')].map(row => ({ ...row, loadoutMode: 'two-handed' })), [loadout]);
  const row = rowOf(buildBiSComparison([pair('A', recorded)]), 'Ranged', 'ammo');
  assert.deepEqual(row.cells[0].recorded.items, ['Arrow', 'Other arrow']);
  assert.deepEqual(row.cells[0].recorded.tiedLoadouts, [['Other bow', 'Other arrow']]);
  const withoutPeerRecommendations = rowOf(buildBiSComparison([pair('A', plan([], [loadout]))]), 'Ranged', 'ammo');
  assert.deepEqual(withoutPeerRecommendations.cells[0].recorded.items, ['Arrow', 'Other arrow']);
});

test('rendered comparison labels the winner and unknown gear with no write controls', () => {
  const el = (tag, text, className) => ({ tag, text, className, children: [], append(...children) { this.children.push(...children); } });
  const rendered = renderBiSComparison({ el, itemIcon: () => null }, [pair('A', plan([rec('Hat', [2, 0, 0])])), pair('B', plan([rec('Cap', [1, 0, 0])]))]);
  const nodes = [];
  const walk = node => { nodes.push(node); node.children.forEach(walk); };
  walk(rendered);
  assert.ok(nodes.some(node => node.text === 'A has better recorded gear.'));
  assert.ok(nodes.some(node => node.text === 'No obtainable gear known.'));
  assert.ok(nodes.every(node => !['button', 'input', 'select'].includes(node.tag)));
  assert.equal(buildBiSComparison([{ member: { id: 'A' }, result: null }]).players[0].available, false);
});

test('comparison accepts the shared advanced callback and keeps technical ranking copy hidden by default', () => {
  const el = (tag, text) => ({ tag, text, children: [], append(...nodes) { this.children.push(...nodes); } });
  const pairA = pair('A', plan([], [weapon(50, 'Bow', null, 'Arrow')]));
  const text = node => [node.text, ...node.children.flatMap(text)].filter(Boolean);
  assert.ok(text(renderBiSComparison({ el, advanced: () => false }, [pairA])).some(value => value.startsWith('Compared together:')));
  assert.equal(text(renderBiSComparison({ el, advanced: () => false }, [pairA])).some(value => value.includes('picker score')), false);
  assert.ok(text(renderBiSComparison({ el, advanced: () => true }, [pairA])).some(value => value.includes('picker score')));
});
