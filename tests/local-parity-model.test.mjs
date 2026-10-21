import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { permanentTaskId, entityId, generatedGoalId } from '../app/tasks/identity.mjs';
import { readCopiedState, createParityIdentityLookup, originalMapState, summarizeMemberResult } from '../scripts/research/local-parity-model.mjs';

test('parity identities require category and resolve historical collisions and generated equipment', () => {
  const flower = 'Construct ~|stacked ceramic flower pots (level 8)|~', elder = 'Fletch an ~|elder stock|~';
  const lookup = createParityIdentityLookup({ state: { tasks: [] }, taskMap: { [flower]: 't_120947', [elder]: 't_120947' } });
  assert.equal(lookup.resolveOriginal({ id: 't_120947', category: 'Construction' }).id, permanentTaskId('Construction', flower));
  assert.equal(lookup.resolveOriginal({ id: 't_120947', category: 'Fletching' }).id, permanentTaskId('Fletching', elder));
  assert.notEqual(lookup.resolveOriginal({ id: 't_120947', category: 'Mining' }).status, 'resolved');
  assert.throws(() => lookup.resolveOriginal({ rawLabel: flower }), /category/);
  const equipment = lookup.resolveOriginal({ rawLabel: 'Obtain ~|rune full helm|~', category: 'BiS' });
  assert.equal(equipment.id, generatedGoalId('equipment', entityId('item', 'Rune full helm')));
  assert.equal(lookup.lookup(equipment.id).kind, 'equipment');
});

test('summaries retain blocked own duties, boosts, selection and separate original chunk evidence', () => {
  const state = { revision: 5, members: [{ id: 'player', sourceMapId: 'original', unlocked: ['101'], selected: ['102'],
    pendingRoll: [], blacklisted: [], taskStatus: { first: { backlogged: true } } }],
    legacy: { maps: { original: { chunks: { unlocked: { '103': true }, selected: { '104': 1 } }, rules: {} } } } };
  const result = { tasks: [
    { id: 'first', category: 'Mining', label: 'First', obligation: true, status: 'blocked', level: 60,
      blockers: [{ kind: 'access', detail: 'Missing mine' }] },
    { id: 'second', category: 'Mining', label: 'Second', obligation: false, status: 'available', level: 40 },
    { id: 'third', category: 'Mining', label: 'Third', obligation: true, status: 'available', level: 50 },
  ], presentation: { tasks: [{ id: 'third' }], effectiveLevels: { third: 47 }, suppressed: { first: ['Backlogged'] } },
  training: { Mining: { level: 99, observedLevel: 60 } }, currentBiS: { memberId: 'player' },
  equipment: [{ name: 'Own tool', obligation: true }, { name: 'Partner tool', obligation: false }] };
  const before = structuredClone({ state, result });
  const summary = summarizeMemberResult(result, state, 'player');
  assert.deepEqual(summary.tasks.map(row => row.id), ['first', 'third']);
  assert.deepEqual(summary.activeTasks.map(row => row.id), ['third']);
  assert.deepEqual(summary.eligibleTasks.map(row => row.id), ['third']);
  assert.equal(summary.activeTasks[0].requiredLevel, 50);
  assert.equal(summary.activeTasks[0].effectiveLevel, 47);
  assert.deepEqual(summary.tasks[0].blockers, [{ kind: 'access', detail: 'Missing mine' }]);
  assert.deepEqual(summary.tasks[0].suppressionReasons, ['Backlogged']);
  assert.deepEqual(summary.equipment.map(row => row.name), ['Own tool']);
  assert.deepEqual(summary.chunks.saved.unlocked, ['101']);
  assert.deepEqual(summary.chunks.original.unlocked, ['103']);
  assert.equal(summary.training.Mining.observedLevel, 60);
  assert.doesNotThrow(() => JSON.stringify(summary));
  assert.deepEqual({ state, result }, before);
  assert.throws(() => originalMapState(state, 'missing'), /Unknown member/);
});

test('copied-save reader verifies sidecars and leaves all bytes unchanged', async () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const base=path.join(root,'.local');
  await mkdir(base,{recursive:true});
  assert.equal(await realpath(base),base,'test scratch must remain in the worktree');
  const directory = await mkdtemp(path.join(base, 'rs3-parity-read-'));
  try {
    const registry = createRuleRegistry(), state = createGroupState([{ id: 'player', name: 'Player', unlocked: ['101'] }], registry);
    const document = exportBackup(state, registry), field = Buffer.from(JSON.stringify(document.state.tasks));
    const hash = createHash('sha256').update(field).digest('hex'), id = `static-${hash}.json.gz`;
    delete document.state.tasks;
    document.storage = { schemaVersion: 1, fields: { tasks: { id, sha256: hash } } };
    await mkdir(path.join(directory, 'static'));
    await writeFile(path.join(directory, 'static', id), gzipSync(field));
    const bytes = JSON.stringify(document);
    await writeFile(path.join(directory, 'state.json'), bytes);
    const loaded = await readCopiedState(directory, registry);
    assert.deepEqual(loaded.state.tasks, []);
    assert.deepEqual(loaded.source.staticFields, ['tasks']);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), bytes);
    await writeFile(path.join(directory, 'static', id), gzipSync(Buffer.from('[{}]')));
    await assert.rejects(readCopiedState(directory, registry), /checksum mismatch/);
    document.storage.fields.tasks.id = '../state.json';
    await writeFile(path.join(directory, 'state.json'), JSON.stringify(document));
    await assert.rejects(readCopiedState(directory, registry), /Invalid static field reference/);
  } finally {
    assert.equal(path.dirname(await realpath(directory)),base,'verify scratch before recursive cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
