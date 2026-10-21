import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { previewSkillGuides, formatPreview } from '../scripts/preview-skill-guides.mjs';

const worktree = fileURLToPath(new URL('../', import.meta.url));
const definitions = { chunks: { '12341': { Object: { Workbench: 1 } }, '12342': {} }, challenges: {
  Extra: { Consumer: { Items: ['Token'] }, Stable: {} }, Attack: { 'Combat goal': { Level: 7 } } } };
const catalogue = { schemaVersion: 1, version: 'fixture', skills: [],
  entries: [{ id: 'entry', skill: 'Crafting', level: 1, members: false }], generatedTasks: [{ category: 'Crafting', label: 'Producer',
    record: { PickerId: 'rs3:task:skill-guide:fixture', Level: 1, Primary: true, Objects: ['Workbench'], Output: 'Token' },
    entryIds: ['entry'], selectorEvidence: { kind: 'object', selector: 'Workbench' } }], trainingBreakpoints: [] };
const corrections = [{ skill: 'Attack', label: 'Combat goal', changes: [{ field: 'Level', before: 7, after: 3 }] }];
const state = () => createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }, { id: 'b', name: 'B', unlocked: ['12342'] }]);
const comparison = (report, id) => report.comparisons.find(row => row.id === id);

test('preview compares each independent switch, hidden tasks and downstream outputs for every member', () => {
  const saved = state(); saved.members[0].taskRules = { Skills: false }; saved.rules['access.shared'] = false;
  const original = structuredClone({ saved, definitions, catalogue, corrections });
  const report = previewSkillGuides({ state: saved, definitions, catalogue, corrections, engineOptions: { cacheWalking: false, reviewedOverlays: false } });
  assert.equal(report.comparisons.length, 4);
  for (const row of report.comparisons) assert.equal(row.members.length, 2);
  const taskPreview = comparison(report, 'original-to-tasks').members[0];
  assert.deepEqual(taskPreview.tasks.find(row => row.label === 'Producer').presence, { before: false, after: true });
  assert.ok(taskPreview.tasks.find(row => row.label === 'Producer').availability.some(change => change.field === 'hidden' && change.after === true));
  assert.deepEqual(taskPreview.tasks.find(row => row.label === 'Consumer').availability.find(change => change.field === 'status'),
    { field: 'status', before: 'blocked', after: 'available' });
  assert.ok(taskPreview.capabilities.some(change => change.field === 'items'));
  const corrected = comparison(report, 'original-to-corrections').members[0].tasks.find(row => row.label === 'Combat goal');
  assert.deepEqual(corrected.metadata, [{ field: 'Level', before: 7, after: 3 }]);
  assert.deepEqual({ saved, definitions, catalogue, corrections }, original);
  assert.doesNotMatch(JSON.stringify(report), /elapsedMs|compileMs|performance/);
});

test('zero-change comparisons include member counts and leave stable tasks out of deltas', () => {
  const report = previewSkillGuides({ state: state(), definitions, catalogue: { ...catalogue, generatedTasks: [] }, corrections: [], engineOptions: { cacheWalking: false, reviewedOverlays: false } });
  for (const row of report.comparisons) for (const member of row.members) {
    assert.equal(member.changedTaskCount, 0); assert.equal(member.checkedTaskCount, 3);
    assert.deepEqual(member.tasks, []); assert.deepEqual(member.capabilities, []);
  }
  assert.match(formatPreview(report), /0 changed \/ 3 checked/);
});

test('CLI hydrates raw, portable backup and compact sidecar fixtures without writing input files', async t => {
  const dir = await mkdtemp(path.join(worktree, '.skill-guide-preview-test-'));
  t.after(async () => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(worktree));
    await rm(resolved, { recursive: true, force: true });
  });
  const saved = state(), backup = exportBackup(saved), compact = structuredClone(backup);
  const bytes = Buffer.from(JSON.stringify({ maps: {} }));
  const sha256 = createHash('sha256').update(bytes).digest('hex'), id = `static-${sha256}.json.gz`;
  compact.storage = { schemaVersion: 1, fields: { legacy: { id, sha256 } } }; delete compact.state.legacy;
  await mkdir(path.join(dir, 'static'));
  await writeFile(path.join(dir, 'static', id), gzipSync(bytes));
  const dataFiles = { 'raw.json': saved, 'backup.json': backup, 'compact.json': compact,
    'definitions.json': definitions, 'catalogue.json': catalogue, 'corrections.json': { corrections } };
  for (const [name, document] of Object.entries(dataFiles)) await writeFile(path.join(dir, name), JSON.stringify(document));
  const names = (await readdir(dir, { recursive: true })).sort();
  const snapshots = new Map();
  for (const name of names.filter(name => name.endsWith('.json') || name.endsWith('.gz'))) snapshots.set(name, await readFile(path.join(dir, name)));
  const reports = [];
  for (const name of ['raw.json', 'backup.json', 'compact.json']) {
    const result = spawnSync(process.execPath, ['scripts/preview-skill-guides.mjs', '--state', path.join(dir, name),
      '--definitions', path.join(dir, 'definitions.json'), '--catalogue', path.join(dir, 'catalogue.json'),
      '--corrections', path.join(dir, 'corrections.json'), '--no-cache-walking', '--synthetic-definitions', '--json'], { cwd: worktree, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); reports.push(JSON.parse(result.stdout));
  }
  assert.deepEqual(reports[0], reports[1]); assert.deepEqual(reports[0], reports[2]);
  assert.deepEqual((await readdir(dir, { recursive: true })).sort(), names);
  for (const [name, before] of snapshots) assert.deepEqual(await readFile(path.join(dir, name)), before);
});
