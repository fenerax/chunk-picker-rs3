// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRegistry, DEFAULT_REGISTRY_CAPS } from '../app/storage/registry.mjs';
import { createRegistryCaps } from '../app/storage/registry-caps.mjs';

const at = '2026-01-01T00:00:00.000Z';
const accountId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pickerId = n => 'p_' + n.toString(16).padStart(32, '0');
const account = n => ({ id: accountId(n), identities: [{ provider: 'google', subject: `synthetic-${n}` }], memberships: [], defaultPickerId: null, createdAt: at });
const key = (n, picker, owner) => ({ kind: n % 2 ? 'plugin-key' : 'overlay-capability', hash: n.toString(16).padStart(64, '0'),
  pickerId: picker.id, accountId: owner.id, memberId: 'owner' });
const random = seed => max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'registry-counts-'));
  const settings = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), ...options };
  const file = path.join(settings.registryDir, 'registry.json');
  let registry;
  const f = { settings, file, get registry() { return registry; },
    async document() { return JSON.parse(await readFile(file, 'utf8')); },
    async restart() { await registry?.close(); registry = undefined; registry = await openRegistry(settings); },
    async seed(document, ledger) {
      await mkdir(settings.registryDir, { recursive: true }); await mkdir(settings.tombstoneDir, { recursive: true });
      await writeFile(file, JSON.stringify(document)); await writeFile(path.join(settings.tombstoneDir, 'ledger.json'), JSON.stringify(ledger));
    },
  };
  t.after(async () => { await registry?.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}
function rescan(document) {
  const capabilities = {};
  for (const record of document.capabilities) capabilities[record.pickerId] = (capabilities[record.pickerId] ?? 0) + 1;
  return { accounts: document.accounts.length, activePickers: document.pickers.filter(p => p.lifecycle !== 'deleted').length,
    memberships: Object.fromEntries(document.accounts.map(a => [a.id, a.memberships.length])),
    members: Object.fromEntries(document.pickers.map(p => [p.id, p.memberIds.length])), capabilities, capabilityTotal: document.capabilities.length };
}

test('seeded random registry edits and restarts keep every incremental count equal to a full rescan', async t => {
  const f = await fixture(t, { caps: { accounts: 12, pickers: 9, capabilities: 15, capabilitiesPerPicker: 4 } });
  const choose = random(0x208cafe), actions = new Set(); let serial = 0;
  await f.restart();
  for (let step = 0; step < 140; step++) {
    const before = await f.document(), accounts = before.accounts, active = before.pickers.filter(p => p.lifecycle === 'active');
    const a = accounts[choose(accounts.length)], p = active[choose(active.length)];
    const kind = step < 8 ? step : choose(8); actions.add(kind);
    try {
      if (kind === 0 || !a) await f.registry.firstLogin('discord', `synthetic-${++serial}`);
      else if (kind === 1 && p) await f.registry.setCapability(key(++serial, p, accounts.find(a => a.id === p.ownerAccountId)));
      else if (kind === 2 && before.capabilities.length) {
        const c = before.capabilities[choose(before.capabilities.length)]; await f.registry.revokeCapability(c.kind, c.hash);
        await f.registry.revokeCapability(c.kind, c.hash); // Duplicate completion is harmless.
      } else if (kind === 3) await f.registry.deleteAccount(a.id);
      else if (kind === 4) await f.restart();
      else if (kind === 5 && p) {
        await f.registry.reserveTransferMembers(p.id, ['owner', 'synthetic-member']);
        await f.registry.attachMembership(a.id, { pickerId: p.id, memberId: 'synthetic-member', role: 'player' });
        await f.registry.setCapability({ ...key(++serial, p, a), memberId: 'synthetic-member' });
        await f.registry.removeMembership(a.id, p.id, 'synthetic-member');
      } else if (kind === 6 && p) await f.registry.beginPickerDeletion(p.id);
      else if (kind === 7) {
        const deleting = before.pickers.find(p => p.lifecycle === 'deleting');
        if (deleting) {
          await rm(f.registry.pickerDirectory(deleting.id), { recursive: true, force: true });
          await f.registry.completePickerDeletion(deleting.id);
        }
      }
    } catch (error) { assert.equal(error.status, 409, error.stack); }
    const document = await f.document();
    assert.deepEqual(f.registry.capCounts(), rescan(document), `seeded step ${step}, action ${kind}`);
    for (const picker of document.pickers) for (const member of picker.memberIds) {
      assert.deepEqual(f.registry.accountsForMember(picker.id, member).sort(), document.accounts
        .filter(a => a.memberships.some(m => m.pickerId === picker.id && m.memberId === member)).map(a => a.id).sort());
    }
    for (const capability of document.capabilities) assert.deepEqual(f.registry.resolveCapability(capability.kind, capability.hash), capability);
  }
  assert.equal(actions.size, 8); await f.restart();
  assert.deepEqual(f.registry.capCounts(), rescan(await f.document()));
});

test('at-limit saves visit only the changed capability; admission never traverses the registry arrays', async t => {
  const checks = [], f = await fixture(t, { onCapCheck: work => checks.push(work) });
  const accounts = Array.from({ length: 3000 }, (_, n) => account(n + 1)), pickers = [], capabilities = [], tombstones = [];
  for (let n = 1; n <= 3500; n++) {
    const p = { id: pickerId(n), kind: 'default', ownerAccountId: accounts[(n - 1) % 3000].id,
      lifecycle: n <= 201 ? 'active' : 'deleting', provisioning: 'ready', memberIds: ['owner'], createdAt: at };
    pickers.push(p);
    if (n <= 201) { const a = accounts[n - 1]; a.defaultPickerId = p.id; a.memberships.push({ pickerId: p.id, role: 'owner', memberId: 'owner' }); }
    else tombstones.push({ pickerId: p.id, lifecycle: 'deleting', deletingAt: at, deletedAt: null });
    if (n <= 200) for (let k = 1; k <= 100; k++) capabilities.push(key((n - 1) * 100 + k, p, accounts[n - 1]));
  }
  const document = { schemaVersion: 1, accounts, pickers, capabilities };
  const ledger = { schemaVersion: 1, issuedPickerIds: pickers.map(p => p.id), pickers: tombstones, accounts: [] };
  await f.seed(document, ledger); await f.restart(); checks.length = 0;
  const removed = capabilities[0], added = key(30000, pickers[200], accounts[200]);
  await f.registry.revokeCapability(removed.kind, removed.hash); await f.registry.setCapability(added);
  assert.deepEqual(checks, [{ accounts: 0, pickers: 0, capabilities: 1 }, { accounts: 0, pickers: 0, capabilities: 1 }]);
  assert.deepEqual(f.registry.capCounts(), rescan(await f.document()));
  // Proxies reject even a single unrelated array-entry read by the cap checker.
  // Whole-document JSON persistence remains outside cap enforcement.
  const indexed = createRegistryCaps(document, DEFAULT_REGISTRY_CAPS); indexed.checkInitial(ledger);
  const lengthOnly = array => new Proxy(array, { get(target, property) {
    assert.equal(property, 'length', `unexpected registry traversal: ${String(property)}`); return target.length;
  } });
  const next = { accounts: lengthOnly(accounts), pickers: lengthOnly(pickers), capabilities: lengthOnly(capabilities) };
  indexed.prepare(next, { issuedPickerIds: lengthOnly(ledger.issuedPickerIds), accounts: lengthOnly([]) },
    { removedCapabilities: [removed], addedCapabilities: [added] })();
  const expected = structuredClone(document); expected.capabilities = expected.capabilities.slice(1).concat(added);
  assert.deepEqual(indexed.snapshot(), rescan(expected));
});
