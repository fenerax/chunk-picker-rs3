import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { Script } from 'node:vm';
import * as fs from 'node:fs/promises';
import { effects, installEffects, chmod, chown, lstat, symlink } from './helpers/linux-ops-effects.mjs';
import { runToolsHelper } from './helpers/run-tools-helper.mjs';

// The runner supplies the one outer hang guard. Explicit I/O boundaries and
// events drive every case. No process, socket, poll, sleep or native fsync.
test('tools installer contracts with controlled OS effects', async file => {
  file.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.UTC(2026, 0, 1) });
  file.mock.method(globalThis, 'fetch', async () => { throw Error('Network is forbidden in Linux ops contracts'); });
  const restore = installEffects(); file.after(restore);
  const { switchTools, recoverToolsSwitch, exchangePaths, operatorUnitsIdle, toolsInstallCli } = await import('../scripts/linux/tools-install.mjs');
  const { toolsContracts, currentToolsContract } = await import('../scripts/linux/tools-contracts.mjs');
  const { buildTools, verifyTools, toolsClosure } = await import('../scripts/linux/tools-package.mjs');
  const { encode, exists, inventory, json, sha, exclusive } = await import('../scripts/linux/files.mjs');
  const { assertServiceAccess, assertToolsEntrypoints, serviceIdentity } = await import('../scripts/linux/service-access.mjs');
  const { checkStart } = await import('../scripts/linux/start-check.mjs');
  const { lockRelease, prepareBundle, rebaseBundle } = await import('../scripts/release/vps/bundle.mjs');
  const { serviceQuery } = await import('./helpers/prewarm.mjs');
  const account = { uid: 65534, gid: 65534 }, identity = async () => account, idle = async () => {};
  let sequence = 0;

  async function fixture(t) {
    const scratch = await fs.mkdtemp(path.join(tmpdir(), 'tools-install-unit-'));
    await chmod(scratch, 0o755);
    t.after(async () => {
      effects.restart();
      assert.equal(effects.handles.size, 0, 'all descriptors close, including after process loss');
      assert.equal(effects.children.size, 0, 'all synthetic flock children exit');
      assert.equal(path.dirname(scratch), tmpdir());
      await fs.rm(scratch, { recursive: true, force: true });
    });
    const parent = path.join(scratch, 'installed'), controlDir = path.join(scratch, 'control');
    await fs.mkdir(parent); await fs.mkdir(controlDir); await chmod(parent, 0o755);
    return { scratch, parent, toolsRoot: path.join(parent, 'tools'), settings: { controlDir, current: path.join(scratch, 'current.json') } };
  }
  async function packageAt(f, version = currentToolsContract.version) {
    const contract = toolsContracts.find(row => row.version === version);
    const source = path.join(f.scratch, `source-${++sequence}`), pkg = path.join(f.scratch, `package-${sequence}`);
    const diagnostics = new Map(contract.probes.map(([entry, , text]) => [entry, text]));
    const entries = new Set([...contract.closureRoots, ...diagnostics.keys()]);
    for (const entry of entries) {
      const destination = path.join(source, entry); await fs.mkdir(path.dirname(destination), { recursive: true });
      let program = diagnostics.has(entry)
        ? `if (main()) { process.exitCode = 1; process.stderr.write(${JSON.stringify(diagnostics.get(entry))}); }\n` : 'void 0;\n';
      if (entry === contract.closureRoots[0]) for (const extra of entries) {
        if (!contract.closureRoots.includes(extra)) program += `void new URL(${JSON.stringify(path.posix.relative(path.posix.dirname(entry), extra))}, import.meta.url);\n`;
      }
      await fs.writeFile(destination, program, { mode: 0o644 });
    }
    let manifest;
    if (version === currentToolsContract.version) manifest = await buildTools(source, pkg);
    else {
      await fs.cp(source, pkg, { recursive: true });
      const body = { format: 'picker-tools-v1', ...(version === 1 ? {} : { contractVersion: version }),
        ...await toolsClosure(pkg, contract.closureRoots) };
      manifest = { ...body, toolsIdentity: sha(encode(body)) };
      await fs.writeFile(path.join(pkg, 'tools-manifest.json'), encode(manifest)); await verifyTools(pkg);
    }
    return { pkg, source, manifest };
  }
  async function legacy(f, pkg) {
    await fs.cp(pkg, f.toolsRoot, { recursive: true }); await fs.rm(path.join(f.toolsRoot, 'tools-manifest.json'));
    for (const row of await inventory(f.toolsRoot)) if (!row.directory) {
      const name = path.join(f.toolsRoot, row.path);
      await fs.writeFile(name, (await fs.readFile(name, 'utf8')).replaceAll('main()', 'legacyMain()'));
    }
    await fs.writeFile(path.join(f.toolsRoot, 'legacy.mjs'), 'void 0;\n');
  }
  const install = async (f, options = {}) => {
    const result = await switchTools({ settings: f.settings, toolsRoot: f.toolsRoot, identity, idle, ...options });
    assert.equal(result.writerRestarted, false);
    const receipt = await json(result.receiptFile);
    assert.equal(receipt.writerRestarted, false); assert.equal(receipt.result, 'success');
    assert.equal(receipt.startedAt, '2026-01-01T00:00:00.000Z'); assert.equal(receipt.completedAt, receipt.startedAt);
    return result;
  };
  const recover = (f, options = {}) => recoverToolsSwitch({ settings: f.settings, toolsRoot: f.toolsRoot, identity, idle, ...options });
  const gates = async (f, pending) => {
    for (const name of ['tools-transaction.json', 'maintenance.json']) assert.equal(await exists(path.join(f.settings.controlDir, name)), pending, name);
    assert.equal(await exists(path.join(f.settings.controlDir, 'operation.lock')), false);
  };
  const selected = async (f, expected) => {
    const root = await fs.realpath(f.toolsRoot); assert.equal((await verifyTools(root)).toolsIdentity, expected); return root;
  };

  await file.test('helper cancellation and errors settle only after child close', async () => {
    for (const cancel of [true, false]) {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
      const controller = new AbortController(), progress = []; let options, finished = false;
      const result = runToolsHelper('synthetic-helper.mjs', { signal: controller.signal, report: text => progress.push(text) }, {
        spawn: (command, args, value) => { options = value; assert.ok(args.includes('synthetic-helper.mjs')); return child; },
      }).catch(error => error).then(value => { finished = true; return value; });
      child.stderr.write('ready'); assert.deepEqual(progress, ['ready']); assert.equal(options.timeout, undefined);
      if (cancel) controller.abort(Error('outer cancellation')); else child.emit('error', Error('launch failed'));
      await Promise.resolve(); assert.equal(finished, false);
      if (cancel) assert.equal(child.stdin.writableEnded, true);
      child.emit('close', 125, null);
      assert.equal((await result).message, cancel ? 'outer cancellation' : 'launch failed'); assert.equal(child.stdin.writableEnded, true);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    }
  });
  await file.test('idle gate queries only the two operator units and refuses active or ambiguous states', async () => {
    const calls = [];
    await operatorUnitsIdle(async (...args) => { calls.push(args); return { stdout: 'ActiveState=inactive\nSubState=dead\nMainPID=0\n' }; });
    assert.deepEqual(calls.map(row => row[1].at(-1)), ['chunk-picker-backup.service', 'chunk-picker-health.service']);
    for (const [command, args, options] of calls) {
      assert.equal(command, '/usr/bin/systemctl'); assert.equal(args.at(-2), '--');
      assert.deepEqual(options.env, { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' });
    }
    for (const stdout of ['ActiveState=active\nSubState=running\nMainPID=1', 'ActiveState=inactive\nSubState=dead', 'ActiveState=inactive\nSubState=running\nMainPID=0']) {
      await assert.rejects(operatorUnitsIdle(async () => ({ stdout })), { code: 'TOOLS_ACTIVE-RUN' });
    }
  });
  await file.test('historical archive identity and v1/v2/current install, upgrade, verify and rollback contracts', async t => {
    const archive = await fs.readFile(new URL('./fixtures/tools-128/package.tar.gz', import.meta.url));
    assert.equal(sha(archive), 'c0907c9ef7b14e29a94400afdb88edceb3e75131af242568f43418f2a417bbb9');
    const f = await fixture(t), frozen = path.join(f.scratch, 'frozen-128');
    await fs.mkdir(frozen);
    const tar = gunzipSync(archive); let historical;
    for (let offset = 0; offset + 512 <= tar.length;) {
      const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, '');
      const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
      if (!name) break;
      const relative = name.replace(/^\.\//, '').replace(/\/$/, '');
      assert(!path.posix.isAbsolute(relative) && !relative.split('/').includes('..'));
      const target = path.join(frozen, relative), type = tar[offset + 156];
      if (type === 53) await fs.mkdir(target, { recursive: true, mode: 0o755 });
      else {
        assert(type === 0 || type === 48, 'frozen archive contains only directories and ordinary files');
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        const bytes = tar.subarray(offset + 512, offset + 512 + size);
        await fs.writeFile(target, bytes, { mode: 0o644 });
        if (relative === 'tools-manifest.json') historical = JSON.parse(bytes);
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.equal(historical.toolsIdentity, '79eb28369aa720d256d64ba088de6600cbc13522d81660bdaf9264c9632bc94c');
    assert.equal(historical.files.length, 49); assert.equal(Object.hasOwn(historical, 'contractVersion'), false);
    assert.deepEqual(await verifyTools(frozen), historical);
    // The process seam knows these immutable ESM programs, not today's v1
    // contract. Freeze their refusal responses from the archived probe table;
    // changed bytes or a newly required invocation cannot borrow a response.
    for (const row of historical.files) if (row.path.endsWith('.mjs')) {
      effects.programs.set(await fs.readFile(path.join(frozen, row.path), 'utf8'), new Map());
    }
    const checks = new Script((await fs.readFile(path.join(frozen, 'scripts/linux/entrypoint-checks.mjs'), 'utf8'))
      .replaceAll('export const ', 'const ') + '\ntoolsCliChecks;').runInNewContext();
    for (const [entry, args, diagnostic] of checks) {
      effects.programs.get(await fs.readFile(path.join(frozen, entry), 'utf8'))
        .set(JSON.stringify(args), { code: 1, stdout: '', stderr: diagnostic + '\n' });
    }
    const latest = await packageAt(f);
    for (const version of [1, 2]) {
      const old = version === 1 ? { pkg: frozen, manifest: historical } : await packageAt(f, version);
      assert.equal(old.manifest.contractVersion, version === 1 ? undefined : 2);
      if (version === 2) assert(!old.manifest.entries.includes('scripts/linux/inflate-owned-format-1.mjs'));
      if (!await exists(f.toolsRoot)) await legacy(f, old.pkg);
      await install(f, { packageRoot: old.pkg });
      if (version === 1) assert.equal((await verifyTools(await fs.realpath(f.toolsRoot))).toolsIdentity, historical.toolsIdentity);
      const oldRoot = await selected(f, old.manifest.toolsIdentity), before = await inventory(oldRoot);
      const upgrade = await install(f, { packageRoot: latest.pkg }); await selected(f, latest.manifest.toolsIdentity);
      await install(f, { rollbackReceipt: upgrade.receiptFile });
      assert.equal(await selected(f, old.manifest.toolsIdentity), oldRoot); assert.deepEqual(await inventory(oldRoot), before);
      assert.equal((await install(f, { rollbackReceipt: upgrade.receiptFile })).alreadyCompleted, true);
      assert.equal((await recover(f)).result, 'no-pending-switch'); await gates(f, false);
    }
  });
  await file.test('directory migration retains bytes and receipts; linked updates and legacy rollback select the right paths', async t => {
    const f = await fixture(t), { pkg, manifest } = await packageAt(f); await legacy(f, pkg);
    const before = await inventory(f.toolsRoot), oldUmask = process.umask(0o077); let installed;
    try { installed = await install(f, { packageRoot: pkg }); } finally { process.umask(oldUmask); }
    assert.equal((await lstat(path.join(f.parent, 'tools-versions'))).mode & 0o777, 0o755);
    const receipt = await json(installed.receiptFile);
    assert.deepEqual(await inventory(receipt.previous.root), before); await selected(f, manifest.toolsIdentity);
    const restored = await install(f, { rollbackReceipt: installed.receiptFile });
    assert.equal((await lstat(f.toolsRoot)).isSymbolicLink(), false); assert.deepEqual(await inventory(f.toolsRoot), before);
    assert.equal((await install(f, { rollbackReceipt: installed.receiptFile })).receiptFile, restored.receiptFile);
    const next = await install(f, { packageRoot: pkg });
    const update = await install(f, { packageRoot: pkg, exchange: () => { throw Error('unnecessary exchange'); } });
    await install(f, { rollbackReceipt: update.receiptFile });
    const nextReceipt = await json(next.receiptFile); await fs.writeFile(path.join(nextReceipt.previous.root, 'legacy.mjs'), 'changed');
    await assert.rejects(install(f, { rollbackReceipt: next.receiptFile }), { code: 'TOOLS_PREVIOUS-HASHES' }); await gates(f, false);
  });
  await file.test('busy units, live/malformed locks and every transaction fence refuse before staging', async t => {
    const f = await fixture(t), { pkg } = await packageAt(f); await legacy(f, pkg);
    const before = await inventory(f.toolsRoot), lock = path.join(f.settings.controlDir, 'operation.lock');
    await assert.rejects(install(f, { packageRoot: pkg, idle: () => { throw Error('busy'); } }), /busy/);
    const refuseBusy = async () => {
      const bytes = await fs.readFile(lock);
      await assert.rejects(install(f, { packageRoot: pkg }), { code: 'EEXIST' });
      await assert.rejects(install(f, { rollbackReceipt: path.join(f.scratch, 'unused.json') }), { code: 'EEXIST' });
      await assert.rejects(recover(f), { code: 'EEXIST' }); assert.deepEqual(await fs.readFile(lock), bytes);
    };
    await exclusive(lock, refuseBusy); await fs.writeFile(lock, '{}'); await refuseBusy(); await fs.rm(lock);
    for (const [name, code] of [['maintenance.json', 'TOOLS_MAINTENANCE'], ['activation.json', 'TOOLS_TRANSACTION'],
      ['start-permit.json', 'TOOLS_TRANSACTION'], ['transaction.json', 'TOOLS_TRANSACTION'], ['tools-transaction.json', 'TOOLS_TRANSACTION']]) {
      const target = path.join(f.settings.controlDir, name); await fs.writeFile(target, '{}');
      await assert.rejects(install(f, { packageRoot: pkg }), { code }); assert.equal(await fs.readFile(target, 'utf8'), '{}'); await fs.rm(target);
    }
    assert.deepEqual(await inventory(f.toolsRoot), before); assert.equal(await exists(path.join(f.parent, 'tools-versions')), false);
  });
  await file.test('access, ownership and ancestor drift refuse without changing selection', async t => {
    const f = await fixture(t), { pkg } = await packageAt(f); await legacy(f, pkg);
    const installed = await install(f, { packageRoot: pkg }), receipt = await json(installed.receiptFile);
    for (const [name, mode, reset] of [[receipt.previous.root, 0o700, 0o755], [path.join(receipt.previous.root, 'legacy.mjs'), 0o600, 0o644], [f.parent, 0o700, 0o755]]) {
      await chmod(name, mode); await assert.rejects(install(f, { rollbackReceipt: installed.receiptFile }), { code: 'TOOLS_ACCESS' });
      assert.equal(await fs.realpath(f.toolsRoot), receipt.installed.root); await chmod(name, reset);
    }
    const entry = path.join(receipt.installed.root, 'scripts/linux/serve.mjs'); await chmod(entry, 0o600);
    await assert.rejects(install(f, { packageRoot: pkg }), { code: 'TOOLS_ACCESS' }); await chmod(entry, 0o644);
    for (const name of [f.parent, receipt.installed.root, entry]) {
      const mode = (await lstat(name)).mode & 0o777; await chmod(name, mode | 0o022);
      await assert.rejects(install(f, { packageRoot: pkg }), { code: 'TOOLS_OWNERSHIP' }); await chmod(name, mode);
    }
    await chown(entry, 1234, 1234); await assert.rejects(install(f, { packageRoot: pkg }), { code: 'TOOLS_OWNERSHIP' }); await chown(entry, 0, 0);
    await gates(f, false);
  });
  await file.test('unknown and forged contracts, no-op CLIs and empty/partial legacy rollbacks refuse', async t => {
    const f = await fixture(t), old = await packageAt(f, 1), latest = await packageAt(f); await legacy(f, old.pkg);
    await install(f, { packageRoot: old.pkg }); const before = await fs.realpath(f.toolsRoot);
    const manifestFile = path.join(old.pkg, 'tools-manifest.json'), original = await fs.readFile(manifestFile);
    for (const change of [body => { body.contractVersion = 999; }, body => { body.entries.pop(); }, body => { body.entries.push('scripts/linux/notify.mjs'); }]) {
      const { toolsIdentity, ...body } = JSON.parse(original); change(body);
      await fs.writeFile(manifestFile, encode({ ...body, toolsIdentity: sha(encode(body)) }));
      await assert.rejects(install(f, { packageRoot: old.pkg }), { code: 'TOOLS_HASH' });
      assert.equal(await fs.realpath(f.toolsRoot), before); await gates(f, false);
    }
    await fs.writeFile(manifestFile, original);
    await fs.writeFile(path.join(latest.source, 'scripts/linux/operator.mjs'), 'void 0;\n');
    const noOp = path.join(f.scratch, 'no-op'); await buildTools(latest.source, noOp);
    await assert.rejects(install(f, { packageRoot: noOp }), { code: 'TOOLS_ENTRYPOINT' });
    assert.equal(await fs.realpath(f.toolsRoot), before); await gates(f, false);
    for (const partial of [false, true]) {
      const other = await fixture(t);
      if (partial) { await legacy(other, old.pkg); await fs.rm(path.join(other.toolsRoot, 'scripts/linux/operator.mjs')); }
      else await fs.mkdir(other.toolsRoot);
      const upgrade = await install(other, { packageRoot: old.pkg });
      await assert.rejects(install(other, { rollbackReceipt: upgrade.receiptFile }), { code: 'TOOLS_ENTRYPOINT' });
      assert.equal((await lstat(other.toolsRoot)).isSymbolicLink(), true); await gates(other, false);
    }
  });
  await file.test('exchange failures keep start fences; recovery handles directory/rollback exchanges and multi-picker dead owners', async t => {
    const f = await fixture(t), { pkg } = await packageAt(f); await legacy(f, pkg);
    const before = await inventory(f.toolsRoot); let fail = true;
    const exchange = async (...args) => { await exchangePaths(...args); if (fail) { fail = false; throw Error('Interrupted after exchange'); } };
    await assert.rejects(install(f, { packageRoot: pkg, exchange }), /Interrupted/); await gates(f, true);
    await assert.rejects(checkStart(f.settings), /Tools transaction/);
    await assert.rejects(install(f, { packageRoot: pkg }), { code: 'TOOLS_MAINTENANCE' });
    await fs.writeFile(path.join(f.settings.controlDir, 'operation.lock'), encode({ pid: 900000001, host: hostname() })); fail = true;
    await assert.rejects(recover(f, { settings: { ...f.settings, multiPicker: {} }, exchange }), /Interrupted/);
    const recovery = await recover(f); assert.equal(recovery.writerRestarted, false);
    assert.equal((await lstat(f.toolsRoot)).isSymbolicLink(), false); assert.deepEqual(await inventory(f.toolsRoot), before);
    const migrated = await install(f, { packageRoot: pkg }); fail = true;
    await assert.rejects(install(f, { rollbackReceipt: migrated.receiptFile, exchange }), /Interrupted/);
    assert.equal((await lstat(f.toolsRoot)).isSymbolicLink(), false);
    await recover(f); assert.equal((await lstat(f.toolsRoot)).isSymbolicLink(), true);
    await install(f, { rollbackReceipt: migrated.receiptFile }); await gates(f, false);
  });
  await file.test('process loss at each journal boundary preserves receipt/selection commit rules and reclaims dead locks', async t => {
    for (const action of ['install', 'rollback']) for (const point of ['before-journal', 'after-journal', 'after-selection', 'after-receipt', 'after-commit']) {
      for (const route of point === 'before-journal' || point === 'after-commit' ? ['retry', 'recover'] : ['recover']) {
        const f = await fixture(t), { pkg } = await packageAt(f); await legacy(f, pkg);
        const options = action === 'install' ? { packageRoot: pkg } : { rollbackReceipt: (await install(f, { packageRoot: pkg })).receiptFile };
        const beforeRoot = await fs.realpath(f.toolsRoot), before = await inventory(beforeRoot);
        effects.hook = async ({ operation, file: name, stage }) => {
          const match = point === 'before-journal' ? operation === 'open' && stage === 'before' && /tools-transaction\.json\..*\.tmp$/.test(name)
            : point === 'after-journal' ? operation === 'rename' && stage === 'after' && name.includes('maintenance.json.')
              : point === 'after-selection' ? operation === 'sync' && stage === 'before' && name === f.parent && await fs.realpath(f.toolsRoot) !== beforeRoot
                : point === 'after-receipt' ? operation === 'rename' && stage === 'after' && /tools-receipt-.*\.json\..*\.tmp$/.test(name)
                  : operation === 'rm' && stage === 'after' && name === path.join(f.settings.controlDir, 'tools-transaction.json');
          if (match) effects.crashed = true;
        };
        await assert.rejects(install(f, options), { code: 'TEST_PROCESS_LOST' }, `${action} ${point} ${route}`);
        effects.restart(); assert(await exists(path.join(f.settings.controlDir, 'operation.lock')));
        const pending = !['before-journal', 'after-commit'].includes(point);
        assert.equal(await exists(path.join(f.settings.controlDir, 'tools-transaction.json')), pending);
        const after = await inventory(await fs.realpath(f.toolsRoot)); if (point === 'before-journal') assert.deepEqual(after, before);
        const versions = path.join(f.parent, 'tools-versions'), prepared = await fs.readdir(versions);
        if (route === 'retry') {
          const result = await install(f, options);
          if (action === 'rollback' && point === 'after-commit') assert.equal(result.alreadyCompleted, true);
        }
        let output = '', errors = '';
        assert.equal(await toolsInstallCli(['recover', f.toolsRoot], { settings: async () => f.settings,
          recover: options => recoverToolsSwitch({ ...options, idle, identity }), stdout: text => { output += text; }, stderr: text => { errors += text; } }), 0, errors);
        const status = JSON.parse(output); assert.equal(status.writerRestarted, false);
        if (pending) {
          assert.equal((await json(status.receiptFile)).result, 'recovered');
          assert.deepEqual(await inventory(await fs.realpath(f.toolsRoot)), before);
        } else {
          assert.equal(status.result, 'no-pending-switch');
          if (route === 'recover') assert.deepEqual(await inventory(status.selection.root), after);
          if (action === 'install' && point === 'before-journal' && route === 'recover') assert.equal(status.receiptFile, null);
          else assert.equal((await json(status.receiptFile)).result, 'success');
        }
        for (const name of prepared) assert(await exists(path.join(versions, name)), 'prepared trees remain for inspection');
        await gates(f, false);
        if (route === 'recover') await install(f, options);
        assert.equal((await lstat(f.toolsRoot)).isSymbolicLink(), action === 'install');
      }
    }
  });
  await file.test('no-journal recovery validates gates, restore progress, ownership and immutable receipts', async t => {
    const f = await fixture(t), { pkg } = await packageAt(f); await fs.cp(pkg, f.toolsRoot, { recursive: true });
    for (const [name, code] of [['maintenance.json', 'TOOLS_MAINTENANCE'], ['activation.json', 'TOOLS_TRANSACTION'],
      ['start-permit.json', 'TOOLS_TRANSACTION'], ['transaction.json', 'TOOLS_TRANSACTION']]) {
      const target = path.join(f.settings.controlDir, name); await fs.writeFile(target, '{}');
      await assert.rejects(recover(f), { code }); assert(await exists(target)); await fs.rm(target);
    }
    const progress = path.join(f.settings.controlDir, 'service-restore/progress.json'); await fs.mkdir(path.dirname(progress));
    await fs.writeFile(progress, '{"phase":"copying"}'); await assert.rejects(recover(f), { code: 'TOOLS_TRANSACTION' });
    await fs.writeFile(progress, '{"phase":"complete"}');
    await chmod(f.toolsRoot, 0o777); await assert.rejects(recover(f), { code: 'TOOLS_OWNERSHIP' }); await chmod(f.toolsRoot, 0o755);
    const receipt = path.join(f.settings.controlDir, 'tools-receipt-00000000-0000-0000-0000-000000000000.json');
    await fs.writeFile(receipt, '{'); await assert.rejects(recover(f), { code: 'TOOLS_RECEIPT' }); await fs.rm(receipt);
    await symlink(path.join(pkg, 'tools-manifest.json'), receipt); await assert.rejects(recover(f), { code: 'TOOLS_RECEIPT' });
  });
  await file.test('unit identity overrides cannot authorize install or rollback, and empty probe sets refuse', async t => {
    const f = await fixture(t), { pkg } = await packageAt(f); await legacy(f, pkg);
    const settings = { ...f.settings, service: 'chunk-picker.service', serviceUid: account.uid, serviceGid: account.gid };
    const forged = () => serviceIdentity(settings, serviceQuery({ uid: 1201, gid: 1202 }));
    await assert.rejects(install(f, { settings, packageRoot: pkg, identity: forged }), { code: 'TOOLS_ACCESS' });
    const upgrade = await install(f, { packageRoot: pkg });
    await assert.rejects(install(f, { settings, rollbackReceipt: upgrade.receiptFile, identity: forged }), { code: 'TOOLS_ACCESS' });
    await assert.rejects(assertToolsEntrypoints(f.toolsRoot, account, []), { code: 'TOOLS_ENTRYPOINT' }); await gates(f, false);
  });
  await file.test('release groups and bundle receipts require resolved service access, syntax and traversable ancestors', async t => {
    const f = await fixture(t), releases = path.join(f.scratch, 'releases'), candidate = path.join(releases, 'candidate');
    await fs.mkdir(releases); await fs.mkdir(candidate); await fs.writeFile(path.join(candidate, 'entry.mjs'), 'void 0;');
    await lockRelease(candidate, 0); await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' });
    await lockRelease(candidate, account.gid); await assertServiceAccess(candidate, account, ['entry.mjs']);
    await chmod(releases, 0o700); await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' }); await chmod(releases, 0o755);
    await fs.writeFile(path.join(candidate, 'entry.mjs'), 'export ???'); await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' });
    const seed = path.join(f.scratch, 'seed'), transport = path.join(f.scratch, 'transport');
    for (const name of ['core/app', 'packs', 'addons']) await fs.mkdir(path.join(seed, name), { recursive: true });
    await fs.writeFile(path.join(seed, 'core/app/server.mjs'), 'void 0;'); await fs.writeFile(path.join(seed, 'profile.json'), '{}');
    const configFile = path.join(seed, 'config.json'), dataDir = path.join(f.scratch, 'synthetic-game');
    const config = encode({ coreRoot: path.join(seed, 'core'), dataDir, packs: {} }); await fs.writeFile(configFile, config);
    await fs.writeFile(f.settings.current, encode({ config: { path: configFile, sha256: sha(config) } }));
    await fs.mkdir(path.join(transport, 'scripts/linux'), { recursive: true });
    await fs.writeFile(path.join(transport, 'scripts/linux/runtime.mjs'),
      `export { readRelease, assertServiceAccess } from ${JSON.stringify(new URL('../scripts/linux/runtime.mjs', import.meta.url).href)};\n`
      + `import { serviceIdentity as resolve } from ${JSON.stringify(new URL('../scripts/linux/prewarm.mjs', import.meta.url).href)};\n`
      + `import { serviceQuery } from ${JSON.stringify(new URL('./helpers/prewarm.mjs', import.meta.url).href)};\n`
      + `export const serviceIdentity = settings => resolve(settings, serviceQuery(${JSON.stringify(account)}));\n`);
    const operator = path.join(f.scratch, 'operator.json'), settings = { service: 'chunk-picker.service', current: f.settings.current, dataDir };
    await fs.writeFile(operator, encode(settings));
    const upload = path.join(f.scratch, 'upload'), target = path.join(releases, 'rebased');
    await prepareBundle(seed, upload); await rebaseBundle(upload, target, operator, transport);
    assert.equal((await lstat(target)).gid, account.gid); await assertServiceAccess(target, account, ['core/app/server.mjs']); assert(await exists(path.join(upload, 'verified.json')));
    for (const reason of ['forged', 'ancestor']) {
      const other = path.join(f.scratch, reason); await prepareBundle(seed, other);
      if (reason === 'forged') await fs.writeFile(operator, encode({ ...settings, serviceUid: 1201, serviceGid: 1202 }));
      else { await fs.writeFile(operator, encode(settings)); await chmod(releases, 0o700); }
      await assert.rejects(rebaseBundle(other, path.join(releases, reason), operator, transport), reason === 'forged' ? /override differs/ : { code: 'TOOLS_ACCESS' });
      assert.equal(await exists(path.join(other, 'verified.json')), false); await chmod(releases, 0o755);
    }
  });
  assert(effects.syncs.length > 0, 'durability calls still execute through the controlled boundary');
});
