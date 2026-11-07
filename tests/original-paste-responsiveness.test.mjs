import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { readBackupRequest } = await import('../app/backup-transfer.mjs');
const { createOriginalPasteUpload } = await import('../app/web/backup-transfer.mjs');
const cap = 8 * 1024 * 1024;
async function measure(work) { return { result: await work(), peakRSS: process.memoryUsage.rss() }; }
for (const shape of ['maximum-string', 'maximum-wide', 'maximum-wide-rules', 'maximum-deep']) test(`${shape} paste preserves preview, apply and browser encoding`, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-original-paste-perf-'));
  const state = createGroupState([{ id: 'destination', name: 'Synthetic player' }]);
  const world = { chunks: new Map([['12850', { id: '12850' }]]), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
  const store = await openStore({ dataDir: directory, initialState: state, world });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const chunksText = '12850';
  let rulesText = '{}';
  let gameplayText;
  if (shape === 'maximum-string') gameplayText = JSON.stringify({ unknown: '' });
  if (shape === 'maximum-wide') gameplayText = JSON.stringify(Object.fromEntries(Array.from({ length: 120_000 }, (_, index) => [`synthetic_${index}`, true])));
  if (shape === 'maximum-wide-rules') { gameplayText = '{}'; rulesText = JSON.stringify(Object.fromEntries(Array.from({ length: 200_000 }, (_, index) => [`r${index}`, false]))); }
  if (shape === 'maximum-deep') gameplayText = '{"unknown":' + '['.repeat(129) + '0' + ']'.repeat(129) + '}';
  // Legal JSON trailing whitespace pads every shape to exactly the accepted cap.
  gameplayText += ' '.repeat(cap - Buffer.byteLength(chunksText + rulesText + gameplayText));
  if (shape === 'maximum-string') {
    gameplayText = JSON.stringify({ unknown: 'x'.repeat(cap - Buffer.byteLength(chunksText + rulesText + JSON.stringify({ unknown: '' }))) });
  }
  assert.equal(Buffer.byteLength(chunksText + rulesText + gameplayText), cap);
  const transport = await measure(async () => {
    const upload = await createOriginalPasteUpload({ chunksText, rulesText, gameplayText }, { memberId: 'destination', sourceMemberId: 'original_paste' });
    return upload.toBackupRequest();
  });
  const request = transport.result, wire = Buffer.from(await request.body.arrayBuffer());
  const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));
  const options = { route: '/api/member-restore/preview', dataset: { datasetId: 'duo-legacy', coordinateSystem: 'surface-grid-v1', capabilities: {} }, world, originalPasteEnabled: true };
  const preview = await measure(async () => {
    const parsed = await readBackupRequest(Object.assign(Readable.from([wire]), { headers, complete: true }), { defer: true });
    try { return await store.prepareTransfer(parsed.input, { ...options, importBudget: parsed.budget }); }
    catch (error) { if (shape === 'maximum-deep') { assert.match(error.message, /nesting/); return { rejected: true }; } throw error; }
  });
  if (preview.result.rejected) {
    t.diagnostic(JSON.stringify({ shape, pasteBytes: cap, wireBytes: wire.length, browserMs: transport.ms, browserGapMs: transport.gap, previewMs: preview.ms, previewGapMs: preview.gap, result: 'rejected nesting before state mutation' }));
    assert.equal(store.getInfo().revision, 0); return;
  }
  const applied = await measure(() => store.applyTransfer(preview.result.ticket, 0));
  assert.ok(Buffer.byteLength(JSON.stringify(preview.result.response)) < 256 * 1024);
  assert.equal(applied.result.state.provenance.originalPasteImports[0].gameplayText, gameplayText);
  const undone = await measure(() => store.commandSerialized({ type: 'undo' }, 1, { view: 'play-v1' }));
  assert.deepEqual(store.getState().members[0].unlocked, []);
  t.diagnostic(JSON.stringify({ shape, pasteBytes: cap, wireBytes: wire.length, browserMs: transport.ms, browserGapMs: transport.gap,
    previewMs: preview.ms, previewGapMs: preview.gap, workerMs: preview.result.workerMs, applyMs: applied.ms, applyGapMs: applied.gap,
    undoMs: undone.ms, undoGapMs: undone.gap, previewBytes: Buffer.byteLength(JSON.stringify(preview.result.response)), lifetimePeakRSSMiB: process.resourceUsage().maxRSS / 1024 }));
});
