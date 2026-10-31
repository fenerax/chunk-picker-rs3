import { parseArgs } from 'node:util';
import { mkdtemp, cp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// Run one server/calculator workload at a time. Only counts, hashes, sizes and
// measurements leave temporary roots; credentials and gameplay never do.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const here = fileURLToPath(import.meta.url);
const clock = fileURLToPath(new URL('./duo-compatibility-clock.mjs', import.meta.url));
const { values } = parseArgs({ options: { extended: { type: 'boolean', default: false }, ...Object.fromEntries(
  ['baseline', 'candidate', 'source', 'packs', 'defaults', 'out', 'internal'].map(key => [key, { type: 'string' }])) } });

async function trial(config) {
  const start = process.hrtime.bigint();
  const { createServer } = await import(pathToFileURL(path.join(config.checkout, 'app/server.mjs')));
  const app = await createServer({ dataDir: config.store, port: 0, predictionPrewarm: false,
    now: () => Date.parse('2026-10-21T12:00:00.000Z'), shutdownDeadlineMs: 5000,
    ...(config.enabled ? { multiPicker: { registryDir: path.join(config.root, 'registry'),
      pickerRoot: path.join(config.root, 'pickers'), tombstoneDir: path.join(config.root, 'tombstones') } } : {}),
    originalSync: { fetchImpl: async () => { throw Error('Offline comparison.'); } },
    runeMetrics: { fetchImpl: async () => { throw Error('Offline comparison.'); } } });
  try {
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    const token = app.store.getAccessToken();
    const rows = [];
    async function request(route, key = token, body) {
      const response = await fetch(origin + route, { method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(600000), headers: { Authorization: 'Bearer ' + key, Origin: origin, 'Accept-Encoding': 'identity',
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw Error('Compatibility request refused.');
      return Buffer.from(await response.arrayBuffer());
    }
    async function capture(route, key) {
      const bytes = await request(route, key); rows.push({ bytes: bytes.length, sha256: sha(bytes) });
    }
    const members = app.store.getCalculationSnapshot().members.map(member => member.id);
    if (members.length !== 2) throw Error('This gate requires two members.');
    for (const route of ['/api/state', '/api/state?view=play-v1', '/api/history', '/api/game-plugin']) await capture(route);
    // Enabled routing deliberately adds session bindings under the contract.
    // Exact legacy-session bytes belong to the option-absent comparison.
    if (config.extended && !config.enabled) await capture('/api/session');
    if (config.extended) for (const route of ['/api/backup', '/api/backups', '/api/backup-status',
      '/api/rules', '/data/slayer-unlock-gates.mjs']) await capture(route);
    for (const memberId of members) for (const view of ['', '&view=play-v1']) await capture('/api/tasks?memberId=' + encodeURIComponent(memberId) + view);
    for (const memberId of members) {
      const key = JSON.parse(await request('/api/game-plugin/keys', token, { memberId, label: 'Player 1' })).key;
      await capture('/api/plugin/v1/status', key);
    }
    await app.close();
    const save = await readFile(path.join(config.store, 'state.json'));
    return { rows, bytes: rows.reduce((n, row) => n + row.bytes, 0), digest: sha(JSON.stringify(rows)),
      saveBytes: save.length, saveSha256: sha(save), wallSeconds: Number(process.hrtime.bigint() - start) / 1e9 };
  } finally { await app.close(); }
}

async function main() {
  if (values.internal) {
    const config = JSON.parse(await readFile(values.internal, 'utf8'));
    await writeFile(config.result, JSON.stringify(await trial(config)), { mode: 0o600 }); return;
  }
  for (const key of ['baseline', 'candidate', 'source', 'packs', 'defaults', 'out']) if (!values[key]) throw Error('Missing comparison argument.');
  const sourceHash = sha(await readFile(path.join(values.source, 'state.json')));
  const root = await mkdtemp(path.join(tmpdir(), 'duo-compatibility-'));
  const results = [];
  try {
    for (const enabled of [false, true]) {
      const pair = [];
      for (const checkout of [values.baseline, values.candidate]) {
        const run = await mkdtemp(path.join(root, 'run-')), store = path.join(run, 'game');
        await cp(values.source, store, { recursive: true, preserveTimestamps: true, filter: file => !['store.lock', 'access-token', 'accounts.json', 'invites.json', 'plugin-keys.json'].includes(path.basename(file)) });
        await copyFile(values.source + '.dataset.json', store + '.dataset.json');
        const config = { checkout: path.resolve(checkout), store, root: run, enabled, extended: values.extended, result: path.join(run, 'result.json') };
        const input = path.join(run, 'input.json'); await writeFile(input, JSON.stringify(config), { mode: 0o600 });
        let peakRSSBytes = 0;
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--import', clock, here, '--internal', input], {
            stdio: 'ignore', env: { ...process.env, RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: path.resolve(values.packs),
              RS3_GAME_DEFAULTS_FILE: path.resolve(values.defaults), RS3_TASK_WORKER_MODE: 'process',
              RS3_WORKER_MEMORY_PROBE_IMPORT: clock } });
          const sample = () => {
            const visit = pid => {
              let rss = 0;
              try {
                rss += Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
                for (const id of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) rss += visit(Number(id));
              } catch { /* Exited processes have no resident memory. */ }
              return rss;
            };
            peakRSSBytes = Math.max(peakRSSBytes, visit(child.pid));
          };
          const timer = setInterval(sample, 50);
          child.once('error', () => { clearInterval(timer); reject(Error('Comparison child failed.')); });
          child.once('exit', code => { sample(); clearInterval(timer); code === 0 ? resolve() : reject(Error('Comparison child failed.')); });
        });
        pair.push({ ...JSON.parse(await readFile(config.result, 'utf8')), peakRSSBytes });
      }
      results.push({ enabled: Number(enabled), before: pair[0], after: pair[1],
        responseDifferences: pair[0].rows.filter((row, i) => row.sha256 !== pair[1].rows[i]?.sha256).length,
        sizeDifferences: pair[0].rows.filter((row, i) => row.bytes !== pair[1].rows[i]?.bytes).length,
        saveDifferences: Number(pair[0].saveSha256 !== pair[1].saveSha256) });
    }
    if (sourceHash !== sha(await readFile(path.join(values.source, 'state.json')))) throw Error('Source changed.');
    const report = { sourceSha256: sourceHash, results };
    await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(report));
    if (results.some(row => row.responseDifferences || row.sizeDifferences || row.saveDifferences)) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(() => { console.error('Compatibility gate failed.'); process.exitCode = 1; });
