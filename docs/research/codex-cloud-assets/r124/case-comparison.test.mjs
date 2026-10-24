import assert from 'node:assert/strict';
import {caseOrder, immutableExpected, createCaseComparison} from './case-comparison.mjs';

const row = (index) => ({...caseOrder[index], inputHash: '1'.repeat(64), semanticHash: '2'.repeat(64),
  rows: 1, statuses: {available: 1}, metrics: {processingAccessEvaluations: 3},
  elapsedMs: {value: index + 1, cachedOrHistorical: caseOrder[index].label.includes('hit')}, eligibilityCacheHit: false});
const baseline = () => ({arm: 'baseline', fixtureSHA256: '3'.repeat(64), definitionsHash: '4'.repeat(64),
  stateHash: '5'.repeat(64), migration: {schema: 2, savedTasks: 23935, aliases: 91471},
  catalogueCounts: {ordinary: 1, dynamic: 1}, results: caseOrder.map((_, i) => row(i))});
const candidate = (expected) => ({...structuredClone(expected), arm: 'candidate', results: []});
const checker = (expected = baseline()) => createCaseComparison(candidate(expected), {arm: 'candidate', expected});

const source = baseline(), expected = immutableExpected(source);
source.results[0].metrics.processingAccessEvaluations = 999;
assert.equal(expected.results[0].metrics.processingAccessEvaluations, 3);
assert.ok(Object.isFrozen(expected.results[0].metrics));
assert.throws(() => { expected.results[0].semanticHash = '0'.repeat(64); }, TypeError);

const visited = [], early = checker();
assert.throws(() => {
  for (let index = 0; index < 8; index++) early.runCase(index, () => {
    visited.push(index);
    return {...row(index), semanticHash: '0'.repeat(64)};
  });
}, /case 0 mismatch semanticHash/);
assert.deepStrictEqual(visited, [0], 'second case must never run after first mismatch');
assert.throws(() => early.runCase(1, () => { visited.push(1); return row(1); }), /already failed/);
assert.deepStrictEqual(visited, [0], 'a caught mismatch must not permit later callbacks');

const complete = checker();
for (let i = 0; i < 8; i++) complete.runCase(i, () => ({...row(i), elapsedMs: {value: 999, cachedOrHistorical: i % 2 === 1}}));
complete.finish();

const late = checker(), lateVisited = [];
assert.throws(() => {
  for (let i = 0; i < 8; i++) late.runCase(i, () => {
    lateVisited.push(i);
    if (i === 7) throw Error('late engine failure');
    return row(i);
  });
}, /late engine failure/);
assert.equal(lateVisited.length, 8);
assert.throws(() => late.finish(), /already failed/);

const missingActual = checker();
for (let i = 0; i < 7; i++) missingActual.runCase(i, () => row(i));
assert.throws(() => missingActual.finish(), /incomplete case sequence/);
assert.throws(() => missingActual.runCase(7, () => { throw Error('must not resume'); }), /already failed/);
const missingExpected = baseline(); missingExpected.results.pop();
assert.throws(() => checker(missingExpected), /all eight cases/);
const corruptExpected = baseline(); corruptExpected.results[0].semanticHash = 'corrupt';
assert.throws(() => checker(corruptExpected), /semantic hash/);
const reordered = baseline(); reordered.results.reverse();
assert.throws(() => checker(reordered), /owner\/order/);
for (const field of ['inputHash', 'rows', 'statuses', 'metrics', 'eligibilityCacheHit']) {
  const boundary = checker();
  assert.throws(() => boundary.runCase(0, () => ({...row(0), [field]: field === 'inputHash' ? '0'.repeat(64) : field === 'rows' ? 2 : field === 'eligibilityCacheHit' ? true : {changed: 1}})), /mismatch/);
}
console.log('R124 CASE BOUNDARY PURE PASS: first mismatch stops before case 2; frozen vectors; all eight required; corrupt/missing/reordered vectors, late errors and all original compared fields fail closed');
