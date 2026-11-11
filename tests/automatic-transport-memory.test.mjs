// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/fixed-performance-clock.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { configureAutomaticTransport, deriveAutomaticTransport, releaseAutomaticTransportCaches } from '../app/core/automatic-transport.mjs';

test('external automatic worlds fail engine proof closed even when baseline rules are manual', () => {
  const definitions = { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
    challenges: {}, codeItems: {}, drops: {}, equipment: {} };
  const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false, variantByteLimit: 0 };
  const world = buildWorld(definitions, options), engine = createTaskEngine(definitions, options);
  const state = createGroupState([{ id: 'synthetic-member', name: 'Synthetic Player', unlocked: ['12850'] }]);
  state.rules['travel.automatic'] = true;
  configureAutomaticTransport(world, { definitions, engine });
  assert.equal(engine.retentionLedger().complete, true);
  const before = deriveAutomaticTransport(world, state, 'synthetic-member');
  assert(before.baseline);
  assert.equal(engine.retentionLedger().parsedBytes, 0);
  assert.equal(engine.retentionLedger().complete, false);
  assert.deepEqual(engine.retentionLedger().blockers, ['automatic-transport-baseline-derived-bytes-unledgered']);
  assert.equal(deriveAutomaticTransport(world, state, 'synthetic-member'), before);
  releaseAutomaticTransportCaches(world);
  assert.deepEqual(deriveAutomaticTransport(world, state, 'synthetic-member'), before);
  assert.equal(engine.retentionLedger().complete, false);
});
