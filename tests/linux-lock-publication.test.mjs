import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { encode, exclusive, json, sha } from '../scripts/linux/files.mjs';

const execute = promisify(execFile);
const linux = { skip: process.platform !== 'linux', timeout: 15000 };
const operatorUrl = new URL('../scripts/linux/operator.mjs', import.meta.url).href;
const bootFile = new URL('../scripts/linux/start-check.mjs', import.meta.url);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'operator-publication-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { service: 'chunk-picker.service', current: path.join(root, 'current.json'),
    dataDir: path.join(root, 'save'), controlDir: path.join(root, 'control'),
    scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups'), minFreeBytes: 0 };
  for (const dir of [settings.dataDir, settings.controlDir, settings.backupDir, path.join(root, 'core')]) await mkdir(dir);
  const config = path.join(root, 'operator.json'), release = path.join(root, 'release.json');
  await writeFile(config, encode(settings));
  const bytes = encode({ coreRoot: path.join(root, 'core'), dataDir: settings.dataDir });
  await writeFile(release, bytes);
  await writeFile(settings.current, encode({ config: { path: release, sha256: sha(bytes) } }));
  await writeFile(path.join(settings.dataDir, 'state.json'), '{"revision":7}\n');
  await writeFile(path.join(root, 'backup-status.json'), encode({ lastSuccessAt: new Date().toISOString() }));
  return { root, settings, config, lock: path.join(settings.controlDir, 'operation.lock') };
}

// Fault hooks live only in this child: production code has no pause switches.
// The real operator/boot paths and flock guard run unchanged. Replace systemctl
// with an inactive synthetic service so the test cannot control a real service.
function operatorChild(t, f, phase = '', fail = false) {
  const code = `import fs from 'node:fs';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { promisify } from 'node:util';
    const phase = process.argv[1], fail = process.argv[2] === 'true';
    const control = ${JSON.stringify(f.settings.controlDir)}, lock = ${JSON.stringify(f.lock)};
    let temp, synced = false, systemCalls = 0;
    async function boundary(label) {
      if (label !== phase) return;
      if (fail) throw Object.assign(new Error('Synthetic publication failure'), { code: label === 'temp-sync' || label === 'directory-sync' ? 'EIO' : 'ENOSPC' });
      process.send({ phase: label, temp, synced });
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    }
    const open = fs.promises.open, rename = fs.promises.rename;
    fs.promises.open = async (file, ...args) => {
      const ownerTemp = String(file).startsWith(lock + '.owner.');
      if (ownerTemp) { temp = String(file); await boundary('open'); }
      const handle = await open(file, ...args);
      if (ownerTemp) {
        const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
        handle.writeFile = async bytes => {
          if (phase === 'partial') { await write(bytes.slice(0, 5)); await boundary('partial'); }
          await write(bytes); await boundary('written');
        };
        handle.sync = async () => { await boundary('temp-sync'); await sync(); synced = true; };
      } else if (String(file) === control && args[0] === 'r') {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { await boundary('directory-sync'); return sync(); };
      }
      return handle;
    };
    fs.promises.rename = async (from, to) => {
      if (String(to) !== lock) return rename(from, to);
      await boundary('durable');
      const result = await rename(from, to);
      await boundary('published');
      return result;
    };
    const systemctl = async (file, args) => {
      if (file !== 'systemctl' || args[0] !== 'show') throw new Error('Unexpected service mutation');
      systemCalls++;
      return { stdout: 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\nControlGroup=\\nTasksCurrent=0\\n', stderr: '' };
    };
    cp.execFile = () => { throw new Error('Unexpected callback command'); };
    cp.execFile[promisify.custom] = systemctl;
    syncBuiltinESMExports();
    const { runOperator } = await import(${JSON.stringify(operatorUrl)});
    try { const result = await runOperator('health'); console.log(JSON.stringify({ result, systemCalls })); }
    catch (error) { console.log(JSON.stringify({ error: error.code, message: error.message, systemCalls })); process.exitCode = 1; }
    process.disconnect();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, phase, String(fail)], {
    env: { ...process.env, RS3_OPERATOR_CONFIG: f.config }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  });
  return { child, exited, output: () => ({ stdout, stderr }) };
}
async function runHealth(t, f, phase, fail) {
  const p = operatorChild(t, f, phase, fail), [code, signal] = await p.exited;
  const { stdout, stderr } = p.output();
  assert.equal(signal, null); assert.equal(stderr, '');
  return { code, ...JSON.parse(stdout) };
}
async function boot(f) {
  return execute(process.execPath, [bootFile.pathname], { env: { ...process.env, RS3_OPERATOR_CONFIG: f.config } });
}

for (const phase of ['partial', 'written', 'durable', 'published']) {
  test(`SIGKILL at ${phase} publication boundary permits the next operator and clean boot`, linux, async t => {
    const f = await fixture(t), p = operatorChild(t, f, phase);
    const [message] = await Promise.race([
      once(p.child, 'message'),
      p.exited.then(() => { assert.fail('Operator exited before fault boundary: ' + JSON.stringify(p.output())); }),
    ]);
    assert.equal(message.phase, phase);
    assert.equal(message.synced, ['durable', 'published'].includes(phase));
    if (phase === 'published') {
      assert.equal((await lstat(f.lock)).nlink, 1, 'published owners remain readable by older tools');
      assert.equal((await json(f.lock)).pid, p.child.pid);
      await assert.rejects(readFile(message.temp), { code: 'ENOENT' });
    } else {
      await assert.rejects(lstat(f.lock), { code: 'ENOENT' });
      if (phase === 'partial') assert.equal((await readFile(message.temp)).length, 5);
      else assert.equal((await json(message.temp)).pid, p.child.pid);
    }
    p.child.kill('SIGKILL');
    assert.deepEqual(await p.exited, [null, 'SIGKILL']);
    if (phase === 'published') await assert.rejects(boot(f));
    else assert.deepEqual(await boot(f), { stdout: '', stderr: '' });
    assert.deepEqual(await runHealth(t, f), { code: 0, result: { skipped: true }, systemCalls: 1 });
    assert.deepEqual(await boot(f), { stdout: '', stderr: '' });
    const names = await readdir(f.settings.controlDir);
    assert.equal(names.some(name => name.includes('.owner.')), false);
    assert.equal(names.filter(name => name.startsWith('stale-operation.lock.')).length, phase === 'published' ? 1 : 0);
    assert.equal(await readFile(path.join(f.settings.dataDir, 'state.json'), 'utf8'), '{"revision":7}\n');
  });
}

for (const phase of ['open', 'partial', 'temp-sync', 'durable', 'directory-sync']) {
  test(`publication error at ${phase} removes owned paths and allows retry`, linux, async t => {
    const f = await fixture(t);
    const result = await runHealth(t, f, phase, true);
    assert.equal(result.code, 1);
    assert.equal(result.error, ['temp-sync', 'directory-sync'].includes(phase) ? 'EIO' : 'ENOSPC');
    assert.equal(result.systemCalls, 0);
    assert.deepEqual(await readdir(f.settings.controlDir), ['operation.lock.recovery']);
    assert.deepEqual(await boot(f), { stdout: '', stderr: '' });
    assert.deepEqual(await runHealth(t, f), { code: 0, result: { skipped: true }, systemCalls: 1 });
  });
}

test('guarded orphan cleanup only unlinks exact publication names without following links', linux, async t => {
  const f = await fixture(t), victim = path.join(f.root, 'keep');
  const temp = () => f.lock + '.owner.' + randomUUID() + '.tmp';
  await writeFile(temp(), 'partial');
  await writeFile(victim, 'keep'); await symlink(victim, temp());
  const directory = temp(); await mkdir(directory); await writeFile(path.join(directory, 'keep'), 'keep');
  const unrelated = [f.lock + '.owner.unrecognized.tmp', f.lock + '.other.' + randomUUID() + '.tmp'];
  for (const file of unrelated) await writeFile(file, 'keep');
  await exclusive(f.lock, async () => { assert.equal((await lstat(f.lock)).nlink, 1); });
  assert.deepEqual((await readdir(f.settings.controlDir)).sort(), [...unrelated, directory, f.lock + '.recovery'].map(file => path.basename(file)).sort());
  assert.equal(await readFile(victim, 'utf8'), 'keep');
  assert.equal(await readFile(path.join(directory, 'keep'), 'utf8'), 'keep');
  await assert.rejects(exclusive(f.lock, () => { throw new Error('Synthetic action failure'); }), /Synthetic action failure/);
  await assert.rejects(lstat(f.lock), { code: 'ENOENT' });
});
