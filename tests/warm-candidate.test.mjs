import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import * as filesystem from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { rootFilesystem, serviceQuery } from './helpers/prewarm.mjs';
import path from 'node:path';
import { prewarmCandidate, prewarmCalculation, serviceIdentity } from '../scripts/linux/prewarm.mjs';
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
  const settings = { dataDir: path.join(directory, 'live'), service: 'chunk-picker.service' };
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
  return { directory, settings, dataDir, candidate, filesystem: io, changes, descriptors, service, queryIdentity: serviceQuery(service) };
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
  if (configured) {
    Object.assign(f.settings, { serviceUid: f.service.uid, serviceGid: f.service.gid });
    f.queryIdentity = serviceQuery({ uid: f.service.uid + 1, gid: f.service.gid + 1 });
  }
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

test('trusted systemd identity resolves the primary group when Group is unset', async () => {
  assert.deepEqual(await serviceIdentity({ service: 'chunk-picker.service' }, serviceQuery(undefined, { group: '' })), { uid: 1201, gid: 1202 });
});
test('explicit service settings win over systemd account names without NSS lookups', async () => {
  const settings = { service: 'chunk-picker.service', serviceUid: 1301, serviceGid: 1302 };
  const query = serviceQuery();
  assert.deepEqual(await serviceIdentity(settings, (command, args, options) => {
    assert.equal(command, '/usr/bin/systemctl'); assert.equal(options.timeout, 5000);
    assert.deepEqual(args, ['show', '--property=User,Group,DynamicUser', '--', settings.service]);
    return query(command, args);
  }), { uid: 1301, gid: 1302 });
});
for (const invalid of ['missing', 'ambiguous unit', 'ambiguous account', 'root uid', 'root gid', 'DynamicUser', 'partial settings', 'invalid number', 'lookup failure']) {
  test(`trusted service identity refuses ${invalid}`, async () => {
    const settings = { service: 'chunk-picker.service' }, service = { uid: 1201, gid: 1202 };
    let query = serviceQuery(service);
    if (invalid === 'missing') query = serviceQuery(service, { user: '' });
    if (invalid === 'ambiguous unit') query = async () => ({ stdout: 'User=prewarm-fixture\nUser=other-fixture\nGroup=prewarm-fixture\nDynamicUser=no' });
    if (invalid === 'ambiguous account') {
      const source = query;
      query = async (command, args) => { const reply = await source(command, args); return command.endsWith('/getent') ? { stdout: reply.stdout.repeat(2) } : reply; };
    }
    if (invalid === 'root uid') service.uid = 0;
    if (invalid === 'root gid') service.gid = 0;
    if (invalid === 'DynamicUser') {
      Object.assign(settings, { serviceUid: service.uid, serviceGid: service.gid });
      query = serviceQuery(service, { dynamic: 'yes' });
    }
    if (invalid === 'partial settings') settings.serviceUid = service.uid;
    if (invalid === 'invalid number') Object.assign(settings, { serviceUid: '1301', serviceGid: service.gid });
    if (invalid === 'lookup failure') query = async () => { throw Error('Synthetic lookup failure.'); };
    await assert.rejects(serviceIdentity(settings, query));
  });
}
for (const swap of ['symlink', 'owner']) test(`data-directory ${swap} swap cannot choose the prewarm identity`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  if (swap === 'symlink') {
    await rm(f.settings.dataDir, { recursive: true });
    const other = path.join(f.directory, 'other'); await mkdir(other);
    await filesystem.symlink(other, f.settings.dataDir, 'dir');
  }
  const stat = f.filesystem.lstat;
  let inspectedOwner = false;
  f.filesystem.lstat = async file => {
    if (path.resolve(file) === f.settings.dataDir) {
      inspectedOwner = true;
      return Object.assign(await filesystem.lstat(file), { uid: 1401, gid: 1402 });
    }
    return stat(file);
  };
  assert.equal(await prewarmCandidate({ ...f, execute(node, args, options) {
    assert.equal(options.uid, f.service.uid); assert.equal(options.gid, f.service.gid);
    return completedChild();
  } }), true);
  assert.equal(inspectedOwner, false, 'Identity must never inspect live ownership.');
});
for (const invalid of ['root uid', 'root gid', 'missing identity', 'ambiguous identity', 'DynamicUser', 'partial settings', 'unprotected snapshot']) test(`root prewarm skips an ambiguous identity or unsafe copy: ${invalid}`, linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  if (invalid === 'root uid') f.service.uid = 0;
  if (invalid === 'root gid') f.service.gid = 0;
  if (invalid === 'missing identity') f.queryIdentity = serviceQuery(f.service, { user: '' });
  if (invalid === 'ambiguous identity') f.queryIdentity = async () => ({ stdout: 'User=prewarm-fixture\nUser=other-fixture\nGroup=prewarm-fixture\nDynamicUser=no\n' });
  if (invalid === 'DynamicUser') f.queryIdentity = serviceQuery(f.service, { dynamic: 'yes' });
  if (invalid === 'partial settings') f.settings.serviceUid = f.service.uid;
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
    // This non-root integration cannot call setgroups. Emulate libuv's group
    // clearing as well as the uid/gid drop; CI runners have extra groups.
    const groups = 'data:text/javascript,' + encodeURIComponent(`process.getgroups = () => [${gid}];`);
    return spawn(node, ['--import', groups, ...args], options);
  } }), true);
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('root prewarm reserves termination time inside the 180 second budget', linuxOnly, async t => {
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
  t.mock.timers.tick(174999); assert.equal(killed, undefined);
  t.mock.timers.tick(1); assert.equal(await result, false); assert.equal(killed, 'SIGKILL');
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('root prewarm counts a slow identity lookup inside the same 180 second budget', linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const query = f.queryIdentity;
  let delayed = false, looked, started, killed;
  const lookedUp = new Promise(resolve => { looked = resolve; });
  f.queryIdentity = (...args) => {
    if (delayed) return query(...args);
    delayed = true; looked();
    return new Promise(resolve => setTimeout(() => resolve(query(...args)), 100000));
  };
  const spawned = new Promise(resolve => { started = resolve; });
  const result = prewarmCandidate({ ...f, execute() {
    const child = new EventEmitter();
    child.kill = signal => { killed = signal; child.emit('close', 0); };
    started(); return child;
  } });
  await lookedUp;
  t.mock.timers.tick(100000);
  await spawned;
  t.mock.timers.tick(74999); assert.equal(killed, undefined);
  t.mock.timers.tick(1); assert.equal(await result, false); assert.equal(killed, 'SIGKILL');
  assert(f.descriptors.every(handle => handle.fd === -1));
});
test('root prewarm abandons a hung identity lookup at the budget without spawning', linuxOnly, async t => {
  const f = await rootCandidateFixture(t); emulateRoot(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let looked, settled = false;
  const lookedUp = new Promise(resolve => { looked = resolve; });
  f.queryIdentity = () => { looked(); return new Promise(() => {}); };
  const result = prewarmCandidate({ ...f, execute() { assert.fail('Spawned after the budget was spent.'); } })
    .then(value => { settled = true; return value; });
  await lookedUp;
  t.mock.timers.tick(174999); await Promise.resolve(); assert.equal(settled, false);
  t.mock.timers.tick(1); assert.equal(await result, false);
  assert.deepEqual(f.changes, []);
});

test('prewarm waits for exit after SIGKILL but never exceeds the outer budget', async t => {
  const f = await rootCandidateFixture(t);
  const getuid = process.getuid; process.getuid = () => f.service.uid;
  t.after(() => { if (getuid) process.getuid = getuid; else delete process.getuid; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started, killed, resolved = false;
  const spawned = new Promise(resolve => { started = resolve; });
  const result = prewarmCandidate({ ...f, execute() {
    const child = new EventEmitter(); child.kill = signal => { killed = signal; };
    started(); return child; // Deliberately never emits close.
  } }).then(value => { resolved = true; return value; });
  await spawned;
  t.mock.timers.tick(175000); await Promise.resolve();
  assert.equal(killed, 'SIGKILL'); assert.equal(resolved, false);
  t.mock.timers.tick(4999); await Promise.resolve(); assert.equal(resolved, false);
  t.mock.timers.tick(1); assert.equal(await result, false);
});

test('prewarm spawn errors with no PID return a miss without signalling', async t => {
  const f = await rootCandidateFixture(t);
  const getuid = process.getuid; process.getuid = () => f.service.uid;
  t.after(() => { if (getuid) process.getuid = getuid; else delete process.getuid; });
  assert.equal(await prewarmCandidate({ ...f, execute() {
    const child = new EventEmitter(); child.kill = () => assert.fail('A failed spawn has no process to signal.');
    queueMicrotask(() => child.emit('error', Error('Synthetic spawn failure.'))); return child;
  } }), false);
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
