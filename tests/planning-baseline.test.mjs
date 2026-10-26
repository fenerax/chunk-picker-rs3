import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePlanningBaseline, decodePlanningBaseline, indexPlanningBaseline, projectChunkPlanning, PLANNING_BASELINE_BYTES } from '../app/tasks/planning-baseline.mjs';
import { buildChunkPlanningIndex } from '../app/tasks/chunk-planning-index.mjs';
import { definitions, locations } from './helpers/planning-areas.mjs';

test('baseline handoff preserves full projections, hidden display, source gates and named areas', () => {
  const result = { access: { bases: ['12341'], sections: ['12341-1'], areas: ['Puro-Puro'] }, tasks: [
    { id: 'hidden', label: 'Hidden', hidden: true, status: 'blocked', category: 'Extra', record: { Chunks: ['Village[+]'], Description: 'Keep me', ClueTier: 'Easy', Requirements: { Mining: 20 } }, blockers: [{ detail: 'Personal prerequisite' }] },
    { id: 'source', label: 'Source', status: 'available', category: 'Smithing', level: 20, record: { Objects: ['Anvil'], SourceLocations: [{ field: 'Objects', name: 'Anvil', locations: ['12341'] }] }, sources: [{ kind: 'objects', name: 'Anvil', location: '12341' }] },
    { id: 'alias', label: 'Interior', status: 'blocked', category: 'Quest', record: { Chunks: ['Dorgesh-Kaan'] } },
  ] };
  const world = { chunks: new Map([['12341', {}], ['12342', {}]]), areas: new Map([['Puro-Puro', {}], ['Dorgesh-Kaan', {}]]) };
  const original = structuredClone(result), expected = buildChunkPlanningIndex(definitions, result, world);
  const encoded = encodePlanningBaseline(definitions, result, world), decoded = decodePlanningBaseline(encoded), index = indexPlanningBaseline(decoded);
  for (const location of [...locations, '12341-1']) assert.deepEqual(projectChunkPlanning(decoded.result, index, location), projectChunkPlanning(result, expected, location));
  assert.deepEqual(result, original);
  assert.throws(() => decodePlanningBaseline(Buffer.alloc(PLANNING_BASELINE_BYTES + 1)), /Invalid planning baseline/);
  assert.throws(() => decodePlanningBaseline(Buffer.from('invalid gzip')));
});
