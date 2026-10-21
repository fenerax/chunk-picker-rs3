import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { entityId } from '../app/tasks/identity.mjs';
import { readStateCopy, flattenChunkContents, diffChunkContents, summarizeTask, diffTasks, renderResourcePreview, buildResourcePreview, buildObjectCanonicalMap } from '../scripts/preview-resource-contents.mjs';

async function fixtureDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-resource-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const syntheticState = () => createGroupState([{ id: 'fixture-member', name: 'Synthetic member', unlocked: ['7495'], selected: ['7751'], pendingRoll: ['8007'] }]);

async function staticFixture(t) {
  const directory = await fixtureDirectory(t);
  const state = syntheticState();
  state.tasks = [{ id: 'custom:fixture-task', label: 'Fixture task', category: 'custom' }];
  state.legacy = { fixture: true };
  const document = exportBackup(state), fields = {};
  await mkdir(path.join(directory, 'static'));
  for (const key of ['tasks', 'legacy']) {
    const bytes = Buffer.from(JSON.stringify(state[key]));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const id = `static-${sha256}.json.gz`;
    await writeFile(path.join(directory, 'static', id), gzipSync(bytes));
    fields[key] = { id, sha256 };
    delete document.state[key];
  }
  document.storage = { schemaVersion: 1, fields };
  const file = path.join(directory, 'state.json');
  await writeFile(file, JSON.stringify(document));
  return { directory, file, state, document };
}

test('explicit copied state hydration reads verified sidecars without changing files or opening a store', async t => {
  const fixture = await staticFixture(t);
  const before = await readFile(fixture.file);
  const beforeFiles = await readdir(fixture.directory);
  const loaded = await readStateCopy(fixture.file);
  assert.deepEqual(loaded.state, fixture.state);
  assert.equal(loaded.sourceSha256, createHash('sha256').update(before).digest('hex'));
  await loaded.verifyUnchanged();
  assert.deepEqual(await readFile(fixture.file), before);
  assert.deepEqual(await readdir(fixture.directory), beforeFiles);
  assert(!beforeFiles.includes('store.lock'));
});

test('raw synthetic state and portable backup load without any implicit static or store reads', async t => {
  const directory = await fixtureDirectory(t), state = syntheticState();
  for (const [name, value] of [['raw.json', state], ['portable.json', exportBackup(state)]]) {
    const file = path.join(directory, name);
    await writeFile(file, JSON.stringify(value));
    assert.deepEqual((await readStateCopy(file)).state, state);
  }
  assert.deepEqual((await readdir(directory)).sort(), ['portable.json', 'raw.json']);
  await assert.rejects(() => readStateCopy(), /explicit/);
  await assert.rejects(() => readStateCopy(path.join(directory, 'missing.json')), /ENOENT/);
});

test('copy dependencies fail closed for checksum errors, traversal, duplicated fields and missing files', async t => {
  const fixture = await staticFixture(t);
  const reference = fixture.document.storage.fields.tasks;
  await writeFile(path.join(fixture.directory, 'static', reference.id), gzipSync(Buffer.from('[]')));
  await assert.rejects(() => readStateCopy(fixture.file), /checksum mismatch/);
  reference.id = '../outside.json.gz';
  await writeFile(fixture.file, JSON.stringify(fixture.document));
  await assert.rejects(() => readStateCopy(fixture.file), /Invalid static field reference/);
  reference.id = `static-${reference.sha256}.json.gz`;
  fixture.document.state.tasks = [];
  await writeFile(fixture.file, JSON.stringify(fixture.document));
  await assert.rejects(() => readStateCopy(fixture.file), /Invalid static field reference/);
  delete fixture.document.state.tasks;
  reference.sha256 = '0'.repeat(64); reference.id = `static-${reference.sha256}.json.gz`;
  await writeFile(fixture.file, JSON.stringify(fixture.document));
  await assert.rejects(() => readStateCopy(fixture.file), /ENOENT/);
});

test('unchanged guard detects sidecar changes after hydration', async t => {
  const fixture = await staticFixture(t), loaded = await readStateCopy(fixture.file);
  await writeFile(path.join(fixture.directory, 'static', fixture.document.storage.fields.legacy.id), 'changed');
  await assert.rejects(() => loaded.verifyUnchanged(), /changed during preview/);
});

test('the reader rejects a synthetic live-directory path before reading the save', async t => {
  const directory = await fixtureDirectory(t), live = path.join(directory, '.local', 'duo');
  await mkdir(live, { recursive: true });
  const file = path.join(live, 'state.json');
  await writeFile(file, 'This synthetic sentinel must not be parsed.');
  await assert.rejects(() => readStateCopy(file), /Use a copied state/);
});

test('the reader rejects a static directory junction pointing to synthetic live-directory sidecars', async t => {
  const fixture = await staticFixture(t), copy = await fixtureDirectory(t);
  const liveStatic = path.join(fixture.directory, '.local', 'duo', 'static');
  await mkdir(liveStatic, { recursive: true });
  await symlink(liveStatic, path.join(copy, 'static'), process.platform === 'win32' ? 'junction' : 'dir');
  const file = path.join(copy, 'state.json');
  await writeFile(file, JSON.stringify(fixture.document));
  await assert.rejects(() => readStateCopy(file), /copied static\/ dependencies outside \.local\/duo/);
});

test('the reader rejects static directory junctions to other directories too', async t => {
  const fixture = await staticFixture(t), copy = await fixtureDirectory(t);
  await symlink(path.join(fixture.directory, 'static'), path.join(copy, 'static'), process.platform === 'win32' ? 'junction' : 'dir');
  const file = path.join(copy, 'state.json');
  await writeFile(file, JSON.stringify(fixture.document));
  await assert.rejects(() => readStateCopy(file), /linked static directories/);
});

test('flattening keeps canonical object identity separate from resource classification and location', () => {
  const record = { Object: { Furnace: 1 }, Sections: { 1: { Object: { Tree: 3 }, ObjectProvenance: { Tree: { source: 'retained-only' } } } },
    CacheComponents: { '7495-1000001': { Object: { Tree: 2 }, ObjectProvenance: { Tree: { source: 'game-data', classKey: 'tree.normal' } } } } };
  const before = structuredClone(record), rows = flattenChunkContents(record, '7495');
  const tree = rows.find(row => row.id === entityId('object', 'Tree'));
  assert.deepEqual(tree.locations, ['7495-1', '7495-1000001']);
  assert.deepEqual(tree.classifications, [{ source: 'game-data', classKey: 'tree.normal' }, { source: 'retained-only', classKey: null }]);
  assert.deepEqual(record, before);
});

test('contents diff distinguishes additions, removals, reclassification and component/quantity changes', () => {
  const before = flattenChunkContents({ Object: { Tree: 2, Furnace: 1 } }, '7495');
  const after = flattenChunkContents({ CacheComponents: { '7495-1000001': { Object: { Tree: 3, Anvil: 1 }, ObjectProvenance: {
    Tree: { source: 'game-data', classKey: 'tree.normal' }, Anvil: { source: 'game-data', classKey: 'facility.anvil' } } } } }, '7495');
  const diff = diffChunkContents(before, after);
  assert.deepEqual(diff.added.map(row => row.label), ['Anvil']);
  assert.deepEqual(diff.removed.map(row => row.label), ['Furnace']);
  assert.deepEqual(diff.reclassified.map(row => row.label), ['Tree']);
  assert.deepEqual(diff.changed.map(row => row.label), ['Tree']);
  assert.deepEqual(diffChunkContents(after, after), { added: [], removed: [], reclassified: [], changed: [] });
});

test('shared border placements retain a unique placement inventory and quantities per component', () => {
  const provenance = { Tree: { source: 'game-data', classKey: 'tree.normal', placements: ['placement-1', 'placement-1'] } };
  const [row] = flattenChunkContents({ CacheComponents: {
    '11569-1000001': { Object: { Tree: 1 }, ObjectProvenance: provenance },
    '11569-1000002': { Object: { Tree: 1 }, ObjectProvenance: provenance },
  } }, '11569');
  assert.deepEqual(row.placementIds, ['placement-1']);
  assert.equal(row.quantities.length, 2);
  assert(row.quantities.every(value => value.quantity === 1 && value.placementIds.length === 1));
  assert.equal(row.totalQuantity, undefined, 'Do not double count a placement touching two components.');
});

test('reviewed single-class aliases preserve canonical identity and original labels across a rename', () => {
  const canonical = buildObjectCanonicalMap({ classes: [{ key: 'tree:oak', name: 'Oak tree' }] }, { mappings: [
    { name: 'Oak', classKeys: ['tree:oak'] }, { name: 'Oak tree', classKeys: ['tree:oak'] },
    { name: 'Oak[+]', classKeys: ['tree:oak'] }, { name: 'Generic tree', classKeys: ['tree:oak', 'tree:normal'] },
    { name: 'Unreviewed tree', classKeys: ['missing'] },
    { name: 'Partial group', classKeys: ['tree:oak'], unmatchedChildren: ['Unknown child'] },
  ] });
  assert.deepEqual([...canonical.keys()], ['Oak', 'Oak tree']);
  const before = flattenChunkContents({ Object: { Oak: 2 } }, '11569', canonical);
  const after = flattenChunkContents({ Object: { 'Oak tree': 2 } }, '11569', canonical);
  const result = diffChunkContents(before, after);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.changed, []);
  assert.equal(result.reclassified[0].id, entityId('object', 'Oak tree'));
  assert.deepEqual(result.reclassified[0].beforeLabels, ['Oak']);
  assert.deepEqual(result.reclassified[0].afterLabels, ['Oak tree']);
  assert.equal(flattenChunkContents({ Object: { 'Oak[+]': 2 } }, '11569', canonical)[0].id, entityId('object', 'Oak[+]'));
});

function integratedFixture() {
  const definitions = { chunks: {
    '11569': { Nickname: 'Synthetic owned chunk', Sections: { 1: { Object: { 'Fixture tree': 2 } } } },
    '11825': { Nickname: 'Synthetic selected chunk', Sections: { 2: {} } },
    '12081': { Nickname: 'Synthetic pending chunk', Sections: { 1: {} } },
  }, walkableChunks: ['11569', '11825', '12081'], walkableChunksF2P: ['11569', '11825', '12081'],
    sections: { '11569': { 1: [] }, '11825': { 2: [] }, '12081': { 1: [] } },
    challenges: {
      Woodcutting: { 'Harvest fixture tree': { PickerId: 'rs3:task:fixture-tree', Level: 1, Objects: ['Fixture tree'] } },
      Smithing: { 'Use fixture furnace': { PickerId: 'rs3:task:fixture-furnace', Objects: ['Fixture furnace'] } },
      Crafting: { 'Use selected facility': { PickerId: 'rs3:task:fixture-selected', Objects: ['Fixture selected facility'] } },
      Cooking: { 'Use pending facility': { PickerId: 'rs3:task:fixture-pending', Objects: ['Fixture pending facility'] } },
    } };
  const classes = [
    { key: 'fixture.tree', name: 'Fixture tree' }, { key: 'fixture.furnace', name: 'Fixture furnace' },
    { key: 'fixture.selected', name: 'Fixture selected facility' }, { key: 'fixture.pending', name: 'Fixture pending facility' },
  ];
  const options = { reviewedOverlays: false, resourceCatalogue: { coverage: ['11569', '11825', '12081'].map(chunkId => ({ chunkId, status: 'decoded' })), classes,
    placements: classes.map((row, index) => ({ id: `synthetic-placement-${index}`, chunkId: index < 2 ? '11569' : index === 2 ? '11825' : '12081',
      objectId: 900000 + index, classKey: row.key, components: [index < 2 ? '11569-1000001' : index === 2 ? '11825-1000001' : '12081-1000001'], multiplicity: index === 0 ? 3 : 1 })),
    provenance: { fixture: true } }, resourceSelectors: { mappings: classes.map(row => ({ name: row.name, classKey: row.key })) } };
  const state = createGroupState([{ id: 'fixture-member', name: 'Synthetic member', unlocked: ['11569'], selected: ['11825'], pendingRoll: ['12081'], sectionOverrides: { '11569-1': true } }]);
  state.rules['content.f2p'] = false;
  return { definitions, state, options };
}

test('integrated preview uses identical walking topology and reports selected/pending contents without unlocking their tasks', () => {
  const { definitions, state, options } = integratedFixture(), original = structuredClone(state);
  const report = buildResourcePreview(definitions, state, options), member = report.members[0];
  assert.equal(report.cacheWalking, true);
  assert.equal(report.metadataCorrections, true);
  assert.equal(member.counts.lostSourceTasks, member.regressions.sourceChunkLosses.length);
  assert.equal(member.counts.availabilityGains, member.regressions.availabilityChanges.filter(row => row.becameAvailable).length);
  assert.deepEqual(member.chunks.map(row => [row.id, row.scopes]), [['11569', ['unlocked']], ['11825', ['selected']], ['12081', ['pendingRoll']]]);
  const owned = member.chunks.find(row => row.id === '11569');
  assert(owned.added.some(row => row.label === 'Fixture furnace'));
  assert(owned.reclassified.some(row => row.label === 'Fixture tree'));
  assert(member.chunks.find(row => row.id === '11825').added.some(row => row.label === 'Fixture selected facility'));
  assert(member.chunks.find(row => row.id === '12081').added.some(row => row.label === 'Fixture pending facility'));
  assert(member.tasks.some(row => row.id === 'rs3:task:fixture-furnace' && row.becameAvailable));
  const tree = member.tasks.find(row => row.id === 'rs3:task:fixture-tree');
  assert(tree.sourcesChanged);
  assert.deepEqual(tree.before.sourceChunks, ['11569']);
  assert.deepEqual(tree.after.sourceChunks, ['11569']);
  assert(!member.tasks.some(row => ['rs3:task:fixture-selected', 'rs3:task:fixture-pending'].includes(row.id)));
  assert.deepEqual(state, original);
  assert.deepEqual(buildResourcePreview(definitions, state, options), report);
});

test('integrated reviewed Oak alias projects to Oak tree without adding or removing that resource', () => {
  const { definitions, state, options } = integratedFixture();
  definitions.chunks['11569'].Sections = { 2: { Object: { Oak: 2 } } };
  definitions.sections['11569'] = { 2: [] };
  state.members[0].sectionOverrides = { '11569-2': true };
  options.resourceCatalogue.classes[0] = { key: 'tree:oak', name: 'Oak tree' };
  options.resourceCatalogue.placements[0].classKey = 'tree:oak';
  options.resourceCatalogue.placements[0].components = ['11569-1000005'];
  options.resourceSelectors.mappings[0] = { name: 'Oak', classKeys: ['tree:oak'] };
  const chunk = buildResourcePreview(definitions, state, options).members[0].chunks.find(row => row.id === '11569');
  assert(!chunk.added.some(row => row.id === entityId('object', 'Oak tree')));
  assert(!chunk.removed.some(row => row.id === entityId('object', 'Oak tree')));
  const oak = chunk.reclassified.find(row => row.id === entityId('object', 'Oak tree'));
  assert.deepEqual(oak.beforeLabels, ['Oak']);
  assert.deepEqual(oak.afterLabels, ['Oak tree']);
  assert.equal(oak.before[0].source, 'retained-only');
  assert.equal(oak.after[0].source, 'game-data');
});

test('task diff uses canonical identity and full source locations, even when base chunk stays the same', () => {
  const permanent = 'rs3:task:fixture-permanent', legacy = 'fixture-old-id';
  const registry = { entries: { [permanent]: { id: permanent, category: 'Woodcutting' } }, aliases: { [legacy]: permanent } };
  const prior = summarizeTask({ id: legacy, label: 'Old display', category: 'Woodcutting', status: 'available',
    sources: [{ kind: 'objects', name: 'Tree', locations: ['7495-1', '7495-1'] }] }, registry);
  const next = summarizeTask({ id: permanent, label: 'New display', category: 'Woodcutting', status: 'available',
    sources: [{ kind: 'objects', name: 'Tree', locations: ['7495-1000001'] }] }, registry);
  const [change] = diffTasks([prior], [next]);
  assert.equal(change.id, permanent);
  assert.equal(change.sourcesChanged, true);
  assert.equal(change.becameAvailable, false);
  assert.deepEqual(change.addedSourceChunks, []);
  assert.equal(change.after.sources[0].id, entityId('object', 'Tree'));
  assert.deepEqual(diffTasks([next], [{ ...next, label: 'Another display name' }]), []);
});

test('task availability gains and losses include tasks absent from one catalogue', () => {
  const row = (id, available, chunks = []) => ({ id, label: id, status: available ? 'available' : 'blocked', available, sources: [], sourceChunks: chunks });
  const changes = diffTasks([row('lost', true), row('gained', false)], [row('gained', true), row('new', true)]);
  assert.deepEqual(changes.filter(row => row.becameAvailable).map(row => row.id), ['gained', 'new']);
  assert.deepEqual(changes.filter(row => row.becameUnavailable).map(row => row.id), ['lost']);
});

test('readable rendering enumerates unchanged pending/selected chunks and all task changes deterministically', () => {
  const report = { taskCoverage: 'Synthetic fixture coverage.', members: [{ id: 'fixture', counts: { beforeAvailable: 0, afterAvailable: 1 },
    chunks: [{ id: '7495', label: 'Fixture', scopes: ['selected', 'pendingRoll'], added: [], removed: [], reclassified: [], changed: [] }],
    tasks: diffTasks([], [{ id: 'rs3:task:fixture', label: 'Gather tree', available: true, sources: [], sourceChunks: [] }]) }] };
  const output = renderResourcePreview(report);
  assert.match(output, /7495 Fixture \(selected, pendingRoll\)/);
  assert.match(output, /No resource or facility changes/);
  assert.match(output, /Gather tree \[rs3:task:fixture\]: became available/);
  assert.equal(renderResourcePreview(report), output);
});

test('CLI requires an explicit state path and exits without creating state or contacting a server', async t => {
  const directory = await fixtureDirectory(t);
  const result = spawnSync(process.execPath, [path.resolve('scripts/preview-resource-contents.mjs')], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--state <state.json copy>/);
  assert.equal(result.stdout, '');
  assert.deepEqual(await readdir(directory), []);
});

test('CLI --json previews a copied sidecar save with current catalogue data and leaves the copy unchanged', async t => {
  const fixture = await staticFixture(t), bytes = await readFile(fixture.file);
  const files = await readdir(fixture.directory), dependencies = await readdir(path.join(fixture.directory, 'static'));
  const result = spawnSync(process.execPath, [path.resolve('scripts/preview-resource-contents.mjs'), '--state', fixture.file, '--json'],
    { cwd: fixture.directory, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.beforeCacheResources, false);
  assert.equal(report.afterCacheResources, true);
  assert.equal(report.cacheWalking, true);
  assert.equal(report.metadataCorrections, true);
  assert(Array.isArray(report.members[0].regressions.sourceChunkLosses));
  assert(Array.isArray(report.members[0].regressions.availabilityChanges));
  assert.equal(report.members[0].counts.lostSourceTasks, report.members[0].regressions.sourceChunkLosses.length);
  assert.deepEqual(report.members[0].chunks.map(row => row.id), ['7495', '7751', '8007']);
  assert.equal(report.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(fixture.file), bytes);
  assert.deepEqual(await readdir(fixture.directory), files);
  assert.deepEqual(await readdir(path.join(fixture.directory, 'static')), dependencies);
});
