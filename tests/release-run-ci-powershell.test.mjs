// Execute preflight and one refused normal invocation with a fixture shim.
// The shim never opens the helper, launches a command, or touches release state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const windowsOnly = { skip: process.platform !== 'win32' };
const runner = fileURLToPath(new URL('../scripts/release/pc/release-run-ci.ps1', import.meta.url));
const marker = 'fixture-private-value-must-never-escape';
const shim = String.raw`param([string]$Helper, [string]$Action)
$ErrorActionPreference = 'Stop'
if ($env:RS3_FIXTURE_MODE -eq 'clock-refusal' -and $Action -eq 'fail' -and $Helper -eq (Join-Path $env:RS3_FIXTURE_ROOT 'Clock')) {
    $record = @($Action) + @($args)
    [IO.File]::AppendAllText((Join-Path $env:RS3_FIXTURE_ROOT 'fixture-clock-call.jsonl'), (($record | ConvertTo-Json -Compress) + [Environment]::NewLine))
    $global:LASTEXITCODE = 0
    return
}
if ($Action -ne 'preflight' -or $Helper -notlike '*ci-inputs.mjs') {
    [Console]::Error.WriteLine('UNEXPECTED_HELPER_CALL')
    $global:LASTEXITCODE = 71
    return
}
$payload = [string]::Join("\n", @($input))
$options = $payload | ConvertFrom-Json
if ($options.node -ne $PSCommandPath -or $options.current -ne $env:RS3_FIXTURE_CURRENT -or
    $options.release -ne 'rel-fixture' -or $options.kit -ne 'r-fixture' -or
    $options.expectLive -ne 'rel-old' -or $options.candidateCommit -ne ('1' * 40) -or
    $options.runId -ne '123' -or $options.goLive) {
    [Console]::Error.WriteLine('fixture refused.')
    $global:LASTEXITCODE = 72
    return
}
foreach ($name in @('checkout','current','kitsRoot','workRoot','evidenceDir','expectedEvidence','request','clock','watchdogLog','node','ps')) {
    if (-not ([string]$options.$name).StartsWith($env:RS3_FIXTURE_ROOT + [IO.Path]::DirectorySeparatorChar)) {
        [Console]::Error.WriteLine('fixture refused.')
        $global:LASTEXITCODE = 73
        return
    }
}
if ($env:RS3_FIXTURE_MODE -in @('refuse', 'clock-refusal')) {
    [Console]::Error.WriteLine('fixture refused.')
    $global:LASTEXITCODE = 74
    return
}
$global:LASTEXITCODE = 0
@{verified=$true; scope='portable-checks'; releaseReady=$false; consumerAvailable=$false} | ConvertTo-Json -Compress
`;

async function snapshot(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(current, entry.name), relative = path.relative(directory, filename);
      if (entry.isDirectory()) { result.push([relative, 'directory']); await visit(filename); }
      else result.push([relative, createHash('sha256').update(await readFile(filename)).digest('hex')]);
    }
  }
  await visit(directory);
  return result;
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-ci-ps-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = {};
  const directories = new Set(['Checkout', 'KitsRoot', 'WorkRoot', 'EvidenceDir']);
  for (const name of ['Checkout', 'Current', 'KitsRoot', 'WorkRoot', 'EvidenceDir', 'ExpectedEvidence',
    'Request', 'Clock', 'WatchdogLog', 'Node', 'Ps']) {
    settings[name] = path.join(directory, name === 'Node' ? 'fixture-node.ps1' : name);
    if (directories.has(name)) await mkdir(settings[name]);
    else await writeFile(settings[name], name === 'Node' ? shim : marker);
  }
  settings.Gh = path.join(directory, 'never-invoke-gh');
  const config = path.join(directory, 'fixture-config.json');
  await writeFile(config, JSON.stringify(settings));
  const invoke = ({ mode = 'pass', extra = [], preflightOnly = true } = {}) => spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner,
    '-Release', 'rel-fixture', '-Kit', 'r-fixture', '-ExpectLive', 'rel-old',
    '-CandidateCommit', '1'.repeat(40), '-RunId', '123', '-Config', config, ...(preflightOnly ? ['-PreflightOnly'] : []), ...extra
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, RS3_FIXTURE_ROOT: directory, RS3_FIXTURE_CURRENT: settings.Current, RS3_FIXTURE_MODE: mode } });
  return { directory, settings, config, invoke };
}

function checkIsolatedOutput(result) {
  assert.equal(result.error, undefined);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /READY FOR GO-LIVE|RELEASE LIVE|UNEXPECTED_HELPER_CALL/);
  assert.ok(!output.includes(marker));
  return output;
}

test('PowerShell PreflightOnly reads stdin through the shim and creates no files', windowsOnly, async t => {
  const f = await fixture(t), before = await snapshot(f.directory), result = f.invoke();
  const output = checkIsolatedOutput(result);
  assert.equal(result.status, 0, output);
  assert.match(result.stdout, /preflight ok: authenticated portable checks; releaseReady=false/);
  assert.match(result.stdout, /consumer integration pending/);
  assert.equal(result.stderr, '');
  assert.deepEqual(await snapshot(f.directory), before);
});

test('PowerShell failed PreflightOnly refuses without calling clock or writing', windowsOnly, async t => {
  const f = await fixture(t), before = await snapshot(f.directory), result = f.invoke({ mode: 'refuse' });
  const output = checkIsolatedOutput(result);
  assert.notEqual(result.status, 0); assert.match(output, /Release refused/);
  assert.doesNotMatch(output, /preflight ok|Failure clock refused/);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('PowerShell malformed config refuses before the shim and makes no writes', windowsOnly, async t => {
  const f = await fixture(t); await writeFile(f.config, '{ malformed fixture config');
  const before = await snapshot(f.directory), result = f.invoke();
  const output = checkIsolatedOutput(result);
  assert.notEqual(result.status, 0); assert.match(output, /Release refused/);
  assert.doesNotMatch(output, /preflight ok|fixture refused\./);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('PowerShell rejects unknown machine config keys without writing', windowsOnly, async t => {
  const f = await fixture(t);
  await writeFile(f.config, JSON.stringify({ ...f.settings, UnexpectedSetting: marker }));
  const before = await snapshot(f.directory), result = f.invoke();
  const output = checkIsolatedOutput(result);
  assert.notEqual(result.status, 0); assert.match(output, /config refused/);
  assert.doesNotMatch(output, /preflight ok|fixture refused\./);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('PowerShell explicit path parameters override config before read-only preflight', windowsOnly, async t => {
  const f = await fixture(t);
  await writeFile(f.config, JSON.stringify({ ...f.settings,
    Node: path.join(f.directory, 'never-invoke-node.ps1'), Current: path.join(f.directory, 'never-read-current') }));
  const before = await snapshot(f.directory), result = f.invoke({ extra: ['-Node', f.settings.Node, '-Current', f.settings.Current] });
  const output = checkIsolatedOutput(result);
  assert.equal(result.status, 0, output); assert.match(result.stdout, /preflight ok/);
  assert.equal(result.stderr, '');
  assert.deepEqual(await snapshot(f.directory), before);
});

test('normal refusal records exactly one legacy-shaped failure clock call and stops', windowsOnly, async t => {
  const f = await fixture(t), result = f.invoke({ mode: 'clock-refusal', preflightOnly: false });
  const output = checkIsolatedOutput(result);
  assert.notEqual(result.status, 0); assert.match(output, /refused/);
  assert.doesNotMatch(output, /Failure clock refused|== stage|== dry-runs|== freeze/);
  const rows = (await readFile(path.join(f.directory, 'fixture-clock-call.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(0, 8), ['fail', 'rel-fixture-r-fixture-preflight', '--scope', 'stage', '--gate', 'preflight', '--cause', 'unknown']);
  assert.equal(rows[0][8], '--started');
  assert.match(rows[0][9], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(rows[0].slice(10, 13), ['--release', 'rel-fixture', '--note']);
});
