// Node 24; no npm dependencies. Only public, generated inputs are accepted.
// node scripts/perf/group-personal-filter.mjs --companion /path/to/scale400 --base <START> --runs 7 --out /tmp/group-report.json
// Generate the companion with scripts/perf/scale-dataset.mjs --scale 400.
// --verify-only runs the output oracle without timing. --recover-log LOG keeps
// complete prior timing pairs and collects fresh RSS/profiles separately.
// Browser/server fixtures are local; neither calculators nor installed saves run.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOpenF2P } from '../../app/open-f2p.mjs';
import { openChrome } from './cdp.mjs';
import { groupFilterCases } from './group-filter-equivalence.mjs';
import { groupFilterFixture } from './group-filter-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const base = option('base') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('--base must be a full commit SHA');
const companion = option('companion');
if (!companion) throw new Error('Pass --companion <scale-dataset output>');
const versions = await readdir(path.join(companion, 'packs/duo-data'));
if (versions.length !== 1) throw new Error('Choose one generated companion');
const definitions = JSON.parse(await readFile(path.join(companion, 'packs/duo-data', versions[0], 'app/data/original-definitions.synthetic.v1.json'), 'utf8'));
const fixture = groupFilterFixture(definitions);
const input = JSON.stringify(fixture);
const publicRuntime = JSON.stringify({ dataset: { id: 'open-f2p' }, values: resolveOpenF2P().materializeValues() });
const source = async (revision, file) => revision === 'before' && ['app/web/duo-tasks.mjs', 'app/web/duo-task-view.mjs', 'app/web/task-filters-model.mjs', 'app/web/screen-tasks.mjs'].includes(file)
  ? execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' }) : readFile(path.join(root, file), 'utf8');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<html><body><script type="module">import {setup} from "/scripts/perf/group-filter-browser.mjs"; globalThis.setup = setup;</script></body></html>'); return; }
    if (url.pathname === '/data/dataset-runtime.json') { res.setHeader('content-type', 'application/json'); res.end(publicRuntime); return; }
    if (url.pathname === '/cases.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(groupFilterCases())); return; }
    if (url.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(input); return; }
    const [, revision, ...parts] = url.pathname.split('/');
    const file = parts.join('/');
    res.setHeader('content-type', 'text/javascript');
    if (url.pathname === '/scripts/perf/group-filter-browser.mjs') { res.end(await readFile(path.join(root, 'scripts/perf/group-filter-browser.mjs'))); return; }
    if (!['before', 'after'].includes(revision) || file.includes('..')) throw new Error('Invalid path');
    if (file === 'screen.mjs') {
      let code = await source(revision, 'app/web/screen-tasks.mjs');
      code = code.replace(/^import .*;\r?\n/gm, '').replace('export function createScreenTasks(c) {', `export function createScreenTasks(c, { selectDuoTasks, selectDuoTaskLists, createTaskFactsIndex, goalProgress, personalCustomTaskRows, isCustomTask, customTaskAssignedTo, createTaskPinChecker, appendTaskClaim }) {
      const createTaskClaimClock = () => ({}), createTaskIconPainter = () => ({ append() {} }), appendTaskWhy = () => {}, appendTaskPin = (document, host, pinned) => { if (pinned) host.append(document.createTextNode('★')); };`);
      res.end(code); return;
    }
    let code = await source(revision, file);
    if (file === 'app/web/duo-tasks.mjs') {
      code = code.replace("  const canonical = task =>", "  let partStart = performance.now(); const part = name => { const now = performance.now(); const parts = globalThis.groupFilterParts ??= {}; parts[name] = (parts[name] ?? 0) + now - partStart; partStart = now; };\n  const canonical = task =>");
      for (const [anchor, label] of [
        ['  const familyIds =', 'savedReferences'],
        ['  for (const { result } of sources) for (const task of result.tasks ?? []) {', 'candidates'],
        ['  const availability =', 'catalogue'], ['  const combined =', 'availability'],
        ["  const query = filter.toLowerCase().trim(), all = [];", 'factsAndUnion'],
        ['  all.sort((a, b) => {', 'personalFilter'], ['  const byMember =', 'sort'],
      ]) {
        if (!code.includes(anchor)) throw new Error(`Missing benchmark phase anchor: ${label}`);
        code = code.replace(anchor, `  part('${label}');\n${anchor}`);
      }
    }
    res.end(code);
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const median = xs => { const sorted = [...xs].sort((a,b) => a-b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i-1] + sorted[i]) / 2; };
const summary = rows => Object.fromEntries(Object.keys(rows[0] ?? {}).filter(k => typeof rows[0][k] === 'number').map(k => {
  const xs = rows.map(row => row[k]); return [k, { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) }];
}));
async function browserRss(pid) {
  // Some managed /proc mounts omit task/<pid>/children. Status entries still
  // expose PPid and VmRSS, so enumerate the owned tree without that interface.
  const records = await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const status = await readFile(`/proc/${name}/status`, 'utf8');
      return { pid: Number(name), ppid: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]), rss: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024 };
    } catch { return undefined; }
  }));
  const children = new Map(), byPid = new Map();
  for (const row of records.filter(Boolean)) { byPid.set(row.pid, row); if (!children.has(row.ppid)) children.set(row.ppid, []); children.get(row.ppid).push(row.pid); }
  const total = id => (byPid.get(id)?.rss ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + total(child), 0);
  return total(pid);
}
async function withBrowser(action) {
  const profile = await mkdtemp(path.join(tmpdir(), 'group-filter-chrome-'));
  let chrome;
  try {
    chrome = await openChrome(option('chrome') ?? '/usr/bin/chromium', profile, { extraArgs: ['--no-sandbox', '--js-flags=--max-old-space-size=3072'] });
    chrome.evaluate = async expression => {
      const r = await chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;
    };
    await chrome.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    for (let i = 0; i < 100; i++) { if (await chrome.evaluate('typeof setup === "function"')) break; await new Promise(r => setTimeout(r, 50)); }
    return await action(chrome);
  } finally { await chrome?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
const actions = [['group', 'one'], ['not-done', 'one'], ['only-player', 'one'], ['group', 'two'], ['not-done', 'two'], ['only-player', 'two']];
const recoveryLog = option('recover-log');
const samples = recoveryLog ? (await readFile(recoveryLog, 'utf8')).split('\n').flatMap(line => {
  const match = /^(\d+) (before|after) ([\w-]+:\w+) (\{.*\})$/.exec(line);
  return match ? [{ pair: Number(match[1]), revision: match[2], action: match[3], ...JSON.parse(match[4]) }] : [];
}) : [];
if (recoveryLog && (samples.length < 84 || samples.length % 12)) throw new Error('Recovery log must contain at least seven complete timing pairs');
if (recoveryLog) {
  const keys = new Set(samples.map(s => `${s.pair}:${s.revision}:${s.action}`));
  const pairs = new Set(samples.map(s => s.pair));
  if (keys.size !== samples.length || pairs.size < 7) throw new Error('Recovery log has duplicate or insufficient pairs');
  for (const pair of pairs) for (const revision of ['before', 'after']) for (const args of actions) {
    if (!keys.has(`${pair}:${revision}:${args.join(':')}`)) throw new Error('Recovery log has an incomplete pair');
  }
}
const memory = [], cpu = {};
const out = option('out') ?? '/tmp/group-filter-report.json';
try {
  const verifyOnly = process.argv.includes('--verify-only');
  const runs = verifyOnly ? 0 : Number(option('runs') ?? 7);
  if (!Number.isSafeInteger(runs) || runs < (verifyOnly ? 0 : 1)) throw new Error('--runs must be positive');
  for (let run = 0; run < runs; run++) {
    const pair = run + (recoveryLog ? Math.max(...samples.map(s => s.pair)) + 1 : 0);
    for (const revision of pair % 2 ? ['after','before'] : ['before','after']) await withBrowser(async chrome => {
      let peakRss = 0, sampling = false;
      const sample = async () => { if (sampling) return; sampling = true; try { peakRss = Math.max(peakRss, await browserRss(chrome.child.pid)); } finally { sampling = false; } };
      const timer = setInterval(sample, 100);
      try {
        await chrome.evaluate(`(async () => { globalThis.fixture = await (await fetch('/fixture.json')).json(); globalThis.h = await setup('/${revision}', fixture); })()`);
        // Warm all actions, then prime Player 1's normal Group list. Every pair
        // uses a fresh Chrome process for each revision, AB / BA alternately.
        for (const args of actions) await chrome.evaluate(`h.action(...${JSON.stringify(args)})`);
        await chrome.evaluate(`h.action('group', 'one')`);
        for (const args of actions) {
          const value = await chrome.evaluate(`h.action(...${JSON.stringify(args)})`);
          if (!recoveryLog) samples.push({ pair, revision, action: args.join(':'), ...value });
          console.log(pair, revision, args.join(':'), JSON.stringify(value));
        }
        if (process.argv.includes('--profile') && run === 0) {
          await chrome.evaluate(`h.action('group', 'one')`);
          await chrome.send('Profiler.enable'); await chrome.send('Profiler.start');
          await chrome.evaluate('h.action("not-done")');
          const { profile: profileData } = await chrome.send('Profiler.stop');
          const costs = new Map(), nodes = new Map(profileData.nodes.map(n => [n.id,n]));
          profileData.samples.forEach((id,i) => { const f = nodes.get(id).callFrame, key = `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; costs.set(key, (costs.get(key) ?? 0) + profileData.timeDeltas[i] / 1000); });
          cpu[revision] = [...costs].sort((a,b)=>b[1]-a[1]).slice(0,25);
        }
        await sample(); if (!peakRss) throw new Error('Browser RSS sampling produced no observations'); memory.push({ pair, revision, peakBrowserTreeRssBytes: peakRss });
        await writeFile(`${out}.partial.json`, JSON.stringify({ base, samples, memory, cpu }, null, 2));
      } finally { clearInterval(timer); }
    });
    console.log(`pair ${run + 1}/${runs}`);
  }
  const equivalence = await withBrowser(async chrome => {
    // Full-response equality is checked separately from time/RSS measurements.
    await chrome.evaluate(`(async () => { globalThis.cases = await (await fetch('/cases.json')).json(); })()`);
    return chrome.evaluate(`(async () => {
      let checked = 0, solo = 0;
      for (const completion of ['any', 'all', 'personal']) for (const unlocked of [false, true]) {
        const subset = cases.filter(c => c.label.startsWith(completion + ':' + unlocked + ':'));
        const input = subset[0];
        const before = await setup('/before', input), after = await setup('/after', input);
        for (const c of subset) {
          if (JSON.stringify(before.selection(c.options)) !== JSON.stringify(after.selection(c.options))) throw new Error('Rows differ: ' + c.label);
          checked++;
        }
        for (const member of ['one', 'two']) {
          await before.action('group', member, false); const b = before.snapshot();
          await after.action('group', member, false); const a = after.snapshot();
          if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Solo output differs');
          solo++;
        }
      }
      return { fullDuoResponsesEqual: checked, soloScreensEqual: solo };
    })()`);
  });
  const report = { base, node: process.version, fixture: { tasks: fixture.state.tasks.length, resultTasks: fixture.results.map(r => r.tasks.length), completed: fixture.state.members.map(m => m.completedTasks.length), history: fixture.state.history.length, bytes: input.length },
    scope: 'Warm local screen-tasks render, actual selectors/rows, icons/hover/map/copy/backlog controls stubbed; no network/calculator time. group:two includes switching players; group:one is a filter on the same player. Fresh Chrome per revision per pair, 3 GiB renderer heap; sampled process-tree RSS every 100 ms.',
    equivalence, samples, memory, rssRecoveryRun: !!recoveryLog, runnerPeakRssBytes: process.resourceUsage().maxRSS * 1024, cpu,
    summary: Object.fromEntries(['before','after'].map(rev => [rev, Object.fromEntries(actions.map(args => [args.join(':'), summary(samples.filter(s => s.revision === rev && s.action === args.join(':')))]))])),
    memorySummary: Object.fromEntries(['before','after'].map(rev => [rev, summary(memory.filter(m => m.revision === rev))])) };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  await rm(`${out}.partial.json`, { force: true });
  console.log(JSON.stringify({ ...report, samples: undefined, memory: undefined }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
