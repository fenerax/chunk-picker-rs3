import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { entityId } from '../app/tasks/identity.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { buildResourcePreview, findSourceChunkRegressions, summarizeTask, diffTasks, renderResourcePreview, flattenChunkContents } from '../scripts/preview-resource-contents.mjs';

const summary = (id, sources, status = 'available', registry) => summarizeTask({ id, label: id, status, sources }, registry);
const source = (location, kind = 'objects', name = 'Fixture tree') => ({ location, kind, name });

test('owned source loss uses canonical task identity and accepts replacement of any source kind or name', () => {
  const id = 'rs3:task:source-loss', registry = { entries: { [id]: { id } }, aliases: { 'legacy-task': id } };
  const before = summary('legacy-task', [source('16692-1'), source('13117-1'), source('12849-1')], 'available', registry);
  const after = summary(id, [source('16692-1000002', 'monsters', 'Different source'), source('13117-1000001', 'npcs', 'Renamed source')], 'available', registry);
  const [row] = findSourceChunkRegressions([before], [after], ['16692', '13117', '12849']);
  assert.equal(row.id, id);
  assert.deepEqual(row.lostSourceChunks, ['12849']);
  assert.equal(row.before.available, true);
  assert.equal(row.after.available, true);
  assert.deepEqual(findSourceChunkRegressions([before], [after], ['16692', '13117']), []);
});

test('ownership excludes partner, selected and pending chunks, while disappearance includes all owned losses', () => {
  const before = summary('rs3:task:owned', ['16692', '13117', '12849', '16436'].map(location => source(location)));
  const [row] = findSourceChunkRegressions([before], [], ['16692']);
  assert.deepEqual(row.lostSourceChunks, ['16692']);
  assert.equal(row.after, null);
  assert.deepEqual(findSourceChunkRegressions([before], [], []), []);
});

test('availability changes remain independent of source loss and ownership', () => {
  const before = [summary('unchanged-sources', [source('13117')]), summary('new-availability', [source('12849')], 'blocked')];
  const after = [summary('unchanged-sources', [source('13117')], 'blocked'), summary('new-availability', [source('12849')])];
  assert.deepEqual(findSourceChunkRegressions(before, after, ['16692']), []);
  const changes = diffTasks(before, after);
  assert.equal(changes.length, 2);
  assert(changes.some(row => row.becameUnavailable && !row.sourcesChanged));
  assert(changes.some(row => row.becameAvailable && !row.sourcesChanged));
});

test('human output lists canonical lost-source rows even when all availability stays constant', () => {
  const before = [summary('rs3:task:source-loss', [source('16692'), source('13117')])];
  const after = [summary('rs3:task:source-loss', [source('13117')])];
  const tasks = diffTasks(before, after);
  const report = { taskCoverage: 'Synthetic coverage.', members: [{ id: 'synthetic', chunks: [], tasks,
    counts: { beforeAvailable: 1, afterAvailable: 1 }, regressions: {
      sourceChunkLosses: findSourceChunkRegressions(before, after, ['16692']), availabilityChanges: [],
    } }] };
  const output = renderResourcePreview(report);
  assert.match(output, /Available task rows: 1 -> 1/);
  assert.match(output, /Owned source chunk losses: 1 task\(s\), 1 task\/chunk pair\(s\)/);
  assert.match(output, /\[rs3:task:source-loss\]: lost \["16692"\]; no replacement source/);
  assert.match(output, /Availability changes: 0 gain\(s\), 0 loss\(es\)/);
  assert.equal(renderResourcePreview(report), output);
});

test('regression summaries distinguish task rows from lost task/chunk pairs', () => {
  const before = [summary('rs3:task:a', [source('16692'), source('13117')]), summary('rs3:task:b', [source('16692')])];
  const losses = findSourceChunkRegressions(before, [], ['16692', '13117']);
  assert.equal(losses.length, 2);
  assert.equal(losses.reduce((sum, row) => sum + row.lostSourceChunks.length, 0), 3);
  const report = { taskCoverage: 'Synthetic coverage.', members: [{ id: 'synthetic', chunks: [], tasks: [],
    counts: { beforeAvailable: 2, afterAvailable: 0 }, regressions: { sourceChunkLosses: losses, availabilityChanges: [] } }] };
  assert.match(renderResourcePreview(report), /Owned source chunk losses: 2 task\(s\), 3 task\/chunk pair\(s\)/);
});

// Synthetic authored declarations and placements, using public cache component
// IDs only. No player save, copied private state or private server is involved.
// On merged pre-fix commit 296050b this fixture produced 10 owned task/chunk
// losses while the available-task count stayed 10 -> 10.
export function sourceLossFixture() {
  const cases = [
    ['16692', 12], ['16692', 12], ['13117', 4], ['12849', 6], ['12849', 6],
    ['16436', 3], ['16690', 1], ['12093', 2], ['11827', 2], ['13880', 1],
  ];
  const unlocked = [...new Set(['12339', ...cases.map(([id]) => id)])];
  const chunks = Object.fromEntries(unlocked.map(id => [id, { Nickname: `Synthetic ${id}`, Object: {} }]));
  const challenges = { Woodcutting: {} }, classes = [], placements = [], mappings = [];
  cases.forEach(([chunkId, label], index) => {
    const name = `Synthetic retained tree ${index}`, key = `fixture:tree:${index}`;
    chunks[chunkId].Object[name] = 1;
    chunks['12339'].Object[name] = 1;
    challenges.Woodcutting[`Harvest synthetic tree ${index}`] = { PickerId: `rs3:task:synthetic-tree-${index}`, Objects: [name] };
    classes.push({ key, name });
    mappings.push({ name, classKeys: [key] });
    placements.push({ id: `synthetic:indoor:${index}`, objectId: 990000 + index, chunkId, classKey: key, components: [`${chunkId}-${1000000 + label}`] });
  });
  const definitions = { chunks, challenges, walkableChunks: unlocked, walkableChunksF2P: unlocked,
    sections: Object.fromEntries(unlocked.map(id => [id, { 0: [] }])) };
  const state = createGroupState([{ id: 'synthetic-owner', name: 'Synthetic owner', unlocked }]);
  state.rules['content.f2p'] = false;
  // The reported Wendlewick and Rogues' Castle fixtures enter outdoor 2 and 1.
  // 12849's second outdoor component and 16690's outdoor component are
  // independently entered in this fixture.
  state.members[0].sectionOverrides = { '12849-1000002': true, '16690-1000002': true };
  const options = { reviewedOverlays: false, metadataCorrections: false, lodestones: [], resourceCatalogue: {
    coverage: cases.map(([chunkId]) => ({ chunkId, status: 'decoded' })), classes, placements,
  }, resourceSelectors: { mappings } };
  return { definitions, state, options, cases };
}

test('retained indoor declarations preserve owned sources with constant task availability', t => {
  const { definitions, state, options, cases } = sourceLossFixture();
  const access = calculateAccess(buildAccessIndex(definitions, { ...options, cacheWalking: true, cacheResources: true }), state, 'synthetic-owner');
  assert(access.components.has('16692-1000002'));
  assert(access.components.has('13117-1000001'));
  assert(access.components.has('12849-1000001'));
  assert(access.components.has('12849-1000002'));
  for (const [chunk, label] of cases) assert(!access.components.has(`${chunk}-${1000000 + label}`), 'Retained declarations must not enter indoor walking components.');
  const report = buildResourcePreview(definitions, state, options), member = report.members[0];
  t.diagnostic(JSON.stringify({ counts: member.counts, losses: member.regressions.sourceChunkLosses.map(row => ({ id: row.id, chunks: row.lostSourceChunks })) }));
  assert.equal(member.counts.beforeAvailable, 10);
  assert.equal(member.counts.afterAvailable, 10);
  assert.equal(member.counts.lostSourceTasks, 0);
  assert.equal(member.counts.lostSourceChunks, 0);
  assert.deepEqual(member.regressions.availabilityChanges, []);
  assert.equal(report.metadataCorrections, false);
  assert.match(renderResourcePreview(report), /Owned source chunk losses: 0 task\(s\), 0 task\/chunk pair\(s\)/);
});

test('cache-only unreachable indoor resources remain contents without task availability', () => {
  const { definitions, state, options } = sourceLossFixture();
  for (const chunk of Object.values(definitions.chunks)) delete chunk.Object;
  const member = buildResourcePreview(definitions, state, options).members[0];
  assert.equal(member.counts.beforeAvailable, 0);
  assert.equal(member.counts.afterAvailable, 0);
  assert.equal(member.counts.lostSourceTasks, 0);
  assert.deepEqual(member.regressions.availabilityChanges, []);
  assert(member.chunks.some(chunk => chunk.added.some(row => row.id === entityId('object', 'Synthetic retained tree 0'))));
});

test('preview flattens aggregated chunk objects once without synthetic component sections', () => {
  const { definitions, options } = sourceLossFixture();
  const world = buildWorld(definitions, { ...options, cacheWalking: true, cacheResources: true });
  const record = world.resourceContents.get('16692');
  assert.equal(record.CacheComponents, undefined);
  const rows = flattenChunkContents(record, '16692');
  assert.equal(rows.length, 2);
  const classes = new Map([['Synthetic retained tree 0', 'fixture:tree:0'], ['Synthetic retained tree 1', 'fixture:tree:1']]);
  assert.deepEqual(new Set(rows.map(row => row.label)), new Set(classes.keys()));
  for (const row of rows) {
    assert.deepEqual(row.locations, ['16692']);
    assert.equal(row.quantities.length, 1);
    assert.equal(row.quantities[0].quantity, 1);
    assert.equal(row.placementIds.length, 1);
    assert.deepEqual(row.classifications, [{ source: 'game-data', classKey: classes.get(row.label) }]);
  }
});
