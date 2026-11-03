// Read-only recovery inputs -> fresh /tmp gameplay copy -> calculator-only
// profiler in a low-priority, RSS-bounded process group. Never opens a store.
import { parseArgs } from 'node:util';
import { mkdtemp, realpath, lstat, readdir, mkdir, copyFile, readFile, rm, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { values } = parseArgs({ options: { 'recovery-save': { type: 'string' }, 'live-data-dir': { type: 'string' }, out: { type: 'string' }, 'rss-mib': { type: 'string', default: '5120' }, profile: { type: 'boolean' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('NodeVersionError');
const within = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
let scratch, child, sampler, deadline, reason, stopping = false;
try {
  if (!values['recovery-save'] || !values['live-data-dir'] || !values.out) throw new Error('OptionsError');
  const source = await realpath(values['recovery-save']), live = await realpath(values['live-data-dir']);
  const output = path.resolve(values.out), limit = Number(values['rss-mib']) * 1024 * 1024;
  if (within(live, source) || within(source, live) || within(live, output) || within(source, output) || !Number.isFinite(limit) || limit < 1536 * 1024 * 1024 || limit > 6144 * 1024 * 1024) throw new Error('IsolationError');
  // Resolve the existing output parent before mkdir to reject symlink aliases.
  const outputParent = await realpath(path.dirname(output));
  if (within(live, outputParent) || within(source, outputParent)) throw new Error('IsolationError');
  try { const info = await lstat(output); if (info) throw new Error('OutputExistsError'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const backupRoot = path.basename(path.dirname(source)) === 'pickers' ? path.dirname(path.dirname(source)) : path.dirname(source);
  const manifest = JSON.parse(await readFile(path.join(backupRoot, 'manifest.json'), 'utf8'));
  if (!['picker-recovery-v1', 'picker-service-recovery-v1'].includes(manifest.format) || !Array.isArray(manifest.files)) throw new Error('ManifestError');
  const prefix = path.relative(backupRoot, source).split(path.sep).join('/');
  const pins = new Map(manifest.files.map(row => [row.path, row]));
  scratch = await mkdtemp('/tmp/picker-vps-profile-'); const copied = path.join(scratch, 'game'); await mkdir(copied, { mode: 0o700 });
  async function copyTree(from, to) {
    const info = await lstat(from); if (info.isSymbolicLink()) throw new Error('LinkError');
    if (info.isDirectory()) { await mkdir(to, { mode: 0o700 }); for (const name of await readdir(from)) await copyTree(path.join(from, name), path.join(to, name)); }
    else if (info.isFile()) {
      const relative = `${prefix}/${path.relative(source, from).split(path.sep).join('/')}`, pin = pins.get(relative);
      if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('ManifestError');
      await copyFile(from, to); const bytes = await readFile(to);
      if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error('ChecksumError');
    } else throw new Error('FileTypeError');
  }
  // Deliberately exclude every credential and sidecar, even if the source was
  // supplied incorrectly. Static references are checksum-validated by hotspots.
  await copyTree(path.join(source, 'state.json'), path.join(copied, 'state.json'));
  try { await copyTree(path.join(source, 'static'), path.join(copied, 'static')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const reportDir = path.join(scratch, 'report');
  child = spawn('nice', ['-n', '15', process.execPath, '--max-old-space-size=1536', new URL('./hotspots-engine.mjs', import.meta.url).pathname, '--data-dir', copied, '--out', reportDir, '--runs', '5', ...(values.profile ? ['--profile'] : [])], { detached: true, env: { ...process.env, RS3_TASK_WORKER_MODE: 'process' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const interrupt = () => { reason = 'Interrupted'; kill(); }; process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let peak = 0, sampling = false;
  sampler = setInterval(async () => {
    if (sampling || stopping) return; sampling = true;
    try {
      let rss = 0;
      for (const pid of (await readdir('/proc')).filter(name => /^\d+$/.test(name))) try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (Number(fields[2]) === child.pid) rss += Number(/^VmRSS:\s+(\d+)/m.exec(await readFile(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
      } catch {}
      peak = Math.max(peak, rss); if (rss > limit) { reason = 'MemoryLimit'; kill(); }
    } catch { reason = 'MonitorError'; kill(); } finally { sampling = false; }
  }, 100);
  deadline = setTimeout(() => { reason = 'TimeLimit'; kill(); }, 30 * 60 * 1000);
  // Child diagnostics may contain inputs. Keep the public terminal numeric only.
  child.stderr.resume();
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  stopping = true; clearTimeout(deadline); clearInterval(sampler); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  if (code !== 0 || reason) throw new Error(reason ?? 'ProfilerError');
  const report = JSON.parse(await readFile(path.join(reportDir, 'measurements.json'), 'utf8'));
  if (report.runs !== 5 || report.trials?.length !== 5) throw new Error('ProfilerError');
  await cp(reportDir, output, { recursive: true, errorOnExist: true, force: false });
  console.log(JSON.stringify({ runs: 5, peakRSS: peak, rssLimit: limit }));
} catch (error) { console.error(JSON.stringify({ error: error.name, code: ['NodeVersionError', 'OptionsError', 'IsolationError', 'OutputExistsError', 'LinkError', 'ManifestError', 'ChecksumError', 'FileTypeError', 'MemoryLimit', 'MonitorError', 'TimeLimit', 'Interrupted', 'ProfilerError'].includes(error.message) ? error.message : 'RunnerError' })); process.exitCode = 1; }
finally { stopping = true; clearTimeout(deadline); clearInterval(sampler); if (child?.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch {} if (scratch) await rm(scratch, { recursive: true, force: true }); }
