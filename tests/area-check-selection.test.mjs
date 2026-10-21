import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_CHECK_CAP, rectangleChunks, createAreaSelection } from '../app/web/area-check-selection.mjs';
import { areaDiscordMessages, areaRangeText, areaGapText } from '../app/web/area-check.mjs';

const cells = new Map([['10', { x: 0, y: 0 }], ['20', { x: 1, y: 0 }], ['30', { x: 2, y: 0 }], ['40', { x: 0, y: 1 }]]);
function harness() {
  const selected = [], hints = []; let cancels = 0;
  const captured = new Set();
  const map = { cells, zoom: 1, offset: { x: 0, y: 0 }, endDrag() {}, setHover() {}, invalidate() {},
    localPoint: event => ({ x: event.clientX, y: event.clientY }), hoverCanvas: { focus() {},
      setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) } };
  const tool = createAreaSelection(map, { onSelect: ids => selected.push(ids), onHint: text => hints.push(text), onCancel: () => cancels++ });
  const event = (x, y, pointerType = 'mouse', button = 0, pointerId = 1) => ({ clientX: x, clientY: y, pointerType, button, pointerId, preventDefault() {} });
  return { tool, map, selected, hints, captured, event, cancels: () => cancels };
}
test('rectangle includes mapped chunks in either direction and fails closed at the cap', () => {
  assert.deepEqual(rectangleChunks(cells, { x: 1, y: 1 }, { x: 0, y: 0 }).chunkIds, ['10', '20', '40']);
  assert.equal(rectangleChunks(cells, { x: 0, y: 0 }, { x: 1, y: 1 }, 2).overCap, true);
  const large = new Map(Array.from({ length: AREA_CHECK_CAP + 1 }, (_, x) => [String(x + 1), { x, y: 0 }]));
  assert.deepEqual(rectangleChunks(large, { x: 0, y: 0 }, { x: AREA_CHECK_CAP, y: 0 }).chunkIds, []);
  assert.deepEqual(rectangleChunks(cells, { x: 9, y: 9 }, { x: 10, y: 10 }).chunkIds, []);
});
test('mouse drag intercepts navigation, handles reverse selection and preserves the map offset', () => {
  const h = harness(); assert.equal(h.tool.down(h.event(140, 140)), false); h.tool.start();
  assert.equal(h.tool.down(h.event(140, 140)), true); assert.equal(h.tool.move(h.event(10, 10)), true);
  assert.equal(h.tool.up(h.event(10, 10)), true);
  assert.deepEqual(h.selected, [['10', '20', '40']]); assert.deepEqual(h.map.offset, { x: 0, y: 0 });
  assert.equal(h.tool.active, false); assert.equal(h.captured.size, 0);
});
test('touch taps choose corners, touch drags pan and middle drag remains available', () => {
  const h = harness(); h.tool.start();
  assert.equal(h.tool.down(h.event(10, 10, 'mouse', 1)), false);
  h.tool.down(h.event(10, 10, 'touch')); h.tool.up(h.event(10, 10, 'touch'));
  assert.equal(h.selected.length, 0);
  h.tool.down(h.event(10, 10, 'touch')); h.tool.move(h.event(20, 20, 'touch')); h.tool.up(h.event(20, 20, 'touch'));
  assert.deepEqual(h.map.offset, { x: 10, y: 10 }); assert.equal(h.selected.length, 0);
  h.tool.down(h.event(150, 150, 'touch')); h.tool.up(h.event(150, 150, 'touch'));
  assert.deepEqual(h.selected, [['10', '20', '40']]);
});
test('cancel releases capture and cannot complete an old selection; empty selection can retry', () => {
  const h = harness(); h.tool.start(); h.tool.down(h.event(10, 10)); h.tool.cancel();
  assert.equal(h.tool.up(h.event(140, 140)), false); assert.equal(h.selected.length, 0);
  assert.equal(h.captured.size, 0); assert.equal(h.cancels(), 1);
  h.tool.start(); h.tool.down(h.event(999, 999)); h.tool.up(h.event(999, 999));
  assert.equal(h.tool.active, true); assert.match(h.hints.at(-1), /No mapped chunks/);
  h.tool.corner({ x: 10, y: 10 }); h.tool.corner({ x: 140, y: 10 }); assert.deepEqual(h.selected, [['10', '20']]);
});
test('Discord output labels assumptions, preserves all skills and splits at message limits', () => {
  const range = { lowest: { level: 5 }, highest: { level: 77 }, bootstrapGap: { fromLevel: 1, toLevel: 5, source: 'personal' },
    largestGap: { fromLevel: 5, toLevel: 77, methods: [{ id: 'tanning', label: 'Cowhide tanning', level: 5 }], kind: 'requirement',
      evidence: [{ label: 'Local quest', level: 77 }] } };
  const result = { members: true, chunkIds: ['10', '20'], rows: Array.from({ length: 29 }, (_, index) => ({ skill: `Skill ${index}`, alone: range, combined: range })) };
  const messages = areaDiscordMessages(result, 'Player', 500);
  assert.ok(messages.length > 1); assert.ok(messages.every(message => message.length <= 500));
  assert.match(messages.join('\n'), /ASSUMES MEMBERS/); assert.match(messages.join('\n'), /Skill 28:/);
  assert.match(messages[0], /Gaps of 15\+ levels mean continuing with an old method/);
  assert.match(messages.join('\n'), /5 → 77 on Cowhide tanning \(Area requirement · Local quest\)/);
  assert.doesNotMatch(messages.join('\n'), /skill cap|Members cap|F2P cap/);
  assert.match(messages.join('\n'), /Can't start: 1 → 5 \(recorded level\)/);
  assert.equal(areaRangeText({ lowest: null }), 'No method recorded');
});

test('rows and Discord plainly explain absent and already covered requirements', () => {
  const method = { level: 40, status: 'available', blockers: [] };
  const noRequirement = { methods: [method], availableCount: 1, gapTarget: null };
  const covered = { ...noRequirement, gapTarget: { level: 40, kind: 'requirement' } };
  assert.equal(areaGapText(noRequirement), 'No task here needs this skill');
  assert.equal(areaGapText(covered), 'No task here needs more than level 40');
  const result = { members: false, chunkIds: ['10'], rows: [{ skill: 'Crafting', alone: noRequirement, combined: covered }] };
  const text = areaDiscordMessages(result, 'Player').join('\n');
  assert.match(text, /No task here needs this skill/);
  assert.match(text, /No task here needs more than level 40/);
  assert.doesNotMatch(text, /skill cap|F2P cap/);
});
