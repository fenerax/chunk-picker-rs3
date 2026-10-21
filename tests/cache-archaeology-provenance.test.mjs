import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../app/data/world.mjs';
import { buildArchaeologyPreview } from '../scripts/preview-archaeology.mjs';
import { archaeologyResourceProvenanceFixture, ordinaryRows, controlRows, archaeologyNames, inside, outside }
  from './fixtures/archaeology-resource-provenance.mjs';

const ordinary = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([name]) => !archaeologyNames.includes(name)));
function nodeAt(contents, location) {
  const [base, section] = location.split('-');
  return section ? contents.get(base)?.Sections?.[section] : contents.get(base);
}
function assertOrdinaryNode(before, after, location) {
  assert.deepEqual(ordinary(after?.Object), ordinary(before?.Object), `${location} ordinary counts`);
  const hasAddedArchaeology = archaeologyNames.some(name => Object.hasOwn(after?.ObjectProvenance ?? {}, name));
  if (!hasAddedArchaeology) assert.equal(Object.hasOwn(after ?? {}, 'ObjectProvenance'),
    Object.hasOwn(before ?? {}, 'ObjectProvenance'), `${location} preserves provenance property presence`);
  assert.deepEqual(ordinary(after?.ObjectProvenance), ordinary(before?.ObjectProvenance),
    `${location} full ordinary provenance`);
}

for (const cacheResources of [true, false]) {
  test(`Archaeology preserves all ordinary counts and complete provenance with cacheResources=${cacheResources}`, () => {
    const { definitions, state, options } = archaeologyResourceProvenanceFixture({ cacheResources });
    const unchanged = structuredClone({ definitions, state });
    const before = buildWorld(definitions, { ...options, cacheArchaeology: false });
    const after = buildWorld(definitions, { ...options, cacheArchaeology: true });
    for (const location of new Set([...ordinaryRows, ...controlRows].map(row => row.location))) {
      const prior = nodeAt(before.resourceContents, location), current = nodeAt(after.resourceContents, location);
      assertOrdinaryNode(prior, current, location);
      const retained = cacheResources ? before.cacheResources.retainedNodes.get(location) : prior;
      assertOrdinaryNode(retained, after.cacheArchaeology.retainedNodes.get(location), `${location} retainedNodes`);
    }
    for (const row of ordinaryRows) {
      const prior = nodeAt(before.resourceContents, row.location);
      assert.equal(prior.Object[row.name], row.count);
      if (cacheResources) assert.deepEqual(prior.ObjectProvenance[row.name], {
        source: 'retained-only', classKey: row.classKeys[0],
        reason: 'No witnessed static placement of the reviewed class in this chunk.',
      });
      else assert.equal(Object.hasOwn(prior, 'ObjectProvenance'), false);
    }
    const prior = before.resourceContents.get('12339'), current = after.resourceContents.get('12339');
    assert.equal(prior.Object[archaeologyNames[0]], 9);
    assert.equal(current.Object[archaeologyNames[0]], 2);
    assert.equal(current.Object[archaeologyNames[1]], 3);
    assert(after.cacheArchaeology.superseded.get('12339').has(archaeologyNames[0]));
    assert.equal(current.ObjectProvenance[archaeologyNames[0]].source, 'game-data');
    assert.equal(current.ObjectProvenance[archaeologyNames[0]].cacheOnly, false);
    assert.deepEqual(current.ObjectProvenance[archaeologyNames[0]].retainedLocations, ['12339']);
    assert.equal(current.ObjectProvenance[archaeologyNames[1]].cacheOnly, true);
    assert.deepEqual(current.ObjectProvenance[archaeologyNames[1]].components, [outside]);
    assert.equal(after.cacheArchaeology.summary.attachedPlacements, 2);
    if (cacheResources) {
      assert.equal(prior.ObjectProvenance['Synthetic mixed resource'].classKey, undefined);
      assert.equal(prior.ObjectProvenance['Synthetic mixed resource'].reason,
        'No witnessed static placement of the reviewed class in this chunk.');
      assert.equal(prior.ObjectProvenance['Synthetic unmapped resource'].classKey, undefined);
      assert.equal(prior.ObjectProvenance['Synthetic unmapped resource'].reason,
        'No reviewed static-resource selector mapping.');
      assert.equal(prior.Object['Synthetic disabled resource'], false);
      assert.equal(prior.ObjectProvenance['Synthetic disabled resource'].classKey, 'synthetic:disabled');
      assert.equal(prior.Object['Yew tree'], 2);
      assert.equal(prior.ObjectProvenance['Yew tree'].cacheOnly, false);
      assert.deepEqual(prior.ObjectProvenance['Yew tree'].components, [inside]);
      assert.equal(prior.Object['Oak tree'], 3);
      assert.equal(prior.ObjectProvenance['Oak tree'].cacheOnly, true);
      assert.equal(before.cacheResources.retainedNodes.get('12339').Object['Yew tree'], undefined);
    }
    assert.deepEqual({ definitions, state }, unchanged);
  });
}

test('Archaeology preserves existing full annotations when the ordinary resource projection is disabled', () => {
  const { definitions, options } = archaeologyResourceProvenanceFixture({ cacheResources: false, originalProvenance: true });
  const unchanged = structuredClone(definitions);
  const before = buildWorld(definitions, { ...options, cacheArchaeology: false });
  const after = buildWorld(definitions, { ...options, cacheArchaeology: true });
  for (const location of new Set([...ordinaryRows, ...controlRows].map(row => row.location))) {
    const prior = nodeAt(before.resourceContents, location);
    assertOrdinaryNode(prior, nodeAt(after.resourceContents, location), location);
    assertOrdinaryNode(prior, after.cacheArchaeology.retainedNodes.get(location), `${location} retainedNodes`);
  }
  assert.deepEqual(definitions, unchanged);
});

test('Archaeology finalizes only its own game-data provenance and preserves inherited ordinary annotations', () => {
  const { definitions, state, options } = archaeologyResourceProvenanceFixture({ cacheResources: false, originalProvenance: true });
  const name = 'Synthetic unmapped resource';
  const provenance = definitions.chunks['12339'].ObjectProvenance[name] = {
    source: 'game-data', classKey: 'synthetic:inherited', classKeys: ['synthetic:inherited'],
    objectIds: [990301], placements: ['synthetic:inherited'], components: [outside],
    retainedLocations: ['12339'], cacheOnly: false, evidence: { kind: 'synthetic', fixture: 'inherited annotation' },
  };
  const unchanged = structuredClone({ definitions, state });
  const expected = structuredClone(provenance);
  const before = buildWorld(definitions, { ...options, cacheArchaeology: false });
  const after = buildWorld(definitions, { ...options, cacheArchaeology: true });
  assert.deepEqual(before.resourceContents.get('12339').ObjectProvenance[name], expected);
  assert.deepEqual(after.resourceContents.get('12339').ObjectProvenance[name], expected);
  assert.deepEqual(after.cacheArchaeology.retainedNodes.get('12339').ObjectProvenance[name], expected);
  assertOrdinaryNode(before.resourceContents.get('12339'), after.resourceContents.get('12339'), '12339');
  assert.deepEqual({ definitions, state }, unchanged);
});

for (const cacheResources of [true, false]) {
  test(`Archaeology preview reports only archaeology changes with cacheResources=${cacheResources}`, () => {
    const { definitions, state, options } = archaeologyResourceProvenanceFixture({ cacheResources });
    const unchanged = structuredClone({ definitions, state });
    const { members: [member] } = buildArchaeologyPreview(definitions, state, { ...options, reviewedOverlays: false });
    for (const chunk of member.chunks) for (const kind of ['added', 'removed', 'reclassified', 'changed']) {
      assert.deepEqual(chunk[kind].filter(row => !archaeologyNames.includes(row.label)), [],
        `${chunk.id}: no ordinary ${kind}`);
    }
    const archaeologyChunk = member.chunks.find(row => row.id === '12339');
    assert(archaeologyChunk.reclassified.some(row => row.label === archaeologyNames[0]));
    assert(archaeologyChunk.changed.some(row => row.label === archaeologyNames[0]));
    assert(archaeologyChunk.added.some(row => row.label === archaeologyNames[1]));
    assert.equal(member.counts.availabilityLosses, 0);
    assert.equal(member.counts.lostSourceTasks, 0);
    assert.equal(member.counts.lostSourceChunks, 0);
    assert.equal(member.counts.beforeAvailable, member.counts.afterAvailable);
    assert.deepEqual(member.tasks, []);
    assert.deepEqual(member.regressions.sourceChunkLosses, []);
    assert.deepEqual({ definitions, state }, unchanged);
  });
}
