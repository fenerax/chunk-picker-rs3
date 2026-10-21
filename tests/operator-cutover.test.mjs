import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tools = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const ps = (script, ...args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(tools, script), ...args], { encoding: 'utf8', timeout: 20000 });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'operator-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coreRoot = path.join(root, 'core'), oldCore = path.join(root, 'previous'), local = path.join(root, 'local'), dataDir = path.join(local, 'duo'), packsDir = path.join(root, 'packs');
  for (const dir of [path.join(coreRoot, 'app'), path.join(oldCore, 'app'), dataDir, packsDir]) await mkdir(dir, { recursive: true });
  for (const core of [coreRoot, oldCore]) await writeFile(path.join(core, 'app/server.mjs'), 'throw new Error("Synthetic fixture must never execute");');
  await writeFile(path.join(dataDir, 'state.json'), '{"synthetic":true}');
  const token = 'S'.repeat(43), origin = 'https://synthetic-private-origin.invalid';
  await writeFile(path.join(dataDir, 'access-token'), token);
  await writeFile(dataDir + '.dataset.json', '{}');
  await writeFile(path.join(local, 'public-origin'), origin);
  const selection = { schemaVersion: 1 }, packs = {};
  for (const [kind, id] of Object.entries({ data: 'duo-data', rulesText: 'duo-rules-text', art: 'duo-art' })) {
    const dir = path.join(packsDir, id, '1.0.0'); await mkdir(dir, { recursive: true });
    const content = JSON.stringify({ schemaVersion: 1, id });
    const filename = path.join(dir, 'pack.json'); await writeFile(filename, content);
    selection[kind] = { id, version: '1.0.0', sha256: sha(content) }; packs[kind] = { path: filename, sha256: sha(content) };
  }
  const selectionText = JSON.stringify(selection), selectionPath = path.join(packsDir, 'selection.json');
  await writeFile(selectionPath, selectionText);
  const profile = path.join(root, 'profile.json'), addon = path.join(root, 'addon.json');
  await writeFile(profile, '{}'); await writeFile(addon, '{}');
  const config = { schemaVersion: 1, coreRoot, dataDir, nodePath: process.execPath, host: '127.0.0.1', port: 18788, loopbackPort: 18789,
    publicOriginFile: path.join(local, 'public-origin'), packsDir, selection: { path: selectionPath, sha256: sha(selectionText) }, packs,
    profile: { path: profile, sha256: sha('{}') }, addons: { path: addon, sha256: sha('{}') },
    runtimeOptions: { taskWorkerMode: 'process', workerIdleMs: 600000, backupDays: null, historyEntries: null } };
  const configPath = path.join(root, 'operator.json'), oldPath = path.join(root, 'old.json');
  const save = () => writeFile(configPath, JSON.stringify(config));
  await save(); await writeFile(oldPath, JSON.stringify({ ...config, coreRoot: oldCore, profile: null, addons: null }));
  return { root, config, configPath, oldPath, dataDir, local, token, origin, save };
}
async function inventory(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      const filename = path.join(entry.parentPath ?? entry.path, entry.name);
      result.push([path.relative(root, filename), sha(await readFile(filename))]);
    }
  }
  return result.sort(([a], [b]) => a.localeCompare(b));
}
async function shipFixture(t) {
  const f = await fixture(t), core = f.config.coreRoot, companion = path.join(f.root, 'companion'), heavy = path.join(f.root, 'with-heavy.ps1');
  await mkdir(path.join(core, 'scripts')); await writeFile(path.join(core, 'scripts/test.mjs'), 'throw new Error("Must never run");');
  await mkdir(path.join(companion, 'tools'), { recursive: true });
  for (const tool of ['companion-check.mjs', 'verify-install.mjs']) await writeFile(path.join(companion, 'tools', tool), 'throw new Error("Must never run");');
  await writeFile(heavy, 'throw "Must never run"');
  const receipt = { schemaVersion: 1, coreRoot: core, profile: f.config.profile, addons: f.config.addons,
    packs: Object.fromEntries(Object.entries(f.config.packs).map(([kind, value]) => [kind, { sha256: value.sha256 }])) };
  await writeFile(path.join(companion, 'companion.json'), JSON.stringify(receipt));
  for (const args of [['init', '--quiet'], ['add', '.'], ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Synthetic operator fixture']]) {
    const result = spawnSync('git', ['-C', core, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  }
  const args = ['-Config', f.configPath, '-CoreRoot', core, '-CompanionRoot', companion, '-HeavyLock', heavy, '-DryRun'];
  return { ...f, core, companion, heavy, receipt, args };
}

test('operator start/stop/rollback dry runs validate synthetic pins without writes or secret output', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), before = await inventory(f.root);
  for (const script of ['Start-Core.ps1', 'Stop-Core.ps1', 'Rollback-Core.ps1']) {
    const result = ps(script, '-Config', f.configPath, '-DryRun', ...(script === 'Rollback-Core.ps1' ? ['-PreviousConfig', f.oldPath] : []));
    if (result.status !== 0) {
      const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `. '${path.join(tools, 'Operator-Common.ps1').replaceAll("'", "''")}'; $ErrorActionPreference='Stop'; try { $c=Read-OperatorConfig '${f.configPath.replaceAll("'", "''")}'; Show-OperatorPlan $c 'start' } catch { Write-Output $_.Exception.Message; Write-Output $_.ScriptStackTrace; exit 1 }`], { encoding: 'utf8' });
      assert.fail(probe.stdout + probe.stderr);
    }
    assert.match(result.stdout, /\[redacted\]/);
    assert.ok(!result.stdout.includes(f.token)); assert.ok(!result.stdout.includes(f.origin));
    assert.doesNotMatch(result.stdout + result.stderr, /https?:\/\/|\/join\/|#key=/);
  }
  assert.deepEqual(await inventory(f.root), before);
});

test('initial handover Start dry run permits an absent binding while real Start still refuses before writes', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await rm(f.dataDir + '.dataset.json');
  const before = await inventory(f.root);
  for (const config of [f.configPath, f.oldPath]) {
    const dry = ps('Start-Core.ps1', '-Config', config, '-DryRun');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).datasetBindingPresent, false);
    assert.ok(!(dry.stdout + dry.stderr).includes(f.origin));
    assert.ok(!(dry.stdout + dry.stderr).includes(f.token));
    assert.equal(ps('Start-Core.ps1', '-Config', config).status, 1);
  }
  assert.deepEqual(await inventory(f.root), before);
  f.config.selection.sha256 = '0'.repeat(64); await f.save();
  assert.equal(ps('Start-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
});

test('operator dry run refuses changed pack, unknown settings and unsafe rollback before process actions', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  f.config.selection.sha256 = '0'.repeat(64); await f.save();
  assert.equal(ps('Start-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
  const selectionBytes = await readFile(f.config.selection.path); f.config.selection.sha256 = sha(selectionBytes);
  f.config.unknown = f.token; await f.save();
  const invalid = ps('Stop-Core.ps1', '-Config', f.configPath, '-DryRun');
  assert.equal(invalid.status, 1); assert.ok(!(invalid.stdout + invalid.stderr).includes(f.token));
  delete f.config.unknown; f.config.port++; await f.save();
  assert.equal(ps('Rollback-Core.ps1', '-Config', f.configPath, '-PreviousConfig', f.oldPath, '-DryRun').status, 1);
  assert.equal(await readFile(path.join(f.dataDir, 'access-token'), 'utf8'), f.token);
});

test('operator sources parse without loading application modules', { skip: process.platform !== 'win32' }, () => {
  const command = `Get-ChildItem -LiteralPath '${tools.replaceAll("'", "''")}' -Filter '*.ps1' | ForEach-Object { $errors=$null; $tokens=$null; $null=[Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors); if($errors.Count){exit 1} }; exit 0`;
  const parsed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20000 });
  assert.equal(parsed.status, 0, parsed.stderr);
});

test('pure ownership and listener validators reject reused PID, executable and unrelated socket owner', { skip: process.platform !== 'win32' }, () => {
  const command = `
. '${path.join(tools, 'Operator-Common.ps1').replaceAll("'", "''")}'
$ErrorActionPreference='Stop'
$context=[pscustomobject]@{configHash='synthetic';config=[pscustomobject]@{coreRoot='C:\\synthetic\\core';dataDir='C:\\synthetic\\data';nodePath='C:\\synthetic\\node.exe';host='127.0.0.1';port=18788;loopbackPort=18789}}
$record=[pscustomobject]@{pid=12345;processStartedAt='2026-01-01T00:00:00.0000000Z';configHash='synthetic'}
$script:fake=[pscustomobject]@{ProcessId=12345;CreationDate=[DateTime]::Parse('2026-01-01T00:00:00.0000000Z');ExecutablePath='C:\\synthetic\\node.exe';CommandLine='"C:\\synthetic\\node.exe" --expose-gc "C:\\synthetic\\core\\app\\server.mjs" --data-dir "C:\\synthetic\\data" --host 127.0.0.1 --port 18788'}
function Get-CimInstance { param($ClassName,$Filter) return $script:fake }
$script:owner=12345;$script:listening=$true;$script:socketQueries=0
function Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction) $script:socketQueries++; if($script:listening){return [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=$LocalPort;OwningProcess=$script:owner}} }
$null=Get-OperatorOwnedProcess $context $record
if(-not (Test-OperatorListeners $context $record) -or $script:socketQueries -ne 2){exit 4}
$script:owner=99999
$rejected=$false; try { $null=Test-OperatorListeners $context $record } catch { $rejected=$true }; if(-not $rejected){exit 5}
$script:owner=12345;$script:listening=$false
if(Test-OperatorListeners $context $record){exit 6}
$script:fake.CreationDate=$script:fake.CreationDate.AddTicks(10)
$rejected=$false; try { $null=Get-OperatorOwnedProcess $context $record } catch { $rejected=$true }; if(-not $rejected){exit 2}
$script:fake.CreationDate=[DateTime]::Parse($record.processStartedAt);$script:fake.ExecutablePath='C:\\synthetic\\other.exe'
$rejected=$false; try { $null=Get-OperatorOwnedProcess $context $record } catch { $rejected=$true }; if(-not $rejected){exit 3}
exit 0`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('stop dry run tolerates damaged addon while start refuses it and fully qualified positive settings are required', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  await writeFile(f.config.addons.path, '{"damaged":true}');
  assert.equal(ps('Start-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
  assert.equal(ps('Stop-Core.ps1', '-Config', f.configPath, '-DryRun').status, 0);
  assert.equal(ps('Rollback-Core.ps1', '-Config', f.configPath, '-PreviousConfig', f.oldPath, '-DryRun').status, 0);
  f.config.coreRoot = 'C:relative'; await f.save();
  assert.equal(ps('Stop-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
  f.config.coreRoot = '\\root-relative'; await f.save();
  assert.equal(ps('Stop-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
  f.config.coreRoot = path.join(f.root, 'core'); f.config.runtimeOptions.backupDays = 0; await f.save();
  assert.equal(ps('Stop-Core.ps1', '-Config', f.configPath, '-DryRun').status, 1);
});

test('ship dry run pins a clean synthetic revision and stages without executing tests or creating logs', { skip: process.platform !== 'win32' }, async t => {
  const f = await shipFixture(t), { core, companion, receipt, args } = f;
  const before = await inventory(f.root);
  const result = ps('Ship-Core.ps1', ...args);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.stopConfiguration, 'candidate');
  assert.deepEqual(plan.stages, ['public-full', 'private-full', 'revision-check', 'stop', 'verify-data', 'revision-check', 'start']);
  assert.match(plan.coreRevision, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(result.stdout + result.stderr, /https?:\/\/|\/join\/|#key=|[A-Z]:/);
  assert.ok(!result.stdout.includes(f.token)); assert.ok(!result.stdout.includes(f.origin));
  assert.deepEqual(await inventory(f.root), before);
  const originalServer = await readFile(path.join(core, 'app/server.mjs'));
  await writeFile(path.join(core, 'app/server.mjs'), 'throw new Error("Modified shared source");');
  assert.equal(ps('Ship-Core.ps1', ...args).status, 1);
  await writeFile(path.join(core, 'app/server.mjs'), originalServer);
  receipt.coreRoot = path.join(f.root, 'previous');
  await writeFile(path.join(companion, 'companion.json'), JSON.stringify(receipt));
  assert.equal(ps('Ship-Core.ps1', ...args).status, 1);
  receipt.coreRoot = core; receipt.addons.sha256 = '0'.repeat(64);
  await writeFile(path.join(companion, 'companion.json'), JSON.stringify(receipt));
  assert.equal(ps('Ship-Core.ps1', ...args).status, 1);
});

test('ship separates new private pins from immutable previous ownership and rechecks both contexts', { skip: process.platform !== 'win32' }, async t => {
  const f = await shipFixture(t), previous = structuredClone(f.config), previousPath = path.join(f.root, 'previous-operator.json');
  const previousBytes = JSON.stringify(previous), previousHash = sha(previousBytes + '\n' + f.origin);
  await writeFile(previousPath, previousBytes);
  for (const [key, content] of Object.entries({ profile: '{"next":"profile"}', addons: '{"next":"addon"}' })) {
    const filename = path.join(f.root, key + '-next.json'); await writeFile(filename, content);
    f.config[key] = { path: filename, sha256: sha(content) }; f.receipt[key] = f.config[key];
  }
  await f.save(); await writeFile(path.join(f.companion, 'companion.json'), JSON.stringify(f.receipt));
  await rm(previous.addons.path); await writeFile(previous.profile.path, 'damaged old payload');
  await writeFile(path.join(f.local, 'server-runtime.json'), JSON.stringify({ pid: 12345, processStartedAt: '2026-01-01T00:00:00.0000000Z', configHash: previousHash }));
  const before = await inventory(f.root);
  const result = ps('Ship-Core.ps1', ...f.args, '-PreviousConfig', previousPath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).stopConfiguration, 'previous');
  assert.doesNotMatch(result.stdout + result.stderr, /https?:\/\/|\/join\/|#key=|[A-Z]:/);
  assert.ok(!result.stdout.includes(f.token)); assert.deepEqual(await inventory(f.root), before);

  const literal = value => `'${value.replaceAll("'", "''")}'`;
  const command = `
. ${literal(path.join(tools, 'Operator-Common.ps1'))}
$ErrorActionPreference='Stop'
# Load only pure validators; never evaluate Ship's top-level release body.
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile(${literal(path.join(tools, 'Ship-Core.ps1'))},[ref]$tokens,[ref]$errors)
foreach($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Assert-ReleaseTransition','Assert-ReleaseContextsUnchanged','Assert-ReleaseInputs')},$true)){. ([scriptblock]::Create($function.Extent.Text))}
$candidate=Read-OperatorConfig ${literal(f.configPath)}
$previous=Read-OperatorConfig ${literal(previousPath)} -ForStop
$record=Read-OperatorJson ${literal(path.join(f.local, 'server-runtime.json'))}
$c=$previous.config
$script:fake=[pscustomobject]@{ProcessId=$record.pid;CreationDate=[DateTime]::Parse($record.processStartedAt);ExecutablePath=$c.nodePath;CommandLine=(@(('"'+$c.nodePath+'"'),'--expose-gc',('"'+(Join-Path $c.coreRoot 'app/server.mjs')+'"'),'--data-dir',('"'+$c.dataDir+'"'),'--host',$c.host,'--port',[string]$c.port)-join ' ')}
function Get-CimInstance {param($ClassName,$Filter) return $script:fake}
$null=Get-OperatorOwnedProcess $previous $record
$rejected=$false;try{$null=Get-OperatorOwnedProcess $candidate $record}catch{$rejected=$true};if(-not $rejected){exit 2}
Assert-ReleaseContextsUnchanged $candidate $previous ${literal(f.configPath)} ${literal(previousPath)} ${literal(f.core)} ${literal(f.companion)}
foreach($key in 'coreRoot','dataDir','host','port','loopbackPort','publicOriginFile','packsDir'){
 $original=$previous.config.$key;$previous.config.$key='different';$rejected=$false
 try{Assert-ReleaseTransition $candidate $previous}catch{$rejected=$true}finally{$previous.config.$key=$original};if(-not $rejected){exit 3}
}
$original=$previous.config.selection.sha256;$previous.config.selection.sha256=('0'*64);$rejected=$false
try{Assert-ReleaseTransition $candidate $previous}catch{$rejected=$true}finally{$previous.config.selection.sha256=$original};if(-not $rejected){exit 4}
foreach($filename in @(${literal(previousPath)},${literal(f.configPath)})){
 $bytes=[IO.File]::ReadAllText($filename);[IO.File]::WriteAllText($filename,$bytes+' ');$rejected=$false
 try{Assert-ReleaseContextsUnchanged $candidate $previous ${literal(f.configPath)} ${literal(previousPath)} ${literal(f.core)} ${literal(f.companion)}}catch{$rejected=$true}finally{[IO.File]::WriteAllText($filename,$bytes)};if(-not $rejected){exit 5}
}
exit 0`;
  const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000 });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.deepEqual(await inventory(f.root), before);
});
