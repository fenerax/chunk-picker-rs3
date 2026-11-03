import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { prewarmCandidate } from '../scripts/linux/prewarm.mjs';
test('online preparation invokes the candidate calculator with copied input and persistent output; failures are optional', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-candidate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts/linux'), { recursive: true });
  await writeFile(path.join(directory, 'scripts/linux/prewarm.mjs'), '');
  let calls = 0;
  const settings = { dataDir: path.join(directory, 'live') }, candidate = { config: { coreRoot: directory, nodePath: process.execPath, datasetId: 'open-f2p' } };
  const execute = (node, args, options) => {
    calls++; assert.equal(node, process.execPath);
    assert.equal(args[args.indexOf('--data-dir') + 1], path.join(directory, 'copy'));
    assert.equal(args[args.indexOf('--warm-dir') + 1], path.join(settings.dataDir, 'warm-store'));
    assert.equal(options.env.RS3_TASK_WORKER_MODE, 'process'); assert.equal(options.stdio, 'ignore');
    const child = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => child.emit('close', calls === 1 ? 0 : 1)); return child;
  };
  assert.equal(await prewarmCandidate({ settings, candidate, dataDir: path.join(directory, 'copy'), execute }), true);
  assert.equal(await prewarmCandidate({ settings, candidate, dataDir: path.join(directory, 'copy'), execute }), false);
  assert.equal(await prewarmCandidate({ settings, candidate: { config: { coreRoot: path.join(directory, 'old') } }, dataDir: '/tmp/copy', execute }), false);
  assert.equal(calls, 2);
});


test('portable recovery probes disable persistent artifacts in disposable store copies', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-probe-options-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'app'));
  await writeFile(path.join(directory, 'app/server.mjs'), 'export const createServer = options => options;\n');
  const { openApplication } = await import('../scripts/linux/runtime.mjs');
  const options = await openApplication({ coreRoot: directory, datasetId: 'open-f2p' }, path.join(directory, 'copy'), { probe: true });
  assert.equal(options.taskWorkerOptions.warmStoreDirectory, false);
});


test('online preparation lowers its child priority before calculator work', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-priority-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts/linux'), { recursive: true });
  const output = path.join(directory, 'priority.json');
  await writeFile(path.join(directory, 'scripts/linux/prewarm.mjs'),
    `import { getPriority } from 'node:os'; import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify(getPriority()));\n`);
  assert.equal(await prewarmCandidate({ settings: { dataDir: path.join(directory, 'live') },
    candidate: { config: { coreRoot: directory, nodePath: process.execPath, datasetId: 'open-f2p' } }, dataDir: path.join(directory, 'copy') }), true);
  assert.ok(JSON.parse(await readFile(output, 'utf8')) >= 10);
});
