// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { validateOwnedCatalogueMetadata } from '../app/tasks/owned-catalogue-view.mjs';
import { fixture, options, first, world, now } from './helpers/owned-format2-fixture.mjs';

const metadata = { retiredIds: [first], names: { [first]: 'Current synthetic label' } };
const invalidMetadata = [null, false, [], 'metadata', { unknown: [] }, { retiredIds: {} },
  { retiredIds: first }, { retiredIds: [1] }, { retiredIds: [''] }, { retiredIds: [first, first] },
  { names: [] }, { names: null }, { names: { [first]: false } }, { names: { '': 'Synthetic label' } }];
const testWorld = { ...world, surface: new Set(['100', '101']) };
const settings = { world: testWorld, now, retention: false, completionCodec: false };
const transfer = { route: '/api/restore/preview', pickerId: 'synthetic-picker', world: testWorld,
  dataset: { datasetId: 'synthetic', datasetContractVersion: 1, digest: fixture().pin.dataset.digest, capabilities: {} } };
async function scratch(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-catalogue-metadata-')), stores = [];
  t.after(async () => { for (const store of stores) await store.close(); await rm(root, { recursive: true, force: true }); });
  const configuration = { ...settings, dataDir: path.join(root, 'group'), ownedFormat2: options(path.join(root, 'catalogue')) };
  return { root, configuration, async open(extra = {}) {
    const store = await openStore({ ...configuration, ...extra }); stores.push(store); return store;
  } };
}
const seeded = () => {
  const state = fixture().state;
  state.provenance = { dataset: fixture().pin.dataset, ownedCatalogue: structuredClone(metadata) };
  state.members[0].completedTasks = [first];
  return state;
};
const play = store => JSON.parse(store.getStateSnapshot({ view: 'play-v1' }).stateJSON);

test('owned catalogue metadata checks every field without changing valid input', () => {
  for (const value of [{}, { retiredIds: [] }, { names: {} }, metadata]) {
    const state = { provenance: { ownedCatalogue: structuredClone(value) } }, before = JSON.stringify(state);
    assert.doesNotThrow(() => validateOwnedCatalogueMetadata(state)); assert.equal(JSON.stringify(state), before);
  }
  for (const value of invalidMetadata) assert.throws(() => validateOwnedCatalogueMetadata({ provenance: { ownedCatalogue: value } }),
    { code: 'OWNED_CATALOGUE_INVALID', status: 422 });
});

test('format 1 leaves opaque catalogue provenance and historical replies unchanged', async t => {
  const f = await scratch(t), initialState = seeded();
  initialState.provenance.ownedCatalogue = { retiredIds: {} };
  const store = await f.open({ ownedFormat2: false, initialState });
  const before = await readFile(path.join(f.configuration.dataDir, 'state.json'));
  const snapshot = play(store);
  assert.deepEqual(snapshot, projectPlayState(store.getState()));
  assert.deepEqual(store.getState().provenance.ownedCatalogue, { retiredIds: {} });
  await store.close();
  const reopened = await f.open({ ownedFormat2: false });
  assert.deepEqual(await readFile(path.join(f.configuration.dataDir, 'state.json')), before);
  assert.deepEqual(play(reopened), snapshot);
});

for (const ownedCatalogueSemantics of [false, true]) for (const inlineRollPools of [false, true]) {
  test(`transfer reply, detached commands/conflicts and snapshots agree (semantics ${ownedCatalogueSemantics}, inline pools ${inlineRollPools})`, async t => {
    const f = await scratch(t), store = await f.open({ initialState: seeded(), ownedCatalogueSemantics });
    const backup = await store.backup(), historical = structuredClone(backup.state.tasks);
    const preview = await store.prepareTransfer(serialize({ backup }), { ...transfer, responseView: 'play-v1', inlineRollPools });
    const applied = await store.applyTransfer(preview.ticket, store.getInfo().revision);
    const reply = JSON.parse(Buffer.from(applied.reply.bytes ?? applied.reply.stateBytes));
    const expected = play(store), replyState = inlineRollPools ? reply : reply.state;
    assert.deepEqual(replyState, expected);
    const row = expected.tasks.find(task => task.id === first);
    assert.equal(row.label, ownedCatalogueSemantics ? metadata.names[first] : historical.find(task => task.id === first).label);
    assert.equal(row.hidden, ownedCatalogueSemantics ? true : undefined);
    assert.equal(row.obligation, ownedCatalogueSemantics ? false : undefined);
    const project = state => projectPlayState(state, { ownedCatalogueSemantics });
    assert.deepEqual(project(applied.state), expected);
    const revision = store.getInfo().revision;
    const command = { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic detached reply' };
    const detached = await store.command(command, revision);
    assert.deepEqual(project(detached), play(store));
    assert.deepEqual(project(store.getState()), play(store));
    await assert.rejects(store.command(command, revision), error => {
      assert.equal(error.code, 'REVISION_CONFLICT'); assert.deepEqual(project(error.state), play(store)); return true;
    });
    assert.deepEqual(store.getState().tasks, historical);
    assert.deepEqual((await store.backup()).state.provenance.ownedCatalogue, metadata);
    const bytes = await readFile(path.join(f.configuration.dataDir, 'state.json'));
    const finalSnapshot = play(store);
    await store.close();
    const reopened = await f.open({ ownedCatalogueSemantics });
    assert.deepEqual(play(reopened), finalSnapshot);
    assert.deepEqual(await readFile(path.join(f.configuration.dataDir, 'state.json')), bytes);
  });
}

test('owned load refuses malformed saved metadata before preparation and preserves its bytes', async t => {
  const f = await scratch(t), store = await f.open({ initialState: seeded() }); await store.close();
  const file = path.join(f.configuration.dataDir, 'state.json'), document = JSON.parse(await readFile(file));
  document.state.provenance.ownedCatalogue = { retiredIds: {} };
  const bytes = Buffer.from(JSON.stringify(document)); await writeFile(file, bytes);
  let prepared = false;
  await assert.rejects(f.open({ prepareState(state) { prepared = true; delete state.provenance.ownedCatalogue; return state; } }),
    error => /Cannot load the saved state: Invalid provenance\.ownedCatalogue\.retiredIds/.test(error.message)
      && error.cause.code === 'OWNED_CATALOGUE_INVALID');
  assert.equal(prepared, false); assert.deepEqual(await readFile(file), bytes);
});

test('owned replacement rejects every malformed shape before preparation/publication and retains replies', async t => {
  const f = await scratch(t), store = await f.open({ initialState: seeded(), ownedCatalogueSemantics: true });
  const file = path.join(f.configuration.dataDir, 'state.json'), before = await readFile(file), snapshot = play(store);
  for (const value of invalidMetadata) {
    const backup = await store.backup(); backup.state.provenance.ownedCatalogue = value;
    await assert.rejects(store.previewReplacement(backup), /Invalid provenance\.ownedCatalogue/);
    await assert.rejects(store.replace(backup, store.getInfo().revision), /Invalid provenance\.ownedCatalogue/);
  }
  assert.deepEqual(await readFile(file), before); assert.deepEqual(play(store), snapshot);
});

test('owned preparation output cannot introduce malformed metadata at a command publication', async t => {
  const f = await scratch(t);
  const prepareState = (state, { operation }) => {
    if (operation === 'command') state.provenance.ownedCatalogue = { names: { [first]: [] } };
    return state;
  };
  const store = await f.open({ initialState: seeded(), ownedCatalogueSemantics: true, prepareState });
  const before = await readFile(path.join(f.configuration.dataDir, 'state.json')), snapshot = play(store);
  await assert.rejects(store.command({ type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic refused' }, store.getInfo().revision),
    { code: 'OWNED_CATALOGUE_INVALID' });
  assert.deepEqual(await readFile(path.join(f.configuration.dataDir, 'state.json')), before); assert.deepEqual(play(store), snapshot);
});
