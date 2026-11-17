import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
// This is a synthetic storage/transport benchmark, independent of installed
// legacy metadata. Worker isolates inherit the same explicit small dataset.
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../../app/core/state.mjs');
const { openStore } = await import('../../app/storage/store.mjs');
const { readBackupRequest, MAX_BACKUP_BYTES } = await import('../../app/backup-transfer.mjs');

const roster = [{ id: 'one', name: 'Synthetic player' }];
function prepareSyntheticState(state, context) {
  if (context.operation !== 'replace') return state;
  assert.equal(state.tasks.length, 20_503); assert.equal(state.history.length, 2_000);
  (state.members[0].notes ??= {})['100'] = 'Synthetic prepared note';
  return state;
}
export function realisticSave() {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: 20_503 }, (_, i) => ({ id: `rs3:task:synthetic-${i}`, category: 'Custom', label: `Synthetic objective ${i}` }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  state.revision = 2_000;
  for (let i = 0; i < 2_000; i++) state.history.push({ id: `revision-${i + 1}`, revision: i + 1, type: 'edit-task', at: '2026-01-01T00:00:00.000Z' });
  // Public dataset-pack registry shape, generated IDs/aliases only. A hydrated
  // pre-migration archive retains the exact preceding registry/catalogue/history.
  state.identityRegistry = { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
  for (const [i, task] of state.tasks.entries()) {
    const aliases = Array.from({ length: 4 }, (_, j) => `Synthetic category ${j}: objective ${i} ${'synthetic description '.repeat(3)}`);
    state.identityRegistry.entries[task.id] = { ...task, kind: 'task', rawLabel: task.label, aliases };
    for (const alias of aliases) state.identityRegistry.aliases[alias] = task.id;
  }
  state.provenance = { taskIdentityMigration: { archives: [{ tasks: state.tasks, members: state.members,
    identityRegistry: state.identityRegistry, history: state.history }] } };
  return { format: 'rs3-chunk-picker', schemaVersion: 1, state };
}
async function measure(work) {
  let last = performance.now(), gap = 0, peakRSS = process.memoryUsage.rss();
  const timer = setInterval(() => { const now = performance.now(); gap = Math.max(gap, now - last); last = now; peakRSS = Math.max(peakRSS, process.memoryUsage.rss()); }, 5);
  const start = performance.now();
  try {
    const result = await work();
    await new Promise(resolve => setImmediate(resolve));
    gap = Math.max(gap, performance.now() - last);
    return { result, ms: performance.now() - start, gap, peakRSS };
  } finally { clearInterval(timer); }
}

export async function exerciseTransfer(t, maximum) {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-transfer-responsiveness-'));
  let hookCount = 0;
  const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false,
    world: { chunks: new Map([['100', { id: '100' }]]), neighbors: new Map(), walkable: new Set(['100']), f2p: new Set(['100']) },
    prepareImportState(state, context) {
      hookCount++;
      assert.equal(context.operation, 'replace');
      return prepareSyntheticState(state, context);
    },
    beforeCommit(change) { if (change.operation === 'replace') { assert.equal(change.state.tasks, undefined); assert.ok(change.digest); } } });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  let document = realisticSave();
  const realisticBytes = Buffer.byteLength(JSON.stringify({ backup: document }));
  const portableBytes = Buffer.byteLength(JSON.stringify(document));
  if (maximum) {
    // Bounded archive leaves avoid conflating JSON primitive-token limits with
    // object hydration. Exact maximum accepted wire JSON, no private data.
    document.state.provenance.syntheticPadding = [];
    let remaining = MAX_BACKUP_BYTES - Buffer.byteLength(JSON.stringify({ backup: document }));
    while (remaining >= 4) {
      const text = 'x'.repeat(Math.min(64 * 1024, remaining - (document.state.provenance.syntheticPadding.length ? 3 : 2)));
      const cost = text.length + (document.state.provenance.syntheticPadding.length ? 3 : 2);
      document.state.provenance.syntheticPadding.push(text); remaining -= cost;
    }
    // Any final one-to-three bytes are legal trailing JSON whitespace.
  }
  let bytes = Buffer.from(JSON.stringify({ backup: document }));
  if (maximum && bytes.length < MAX_BACKUP_BYTES) bytes = Buffer.concat([bytes, Buffer.alloc(MAX_BACKUP_BYTES - bytes.length, 32)]);
  document = undefined;
  if (maximum) assert.equal(bytes.length, MAX_BACKUP_BYTES);
  // Discard fixture-only JSON strings and the construction tree before timing.
  // Collection during preview/apply/export remains part of the measured work.
  assert.equal(typeof globalThis.gc, 'function');
  globalThis.gc();
  await new Promise(resolve => setImmediate(resolve));
  const size = bytes.length;
  const preview = await measure(async () => {
    const request = Object.assign(Readable.from([bytes]), { headers: { 'content-type': 'application/json' }, complete: true });
    const parsed = await readBackupRequest(request, { defer: true }); bytes = undefined;
    return store.prepareTransfer(parsed.input, { dataset: { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} },
      route: '/api/restore/preview', responseView: 'play-v1',
      world: { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set(), sectionTopology: new Map() }, importBudget: parsed.budget });
  });
  const applied = await measure(() => store.applyTransfer(preview.result.ticket, 0));
  assert.equal(applied.result.state.tasks.length, 20_503);
  assert.equal(applied.result.state.members[0].notes['100'], 'Synthetic prepared note');
  assert.equal(applied.result.state.provenance.restore.incomingHistory.length, 2_000);
  assert.equal(applied.result.state.provenance.restore.incomingProvenance.taskIdentityMigration.archives[0].tasks.length, 20_503);
  assert.equal(hookCount, 1);
  assert.throws(() => { applied.result.state.members[0].name = 'External mutation'; }, TypeError);
  const jsonExport = await measure(() => store.exportBackup());
  const gzipExport = await measure(() => store.exportBackup({ gzip: true }));
  assert.equal(jsonExport.result.plainBytes, gzipExport.result.plainBytes);
  // Every boundary-sized accepted save must download in both formats and pass
  // the importer again after restore provenance has been added.
  const request = Object.assign(Readable.from([jsonExport.result.bytes]), { headers: { 'content-type': 'application/json' }, complete: true });
  const exported = (await readBackupRequest(request)).body;
  assert.deepEqual(exported.state, applied.result.state, 'The portable round trip retains every registry, History and archive field.');
  await store.commandSerialized({ type: 'set-note', memberId: 'one', chunkId: '100', note: 'Synthetic note' }, 1, { view: 'play-v1' });
  const undone = await measure(() => store.commandSerialized({ type: 'undo' }, 2, { view: 'play-v1' }));
  assert.equal(store.getInfo().revision, 3);
  let mainPreparation;
  if (!maximum) {
    const baselineDirectory = await mkdtemp(path.join(tmpdir(), 'synthetic-main-preparation-'));
    const baseline = await openStore({ dataDir: baselineDirectory, initialState: createGroupState(roster), retention: false,
      prepareState: prepareSyntheticState });
    try {
      const sameInput = realisticSave();
      mainPreparation = await measure(() => baseline.previewReplacement(sameInput));
      assert.ok(preview.gap <= mainPreparation.gap, `worker hook path ${preview.gap} ms exceeds main preparation ${mainPreparation.gap} ms`);
    } finally { await baseline.close(); await rm(baselineDirectory, { recursive: true, force: true }); }
  }
  t.diagnostic(JSON.stringify({ maximum, bytes: size, realisticBytes, portableBytes, limit: MAX_BACKUP_BYTES,
    previewMs: preview.ms, previewGapMs: preview.gap, workerMs: preview.result.workerMs,
    applyMs: applied.ms, applyGapMs: applied.gap,
    jsonExportMs: jsonExport.ms, jsonExportGapMs: jsonExport.gap,
    gzipExportMs: gzipExport.ms, gzipExportGapMs: gzipExport.gap,
    undoMs: undone.ms, undoGapMs: undone.gap,
    mainPreparationMs: mainPreparation?.ms, mainPreparationGapMs: mainPreparation?.gap,
    peakRSSMiB: Math.max(preview.peakRSS, applied.peakRSS, jsonExport.peakRSS, gzipExport.peakRSS, undone.peakRSS) / 1024 ** 2,
    lifetimePeakRSSMiB: process.resourceUsage().maxRSS / 1024 }));
  // 100 ms target, 150 ms ceiling allows shared CI scheduling/GC variance.
  for (const [name, result] of Object.entries({ preview, apply: applied, jsonExport, gzipExport }))
    assert.ok(result.gap < 150, `${name} timer gap ${result.gap.toFixed(1)} ms`);

}
