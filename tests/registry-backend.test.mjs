import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import { openRegistry, registryRecoveryDocument, REGISTRY_PROVISION_POINTS } from '../app/storage/registry.mjs';
import { openRegistryBackend } from '../app/storage/registry-backend.mjs';

const moduleUrl = new URL('../app/storage/registry.mjs', import.meta.url).href;
const backendUrl = new URL('../app/storage/registry-backend.mjs', import.meta.url).href;
async function fixture(t, registryBackend) {
  const root = await mkdtemp(path.join(tmpdir(), 'registry-backend-test-'));
  const options = { registryBackend, registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') };
  const cleanup = [];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); await rm(root, { recursive: true, force: true }); });
  return { root, options, cleanup };
}
function run(source) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  return once(child, 'close').then(([code, signal]) => ({ code, signal, stderr }));
}

for (const registryBackend of ['json', 'sqlite']) {
  test(`[${registryBackend}] async provisioning hooks keep their context and exclude commit hooks`, async t => {
    const { options } = await fixture(t, registryBackend), seen = [];
    const registry = await openRegistry({ ...options, async crashPoint(name, { pickerId }) {
      await turn(); seen.push(name); assert.ok(pickerId === null || pickerId === undefined || typeof pickerId === 'string');
    } });
    try {
      await registry.firstLogin('discord', 'synthetic-async-context');
      assert.deepEqual(seen, REGISTRY_PROVISION_POINTS);
    } finally { await registry.close(); }
  });

  test(`[${registryBackend}] checkpoint export holds the queue and detaches credentials`, async t => {
    const { options } = await fixture(t, registryBackend);
    const registry = await openRegistry(options);
    try {
      const login = await registry.firstLogin('discord', 'synthetic-checkpoint');
      await registry.setCapability({ kind: 'plugin-key', hash: createHash('sha256').update('synthetic-checkpoint').digest('hex'),
        pickerId: login.picker.id, accountId: login.account.id, memberId: 'owner' });
      let release, captured;
      const held = new Promise(resolve => { release = resolve; });
      const checkpoint = registry.withRecoveryCheckpoint(async document => { captured = document; await held; return document; });
      await turn();
      const update = registry.linkIdentity(login.account.id, 'google', 'synthetic-checkpoint-linked');
      assert.deepEqual(captured.capabilities, []); assert.deepEqual(captured.accounts[0].identities, []);
      assert.equal(captured.accounts[0].id, login.account.id);
      assert.deepEqual(captured.accounts[0].memberships, login.account.memberships);
      captured.accounts[0].memberships.length = 0;
      assert.equal(registry.getAccount(login.account.id).memberships.length, 1);
      assert.equal(registry.findIdentity('google', 'synthetic-checkpoint-linked'), null);
      release(); await checkpoint; await update;
      assert.equal(registry.findIdentity('google', 'synthetic-checkpoint-linked').id, login.account.id);
    } finally { await registry.close(); }
  });

  for (const phase of ['registry-before-commit', 'registry-after-commit', 'account-tombstoned']) {
    test(`[${registryBackend}] SIGKILL at ${phase} preserves the durable cut`, async t => {
      const { options, cleanup } = await fixture(t, registryBackend);
      let registry = await openRegistry(options);
      const login = await registry.firstLogin('discord', 'synthetic-crash');
      const hash = createHash('sha256').update('synthetic-key').digest('hex');
      await registry.setCapability({ kind: 'plugin-key', hash, pickerId: login.picker.id, accountId: login.account.id, memberId: 'owner' });
      await registry.close();
      const child = await run(`
        import {openRegistry} from ${JSON.stringify(moduleUrl)};
        let armed = false;
        const hook = name => { if (armed && name === ${JSON.stringify(phase)}) process.kill(process.pid, 'SIGKILL'); };
        const registry = await openRegistry({...${JSON.stringify(options)}, crashPoint: hook, commitPoint: hook});
        armed = true;
        ${phase === 'account-tombstoned' ? `await registry.deleteAccount(${JSON.stringify(login.account.id)});` : "await registry.linkIdentity(registry.listAccounts()[0].id, 'google', 'synthetic-linked');"}
        process.exit(1);
      `);
      assert.equal(child.signal, 'SIGKILL', child.stderr);
      registry = await openRegistry(options);
      cleanup.push(() => registry.close());
      if (phase === 'account-tombstoned') {
        assert.equal(registry.getAccount(login.account.id), null);
        assert.equal(registry.resolveCapability('plugin-key', hash), null);
        assert.equal(registry.getPicker(login.picker.id).lifecycle, 'deleting');
      } else {
        assert.equal(Boolean(registry.findIdentity('google', 'synthetic-linked')), phase === 'registry-after-commit');
        assert.equal(registry.getAccount(login.account.id).defaultPickerId, login.picker.id);
      }
    });
  }

  for (const phase of ['registry-before-commit', 'registry-after-commit']) {
    test(`[${registryBackend}] uncertain ${phase} failure poisons caches until restart`, async t => {
      const { options, cleanup } = await fixture(t, registryBackend);
      let armed = false;
      const registry = await openRegistry({ ...options, commitPoint(name) {
        if (armed && name === phase) throw Object.assign(new Error('Synthetic storage failure.'), { code: 'SQLITE_FULL' });
      } });
      await registry.ensureIdentity('discord', 'synthetic-before');
      armed = true;
      await assert.rejects(registry.ensureIdentity('google', 'synthetic-after'), /Synthetic storage failure/);
      assert.throws(() => registry.listAccounts(), /restart/);
      await registry.close();
      const reopened = await openRegistry(options);
      try { assert.equal(reopened.listAccounts().length, phase === 'registry-before-commit' ? 1 : 2); }
      finally { await reopened.close(); }
    });
  }
}

test('SQLite refuses a missing expected database and never falls back to JSON', async t => {
  const { options, cleanup } = await fixture(t, 'sqlite');
  const registry = await openRegistry(options); await registry.ensureIdentity('discord', 'synthetic-missing'); await registry.close();
  const file = path.join(options.registryDir, 'registry.sqlite'); await rm(file);
  await assert.rejects(openRegistry(options), /database is missing/);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await rm(path.join(options.tombstoneDir, 'ledger.json'));
  await writeFile(path.join(options.registryDir, 'registry.json'), '{"schemaVersion":1,"accounts":[],"pickers":[],"capabilities":[]}\n');
  await assert.rejects(openRegistry(options), /database is missing/);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

function document() {
  const at = new Date(0).toISOString(), accounts = [], pickers = [], capabilities = [];
  for (let n = 0; n < 2; n++) {
    const id = randomUUID(), pickerId = 'p_' + randomBytes(16).toString('hex');
    accounts.push({ id, identities: [{ provider: 'discord', subject: 'synthetic-' + n }],
      memberships: [{ pickerId, role: 'owner', memberId: 'owner' }], defaultPickerId: pickerId, createdAt: at });
    pickers.push({ id: pickerId, kind: 'default', ownerAccountId: id, lifecycle: 'active', provisioning: 'ready', memberIds: ['owner'], createdAt: at });
    capabilities.push({ kind: 'plugin-key', hash: createHash('sha256').update('synthetic-' + n).digest('hex'), pickerId, accountId: id, memberId: 'owner' });
  }
  return { schemaVersion: 1, accounts, pickers, capabilities };
}

test('SQL constraints and transaction-held cap checks roll back complete mutations', async t => {
  const { options, cleanup } = await fixture(t, 'sqlite'); await mkdir(options.registryDir);
  let rejectCaps = false, capChecks = 0;
  const storage = await openRegistryBackend({ ...options, enforceCaps() { capChecks++; if (rejectCaps) throw new Error('Synthetic capacity reached.'); } });
  cleanup.push(() => storage.close());
  const initial = document(); storage.commit(initial);
  const duplicate = structuredClone(initial); duplicate.accounts[1].identities = structuredClone(duplicate.accounts[0].identities);
  assert.throws(() => storage.commit(duplicate), /UNIQUE constraint failed/);
  assert.deepEqual(storage.readView(), initial);
  rejectCaps = true;
  assert.throws(() => storage.commit(document()), /capacity reached/);
  assert.equal(capChecks, 3); assert.deepEqual(storage.readView(), initial);
});

test('SQLite recovery exports are a sanitized consistent cut during continuous writes', { timeout: 30000 }, async t => {
  const { options, cleanup } = await fixture(t, 'sqlite'); await mkdir(options.registryDir);
  const initial = document(), storage = await openRegistryBackend(options); storage.commit(initial); storage.close();
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {openRegistryBackend} from ${JSON.stringify(backendUrl)};
    const storage = await openRegistryBackend(${JSON.stringify(options)});
    const document = ${JSON.stringify(initial)};
    let n = 0, stopped = false;
    process.on('message', () => { stopped = true; });
    async function write() {
      if (stopped) { storage.close(); process.send({count:n}); process.disconnect(); return; }
      const at = new Date(++n).toISOString();
      for (const a of document.accounts) a.createdAt = at;
      for (const p of document.pickers) p.createdAt = at;
      storage.commit(document);
      if (n === 1) process.send({ready:true});
      setImmediate(write);
    }
    write();
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const exited = once(child, 'close');
  cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  await once(child, 'message');
  const reader = await openRegistryBackend({ ...options, readOnly: true });
  const epochs = new Set();
  try {
    for (let n = 0; n < 60; n++) {
      const backup = registryRecoveryDocument(reader.readView());
      assert.equal(backup.schemaVersion, 1); assert.deepEqual(backup.capabilities, []);
      assert.ok(backup.accounts.every(a => a.identities.length === 0));
      const timestamps = new Set([...backup.accounts, ...backup.pickers].map(row => row.createdAt));
      assert.equal(timestamps.size, 1); epochs.add([...timestamps][0]);
      assert.equal(backup.accounts.length, 2); assert.equal(backup.pickers.length, 2);
      for (const a of backup.accounts) assert.ok(backup.pickers.some(p => p.id === a.defaultPickerId && p.ownerAccountId === a.id));
      await turn();
    }
  } finally { reader.close(); child.send('stop'); }
  const [code] = await exited;
  assert.equal(code, 0, stderr); assert.ok(epochs.size > 1, 'Writer must advance while backups are exported.');
});
