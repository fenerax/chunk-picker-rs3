import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { responsiveSample } from './helpers/responsiveness.mjs';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState, previewRestore, MAX_JOURNAL_LENGTH } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { backupPreviewState } = await import('../app/backup-transfer.mjs');
const { migrationSummary } = await import('../app/picker-context-http.mjs');
const { REPORT_BYTES, REPORT_RECORDS, DISPLAY_CHARACTERS, IMPORT_DISPLAY_PATHS, boundedImportMessage } = await import('../app/import-output.mjs');
const { transferDigest, transferReport } = await import('../app/save-transfer.mjs');

test('every preview string source shares the wire cap and a repeatable sub-50 ms main-thread response gap', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-response-bounds-'));
  const roster = [{ id: 'one', name: 'Synthetic player' }];
  const store = await openStore({ dataDir: directory, initialState: createGroupState(roster), retention: false });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  let state = createGroupState(roster);
  Object.assign(state.members[0], { unlocked: ['100'], selected: ['101'], completedTasks: ['synthetic-task'],
    obtainedEquipment: ['Synthetic equipment'], journal: 'Synthetic journal', notes: { '100': 'Synthetic note' },
    sourceMapId: 'Synthetic map', taskRules: { synthetic: 'Synthetic rule' },
    taskStatus: { 'synthetic-status': { note: 'Synthetic task note', backlogReason: 'Synthetic reason', challengeCompleted: true } },
    teleports: [{ id: 'synthetic-teleport', label: 'Synthetic teleport', destination: '102', available: true, consumable: false }] });
  state.tasks = ['synthetic-task', 'synthetic-status'].map(id => ({ id, label: 'Synthetic label', category: 'Synthetic category' }));
  state.legacy = { gameplayMigration: { warnings: ['Synthetic warning'] } };
  state.provenance = { taskIdentityMigration: { unresolved: [{ originalId: state.tasks[0].id, path: 'Synthetic path' }] } };
  const sources = new Set();
  function collect(value) {
    if (typeof value === 'string') sources.add(value);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child);
  }
  // Read the actual production projections. This discovers nested identities,
  // rule values, task definitions, diagnostic records and future preview fields
  // without maintaining a second list of string-valued source fields.
  for (const view of [backupPreviewState(state), previewRestore(createGroupState(roster), state),
    migrationSummary(state), transferReport(state, { world: { chunks: new Map() }, warnings: state.legacy.gameplayMigration.warnings })]) collect(view);
  const options = { route: '/api/restore/preview', dataset: { datasetId: 'duo-legacy', capabilities: {} }, world: { chunks: new Map() } };
  collect((await store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state } }), options)).response);
  const replacements = new Map();
  let ordinal = 0;
  function inflate(value) {
    if (typeof value === 'string') {
      if (/^\d+$/.test(value)) return value; // Chunk IDs are schema-capped safe integers.
      if (replacements.has(value)) return replacements.get(value);
      const prefix = String(++ordinal);
      const text = prefix + 's'.repeat((value === 'synthetic-task' ? 32 : 4) * 1024 ** 2 - prefix.length);
      replacements.set(value, text);
      return text;
    }
    if (Array.isArray(value)) return value.map(inflate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inflate(child)]));
    return value;
  }
  function inflateSource(value) {
    const text = value => sources.has(value) && value !== roster[0].id ? inflate(value) : value;
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(inflateSource);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [replacements.get(key) ?? key, inflateSource(child)]));
    return value;
  }
  // Establish replacements from saved values first. Then remap matching
  // dictionary references, preserving schema keys such as report field names.
  function prepare(value) {
    if (typeof value === 'string') { if (sources.has(value) && value !== roster[0].id) inflate(value); }
    else if (value && typeof value === 'object') for (const child of Object.values(value)) prepare(child);
  }
  prepare(state);
  state = inflateSource(state);
  const member = state.members[0];
  // The journal has its own saved-value schema cap. All unrestricted display
  // sources are multi-MiB, including the review's 32 MiB completion identifier.
  member.journal = member.journal.slice(0, MAX_JOURNAL_LENGTH);
  const input = serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state }, rosterMapping: { one: 'one' } });
  let preview, bytes;
  const sample = await responsiveSample(async freshInput => {
    preview = await store.prepareTransfer(freshInput, options);
    bytes = Buffer.from(JSON.stringify(preview.response));
    createHash('sha256').update(bytes).digest('hex');
    transferDigest(preview.response);
  }, { maxGapMs: 50, hardGapMs: 250, label: 'preview response', beforeEach: () => Buffer.from(input) });
  function check(value) {
    if (typeof value === 'string') assert.ok(value.length <= DISPLAY_CHARACTERS);
    else if (value && typeof value === 'object') {
      assert.ok(Object.keys(value).length <= REPORT_RECORDS);
      for (const [key, child] of Object.entries(value)) { assert.ok(key.length <= 128); check(child); }
    }
  }
  check(preview.response);
  assert.ok(bytes.length < REPORT_BYTES, `preview response ${bytes.length} bytes`);
  assert.equal(preview.response.state.members[0].counts.completedTasks, 1);
  assert.equal(preview.response.state.members[0].counts.notes, 1);
  assert.equal(preview.response.preview.taskCounts.added, 2);
  // Stress the same mandatory egress with every string (including future
  // top-level fields) inflated, independent of the save's schema restrictions.
  const inflated = inflate(preview.response);
  const wide = { ...inflated, futureDisplayFields: Array.from({ length: REPORT_RECORDS + 5 }, () => Object.values(inflated)),
    escaped: Array(REPORT_RECORDS + 5).fill('\u0000'.repeat(1024)) };
  for (const path of IMPORT_DISPLAY_PATHS) {
    const message = {};
    let owner = message;
    for (const key of path.slice(0, -1)) owner = owner[key] = {};
    owner[path.at(-1)] = wide;
    boundedImportMessage(message);
    check(owner[path.at(-1)]);
    assert.ok(Buffer.byteLength(JSON.stringify(owner[path.at(-1)])) < REPORT_BYTES);
  }
  await store.applyTransfer(preview.ticket, 0);
  const saved = (await store.backup()).state.members[0];
  assert.equal(saved.name, member.name);
  assert.equal(saved.completedTasks[0], member.completedTasks[0]);
  assert.deepEqual(saved.notes, member.notes);
  assert.deepEqual(saved.obtainedEquipment, member.obtainedEquipment);
  t.diagnostic(JSON.stringify({ previewBytes: bytes.length, mainThreadGapsMs: sample.gaps, inflatedSources: ordinal, completionIdBytes: member.completedTasks[0].length }));
});

for (const stalledSamples of [[1, 2, 3], [1], [1, 3], [2]]) test(`responsiveness hard ceiling rejects stalls in samples ${stalledSamples}`, async () => {
  let attempts = 0;
  await assert.rejects(responsiveSample(() => {
    if (stalledSamples.includes(++attempts)) {
      const end = performance.now() + 275;
      while (performance.now() < end) { /* Synthetic main-thread regression. */ }
    }
  }, { maxGapMs: 50, hardGapMs: 250 }), /exceeded hard ceiling 250 ms/);
  assert.equal(attempts, stalledSamples[0], 'A hard-ceiling miss fails immediately, including after a fast sample');
});

test('responsiveness retries rebuild transferable input and propagate operation failures', async () => {
  let attempts = 0;
  const sample = await responsiveSample(bytes => {
    const transferred = structuredClone(bytes, { transfer: [bytes.buffer] });
    assert.equal(transferred[0], 42);
    if (++attempts === 1) {
      const end = performance.now() + 75;
      while (performance.now() < end) { /* One noisy sample, followed by fresh input. */ }
    }
    return transferred[0];
  }, { maxGapMs: 50, hardGapMs: 250, beforeEach: () => new Uint8Array([42]) });
  assert.equal(sample.result, 42);
  assert.equal(sample.gaps.length, 3, 'Every sample runs even after meeting the tight bound');
  attempts = 0;
  const failure = new Error('Synthetic operation failure');
  await assert.rejects(responsiveSample(() => { attempts++; throw failure; }, { maxGapMs: 50, hardGapMs: 250 }), error => error === failure);
  assert.equal(attempts, 1, 'Functional failures must never be retried');
});

test('responsiveness sampling rejects consistently missing the tight bound below the hard ceiling', async () => {
  let attempts = 0;
  await assert.rejects(responsiveSample(() => {
    attempts++;
    const end = performance.now() + 75;
    while (performance.now() < end) { /* Sustained latency regression. */ }
  }, { maxGapMs: 50, hardGapMs: 250 }), /best sample exceeded 50 ms/);
  assert.equal(attempts, 3);
});
