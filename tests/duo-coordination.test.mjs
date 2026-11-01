import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerOwnsEvent, otherPlayerChanges, changeSentences, catchUpChanges, seenRevisionKey, readSeenRevision, writeSeenRevision, createDuoCoordination } from '../app/web/duo-coordination.mjs';

const actor1 = { memberId: 'actor1', label: 'Player', actor: { kind: 'invite', inviteId: 'm', label: 'Player', memberId: 'actor1' } };
const reed = { kind: 'invite', inviteId: 'r', label: 'Reed', memberId: 'reed' };
const names = { memberName: id => ({ actor1: 'Player', reed: 'Reed' })[id] ?? id, chunkName: id => `East Daemonheim Castle (${id})`, taskLabel: id => id };
const event = (revision, actor = reed, command = { memberId: 'reed', chunkId: '13882', status: 'unlocked' }, type = 'set-chunk', second = revision) => ({ revision, actor, command, type, at: `2026-10-10T12:00:${String(second).padStart(2, '0')}.000Z` });

test('claim catch-up and live summaries keep the named History sentence', () => {
  const started = event(1, reed, { memberId: 'reed', taskId: 'Dragon Slayer' }, 'claim-task');
  const stopped = event(2, reed, { memberId: 'reed', taskId: 'Dragon Slayer' }, 'clear-task-claim');
  const takeover = event(3, reed, { memberId: 'reed', taskId: 'Dragon Slayer', taskLabel: 'Mine 50 copper ore', previousMemberId: 'actor1' }, 'claim-task');
  const lines = ['Reed started “Dragon Slayer”', 'Reed is no longer doing “Dragon Slayer”', 'Reed took over “Mine 50 copper ore” from Player'];
  assert.deepEqual(changeSentences([started, stopped, takeover], names), lines);
  assert.deepEqual(catchUpChanges([started, stopped, takeover], actor1, 0, names), { lines, more: false });
});

test('viewer identity follows the author, across player-linked invites and map selection', () => {
  assert.equal(viewerOwnsEvent(event(1, actor1.actor, { memberId: 'reed' }), actor1), true);
  assert.equal(viewerOwnsEvent(event(1, { ...actor1.actor, inviteId: 'second-link' }), actor1), true);
  assert.equal(viewerOwnsEvent(event(1), actor1), false);
  assert.equal(viewerOwnsEvent(event(1, { kind: 'invite', inviteId: 'someone-else', label: 'Player' }), actor1), false);
  assert.equal(viewerOwnsEvent(event(1, { kind: 'master', label: 'Player' }), { actor: { kind: 'master', label: 'Player' } }), true);
  assert.equal(viewerOwnsEvent(event(1, undefined), actor1), false);
  const history = [event(1), event(2, actor1.actor), event(3), { revision: 4 }];
  assert.deepEqual(otherPlayerChanges(history, actor1, 1, 3).map(row => row.revision), [3]);
});

test('live sentences use History names and group only quick ticks by the same author', () => {
  assert.equal(changeSentences([event(1)], names)[0], 'Reed unlocked East Daemonheim Castle (13882)');
  const tick = (id, second, actor = reed) => event(second, actor, { memberId: 'reed', taskId: id, challengeCompleted: true }, 'set-task-status', second);
  assert.deepEqual(changeSentences([tick('a', 1), tick('b', 2), tick('c', 4)], names), ['Reed ticked 3 tasks']);
  const labeled = [tick('a', 1), tick('b', 2)].map(row => ({ ...row, command: { ...row.command, taskLabel: 'Saved task description' } }));
  assert.deepEqual(changeSentences(labeled, names), ['Reed ticked 2 tasks']);
  assert.equal(changeSentences([tick('a', 1), tick('a', 2)], names)[0], 'Reed ticked 1 task');
  assert.equal(changeSentences([tick('a', 1), tick('b', 8)], names).length, 2);
  assert.equal(changeSentences([tick('a', 1), event(2), tick('b', 3)], names).length, 3);
  const forPlayer = [tick('a', 1), tick('b', 2)].map(row => ({ ...row, command: { ...row.command, memberId: 'actor1' } }));
  assert.deepEqual(changeSentences(forPlayer, names), ['Reed ticked 2 tasks for Player']);
  assert.equal(changeSentences([tick('a', 1), forPlayer[1]], names).length, 2);
  assert.equal(changeSentences([event(1, reed, { memberId: 'actor1', chunkId: '13882', status: 'unlocked' })], names)[0], 'Reed unlocked East Daemonheim Castle (13882) for Player');
});

test('catch-up is bounded, ignores own changes and starts empty on a first visit', () => {
  const history = Array.from({ length: 15 }, (_, i) => event(i + 1)); history.push(event(16, actor1.actor));
  const value = catchUpChanges(history, actor1, 0, names);
  assert.equal(value.lines.length, 5); assert.equal(value.more, true);
  assert.deepEqual(catchUpChanges(history, actor1, null, names), { lines: [], more: false });
  assert.equal(catchUpChanges(history, actor1, 13, names).lines.length, 2);
  assert.equal(catchUpChanges(history, actor1, 13, names, 5, 14).lines.length, 1);
});

test('last-seen storage survives blocked storage and uses the linked player, not the selected map', () => {
  const key = seenRevisionKey(actor1, [{ id: 'reed' }, { id: 'actor1' }]);
  assert.equal(key, seenRevisionKey({ ...actor1, actor: { ...actor1.actor, inviteId: 'new-link' } }, [{ id: 'actor1' }, { id: 'reed' }]));
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readSeenRevision(storage, key), null); writeSeenRevision(storage, key, 23); assert.equal(readSeenRevision(storage, key), 23);
  values.set(key, 'NaN'); assert.equal(readSeenRevision(storage, key), null);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readSeenRevision(blocked, key), null); assert.doesNotThrow(() => writeSeenRevision(blocked, key, 2));
});

function harness({ seen = 0, latest = event(3), own, history = [event(1), event(2, actor1.actor), latest] } = {}) {
  const document = new EventTarget(); document.body = {}; document.documentElement = {}; document.defaultView = new EventTarget(); document.activeElement = document.body;
  class Node {
    focus() { document.activeElement = this; document.dispatchEvent(new Event('focusin')); }
    set disabled(value) { this._disabled = value; if (value && document.activeElement === this) document.activeElement = document.body; }
    get disabled() { return this._disabled; }
    constructor(tag, text = '', className = '') { Object.assign(this, { tag, textContent: text, className, children: [], events: {}, hidden: true, isConnected: true, ownerDocument: document }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  const el = (tag, text, cls) => new Node(tag, text, cls), button = (text, action, cls) => Object.assign(el('button', text, cls), { action });
  const state = { revision: 3, members: [{ id: 'actor1' }, { id: 'reed' }] }, calls = [], dialogs = [], timers = new Map();
  const fallback = el('button'); fallback.hidden = false;
  const undoButton = el('button'), ownHost = el('span'), catchUpHost = el('section'), liveHost = el('section');
  const values = new Map([[seenRevisionKey(actor1, state.members), String(seen)]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let snapshot = { stateRevision: 3, history, latestUndo: { canUndo: true, undoRevision: latest.revision, event: latest }, ownUndo: own ?? null }, clock = 10000, requests = 0, fail = false;
  const controller = createDuoCoordination({ api: async () => { requests++; if (fail) throw Error('temporarily unavailable'); return snapshot; }, viewer: actor1, getState: () => state, lookups: () => names,
    el, button, openDialog: (title, ...children) => { dialogs.push({ title, children }); return dialogs.length; }, closeDialog: generation => calls.push({ close: generation }),
    command: async (command, revision) => calls.push({ command, revision }), openHistory: () => calls.push({ history: true }),
    undoButton, undoFocusFallback: () => fallback, ownHost, catchUpHost, liveHost, storage, now: () => clock, setTimer: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimer: id => timers.delete(id) });
  return { controller, state, calls, dialogs, timers, document, fallback, undoButton, ownHost, catchUpHost, liveHost, values, setSnapshot: value => { snapshot = value; }, setClock: value => { clock = value; }, setFailure: value => { fail = value; }, requests: () => requests };
}
const allNodes = node => [node, ...(node.children ?? []).flatMap(allNodes)];

test('Undo names the author and requires an in-page confirmation for the other player', async () => {
  const h = harness(); await h.controller.refresh();
  assert.equal(h.undoButton.textContent, 'Undo');
  assert.equal(h.undoButton.title, 'Undo: Unlocked East Daemonheim Castle (13882) for Reed · by Reed');
  await h.controller.undo(); assert.equal(h.calls.length, 0); assert.equal(h.dialogs[0].title, 'Undo Reed’s change?');
  const confirm = h.dialogs[0].children.flatMap(node => [node, ...(node.children ?? [])]).find(node => node.textContent === 'Undo Reed’s change');
  await confirm.action(); assert.deepEqual(h.calls[0], { command: { type: 'undo', undoRevision: 3 }, revision: 3 });
});

test('cancel saves nothing, and a new save invalidates an open confirmation', async () => {
  const h = harness(); await h.controller.refresh(); await h.controller.undo();
  await h.dialogs[0].children.flatMap(node => [node, ...(node.children ?? [])]).find(node => node.textContent === 'Cancel').action();
  assert.equal(h.calls.some(call => call.command), false);
  h.state.revision++;
  await assert.rejects(h.dialogs[0].children.flatMap(node => [node, ...(node.children ?? [])]).find(node => node.textContent === 'Undo Reed’s change').action(), /Another change arrived/);
  assert.equal(h.calls.some(call => call.command), false);
});

test('History and older-own controls stay bound to the action that was shown', async () => {
  const own = { canUndo: true, undoRevision: 2, event: event(2, actor1.actor) };
  const h = harness({ own }); await h.controller.refresh();
  const historyUndo = h.controller.undoControl(), olderOwn = h.controller.ownControls().children.find(node => node.textContent === 'Undo my last change'), toolbarOwn = h.ownHost.children[0];
  h.state.revision = 4;
  h.setSnapshot({ stateRevision: 4, history: [], latestUndo: { canUndo: true, undoRevision: 4, event: event(4, actor1.actor) }, ownUndo: null });
  await h.controller.refresh();
  for (const control of [historyUndo, olderOwn, toolbarOwn]) await assert.rejects(control.action(), /Another change arrived/);
  assert.equal(h.calls.some(call => call.command), false);
});

test('own latest Undo needs no confirmation; an older own action is offered only when safe', async () => {
  const ownLatest = harness({ latest: event(3, actor1.actor) }); await ownLatest.controller.refresh(); await ownLatest.controller.undo();
  assert.equal(ownLatest.dialogs.length, 0); assert.equal(ownLatest.calls[0].command.undoRevision, 3);
  const own = { canUndo: true, undoRevision: 2, event: event(2, actor1.actor) };
  const safe = harness({ own }); await safe.controller.refresh(); assert.equal(safe.ownHost.children[0].textContent, 'Undo my last change');
  await safe.ownHost.children[0].action(); assert.equal(safe.calls[0].command.undoRevision, 2);
  const blocked = harness({ own: { ...own, canUndo: false, reason: 'A later change uses the same chunk.' } }); await blocked.controller.refresh();
  assert.equal(blocked.ownHost.children.length, 0);
  assert.match(allNodes(blocked.controller.ownControls()).map(node => node.textContent).join(' '), /A newer change affects the same part of the save/);
});

test('blocked Undo explains the problem without exposing storage diagnostics', async () => {
  const h = harness();
  h.setSnapshot({ stateRevision: 3, history: [], latestUndo: { canUndo: false, reason: 'No reversible command remains to undo' },
    ownUndo: { canUndo: false, reason: 'Stale undo: member value has changed', event: event(2, actor1.actor) } });
  await h.controller.refresh();
  assert.equal(h.undoButton.title, 'There’s no saved change to undo.');
  assert.match(allNodes(h.controller.ownControls()).map(node => node.textContent).join(' '), /A newer change affects the same part of the save/);
});

test('return list is dismissible, links History, and live changes merge without showing own saves', async () => {
  const h = harness(); await h.controller.refresh(); assert.equal(h.catchUpHost.hidden, false);
  assert.equal(h.catchUpHost.children[1].children.length, 2);
  h.catchUpHost.children[0].children[1].action(); assert.equal(h.catchUpHost.hidden, true);
  h.catchUpHost.children[2].events.click({ preventDefault() {} }); assert.deepEqual(h.calls[0], { history: true });
  const tick = (revision, taskId) => event(revision, reed, { memberId: 'reed', taskId, challengeCompleted: true }, 'set-task-status');
  const history = [tick(4, 'a'), tick(5, 'b')]; h.state.revision = 5;
  h.setSnapshot({ stateRevision: 5, history, latestUndo: { canUndo: true, undoRevision: 5, event: history[1] } }); await h.controller.refresh();
  assert.equal(h.liveHost.children[0].textContent, 'Reed ticked 2 tasks');
  h.state.revision = 6; h.setClock(11000); history.push(tick(6, 'c'));
  h.setSnapshot({ stateRevision: 6, history, latestUndo: { canUndo: true, undoRevision: 6, event: history[2] } }); await h.controller.refresh();
  assert.equal(h.liveHost.children[0].textContent, 'Reed ticked 3 tasks');
  h.state.revision = 7; history.push(event(7, actor1.actor)); h.setSnapshot({ stateRevision: 7, history, latestUndo: { canUndo: true, undoRevision: 7, event: history[3] } }); await h.controller.refresh();
  assert.equal(h.liveHost.children[0].textContent, 'Reed ticked 3 tasks');
  assert.equal([...h.values.values()][0], '7'); assert.equal(h.timers.size, 1);
  [...h.timers.values()][0](); assert.equal(h.liveHost.hidden, true); h.controller.dispose();
});

test('stale metadata cannot offer Undo or overwrite last-seen state', async () => {
  const h = harness({ seen: 2 }); h.state.revision = 4; await h.controller.refresh();
  assert.equal(h.undoButton.disabled, undefined); assert.equal([...h.values.values()][0], '2');
  h.controller.render(); assert.equal(h.undoButton.disabled, true);
  assert.equal(h.requests(), 1, 'a stale response must not spin or flood requests');
});

test('a failed metadata request leaves a working Retry Undo button and does not mark unseen changes', async () => {
  const h = harness({ seen: 1 }); h.setFailure(true); await h.controller.refresh();
  assert.equal(h.undoButton.disabled, false); assert.equal(h.undoButton.textContent, 'Retry Undo');
  assert.equal([...h.values.values()][0], '1'); h.setFailure(false); await h.controller.undo();
  assert.equal(h.undoButton.disabled, false); assert.equal(h.undoButton.textContent, 'Undo'); assert.match(h.undoButton.title, /^Undo: Unlocked/);
  assert.equal(h.catchUpHost.hidden, false);
});


const undoSnapshot = (revision, canUndo = true) => ({ stateRevision: revision, history: [], latestUndo: { canUndo, undoRevision: 2, event: event(2, actor1.actor) } });

test('toolbar Undo retains focus only after metadata for the current revision enables it', async () => {
  const h = harness(); await h.controller.refresh(); h.undoButton.focus();
  h.state.revision = 4; h.controller.render();
  assert.equal(h.undoButton.disabled, true); assert.equal(h.document.activeElement, h.document.body);
  h.setSnapshot(undoSnapshot(3)); await h.controller.refresh();
  assert.equal(h.undoButton.disabled, true); assert.equal(h.document.activeElement, h.document.body);
  h.setSnapshot(undoSnapshot(4)); await h.controller.refresh();
  assert.equal(h.undoButton.disabled, false); assert.equal(h.document.activeElement, h.undoButton);
  assert.equal(h.calls.length, 0);
});

test('exhausted Undo transfers focus to navigation and failed metadata offers focused Retry Undo', async () => {
  for (const failure of [false, true]) {
    const h = harness(); await h.controller.refresh(); h.undoButton.focus();
    h.state.revision = 4; h.controller.render(); h.setSnapshot(undoSnapshot(4, false)); h.setFailure(failure);
    await h.controller.refresh();
    assert.equal(h.document.activeElement, failure ? h.undoButton : h.fallback);
    assert.equal(h.undoButton.disabled, !failure);
    if (failure) assert.equal(h.undoButton.textContent, 'Retry Undo');
    assert.equal(h.calls.length, 0);
  }
});

for (const action of ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'focusin', 'blur', 'dispose', 'sandbox', 'hidden', 'removed']) test(`Undo focus wait is cancelled by ${action}`, async () => {
  const h = harness(); await h.controller.refresh(); h.undoButton.focus();
  h.state.revision = 4; h.controller.render();
  if (action === 'blur') h.document.defaultView.dispatchEvent(new Event('blur'));
  else if (action === 'dispose') h.controller.dispose();
  else if (action === 'sandbox') { h.state.sandboxActive = true; h.controller.render(); h.state.sandboxActive = false; }
  else if (action === 'hidden' || action === 'removed') {
    if (action === 'hidden') h.undoButton.checkVisibility = () => false; else h.undoButton.isConnected = false;
    h.setSnapshot(undoSnapshot(4)); await h.controller.refresh();
    h.undoButton.checkVisibility = () => true; h.undoButton.isConnected = true;
  } else h.document.dispatchEvent(new Event(action));
  h.setSnapshot(undoSnapshot(4)); await h.controller.refresh();
  assert.equal(h.undoButton.disabled, false); assert.equal(h.document.activeElement, h.document.body);
  assert.equal(h.calls.length, 0);
});
