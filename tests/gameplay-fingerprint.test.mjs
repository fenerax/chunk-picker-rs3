import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';

function fixture() {
  return { schemaVersion: 1, revision: 3, rules: { enabled: true }, members: [{ id: 'synthetic', name: 'Synthetic',
    completedTasks: ['synthetic-task'], taskStatus: { 'synthetic-task': { favorite: false } }, preferences: { theme: 'dark' } }],
  tasks: [{ id: 'synthetic-task', label: 'Synthetic task', category: 'custom' }],
  identityRegistry: { schemaVersion: 1, entries: {}, aliases: { old: 'synthetic-task' }, unresolved: [] },
  legacy: { maps: { synthetic: { exact: 'Preserved evidence' } } },
  provenance: { source: 'synthetic', exactArchive: { original: true }, historyArchive: ['history-a'] },
  history: [{ revision: 3, type: 'synthetic-history' }] };
}

test('fingerprints omit revision, history, progress snapshots, personal preferences, map journals and history retention references', () => {
  const fingerprint = createGameplayFingerprint(), original = fixture(), expected = fingerprint(original);
  const displayed = structuredClone(original);
  displayed.revision++;
  displayed.history.push({ revision: 4, type: 'display-preference' });
  displayed.progressSnapshots = { rows: [[0, 1, 2]] };
  displayed.members[0].preferences = { theme: 'light', futureDisplayControl: false };
  displayed.members[0].journal = 'Map-wide plans do not change tasks.';
  displayed.provenance.historyArchive = ['history-b', 'history-c'];
  assert.equal(fingerprint(displayed), expected);
  assert.equal(createGameplayFingerprint()(structuredClone(original)), expected);
  assert.match(expected, /^[a-f0-9]{64}$/);
  for (const provenance of [undefined, {}, { historyArchive: [] }, { historyArchive: ['different'] }]) {
    const state = { members: [], ...(provenance === undefined ? {} : { provenance }) };
    assert.equal(fingerprint(state), fingerprint({ members: [] }));
  }
});

test('every retained gameplay field and arbitrary member data conservatively invalidates the fingerprint', () => {
  const fingerprint = createGameplayFingerprint(), original = fixture(), expected = fingerprint(original);
  const mutations = [
    state => { state.schemaVersion++; },
    state => { state.rules.enabled = false; },
    state => { state.rules.preferences = { theme: 'nested gameplay rule' }; },
    state => { state.members[0].name = 'Changed ownership'; },
    state => { state.members[0].completedTasks = []; },
    state => { state.members[0].taskStatus['synthetic-task'].favorite = true; },
    state => { state.members[0].unknownProgress = { preferences: 'Retained nested member field' }; },
    state => { state.members.push({ id: 'second', preferences: {} }); },
    state => { state.tasks[0].label = 'Renamed task'; },
    state => { state.identityRegistry.aliases.old = 'different-task'; },
    state => { state.legacy.maps.synthetic.exact = 'Changed evidence'; },
    state => { state.provenance.exactArchive.original = false; },
    state => { state.provenance.newEvidence = { exact: true }; },
    state => { state.unknownScalar = false; },
    state => { state.unknownScalar = null; },
    state => { state.unknownObject = { history: 'Retained outside the top-level history field' }; },
    state => { delete state.legacy; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.notEqual(fingerprint(changed), expected, mutate.toString());
  }
  const first = { members: [], unfamiliar: 'a', other: 'bc' }, second = { members: [], unfamiliar: 'ab', other: 'c' };
  assert.notEqual(fingerprint(first), fingerprint(second), 'Field boundaries must remain unambiguous');
  assert.notEqual(fingerprint({ members: [], unfamiliar: false }), fingerprint({ members: [], unfamiliar: 0 }));
});

test('new private commands reuse static JSON digests without serializing or hashing their raw trees again', () => {
  const fingerprint = createGameplayFingerprint(), original = fixture(), marker = 'synthetic-static-digest-marker';
  original.tasks[0].label = marker;
  original.identityRegistry.unresolved = [marker];
  original.legacy.maps.synthetic.exact = marker;
  original.provenance.exactArchive.original = marker;
  const stringify = JSON.stringify, hashPrototype = Object.getPrototypeOf(createHash('sha256')), update = hashPrototype.update;
  let staticSerializations = 0, staticHashUpdates = 0;
  JSON.stringify = (...args) => {
    const bytes = stringify(...args);
    if (bytes?.includes(marker)) staticSerializations++;
    return bytes;
  };
  hashPrototype.update = function (bytes, ...args) {
    if (typeof bytes === 'string' && bytes.includes(marker)) staticHashUpdates++;
    return update.call(this, bytes, ...args);
  };
  try {
    const first = fingerprint(original);
    assert.equal(staticSerializations, 4);
    assert.equal(staticHashUpdates, 4);
    const displayed = { ...original, revision: 4, history: [...original.history, { type: 'display' }],
      members: original.members.map(member => ({ ...member, preferences: { theme: 'light' } })) };
    assert.equal(fingerprint(displayed), first);
    const changed = { ...displayed, revision: 5, rules: { enabled: false },
      members: displayed.members.map(member => ({ ...member, taskStatus: { 'synthetic-task': { favorite: true } } })) };
    assert.notEqual(fingerprint(changed), first);
    assert.equal(staticSerializations, 4, 'Changed commands must not serialize unchanged static trees');
    assert.equal(staticHashUpdates, 4, 'Changed commands must not hash unchanged static tree bytes');
  } finally {
    JSON.stringify = stringify;
    hashPrototype.update = update;
  }
});

test('replacement immutable trees and provenance changes are rehashed while history-only provenance remains equivalent', () => {
  const fingerprint = createGameplayFingerprint(), original = fixture(), first = fingerprint(original);
  const retained = { ...original, provenance: { ...original.provenance, historyArchive: ['new-retention-reference'] } };
  assert.equal(fingerprint(retained), first);
  const evidence = { ...retained, provenance: { ...retained.provenance, exactArchive: { original: false } } };
  assert.notEqual(fingerprint(evidence), first);
  const identities = { ...original, identityRegistry: { ...original.identityRegistry, aliases: { old: 'new-task' } } };
  assert.notEqual(fingerprint(identities), first);
  const tasks = { ...original, tasks: [{ ...original.tasks[0], label: 'Replacement task' }] };
  assert.notEqual(fingerprint(tasks), first);
  assert.throws(() => fingerprint(null), TypeError);
});
