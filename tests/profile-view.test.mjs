import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProfile, createProfileView } from '../app/web/profile-view.mjs';
import { buildProfileModel } from '../app/web/profile-model.mjs';
import { formatProfileSummary } from '../app/web/profile-copy.mjs';
import { loadBiSMemberResult } from '../app/web/bis-results.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {}, listeners: {}, value: '',
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, action) { this.listeners[name] = action; },
    focus() { this.focused = true; }, select() { this.selected = true; } };
}
const all = root => [root, ...root.children.flatMap(all)];
const context = { el: node, plain: value => String(value ?? ''),
  skillIcon: skill => `/skills/${skill}.png`, itemIcon: name => `/items/${name}.png`,
  button: (label, action, cls) => ({ ...node('button', label, cls), action }) };
const fixture = () => ({ revision: 7, rules: { 'content.f2p': true }, tasks: [],
  members: [{ id: 'actor1', name: 'Player', runescapeName: 'DemoExplorer', unlocked: ['1'], completedTasks: [], taskStatus: {} },
    { id: 'reed', name: 'Reed', runescapeName: 'SecondActor1', unlocked: ['2', '3'], completedTasks: [], taskStatus: {} }] });
const result = (memberId = 'actor1', extra = {}) => ({ memberId, stateRevision: 7, tasks: [],
  currentBiS: { owned: { recordedObtained: [], recordedBest: { recommendations: [], loadouts: [] } } }, ...extra });
function harness() {
  let generation = 0, content;
  const menu = node('button'), calls = [], details = [];
  const c = { ...context, state: fixture(), memberId: 'actor1', definitions: {}, sandbox: { active: false },
    fullResult: result(), duoDetails: new Map(), loadIcons: async () => true,
    api: async path => { calls.push(path); return { stateRevision: 7, members: [] }; },
    ensureDuoDetails: async id => { details.push(id); const value = result(id); c.duoDetails.set(`7:${id}`, value); return value; },
    openDialog: (title, root) => { content = root; return ++generation; }, dialogCurrent: value => value === generation,
    $: () => menu, showError: error => { throw error; } };
  const view = createProfileView(c);
  return { c, view, calls, details, menu, close: () => generation++,
    get content() { return content; }, find: text => all(content).find(row => row.textContent === text) };
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };


test('recorded gear has icons and a display-only style switch', () => {
  const model = buildProfileModel(fixture(), 'actor1', result('actor1', { currentBiS: { owned: {
    recordedObtained: [{ name: 'Hand-recorded helm', addedByHand: true }], recordedBest: { recommendations: [
      { style: 'Melee', slot: 'head', equipment: { name: 'Hand-recorded helm' } },
      { style: 'Magic', slot: 'head', equipment: { name: 'Hat' } } ], loadouts: [] } } } }));
  const root = renderProfile(context, model), nodes = all(root);
  assert.ok(nodes.some(row => row.textContent === 'Hand-recorded helm'));
  assert.ok(nodes.some(row => row.tag === 'img' && row.src === '/items/Hand-recorded helm.png' && row.alt === ''));
  const style = nodes.find(row => row.tag === 'select'); style.value = 'Magic'; style.listeners.change();
  assert.ok(all(root).some(row => row.textContent === 'Hat'));
  assert.ok(!all(root).some(row => row.textContent === 'Hand-recorded helm'));
});

test('copy summary is bounded, Discord-safe and recovers when clipboard is unavailable', async () => {
  const state = fixture(); state.members[0].name = '@everyone **Player**';
  const model = buildProfileModel(state, 'actor1', result());
  const text = formatProfileSummary(model);
  assert.ok(text.length <= 2000); assert.ok(!text.includes('@everyone')); assert.ok(text.includes('@\u200beveryone'));
  assert.ok(text.includes('Total level: unknown')); assert.ok(text.includes('ticked in the picker'));
  const root = renderProfile(context, model), nodes = all(root);
  await nodes.find(row => row.textContent === 'Copy summary').action();
  const textarea = nodes.find(row => row.tag === 'textarea');
  assert.equal(textarea.readOnly, true); assert.equal(textarea.value, text); assert.equal(textarea.selected, true);
  assert.equal(nodes.find(row => row.className === 'list-copy-fallback').hidden, false);
});

test('Profile reuses cached results and dates across opens; player switch does not switch the map', async () => {
  const h = harness(); await h.view.open();
  assert.equal(h.details.length, 0);
  const chooser = all(h.content).find(row => row.attributes['aria-label'] === 'Profile player');
  chooser.value = 'reed'; await chooser.listeners.change();
  assert.ok(h.find('Reed')); assert.ok(h.find('2 chunks unlocked')); assert.equal(h.c.memberId, 'actor1');
  assert.deepEqual(h.details, ['reed']);
  chooser.value = 'actor1'; await chooser.listeners.change(); chooser.value = 'reed'; await chooser.listeners.change();
  assert.deepEqual(h.details, ['reed']);
  await h.view.open(); assert.equal(h.calls.length, 1);
  assert.ok(!h.calls.some(path => /command|runemetrics|evaluate/.test(path)));
});

test('delayed profile replies cannot replace a newer selection or a closed dialog', async () => {
  for (const reason of ['switched', 'closed', 'revision']) {
    const h = harness(); h.c.fullResult = null;
    const slow = deferred(); h.c.ensureDuoDetails = id => id === 'actor1' ? slow.promise : Promise.resolve(result(id));
    const opening = h.view.open();
    if (reason === 'closed') h.close();
    if (reason === 'revision') h.c.state.revision++;
    if (reason === 'switched') { const chooser = all(h.content).find(row => row.tag === 'select'); chooser.value = 'reed'; await chooser.listeners.change(); }
    slow.resolve(result()); await opening;
    if (reason === 'switched') assert.ok(h.find('Reed'));
    else assert.ok(!all(h.content).some(row => row.className === 'profile-content'));
    if (reason === 'revision') assert.ok(h.find('Refresh profile'));
  }
});

test('saved partner result caches are shared with BiS and stale caches are ignored', async () => {
  const h = harness(); h.c.fullResult = result('reed');
  assert.equal(await loadBiSMemberResult(h.c, 'reed'), h.c.fullResult); assert.deepEqual(h.details, []);
  h.c.fullResult.stateRevision = 6;
  await loadBiSMemberResult(h.c, 'reed'); assert.deepEqual(h.details, ['reed']);
});

test('load failure offers retry, and Sandbox never loads speculative profile facts', async () => {
  const h = harness(); h.c.fullResult = null; h.c.ensureDuoDetails = async () => { throw new Error('private path'); };
  await h.view.open(); assert.ok(h.find('Refresh profile')); assert.ok(!h.find('private path'));
  h.c.sandbox.active = true; await h.view.open(); assert.equal(h.content.textContent, 'Exit Sandbox to view saved player profiles.');
});

test('viewer with a saved list can read Profile before full gear details are retained', async () => {
  const h = harness(); h.c.fullResult = null; h.c.result = { memberId: 'actor1', stateRevision: 7, tasks: [] };
  h.c.ensureDuoDetails = async () => { throw Object.assign(new Error('Not retained'), { code: 'TASK_RESULTS_UNAVAILABLE' }); };
  await h.view.open();
  assert.ok(h.find('Player')); assert.ok(h.find('Completed tasks'));
  assert.ok(h.find('Recorded gear details will appear after a player opens Current BiS. Refresh to check again.'));
  assert.ok(h.find('Refresh profile')); assert.ok(!h.find('Current BiS →'));
  assert.ok(!all(h.content).some(row => row.textContent.includes('0 items recorded obtained')));
});

test('levels recorded without sync metadata are shown with an unknown date', () => {
  const state = fixture(); state.members[0].skillProgress = { Mining: { source: 'runemetrics', runescapeName: 'DemoExplorer', level: 60, xp: 1, fetchedAt: '2026-10-10T12:00:00Z' } };
  const nodes = all(renderProfile(context, buildProfileModel(state, 'actor1', result())));
  assert.ok(nodes.some(row => row.textContent === 'Recorded account levels · Last sync date unknown.'));
  assert.ok(!nodes.some(row => row.textContent.includes('No synced levels yet')));
});

test('an unused hand in the chosen setup cannot display a component from a tied alternative', () => {
  const model = buildProfileModel(fixture(), 'actor1', result('actor1', { currentBiS: { owned: {
    recordedObtained: [{ name: 'Two-handed sword' }, { name: 'Alternative shield' }],
    recordedBest: { recommendations: [{ style: 'Melee', slot: 'off-hand', equipment: { name: 'Alternative shield', slot: 'off-hand' } }],
      loadouts: [{ style: 'Melee', best: { mainHand: 'Two-handed sword', offHand: null, items: ['Two-handed sword'], alternatives: [{ items: ['Other sword', 'Alternative shield'] }] } }] },
  } } }));
  const nodes = all(renderProfile(context, model));
  assert.ok(nodes.some(row => row.textContent === 'Two-handed sword'));
  assert.ok(!nodes.some(row => row.textContent === 'Alternative shield'));
  assert.ok(nodes.some(row => row.textContent === 'Unused in this setup'));
});
