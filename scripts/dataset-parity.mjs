import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parityInstant } from './lib/dataset-parity-clock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const original = 'C:/Users/User/Projects/chunk-picker-rs3/.local/duo';

async function verifyHeavyLock() {
  const { RS3_HEAVY_LOCK_PATH: directory, RS3_HEAVY_LOCK_TOKEN: token, RS3_HEAVY_LOCK_PID: pid } = process.env;
  if (!directory || !token || !pid) throw new Error('Run through .local/with-heavy.ps1.');
  const owner = JSON.parse((await readFile(path.join(directory, 'owner.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (owner.token !== token || String(owner.pid) !== pid) throw new Error('Heavy lock receipt does not match inherited ownership.');
  process.kill(Number(pid), 0);
}

// The sampler reports maximum sampled summed WorkingSet64 bytes, not summed
// individual process maxima. It covers the profile and its calculator children.
function sampler(pid) {
  if (process.platform !== 'win32') return null;
  const script = `$ErrorActionPreference='Stop'; $peak=[long]0; while(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { $rows=Get-CimInstance Win32_Process; $ids=@(${pid}); do { $next=@($rows | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId }); $ids+=$next } while($next.Count); $total=[long]0; foreach($taskPid in $ids) { $p=Get-Process -Id $taskPid -ErrorAction SilentlyContinue; if($p){$total+=$p.WorkingSet64} }; $peak=[Math]::Max([long]$peak,[long]$total); Start-Sleep -Milliseconds 1000 }; Write-Output $peak`;
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function profile(directory, packsDir, selectionPath, instant) {
  const child = spawn(process.execPath, ['--expose-gc', '--import', new URL('./lib/dataset-parity-inputs.mjs', import.meta.url).href, fileURLToPath(new URL('./lib/dataset-parity-profile.mjs', import.meta.url)), directory], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RS3_PARITY_INSTANT: instant, RS3_PACKS_DIR: packsDir, RS3_PACK_SELECTION: selectionPath, RS3_LOOPBACK_PORT: '', RS3_TASK_WORKER_MODE: 'process' },
  });
  let output = '', stderrBytes = 0;
  child.stdout.on('data', chunk => { output += chunk; });
  // Never forward private exceptions, payloads, paths or credentials to logs.
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  const childDone = once(child, 'close');
  const memory = sampler(child.pid), memoryDone = memory ? once(memory, 'close').catch(() => null) : null; let sampled = '', samplerDiagnostic = '';
  memory?.stdout.on('data', chunk => { sampled += chunk; });
  memory?.stderr.on('data', chunk => { if (samplerDiagnostic.length < 8192) samplerDiagnostic += chunk; });
  const [code] = await childDone;
  const samplerExit = memoryDone ? await memoryDone : null;
  if (code !== 0) {
    let stage = 'unknown', details;
    try { const failed = JSON.parse(output.trim()); if (/^[a-z-]+$/.test(failed.failureStage ?? '')) { stage = failed.failureStage; details = failed; } } catch {}
    if (details) process.stderr.write(JSON.stringify({ parityFailure: details }) + '\n');
    throw Object.assign(new Error('Parity profile failed.'), { safeStage: stage, stderrBytes });
  }
  const result = JSON.parse(output.trim());
  result.memory.sampledProcessTreeWorkingSetBytes = memory ? Number(sampled.trim()) || null : null;
  if (memory && (!result.memory.sampledProcessTreeWorkingSetBytes || samplerExit?.[0] !== 0)) {
    // The sampler contains only generated PID/working-set code, no app data.
    process.stderr.write(`Memory sampler failed (${samplerExit?.[0] ?? 'unknown'}): ${samplerDiagnostic.replace(/\s+/g, ' ').slice(0, 1000)}\n`);
    throw Object.assign(new Error('Parity memory measurement failed.'), { safeStage: 'memory-sampler' });
  }
  return result;
}

let phase = 'heavy-lock';
async function main() {
  await verifyHeavyLock();
  const scratchRoot = path.join(root, '.local', 'dataset-parity');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, 'run-'));
  try {
    phase = 'pack-build';
    const { buildDataPack } = await import('./build-data-pack.mjs');
    const packsDir = path.join(scratch, 'packs'), selectionPath = path.join(packsDir, 'selection.json');
    const built = await buildDataPack({ sourceRoot: root, packsDir, version: '1.0.0', selectionPath, select: true });
    // Capture once so live activity between profiles cannot change their input.
    const inputSave = path.join(scratch, 'input-save');
    phase = 'save-copy';
    const originalBase = await realpath(original);
    await cp(original, inputSave, { recursive: true, dereference: false, filter: async source => {
      // Aggregate usage is operational telemetry, not gameplay input. A daily
      // picker may record event IDs from a different branch's UI catalogue.
      if (['store.lock', 'access-token', 'usage.json'].includes(path.basename(source))) return false;
      const canonical = await realpath(source);
      if (canonical !== originalBase && !canonical.startsWith(originalBase + path.sep)) throw new Error('Save source contains an external link.');
      return true;
    } });
    // Freeze on an observation already recorded by this captured save. A
    // historical hard-coded day can otherwise add a daily startup snapshot.
    const instant = parityInstant(JSON.parse(await readFile(path.join(inputSave, 'state.json'), 'utf8')));
    const results = [];
    for (const name of ['default', 'pack']) {
      const directory = path.join(scratch, name);
      phase = 'save-copy';
      await cp(inputSave, directory, { recursive: true, dereference: false });
      phase = "profile-" + name;
      process.stderr.write(`Parity profile: ${name}.\n`);
      results.push(await profile(directory, packsDir, name === 'pack' ? selectionPath : path.join(scratch, 'absent-selection.json'), instant));
    }
    const [baseline, packed] = results;
    const differences = [...new Set([...Object.keys(baseline.hashes), ...Object.keys(packed.hashes)])].filter(key => baseline.hashes[key] !== packed.hashes[key]);
    const selectionMetadataChecked = baseline.browserDatasetStatus.version === 'tracked' && !baseline.dataset.packed
      && packed.browserDatasetStatus.version === built.manifest.version && packed.dataset.packed;
    const passed = differences.length === 0 && selectionMetadataChecked && results.every(result => result.readOnlyUnchanged && result.undoRestored);
    process.stdout.write(JSON.stringify({ passed, differences, selectionMetadataChecked, profiles: results, normalization: 'Object keys sorted; arrays retain order. Only metrics.elapsedMs, timingMs and cache evaluationMs/requestMs omitted; cache hit flags and gameplay fields compared. The expected Advanced version change (tracked to the built pack version) and packed flags are asserted separately; all other browser dataset status fields are compared.', memoryUnits: { maxRSS: 'KiB, profile process only', sampledProcessTreeWorkingSetBytes: 'bytes, summed live profile/calculator working sets sampled about once per second' } }, null, 2) + '\n');
    if (!passed) process.exitCode = 1;
  } finally {
    const resolved = path.resolve(scratch);
    if (!resolved.startsWith(path.resolve(scratchRoot) + path.sep)) throw new Error('Scratch cleanup containment failed.');
    await rm(resolved, { recursive: true, force: true });
  }
}

try { await main(); } catch (error) { process.stderr.write(`Dataset parity failed${error.safeStage ? ` at ${error.safeStage}` : phase ? ` at ${phase}` : ''}; no private diagnostic values printed.\n`); process.exitCode = 1; }
