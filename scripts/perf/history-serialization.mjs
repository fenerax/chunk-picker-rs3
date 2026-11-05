// Synthetic durable note-save probe; no server, account or existing save.
// node scripts/perf/history-serialization.mjs [--baseline origin/main] [--pairs 5]
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
  const { createGroupState } = await import('../../app/core/state.mjs');
  const { buildWorld } = await import('../../app/data/world.mjs');
  const state = createGroupState([{ id: 'synthetic-a', name: 'Synthetic A', unlocked: ['12341'] }]);
  const note = i => `Synthetic note ${i}. ` + 'Public synthetic text. '.repeat(32);
  state.legacy = { evidence: 'Synthetic retained evidence. '.repeat(16000) };
  state.revision = 1200;
  state.members[0].notes = { '12341': note(1199) };
  state.history = Array.from({ length: 1200 }, (_, i) => ({ id: `revision-${i + 1}`, revision: i + 1,
    type: 'set-note', at: '2026-01-01T00:00:00.000Z',
    command: { type: 'set-note', memberId: 'synthetic-a', chunkId: '12341', note: note(i) },
    undo: { memberChanges: [{ id: 'synthetic-a', changes: [{ path: ['notes', '12341'], kind: 'value',
      before: { exists: i > 0, ...(i > 0 ? { value: note(i - 1) } : {}) }, after: { exists: true, value: note(i) } }] }] } }));
  const dataDir = option('--dir');
  const world = buildWorld({ chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] });
  const store = await openStore({ dataDir, initialState: state, world, now: '2026-01-02T00:00:00.000Z', retention: { historyEntries: 2000 } });
  try {
    // Warm both implementations' response projection without changing the save.
    void store.getStateSnapshot().stateJSON;
    const samplesMs = [];
    for (let i = 0; i < 12; i++) {
      const started = performance.now();
      const saved = await store.commandSerialized({ type: 'set-note', memberId: 'synthetic-a', chunkId: '12341', note: note(1200 + i) }, 1200 + i);
      const response = JSON.parse(saved.stateJSON);
      samplesMs.push(performance.now() - started);
      assert.equal(response.history.length, 1201 + i);
      assert.equal(response.members[0].notes['12341'], note(1200 + i));
    }
    const saved = store.getState(), portable = await store.backup();
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).state.history, saved.history);
    console.log(JSON.stringify({ samplesMs, totalMs: samplesMs.reduce((a, b) => a + b, 0),
      digest: digest(saved), portableDigest: digest(portable), maxRSSKiB: process.resourceUsage().maxRSS }));
  } finally { await store.close(); }
} else {
  const pairs = Number(option('--pairs', 5));
  assert(Number.isSafeInteger(pairs) && pairs > 0 && pairs <= 20);
  await mkdir('.local/perf', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/perf/history-serialization-'));
  try {
    const source = path.join(root, 'before.mjs'), baseline = option('--baseline', 'origin/main');
    await writeFile(source, execFileSync('git', ['show', `${baseline}:app/storage/store.mjs`]));
    const rows = [];
    for (let pair = 0; pair < pairs; pair++) {
      const row = { pair: pair + 1 };
      for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) row[variant] = JSON.parse(execFileSync(process.execPath,
        [fileURLToPath(import.meta.url), '--child', variant, '--source', source, '--dir', path.join(root, `${pair}-${variant}`)],
        { encoding: 'utf8', timeout: 120000 }));
      assert.equal(row.before.digest, row.after.digest);
      assert.equal(row.before.portableDigest, row.after.portableDigest);
      rows.push(row);
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const output = JSON.stringify({ node: process.version, baseline,
      baselineSha: execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(), pairs, rows,
      medianBurstMs: Object.fromEntries(['before', 'after'].map(key => [key, median(rows.map(row => row[key].totalMs))])),
      limitation: 'Synthetic durable store commands and full response parse; excludes HTTP, compression, browser rendering and real saves.' }, null, 2);
    if (option('--out')) await writeFile(option('--out'), output + '\n');
    console.log(output);
  } finally { await rm(root, { recursive: true, force: true }); }
}
