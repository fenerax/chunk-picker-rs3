import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReview, reviewChanges, reviewRules, reviewSelection, reviewSummary } from '../app/web/rules-review-model.mjs';
import { createRulesReview } from '../app/web/rules-review.mjs';
const sections = [{ id: 'first', name: 'First', rules: [{ id: 'Boosting', label: 'Boosting', type: 'boolean', description: 'Allow boosts.', tooltips: ['Original wording'] }, { id: 'InsidePOH', label: 'Furniture', type: 'boolean', membersOnly: true }] },
  { id: 'second', name: 'Second', rules: [{ id: 'Skills', label: 'Skills', type: 'boolean' }] }];
const state = () => ({ revision: 4, rules: {}, members: [{ id: 'a', name: 'Player A', taskRules: { Boosting: true, InsidePOH: false } }, { id: 'b', name: 'Player B', taskRules: { Boosting: false, InsidePOH: false } }], ruleReviews: { Skills: { reviewed: true, note: 'Keep' } } });
const registry = { resolve: rules => rules };

test('review navigation follows section order, clamps ends and supports filters without parent context rows', () => {
  const doc = state(), rows = reviewRules(sections, doc, { registry });
  assert.deepEqual(rows.map(row => row.id), ['Boosting', 'InsidePOH', 'Skills']);
  assert.equal(reviewSelection(rows, 'Boosting', -1).id, 'Boosting');
  assert.equal(reviewSelection(rows, 'InsidePOH', 1).id, 'Skills');
  assert.equal(reviewSelection(rows, 'Skills', 1).id, 'Skills');
  assert.equal(reviewSelection([], 'Skills'), null);
  assert.deepEqual(reviewRules(sections, doc, { filter: 'unreviewed', registry }).map(row => row.id), ['Boosting', 'InsidePOH']);
  assert.deepEqual(reviewRules(sections, doc, { filter: 'different', registry }).map(row => row.id), ['Boosting']);
  assert.deepEqual(reviewRules(sections, doc, { filter: 'members', registry }).map(row => row.id), ['InsidePOH']);
});

test('changed filter and Discord summary compare session values and remove undone changes', () => {
  const doc = state(), rules = sections.flatMap(section => section.rules), baseline = captureReview(doc, rules, registry);
  doc.members[1].taskRules.Boosting = true;
  const changes = reviewChanges(doc, rules, baseline, registry);
  assert.equal(changes.length, 1); assert.match(reviewSummary(changes), /Player B · Boosting: Off → On/);
  assert.deepEqual(reviewRules(sections, doc, { filter: 'changed', changes, registry }).map(row => row.id), ['Boosting']);
  doc.members[1].taskRules.Boosting = false; assert.equal(reviewChanges(doc, rules, baseline, registry).length, 0);
});

function harness(writable = true, beforeSave = async () => {}) {
  class Node {
    constructor(tag, text = '', className) { Object.assign(this, { tag, textContent: text, className, children: [], dataset: {}, attrs: {}, events: {} }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
  }
  const doc = state(), calls = [], host = new Node('div'), el = (...args) => new Node(...args);
  const ctx = { el, state: () => doc, memberId: () => 'a', registry: () => registry, canWrite: () => writable,
    input: (type, value) => Object.assign(el('input'), { type, value }),
    select: (options, value) => Object.assign(el('select'), { options, value }),
    button: (text, action) => { const node = el('button', text); node.events.click = action; return node; },
    field: (label, control) => { const node = el('label', label); node.append(control); return node; },
    details: (label, ...children) => { const node = el('details', label); node.append(...children); return node; },
    api: async () => { throw new Error('unexpected evaluation'); }, showError: error => { throw error; } };
  const panel = createRulesReview(ctx);
  panel.mount(host, { sections: () => sections, current: () => true, busy: () => false, stale: () => calls.push('stale'),
    save: async (commands, revision) => { calls.push({ commands, revision }); await beforeSave(); for (const command of commands) {
      if (command.type === 'set-rule-review') doc.ruleReviews[command.ruleId] = { reviewed: command.reviewed, note: command.note };
      else if (command.type === 'set-task-rule') doc.members.find(member => member.id === command.memberId).taskRules[command.ruleId] = command.value;
      doc.revision++;
    } panel.render(); } });
  const walk = node => [node, ...node.children.flatMap(walk)], nodes = () => walk(host);
  const button = label => nodes().find(node => node.tag === 'button' && node.textContent === label);
  const control = label => nodes().find(node => node.tag === 'label' && node.textContent === label)?.children[0];
  return { doc, calls, panel, nodes, button, control };
}

test('guided view shows both values and automatic, changes Both through revision checked commands, saves shared notes', async () => {
  const h = harness();
  assert.ok(h.nodes().some(node => /On · Automatic \(Off\)/.test(node.textContent)));
  assert.ok(h.nodes().some(node => node.textContent === 'Original wording'));
  const target = h.control('Change for'); target.value = 'both'; target.events.change();
  await h.button('On').events.click();
  assert.deepEqual(h.calls[0], { revision: 4, commands: [{ type: 'set-task-rule', memberId: 'b', ruleId: 'Boosting', value: true }] });
  const note = h.control('Shared note (up to 500 characters)'); note.value = 'Keep boosts'; note.events.input();
  await h.button('Save note').events.click(); assert.equal(h.doc.ruleReviews.Boosting.note, 'Keep boosts');
  const tick = h.nodes().find(node => node.type === 'checkbox'); tick.checked = true; await tick.events.change();
  assert.equal(h.doc.ruleReviews.Boosting.reviewed, true);
  h.button('Next').events.click(); assert.ok(h.nodes().some(node => node.tag === 'h3' && node.textContent === 'Furniture'));
  const jump = h.control('Section'); jump.value = 'second'; jump.events.change(); assert.ok(h.nodes().some(node => node.tag === 'h3' && node.textContent === 'Skills'));
});

test('viewer can navigate and read progress/notes but gets no save or preview controls', () => {
  const h = harness(false); h.button('Next').events.click(); h.button('Next').events.click();
  assert.equal(h.control('Shared note (up to 500 characters)').value, 'Keep');
  assert.equal(h.control('Shared note (up to 500 characters)').disabled, true);
  for (const label of ['On', 'Off', 'Save note', 'Check task effect', 'Save value']) assert.equal(h.button(label), undefined);
  assert.equal(h.calls.length, 0);
});

test('a note draft protects a newer shared save until the latest note is reviewed', async () => {
  const h = harness(), note = h.control('Shared note (up to 500 characters)');
  note.value = 'My draft'; note.events.input();
  h.doc.revision++;
  h.doc.ruleReviews.Boosting = { reviewed: false, note: 'New shared note' };
  await h.button('Save note').events.click();
  assert.equal(h.doc.ruleReviews.Boosting.note, 'New shared note');
  assert.ok(h.nodes().some(node => /Saved note: New shared note/.test(node.textContent)));
  h.button('Keep draft after reading saved note').events.click();
  await h.button('Save note').events.click();
  assert.equal(h.doc.ruleReviews.Boosting.note, 'My draft');
});

test('a delayed note save preserves a newer draft', async () => {
  let finish; const waiting = new Promise(resolve => { finish = resolve; });
  const h = harness(true, () => waiting), note = h.control('Shared note (up to 500 characters)');
  note.value = 'First note'; note.events.input();
  const saving = h.button('Save note').events.click();
  note.value = 'Newer draft'; note.events.input();
  finish(); await saving;
  assert.equal(h.doc.ruleReviews.Boosting.note, 'First note');
  assert.equal(h.control('Shared note (up to 500 characters)').value, 'Newer draft');
});

import { createGroupState, applyCommand, applyValidatedCommand, validateState, exportBackup, importBackup,
  getUndoEligibility, taskClaimInvalidatingEvent, MAX_RULE_REVIEW_NOTE_LENGTH } from '../app/core/state.mjs';
import { taskRuleDefinitions } from '../app/data/settings.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { historyChangeType, describeHistoryEvent } from '../app/web/history-text.mjs';

const initial = () => createGroupState([{ id: 'one', name: 'Explorer 1' }, { id: 'two', name: 'Explorer 2' }]);
const review = { type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: true, note: 'Discussed together.' };
const options = { now: '2026-10-17T12:00:00Z' };
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
for (const apply of [applyCommand, applyValidatedCommand]) {
  test(`${apply.name} saves shared review metadata without changing gameplay and reverses it`, () => {
    const original = freeze(initial()), fingerprint = createGameplayFingerprint();
    let saved = apply(original, { ...review, note: ' \u0000Discussed\r\ntogether. ' }, { ...options, expectedRevision: 0 });
    assert.deepEqual(saved.ruleReviews, { [review.ruleId]: { reviewed: true, note: 'Discussed\ntogether.' } });
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.members, original.members);
    assert.deepEqual(saved.rules, original.rules);
    assert.deepEqual(saved.tasks, original.tasks);
    assert.equal(fingerprint(saved), fingerprint(original));
    assert.equal(taskClaimInvalidatingEvent(saved.history.at(-1)), false);
    assert.deepEqual(projectPlayState(saved).ruleReviews, saved.ruleReviews);
    assert.deepEqual(importBackup(exportBackup(saved)).ruleReviews, saved.ruleReviews);
    assert.equal(getUndoEligibility(saved, 1).canUndo, true);
    const reversed = apply(saved, { type: 'undo', undoRevision: 1 }, options);
    assert.equal(reversed.ruleReviews, undefined);
    assert.equal(fingerprint(reversed), fingerprint(original));
    assert.equal(original.ruleReviews, undefined);
    saved = apply(saved, { ...review, reviewed: false, note: '' }, options);
    assert.deepEqual(saved.ruleReviews[review.ruleId], { reviewed: false, note: '' });
    assert.deepEqual(apply(saved, { type: 'undo' }, options).ruleReviews, { [review.ruleId]: { reviewed: true, note: 'Discussed\ntogether.' } });
  });

  test(`${apply.name} accepts known task rule reviews and rejects malformed or stale writes`, () => {
    const original = initial(), taskId = taskRuleDefinitions[0].id;
    assert.equal(apply(original, { ...review, ruleId: taskId }, options).ruleReviews[taskId].reviewed, true);
    for (const patch of [{ ruleId: 'not-a-rule' }, { ruleId: '__proto__' }, { reviewed: 'yes' }, { reviewed: null },
      { note: null }, { note: 'x'.repeat(MAX_RULE_REVIEW_NOTE_LENGTH + 1) }, { memberId: 'one' }]) {
      assert.throws(() => apply(original, { ...review, ...patch }, options), TypeError);
    }
    assert.throws(() => apply(original, review, { ...options, expectedRevision: 1 }), /Revision conflict/);
    const state = apply(original, review, options);
    const changed = apply(state, { ...review, note: 'New note' }, options);
    assert.equal(getUndoEligibility(changed, 1).canUndo, false);
    assert.throws(() => apply(changed, { type: 'undo', undoRevision: 1 }, options));
    assert.equal(changed.ruleReviews[review.ruleId].note, 'New note');
  });
}

test('import validates review rows and guarded History inverses', () => {
  const state = applyCommand(initial(), review, options);
  for (const modify of [s => s.ruleReviews[review.ruleId].extra = true,
    s => s.ruleReviews.unknown = { reviewed: true, note: '' },
    s => s.ruleReviews[review.ruleId].note = '\u0000',
    s => s.history[0].undo.ruleReviewChange.after.value[review.ruleId].note = 'tampered']) {
    const corrupt = structuredClone(state); modify(corrupt);
    assert.throws(() => validateState(corrupt), TypeError);
  }
});

test('History describes reviews as rule reviews without exposing note text', () => {
  const event = { type: review.type, command: review };
  assert.equal(historyChangeType(event), 'settings');
  assert.equal(describeHistoryEvent(event, { ruleLabel: () => 'Adjacent chunks' }), 'Reviewed Adjacent chunks');
  assert.equal(describeHistoryEvent({ ...event, command: { ...review, reviewed: false } }, { ruleLabel: () => 'Adjacent chunks' }), 'Reopened review of Adjacent chunks');
  assert.equal(describeHistoryEvent(event).includes(review.note), false);
});
