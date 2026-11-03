import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import * as filesystem from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { rootFilesystem } from './helpers/prewarm.mjs';
import path from 'node:path';
import { prewarmCandidate, prewarmCalculation } from '../scripts/linux/prewarm.mjs';
const linuxOnly = { skip: process.platform !== 'linux' && 'Linux uid/gid and /proc descriptor semantics.' };
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


test('direct root calculator refuses before inspecting any input path', async t => {
  const getuid = process.getuid; process.getuid = () => 0;
  t.after(() => { if (getuid) process.getuid = getuid; else delete process.getuid; });
  const forbidden = new Proxy({}, { get() { assert.fail('Root prewarm inspected input.'); } });
  assert.equal(await prewarmCalculation({ root: forbidden, dataDir: forbidden, warmDirectory: forbidden }), false);
});

// Emulate root-owned captured inputs and service ownership without real root.
// All filesystem reads are real; ownership/permission mutations are recorded.
async function rootCandidateFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { dataDir: path.join(directory, 'live') };
  const dataDir = path.join(directory, 'snapshot/store');
  await mkdir(settings.dataDir);
  await mkdir(path.join(dataDir, 'static'), { recursive: true });
  await writeFile(path.join(dataDir, 'state.json'), '{}');
  await writeFile(path.join(dataDir, 'static/input.json'), '{}');
  await mkdir(path.join(directory, 'scripts/linux'), { recursive: true });
  await writeFile(path.join(directory, 'scripts/linux/prewarm.mjs'), '');
  const changes = [], descriptors = [], service = { uid: 1201, gid: 1202 };
  const io = rootFilesystem(settings.dataDir, { service, changes, descriptors });
  const candidate = { config: { coreRoot: directory, nodePath: process.execPath, datasetId: 'open-f2p' } };
  return { directory, settings, dataDir, candidate, filesystem: io, changes, descriptors, service };
}
function emulateRoot(t) {
  const getuid = process.getuid; process.getuid = () => 0;
  t.after(() => { if (getuid) process.getuid = getuid; else delete process.getuid; });
}
function completedChild(code = 0) {
  const child = new EventEmitter(); child.kill = () => {};
  queueMicrotask(() => child.emit('close', code)); return child;
}
for (const configured of [false, true]) test(`root prewarm uses only the service uid/gid and a read-only snapshot descriptor: configured=${configured}`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  if (configured) Object.assign(f.settings, { serviceUid: f.service.uid, serviceGid: f.service.gid });
  let calls = 0;
  assert.equal(await prewarmCandidate({ ...f, execute(node, args, options) {
    calls++; assert.equal(node, process.execPath);
    assert.equal(options.uid, f.service.uid); assert.notEqual(options.uid, 0);
    assert.equal(options.gid, f.service.gid); assert.equal(options.env.HOME, f.settings.dataDir);
    assert.equal(options.env.RS3_DATASET, 'open-f2p'); assert.equal(options.env.RS3_SIGNIN, 'off');
    assert.equal(options.env.RS3_TASK_WORKER_MODE, 'process');
    assert.equal(args[args.indexOf('--data-dir') + 1], '/proc/self/fd/3');
    assert.equal(args[args.indexOf('--warm-dir') + 1], path.join(f.settings.dataDir, 'warm-store'));
    assert.deepEqual(options.stdio.slice(0, 3), ['ignore', 'ignore', 'ignore']);
    assert(Number.isInteger(options.stdio[3]));
    return completedChild();
  } }), true);
  assert.equal(calls, 1); assert.equal(f.changes.length, 8);
  for (const { file, kind, args } of f.changes) {
    assert(file.startsWith(f.dataDir + path.sep) || file === f.dataDir);
    assert(!file.startsWith(f.settings.dataDir));
    if (kind === 'chown') assert.deepEqual(args, [0, f.service.gid]);
    else assert([0o550, 0o440].includes(args[0]));
  }
  assert(f.descriptors.every(handle => handle.fd === -1));
});
for (const invalid of ['root owner', 'root group', 'symlink', 'partial settings', 'mismatched settings', 'unprotected snapshot']) test(`root prewarm skips an ambiguous identity or unsafe copy: ${invalid}`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  if (invalid === 'root owner') f.service.uid = 0;
  if (invalid === 'root group') f.service.gid = 0;
  if (invalid === 'symlink') {
    await rm(f.settings.dataDir, { recursive: true });
    await filesystem.symlink(f.dataDir, f.settings.dataDir, 'dir');
  }
  if (invalid === 'partial settings') f.settings.serviceUid = f.service.uid;
  if (invalid === 'mismatched settings') Object.assign(f.settings, { serviceUid: f.service.uid + 1, serviceGid: f.service.gid });
  if (invalid === 'unprotected snapshot') {
    const stat = f.filesystem.lstat;
    f.filesystem.lstat = async file => Object.assign(await stat(file), file === path.dirname(f.dataDir) ? { mode: 0o40777 } : {});
  }
  assert.equal(await prewarmCandidate({ ...f, execute() { assert.fail('Unsafe root prewarm spawned.'); } }), false);
  assert.deepEqual(f.changes, []);
});
test('inherited snapshot descriptor reads copied state and static inputs in a real child', linuxOnly, async t => {
  const f = await rootCandidateFixture(t);
  Object.assign(f.service, { uid: process.getuid(), gid: process.getgid() });
  emulateRoot(t);
  await writeFile(path.join(f.directory, 'scripts/linux/prewarm.mjs'), `
    import { readFile } from 'node:fs/promises';
    import { parseArgs } from 'node:util';
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'data-dir': { type: 'string' }, 'warm-dir': { type: 'string' } } });
    for (const name of ['state.json', 'static/input.json']) {
      if (await readFile(values['data-dir'] + '/' + name, 'utf8') !== '{}') process.exit(1);
    }
  `);
  assert.equal(await prewarmCandidate({ ...f, execute(node, args, { uid, gid, ...options }) {
    assert.equal(uid, f.service.uid); assert.equal(gid, f.service.gid);
    // Privilege changes are asserted above; this integration runs as our UID.
    return spawn(node, args, options);
  } }), true);
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('root prewarm timeout kills the child at the 180 second budget and returns a miss', linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started, killed;
  const spawned = new Promise(resolve => { started = resolve; });
  const result = prewarmCandidate({ ...f, execute() {
    const child = new EventEmitter();
    child.kill = signal => { killed = signal; child.emit('close', 0); };
    started(); return child;
  } });
  await spawned;
  t.mock.timers.tick(179999); assert.equal(killed, undefined);
  t.mock.timers.tick(1); assert.equal(await result, false); assert.equal(killed, 'SIGKILL');
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('non-root launcher leaves identity, HOME, input path and stdio unchanged', async t => {
  const f = await rootCandidateFixture(t);
  const getuid = process.getuid; process.getuid = () => f.service.uid;
  t.after(() => { if (getuid) process.getuid = getuid; else delete process.getuid; });
  assert.equal(await prewarmCandidate({ ...f, filesystem: new Proxy({}, { get() { assert.fail('Non-root identity inspection.'); } }),
    execute(node, args, options) {
      assert(!Object.hasOwn(options, 'uid')); assert(!Object.hasOwn(options, 'gid'));
      assert.equal(options.env.HOME, process.env.HOME); assert.equal(options.stdio, 'ignore');
      assert.equal(args[args.indexOf('--data-dir') + 1], f.dataDir);
      return completedChild();
    } }), true);
  assert.deepEqual(f.changes, []);
});

for (const invalid of ['uid', 'supplementary groups']) test(`root spawn guard refuses unexpected ${invalid} before candidate imports`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t);
  Object.assign(f.service, { uid: process.getuid(), gid: process.getgid() });
  if (invalid === 'uid') f.service.uid++;
  emulateRoot(t);
  const marker = path.join(f.directory, 'candidate-loaded');
  await writeFile(path.join(f.directory, 'scripts/linux/prewarm.mjs'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  assert.equal(await prewarmCandidate({ ...f, execute(node, args, { uid, gid, ...options }) {
    const preloads = invalid === 'supplementary groups'
      ? ['--import', 'data:text/javascript,' + encodeURIComponent(`process.getgroups = () => [${gid}, ${gid + 1}];`)] : [];
    return spawn(node, [...preloads, ...args], options);
  } }), false);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

for (const invalid of ['symlink', 'hard link', 'live-store overlap']) test(`root prewarm refuses unsafe snapshot entries without permission changes to live paths: ${invalid}`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  const victim = path.join(f.settings.dataDir, 'victim');
  await writeFile(victim, 'synthetic victim');
  const before = await filesystem.lstat(victim);
  if (invalid === 'symlink') await filesystem.symlink(victim, path.join(f.dataDir, 'linked'));
  if (invalid === 'hard link') await filesystem.link(victim, path.join(f.dataDir, 'linked'));
  if (invalid === 'live-store overlap') f.dataDir = f.settings.dataDir;
  assert.equal(await prewarmCandidate({ ...f, execute() { assert.fail('Unsafe snapshot spawned.'); } }), false);
  assert(f.changes.every(({ file }) => file !== victim && !file.startsWith(f.settings.dataDir)));
  const after = await filesystem.lstat(victim);
  for (const field of ['uid', 'gid', 'mode', 'ino', 'dev']) assert.equal(after[field], before[field]);
  assert.equal(await readFile(victim, 'utf8'), 'synthetic victim');
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('root launcher skips older candidates without a prewarm script before inspecting the store', async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  await rm(path.join(f.directory, 'scripts/linux/prewarm.mjs'));
  assert.equal(await prewarmCandidate({ ...f,
    filesystem: new Proxy({}, { get() { assert.fail('Older candidate inspected the store.'); } }),
    execute() { assert.fail('Older candidate spawned.'); } }), false);
});
