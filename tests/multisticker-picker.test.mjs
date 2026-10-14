import test from 'node:test';
import assert from 'node:assert/strict';
import { createStickerPicker } from '../app/web/sticker-picker.mjs';
import { MAX_STICKERS_PER_CHUNK } from '../app/core/map-markers.mjs';

class Element {
  constructor(tag, text, className) { this.tag = tag; this.textContent = text; this.className = className; this.children = []; this.events = {}; this.style = {}; this.attributes = {}; this.value = ''; this.disabled = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, callback) { this.events[type] = callback; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  get lastChild() { return this.children.at(-1); }
  focus() { this.focused = true; }
  setSelectionRange() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  querySelector(selector) { return find(node => selector === 'input[type=search]' && node.tag === 'input' && node.type === 'search', this); }
  querySelectorAll() { return this.children.flatMap(node => [node, ...node.querySelectorAll()]); }
}
function find(predicate, node) { return predicate(node) ? node : node.children.map(child => find(predicate, child)).find(Boolean); }
function fixture(stickers = []) {
  let owner = 'actor1';
  const state = { revision: 9, members: [{ id: 'actor1', name: 'Player', stickers: { 101: stickers }, preferences: {} }, { id: 'reed', name: 'Reed', stickers: {}, preferences: {} }] };
  const host = new Element('div'), writes = [], errors = [], full = [];
  const el = (...args) => new Element(...args);
  const picker = createStickerPicker({
    el, host, state: () => state, memberId: () => owner, member: () => state.members.find(member => member.id === owner),
    world: () => ({ chunks: new Map([['101', { name: 'Wendlewick' }], ['102', { name: 'Test shore' }]]) }),
    button: (text, action, className) => { const node = el('button', text, className); node.click = action; return node; },
    command: (command, revision) => {
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const success = () => {
        const member = state.members.find(value => value.id === command.memberId), list = member?.stickers[command.chunkId] ?? [];
        if (command.type === 'add-sticker') member.stickers[command.chunkId] = [...list, { id: `sticker-${state.revision + 1}`, ...command.sticker }];
        else if (command.type === 'update-sticker') member.stickers[command.chunkId] = list.map(value => value.id === command.stickerId ? { id: value.id, ...command.sticker } : value);
        else if (command.type === 'remove-sticker') member.stickers[command.chunkId] = list.filter(value => value.id !== command.stickerId);
        state.revision++; resolve({ state });
      };
      writes.push({ command, revision, success, reject }); return promise;
    },
    showError: error => errors.push(error), openFullDialog: id => full.push(id),
  });
  picker.open('101', { x: 20, y: 20 });
  const labelled = label => find(node => node.attributes['aria-label'] === label, picker.element);
  const text = value => find(node => node.textContent === value, picker.element);
  return { picker, host, writes, errors, full, state, labelled, text, switchOwner: value => { owner = value; } };
}
const star = { id: 'star-one', type: 'star', color: '#ffffff', text: 'Mine here' };

test('closing a panel sticker picker returns focus to its visible trigger', () => {
  const ui = fixture(), trigger = new Element('button'); trigger.isConnected = true;
  ui.host.ownerDocument = { activeElement: trigger };
  ui.picker.open('101', { x: 20, y: 20 });
  ui.labelled('Close sticker picker').click();
  assert.equal(ui.picker.isOpen(), false); assert.equal(trigger.focused, true);
  trigger.focused = false; trigger.isConnected = false;
  ui.picker.open('101', { x: 20, y: 20 }); ui.picker.close({ restoreFocus: true });
  assert.equal(trigger.focused, false);
});

test('catalogue adds consecutively without replacing labels, advances reviewed revision and pins the owner', async () => {
  const ui = fixture([star]); ui.switchOwner('reed');
  let pending = ui.labelled('Add heart').click();
  assert.equal(ui.picker.isOpen(), true);
  assert.equal(ui.labelled('Add heart').disabled, true);
  assert.deepEqual(ui.writes[0].command, { type: 'add-sticker', memberId: 'actor1', chunkId: '101', sticker: { type: 'heart', color: '#f5c451', text: '' } });
  assert.equal(ui.writes[0].revision, 9);
  await ui.labelled('Add heart').click(); assert.equal(ui.writes.length, 1, 'busy handlers cannot enqueue duplicates');
  ui.writes[0].success(); await pending;
  assert.deepEqual(ui.state.members[0].stickers[101][0], star);
  assert.ok(find(node => node.textContent === 'Heart added to Wendlewick', ui.host));
  pending = ui.labelled('Add skull').click(); assert.equal(ui.writes[1].revision, 10); ui.writes[1].success(); await pending;
  assert.equal(ui.state.members[0].stickers[101].length, 3);
});

test('default colours prepare additions; selecting a sticker recolours only its id and preserves text', async () => {
  const ui = fixture([star, { id: 'heart-two', type: 'heart', color: '#ffffff', text: 'Second' }]);
  await ui.labelled('Colour #6fa8ff').click(); assert.equal(ui.writes.length, 0);
  ui.labelled('Select star: Mine here').click();
  const pending = ui.labelled('Colour #e5484d').click();
  assert.deepEqual(ui.writes[0].command, { type: 'update-sticker', memberId: 'actor1', chunkId: '101', stickerId: star.id, sticker: { type: 'star', color: '#e5484d', text: 'Mine here' } });
  ui.writes[0].success(); await pending;
  assert.equal(ui.state.members[0].stickers[101][1].color, '#ffffff');
  assert.equal(ui.labelled('Select star: Mine here').attributes['aria-pressed'], 'true');
});

test('remove targets one id and six stickers block catalogue additions until space is freed', async () => {
  const ui = fixture(Array.from({ length: MAX_STICKERS_PER_CHUNK }, (_, index) => ({ ...star, id: `star-${index}` })));
  assert.equal(ui.labelled('Add heart').disabled, true);
  await ui.labelled('Add heart').click(); assert.equal(ui.writes.length, 0);
  const pending = ui.labelled('Remove star').click(); assert.equal(ui.writes[0].command.stickerId, 'star-0');
  ui.writes[0].success(); await pending;
  assert.equal(ui.state.members[0].stickers[101].length, MAX_STICKERS_PER_CHUNK - 1);
  assert.equal(ui.labelled('Add heart').disabled, false);
});

test('failed additions keep picker and search retryable without reporting success', async () => {
  const ui = fixture(); let search = ui.labelled('Search stickers'); search.value = 'heart'; search.events.input();
  const pending = ui.labelled('Add heart').click(), error = new Error('Save failed');
  ui.writes[0].reject(error); await pending;
  assert.deepEqual(ui.errors, [error]); assert.equal(ui.picker.isOpen(), true);
  assert.equal(ui.labelled('Search stickers').value, 'heart'); assert.equal(ui.labelled('Add heart').disabled, false);
  assert.equal(find(node => node.className === 'map-toast', ui.host).hidden, true);
});

test('closed or replaced picker ignores stale success and error continuations', async () => {
  for (const outcome of ['success', 'reject']) {
    const ui = fixture(), pending = ui.labelled('Add heart').click();
    ui.picker.open('102', { x: 20, y: 20 });
    ui.writes[0][outcome](new Error('Old request failed')); await pending;
    assert.deepEqual(ui.errors, []);
    assert.equal(ui.labelled('Add heart').disabled, false);
    assert.ok(ui.text('Stickers · Test shore'));
    assert.equal(find(node => node.className === 'map-toast', ui.host).hidden, true);
  }
});

test('Label & more opens the full manager for the chosen chunk', () => {
  const ui = fixture(); ui.text('Label & more…').click(); assert.deepEqual(ui.full, ['101']); assert.equal(ui.picker.isOpen(), false);
});

test('Undo pins the successful sticker revision and blocks additions while pending', async () => {
  const ui = fixture(), pending = ui.labelled('Add heart').click();
  ui.writes[0].success(); await pending;
  const undo = find(node => node.textContent === 'Undo', ui.host);
  const undoPending = undo.click();
  assert.deepEqual(ui.writes[1].command, { type: 'undo' }); assert.equal(ui.writes[1].revision, 10);
  await ui.labelled('Add skull').click(); assert.equal(ui.writes.length, 2);
  ui.writes[1].success(); await undoPending;
  assert.equal(ui.labelled('Add skull').disabled, false);
});

test('a conflict keeps the reviewed revision until explicit reload refreshes it and selected colour', async () => {
  const ui = fixture([star]); ui.labelled('Select star: Mine here').click();
  assert.equal(ui.labelled('Select star: Mine here').focused, true, 'selection keeps keyboard focus');
  let pending = ui.labelled('Colour #e5484d').click();
  assert.equal(ui.text('Reload stickers').disabled, true);
  ui.text('Reload stickers').click();
  ui.state.revision = 10; ui.state.members[0].stickers[101][0] = { ...star, color: '#6fa8ff' };
  ui.writes[0].reject(Object.assign(new Error('Another save arrived'), { status: 409 })); await pending;
  pending = ui.labelled('Colour #e5484d').click();
  assert.equal(ui.writes[1].revision, 9, 'conflict does not silently accept a newer review');
  ui.writes[1].reject(new Error('Review is stale')); await pending;
  ui.text('Reload stickers').click();
  assert.equal(ui.labelled('Colour #6fa8ff').attributes['aria-pressed'], 'true');
  assert.equal(ui.labelled('Search stickers').focused, true);
  pending = ui.labelled('Colour #e5484d').click();
  assert.equal(ui.writes[2].revision, 10); ui.writes[2].success(); await pending;
  assert.equal(ui.labelled('Search stickers').focused, true, 'recolour leaves a usable keyboard continuation');
  ui.state.revision = 12; ui.state.members[0].stickers[101] = []; ui.text('Reload stickers').click();
  assert.equal(ui.text('New stickers'), undefined, 'reload clears selection if another save removed it');
});
