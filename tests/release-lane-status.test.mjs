import test from 'node:test';
import assert from 'node:assert/strict';
import { laneStatusRows, releaseLaneReport } from '../scripts/private-companion/release-lane-status.mjs';

test('status reflects actual fresh work even when aggregate publication found an old receipt',()=>{
  const gates={passed:true,timings:[{stage:'public-full',fresh:261,reused:0,aggregateReused:true,sourceRunIds:[],fileDetails:[{file:'tests/a.test.mjs',disposition:'fresh',reason:'whole-input-key-miss'}]}]};
  assert.equal(laneStatusRows(gates)[0].status,'fresh');
  assert.match(releaseLaneReport(gates),/public-full \| 261 \| 0/);
  assert.match(releaseLaneReport(gates),/fresh; whole-input-key-miss/);
});
test('phase status preserves source run identity and prominently reports flaky files',()=>{
  const gates={passed:true,flakeRetryEnabled:true,timings:[{stage:'early-pipeline-private-full',fresh:1,reused:1,fileDetails:[{file:'tests/a.test.mjs',disposition:'reused',sourceRunId:'worker-1'},{file:'tests/b.test.mjs',disposition:'fresh',reason:'previous-failure',flaky:true}]}]};
  const rows=laneStatusRows(gates);assert.equal(rows[0].status,'mixed');assert.deepEqual(rows[0].sourceRunIds,['worker-1']);
  assert.match(releaseLaneReport(gates),/\*\*FLAKY FILES: tests\/b.test.mjs\*\*/);
  assert.match(releaseLaneReport(gates),/reused from worker-1/);
});
