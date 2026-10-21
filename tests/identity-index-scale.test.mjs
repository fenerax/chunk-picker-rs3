import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityIndex, entityId, generatedGoalId, legacyTaskId } from '../app/tasks/identity.mjs';

test('compact identity snapshots retain ambiguity against unmaterialized catalogue targets', () => {
  const shared = 'Synthetic shared identity alias';
  const catalogue = Array.from({ length: 25_000 }, (_, i) => ({
    id: `rs3:task:synthetic-potential:${i}`, label: `Synthetic potential ${i}`,
    category: i === 1 ? 'Other category' : 'Synthetic category',
    rawLabel: `Synthetic potential ${i}`, aliases: i < 2 ? [shared] : [],
  }));
  const savedAlias = 'Synthetic dangling alias', dangling = 'rs3:task:synthetic-missing';
  const index = buildIdentityIndex(catalogue, { savedRegistry: { entries: {}, aliases: { [savedAlias]: dangling } } });
  assert.deepEqual(index.resolve(shared).candidates, [catalogue[0].id, catalogue[1].id]);
  assert.equal(index.resolve(shared).status, 'ambiguous');
  assert.equal(index.resolve(shared, { category: 'Synthetic category' }).id, catalogue[0].id);
  const snapshot = index.snapshot([catalogue[0].id]);
  assert.deepEqual(Object.keys(snapshot.entries), [catalogue[0].id]);
  assert.equal(snapshot.aliases[savedAlias], dangling);
  assert.equal(snapshot.entries[catalogue[0].id].label, catalogue[0].label);
  assert.equal(index.resolve(shared).status, 'ambiguous', 'Snapshot filtering must not change the full decoder');
});

test('compiled identity metadata and category aliases are isolated from mutable input rows', () => {
  const id = 'rs3:task:synthetic-mutable', old = legacyTaskId('Old category', 'Old label');
  const saved = { id, kind: 'task', category: 'Saved category', label: 'Saved label', aliases: [old], savedMetadata: true };
  const row = { id, category: 'Current category', label: 'Current label', rawLabel: 'Current label', aliases: ['Synthetic current alias'] };
  const index = buildIdentityIndex([row], { savedRegistry: { entries: { [id]: saved }, aliases: {} } });
  row.category = 'Changed category'; row.label = 'Changed label'; row.rawLabel = 'Changed raw label'; row.aliases.length = 0;
  saved.category = 'Changed saved category'; saved.label = 'Changed saved label'; saved.aliases.length = 0;
  assert.equal(index.lookup(id).label, 'Current label');
  assert.equal(index.lookup(id).category, 'Current category');
  assert.equal(index.lookup(id).savedMetadata, true);
  assert.ok(index.lookup(id).aliases.includes('Synthetic current alias'));
  assert.ok(index.lookup(id).aliases.includes(old));
  assert.equal(index.resolve(old, { category: 'Old category' }).id, id);
  assert.equal(index.resolve('Synthetic current alias', { category: 'Current category' }).id, id);
  assert.equal(index.resolve('Synthetic current alias', { category: 'Changed category' }).status, 'unresolved');
});

test('a repeated task-code mapping resolves after a later source supplies its decoder', () => {
  const id = 'rs3:task:synthetic-mapping-chain', label = 'Synthetic mapping subject';
  const seed = 't_synthetic_seed', final = 't_synthetic_final';
  const catalogue = [{ id, label, rawLabel: label, category: 'Synthetic category', aliases: [] }];
  // The first source cannot decode seed yet. current supplies its identity;
  // historical repeats the original mapping after that decoder is available.
  const options = { taskMap: { [seed]: final }, history: {
    current: { [label]: seed }, historical: { [seed]: final },
  } };
  for (const mappingIds of [undefined, new Set([id, seed, final])]) {
    const index = buildIdentityIndex(catalogue, { ...options, mappingIds });
    assert.equal(index.resolve(seed).id, id);
    assert.equal(index.resolve(final).id, id);
    assert.equal(index.snapshot([id]).aliases[final], id);
  }
});

test('a saved or catalogue goal layer without a category shadows semantic category defaults', () => {
  const id = generatedGoalId('kill-x', entityId('monster', 'Cow'));
  assert.equal(buildIdentityIndex().resolve(id, { category: 'Extra' }).id, id);
  const row = { id, label: 'Synthetic category-free saved goal', aliases: [] };
  for (const index of [buildIdentityIndex([row]), buildIdentityIndex([], {
    savedRegistry: { entries: { [id]: row }, aliases: {} },
  })]) {
    assert.equal(index.lookup(id).category, undefined);
    assert.equal(index.resolve(id).id, id);
    assert.equal(index.resolve(id, { category: 'Extra' }).status, 'unresolved');
  }
});
