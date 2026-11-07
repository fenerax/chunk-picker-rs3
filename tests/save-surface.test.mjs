// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MEMBER_KEYS } from '../app/core/state.mjs';
import { pluginItemFiles } from '../app/storage/plugin-item-snapshot.mjs';
import { buildSaveCorpus, root, controlRoot } from './helpers/save-surface-corpus.mjs';
import { surface, assertDeclared, assertCorpusCoverage, observeSaveWrites, preservationDigest, assertNeverShrinks, jsonPaths, matchingEntry } from './helpers/save-surface.mjs';

test('every synthetic feature writes only declared save paths, envelope keys and data-dir files', async t => {
  const writes = observeSaveWrites(t, path.join(root, '.local', 'save-surface-tests'));
  const controlWrites = observeSaveWrites(t, controlRoot);
  const corpus = await buildSaveCorpus(t);
  assert.equal(corpus.snapshots.find(row => row.feature === 'plugin-testing-mode').state.provenance.pluginTestingMode['synthetic-one'], true);
  assert.deepEqual(corpus.snapshots.find(row => row.feature === 'plugin-testing-mode').state.provenance.pluginTestingWatermarks['synthetic-one'],
    { journals: { aaaaaaaaaaaaaaaa: 1 }, snapshots: ['0123456789abcdef'] });
  const documents = [];
  for (const snapshot of corpus.snapshots) {
    for (const document of snapshot.documents) { assertDeclared(document, snapshot.files); documents.push(document); }
    // Static-field extraction must not make the live state paths invisible.
    assertDeclared({ state: snapshot.state }, []);
    documents.push({ state: snapshot.state });
  }
  const files = [...new Set([...writes, ...corpus.snapshots.flatMap(snapshot => snapshot.files)])];
  assertDeclared({}, files);
  assertCorpusCoverage(documents, files);
  const controlPaths = corpus.controlDocuments.flatMap(document => [...jsonPaths(document)]);
  for (const actual of controlPaths) assert.ok(matchingEntry(actual, surface.operatorControl.json), `Undeclared operator-control path: /${actual.join('/')}`);
  for (const file of controlWrites) assert.ok(surface.operatorControl.files.some(entry => new RegExp(entry.pattern).test(file)), `Undeclared operator-control file: ${file}`);
  for (const entry of surface.operatorControl.json) assert.ok(controlPaths.some(actual => '/' + actual.join('/') === entry.path), entry.path);
  for (const entry of surface.operatorControl.files) assert.ok([...controlWrites].some(file => new RegExp(entry.pattern).test(file)), entry.path);
  assert.deepEqual(new Set(corpus.features), new Set(surface.features), 'Every declared feature has a real writer scenario');
  const observedMemberKeys = new Set(corpus.snapshots.flatMap(row => row.state.members.flatMap(member => Object.keys(member))));
  assert.deepEqual(observedMemberKeys, MEMBER_KEYS, 'Adding a member field requires synthetic save coverage');
  const source = await readFile(new URL('../app/core/state.mjs', import.meta.url), 'utf8');
  const declaration = /const STATE_KEYS = new Set\(\[([^\]]+)\]\)/.exec(source);
  assert.ok(declaration, 'Review state-key coverage if its declaration changes');
  assert.deepEqual(new Set(corpus.snapshots.flatMap(row => Object.keys(row.state))),
    new Set([...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1])), 'Every state root needs a feature scenario');
});

test('save declaration refuses new envelope, member, provenance and sidecar surfaces', () => {
  for (const document of [{ undeclaredEnvelope: 1 }, { state: { members: [{ undeclaredMember: 1 }] } },
    { state: { provenance: { undeclaredCarrier: { evidence: true } } } }]) {
    assert.throws(() => assertDeclared(document, []), /Undeclared save path/);
  }
  assert.throws(() => assertDeclared({}, ['plugin-undeclared.json']), /Undeclared data-dir file/);
  assert.throws(() => assertDeclared({}, ['plugin-undeclared.json.123.aaaaaaaaaaaaaaaa.tmp']), /Undeclared data-dir file/);
});

test('every manifest entry has a frozen policy and private drops have a roll-forward rule', () => {
  assert.match(surface.frozenRelease, /^[a-f0-9]{40}$/);
  for (const entry of [...surface.json, ...surface.files, ...surface.operatorControl.json, ...surface.operatorControl.files]) {
    assert.ok(['preserved', 'private-droppable', 'needs-lower', 'refused'].includes(entry.frozen), entry.path);
    if (entry.frozen === 'private-droppable') assert.ok(entry.rollForward?.trim(), entry.path);
    if (entry.opaque) assert.ok(entry.reason?.trim(), `Explain opaque boundary ${entry.path}`);
  }
  assert.equal(new Set(surface.json.map(entry => entry.path)).size, surface.json.length);
});

test('service checkpoint gameplay roots agree with the manifest without changing production behavior', async () => {
  const source = await readFile(new URL('../scripts/linux/service-checkpoint.mjs', import.meta.url), 'utf8');
  const declaration = /const gameplayRoots = new Set\(\[([^\]]+)\]\)/.exec(source);
  assert.ok(declaration, 'Review allowlist extraction if its declaration changes');
  const actual = [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  if (/\.\.\.pluginItemFiles\b/.test(declaration[1])) actual.push(...pluginItemFiles);
  const expected = [...new Set(surface.files.filter(entry => entry.checkpoint).map(entry => entry.root))];
  assert.deepEqual(actual.sort(), expected.sort());
});

test('preservation assertion catches equal-count replacement of plugin evidence and progress', () => {
  const state = { tasks: [{ id: 'synthetic-task' }], history: [], members: [{ id: 'synthetic-member', completedTasks: ['synthetic-task'],
    achievementProgress: { 'synthetic-task': { achievementId: 1 } } }] };
  const before = preservationDigest(state, { 'plugin-items.json': { handled: ['synthetic-task'] } });
  for (const changed of [
    { ...state, tasks: [{ id: 'replacement-task' }] },
    { ...state, members: [{ ...state.members[0], achievementProgress: { 'synthetic-task': { achievementId: 2 } } }] },
  ]) assert.throws(() => assertNeverShrinks(before, preservationDigest(changed, { 'plugin-items.json': { handled: ['synthetic-task'] } }), 'synthetic loss'), /shrank/);
  assert.throws(() => assertNeverShrinks(before, preservationDigest(state, { 'plugin-items.json': { handled: ['replacement-task'] } }), 'synthetic loss'), /shrank/);
});
