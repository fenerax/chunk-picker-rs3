// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPickerLimits, MP7_DEFAULTS } from '../app/security/picker-limits.mjs';
import { openPluginKeys } from '../app/plugin-keys.mjs';

const owner = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const picker = n => 'p_' + n.toString(16).padStart(32, '0');
const digest = text => createHash('sha256').update(text).digest('hex');
const record = (n, player, accountId, revoked = false) => ({ id: owner(n), player, accountId, label: 'Synthetic key',
  createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, lastWorld: null, revoked, tokenHash: digest(`synthetic-key-${n}`) });
const refused = (fn, pattern) => assert.throws(fn, error => error.status === 429 && error.retryAfter >= 1 && pattern.test(error.message));

async function fixture(t, groups) {
  const root = await mkdtemp(path.join(tmpdir(), 'launch-plugin-caps-'));
  const entries = groups.map((keys, n) => ({ id: picker(n + 1), kind: 'default', lifecycle: 'active', keys }));
  const file = id => path.join(root, id, 'plugin-keys.json');
  // Persist the exact existing schema. The registry stub supplies only directory
  // and issuer lookup; real server/index integration is covered by HTTP tests.
  for (const entry of entries) {
    await mkdir(path.dirname(file(entry.id)));
    await writeFile(file(entry.id), JSON.stringify({ schemaVersion: 1, keys: entry.keys }));
  }
  const registry = { listPickers: () => entries, pickerDirectory: id => path.dirname(file(id)), resolveCapability: () => null,
    deletionRecords: () => ({ pickers: entries.filter(e => e.lifecycle === 'deleted').map(e => ({ pickerId: e.id })), accounts: [] }) };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { registry, file, entries, async restart(options = {}, diagnostics) { const limits = createPickerLimits(options, diagnostics); await limits.initialize(registry); return limits; } };
}

test('default key limits are independent character/login/group/global ceilings', () => {
  assert.deepEqual([MP7_DEFAULTS.pluginKeysPerCharacter, MP7_DEFAULTS.pluginKeysPerAccount,
    MP7_DEFAULTS.pluginKeysPerPicker, MP7_DEFAULTS.pluginKeysGlobal], [3, 30, 15, 9000]);
});

test('three keys per member slot include pending issuance, span logins, and keep same-named slots in other pickers separate', () => {
  const limits = createPickerLimits();
  const first = limits.reserveKey({ accountId: owner(1) }, picker(1), 'same');
  first.finish('gpk_' + 'a'.repeat(43));
  limits.reserveKey({ accountId: owner(1) }, picker(1), 'same').finish('gpk_' + 'b'.repeat(43));
  const pending = limits.reserveKey({ accountId: owner(2) }, picker(1), 'same');
  refused(() => limits.reserveKey({ accountId: owner(3) }, picker(1), 'same'), /This character/);
  limits.reserveKey({ accountId: owner(1) }, picker(2), 'same').finish();
  pending.finish(); pending.finish();
  limits.reserveKey({ accountId: owner(1) }, picker(1), 'same').finish('gpk_' + 'c'.repeat(43));
  refused(() => limits.reserveKey({ accountId: owner(1) }, picker(1), 'same'), /This character/);
});

for (const [name, groups, target, message] of [
  ['character', [[1, 2, 3].map(n => record(n, 'one', owner(1)))], [owner(2), picker(1), 'one'], /This character/],
  ['login', Array.from({ length: 10 }, (_, g) => [1, 2, 3].map(n => record(g * 3 + n, 'one', owner(1)))), [owner(1), picker(11), 'one'], /This login/],
  ['group', [Array.from({ length: 15 }, (_, n) => record(n + 1, `member${Math.floor(n / 3)}`, owner(n + 1)))], [owner(16), picker(1), 'extra'], /This group/],
]) test(`stored offline keys enforce the ${name} cap after restart without changing any records`, async t => {
  const f = await fixture(t, groups), before = await Promise.all(groups.map((_, g) => readFile(f.file(picker(g + 1)), 'utf8')));
  for (const limits of [await f.restart(), await f.restart()]) {
    refused(() => limits.reserveKey({ accountId: target[0] }, target[1], target[2]), message);
    limits.reserveKey({ accountId: owner(999) }, picker(999), 'unrelated').finish();
  }
  assert.deepEqual(await Promise.all(groups.map((_, g) => readFile(f.file(picker(g + 1)), 'utf8'))), before);
});

test('9000 stored offline keys refuse globally across restart; revocation releases only its slot and preserves records', async t => {
  const groups = Array.from({ length: 600 }, (_, g) => Array.from({ length: 15 }, (_, n) =>
    record(g * 15 + n + 1, `member${Math.floor(n / 3)}`, owner(g * 5 + Math.floor(n / 3) + 1))));
  const f = await fixture(t, groups);
  for (const limits of [await f.restart(), await f.restart()]) {
    refused(() => limits.reserveKey({ accountId: owner(3001) }, picker(601), 'one'), /The service/);
  }
  const firstFile = f.file(picker(1)), before = JSON.parse(await readFile(firstFile, 'utf8'));
  before.keys[0].revoked = true; await writeFile(firstFile, JSON.stringify(before));
  const limits = await f.restart();
  const reservation = limits.reserveKey({ accountId: owner(3001) }, picker(601), 'one');
  refused(() => limits.reserveKey({ accountId: owner(3002) }, picker(602), 'one'), /The service/);
  reservation.finish('gpk_' + 'z'.repeat(43));
  const after = JSON.parse(await readFile(firstFile, 'utf8'));
  assert.deepEqual(after, before); assert.equal(after.keys.length, 15);
  assert.equal(after.keys.filter(k => !k.revoked).length, 14);
});

test('at-cap plugin key admission and release inspect only their scope rows', async t => {
  const groups = Array.from({ length: 600 }, (_, g) => Array.from({ length: 15 }, (_, n) =>
    record(g * 15 + n + 1, `member${Math.floor(n / 3)}`, owner(g * 5 + Math.floor(n / 3) + 1))));
  const f = await fixture(t, groups); let visits = 0;
  const limits = await f.restart({}, { onKeyCount: () => visits++ }); visits = 0;
  refused(() => limits.reserveKey({ accountId: owner(3001) }, picker(601), 'one'), /The service/);
  assert.equal(visits, 1);
  visits = 0; limits.revokeKey(groups[0][0].tokenHash); assert.equal(visits, 4);
  visits = 0; const pending = limits.reserveKey({ accountId: owner(3001) }, picker(601), 'one'); assert.equal(visits, 8);
  visits = 0; pending.finish('gpk_synthetic-new'); assert.equal(visits, 0);
});

test('seeded random issuance, cancellation, revocation, deletion and restart match full plugin quota rescans', async t => {
  const f = await fixture(t, Array.from({ length: 8 }, () => []));
  let limits = await f.restart(), seed = 0x208, serial = 0;
  const choose = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % max; };
  const pending = [];
  const compare = () => {
    const counts = {};
    const add = (accountId, pickerId, memberId) => {
      for (const name of ['keys:global', `keys:account:${accountId}`, `keys:picker:${pickerId}`,
        `keys:character:${JSON.stringify([pickerId, memberId])}`]) counts[name] = (counts[name] ?? 0) + 1;
    };
    for (const entry of f.entries) if (entry.lifecycle === 'active') for (const key of entry.keys) if (!key.revoked) add(key.accountId, entry.id, key.player);
    for (const held of pending) add(held.accountId, held.pickerId, held.memberId);
    assert.deepEqual(limits.keyCounts(), counts);
  };
  for (let step = 0; step < 180; step++) {
    const kind = choose(6), group = f.entries[choose(f.entries.length)];
    if (kind <= 1 && group.lifecycle === 'active') {
      const accountId = owner(choose(3) + 1), memberId = `member${choose(5)}`;
      try { pending.push({ reservation: limits.reserveKey({ accountId }, group.id, memberId), accountId, pickerId: group.id, memberId }); }
      catch (error) { assert.equal(error.status, 429); }
    } else if (kind === 2 && pending.length) {
      const held = pending.splice(choose(pending.length), 1)[0], token = `gpk_synthetic-${++serial}`;
      const entry = f.entries.find(e => e.id === held.pickerId);
      if (choose(2)) {
        held.reservation.finish(token);
        entry.keys.push({ ...record(serial, held.memberId, held.accountId), tokenHash: digest(token) });
        await writeFile(f.file(entry.id), JSON.stringify({ schemaVersion: 1, keys: entry.keys }));
      } else held.reservation.finish();
      held.reservation.finish();
    } else if (kind === 3 && group.keys.length) {
      const key = group.keys[choose(group.keys.length)]; key.revoked = true;
      limits.revokeKey(key.tokenHash); limits.revokeKey(key.tokenHash);
      await writeFile(f.file(group.id), JSON.stringify({ schemaVersion: 1, keys: group.keys }));
    } else if (kind === 4 && step > 90 && !pending.some(p => p.pickerId === group.id)) {
      group.lifecycle = 'deleted'; limits.forgetDeleted();
    } else if (kind === 5) {
      while (pending.length) { pending.pop().reservation.finish(); compare(); }
      limits = await f.restart();
    }
    compare();
  }
});

test('key-file boundary retains all 1000 historical records and refuses issuance cleanly after reopening', async t => {
  const records = Array.from({ length: 1000 }, (_, n) => record(n + 1, 'one', owner(1), true));
  const f = await fixture(t, [records]), options = { dataDir: path.dirname(f.file(picker(1))), maxActiveKeysPerPlayer: 3 };
  const before = await readFile(f.file(picker(1)), 'utf8');
  for (let restart = 0; restart < 2; restart++) {
    const keys = await openPluginKeys(options);
    try {
      await assert.rejects(keys.create('one', 'Synthetic new', owner(1)), error => error.status === 429 && /record limit.*operator/.test(error.message));
      assert.equal(keys.list().length, 1000);
    } finally { await keys.close(); }
    assert.equal(await readFile(f.file(picker(1)), 'utf8'), before);
  }
});

test('member-key issuance stays at three when login allowance is thirty, retaining tokens and records across reopen', async t => {
  const f = await fixture(t, [[]]), options = { dataDir: path.dirname(f.file(picker(1))), maxActiveKeysPerPlayer: MP7_DEFAULTS.pluginKeysPerCharacter };
  let keys = await openPluginKeys(options);
  const issued = [];
  for (let n = 0; n < 3; n++) issued.push(await keys.create('one', 'Synthetic', owner(1)));
  await keys.close(); keys = await openPluginKeys(options);
  try {
    const before = await readFile(f.file(picker(1)), 'utf8');
    await assert.rejects(keys.create('one', 'Synthetic refused', owner(1)), { status: 429 });
    assert.equal(await readFile(f.file(picker(1)), 'utf8'), before);
    for (const key of issued) assert.equal(keys.authenticate({ headers: { authorization: `Bearer ${key.key}` } }).id, key.record.id);
  } finally { await keys.close(); }
});
