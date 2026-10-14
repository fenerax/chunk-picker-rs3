import { readScreenGraph, screenFunctionSources, screenFunctionSource } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { supportsDatasetFeature } from '../app/web/dataset-features.mjs';

// Exercise the shipped bootstrap before it creates the map. No server or saves.
const graph = await readScreenGraph(), main = screenFunctionSources(graph);
const start = main.indexOf('async function start()');
const begin = main.indexOf('  const invites = createInvites(', start);
const end = main.indexOf('  map = new ChunkMap(', begin);
assert.ok(start >= 0 && begin > start && end > begin);
const bootstrap = main.slice(begin, end);
const members = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];

test('feedback context stays usable before map data and personal settings have loaded', () => {
  const begin = main.indexOf('const feedbackPanel = createFeedback(', start);
  const end = main.indexOf("$('feedback-open')?.addEventListener", begin);
  assert.ok(begin > start && end > begin);
  const context = vm.createContext({ state: undefined, feedbackSessionReady: false, sessionAdmin: true,
    api() {}, el() {}, button() {}, input() {}, field() {}, openDialog() {}, dialogCurrent() {}, notice() {}, $: () => ({}),
    streamSafe: {}, createFeedback: options => options, canWrite: () => true,
    advanced() { throw Error('Personal settings are not loaded'); }, member() { throw Error('Map data is not loaded'); }, innerWidth: 390, innerHeight: 844 });
  const feedback = vm.runInContext(`(() => { ${main.slice(begin, end)} return feedbackPanel; })()`, context);
  assert.equal(feedback.advanced(), false); assert.equal(feedback.context().screen, '390x844');
  assert.deepEqual(Object.keys(feedback.context()), ['screen']); assert.equal(feedback.isReadOnly(), true);
});

function launch({ remembered = null, session = { admin: false, memberId: 'reed' }, storageBlocked = false, loadSession = async () => session } = {}) {
  const errors = [], controls = new Map(), overlays = { opens: 0 };
  const context = vm.createContext({
    backupStatus: { start() {} },
    streamSafe: { sessionReady() {}, refreshFromStorage() {} }, feedbackPanel: { setSession() {}, start() {}, pause() {}, stop() {} },
    feedbackSessionReady: false,
    state: undefined, memberId: undefined, sessionAdmin: false, sessionMember: null, sessionReadOnly:false, viewerPreferences:{}, document:{documentElement:{dataset:{}}},
    definitions: undefined, definitionsAreFull: false, world: undefined, registry: undefined,
    owners: members.map(owner => ({ ...owner })),
    supportsFeature: feature => supportsDatasetFeature({ capabilities: { features: {} } }, feature),
    api: async route => route === '/api/state' ? { state: { members } } : route === '/api/rules' ? { definitions: [] } : {},
    createInvites: () => ({ loadSession }),
    createOverlayPanel: () => ({ open: async () => { overlays.opens++; } }),
    $: id => { if (!controls.has(id)) controls.set(id, { addEventListener(type, callback) { this[type] = callback; }, append() {} }); return controls.get(id); }, el: () => ({ setAttribute() {} }), button() {}, input() {}, field() {}, openDialog() {}, dialogCurrent() {},
    loadTerrainManifest: async () => null, loadArtStatus: async () => null, installPictureFallbacks() {}, observeArtStatus: listener => listener(null), hydrateDisplayWorld: data => data, createRuleRegistryFromDefinitions: rules => rules,
    showError: error => errors.push(error),
    localStorage: { getItem: key => { if (key === 'picker.viewer-preferences') return null; assert.equal(key, 'duo-member'); if (storageBlocked) throw new Error('Blocked'); return remembered; } },
  });
  vm.runInContext(screenFunctionSource(graph,'applySession'),context);
  const pending = vm.runInContext(`(async () => { ${bootstrap}\nreturn { selected: memberId, admin: sessionAdmin, linked: sessionMember }; })()`, context);
  return { context, pending, errors, controls, overlays };
}

test('OBS link management is visible and opens only for an administrator session', async () => {
  for (const session of [{ admin: false }, { admin: false, readOnly: true }, { admin: true }]) {
    const h = launch({ session }); await h.pending;
    const entry = h.controls.get('overlays-open');
    assert.equal(entry.hidden, !session.admin);
    entry.click(); await new Promise(done => setImmediate(done));
    assert.equal(h.overlays.opens, session.admin ? 1 : 0);
  }
});

test('fresh player-linked invite opens its own map after waiting for the viewer session', async () => {
  let resolve;
  const h = launch({ loadSession: () => new Promise(done => { resolve = done; }) });
  await new Promise(done => setImmediate(done));
  assert.equal(h.context.memberId, undefined, 'a quick state response cannot select the first player early');
  assert.equal(h.context.feedbackSessionReady, false, 'feedback controls wait for session permissions');
  resolve({ admin: false, memberId: 'reed' });
  assert.equal((await h.pending).selected, 'reed');
  assert.equal(h.context.feedbackSessionReady, true);
});

test('valid remembered selection takes precedence over the linked player', async () => {
  assert.equal((await launch({ remembered: 'actor1' }).pending).selected, 'actor1');
  assert.equal((await launch({ remembered: 'reed' }).pending).selected, 'reed');
});

test('stale or blocked browser preferences fall back to the linked player', async () => {
  assert.equal((await launch({ remembered: 'removed-player' }).pending).selected, 'reed');
  assert.equal((await launch({ storageBlocked: true }).pending).selected, 'reed');
});

test('private master and unlinked invitations retain the first-player default and remembered choice', async () => {
  for (const session of [{ kind: 'master', admin: true, memberId: null }, { kind: 'invite', admin: false, memberId: null }, { kind: 'invite', memberId: 'removed-player' }]) {
    assert.equal((await launch({ session }).pending).selected, 'actor1');
    assert.equal((await launch({ session, remembered: 'reed' }).pending).selected, 'reed');
  }
});

test('administrator invites linked to a player use that player default too', async () => {
  const result = await launch({ session: { kind: 'invite', admin: true, memberId: 'reed' } }).pending;
  assert.equal(result.selected, 'reed');
  assert.equal(result.admin, true);
});

test('failed session lookup stops startup before exposing any editable map', async () => {
  const error = new Error('Session request failed');
  const h = launch({ remembered: 'reed', loadSession: async () => { throw error; } });
  await assert.rejects(h.pending,error);
  assert.equal(h.context.memberId,undefined);
});

test('view-only invitation sets permissions before choosing a remembered map', async () => {
  const h=launch({remembered:'reed',session:{readOnly:true,capabilities:{canWrite:false},admin:false}});
  assert.equal((await h.pending).selected,'reed'); assert.equal(h.context.sessionReadOnly,true); assert.equal(h.context.sessionAdmin,false);
});
