import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrubBackup, backupCounts, checkBackup, prepareSaveCopy, availableCorpus } from '../scripts/save-copy/scrub-save.mjs';
import { proveLoad } from '../scripts/save-copy/prove-load.mjs';
import { addFingerprints, loadCorpus } from '../scripts/secret-scan/fingerprints.mjs';
import { schemaKeys } from '../scripts/save-copy/policy.mjs';

// Entirely invented. No fixture is read from a real save.
function fixture() {
  return { format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1, revision: 1, rules: {},
    members: [{ id: 'fixture-member', name: 'Fixture Person', sourceMapId: 'fixture-map',
      unlocked: ['100'], selected: [], pendingRoll: [], blacklisted: [], completedTasks: ['custom:fixture-task'],
      runescapeName: 'Fixture Rsn', notes: { '100': 'Mining' },
      taskStatus: { 'custom:fixture-task': { note: 'Fixture Person', backlogReason: 'Fixture Person' } },
      skillProgress: { Mining: { level: 12, xp: 1000, source: 'runemetrics', fetchedAt: '2026-01-01T00:00:00.000Z', runescapeName: 'Fixture Rsn' } } }],
    tasks: [{ id: 'custom:fixture-task', label: 'Mine fixture ore', category: 'Mining', memberIds: ['fixture-member'] }],
    history: [{ id: 'revision-1', revision: 1, type: 'set-note', at: '2026-01-01T00:00:00.000Z',
      actor: { kind: 'invite', label: 'Mining', inviteId: 'fixture-invite', memberId: 'fixture-member' },
      command: { type: 'set-note', memberId: 'fixture-member', chunkId: '100', note: 'Mining' },
      undo: { memberChanges: [{ id: 'fixture-member', changes: [{ path: ['notes', '100'], kind: 'value', before: { exists: false }, after: { exists: true, value: 'Mining' } }] }] } }],
    legacy: { maps: { 'fixture-map': { chunkNotes: { '100': 'Mining' }, friends: { 'Fixture Friend': 'Fixture Person' }, settings: { Case: true, case: false } } } },
    provenance: { contact: { email: 'fixture-person@example.invalid', accountId: 1234567, futureBiography: 'Mining' }, sourceHash: `sha256:${'a'.repeat(64)}` } } };
}

const keys = new Set(['format','schemaVersion','state','revision','rules','members','id','name','sourceMapId','unlocked','selected','pendingRoll','blacklisted','completedTasks','runescapeName','notes','taskStatus','note','backlogReason','skillProgress','level','xp','source','fetchedAt','tasks','label','category','memberIds','history','type','at','actor','kind','inviteId','memberId','command','chunkId','undo','memberChanges','changes','path','before','after','exists','value','legacy','maps','chunkNotes','friends','settings','provenance','contact','email','accountId','sourceHash']);
const vocabulary = { keys, values: new Set(['', 'rs3-chunk-picker','Mining','Mine fixture ore','custom:fixture-task','runemetrics','revision-1','set-note','invite','value','notes','Case','case','100']) };
keys.add('teleports');
const clean = () => scrubBackup(fixture(), { vocabulary });
const accepts = () => {};

test('scrubs identities, free text, access, numeric IDs and unknown fields with stable references', () => {
  const { document, report } = clean();
  const s = document.state, member = s.members[0];
  assert.equal(member.id, 'player1'); assert.equal(member.sourceMapId, 'qxa');
  assert.equal(s.tasks[0].memberIds[0], member.id);
  assert.equal(s.history[0].actor.memberId, member.id);
  assert.equal(s.history[0].undo.memberChanges[0].id, member.id);
  assert.ok(s.legacy.maps.qxa);
  assert.equal(member.name, member.taskStatus['custom:fixture-task'].note);
  assert.equal(member.notes['100'], s.history[0].command.note);
  assert.equal(member.notes['100'], s.history[0].undo.memberChanges[0].changes[0].after.value);
  assert.notEqual(s.history[0].actor.label, 'Mining');
  assert.equal(member.skillProgress.Mining.level, 12);
  assert.equal(s.tasks[0].category, 'Mining');
  const serialized = JSON.stringify(document);
  for (const privateValue of ['Fixture Person','Fixture Rsn','Fixture Friend','fixture-member','fixture-map','fixture-invite','fixture-person@example.invalid','1234567']) assert.ok(!serialized.includes(privateValue));
  assert.ok(report.categories.some(row => row.kind === 'unknown-string' && row.action === 'replaced'));
  assert.deepEqual(backupCounts(document), backupCounts(fixture()));
});

test('preserves differently cased object keys and reports every category without values', () => {
  const { document, report } = clean();
  assert.deepEqual(document.state.legacy.maps.qxa.settings, { Case: true, case: false });
  const text = JSON.stringify(report);
  for (const privateValue of ['Fixture Person','fixture-member','fixture-map','futureBiography']) assert.ok(!text.includes(privateValue));
  assert.ok(report.categories.some(row => row.type === 'key'));
  assert.ok(report.categories.some(row => row.path === '$'));
});

test('output is deterministic and idempotent, including source fingerprints', async () => {
  const first = clean().document, second = clean().document;
  assert.deepEqual(first, second);
  assert.deepEqual(scrubBackup(structuredClone(first), { vocabulary }).document, first);
  assert.equal(first.state.provenance.sourceHash, `sha256:${'0'.repeat(64)}`);
  assert.equal((await checkBackup(first, { vocabulary, validate: accepts })).valid, true);
  first.state.provenance.sourceHash = `sha256:${'b'.repeat(64)}`;
  await assert.rejects(checkBackup(first, { vocabulary, validate: accepts }), error => error.category === 'unscrubbed-fields');
});

test('check rejects untouched raw input and unknown fields even when text looks like game vocabulary', async () => {
  await assert.rejects(checkBackup(fixture(), { vocabulary, validate: accepts }), error => error.category === 'unscrubbed-fields');
  const document = clean().document;
  document.state.provenance.futureBiography = 'Mining';
  await assert.rejects(checkBackup(document, { vocabulary, validate: accepts }), error => error.category === 'unscrubbed-fields');
});

test('nested undo note and command name remain scrubbed when equal to game text', () => {
  const raw = fixture();
  raw.state.history[0].undo.memberChanges[0].changes[0].path = ['taskStatus','custom:fixture-task','note'];
  raw.state.history[0].command = { type: 'set-runescape-name', memberId: 'fixture-member', name: 'Mining' };
  const { document } = scrubBackup(raw, { vocabulary });
  assert.notEqual(document.state.history[0].command.name, 'Mining');
  assert.notEqual(document.state.history[0].undo.memberChanges[0].changes[0].after.value, 'Mining');
});

test('section keys and numeric starting-chunk undo guards retain gameplay syntax', () => {
  const raw = fixture();
  raw.state.members[0].sectionOverrides = { '100-0': false };
  const v = { keys: new Set([...keys, 'sectionOverrides','preferences','startingChunk']), values: vocabulary.values };
  raw.state.history[0].undo.memberChanges[0].changes[0].path = ['preferences','startingChunk'];
  raw.state.history[0].undo.memberChanges[0].changes[0].after.value = '100';
  const { document } = scrubBackup(raw, { vocabulary: v });
  assert.deepEqual(document.state.members[0].sectionOverrides, { '100-0': false });
  assert.equal(document.state.history[0].undo.memberChanges[0].changes[0].after.value, '100');
});

test('numeric task-rule amounts and rates survive current state, commands and undo', () => {
  const raw = fixture();
  raw.state.members[0].taskRules = { 'Kill X Amount': '25', 'Fixture game cutoff': '1/25' };
  raw.state.history[0].command = { type: 'set-task-rule', memberId: 'fixture-member', ruleId: 'Kill X Amount', value: '25' };
  raw.state.history[0].undo.memberChanges[0].changes[0].path = ['taskRules','Kill X Amount'];
  raw.state.history[0].undo.memberChanges[0].changes[0].after.value = '25';
  const v = { keys: new Set([...keys, 'taskRules']), values: new Set([...vocabulary.values, 'Kill X Amount','Fixture game cutoff','set-task-rule']) };
  const { document } = scrubBackup(raw, { vocabulary: v });
  assert.deepEqual(document.state.members[0].taskRules, raw.state.members[0].taskRules);
  assert.equal(document.state.members[0].taskRules['Kill X Amount'], '25');
  assert.equal(document.state.members[0].taskRules['Fixture game cutoff'], '1/25');
  assert.equal(document.state.history[0].command.value, '25');
  assert.equal(document.state.history[0].undo.memberChanges[0].changes[0].after.value, '25');
});

test('private identifiers matching game words do not change game categories', () => {
  const raw = fixture(); raw.state.members[0].id = 'Mining'; raw.state.tasks[0].memberIds = ['Mining'];
  const { document } = scrubBackup(raw, { vocabulary });
  assert.equal(document.state.members[0].id, 'player1');
  assert.equal(document.state.tasks[0].memberIds[0], 'player1');
  assert.equal(document.state.tasks[0].category, 'Mining');
});

test('existing placeholders are reserved to avoid generated collisions', () => {
  const raw = fixture(); raw.state.members[0].notes['101'] = 'example00001';
  const { document } = scrubBackup(raw, { vocabulary });
  assert.notEqual(document.state.members[0].name, 'example00001');
  assert.equal(document.state.members[0].notes['101'], 'example00001');
});

test('numeric vocabulary and free-text numbers cannot bypass privacy context', () => {
  const raw = fixture();
  raw.state.provenance.value = '100';
  raw.state.provenance.notes = { 'fixture-note': 9876543 };
  const { document } = scrubBackup(raw, { vocabulary });
  assert.notEqual(document.state.provenance.value, '100');
  assert.ok(!JSON.stringify(document.state.provenance).includes('9876543'));
});

test('personal paths and network shapes are scrubbed even if present in trusted vocabulary', () => {
  const raw = fixture(), fakePath = ['C:', 'Users', 'FixturePerson', 'save.json'].join('/');
  raw.state.provenance.source = fakePath;
  const v = { keys, values: new Set([...vocabulary.values, fakePath]) };
  assert.ok(!JSON.stringify(scrubBackup(raw, { vocabulary: v }).document).includes(fakePath));
});

test('secret scanner and private corpus are mandatory when supplied, with no value exceptions', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'save-copy-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await addFingerprints(['Mine fixture ore'], directory);
  const corpus = await loadCorpus(directory);
  await assert.rejects(checkBackup(clean().document, { vocabulary, corpus, validate: accepts }), error => error.category === 'secret-scan-findings');
  await assert.rejects(availableCorpus(path.join(directory, 'missing')), error => error.category === 'missing-or-invalid-corpus');
});

test('preparation replaces a corpus match even when authored vocabulary would keep it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'save-copy-preflight-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await addFingerprints(['Mine fixture ore'], directory);
  const corpus = await loadCorpus(directory);
  const { document, report } = await prepareSaveCopy(fixture(), { vocabulary, corpus, validate: accepts });
  assert.notEqual(document.state.tasks[0].label, 'Mine fixture ore');
  assert.ok(report.categories.some(row => row.kind === 'secret-scan-match' && row.action === 'replaced'));
  assert.equal(report.check.corpus, 'checked');
});

test('scrubbed custom identifiers retain the prefix needed to edit custom tasks', () => {
  const raw = fixture(), id = 'custom:Fixture Person';
  raw.state.tasks[0].id = id; raw.state.members[0].completedTasks = [id];
  const { document } = scrubBackup(raw, { vocabulary });
  assert.match(document.state.tasks[0].id, /^custom:example\d{5}$/);
  assert.equal(document.state.members[0].completedTasks[0], document.state.tasks[0].id);
});

test('load proof refuses live ports before any storage or server access', async () => {
  await assert.rejects(proveLoad({ save: path.resolve('synthetic.json'), scratch: path.resolve('synthetic-scratch'), port: 8788 }), error => error.category === 'usage');
});

test('check uses the application backup validator, not just the envelope/counts', async () => {
  const document = clean().document;
  await assert.rejects(checkBackup(document, { vocabulary, validate() { throw new TypeError('Synthetic invalid state'); } }), error => error.category === 'invalid-backup-state');
  assert.throws(() => scrubBackup({ format: 'other' }, { vocabulary }), error => error.category === 'invalid-backup');
});

test('synthetic backup round-trips through the real application importer without packs or a server', async () => {
  process.env.RS3_DATASET = 'open-f2p';
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') && key !== 'RS3_DATASET') delete process.env[key];
  const { createGroupState, importBackup } = await import('../app/core/state.mjs');
  const state = createGroupState([{ id: 'fixture-member', name: 'Fixture Person', notes: { '100': 'Fixture Person' } }]);
  const raw = { format: 'rs3-chunk-picker', schemaVersion: 1, state };
  const realVocabulary = { keys: schemaKeys, values: vocabulary.values };
  const { document } = scrubBackup(raw, { vocabulary: realVocabulary });
  assert.equal((await checkBackup(document, { vocabulary: realVocabulary })).valid, true);
  assert.equal(importBackup(document).members[0].id, 'player1');
  const invalid = structuredClone(document); invalid.state.revision = -1;
  await assert.rejects(checkBackup(invalid, { vocabulary: realVocabulary }), error => error.category === 'invalid-backup-state');
});

test('CLI masks malformed JSON and refuses input/output aliases before writing', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'save-copy-cli-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.json');
  await writeFile(input, '{"Fixture Person":bad}');
  const script = fileURLToPath(new URL('../scripts/save-copy/scrub-save.mjs', import.meta.url));
  const env = { ...process.env, RS3_DATASET: 'open-f2p' };
  for (const key of ['RS3_PACKS_DIR','RS3_PACK_SELECTION','RS3_DATASET_PROFILE','RS3_DATASET_PROFILE_SHA256','RS3_PRIVATE_ADDON','RS3_PRIVATE_ADDON_SHA256','RS3_GAME_DEFAULTS_FILE','SECRET_SCAN_CORPUS']) delete env[key];
  const result = spawnSync(process.execPath, [script, input, input], { encoding: 'utf8', env, timeout: 120000 });
  assert.equal(result.status, 1); assert.ok(!result.stderr.includes('Fixture Person'));
  assert.equal(await readFile(input, 'utf8'), '{"Fixture Person":bad}');
});
