const keys = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];

export function caseCounts(native) {
  if (!native || keys.some(key => !Number.isSafeInteger(native[key]) || native[key] < 0)
    || native.tests !== native.passed + native.failed + native.cancelled + native.skipped + native.todo) return null;
  return { ...Object.fromEntries(keys.map(key => [key, native[key]])), executed: native.passed + native.failed + native.cancelled };
}

export function caseCounter() {
  const counts = Object.fromEntries(keys.map(key => [key, 0]));
  let observed = false;
  return {
    onEvent({ type, data = {} }) {
      observed = true;
      // Node can count an empty file's FileTest wrapper as a passing test. Only
      // real entryFile case completions establish executed case coverage.
      if (type !== 'test:complete' || !data.entryFile || data.details?.type === 'suite') return;
      counts.tests++;
      const status = data.skip ? 'skipped' : data.todo ? 'todo'
        : data.details?.error?.failureType === 'cancelledByParent' || data.details?.error?.code === 'ERR_TEST_CANCELLED' ? 'cancelled'
          : data.details?.passed === true ? 'passed' : 'failed';
      counts[status]++;
    },
    result(native) {
      const validated = caseCounts(native);
      if (!validated || !observed) return null;
      const actual = caseCounts(counts);
      if (!actual.tests) return actual;
      return keys.every(key => counts[key] === native[key]) ? actual : null;
    },
  };
}

export function caseCountFailure(counts) {
  if (!counts) return 'missing-or-invalid-counts';
  if (!counts.executed) return 'no-executed-cases';
  if (counts.todo) return 'todo-cases';
  if (counts.passed !== counts.executed) return 'cases-did-not-pass';
  return null;
}

export const countFailureMessage = {
  'missing-or-invalid-counts': 'missing or inconsistent native case counts',
  'no-executed-cases': 'no executed test cases; choose an OS where the test bodies run',
  'todo-cases': 'todo cases cannot establish stability',
  'cases-did-not-pass': 'executed cases failed or were cancelled',
  'native-failure': 'native test process failed',
};
