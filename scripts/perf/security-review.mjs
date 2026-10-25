// Local-only synthetic security probe. Node 24; no dependencies or external requests.
// node scripts/perf/security-review.mjs /path/to/START/worktree /path/to/candidate
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const median = values => { const a = [...values].sort((a, b) => a - b); return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2; };
const summary = values => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) });
if (process.argv[2] === '--child') {
  const root = path.resolve(process.argv[3]);
  process.env.RS3_DATASET = 'open-f2p';
  const { createServer } = await import(pathToFileURL(path.join(root, 'app/server.mjs')));
  const { createGroupState } = await import(pathToFileURL(path.join(root, 'app/core/state.mjs')));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-security-'));
  let app;
  try {
    app = await createServer({ dataDir, host: '127.0.0.1', port: 0, predictionPrewarm: false,
      definitions: { chunks: { '100': {}, '101': {} }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] }, taskMap: {},
      initialState: createGroupState([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]) });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    const joined = await fetch(`${origin}/join/${app.store.getAccessToken()}`, { redirect: 'manual' });
    assert.equal(joined.status, 303);
    const cookie = joined.headers.get('set-cookie').split(';')[0];
    const request = async (route, body) => {
      const at = performance.now();
      const response = await fetch(`${origin}${route}`, { headers: { Cookie: cookie, Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { method: 'POST', body }) });
      await response.arrayBuffer();
      return { ms: performance.now() - at, status: response.status };
    };
    for (let i = 0; i < 10; i++) await request('/api/session');
    const sessions = [];
    for (let i = 0; i < 100; i++) sessions.push((await request('/api/session')).ms);
    const commands = [];
    for (let i = 0; i < 20; i++) {
      const saved = await request('/api/command', JSON.stringify({ expectedRevision: app.store.getInfo().revision,
        command: { type: 'set-rule', ruleId: 'access.shared', value: i % 2 === 0 } }));
      assert.equal(saved.status, 200); commands.push(saved.ms);
    }
    const body = JSON.stringify({ padding: 'x'.repeat(8 * 1024 * 1024) });
    const large = [];
    for (let i = 0; i < 3; i++) large.push(await request('/api/command', body));
    const burst = [];
    for (let i = 0; i < 70; i++) burst.push(await request('/api/predict?memberId=one&chunkId=100'));
    const streams = [];
    let streamRejected = 0;
    for (let i = 0; i < 12; i++) {
      const response = await fetch(`${origin}/api/events`, { headers: { Cookie: cookie } });
      if (response.status === 200) streams.push(response);
      else { assert.equal(response.status, 429); streamRejected++; await response.arrayBuffer(); }
    }
    const result = { sessionMs: median(sessions), commandMs: median(commands), largeMs: median(large.map(row => row.ms)), largeStatuses: large.map(row => row.status),
      burstRejected: burst.filter(row => row.status === 429).length, streamAccepted: streams.length, streamRejected,
      peakRssMiB: process.resourceUsage().maxRSS / 1024 };
    await Promise.all(streams.map(response => response.body.cancel()));
    console.log(JSON.stringify(result));
  } finally { await app?.close(); await rm(dataDir, { recursive: true, force: true }); }
} else {
  const [before, after] = process.argv.slice(2);
  if (!before || !after) throw new Error('Pass START worktree and candidate paths.');
  const rows = [];
  // Four pairs, reversing order in each successive pair to expose ordering effects.
  for (let pair = 0; pair < 4; pair++) {
    for (const label of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
      const root = path.resolve(label === 'before' ? before : after);
      const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', root], {
        cwd: root, env: { ...process.env, RS3_DATASET: 'open-f2p' }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      if (run.status !== 0) throw new Error(`${label} failed: ${run.stderr || run.stdout || run.error}`);
      const row = { pair, label, ...JSON.parse(run.stdout.trim().split('\n').at(-1)) };
      rows.push(row); console.log(JSON.stringify(row));
    }
  }
  const totals = Object.fromEntries(['before', 'after'].map(label => [label,
    Object.fromEntries(['sessionMs', 'commandMs', 'largeMs', 'peakRssMiB', 'burstRejected', 'streamAccepted'].map(key =>
      [key, summary(rows.filter(row => row.label === label).map(row => row[key]))]))]));
  const pairedDeltas = Object.fromEntries(['sessionMs', 'commandMs', 'largeMs', 'peakRssMiB'].map(key => [key, summary(
    Array.from({ length: 4 }, (_, pair) => rows.find(row => row.pair === pair && row.label === 'after')[key]
      - rows.find(row => row.pair === pair && row.label === 'before')[key]))]));
  console.log(JSON.stringify({ node: process.version, order: rows.map(row => row.label), totals, pairedDeltas }, null, 2));
}
