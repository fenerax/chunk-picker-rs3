import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchOriginalData, ORIGINAL_SITE, ORIGINAL_FILES, compareOriginalData, taskMapConflicts,
  adoptOriginalData, run } from '../scripts/compare-original-data.mjs';
import { loadOriginalData } from '../app/data/original-data.mjs';
import { loadFrozenOriginalInputs } from '../scripts/lib/frozen-original-inputs.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
async function scratch(t) {
  const base = path.join(ROOT, '.local/original-data-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('bounded public fetch uses exactly the two read-only URLs once and refuses repeat fetches', async t => {
  const root = await scratch(t), directory = path.join(root, 'capture'), requests = [];
  let pauses = 0;
  const result = await fetchOriginalData(directory, { now: () => '2026-10-13T00:00:00.000Z', pause: async () => { pauses++; },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response('{"fixture":true}', { headers: { 'content-type': 'application/json', etag: 'fixture', 'last-modified': 'fixture' } });
    } });
  assert.deepEqual(requests.map(row => row.url), ORIGINAL_FILES.map(name => ORIGINAL_SITE + name));
  assert.equal(pauses, 1);
  for (const row of requests) {
    assert.equal(row.options.method, 'GET');
    assert.equal(row.options.credentials, 'omit');
    assert.equal(row.options.redirect, 'error');
    assert.match(row.options.headers['User-Agent'], /read-only/);
  }
  assert.equal(result.captures.length, 2);
  for (const row of result.captures) assert.match(row.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(fetchOriginalData(directory, { fetchImpl: () => { throw new Error('must never refetch'); } }), /already exists/);
});

test('denial, malformed response and byte limit stop without retries or the second request', async t => {
  const root = await scratch(t);
  for (const [name, response, message, maxBytes] of [
    ['denied', () => new Response('denied', { status: 403 }), /without retry or login/, 100],
    ['login', () => new Response('<html>Login</html>'), /Unexpected token/, 100],
    ['oversized', () => new Response('{"tooLarge":true}'), /exceeded/, 3],
  ]) {
    let requests = 0;
    await assert.rejects(fetchOriginalData(path.join(root, name), { maxBytes, pause: async () => {},
      fetchImpl: async () => { requests++; return response(); } }), message);
    assert.equal(requests, 1);
  }
});

test('comparison covers source views, other tables and additions/removals with exact nested values', () => {
  const before = { challenges: {}, chunks: {}, quests: { Old: {} }, shopItems: { Shop: { Coal: true } },
    equipment: { Sword: { level: 1 } }, drops: { Cow: { Bones: { 1: 'Always' } } },
    skillItems: { Mining: { Mine: { Coal: { 1: 'Always' } } } }, codeItems: { skillCap: 99 } };
  const after = structuredClone(before);
  delete after.quests.Old; after.quests.New = { members: true };
  after.equipment.Sword.level = 2; after.shopItems.Shop.Ore = true;
  after.drops.Cow.Bones[1] = '1/2'; after.skillItems.Mining.Mine.Coal[1] = '1/2';
  after.codeItems.skillCap = 110; after.newSection = { hello: 1 };
  const result = compareOriginalData(before, after);
  for (const key of ['items', 'monsters', 'shops', 'quests', 'skills']) {
    const row = result.categories.find(row => row.key === key);
    assert.ok(row.added.length + row.removed.length + row.changed.length > 0, key);
  }
  assert.ok(result.otherSections.find(row => row.key === 'codeItems').changed[0].fields.includes('/skillCap'));
  assert.equal(result.otherSections.find(row => row.key === 'newSection').added.length, 1);
  assert.equal(result.definitionsChanged, true);
});

test('existing upstream code collisions are tolerated; new reuse or remapping needs review', () => {
  const before = { A: 't_1', B: 't_1', C: 't_2', currentNextIndex: 3 };
  assert.deepEqual(taskMapConflicts(before, structuredClone(before)), []);
  const after = { ...before, C: 't_3', D: 't_1', currentNextIndex: 4 };
  const result = taskMapConflicts(before, after);
  assert.ok(result.some(row => row.kind === 'Legacy task code' && row.target === 'C'));
  assert.ok(result.some(row => row.kind === 'Reused legacy task code' && row.target === 'D'));
  const retained = { mappings: { RemovedEarlier: 't_8' }, current: { LocalLabel: 't_9' },
    conflicts: [{ label: 'OlderAlias', ids: ['t_10', 't_11'] }] };
  for (const [label, id] of [['NewAfterRemoval', 't_8'], ['NewLocalCollision', 't_9'], ['NewAliasCollision', 't_11']]) {
    assert.ok(taskMapConflicts(before, { ...before, [label]: id }, retained).some(row => row.target === label));
  }
  assert.deepEqual(taskMapConflicts(before, { ...before, RemovedEarlier: 't_8' }, retained), []);
  assert.ok(taskMapConflicts(before, { ...before, NewA: 't_20', NewB: 't_20' }).some(row => row.kind === 'New ambiguous legacy task code'));
});

test('snapshot loader validates LF identity and rejects hash mismatch and path traversal', async t => {
  const root = await scratch(t);
  const bytes = Buffer.from('{"fixture":true}\r\n');
  await writeFile(path.join(root, 'data.json'), bytes);
  const input = { path: 'data.json', sha256: sha256RepositoryText(bytes) };
  const selection = { definitions: input, taskMap: input };
  const loaded = await loadFrozenOriginalInputs({ root, selection });
  assert.deepEqual(loaded.definitionBytes, bytes);
  await assert.rejects(loadFrozenOriginalInputs({ root, selection: { ...selection, definitions: { ...input, sha256: '0'.repeat(64) } } }), /hash mismatch/);
  await assert.rejects(loadFrozenOriginalInputs({ root, selection: { ...selection, definitions: { ...input, path: '../outside.json' } } }), /inside the repository/);
  await assert.rejects(loadOriginalData({ root, selection }), /explicit dataset provider/);
  const reads = [];
  const provider = { bytes: key => { reads.push(key); return bytes; } };
  const runtime = await loadOriginalData({ selection, dataset: provider });
  assert.deepEqual(runtime.definitionBytes, bytes); assert.deepEqual(reads, ['data.json', 'data.json']);
});

test('adoption selects dated snapshots and preserves decoder history, frozen files and local data', async t => {
  const root = await scratch(t), data = path.join(root, 'app/data');
  await mkdir(data, { recursive: true });
  const write = (relative, value) => writeFile(path.join(root, relative), JSON.stringify(value) + '\n');
  // This checkout has no generated current file yet; use the selected seed,
  // exactly as the existing updateTasksMap pipeline does on its first run.
  await write('app/data/legacy-task-history.json', { schemaVersion: 1, mappings: { Keep: 't_1', Remove: 't_2' }, currentNextIndex: 3 });
  await write('local.json', { corrected: true });
  await write('frozen.json', { frozen: true });
  await write('seed.json', { Keep: 't_1', Remove: 't_2', currentNextIndex: 3 });
  await writeFile(path.join(data, 'identity-registry.mjs'), 'export const authoredTasks = [["rs3:task:000001", "Mining", "Keep"]];\nexport const authoredEntities = [];\nexport const authoredGoals = [];\nexport const authoredSources = [];\n');
  const loaderSource = "import selection from './original-data.2026-09-28.v1.json' with { type: 'json' };\n";
  await writeFile(path.join(data, 'original-data.mjs'), loaderSource);
  const definitions = { challenges: { Mining: { Keep: { Level: 1 }, Add: { Level: 2 } } }, equipment: {}, drops: {}, shopItems: {}, skillItems: {} };
  const definitionBytes = Buffer.from(JSON.stringify(definitions));
  const taskBytes = Buffer.from(JSON.stringify({ Keep: 't_1', Add: 't_3', currentNextIndex: 4 }));
  const protectedFiles = [{ path: 'local.json', sha256: sha256RepositoryText(await readFile(path.join(root, 'local.json'))) }];
  const report = { date: '2026-10-13', audit: { conflicts: [], protectedFiles },
    activeComparison: { definitionsChanged: true, taskMapChanged: true }, capture: { captures: [] }, generators: [], adoption: { status: 'adopted' } };
  const inputs = { activeSelection: { definitions: {}, taskMap: { path: 'seed.json' } }, currentDefinitions: definitions,
    currentTaskMap: JSON.parse(taskBytes), currentDefinitionBytes: definitionBytes, currentTaskBytes: taskBytes };
  const selection = await adoptOriginalData(report, inputs, { root });
  assert.equal(selection.definitions.path, 'app/data/original-definitions.2026-10-13.v1.json');
  assert.match(await readFile(path.join(data, 'original-data.mjs'), 'utf8'), /original-data\.2026-10-13\.v1\.json/);
  const loaded = await loadFrozenOriginalInputs({ root, selection });
  assert.deepEqual(loaded.definitionBytes, definitionBytes);
  assert.deepEqual(loaded.taskBytes, taskBytes);
  const history = JSON.parse(await readFile(path.join(data, 'legacy-task-history.json')));
  const current = JSON.parse(await readFile(path.join(data, 'legacy-task-current.json')));
  assert.equal(current.Keep, 't_1'); assert.equal(current.Add, 't_3');
  assert.equal(history.mappings.Remove, 't_2'); assert.equal(history.tombstones.Remove, 't_2');
  const registry = await import(new URL(`../${path.relative(ROOT, path.join(data, 'identity-registry.mjs')).replaceAll('\\', '/')}`, import.meta.url));
  assert.deepEqual(registry.authoredTasks.find(row => row[2] === 'Keep'), ['rs3:task:000001', 'Mining', 'Keep']);
  assert.ok(registry.authoredTasks.some(row => row[2] === 'Add' && row[0] !== 'rs3:task:000001'));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'frozen.json'))), { frozen: true });
  assert.equal(sha256RepositoryText(await readFile(path.join(root, 'local.json'))), protectedFiles[0].sha256);
  await assert.rejects(adoptOriginalData(report, inputs, { root }), /Version already exists/);
});

test('unresolved conflicts and local drift stop adoption before any selection or snapshot write', async t => {
  const root = await scratch(t);
  const report = { date: '2026-10-13', audit: { conflicts: [{ kind: 'fixture' }], protectedFiles: [] } };
  await assert.rejects(adoptOriginalData(report, {}, { root }), /unresolved conflicts/);
  await writeFile(path.join(root, 'local.json'), '{}');
  report.audit = { conflicts: [], protectedFiles: [{ path: 'local.json', sha256: '0'.repeat(64) }] };
  await assert.rejects(adoptOriginalData(report, {}, { root }), /Local data changed/);
});

test('invalid selection import is detected before legacy history or snapshots can change', async t => {
  const root = await scratch(t), data = path.join(root, 'app/data');
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'original-data.mjs'), 'export const invalid = true;\n');
  const report = { date: '2026-10-13', audit: { conflicts: [], protectedFiles: [] },
    activeComparison: { definitionsChanged: true, taskMapChanged: true } };
  await assert.rejects(adoptOriginalData(report, {}, { root }), /no adoption files were written/);
  assert.equal(await readFile(path.join(data, 'original-data.mjs'), 'utf8'), 'export const invalid = true;\n');
  await assert.rejects(readFile(path.join(data, 'original-definitions.2026-10-13.v1.json')), { code: 'ENOENT' });
});

test('an existing dated receipt prevents report overwrite and any repeated fetch', async t => {
  const root = await scratch(t);
  await mkdir(path.join(root, 'app/data'), { recursive: true });
  await mkdir(path.join(root, 'docs/research'), { recursive: true });
  await writeFile(path.join(root, 'app/data/original-data.2026-10-13.v1.json'), '{}\n');
  const reportPath = path.join(root, 'docs/research/original-data-2026-10-13.v1.json');
  await writeFile(reportPath, '{"adoptedEvidence":true}\n');
  await assert.rejects(run({ date: '2026-10-13', version: 'v1', 'current-dir': 'never-created', fetch: true, adopt: true }, { root }), /No fetch or report write/);
  assert.equal(await readFile(reportPath, 'utf8'), '{"adoptedEvidence":true}\n');
  await assert.rejects(readFile(path.join(root, 'never-created/capture.json')), { code: 'ENOENT' });
});
