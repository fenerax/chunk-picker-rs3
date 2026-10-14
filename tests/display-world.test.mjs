import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../app/data/world.mjs';
import { projectDisplayWorld, hydrateDisplayWorld } from '../app/display-world.mjs';
import { createRuleRegistry, builtInRules } from '../app/core/rules.mjs';
import { createRuleRegistryFromDefinitions } from '../app/core/rule-registry.mjs';
import { worldPartnerConnections } from '../app/data/world-connections.mjs';

test('display transport retains contents and geometry while leaving server evidence intact', () => {
  const definitions = { chunks: { '7495': { Name: 'North' }, '7494': {} },
    walkableChunks: ['7495', '7494'], walkableChunksF2P: ['7495'],
    sections: { '7495': { '0': ['7494'] } } };
  const world = buildWorld(definitions, { cacheResources: false, cacheArchaeology: false });
  const provenance = { source: 'game-data', classKey: 'tree', components: ['7495-1000001'], cacheOnly: true,
    evidence: { catalogue: ['repeated server research'] }, placements: ['private evidence index'] };
  const contents = { Object: { Tree: 2 }, ObjectProvenance: { Tree: provenance },
    Sections: { '0': { Object: { Tree: 1 }, ObjectProvenance: { Tree: provenance } } },
    CacheComponents: { '7495-1000001': { Object: { Tree: 1 }, ObjectProvenance: { Tree: provenance } } } };
  world.resourceContents.set('7495', contents);
  world.cacheWalking = { topology: new Map([['7495', new Map([['1000001', ['7494-1000002']]])]]) };
  const projected = projectDisplayWorld(world);
  const browser = hydrateDisplayWorld(JSON.parse(JSON.stringify(projected)));
  for (const key of ['chunks', 'areas', 'surface', 'walkable', 'f2p', 'sectionTopology']) assert.deepEqual(browser[key], world[key]);
  assert.equal(browser.cacheWalking.topology.has('7495'), true);
  const displayed = browser.resourceContents.get('7495');
  assert.deepEqual(displayed.Object, contents.Object);
  for (const record of [displayed, displayed.Sections['0'], displayed.CacheComponents['7495-1000001']]) {
    assert.deepEqual(record.ObjectProvenance.Tree, { source: 'game-data', classKey: 'tree', components: ['7495-1000001'], cacheOnly: true });
  }
  assert.equal(contents.ObjectProvenance.Tree, provenance);
  assert.deepEqual(provenance.evidence, { catalogue: ['repeated server research'] });
  assert.equal(Object.hasOwn(projected, 'identityRegistry'), false);
  assert.throws(() => hydrateDisplayWorld({ schemaVersion: 2 }), /version/);
});

test('metadata rule registry resolves the same defaults and enforces custom setting types', () => {
  const extra = { id: 'custom.threshold', type: 'number', default: 2, label: 'Threshold' };
  const full = createRuleRegistry([extra]);
  const metadata = full.definitions.map(({ candidates, exclude, ...definition }) => definition);
  const browser = createRuleRegistryFromDefinitions(metadata);
  assert.deepEqual(browser.defaults, full.defaults);
  assert.deepEqual(browser.resolve({ 'tasks.completion': 'personal', 'custom.threshold': 3 }), full.resolve({ 'tasks.completion': 'personal', 'custom.threshold': 3 }));
  assert.throws(() => browser.resolve({ 'custom.threshold': '3' }), /number/);
  assert.throws(() => browser.resolve({ unknown: true }), /Unknown/);
  assert.throws(() => createRuleRegistryFromDefinitions([...metadata, metadata[0]]), /Duplicate/);
  assert.equal(browser.definitions.length, builtInRules.length + 1);
});

test('hydrated worlds use authoritative connections and resolvers add no own world keys', () => {
  const world = buildWorld({ chunks: { '7495': {} }, walkableChunks: [], walkableChunksF2P: [] }, { cacheResources: false, cacheArchaeology: false });
  assert.ok(Reflect.ownKeys(world).every(key => typeof world[key] !== 'function'));
  const browser = hydrateDisplayWorld(projectDisplayWorld(world));
  const connections = { regions: ['7495'], byChunk: { '7495': { connected: false } } };
  assert.equal(worldPartnerConnections(browser, {}, 'one', { partnerConnections: connections }), connections);
  assert.throws(() => worldPartnerConnections(browser, {}, 'one'), /authoritative/);
});
