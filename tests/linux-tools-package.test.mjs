import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { toolsClosure, buildTools, verifyTools, toolsEntrypoints } from '../scripts/linux/tools-package.mjs';
import { cleanToolsEvidence, operatorUnitsIdle, toolsInstallCli } from '../scripts/linux/tools-install.mjs';
import { phaseReceipt } from '../scripts/linux/phases.mjs';
import { scratchHostGuard, freshHostGuard } from '../scripts/linux/scratch-rehearsal.mjs';
import { reviewRefusal } from '../scripts/release/vps/review.mjs';
import { releaseVps } from '../scripts/release/vps/release.mjs';
import { encode, exists, json, sha } from '../scripts/linux/files.mjs';
import { runtimeCliChecks, toolsCliChecks } from '../scripts/linux/entrypoint-checks.mjs';
import { buildLegacyTools, verifyLegacyTools } from '../scripts/linux/legacy-tools.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const root = path.join(repo, '.local', 'tools-package-tests'); await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(path.join(root, 'run-'));
  t.after(async () => { assert(path.relative(root, scratch).startsWith('run-')); await rm(scratch, { recursive: true, force: true }); });
  return scratch;
}
async function sourceCopy(root) {
  const source = path.join(root, 'source'), closure = await toolsClosure(repo);
  for (const row of closure.files) {
    const file = path.join(source, row.path); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await readFile(path.join(repo, row.path)));
  }
  return { source, closure };
}
test('package is the exact runtime closure, including unit and child entrypoints; it loads without checkout fallbacks', async t => {
  const scratch = await fixture(t), { source, closure } = await sourceCopy(scratch), output = path.join(scratch, 'package');
  const manifest = await buildTools(source, output);
  assert.deepEqual(manifest.files, closure.files);
  for (const module of ['notify', 'monitor', 'offhost-backup', 'recovery-bundle', 'restic', 'ops-status', 'scratch-alerts', 'staging', 'bootstrap-alerts']) assert(manifest.files.some(row => row.path === 'scripts/linux/' + module + '.mjs'));
  assert(!manifest.files.some(row => row.path === 'app/server.mjs'));
  assert(manifest.files.some(row => row.path === 'app/tasks/warm-store.mjs'));
  for (const unit of ['chunk-picker.service', 'chunk-picker-backup.service', 'chunk-picker-health.service', 'chunk-picker-monitor.service', 'chunk-picker-offhost.service', 'chunk-picker-notify@.service']) {
    const text = await readFile(path.join(repo, 'scripts/linux/systemd', unit), 'utf8');
    for (const match of text.matchAll(/\/opt\/chunk-picker\/tools\/([^\s]+)/g)) assert(toolsEntrypoints.includes(match[1]));
  }
  const script = `import {registerHooks} from 'node:module'; import {pathToFileURL,fileURLToPath} from 'node:url';
    import path from 'node:path'; const root=${JSON.stringify(output)};
    registerHooks({load(url,c,next){if(url.startsWith('file:') && !fileURLToPath(url).startsWith(root+path.sep)) throw Error('Import outside package');return next(url,c);}});
    for(const file of ${JSON.stringify(toolsEntrypoints.filter(name => !name.endsWith('/serve.mjs')))}) await import(pathToFileURL(path.join(root,file)));`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe', windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', RS3_DATASET: 'open-starter' } });
  await writeFile(path.join(output, 'scripts/linux/unlisted.mjs'), 'export {};');
  await assert.rejects(verifyTools(output), /hashes differ/);
});
test('new static, dynamic, template and child imports cannot escape or silently disappear from the closure', async t => {
  const scratch = await fixture(t), { source } = await sourceCopy(scratch);
  const entry = path.join(source, 'scripts/linux/operator.mjs'), original = await readFile(entry, 'utf8');
  for (const edge of ["import '../../outside.mjs';", "await import('../../outside.mjs');", "`${await import('../../outside.mjs')}`;",
    "await import(process.env.UNMODELED_IMPORT);", "new URL('./missing-child.mjs', import.meta.url);",
    "new URL(process.env.UNMODELED_CHILD, import.meta.url);"] ) {
    await writeFile(entry, original + '\n' + edge);
    await assert.rejects(toolsClosure(source));
  }
  await writeFile(entry, original + "\nimport '../../../outside.mjs';");
  await writeFile(path.join(scratch, 'outside.mjs'), 'export {};');
  await assert.rejects(toolsClosure(source), /escapes/);
});

test('all installed CLI and unit entrypoints act through a symlink, including maintenance refusal', async t => {
  const scratch = await fixture(t), output = path.join(scratch, 'package'), alias = path.join(scratch, 'tools');
  const { source: copied } = await sourceCopy(scratch);
  const manifest = await buildTools(copied, output);
  await symlink(output, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const controlDir = path.join(scratch, 'control'); await mkdir(controlDir);
  const current = path.join(scratch, 'current.json'), config = path.join(scratch, 'operator.json');
  await writeFile(current, '{}'); await writeFile(path.join(controlDir, 'maintenance.json'), '{}');
  await writeFile(config, encode({ service: 'chunk-picker.service', current, controlDir,
    dataDir: path.join(scratch, 'game'), scratchRoot: path.join(scratch, 'scratch'), backupDir: path.join(scratch, 'backups') }));
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', RS3_OPERATOR_CONFIG: config };
  const checked = new Set(toolsCliChecks.map(row => row[0]));
  for (const row of manifest.files.filter(row => row.path.endsWith('.mjs'))) {
    const source = await readFile(path.join(output, row.path), 'utf8');
    if (/if\s*\(isMain\(import\.meta\.url\)/.test(source)) assert(checked.has(row.path), 'Missing CLI behavior check: ' + row.path);
    if (row.path.startsWith('scripts/linux/') || row.path.startsWith('scripts/release/vps/') && row.path !== 'scripts/release/vps/entrypoint.mjs')
      assert(!/process\.argv\[1\].*===.*(?:fileURLToPath|import\.meta\.url)/.test(source), row.path);
  }
  for (const [entry, args, diagnostic] of toolsCliChecks) {
    let failed = false;
    const base = entry.startsWith('scripts/linux/') || entry.startsWith('scripts/release/vps/') ? alias : output;
    try { execFileSync(process.execPath, [path.join(base, entry), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000 }); }
    catch (error) {
      failed = true; assert.equal(error.status, 1, entry); assert.equal(error.stdout.toString(), '', entry);
      assert(error.stderr.toString().startsWith(diagnostic), entry + ': ' + error.stderr);
    }
    assert(failed, entry + ' silently exited without its action');
  }
  const verified = JSON.parse(execFileSync(process.execPath, [path.join(alias, 'scripts/linux/tools-package.mjs'), 'verify', output],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  assert.equal(verified.toolsIdentity, manifest.toolsIdentity);
  for (const unit of ['chunk-picker.service', 'chunk-picker-backup.service', 'chunk-picker-health.service']) {
    const source = await readFile(path.join(repo, 'scripts/linux/systemd', unit), 'utf8');
    for (const match of source.matchAll(/\/opt\/chunk-picker\/tools\/([^\s]+)/g)) {
      assert(checked.has(match[1]), unit);
      assert(runtimeCliChecks.some(row => row[0] === match[1]), 'Legacy rollback must require ' + match[1]);
    }
  }
});

test('detached release transport includes the shared main helper and executes its CLI', async t => {
  const scratch = await fixture(t), upload = path.join(scratch, 'upload'); await mkdir(upload);
  for (const name of ['bundle.mjs', 'entrypoint.mjs']) await writeFile(path.join(upload, name), await readFile(path.join(repo, 'scripts/release/vps', name)));
  let refused = false;
  try { execFileSync(process.execPath, [path.join(upload, 'bundle.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
  catch (error) {
    refused = true; assert.equal(error.status, 1); assert.equal(error.stdout.toString(), '');
    assert.equal(error.stderr.toString(), 'Candidate preparation refused; inspect private staging evidence.\n');
  }
  assert(refused);
});
test('all refusal gates run before switching; malformed and incomplete evidence stays fenced', async t => {
  const controlDir = await fixture(t), settings = { controlDir };
  for (const [name, category] of [['operation.lock', 'lock'], ['maintenance.json', 'maintenance'],
    ['activation.json', 'transaction'], ['transaction.json', 'transaction'], ['start-permit.json', 'transaction'], ['tools-transaction.json', 'transaction']]) {
    await writeFile(path.join(controlDir, name), '{}');
    await assert.rejects(cleanToolsEvidence(settings), error => error.message.includes(category));
    await rm(path.join(controlDir, name));
  }
  await mkdir(path.join(controlDir, 'service-restore'));
  await writeFile(path.join(controlDir, 'service-restore/progress.json'), '{"phase":"copying"}');
  await assert.rejects(cleanToolsEvidence(settings), /transaction/);
  await writeFile(path.join(controlDir, 'service-restore/progress.json'), '{"phase":"complete"}');
  await cleanToolsEvidence(settings);
  for (const state of ['active', 'activating', 'deactivating', 'reloading']) {
    await assert.rejects(operatorUnitsIdle(async () => ({ stdout: `ActiveState=${state}\nSubState=running\nMainPID=12\n` })), /active-run/);
  }
  await assert.rejects(operatorUnitsIdle(async () => ({ stdout: '' })), /active-run/);
  await operatorUnitsIdle(async () => ({ stdout: 'ActiveState=inactive\nSubState=dead\nMainPID=0\n' }));
});
test('phase receipts survive unfinished and failed phases, with numeric time and no error payloads', async t => {
  const control = await fixture(t); let clock = 0;
  const receipt = await phaseReceipt(control, 'activate', { now: () => clock });
  await receipt.mark('stopped');
  await receipt.run('probe-0', async () => {
    assert.equal((await json(receipt.file)).phases[0].result, 'running'); clock = 9;
  });
  await assert.rejects(receipt.run('probe-1', async () => { clock = 15; throw Error('private diagnostic sentinel'); }));
  await receipt.mark('ready'); await receipt.finish('failed');
  const saved = await json(receipt.file);
  assert.equal(saved.stoppedToReadyMs, 15); assert.deepEqual(saved.phases.map(row => row.durationMs), [9, 6]);
  assert.deepEqual(saved.phases.map(row => row.result), ['success', 'failed']);
  assert(!encode(saved).includes('private diagnostic sentinel'));
});

test('installer CLI prints only allowlisted structured refusal categories', async () => {
  const cases = { 'TOOLS_ACTIVE-RUN': 'timer active', TOOLS_LOCK: 'lock held', EEXIST: 'lock held',
    TOOLS_MAINTENANCE: 'maintenance', TOOLS_TRANSACTION: 'transaction evidence', TOOLS_RECEIPT: 'receipt invalid',
    TOOLS_OWNERSHIP: 'ownership/access', TOOLS_ACCESS: 'ownership/access', TOOLS_HASH: 'hash mismatch', TOOLS_ENTRYPOINT: 'entrypoint behavior',
    'TOOLS_PREVIOUS-HASHES': 'hash mismatch', UNKNOWN_PRIVATE_SENTINEL: 'unclassified', toString: 'unclassified' };
  for (const [code, category] of Object.entries(cases)) {
    let out = '', err = '';
    const status = await toolsInstallCli(['install', repo, repo], { settings: async () => ({}),
      switcher: async () => { throw Object.assign(Error('private diagnostic sentinel'), { code }); },
      stdout: value => { out += value; }, stderr: value => { err += value; } });
    assert.equal(status, 1); assert.equal(out, '');
    assert.equal(err, `Tools switch refused: ${category}; inspect transaction evidence privately.\n`);
  }
  const script = path.join(repo, 'scripts/linux/tools-install.mjs');
  try { execFileSync(process.execPath, [script, 'invalid'], { stdio: 'pipe', windowsHide: true }); assert.fail('must refuse'); }
  catch (error) {
    assert.equal(error.status, 1);
    assert.equal(error.stderr.toString(), 'Tools switch refused: arguments invalid; inspect transaction evidence privately.\n');
  }
});
test('review diagnostics identify only the failed category', () => {
  for (const reviewCategory of ['lock', 'maintenance', 'receipt', 'newest backup', 'digest']) {
    assert.equal(reviewRefusal({ reviewCategory, message: 'private diagnostic sentinel' }), `VPS additions review refused: ${reviewCategory}; inspect privately.\n`);
  }
});
test('release transport receipts distinguish local command time from remote downtime', async t => {
  const control = await fixture(t), calls = [];
  const values = { host: 'picker-vps', upload: '/var/tmp/upload', target: '/opt/chunk-picker/releases/candidate',
    'operator-config': '/etc/chunk-picker/operator.json', 'tools-root': '/opt/chunk-picker/tools', node: '/opt/node/bin/node', 'phase-dir': control };
  await releaseVps('derive', values, (file, args) => { calls.push({ file, args }); });
  assert.equal(calls.length, 1); assert.equal(calls[0].file, 'ssh');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(path.join(control, 'phase-receipts'));
  const receipt = await json(path.join(control, 'phase-receipts', files[0]));
  assert.equal(receipt.operation, 'release-derive'); assert.equal(receipt.result, 'success');
  assert.equal(receipt.stoppedToReadyMs, undefined); assert.equal(receipt.phases[0].name, 'derive');
});
test('legacy rehearsal reconstruction uses installed hashes and refuses drift, missing bytes and path escapes', async t => {
  const scratch = await fixture(t), repo = path.join(scratch, 'repo'), copies = path.join(scratch, 'copies');
  await mkdir(repo); await mkdir(copies);
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=',
    '-c', 'user.email=fenerax@users.noreply.github.com', '-c', 'user.name=fenerax', ...args],
    { cwd: repo, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  await mkdir(path.join(repo, 'scripts/linux'), { recursive: true });
  const old = 'export const version = 1;\n', next = 'export const version = 2;\n';
  for (const name of ['operator', 'start-check', 'serve', 'probe', 'rehearse', 'runtime']) await writeFile(path.join(repo, `scripts/linux/${name}.mjs`), old);
  git(['add', '.']); git(['commit', '-m', 'Synthetic legacy fixture', '-m', 'Written by Codex.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>']);
  for (const name of ['operator', 'runtime']) await writeFile(path.join(repo, `scripts/linux/${name}.mjs`), next);
  git(['add', '.']); git(['commit', '-m', 'Synthetic refreshed fixture', '-m', 'Written by Codex.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>']);
  const baseline = git(['rev-parse', 'HEAD']).trim(), comparison = path.join(scratch, 'comparison.json');
  await writeFile(path.join(copies, 'operator.mjs'), old);
  const rows = ['operator', 'runtime'].map(name => ({ path: `scripts/linux/${name}.mjs`, installedSha256: sha(old) }));
  rows.push({ path: 'scripts/linux/prewarm.mjs', installedSha256: null });
  await writeFile(comparison, encode({ rows }));
  const options = { repo, comparison, installedCopies: copies, baseline }, output = path.join(scratch, 'legacy');
  const receipt = await buildLegacyTools({ ...options, output });
  assert.equal(receipt.recorded.length, 2);
  for (const name of ['operator', 'runtime']) assert.equal(await readFile(path.join(output, `scripts/linux/${name}.mjs`), 'utf8'), old);
  assert.equal(await exists(path.join(output, 'scripts/linux/prewarm.mjs')), false);
  await verifyLegacyTools(output, receipt);
  await writeFile(path.join(output, 'extra.mjs'), next);
  await assert.rejects(verifyLegacyTools(output, receipt), /differs/);
  await assert.rejects(buildLegacyTools({ ...options, output }), /absent/);
  await writeFile(comparison, encode({ rows: [{ path: 'scripts/linux/operator.mjs', installedSha256: '0'.repeat(64) }] }));
  const badOutput = path.join(scratch, 'unreproducible');
  await assert.rejects(buildLegacyTools({ ...options, output: badOutput }), /Cannot reproduce/);
  assert.equal(await exists(badOutput), false);
  await writeFile(comparison, encode({ rows: [{ path: '../outside.mjs', installedSha256: sha(old) }] }));
  await assert.rejects(buildLegacyTools({ ...options, output: badOutput }), /inventory refused/);
});

test('scratch guard blocks production aliases, DNS aliases and SSH forwarding before writes', async () => {
  const resolve = async host => [{ address: host === 'chunkpicker.ca' ? '127.0.0.1' : '0.0.0.0' }];
  let calls = 0;
  const run = (_file, args) => { calls++; return args[0] === '-G' ? 'hostname scratch\n' : '0.0.0.0 1 0.0.0.0 2\n'; };
  for (const alias of ['picker-vps', 'PICKER-VPS', 'chunkpicker.ca', '-unsafe', 'unapproved']) await assert.rejects(scratchHostGuard(alias, { resolve, run }));
  assert.equal(calls, 0);
  await assert.rejects(scratchHostGuard('picker-scratch', { resolve: async () => [{ address: '127.0.0.1' }], run }));
  await assert.rejects(scratchHostGuard('picker-scratch', { resolve, run: (_file, args) => args[0] === '-G' ? 'hostname picker-scratch\n' : '0.0.0.0 1 127.0.0.1 2\n' }));
  await assert.rejects(scratchHostGuard('picker-scratch', { resolve: async () => { throw Error('offline'); }, run }));
  await scratchHostGuard('picker-scratch', { resolve, run });
  assert(freshHostGuard.includes('/proc/net/tcp')); assert(freshHostGuard.includes('test ! -e /opt/chunk-picker'));
});
