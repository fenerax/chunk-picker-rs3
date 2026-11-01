import test from 'node:test';
import assert from 'node:assert/strict';

// Select the independent public dataset before importing application modules.
process.env.RS3_DATASET ??= 'open-f2p';
const { createGroupState, applyCommand, validatePreference } = await import('../app/core/state.mjs');
const { isNewSave, shouldOfferSetupGuide, setupGuideDismissed, setupStartPools, SETUP_START } = await import('../app/core/setup-guide.mjs');
const { createSetupGuide } = await import('../app/web/setup-guide.mjs');
const { describeHistoryEvent } = await import('../app/web/history-text.mjs');

// Synthetic banks and chunks only: real starting banks come from the dataset's
// members-start-banks file (its optionAF2PExtension list).
const banks = [{ chunkId: '101', place: 'North Town', bank: 'North Town bank' }, { chunkId: '102', place: 'South Town', bank: 'South Town bank' }];
const world = { chunks: new Map(['100', '101', '102', '103'].map(id => [id, { name: `Chunk ${id}` }])), surface: new Set(['100', '101', '102', '103']) };
const settingDefinitions = [{ id: 'roll2', type: 'boolean', default: true, label: 'Roll 2' },
  { id: 'theme', type: 'enum', options: ['dark', 'gray', 'light'], default: 'dark', label: 'Theme' }];

class Node {
  constructor(tag, text, className = '') { Object.assign(this, { tag, textContent: text ?? '', className, children: [], events: {}, attributes: {}, dataset: {}, value: '' }); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  querySelector(tag) { return walk(this).find(node => node.tag === tag); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { return this === node || this.children.some(child => child instanceof Node && child.contains(node)); }
}
const walk = node => node ? [node, ...node.children.flatMap(walk)] : [];
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ writable = true, sandbox = false, admin = false, data = { optionAF2PExtension: banks }, state: initial } = {}) {
  let state = initial ?? createGroupState([{ id: 'one', name: 'Ash' }, { id: 'two', name: 'Birch' }]);
  let content, title, generation = 0, open = false;
  const calls = [], errors = [], centred = [], dialog = new Node('dialog'), host = new Node('div');
  const document = { activeElement: undefined };
  const el = (tag, text, className) => Object.assign(new Node(tag, text, className), { ownerDocument: document });
  const ctx = {
    el, input: type => Object.assign(el('input'), { type, checked: false }),
    button: (label, click, className) => { const node = el('button', label, className); node.events.click = click; return node; },
    openDialog: (text, node) => { if (content?.contains(document.activeElement)) document.activeElement = undefined; title = text; content = node; host.children = [node]; open = true; return ++generation; },
    closeDialog: () => { generation++; open = false; calls.push('close'); },
    dialogCurrent: value => value === generation && open, isDialogOpen: () => open, dialog, dialogContent: () => host,
    state: () => state, memberId: () => 'one', canWrite: () => writable, sandboxActive: () => sandbox, advanced: () => false,
    preferences: id => ({ theme: 'dark', roll2: true, ...state.members.find(member => member.id === id)?.preferences }),
    settingDefinitions, supportsFeature: () => true, world: () => world, showError: error => errors.push(error),
    centerOnChunk: id => centred.push(id), isAdmin: () => admin, openInvites: () => calls.push('invites'),
    control: id => ({ hidden: id === 'helper-open' }), random: () => 0,
    api: async path => { calls.push(path); if (!data) throw new Error('Unavailable'); return { data }; },
    command: async command => { calls.push(structuredClone(command)); state = applyCommand(state, command, { world, membersStartBanks: data && { version: 'synthetic-v1', ...data }, random: () => 0 }); return { state }; },
  };
  const guide = createSetupGuide(ctx);
  const nodes = () => walk(content);
  const button = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const choice = label => nodes().find(node => node.tag === 'label' && walk(node).some(child => child.tag === 'strong' && child.textContent === label))?.children[0];
  const pick = async label => { const control = choice(label); control.checked = true; await control.events.change(); };
  const commands = () => calls.filter(call => typeof call === 'object');
  const userClose = () => { open = false; dialog.events.close(); };
  return { guide, ctx, calls, errors, centred, dialog, document, userClose, nodes, button, choice, pick, commands, step: () => content?.dataset.step, title: () => title,
    isOpen: () => open, state: () => state, setState: value => { state = value; } };
}

test('the guide is offered only to a member of a new or empty save', () => {
  const fresh = createGroupState([{ id: 'one', name: 'Ash' }, { id: 'two', name: 'Birch' }]);
  assert.equal(isNewSave(fresh), true);
  assert.equal(shouldOfferSetupGuide({ state: fresh, canWrite: true, preferences: {} }), true);
  assert.equal(shouldOfferSetupGuide({ state: fresh, canWrite: false, preferences: {} }), false, 'viewers never see it');
  assert.equal(shouldOfferSetupGuide({ state: fresh, canWrite: true, sandbox: true, preferences: {} }), false);
  const started = applyCommand(fresh, { type: 'set-chunk', memberId: 'two', chunkId: '100', status: 'unlocked' }, { world });
  assert.equal(isNewSave(started), false);
  assert.equal(shouldOfferSetupGuide({ state: started, canWrite: true, preferences: {} }), false, 'an existing save is left alone');
  const rolling = structuredClone(fresh); rolling.members[0].pendingRoll = ['100', '101'];
  assert.equal(isNewSave(rolling), false, 'a roll waiting for a choice counts as started');
  for (const value of ['finished', 'skipped']) assert.equal(shouldOfferSetupGuide({ state: fresh, canWrite: true, preferences: { setupGuide: value } }), false);
  assert.equal(setupGuideDismissed({ setupGuide: 'open' }), false);
});

test('offer opens the first step for a member and stays closed for viewers and existing saves', () => {
  const member = harness();
  assert.equal(member.guide.offer(), true);
  assert.equal(member.title(), 'Setup guide'); assert.equal(member.step(), 'roll');
  assert.ok(member.nodes().some(node => node.textContent === 'Step 1 of 4 · For Ash'));
  const viewer = harness({ writable: false });
  assert.equal(viewer.guide.offer(), false); viewer.guide.open();
  assert.equal(viewer.isOpen(), false, 'viewers cannot open it from anywhere');
  const existing = harness();
  existing.setState(applyCommand(existing.state(), { type: 'set-chunk', memberId: 'one', chunkId: '100', status: 'unlocked' }, { world }));
  assert.equal(existing.guide.offer(), false); assert.equal(existing.isOpen(), false);
});

test('roll style and theme write through set-preference so History and Undo apply', async () => {
  const h = harness(); h.guide.open();
  assert.equal(h.choice('Roll 1 or Roll 2').checked, true);
  await h.pick('Roll 1');
  assert.deepEqual(h.commands().at(-1), { type: 'set-preference', memberId: 'one', preferenceId: 'roll2', value: false });
  assert.equal(h.state().members[0].preferences.roll2, false);
  assert.ok(h.nodes().some(node => node.textContent === 'Saved.'));
  await h.button('Next').events.click();
  assert.equal(h.step(), 'theme');
  assert.deepEqual(h.nodes().filter(node => node.tag === 'strong').map(node => node.textContent), ['Dark', 'Gray', 'Light']);
  await h.pick('Light');
  assert.deepEqual(h.commands().at(-1), { type: 'set-preference', memberId: 'one', preferenceId: 'theme', value: 'light' });
  const event = h.state().history.at(-1);
  assert.equal(event.type, 'set-preference'); assert.ok(event.undo, 'the theme change is undoable');
  const undone = applyCommand(h.state(), { type: 'undo' }, { world });
  assert.equal(undone.members[0].preferences.theme, undefined);
  await h.pick('Light');
  assert.equal(h.commands().filter(command => command.preferenceId === 'theme').length, 1, 'choosing the saved value writes nothing');
});

test('the starting step rolls a reviewed bank for each empty map in one setup-start command', async () => {
  const h = harness(); h.guide.open();
  await h.button('Next').events.click(); await h.button('Next').events.click();
  assert.equal(h.step(), 'start'); await settle();
  assert.deepEqual(h.calls.filter(call => call === '/api/members-start'), ['/api/members-start']);
  assert.ok(h.nodes().some(node => node.textContent === 'Rolls for: Ash and Birch.'));
  await h.button('Roll starting banks').events.click();
  assert.deepEqual(h.commands(), [{ type: 'setup-start' }], 'the server rolls; the browser only asks');
  assert.deepEqual(h.state().members.map(member => [member.unlocked, member.preferences.startingChunk]), [[['101'], '101'], [['102'], '102']],
    'different banks where possible, as in the existing members start');
  assert.deepEqual(h.centred, ['101']);
  assert.ok(h.nodes().some(node => node.textContent === 'Ash: North Town bank'));
  const event = h.state().history.at(-1);
  assert.equal(event.type, 'setup-start'); assert.ok(event.undo, 'one Undo reverts every start');
  assert.deepEqual(event.command.starts.map(start => [start.memberId, start.chunkId]), [['one', '101'], ['two', '102']]);
  assert.equal(event.command.bankVersion, 'synthetic-v1');
  const undone = applyCommand(h.state(), { type: 'undo' }, { world });
  assert.deepEqual(undone.members.map(member => [member.unlocked, member.preferences?.startingChunk]), [[[], undefined], [[], undefined]]);
  assert.equal(h.guide.offer(), false, 'a started save no longer offers the guide');
});

test('the starting step rolls only for players still without a start and explains a missing bank list', async () => {
  const h = harness();
  h.setState(applyCommand(h.state(), { type: 'set-chunk', memberId: 'two', chunkId: '103', status: 'unlocked' }, { world }));
  h.guide.open(); await h.button('Next').events.click(); await h.button('Next').events.click(); await settle();
  assert.ok(h.nodes().some(node => node.textContent === 'Rolls for: Ash.'));
  await h.button('Roll a starting bank').events.click();
  assert.deepEqual(h.commands(), [{ type: 'setup-start' }]);
  assert.deepEqual(h.state().members.map(member => member.unlocked), [['101'], ['103']], 'a player with a start keeps it');
  assert.deepEqual(setupStartPools({ optionAF2PExtension: banks }, h.state()), []);
  const none = harness({ data: { optionA: banks } }); none.guide.open();
  await none.button('Next').events.click(); await none.button('Next').events.click(); await settle();
  assert.ok(none.nodes().some(node => /no starting-bank list yet/.test(node.textContent)));
  assert.equal(none.button('Roll starting banks'), undefined);
  const failed = harness({ data: null }); failed.guide.open();
  await failed.button('Next').events.click(); await failed.button('Next').events.click(); await settle();
  assert.ok(failed.nodes().some(node => /no starting-bank list yet/.test(node.textContent)));
  assert.equal(failed.commands().length, 0);
});

test('setup-start seeds sections, keeps other maps, and refuses when it has nothing to do', () => {
  const sectioned = { ...world, sectionTopology: new Map([['101', new Set(['1', '2'])], ['102', new Set(['1'])]]) };
  const data = { version: 'synthetic-v1', optionAF2PExtension: banks };
  let state = createGroupState([{ id: 'one', name: 'Ash' }, { id: 'two', name: 'Birch' }]);
  state.members[0].selected = ['101']; state.members[0].blacklisted = ['101', '100'];
  state = applyCommand(state, { type: SETUP_START }, { world: sectioned, membersStartBanks: data, random: () => 0 });
  const [one, two] = state.members;
  assert.deepEqual([one.unlocked, two.unlocked], [['101'], ['102']]);
  assert.deepEqual([one.selected, one.blacklisted], [[], ['100']], 'the start chunk leaves the selected and blacklist lists');
  assert.deepEqual([one.sectionOverrides, two.sectionOverrides], [{ '101-1': true }, { '102-1': true }], 'section 1 opens as in a random start');
  assert.throws(() => applyCommand(state, { type: SETUP_START }, { world: sectioned, membersStartBanks: data, random: () => 0 }), /already has a starting chunk/);
  const fresh = createGroupState([{ id: 'one', name: 'Ash' }]);
  assert.throws(() => applyCommand(fresh, { type: SETUP_START }, { world }), /Starting banks are unavailable/);
  assert.throws(() => applyCommand(fresh, { type: SETUP_START }, { world, membersStartBanks: { version: 'v' }, random: () => 0 }), /no starting-bank list/);
  const outside = { version: 'v', optionAF2PExtension: [{ chunkId: '999', place: 'Nowhere' }] };
  assert.throws(() => applyCommand(fresh, { type: SETUP_START }, { world, membersStartBanks: outside, random: () => 0 }), /outside the known surface world/);
  assert.throws(() => applyCommand(fresh, { type: SETUP_START, memberId: 'one' }, { world, membersStartBanks: data, random: () => 0 }));
  assert.equal(describeHistoryEvent({ type: SETUP_START, command: { type: SETUP_START, starts: [{ memberId: 'one', chunkId: '101', place: 'North Town' }] } },
    { memberName: () => 'Ash' }), 'Rolled starting banks: Ash at North Town');
});

test('skip and finish persist through the saved setupGuide preference', async () => {
  for (const step of [0, 1, 2, 3]) {
    const h = harness({ data: {} }); h.guide.open();
    for (let index = 0; index < step; index++) await h.button('Next').events.click();
    await h.button('Skip setup').events.click();
    assert.deepEqual(h.commands().at(-1), { type: 'set-preference', memberId: 'one', preferenceId: 'setupGuide', value: 'skipped' }, `skip on step ${step + 1}`);
    assert.equal(h.isOpen(), false);
    assert.equal(h.guide.offer(), false, 'a skipped guide stays dismissed');
    h.userClose();
    assert.equal(h.commands().length, 1, 'closing afterwards writes nothing more');
  }
  const done = harness({ data: {} }); done.guide.open();
  for (let index = 0; index < 3; index++) await done.button('Next').events.click();
  assert.equal(done.step(), 'tour'); assert.equal(done.button('Next'), undefined);
  await done.button('Finish').events.click();
  assert.deepEqual(done.commands(), [{ type: 'set-preference', memberId: 'one', preferenceId: 'setupGuide', value: 'finished' }]);
  assert.equal(done.state().members[0].preferences.setupGuide, 'finished');
  assert.equal(done.guide.dismissed(), true); assert.equal(done.guide.offer(), false);
  assert.equal(describeHistoryEvent(done.state().history.at(-1), { memberName: () => 'Ash' }), 'Changed setting First-time setup guide for Ash');
  const closed = harness(); closed.guide.open();
  closed.userClose(); await settle();
  assert.deepEqual(closed.commands(), [{ type: 'set-preference', memberId: 'one', preferenceId: 'setupGuide', value: 'skipped' }], 'closing the dialog skips');
});

test('reopening shows every step again without resetting the dismissal', async () => {
  const h = harness({ data: {} }); h.guide.open();
  await h.button('Skip setup').events.click();
  h.guide.open();
  assert.equal(h.isOpen(), true); assert.equal(h.step(), 'roll');
  await h.button('Next').events.click(); assert.equal(h.step(), 'theme');
  await h.button('Back').events.click(); assert.equal(h.step(), 'roll');
  for (let index = 0; index < 3; index++) await h.button('Next').events.click();
  await h.button('Finish').events.click();
  assert.deepEqual(h.commands().map(command => command.value), ['skipped', 'finished']);
  assert.equal(h.guide.offer(), false);
  h.guide.open(); await h.button('Skip setup').events.click();
  h.guide.open(); h.userClose(); await settle();
  assert.equal(h.commands().length, 2, 'skipping or closing a reopened guide keeps the finished state');
  assert.equal(h.state().members[0].preferences.setupGuide, 'finished');
});

test('a close queued by the Settings dialog the guide replaced does not skip it', async () => {
  const h = harness({ data: {} });
  h.ctx.openDialog('Settings', h.ctx.el('div'));
  h.ctx.closeDialog(); h.guide.open();
  h.dialog.events.close(); await settle();
  assert.equal(h.isOpen(), true); assert.equal(h.step(), 'roll');
  assert.equal(h.commands().length, 0);
});

test('the last step lists visible main buttons and uses the existing invite flow without links', async () => {
  const admin = harness({ admin: true, data: {} }); admin.guide.open();
  for (let index = 0; index < 3; index++) await admin.button('Next').events.click();
  const terms = admin.nodes().filter(node => node.tag === 'dt').map(node => node.textContent);
  assert.ok(terms.includes('Roll') && terms.includes('Undo') && terms.includes('More → Settings'));
  assert.equal(terms.includes('Helper'), false, 'hidden buttons are not described');
  assert.equal(admin.nodes().some(node => node.tag === 'a' || node.attributes.href), false, 'no invite links appear');
  await admin.button('Finish and open invite links').events.click();
  assert.deepEqual(admin.calls.slice(-1), ['invites']);
  assert.equal(admin.state().members[0].preferences.setupGuide, 'finished');
  assert.equal(admin.calls.includes('/api/invites'), false, 'the guide never loads invite links itself');
  const player = harness({ data: {} }); player.guide.open();
  for (let index = 0; index < 3; index++) await player.button('Next').events.click();
  assert.equal(player.button('Finish and open invite links'), undefined);
  assert.ok(player.nodes().some(node => /Ask whoever runs the picker/.test(node.textContent)));
});

test('the saved setupGuide preference accepts only its states', () => {
  for (const value of ['open', 'finished', 'skipped']) assert.equal(validatePreference('setupGuide', value), value);
  for (const value of ['done', true, '', null]) assert.throws(() => validatePreference('setupGuide', value), /First-time setup guide/);
});


test('explicit Next and Back focus the new step heading only when focus belonged to the old step', async () => {
  const h = harness(); h.guide.open();
  for (const label of ['Next', 'Back']) {
    h.button(label).focus(); await h.button(label).events.click();
    const heading = h.nodes().find(node => node.tag === 'h3');
    assert.equal(h.document.activeElement, heading);
    assert.equal(heading.tabIndex, -1, 'heading is focusable without adding a Tab stop');
  }
  const elsewhere = {}; h.document.activeElement = elsewhere;
  await h.button('Next').events.click();
  assert.equal(h.document.activeElement, elsewhere, 'a programmatic transition cannot steal focus from elsewhere');
});

test('loading starting banks does not defer focus or steal it back from a later choice', async () => {
  const h = harness(); h.guide.open();
  await h.button('Next').events.click();
  let resolve;
  h.ctx.api = () => new Promise(done => { resolve = done; });
  h.button('Next').focus(); const loading = h.button('Next').events.click();
  assert.equal(h.step(), 'start');
  assert.equal(h.document.activeElement, h.nodes().find(node => node.tag === 'h3'));
  const next = h.button('Next'); next.focus();
  resolve({ data: { optionAF2PExtension: banks } }); await loading;
  assert.equal(h.document.activeElement, next, 'passive bank-list completion leaves focus alone');
});

test('a stale starting-bank response cannot pull focus back after navigation or close', async () => {
  for (const close of [false, true]) {
    const h = harness(); h.guide.open(); await h.button('Next').events.click();
    let resolve; h.ctx.api = () => new Promise(done => { resolve = done; });
    h.button('Next').focus(); const loading = h.button('Next').events.click();
    h.button('Next').focus(); await h.button('Next').events.click();
    if (close) { h.userClose(); h.document.activeElement = {}; }
    const focused = h.document.activeElement;
    resolve({ data: { optionAF2PExtension: banks } }); await loading;
    assert.equal(h.document.activeElement, focused);
  }
});
