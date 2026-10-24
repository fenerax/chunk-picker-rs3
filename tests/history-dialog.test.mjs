import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenHistory } from '../app/web/screen-history.mjs';
import { backupSaveLabel } from '../app/web/backup-status.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, value: '', children: [], attributes: {}, events: {},
    classList: { toggle() {} }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, action) { this.events[name] = action; }, emit(name) { return this.events[name]?.(); } };
}
const event = (revision, command = {}) => ({ revision, type: 'set-note', at: '2026-10-12T12:00:00Z', actor: { label: 'Reed', memberId: 'reed' }, command: { memberId: 'reed', chunkId: '101', note: `Note ${revision}`, ...command } });
function harness({ writable = true, advanced = false, local } = {}) {
  let generation = 0, content, respond = async () => ({ stateRevision: 300, history: [], hasMore: false, nextBefore: null });
  const calls = [], c = { stateIsPlayView: !local, state: { revision: 300, history: local, members: [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }] }, memberId: 'actor1',
    el: node, input: type => ({ ...node('input'), type }), select: (values, value) => ({ ...node('select'), values, value }),
    field: (label, control) => { const field = node('label', label); field.append(control); return field; },
    button: (label, action) => ({ ...node('button', label), action }), canWrite: () => writable, advanced: () => advanced,
    lazyJSON: (label, value) => ({ ...node('details', label), details: value }),
    details: label => ({ ...node('details', label), open: false }), jsonPreview: value => ({ ...node('pre', JSON.stringify(value)), details: value }),
    historyLookups: () => ({ chunkName: () => 'Lumbridge', memberName: id => id === 'reed' ? 'Reed' : 'Player' }),
    openDialog: (title, value) => { content = value; return ++generation; }, dialogCurrent: value => value === generation,
    api: path => { calls.push(path); return respond(path); }, command: async () => {},
  };
  createScreenHistory(c);
  const all = () => { const values = []; const visit = value => { values.push(value); value.children.forEach(visit); }; visit(content); return values; };
  return { c, calls, respond: value => { respond = value; }, all, find: (tag, text) => all().find(value => value.tag === tag && value.textContent === text),
    control: label => all().find(value => value.tag === 'label' && value.textContent === label)?.children[0],
    close: () => generation++, get content() { return content; } };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('History loads older pages from the server and keeps the filters in place', async () => {
  const h = harness();
  h.respond(async path => path.includes('before=151')
    ? { stateRevision: 300, history: [event(150)], nextBefore: null, hasMore: false }
    : { stateRevision: 300, history: Array.from({ length: 150 }, (_, index) => event(300 - index)), nextBefore: 151, hasMore: true });
  await h.c.historyDialog();
  const search = h.control('Find a change');
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 150);
  await h.find('button', 'Load older').action();
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 151);
  assert.equal(h.control('Find a change'), search);
  assert.match(h.calls[1], /before=151/); assert.match(h.calls[1], /stateRevision=300/);
  assert.equal(h.find('button', 'Load older'), undefined);
});

test('player and change filters search the server and discard a delayed older page', async () => {
  const h = harness(), older = deferred();
  h.respond(async path => path.includes('before=250') ? older.promise : { stateRevision: 300, history: [event(250)], hasMore: !path.includes('player='), nextBefore: 250 });
  await h.c.historyDialog(); const loading = h.find('button', 'Load older').action();
  h.control('Find a change').value = 'Lumbridge & note'; h.control('Player').value = 'reed'; h.control('Type of change').value = 'notes';
  await h.control('Player').emit('change');
  assert.match(h.calls.at(-1), /player=reed&type=notes&q=Lumbridge%20%26%20note/);
  assert.doesNotMatch(h.calls.at(-1), /before=/);
  older.resolve({ stateRevision: 300, history: [event(1)], hasMore: false }); await loading;
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 1);
  assert.equal(h.find('button', 'Load older'), undefined);
});

test('failed older reads retain loaded rows and can be retried', async () => {
  const h = harness(); let failures = 1;
  h.respond(async path => {
    if (!path.includes('before=')) return { stateRevision: 300, history: [event(200)], nextBefore: 200, hasMore: true };
    if (failures--) throw new Error('private file path');
    return { stateRevision: 300, history: [event(100)], nextBefore: null, hasMore: false };
  });
  await h.c.historyDialog(); await h.find('button', 'Load older').action();
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 1);
  assert.ok(!h.all().some(node => node.textContent.includes('private file path')));
  await h.find('button', 'Retry older changes').action();
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 2);
});

test('closed dialogs and changed revisions cannot publish delayed History', async () => {
  for (const changed of ['close', 'revision']) {
    const h = harness(), response = deferred(); h.respond(() => response.promise);
    const loading = h.c.historyDialog();
    if (changed === 'close') h.close(); else h.c.state.revision++;
    response.resolve({ stateRevision: 300, history: [event(300)], hasMore: false }); await loading;
    assert.equal(h.all().filter(node => node.className === 'history-row').length, 0);
    if (changed === 'revision') assert.ok(h.find('button', 'Refresh History'));
  }
});

test('viewer History has search and paging without Undo, and Advanced loads full details on demand', async () => {
  const h = harness({ writable: false, advanced: true }); h.respond(async () => ({ stateRevision: 300, history: [event(300)], hasMore: true, nextBefore: 300 }));
  await h.c.historyDialog();
  assert.equal(h.find('button', 'Undo most recent change'), undefined);
  assert.ok(h.control('Player')); assert.ok(h.find('button', 'Load older'));
  assert.equal(h.calls.length, 1);
  const detail = h.find('details', 'Change details'); detail.open = true;
  h.respond(async () => ({ stateRevision: 300, event: { ...event(300), command: { source: { full: true } } } }));
  detail.emit('toggle'); for (let index = 0; index < 6; index++) await Promise.resolve();
  assert.match(h.calls[1], /\/api\/history\/300\?stateRevision=300/);
  assert.equal(h.all().find(value => value.tag === 'pre').details.command.source.full, true);
});

test('empty filtered History has a clear message and local full-state History can pass 150 entries', async () => {
  const h = harness({ local: Array.from({ length: 170 }, (_, index) => event(index + 1)) });
  await h.c.renderHistory(h.c.state.history); await h.find('button', 'Load older').action();
  assert.equal(h.all().filter(node => node.className === 'history-row').length, 170);
  h.control('Player').value = 'actor1'; await h.control('Player').emit('change');
  assert.ok(h.all().some(node => node.textContent === 'No changes match these filters.'));
});

test('History reads archived pages from the server even after a full-state response', async () => {
  const h = harness({ local: [event(300)] });
  h.respond(async () => ({ stateRevision: 300, history: [event(299)], hasMore: false, nextBefore: null }));
  await h.c.historyDialog();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0], /^\/api\/history\?limit=150/);
});

test('restore labels explain the revision change and actor without revision numbers or file sizes', () => {
  const backup = { revision: 812, at: '2026-10-12T12:00:00Z', bytes: 8192, event: event(812) };
  const label = backupSaveLabel(backup, { chunkName: () => 'Lumbridge', memberName: () => 'Reed' });
  assert.match(label, /Edited the note on Lumbridge for Reed · by Reed/);
  assert.doesNotMatch(label, /812|KB|set-note/);
  assert.match(backupSaveLabel({ ...backup, event: undefined }), /^Saved changes · /);
  assert.match(backupSaveLabel({ ...backup, revision: 0, event: undefined }), /^Initial save · /);
});
