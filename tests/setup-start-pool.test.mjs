import test from 'node:test';
import assert from 'node:assert/strict';

// Tracked legacy inputs work without installed packs. An explicit released
// provider can run the identical synthetic states without reading a real save.
process.env.RS3_DATASET ??= 'duo-legacy';
const { selectedDataset: dataset } = await import('../app/dataset-runtime.mjs');
const { loadDatasetInputs } = await import('../app/dataset-bootstrap.mjs');
const { prepareServerDefinitions } = await import('../app/dataset-pipeline.mjs');
const { buildWorld } = await import('../app/data/world.mjs');
const { createGroupState, applyCommand } = await import('../app/core/state.mjs');
const { evaluateRollPool } = await import('../app/core/rules.mjs');
const { definitionBytes } = await loadDatasetInputs(dataset, { loadTaskMap: false });
const world = buildWorld(prepareServerDefinitions(JSON.parse(definitionBytes), dataset, { reviewedOverlays: true }), { dataset });
const banks = await dataset.json('app/data/members-start-banks.2026-10-12.v1.json');

assert.equal(banks.optionAF2PExtension.length, 23, 'review the complete setup bank inventory');
for (const [index, bank] of banks.optionAF2PExtension.entries()) {
  test(`reviewed setup bank ${bank.chunkId} supplies an initial roll pool`, () => {
    const initial = createGroupState([{ id: 'one', name: 'Synthetic' }]);
    initial.tasks = [{ id: 'synthetic:setup', label: 'Synthetic setup task', category: 'quest' }];
    let state = applyCommand(initial, { type: 'setup-start' }, {
      world, membersStartBanks: banks, random: () => (index + 0.5) / banks.optionAF2PExtension.length,
    });
    assert.deepEqual(state.members[0].unlocked, [bank.chunkId]);
    const started = state;
    state = applyCommand(state, { type: 'complete-task', memberId: 'one', taskId: 'synthetic:setup', completed: true }, { world });
    assert.deepEqual(evaluateRollPool(world, state, 'one'), evaluateRollPool(world, started, 'one'));
    assert.deepEqual(applyCommand(started, { type: 'undo' }, { world }).members[0].sectionOverrides, initial.members[0].sectionOverrides);
    const pool = evaluateRollPool(world, state, 'one');
    assert.ok(pool.eligible.length > 0, `empty initial pool at ${bank.chunkId}`);
    const rolled = applyCommand(state, { type: 'roll', memberId: 'one', count: 1 }, { world, random: () => 0 });
    assert.equal(rolled.members[0].unlocked.length, 2, 'a real roll command accepts the pool');
  });
}

const { componentLocations, startingSectionLocations, startingBankSeeds, startingBankWalkabilitySha256 } = await import('../app/core/cache-surface.mjs');
const { readFile } = await import('node:fs/promises');
const { inflateRawSync } = await import('node:zlib');
const evidence = JSON.parse(await readFile(new URL('../app/data/cache-selector-evidence.2026-10-07.v1.json', import.meta.url)));
const masks = JSON.parse(await readFile(new URL('../app/data/training/banking-masks.v1.json', import.meta.url)));

test('start certificates agree with unconditional bank footprints and exact audited tiles', () => {
  assert.equal(masks.provenance.collisionSha256, startingBankWalkabilitySha256);
  for (const base of ['12084', '12854']) {
    const certificate = startingBankSeeds[base];
    const anchor = evidence.records.find(row => row.legacy === certificate.selector).anchors.find(row =>
      row.objectId === certificate.objectId && row.x === certificate.x && row.y === certificate.y);
    assert.equal(anchor.conditional, false);
    assert.equal(anchor.name, 'Bank chest');
    const label = Number(certificate.component.split('-')[1]) - 1000000;
    assert.deepEqual(anchor.witness.components, [`${base}:${label}`]);
    assert.deepEqual(anchor.witness.tiles.map(([x, y]) => [x, y]), certificate.witnessTiles);
    const bytes = inflateRawSync(Buffer.from(masks.regions.find(row => row[0] === base)[1], 'base64'));
    for (const [x, y] of certificate.witnessTiles) assert.equal(bytes.readUInt16LE(((x % 64) * 64 + y % 64) * 2), label);
    assert.deepEqual(componentLocations(world, certificate.selector), [], 'whole-selector ambiguity stays closed');
    assert.ok(startingSectionLocations(world, base).includes(certificate.component));
  }
});

test('start resolution rejects absent or stale geometry and keeps other selectors closed', () => {
  const stale = { ...world, cacheWalking: { ...world.cacheWalking, surfaceCorrections: { provenance: { walkabilitySha256: 'stale' } } } };
  for (const [base, certificate] of Object.entries(startingBankSeeds)) {
    assert.equal(startingSectionLocations(stale, base).includes(certificate.component), false);
    const missing = { ...world, cacheWalking: { ...world.cacheWalking, components: new Map() } };
    assert.equal(startingSectionLocations(missing, base).includes(certificate.component), false);
  }
  assert.equal(startingBankSeeds['13361'], undefined, 'membership uses the map policy, not a start-only exception');
  assert.deepEqual(startingSectionLocations(world, '13361'), ['13361-1']);
  assert.deepEqual(componentLocations(world, '11318-2'), [], 'a genuinely ambiguous selector still fails closed');
});

const tileMasks = new Map(masks.regions.map(([base, data]) => [base, inflateRawSync(Buffer.from(data, 'base64'))]));
const directions = [[-1, 0], [0, 1], [1, 0], [0, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]];
const opposite = [2, 3, 0, 1, 6, 7, 4, 5];
const tile = (x, y) => {
  const bytes = tileMasks.get(String(Math.floor(x / 64) * 256 + Math.floor(y / 64)));
  const offset = (x % 64) * 64 + y % 64;
  return { label: bytes?.readUInt16LE(offset * 2) ?? 0, movement: bytes?.[8192 + offset] ?? 0 };
};
function walkFrom(x, y, label) {
  const seen = new Set([`${x},${y}`]), queue = [[x, y]];
  for (const [x, y] of queue) for (const [d, [dx, dy]] of directions.entries()) {
    const next = tile(x + dx, y + dy), key = `${x + dx},${y + dy}`;
    if (tile(x, y).movement & (1 << d) && next.label === label && next.movement & (1 << opposite[d]) && !seen.has(key)) {
      seen.add(key); queue.push([x + dx, y + dy]);
    }
  }
  return seen;
}

test('every certified start uses exact witness labels while its whole selector stays unresolved', () => {
  for (const [base, certificate] of Object.entries(startingBankSeeds)) {
    const label = Number(certificate.component.split('-')[1]) - 1000000;
    for (const [x, y] of certificate.witnessTiles) assert.equal(tile(x, y).label, label);
    assert.deepEqual(componentLocations(world, certificate.selector), []);
    assert.ok(startingSectionLocations(world, base).includes(certificate.component));
    assert.ok(certificate.provenance.confidence);
  }
});

test('Daemonheim NPC 9710 has only the two label-7 cardinal witnesses, never label 6', () => {
  const certificate = startingBankSeeds['13626'];
  assert.equal(certificate.npcId, 9710);
  assert.equal(certificate.provenance.confidence, 'high');
  assert.match(certificate.provenance.evidenceUrl, /oldid=37142600$/);
  assert.equal(tile(certificate.x, certificate.y).label, 0);
  const perimeter = directions.slice(0, 4).map(([dx, dy]) => [certificate.x + dx, certificate.y + dy]);
  assert.deepEqual(perimeter.filter(([x, y]) => tile(x, y).label).sort(), [...certificate.witnessTiles].sort());
  assert.equal(perimeter.some(([x, y]) => tile(x, y).label === 6), false);
});

test('White Wolf component 10 is isolated; all three Wiki pins walk to the label-9 south perimeter', async () => {
  const certificate = startingBankSeeds['11318'], isolated = '11318-1000010';
  assert.equal(certificate.provenance.confidence, 'medium');
  assert.match(certificate.provenance.limitation, /No numeric post-quest return tile/);
  assert.equal(world.cacheWalking.components.get(isolated).tiles, 1);
  assert.deepEqual(tile(2856, 3464), { label: 10, movement: 0 });
  for (const [d, [dx, dy]] of directions.entries()) assert.equal(tile(2856 + dx, 3464 + dy).movement & (1 << opposite[d]), 0);
  const rawWalking = JSON.parse(await readFile(new URL('../app/data/cache-walkability.2026-10-07.v1.json', import.meta.url)));
  assert.equal(rawWalking.edges.some(row => row[0] === '11318:10' || row[1] === '11318:10'), false);
  assert.deepEqual(world.cacheWalking.outgoing.get(isolated) ?? [], []);
  for (const edges of world.cacheWalking.outgoing.values()) assert.equal(edges.includes(isolated), false);
  assert.ok(world.cacheWalking.outgoing.get(certificate.component).includes('11317-1000015'));
  const portal = evidence.records.find(row => row.legacy === '11318-6').anchors.find(row => row.objectId === certificate.objectId);
  assert.deepEqual(portal.witness.components, ['11318:10', '11318:9']);
  for (const pin of certificate.provenance.wikiPins) {
    assert.equal(tile(pin.x, pin.y).label, 9);
    const reachable = walkFrom(pin.x, pin.y, 9);
    for (const [x, y] of certificate.witnessTiles) assert.ok(reachable.has(`${x},${y}`));
  }
});

test('the Kharid-et mixed-mask outlier is a free-connected terrain corner, not a joined members area', () => {
  const [base, , hex] = masks.regions.find(row => row[0] === '13361');
  const mask = Buffer.from(hex, 'hex'), bytes = tileMasks.get(base), members = [];
  const freeAt = (x, y) => !!(mask[(x % 64) >> 3] & (1 << ((y % 64) >> 3)));
  for (let x = 3328; x < 3392; x++) for (let y = 3136; y < 3200; y++) {
    if (tile(x, y).label === 1 && !freeAt(x, y)) members.push([x, y]);
  }
  assert.equal(bytes.length, 12288);
  assert.deepEqual(members, [[3351, 3159]]);
  assert.equal(tile(3351, 3159).movement, 38);
  for (const [d, [dx, dy]] of directions.entries()) if (tile(3351, 3159).movement & (1 << d)) {
    assert.equal(tile(3351 + dx, 3159 + dy).label, 1);
    assert.equal(freeAt(3351 + dx, 3159 + dy), true);
  }
  assert.equal(tile(3351, 3158).label, 0);
  assert.equal(tile(3350, 3159).label, 0);
  assert.equal(tile(3350, 3156).label, 2, 'the nearby pit is a distinct component');
});
