// Startup profile: fresh `node app/server.mjs` processes on one synthetic save,
// timed from spawn to the first authenticated health that reports ready. Health
// polls like the operator Start helper (250 ms apart, 1 s timeout) unless told
// otherwise. Phase marks come from app/startup-timing.mjs (RS3_STARTUP_TIMING_LOG).
//
//   node scripts/perf/startup.mjs --open-f2p [--runs 5] [--port 8990] [--root <source tree>]
//     [--worker process|thread] [--poll-ms 250] [--poll-timeout-ms 1000] [--json <file>]
//   node scripts/perf/startup.mjs --inherit ...   (keep the caller's RS3_* dataset environment)
//
// The first, unmeasured start creates the store and one synthetic saved note;
// every measured start then opens that existing save. --root profiles another
// checkout; a tree without the phase marks still reports spawn-to-ready.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
const flag = name => process.argv.includes(`--${name}`);
const now = () => performance.timeOrigin + performance.now();
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]; };
const round = value => Math.round(value);

const runs = Number(option('runs') ?? 5), port = Number(option('port') ?? 8990);
const pollMs = Number(option('poll-ms') ?? 250), pollTimeoutMs = Number(option('poll-timeout-ms') ?? 1000);
const root = path.resolve(option('root') ?? '.'), worker = option('worker') ?? 'process';
if (!Number.isInteger(runs) || runs < 1) throw new TypeError('--runs must be a positive integer.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('--port must be a TCP port.');
if (!['process', 'thread'].includes(worker)) throw new TypeError('--worker must be process or thread.');

function environment(log) {
  const env = { ...process.env, RS3_TASK_WORKER_MODE: worker, RS3_STARTUP_TIMING_LOG: log };
  delete env.NODE_OPTIONS;
  if (flag('open-f2p')) {
    for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON',
      'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR']) delete env[key];
    env.RS3_DATASET = 'open-f2p';
  } else if (!flag('inherit')) throw new Error('Pass --open-f2p or --inherit.');
  return env;
}

async function health(token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(pollTimeoutMs) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function start(dataDir, log) {
  const startedAt = now();
  const child = spawn(process.execPath, ['--expose-gc', path.join(root, 'app', 'server.mjs'), '--data-dir', dataDir,
    '--host', '127.0.0.1', '--port', String(port)], { cwd: root, env: environment(log), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '', exited = false;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  const polls = { attempts: 0, answered: 0 };
  try {
    while (!exited) {
      if (now() - startedAt > 600000) throw new Error('Startup did not report ready within 10 minutes.');
      let token;
      try { token = (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim(); } catch { /* Created during first startup. */ }
      if (token) {
        polls.attempts++;
        const body = await health(token);
        if (body) polls.answered++;
        if (body?.ready === true) return { readyAt: now(), startedAt, polls, child, exit, token };
      }
      await delay(pollMs);
    }
    throw new Error(`Server exited before ready: ${stderr.slice(-2000)}`);
  } catch (error) { child.kill(); await exit; throw error; }
}

async function stop({ child, exit }) {
  child.kill('SIGTERM');
  const code = await Promise.race([exit, delay(30000).then(() => 'timeout')]);
  if (code === 'timeout') { child.kill('SIGKILL'); await exit; throw new Error('Server did not stop within 30 seconds.'); }
}

// One synthetic saved change, so measured starts open an existing save.
async function seed({ token }) {
  const origin = `http://127.0.0.1:${port}`, headers = { Authorization: `Bearer ${token}` };
  const { state } = await (await fetch(`${origin}/api/state`, { headers })).json();
  const member = state.members[0], chunkId = member.unlocked[0] ?? Object.keys(state.chunkNotes ?? {})[0] ?? '12594';
  const response = await fetch(`${origin}/api/command`, { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: state.revision, command: { type: 'set-note', memberId: member.id, chunkId, note: 'Synthetic startup note' } }) });
  if (!response.ok) throw new Error(`Could not seed the synthetic save (${response.status}).`);
}

function timeline(text, startedAt, readyAt) {
  const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const main = rows.find(row => row.thread === 0)?.pid;
  const seen = new Map(), marks = [{ name: 'spawn', at: 0 }];
  for (const row of rows) {
    const where = row.pid === main && row.thread === 0 ? '' : row.pid === main ? 'worker-thread/' : 'worker-process/';
    const name = `${where}${row.phase}`, count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    marks.push({ name: count > 1 ? `${name}#${count}` : name, at: row.at - startedAt });
  }
  marks.push({ name: 'ready', at: readyAt - startedAt });
  return marks.sort((a, b) => a.at - b.at);
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-startup-profile-'));
  const dataDir = path.join(directory, 'game'), results = [];
  try {
    const first = await start(dataDir, path.join(directory, 'prepare.jsonl'));
    await seed(first); await stop(first);
    for (let index = 0; index < runs; index++) {
      const log = path.join(directory, `run-${index}.jsonl`);
      await writeFile(log, '');
      const running = await start(dataDir, log);
      await stop(running);
      results.push({ totalMs: running.readyAt - running.startedAt, polls: running.polls,
        marks: timeline(await readFile(log, 'utf8'), running.startedAt, running.readyAt) });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  const names = [...new Set(results.flatMap(run => run.marks.map(mark => mark.name)))];
  const stat = values => ({ medianMs: round(median(values)), minMs: round(Math.min(...values)), maxMs: round(Math.max(...values)) });
  const marks = names.map(name => {
    const values = results.map(run => run.marks.find(mark => mark.name === name)?.at).filter(value => value !== undefined);
    return { name, runs: values.length, ...stat(values) };
  }).sort((a, b) => a.medianMs - b.medianMs);
  // Main-isolate segments between consecutive marks; worker marks run alongside.
  const segments = new Map();
  for (const run of results) {
    const ordered = run.marks.filter(mark => !mark.name.startsWith('worker-'));
    for (let index = 1; index < ordered.length; index++) {
      const key = `${ordered[index - 1].name} -> ${ordered[index].name}`;
      segments.set(key, [...segments.get(key) ?? [], ordered[index].at - ordered[index - 1].at]);
    }
  }
  const totals = results.map(run => run.totalMs), totalMedian = median(totals);
  const summary = { root, worker, runs, pollMs, pollTimeoutMs, node: process.version, ...stat(totals),
    polls: { attemptsMedian: median(results.map(run => run.polls.attempts)), answeredMedian: median(results.map(run => run.polls.answered)) },
    segments: [...segments].map(([name, values]) => ({ name, runs: values.length, ...stat(values),
      share: Math.round(median(values) / totalMedian * 1000) / 10 })),
    marks };
  if (option('json')) await writeFile(path.resolve(option('json')), `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
