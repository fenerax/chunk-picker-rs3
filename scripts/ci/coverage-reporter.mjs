import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/** Collect native Node 24 events, before any human reporter buffers them. */
export function createCoverageReporter({ lane = 'test', cwd = process.cwd(), files } = {}) {
  if (!['test', 'windows'].includes(lane)) throw new Error('Unknown coverage lane');
  // Use the root's path dialect so fixtures and reports work on either OS.
  const paths = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path.posix;
  const relative = file => {
    if (typeof file !== 'string' || !file) throw new Error('Missing coverage file');
    const result = paths.relative(cwd, paths.resolve(cwd, file)).replaceAll('\\', '/');
    if (!result || result === '..' || result.startsWith('../') || paths.isAbsolute(result)) throw new Error('Coverage file outside repository');
    return result;
  };
  if (!Array.isArray(files) || !files.length) throw new Error('Coverage requires expected files');
  const expected = files.map(relative).sort();
  if (new Set(expected).size !== expected.length) throw new Error('Duplicate coverage file');
  const inventory = new Set(expected), completed = new Map(), nodes = new Map();
  let sequence = 0;
  const onEvent = ({ type, data = {} }) => {
    // FileTest wrappers have no entryFile; their success is not test coverage.
    if (!data.entryFile || !['test:enqueue', 'test:dequeue', 'test:start', 'test:complete'].includes(type)) return;
    const file = relative(data.entryFile);
    if (!inventory.has(file)) throw new Error(`Unexpected coverage file: ${file}`);
    if (!Number.isInteger(data.testId) || data.testId < 1) throw new Error('Missing coverage testId');
    const id = JSON.stringify([file, data.testId]);
    let node = nodes.get(id);
    if (!node) {
      node = { file, sequence: sequence++, testId: data.testId };
      nodes.set(id, node);
    }
    if (node.name !== undefined && node.name !== data.name) throw new Error('Coverage testId collision');
    Object.assign(node, { name: data.name, parentId: data.parentId ?? 0, nesting: data.nesting, type: data.details?.type ?? data.type ?? node.type });
    if (typeof node.name !== 'string' || !node.name) throw new Error('Missing coverage test name');
    if (type === 'test:complete') {
      if (node.complete) throw new Error('Duplicate coverage completion');
      node.complete = data;
    }
  };
  const onFile = result => {
    const file = relative(result.file);
    if (!inventory.has(file) || completed.has(file) || typeof result.passed !== 'boolean') throw new Error('Invalid coverage file completion');
    const counts = result.summary?.counts;
    if (!counts || ['tests', 'suites', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'topLevel'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) throw new Error('Missing native coverage counts');
    if (counts.tests !== counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo) throw new Error('Inconsistent native coverage counts');
    completed.set(file, { file, passed: result.passed, counts: { ...counts } });
  };
  const report = ({ passed = [...completed.values()].every(item => item.passed) } = {}) => {
    if (typeof passed !== 'boolean') throw new Error('Coverage passed must be boolean');
    const hierarchy = (node, seen = new Set()) => {
      if (seen.has(node)) throw new Error('Cyclic coverage hierarchy');
      seen.add(node);
      if (!node.parentId) {
        if (node.nesting !== 0) throw new Error('Missing coverage parent');
        return [node.name];
      }
      const parent = nodes.get(JSON.stringify([node.file, node.parentId]));
      if (!parent) throw new Error('Missing coverage parent');
      return [...hierarchy(parent, seen), node.name];
    };
    const parents = new Set([...nodes.values()].filter(node => node.parentId).map(node => JSON.stringify([node.file, node.parentId])));
    const occurrences = new Map(), tests = [];
    for (const [id, node] of [...nodes].sort((a, b) => a[1].sequence - b[1].sequence)) {
      if (!node.complete) throw new Error('Incomplete coverage test');
      const data = node.complete, details = data.details ?? {};
      // Suites normally summarize children. A skipped suite itself is evidence:
      // Node does not enqueue any children of a skipped describe().
      if (node.type === 'suite' && parents.has(id) && !data.skip) continue;
      const name = hierarchy(node);
      const base = JSON.stringify([node.file, name]);
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      const status = data.skip ? 'skip' : data.todo ? 'todo' : details.error?.failureType === 'cancelledByParent' || details.error?.code === 'ERR_TEST_CANCELLED' ? 'cancelled' : details.passed === true ? 'pass' : 'fail';
      tests.push({ file: node.file, name, occurrence, key: JSON.stringify([node.file, name, occurrence]), kind: node.type === 'suite' ? 'suite' : 'test', status,
        ...(status === 'skip' ? { reason: typeof data.skip === 'string' ? data.skip : 'Test supplied no skip reason' } : {}) });
    }
    tests.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const fileResults = [...completed.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0).map(item => {
      const records = tests.filter(test => test.file === item.file);
      const suiteCount = [...nodes.values()].filter(node => node.file === item.file && node.type === 'suite').length;
      if (records.filter(test => test.kind === 'test').length !== item.counts.tests || suiteCount !== item.counts.suites) throw new Error(`Native coverage count mismatch: ${item.file}`);
      return { ...item, recordCount: records.length };
    });
    return { schema: 'rs3-test-coverage-v1', lane, files: [...expected], completedFiles: [...completed.keys()].sort(),
      passed: passed && completed.size === expected.length && [...completed.values()].every(item => item.passed) && tests.every(test => !['fail', 'cancelled'].includes(test.status)), fileResults, tests };
  };
  const write = async (destination, options) => {
    const value = report(options);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(value, null, 2) + '\n');
    return value;
  };
  return { onEvent, onFile, report, write };
}
