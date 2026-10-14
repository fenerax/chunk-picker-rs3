import test from 'node:test';
import assert from 'node:assert/strict';
import { openTeleportsDialog } from '../app/web/teleports.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const route = (id, group, extra = {}) => ({ id, group, name: `${id} route`, available: false, destination: '123', destinationName: 'Lumbridge', reason: 'Need personal progress', reasons: ['Need personal progress'], estimated: true, override: null, ...extra });
function harness(preferences = {}) {
  class Node {
    constructor(tag, text, cls) { Object.assign(this, { tag, textContent: text ?? '', className: cls ?? '', children: [], events: {}, attributes: {}, value: '', checked: false, disabled: false }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, callback) { this.events[type] = callback; }
  }
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const state = { revision: 7, rules: { 'travel.automatic': false }, members: [
    { id: 'a', name: 'Player', teleports: [{ id: 'custom', label: 'Home route', destination: '123', available: true, consumable: false }] },
    { id: 'b', name: 'Reed', teleports: [] },
  ] };
  const ui = { generation: 0, memberId: 'a', open: true, nodes: [], fetch: [], commands: [], responses: [], commandWait: null, commandError: null };
  const routes = [route('home', 'lodestones', { available: true, estimated: false }), route('magic', 'spells'), route('ring', 'items'), route('boat', 'transport')];
  const snapshot = () => ({ memberId: 'a', stateRevision: state.revision, automatic: state.rules['travel.automatic'], rows: structuredClone(routes) });
  const ctx = {
    el, preferences: () => preferences, state: () => state, memberId: () => ui.memberId, plain: value => String(value), world: () => ({ chunks: new Map([['123', { name: 'Lumbridge' }]]) }),
    input: (type, value = '') => Object.assign(el('input'), { type, value }),
    select: (values, value) => { const node = el('select'); node.value = value; node.append(...values.map(row => Object.assign(el('option', row.label), { value: row.value }))); return node; },
    field: (label, control) => { const node = el('div', undefined, 'form-field'); node.append(el('label', label), control); return node; },
    button: (label, action, cls) => { const node = el('button', label, cls); node.events.click = action; return node; },
    openDialog: (title, content) => { ui.title = title; ui.nodes = [content]; return ++ui.generation; },
    dialogCurrent: generation => ui.open && generation === ui.generation,
    api: async (...args) => { ui.fetch.push(args); return ui.responses.length ? await ui.responses.shift() : snapshot(); },
    command: async (command, revision, note, reviewCurrent) => {
      if (ui.commandWait) await ui.commandWait;
      if (!reviewCurrent()) throw new Error('Review changed before saving. Refresh Teleports.');
      if (ui.commandError) throw ui.commandError;
      ui.commands.push({ command, revision });
      const personal = state.members.find(row => row.id === command.memberId);
      if (command.type === 'set-rule') state.rules[command.ruleId] = command.value;
      if (command.type === 'set-teleport-override') routes.find(row => row.id === command.routeId).override = command.value;
      if (command.type === 'set-teleport') {
        const index = personal.teleports.findIndex(row => row.id === command.teleport.id);
        if (index < 0) personal.teleports.push(command.teleport); else personal.teleports[index] = command.teleport;
      }
      if (command.type === 'delete-teleport') personal.teleports = personal.teleports.filter(row => row.id !== command.teleportId);
      state.revision++;
    },
  };
  const walk = (nodes = ui.nodes) => nodes.flatMap(node => [node, ...walk(node.children)]);
  const find = (tag, text) => walk().find(node => node.tag === tag && (text === undefined || node.textContent === text));
  const text = () => walk().map(node => node.textContent).join('\n');
  const checkbox = label => walk().find(node => node.tag === 'label' && node.children.some(child => child.textContent === label))?.children[0];
  const inputFor = label => walk().find(node => node.className === 'form-field' && node.children[0].textContent === label)?.children[1];
  const changeCheck = async (label, checked) => { const node = checkbox(label); node.checked = checked; await node.events.change(); };
  const override = name => walk().find(node => node.tag === 'select' && node.attributes['aria-label'] === `Availability override for ${name} route`);
  return { state, ui, routes, snapshot, ctx, walk, find, text, checkbox, inputFor, changeCheck, override, open: () => openTeleportsDialog(ctx, { uuid: () => 'new-custom' }), click: label => find('button', label).events.click() };
}

test('personal catalogue groups availability, destinations, reasons and evidence without changing eligibility', async () => {
  const h = harness();
  const diagnostics = ['station coordinate needs exact decoded tile evidence', 'lodestone-anachronia-activated: confirmations requirement is unknown or not met.', 'wilderness-pvp-warning-accepted: confirmations requirement is unknown or not met.'];
  const personalReasons = ['Needs Magic 31; personal level 20.', 'Needs quest Dragon Slayer; personal completion unknown.', 'Needs 1 Law rune; reachable supply unknown.', 'other-route: confirmations requirement is unknown or not met.'];
  h.routes[1].reasons.push(...diagnostics, ...personalReasons);
  await h.open().ready;
  assert.equal(h.ui.title, 'Player’s Teleports');
  assert.equal(h.ui.fetch[0][0], '/api/teleports?member=a');
  for (const group of ['Lodestones', 'Spells', 'Items', 'Transport']) assert.ok(h.find('h3', group));
  assert.match(h.text(), /1 of 4 routes usable · Preview: automatic is off/);
  assert.match(h.text(), /only the custom teleports below count/);
  assert.match(h.text(), /destination stays locked until it’s rolled/);
  assert.ok(h.find('p', 'Lumbridge'));
  assert.ok(h.find('span', 'Usable')); assert.ok(h.find('span', 'Not usable'));
  assert.ok(!h.find('p', 'Checked requirements')); assert.ok(h.find('p', 'Based on estimated levels, so check in-game'));
  assert.doesNotMatch(h.text(), /Synced progress/);
  assert.equal(h.walk().filter(node => node.textContent === 'Need personal progress').length, 3);
  assert.match(h.text(), /Exact landing spot is not mapped yet\./);
  assert.match(h.text(), /Lodestone activation is not confirmed\./);
  assert.match(h.text(), /Wilderness PvP warning acceptance is not confirmed\. Accept the warning before using this lever\./);
  for (const reason of diagnostics) assert.equal(h.text().includes(reason), false);
  for (const reason of personalReasons.slice(0, -1)) assert.equal(h.text().includes(reason), true);
  assert.match(h.text(), /Required in-game confirmation is missing or unknown/);
  assert.equal(h.text().includes(personalReasons.at(-1)), false);
  assert.deepEqual(h.routes[1].reasons, ['Need personal progress', ...diagnostics, ...personalReasons]);
  assert.deepEqual(h.override('magic').children.map(row => row.textContent), ['Automatic', 'I can use it', 'I can’t use it']);
  assert.equal(h.ui.commands.length, 0);
});

test('automatic mode is explicitly shared and its revision-reviewed save refreshes the catalogue', async () => {
  const h = harness(); await h.open().ready;
  await h.changeCheck('Automatic availability', true);
  assert.deepEqual(h.ui.commands, [{ command: { type: 'set-rule', ruleId: 'travel.automatic', value: true }, revision: 7 }]);
  assert.match(h.text(), /On for both of you/);
  assert.equal(h.checkbox('Automatic availability').checked, true);
  assert.equal(h.ui.fetch.length, 2);
});

test('roll-eligible routes keep their usable status while disclosing unverified landing access', async () => {
  const h = harness();
  Object.assign(h.routes[1], { available: true, rollOnly: true, accessAvailable: false, reason: 'Spell requirements met', reasons: ['Spell requirements met'], accessReason: 'Exact landing section is not verified; destination resources are excluded.' });
  await h.open().ready;
  const row = h.walk().find(node => node.className === 'teleports-route' && h.walk(node.children).some(child => child.textContent === 'magic route'));
  assert.ok(h.walk(row.children).some(node => node.tag === 'span' && node.textContent === 'Usable'));
  assert.ok(h.find('p', 'Its destination can come up in your rolls. The exact landing spot isn’t mapped yet, so it doesn’t open up any area by itself.'));
  assert.ok(h.find('p', 'Exact landing section is not verified; destination resources are excluded.'));
  assert.match(h.text(), /2 of 4 routes usable/);
  assert.equal(h.ui.commands.length, 0);
});

test('each personal override saves true, false, or null and refreshes from the server', async () => {
  const h = harness();
  h.routes.push(route('unresolved', 'transport', { pending: true, reason: 'Destination is not mapped yet', estimated: false }));
  await h.open().ready;
  assert.ok(h.find('h4', 'unresolved route'));
  assert.equal(h.override('unresolved'), undefined);
  assert.ok(h.find('p', 'This route can’t be changed until it’s mapped.'));
  assert.ok(h.find('p', 'Not mapped yet'));
  assert.match(h.text(), /Destination is not mapped yet/);
  assert.equal(h.ui.commands.length, 0);
  for (const [value, expected] of [['true', true], ['false', false], ['auto', null]]) {
    const control = h.override('magic'); control.value = value; await control.events.change();
    assert.equal(h.override('magic').value, value);
    assert.deepEqual(h.ui.commands.at(-1).command, { type: 'set-teleport-override', memberId: 'a', routeId: 'magic', value: expected });
  }
  assert.deepEqual(h.ui.commands.map(row => row.revision), [7, 8, 9]);
});

test('custom teleports retain availability, consumable, removal and trimmed add controls', async () => {
  const h = harness(); await h.open().ready;
  await h.changeCheck('Usable by this player', false);
  assert.equal(h.state.members[0].teleports[0].available, false);
  await h.changeCheck('Consumable', true);
  assert.equal(h.state.members[0].teleports[0].consumable, true);
  await h.click('Remove'); assert.equal(h.state.members[0].teleports.length, 0);
  h.inputFor('Name').value = ' New route '; h.inputFor('Destination chunk').value = ' 123 ';
  h.checkbox('Uses a consumable').checked = true;
  await h.click('Add teleport');
  assert.deepEqual(h.state.members[0].teleports, [{ id: 'new-custom', label: 'New route', destination: '123', available: true, consumable: true }]);
  assert.equal(h.state.members[1].teleports.length, 0);
});

test('a changed revision rejects stale controls and restores the unsaved value', async () => {
  const h = harness(); await h.open().ready;
  h.state.revision++; await h.changeCheck('Automatic availability', true);
  assert.equal(h.ui.commands.length, 0); assert.equal(h.checkbox('Automatic availability').checked, false);
  assert.match(h.text(), /Refresh Teleports and review the latest availability/);
  await h.click('Refresh'); await h.changeCheck('Automatic availability', true);
  assert.equal(h.ui.commands[0].revision, 8);
});

test('a queued override cannot save after the member or dialog changes', async () => {
  for (const invalidate of [h => { h.ui.memberId = 'b'; }, h => { h.ui.generation++; }, h => { h.state.revision++; }]) {
    const h = harness(); await h.open().ready;
    const wait = deferred(); h.ui.commandWait = wait.promise;
    const control = h.override('magic'); control.value = 'true'; const pending = control.events.change();
    invalidate(h); wait.resolve(); await pending;
    assert.equal(h.ui.commands.length, 0);
  }
});

test('late catalogue results cannot overwrite a newer review, member, closed dialog, or revision', async () => {
  const h = harness(), late = deferred(); h.ui.responses.push(late.promise);
  const dialog = h.open();
  await dialog.refresh(); const prior = h.text();
  late.resolve({ ...h.snapshot(), rows: [route('obsolete', 'spells')] }); await dialog.ready;
  assert.equal(h.text(), prior); assert.equal(h.find('h4', 'obsolete route'), undefined);
  for (const invalidate of [h => { h.ui.memberId = 'b'; }, h => { h.ui.open = false; }, h => { h.state.revision++; }]) {
    const stale = harness(), result = deferred(); stale.ui.responses.push(result.promise);
    const before = stale.snapshot(), opening = stale.open(); invalidate(stale);
    result.resolve(before); await opening.ready;
    assert.equal(stale.find('h4', 'magic route'), undefined);
    assert.equal(stale.ui.commands.length, 0);
  }
});

test('network failure keeps custom routes usable and Retry obtains a new personal catalogue', async () => {
  const h = harness(); h.ui.responses.push(Promise.reject(new Error('Connection lost')));
  await h.open().ready;
  assert.match(h.text(), /Could not check teleport availability. Connection lost/);
  assert.ok(h.find('h4', 'Home route'));
  await h.click('Retry availability'); assert.ok(h.find('h4', 'magic route'));
  assert.equal(h.ui.commands.length, 0);
});

test('failed overrides revert their displayed choice and preserve saved automatic value', async () => {
  const h = harness(); await h.open().ready; h.ui.commandError = new Error('Save unavailable');
  const control = h.override('magic'); control.value = 'true'; await control.events.change();
  assert.equal(control.value, 'auto'); assert.equal(control.disabled, false);
  assert.match(h.text(), /Save unavailable/); assert.equal(h.routes[1].override, null);
});

test('Advanced reveals route diagnostics and known destination IDs without changing gameplay controls', async () => {
  for (const advanced of [false, true]) {
    const h = harness({ advanced });
    const diagnostic = 'station coordinate needs exact decoded tile evidence'; h.routes[0].reasons.push(diagnostic);
    const before = structuredClone(h.state); await h.open().ready;
    assert.equal(!!h.find('summary', 'Route diagnostics'), advanced);
    assert.equal(h.text().includes('Route ID: home'), advanced);
    assert.equal(h.text().includes(diagnostic), advanced);
    assert.ok(h.find('p', advanced ? 'Lumbridge · Chunk 123' : 'Lumbridge'));
    assert.match(h.text(), /Exact landing spot is not mapped yet/);
    assert.ok(h.override('home')); assert.ok(h.checkbox('Usable by this player'));
    assert.equal(h.inputFor('Destination chunk').placeholder, 'Destination chunk ID');
    assert.deepEqual(h.state, before); assert.equal(h.ui.commands.length, 0);
  }
});
