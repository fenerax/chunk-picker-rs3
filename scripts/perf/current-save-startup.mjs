// Fresh-process, synthetic archived-save comparison; never opens an existing save.
// node scripts/perf/current-save-startup.mjs [--baseline origin/main] [--pairs 5]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
if (option('--child')) {
  if (option('--child') === 'before') {
    const source = await readFile(option('--source'), 'utf8');
    registerHooks({ load(url, context, next) { return url.endsWith('/app/storage/store.mjs')
      ? { source, format: 'module', shortCircuit: true } : next(url, context); } });
  }
  const { openStore } = await import('../../app/storage/store.mjs');
  const migrateState = () => { throw new Error('Current save must not migrate'); };
  migrateState.isCurrent = () => true;
  const prepareState = () => { throw new Error('Current save must not prepare'); };
  prepareState.isCurrent = () => true;
  const started = performance.now();
  const store = await openStore({ dataDir: option('--dir'), migrateState, prepareState });
  const elapsedMs = performance.now() - started;
  try { console.log(JSON.stringify({ elapsedMs, maxRSSKiB: process.resourceUsage().maxRSS,
    digest: digest(store.getState()), portableDigest: digest(await store.backup()) })); }
  finally { await store.close(); }
} else {
  const pairs = Number(option('--pairs', 5));
  assert(Number.isSafeInteger(pairs) && pairs > 0 && pairs <= 20);
  await mkdir('.local/perf', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/perf/current-save-'));
  try {
    const source = path.join(root, 'before.mjs'), dataDir = path.join(root, 'store');
    const baseline = option('--baseline', 'origin/main');
    await writeFile(source, execFileSync('git', ['show', `${baseline}:app/storage/store.mjs`]));
    const { openStore } = await import('../../app/storage/store.mjs');
    const { createGroupState } = await import('../../app/core/state.mjs');
    const state = createGroupState([{ id: 'synthetic-a', name: 'Synthetic A' }, { id: 'synthetic-b', name: 'Synthetic B' }]);
    state.tasks = Array.from({ length: 16000 }, (_, i) => ({ id: `rs3:task:startup:${i}`, category: 'Synthetic', label: `Synthetic ${i}` }));
    state.legacy = { evidence: 'Synthetic retained evidence. '.repeat(24000) };
    state.revision = 2400;
    state.history = Array.from({ length: state.revision }, (_, i) => ({ id: `revision-${i + 1}`, revision: i + 1,
      type: 'catalogue-refresh', at: '2026-01-01T00:00:00.000Z' }));
    const store = await openStore({ dataDir, initialState: state, retention: { historyEntries: 100 } });
    await store.command({ type: 'set-preference', memberId: 'synthetic-a', preferenceId: 'ids', value: true }, state.revision);
    assert(store.getState().provenance.historyArchive.length > 0);
    await store.close();
    const original = await readFile(path.join(dataDir, 'state.json'));
    const rows = [];
    for (let pair = 0; pair < pairs; pair++) {
      const row = { pair: pair + 1 };
      for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
        row[variant] = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', variant,
          '--dir', dataDir, '--source', source], { encoding: 'utf8', timeout: 120000 }));
        assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), original, 'Startup must not rewrite the save');
      }
      assert.equal(row.before.digest, row.after.digest);
      assert.equal(row.before.portableDigest, row.after.portableDigest);
      rows.push(row);
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const output = JSON.stringify({ node: process.version, baseline,
      baselineSha: execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(), pairs, rows,
      medianMs: Object.fromEntries(['before', 'after'].map(key => [key, median(rows.map(row => row[key].elapsedMs))])),
      limitation: 'Warm filesystem, synthetic two-member archived save; excludes dataset loading and browser startup.' }, null, 2);
    if (option('--out')) await writeFile(option('--out'), output + '\n');
    console.log(output);
  } finally { await rm(root, { recursive: true, force: true }); }
}
