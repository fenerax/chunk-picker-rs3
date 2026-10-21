import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = 'rs3-test-coverage-v1';
const identity = row => JSON.stringify([row.file, row.name, row.occurrence]);
const validFile = file => typeof file === 'string' && /^tests\/[^/\\]+\.test\.mjs$/.test(file);
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw Error(`Duplicate ${label}.`);
};
const sameFiles = (actual, expected, label) => {
  if (!Array.isArray(actual) || actual.some(file => !validFile(file))) throw Error(`Invalid ${label}.`);
  unique(actual, label);
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw Error(`Incomplete ${label}.`);
};

function validateReport(report, lane, expectedFiles) {
  if (report?.schema !== schema || report.lane !== lane || report.passed !== true) throw Error(`Missing, failed or invalid ${lane} coverage report.`);
  sameFiles(report.files, expectedFiles, `${lane} file inventory`);
  sameFiles(report.completedFiles, expectedFiles, `${lane} completed files`);
  if (!Array.isArray(report.tests) || !report.tests.length) throw Error(`Empty ${lane} test results.`);
  const files = new Set(expectedFiles);
  for (const row of report.tests) {
    if (!files.has(row.file) || !Array.isArray(row.name) || !row.name.length || row.name.some(name => typeof name !== 'string' || !name.length)
      || !Number.isSafeInteger(row.occurrence) || row.occurrence < 1 || row.key !== identity(row)
      || !['pass', 'skip'].includes(row.status)) throw Error(`Invalid or unsuccessful ${lane} test result.`);
    if (row.status === 'skip' && (typeof row.reason !== 'string' || !row.reason.trim())) throw Error(`Skip without a reason in ${lane}: ${row.file}.`);
  }
  unique(report.tests.map(row => row.key), `${lane} test identities`);
  for (const file of files) if (!report.tests.some(row => row.file === file)) throw Error(`No test results for ${lane}: ${file}.`);
  if (!Array.isArray(report.fileResults)) throw Error(`Missing ${lane} native counts.`);
  sameFiles(report.fileResults.map(row => row.file), expectedFiles, `${lane} native-count files`);
  for (const result of report.fileResults) {
    const rows = report.tests.filter(row => row.file === result.file), counts = result.counts;
    if (result.passed !== true || !counts || !['tests', 'suites', 'passed', 'failed', 'cancelled', 'skipped', 'todo']
      .every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
      || counts.tests !== counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo
      || counts.failed || counts.cancelled || counts.todo || result.recordCount !== rows.length
      || rows.some(row => !['test', 'suite'].includes(row.kind))
      || rows.filter(row => row.kind === 'test').length !== counts.tests
      || rows.filter(row => row.kind === 'test' && row.status === 'pass').length !== counts.passed
      || rows.filter(row => row.kind === 'test' && row.status === 'skip').length !== counts.skipped) throw Error(`Incomplete or unsuccessful ${lane} native counts: ${result.file}.`);
  }
}

/** A skip with no result on the other OS is also uncovered. Files, names and
 * duplicate-name occurrences must match; aggregate counts cannot prove this. */
export function evaluateCoverage({ ubuntu, windows, allowlist, files, windowsFiles }) {
  validateReport(ubuntu, 'test', files);
  validateReport(windows, 'windows', windowsFiles);
  if (allowlist?.schema !== 'rs3-coverage-allowlist-v1' || !Array.isArray(allowlist.tests)) throw Error('Invalid coverage allowlist.');
  const allowances = new Map();
  for (const row of allowlist.tests) {
    if (!validFile(row.file) || !Array.isArray(row.name) || !row.name.length || row.name.some(name => typeof name !== 'string' || !name.length)
      || !Number.isSafeInteger(row.occurrence) || row.occurrence < 1
      || typeof row.reason !== 'string' || !row.reason.trim() || /[\r\n]/.test(row.reason)) throw Error('Each coverage allowance needs an exact test and one-line reason.');
    const key = identity(row);
    if (allowances.has(key)) throw Error('Duplicate coverage allowance.');
    allowances.set(key, row);
  }
  const tests = new Map();
  for (const report of [ubuntu, windows]) for (const row of report.tests) {
    if (!tests.has(row.key)) tests.set(row.key, { ...row, lanes: {} });
    tests.get(row.key).lanes[report.lane] = row.status;
  }
  const covered = [], allowed = [], uncovered = [];
  for (const row of tests.values()) {
    if (Object.values(row.lanes).includes('pass')) covered.push(row);
    else if (allowances.has(row.key)) allowed.push({ ...row, reason: allowances.get(row.key).reason });
    else uncovered.push(row);
  }
  const used = new Set(allowed.map(row => row.key));
  const stale = [...allowances].filter(([key]) => !used.has(key)).map(([, row]) => row);
  return { schema: 'rs3-coverage-gate-v1', passed: !uncovered.length && !stale.length,
    total: tests.size, covered: covered.length, allowed, uncovered, stale };
}

export async function coverageGate(directory, checkout = fileURLToPath(new URL('../../', import.meta.url))) {
  const { discoverTests } = await import(new URL('../test-selection.mjs', import.meta.url));
  const { windowsBoundTests } = await import(new URL('../private-companion/neutral-lane.mjs', import.meta.url));
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const [ubuntu, windows, allowlist, inventory] = await Promise.all([
    read(path.join(directory, 'test.json')), read(path.join(directory, 'windows.json')),
    read(path.join(checkout, '.github/coverage-allowlist.json')), discoverTests(path.join(checkout, 'tests'), 'full'),
  ]);
  return evaluateCoverage({ ubuntu, windows, allowlist,
    files: inventory.map(file => `tests/${file}`), windowsFiles: windowsBoundTests.map(file => `tests/${file}`) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/ci/coverage-gate.mjs <report directory>');
    // Rerunning failed jobs can leave an earlier attempt's artifacts behind.
    // They cannot rescue a job that failed or was cancelled this time.
    for (const key of ['RS3_COVERAGE_TEST_RESULT', 'RS3_COVERAGE_WINDOWS_RESULT'])
      if (process.env[key] !== undefined && process.env[key] !== 'success') throw Error('An upstream test job did not succeed.');
    const result = await coverageGate(path.resolve(process.argv[2]));
    console.log(`Coverage: ${result.covered}/${result.total} tests passed somewhere; ${result.allowed.length} reviewed exceptions; ${result.uncovered.length} uncovered.`);
    for (const row of result.uncovered) console.error(`UNCOVERED ${row.file}: ${row.name.join(' > ')} (#${row.occurrence})`);
    for (const row of result.stale) console.error(`Remove stale allowance: ${row.file}: ${row.name.join(' > ')} (#${row.occurrence})`);
    for (const row of result.allowed) console.log(`EXEMPT ${row.file}: ${row.name.join(' > ')}: ${row.reason}`);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(`Coverage gate refused: ${error.code === 'ENOENT' ? 'Required coverage artifact or allowlist is absent.' : error.message}`);
    process.exitCode = 1;
  }
}
