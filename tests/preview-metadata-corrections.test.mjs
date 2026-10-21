import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { taskId } from '../app/tasks/engine.mjs';
import { loadPreviewState, previewMetadataCorrections, formatPreview } from '../scripts/preview-metadata-corrections.mjs';

const worktree = fileURLToPath(new URL('../', import.meta.url));
const member = (id = 'a', unlocked = ['12341']) => ({ id, name: id, unlocked });
function definitions(challenges, additions = {}) {
  return { chunks: { '12341': {}, '12342': {} }, sections: {}, codeItems: {}, walkableChunksF2P: ['12341', '12342'], challenges, ...additions };
}
const correction = (category, label, field, before, after) => ({ category, label, changes: [{ field, before, after }] });
const find = (report, memberId, label) => report.members.find(row => row.id === memberId).tasks.find(row => row.label === label);
const delta = (task, field) => task.availability.find(change => change.field === field);
async function directory(t) {
  const dir = await mkdtemp(path.join(worktree, '.preview-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function files(dir) {
  const names = await readdir(dir, { recursive: true });
  const result = {};
  for (const name of names.sort()) {
    try { result[name] = (await readFile(path.join(dir, name))).toString('base64'); }
    catch (error) { if (!['EISDIR', 'EPERM'].includes(error.code)) throw error; }
  }
  return result;
}
async function compactFixture(dir, { field = 'legacy', value = { evidence: 'Player 1 '.repeat(10) } } = {}) {
  const document = exportBackup(createGroupState([member()]));
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const reference = { id: `static-${hash}.json.gz`, sha256: hash };
  document.storage = { schemaVersion: 1, fields: { [field]: reference } };
  delete document.state[field];
  await mkdir(path.join(dir, 'static'), { recursive: true });
  await writeFile(path.join(dir, 'static', reference.id), gzipSync(bytes));
  const filename = path.join(dir, 'state.json');
  await writeFile(filename, JSON.stringify(document));
  return { document, filename, reference, value };
}

test('reports direct metadata and downstream item/task changes for every member without mutations or timing noise', () => {
  const data = definitions({ Quest: { Producer: { Chunks: ['12341'], 'Not F2P': true, Output: 'Token' } }, Extra: {
    Consumer: { Items: ['Token'] }, Dependency: { Tasks: { Producer: 'Quest' } }, Stable: {},
  } });
  const state = createGroupState([member(), member('b', ['12342'])]);
  state.rules = { 'access.shared': false };
  const saved = JSON.stringify({ state, data });
  const report = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [correction('Quest', 'Producer', 'Not F2P', true, false)] });
  assert.deepEqual(find(report, 'a', 'Producer').metadata, [{ field: 'Not F2P', before: true, after: false }]);
  for (const label of ['Producer', 'Consumer', 'Dependency']) {
    assert.deepEqual(delta(find(report, 'a', label), 'status'), { field: 'status', before: 'blocked', after: 'available' });
  }
  assert.deepEqual(find(report, 'a', 'Consumer').metadata, []);
  assert.equal(report.members.length, 2);
  assert.ok(find(report, 'b', 'Producer'));
  assert.equal(find(report, 'a', 'Stable'), undefined);
  assert.equal(JSON.stringify({ state, data }), saved);
  assert.doesNotMatch(JSON.stringify(report), /elapsedMs|metrics|performance/);
  assert.match(formatPreview(report), /metadata\.Not F2P: true -> false/);
});

test('reports metadata-only changes and explicit zero changes, including hidden tasks', () => {
  const data = definitions({ Diary: { Achievement: { RuneScore: 5 } } });
  const state = createGroupState([member()]);
  state.members[0].taskRules = { 'Show Diary Tasks': false };
  const report = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [correction('Diary', 'Achievement', 'RuneScore', 5, 10)] });
  assert.deepEqual(find(report, 'a', 'Achievement').metadata, [{ field: 'RuneScore', before: 5, after: 10 }]);
  assert.deepEqual(find(report, 'a', 'Achievement').availability, []);
  const unchanged = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [] });
  assert.deepEqual(unchanged.members[0].tasks, []);
  assert.equal(unchanged.members[0].changedTaskCount, 0);
  assert.equal(unchanged.members[0].checkedTaskCount, 1);
  assert.match(formatPreview(unchanged), /0 changed \/ 1 checked/);
});

test('reports downstream quest-point gates and keeps completion facts intact', () => {
  const data = definitions({ Quest: { Award: { QuestPoints: 1 } }, Extra: { Gate: { QuestPointsNeeded: 5 } } });
  const state = createGroupState([member()]);
  const id = taskId('Quest', 'Award');
  state.tasks.push({ id, category: 'Quest', label: 'Award' });
  state.members[0].completedTasks.push(id);
  const report = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [correction('Quest', 'Award', 'QuestPoints', 1, 5)] });
  assert.deepEqual(delta(find(report, 'a', 'Gate'), 'status'), { field: 'status', before: 'blocked', after: 'available' });
  assert.equal(delta(find(report, 'a', 'Award'), 'personalCompleted'), undefined);
  assert.deepEqual(state.members[0].completedTasks, [id]);
});

test('reports personal obligation and hidden changes when corrected metadata relocates a task', () => {
  const data = definitions({ Extra: { Relocated: { Chunks: ['12341'] } } });
  const state = createGroupState([member(), member('b', ['12342'])]);
  state.rules = { 'access.shared': false };
  const report = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [correction('Extra', 'Relocated', 'Chunks', ['12341'], ['12342'])] });
  const moved = find(report, 'a', 'Relocated');
  assert.deepEqual(delta(moved, 'obligation'), { field: 'obligation', before: true, after: false });
  assert.deepEqual(delta(moved, 'hidden'), { field: 'hidden', before: false, after: true });
  assert.deepEqual(delta(find(report, 'b', 'Relocated'), 'obligation'), { field: 'obligation', before: false, after: true });
});

test('compares baseline travel and corrected travel, including obligations and hidden changes', () => {
  const data = definitions({ Extra: { Island: { Chunks: ['12342'] } } });
  const state = createGroupState([member(), member('b', ['12342'])]);
  state.members[0].teleports = [{ id: 'island', label: 'Island', destination: '12342', available: true, consumable: false }];
  const report = previewMetadataCorrections({ reviewedOverlays: false, state, definitions: data, corrections: [],
    baselineEngineOptions: { cacheWalking: false, lodestones: [] },
    correctedEngineOptions: { cacheWalking: false, lodestones: [{ name: 'Home', chunkId: '12341', f2p: true }] } });
  assert.deepEqual(delta(find(report, 'a', 'Island'), 'status'), { field: 'status', before: 'blocked', after: 'available' });
  assert.deepEqual(find(report, 'a', 'Island').metadata, []);
});

test('loads raw state, portable envelope, and gzip backup read-only', async t => {
  const dir = await directory(t);
  const state = createGroupState([member()]);
  const raw = path.join(dir, 'raw.json'), portable = path.join(dir, 'backup.json'), gzip = path.join(dir, 'backup.json.gz');
  await writeFile(raw, JSON.stringify(state));
  await writeFile(portable, JSON.stringify(exportBackup(state)));
  await writeFile(gzip, gzipSync(JSON.stringify(exportBackup(state))));
  const before = await files(dir);
  for (const filename of [raw, portable, gzip]) assert.deepEqual(await loadPreviewState(filename), state);
  assert.deepEqual(await files(dir), before);
});

test('hydrates all permitted sidecar fields with hashes over decompressed UTF-8 bytes', async t => {
  const dir = await directory(t);
  const state = createGroupState([member()]);
  state.legacy = { evidence: 'Player 1 é'.repeat(40000) };
  state.provenance = { evidence: 'small retained field' };
  state.identityRegistry = { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
  const document = exportBackup(state);
  document.storage = { schemaVersion: 1, fields: {} };
  await mkdir(path.join(dir, 'static'));
  for (const field of ['tasks', 'legacy', 'provenance', 'identityRegistry']) {
    const bytes = Buffer.from(JSON.stringify(state[field]));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const id = `static-${sha256}.json.gz`;
    document.storage.fields[field] = { id, sha256 };
    delete document.state[field];
    await writeFile(path.join(dir, 'static', id), gzipSync(bytes));
  }
  const filename = path.join(dir, 'state.json');
  await writeFile(filename, JSON.stringify(document));
  const before = await files(dir);
  assert.deepEqual(await loadPreviewState(filename), state);
  assert.deepEqual(await files(dir), before);
});

test('rejects checksum drift, missing dependencies, and malformed or unsafe sidecar references', async t => {
  const dir = await directory(t);
  const { document, filename, reference } = await compactFixture(dir);
  const sidecar = path.join(dir, 'static', reference.id);
  await writeFile(sidecar, gzipSync(JSON.stringify({ evidence: 'changed' })));
  await assert.rejects(loadPreviewState(filename), /checksum mismatch/);
  await rm(sidecar);
  await assert.rejects(loadPreviewState(filename), /ENOENT/);
  for (const invalid of [
    { ...reference, id: `../${reference.id}` }, { ...reference, id: sidecar },
    { ...reference, sha256: '0'.repeat(64) }, { ...reference, bytes: 1024 },
    { ...reference, id: reference.id.toUpperCase() },
  ]) {
    document.storage.fields.legacy = invalid;
    await writeFile(filename, JSON.stringify(document));
    await assert.rejects(loadPreviewState(filename), /Invalid static field reference/);
  }
  document.storage.fields = { rules: reference };
  await writeFile(filename, JSON.stringify(document));
  await assert.rejects(loadPreviewState(filename), /Invalid stored static field/);
  document.storage.fields = { tasks: reference };
  await writeFile(filename, JSON.stringify(document));
  await assert.rejects(loadPreviewState(filename), /Invalid stored static field/);
});

test('rejects a static directory redirected outside the state folder', async t => {
  const dir = await directory(t), outside = await directory(t);
  const fixture = await compactFixture(dir);
  await rm(path.join(dir, 'static'), { recursive: true });
  await symlink(outside, path.join(dir, 'static'), 'junction');
  await assert.rejects(loadPreviewState(fixture.filename), /Unsafe static directory/);
});

test('CLI handles fixture corrections, produces parseable stable JSON and writes no state files', async t => {
  const dir = await directory(t);
  const { filename } = await compactFixture(dir);
  const dataPath = path.join(dir, 'definitions.json'), correctionsPath = path.join(dir, 'corrections.json');
  await writeFile(dataPath, JSON.stringify(definitions({ Diary: { Achievement: { RuneScore: 5 } } })));
  await writeFile(correctionsPath, JSON.stringify([correction('Diary', 'Achievement', 'RuneScore', 5, 10)]));
  const before = await files(dir);
  const args = ['scripts/preview-metadata-corrections.mjs', '--state', filename, '--definitions', dataPath, '--corrections', correctionsPath, '--synthetic-definitions', '--json'];
  const invoke = () => spawnSync(process.execPath, args, { cwd: worktree, encoding: 'utf8', env: { ...process.env, TEMP: dir, TMP: dir } });
  const first = invoke(), second = invoke();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).members[0].changedTaskCount, 1);
  assert.deepEqual(await files(dir), before);
  const missing = spawnSync(process.execPath, ['scripts/preview-metadata-corrections.mjs'], { cwd: worktree, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage:/);
});
