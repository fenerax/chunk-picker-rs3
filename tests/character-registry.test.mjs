// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { openRegistry, REGISTRY_PROVISION_POINTS, registryRecoveryDocument, DEFAULT_REGISTRY_CAPS } from '../app/storage/registry.mjs';
import { validateOriginalRegistry, validateOriginalLedger } from './fixtures/registry-v1-reader.mjs';

const at = '2026-01-01T00:00:00.000Z';
const aid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = 'p_' + '1'.repeat(32);
async function crash(options, seam, accountId) {
  const module = new URL('../app/storage/registry.mjs', import.meta.url).href;
  const source = `import { openRegistry } from ${JSON.stringify(module)};
    const [options, seam, accountId] = JSON.parse(process.argv[1]);
    const registry = await openRegistry({ ...options, crashPoint(name) { if (name === seam) process.exit(86); } });
    if (accountId) await registry.addCharacter(accountId, { requestId: 'second', runescapeName: 'Sample' });
    await registry.close();`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, JSON.stringify([options, seam, accountId])], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', code => { try { assert.equal(code, 86, Buffer.concat(chunks).toString()); resolve(); } catch (error) { reject(error); } });
  });
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'character-registry-'));
  const options = { admission: 'open', registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), legacyDir: path.join(root, 'legacy') };
  await mkdir(options.legacyDir);
  let registry;
  const f = { options, file: path.join(options.registryDir, 'registry.json'), ledger: path.join(options.tombstoneDir, 'ledger.json'),
    get registry() { return registry; }, async open(extra) { registry = await openRegistry({ ...options, ...extra }); return registry; },
    async close() { await registry?.close(); registry = null; }, async restart(extra) { await f.close(); return f.open(extra); },
    async seed(size, { legacy = false, viewer = false, conflict = false, unclaimed = false } = {}) {
      const accounts = Array.from({ length: size }, (_, n) => ({ id: aid(n + 1), identities: [{ provider: 'google', subject: `synthetic-${n}` }], memberships: [{ pickerId: pid, role: n === 0 && !legacy ? 'owner' : 'player', memberId: `member${n}` }], defaultPickerId: n === 0 && !legacy ? pid : null, createdAt: at }));
      if (viewer) accounts.push({ id: aid(90), identities: [], memberships: [{ pickerId: pid, role: 'viewer', memberId: null }], defaultPickerId: null, createdAt: at });
      if (conflict) accounts[1].memberships[0].memberId = 'member0';
      const members = Array.from({ length: size }, (_, n) => ({ id: `member${n}`, runescapeName: `Sample ${n}` }));
      if (unclaimed) members.push({ id: 'unclaimed' });
      const picker = { id: pid, kind: legacy ? 'legacy-shared' : 'default', ownerAccountId: legacy ? null : aid(1), lifecycle: 'active', provisioning: 'ready', memberIds: members.map(m => m.id), createdAt: at };
      await mkdir(options.registryDir, { recursive: true }); await mkdir(options.tombstoneDir, { recursive: true });
      const directory = legacy ? options.legacyDir : path.join(options.pickerRoot, pid); await mkdir(directory, { recursive: true });
      const gameplay = JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state: { schemaVersion: 1, members } });
      await writeFile(path.join(directory, 'state.json'), gameplay);
      await writeFile(f.file, JSON.stringify({ schemaVersion: 1, accounts, pickers: [picker], capabilities: [] }));
      await writeFile(f.ledger, JSON.stringify({ schemaVersion: 1, issuedPickerIds: [pid], pickers: [], accounts: [] }));
      return { gameplay, directory, accounts };
    } };
  t.after(async () => { await f.close(); await rm(root, { force: true, recursive: true }); }); return f;
}

for (const size of [1, 2, 3, 4, 5]) test(`migration preserves ${size}-character roster, names, viewer access and gameplay bytes`, async t => {
  const f = await fixture(t), old = await f.seed(size, { viewer: true });
  const before = await readFile(f.file, 'utf8'), ledger = await readFile(f.ledger, 'utf8');
  await f.open();
  assert.equal(f.registry.getPicker(pid).seats.length, size);
  assert.equal(f.registry.listCharacters(aid(90)).length, 0);
  const ids = old.accounts.slice(0, size).map(a => f.registry.listCharacters(a.id)[0].id);
  assert.equal(new Set(ids).size, size);
  for (let n = 0; n < size; n++) {
    const character = f.registry.getCharacter(ids[n]); assert.equal(character.accountId, aid(n + 1));
    assert.deepEqual(character.placement, { pickerId: pid, memberId: `member${n}` }); assert.equal(character.runescapeName, `Sample ${n}`);
  }
  assert.equal(await readFile(path.join(old.directory, 'state.json'), 'utf8'), old.gameplay);
  assert.equal(await readFile(path.join(f.options.registryDir, 'registry.pre-characters-v1.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.options.registryDir, 'ledger.pre-characters-v1.json'), 'utf8'), ledger);
  await f.restart(); assert.deepEqual(old.accounts.slice(0, size).map(a => f.registry.listCharacters(a.id)[0].id), ids);
});

test('legacy two-member picker keeps IDs, slots and ownerless compatibility', async t => {
  const f = await fixture(t); await f.seed(2, { legacy: true, viewer: true }); await f.open();
  assert.equal(f.registry.getPicker(pid).ownerCharacterId, null); assert.equal(f.registry.getPicker(pid).seats.length, 2);
  assert.equal((await f.registry.firstLogin('google', 'synthetic-0')).picker, null);
  assert.equal(f.registry.listPickers().length, 1);
});

for (const variant of ['conflict', 'unclaimed']) test(`ambiguous ${variant} migration reports review without changing registry or ledger`, async t => {
  const f = await fixture(t); await f.seed(2, { [variant]: true }); const before = await Promise.all([readFile(f.file), readFile(f.ledger)]);
  await assert.rejects(f.open(), { code: 'CHARACTER_MAPPING_REVIEW' });
  assert.deepEqual(await Promise.all([readFile(f.file), readFile(f.ledger)]), before);
  const report = JSON.parse(await readFile(path.join(f.options.registryDir, 'characters-mapping-review.json')));
  assert.equal(report.conflicts.length > 0, true); assert.equal(JSON.stringify(report).includes('synthetic-'), false);
});

for (const seam of ['migration-backed-up', 'migration-intent', 'migration-ledger', 'migration-registry']) test(`migration retries after ${seam}`, async t => {
  const f = await fixture(t); await f.seed(2); await crash(f.options, seam);
  let planned;
  try { planned = JSON.parse(await readFile(path.join(f.options.registryDir, 'characters-migration.json'))).targets[0].characters.map(c => c.id); } catch {}
  await f.open(); const ids = [aid(1), aid(2)].map(id => f.registry.listCharacters(id)[0].id); if (planned) assert.deepEqual(ids, planned);
  await f.restart(); assert.deepEqual([aid(1), aid(2)].map(id => f.registry.listCharacters(id)[0].id), ids);
});

test('migration reports several owner slots for one login instead of designating by array order', async t => {
  const f = await fixture(t); await f.seed(2);
  const document = JSON.parse(await readFile(f.file));
  document.accounts[0].memberships.push({ ...document.accounts[1].memberships[0], role: 'owner' }); document.accounts.splice(1);
  await writeFile(f.file, JSON.stringify(document)); const before = await Promise.all([readFile(f.file), readFile(f.ledger)]);
  await assert.rejects(f.open(), { code: 'CHARACTER_MAPPING_REVIEW' });
  assert.deepEqual(await Promise.all([readFile(f.file), readFile(f.ledger)]), before);
  const report = JSON.parse(await readFile(path.join(f.options.registryDir, 'characters-mapping-review.json')));
  assert.equal(report.conflicts.some(c => c.reason === 'ambiguous owner character' && c.claims.length === 2), true);
});

for (const seam of [...REGISTRY_PROVISION_POINTS, 'character-ready']) test(`Add character retries the same request after ${seam}`, async t => {
  const f = await fixture(t); await f.open(); const initial = await f.registry.firstLogin('google', 'synthetic-owner'); await f.close();
  await crash(f.options, seam, initial.account.id);
  await f.open();
  const result = await f.registry.addCharacter(initial.account.id, { requestId: 'second', runescapeName: 'Sample' });
  assert.equal(result.picker.provisioning, 'ready'); assert.equal(f.registry.listCharacters(initial.account.id).length, 2);
  assert.equal((await f.registry.addCharacter(initial.account.id, { requestId: 'second', runescapeName: 'Sample' })).character.id, result.character.id);
  assert.equal(f.registry.getPicker(initial.picker.id).id, initial.picker.id);
});

test('ten-character quota, duplicate-name acknowledgement and zero-character return are independent', async t => {
  const f = await fixture(t); await f.open(); const first = await f.registry.firstLogin('discord', 'synthetic-owner');
  const named = await f.registry.addCharacter(first.account.id, { requestId: 'named', runescapeName: 'Sample_Name' });
  await assert.rejects(f.registry.addCharacter(first.account.id, { requestId: 'duplicate', runescapeName: 'sample name' }), { code: 'DUPLICATE_CHARACTER_NAME' });
  await f.registry.addCharacter(first.account.id, { requestId: 'duplicate', runescapeName: 'sample name', acknowledgeDuplicate: true });
  for (let n = 3; n < 10; n++) await f.registry.addCharacter(first.account.id, { requestId: `extra${n}` });
  const before = await readFile(f.file); await assert.rejects(f.registry.addCharacter(first.account.id, { requestId: 'eleven' }), /character limit/); assert.deepEqual(await readFile(f.file), before);
  assert.equal(f.registry.getCharacter(named.character.id).runescapeName, 'Sample_Name');
  await f.close(); const document = JSON.parse(before); document.characters = []; document.pickers = []; document.accounts[0].memberships = []; document.accounts[0].defaultPickerId = null;
  await writeFile(f.file, JSON.stringify(document)); await f.open();
  assert.equal((await f.registry.firstLogin('discord', 'synthetic-owner')).picker, null); assert.equal(f.registry.listCharacters(first.account.id).length, 0);
});

test('same-login same-group selection uses exact character or authorized preference, never array order', async t => {
  const f = await fixture(t); await f.seed(3); const document = JSON.parse(await readFile(f.file));
  document.accounts[0].memberships.push(...document.accounts[1].memberships, ...document.accounts[2].memberships); document.accounts.splice(1);
  await writeFile(f.file, JSON.stringify(document)); await f.open();
  const characters = f.registry.listCharacters(aid(1)); assert.equal(characters.length, 3);
  assert.equal(f.registry.selectCharacter(aid(1), null, pid), null);
  for (const character of characters) assert.equal(f.registry.selectCharacter(aid(1), character.id, pid).placement.memberId, character.placement.memberId);
  await f.registry.rememberCharacter(aid(1), characters[2].id);
  assert.equal(f.registry.selectCharacter(aid(1)).id, characters[2].id);
  assert.throws(() => f.registry.selectCharacter(aid(1), 'c_' + 'f'.repeat(32)), { status: 403 });
});

test('standalone recovery inspection preserves bindings above default service capacity', async t => {
  const f = await fixture(t); await f.seed(1); await f.open(); await f.close();
  const source = JSON.parse(await readFile(f.file)), document = { schemaVersion: 2, accounts: [], pickers: [], capabilities: [], characters: [] };
  for (let n = 1; n <= 3001; n++) {
    const account = structuredClone(source.accounts[0]), picker = structuredClone(source.pickers[0]), character = structuredClone(source.characters[0]);
    account.id = aid(n); account.identities = []; account.defaultPickerId = picker.id = 'p_' + n.toString(16).padStart(32, '0');
    account.memberships[0].pickerId = picker.id; picker.ownerAccountId = character.accountId = account.id;
    character.id = picker.ownerCharacterId = picker.seats[0].characterId = 'c_' + n.toString(16).padStart(32, '0');
    character.placement.pickerId = picker.id;
    document.accounts.push(account); document.pickers.push(picker); document.characters.push(character);
  }
  assert.equal(registryRecoveryDocument(document).characters.length, 3001);
  assert.throws(() => registryRecoveryDocument(document, DEFAULT_REGISTRY_CAPS), /service character limit/);
});

test('shipped schema-1 reader refuses both new documents and new reader refuses future versions without writing', async t => {
  const f = await fixture(t); await f.open(); await f.registry.firstLogin('google', 'synthetic-owner'); await f.close();
  const documents = await Promise.all([readFile(f.file, 'utf8'), readFile(f.ledger, 'utf8')]);
  assert.throws(() => validateOriginalRegistry(JSON.parse(documents[0])), /Invalid registry document/);
  assert.throws(() => validateOriginalLedger(JSON.parse(documents[1])), /Invalid registry document/);
  for (const [index, file] of [f.file, f.ledger].entries()) {
    const newer = JSON.parse(documents[index]); newer.schemaVersion = index === 0 ? 6 : 4; await writeFile(file, JSON.stringify(newer));
    const bytes = await readFile(file); await assert.rejects(f.open(), /Unsupported newer registry/); assert.deepEqual(await readFile(file), bytes);
    await writeFile(file, documents[index]);
  }
});

test('migration preserves existing character non-reuse history and rejects changed intent sources', async t => {
  const f = await fixture(t); await f.seed(1);
  const oldLedger = JSON.parse(await readFile(f.ledger)); oldLedger.schemaVersion = 2;
  oldLedger.issuedCharacterIds = ['c_' + 'e'.repeat(32)]; oldLedger.characters = []; await writeFile(f.ledger, JSON.stringify(oldLedger));
  await assert.rejects(f.open({ crashPoint(name) { if (name === 'migration-intent') throw new Error('interruption'); } }), /interruption/);
  const original = await readFile(f.file); await writeFile(f.file, original + ' ');
  await assert.rejects(f.open(), /migration source changed/); await writeFile(f.file, original);
  await f.open(); assert.equal(JSON.parse(await readFile(f.ledger)).issuedCharacterIds.includes(oldLedger.issuedCharacterIds[0]), true);
});

test('name metadata projection is recoverable and never changes a creation receipt or character identity', async t => {
  const f = await fixture(t); await f.open(); const first = await f.registry.firstLogin('google', 'synthetic-owner');
  const created = await f.registry.addCharacter(first.account.id, { requestId: 'named', runescapeName: 'Sample' });
  await f.registry.updateCharacterNames(created.picker.id, [{ id: 'owner', runescapeName: 'New name' }]);
  await f.restart();
  assert.equal(f.registry.listCharacters(first.account.id).find(c => c.id === created.character.id).runescapeName, 'New name');
  assert.equal((await f.registry.addCharacter(first.account.id, { requestId: 'named', runescapeName: 'Sample' })).character.id, created.character.id);
});

test('service-character and issued-character ceilings refuse before account, picker or ID publication', async t => {
  const f = await fixture(t); await f.open({ caps: { characters: 2, issuedCharacterIds: 2 } });
  const first = await f.registry.firstLogin('google', 'synthetic-owner'); await f.registry.addCharacter(first.account.id, { requestId: 'second' });
  const before = await Promise.all([readFile(f.file), readFile(f.ledger)]);
  await assert.rejects(f.registry.addCharacter(first.account.id, { requestId: 'third' }), { status: 409 });
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-new'), { status: 409 });
  assert.deepEqual(await Promise.all([readFile(f.file), readFile(f.ledger)]), before);
  await f.restart({ caps: { characters: 3, issuedCharacterIds: 2 } });
  await assert.rejects(f.registry.addCharacter(first.account.id, { requestId: 'third' }), /character ID history limit/);
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-new'), /character ID history limit/);
  assert.deepEqual(await Promise.all([readFile(f.file), readFile(f.ledger)]), before);
});

test('reservation fields are validated and five occupied seats cannot reserve a sixth', async t => {
  const f = await fixture(t); await f.seed(5); await f.open(); await f.close();
  const document = JSON.parse(await readFile(f.file));
  document.pickers[0].reservations.push({ id: aid(98), inviteId: aid(99), expiresAt: at });
  await writeFile(f.file, JSON.stringify(document)); const before = await readFile(f.file);
  await assert.rejects(f.open(), /Invalid character registry/); assert.deepEqual(await readFile(f.file), before);
});
