import assert from 'node:assert/strict';

export const caseOrder = Object.freeze(['alpha', 'beta'].flatMap(owner =>
  ['cold', 'identical-hit', 'unlocked', 'unlocked-hit'].map(label => Object.freeze({owner, label}))));
const identityFields = ['fixtureSHA256', 'definitionsHash', 'stateHash', 'migration', 'catalogueCounts'];
const comparedFields = ['owner', 'label', 'inputHash', 'semanticHash', 'rows', 'statuses', 'metrics', 'eligibilityCacheHit'];
const hash = /^[a-f0-9]{64}$/;
let configuration;

function validateRow(row, index) {
  assert.ok(row && typeof row === 'object', `missing case ${index}`);
  for (const key of [...comparedFields, 'elapsedMs']) assert.ok(Object.hasOwn(row, key), `case ${index} missing ${key}`);
  assert.equal(row.owner, caseOrder[index].owner, `case ${index} owner/order`);
  assert.equal(row.label, caseOrder[index].label, `case ${index} label/order`);
  assert.match(row.inputHash, hash, `case ${index} input hash`);
  assert.match(row.semanticHash, hash, `case ${index} semantic hash`);
  assert.ok(Number.isSafeInteger(row.rows) && row.rows >= 0, `case ${index} rows`);
  assert.ok(row.metrics && row.statuses && row.elapsedMs, `case ${index} vectors`);
  assert.equal(row.elapsedMs.cachedOrHistorical, row.label.includes('hit'), `case ${index} historical timing label`);
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function immutableExpected(summary) {
  // IPC uses JSON serialization. Keep an independent frozen copy in each process.
  const copy = JSON.parse(JSON.stringify(summary));
  assert.equal(copy.arm, 'baseline');
  assert.equal(copy.results?.length, 8, 'baseline requires all eight cases');
  for (const key of identityFields) assert.ok(Object.hasOwn(copy, key), `missing identity ${key}`);
  copy.results.forEach(validateRow);
  return freeze(copy);
}

export function configureComparison(arm, expected) {
  assert.equal(configuration, undefined, 'comparison already configured');
  assert.ok(['baseline', 'candidate'].includes(arm));
  assert.ok(arm === 'candidate' ? expected !== null && expected !== undefined : expected === null);
  configuration = Object.freeze({arm, expected: arm === 'candidate' ? immutableExpected(expected) : null});
}

export function createCaseComparison(summary, configured = configuration) {
  assert.ok(configured, 'comparison must be configured before driver import');
  assert.equal(summary.arm, configured.arm);
  const expected = configured.arm === 'candidate' ? immutableExpected(configured.expected) : null;
  if (expected) for (const key of identityFields) assert.deepStrictEqual(summary[key], expected[key], `identity mismatch ${key}`);
  let next = 0, failed = false;
  return Object.freeze({
    runCase(index, evaluate) {
      assert.equal(failed, false, 'case sequence already failed');
      try {
      assert.equal(index, next, 'case boundary order');
      assert.ok(next < 8, 'unexpected ninth case');
      const row = evaluate();
      validateRow(row, index);
      if (expected) for (const key of comparedFields) {
        assert.deepStrictEqual(row[key], expected.results[index][key], `case ${index} mismatch ${key}`);
      }
      next++;
      return row;
      } catch (error) { failed = true; throw error; }
    },
    finish() {
      try { assert.equal(failed, false, 'case sequence already failed'); assert.equal(next, 8, 'incomplete case sequence'); }
      catch (error) { failed = true; throw error; }
    },
  });
}
