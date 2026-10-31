import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncDirectory, writeRegistryJson } from './registry-lock.mjs';

const clone = value => value === undefined ? undefined : structuredClone(value);
const invalid = () => new Error('Invalid registry document.');
const applicationId = 0x52533352;
const schema = `
  PRAGMA application_id = ${applicationId};
  PRAGMA user_version = 1;
  CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), generation INTEGER NOT NULL) STRICT;
  INSERT INTO metadata VALUES (1, 0);
  CREATE TABLE accounts (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE,
    default_picker_id TEXT UNIQUE, created_at TEXT NOT NULL) STRICT;
  CREATE TABLE pickers (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE,
    kind TEXT NOT NULL, owner_account_id TEXT, lifecycle TEXT NOT NULL,
    provisioning TEXT NOT NULL, member_ids TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
  CREATE UNIQUE INDEX one_legacy ON pickers(kind) WHERE kind = 'legacy-shared';
  CREATE TABLE identities (account_id TEXT NOT NULL REFERENCES accounts(id), position INTEGER NOT NULL,
    provider TEXT NOT NULL, subject TEXT NOT NULL, PRIMARY KEY(provider, subject),
    UNIQUE(account_id, provider), UNIQUE(account_id, position)) STRICT;
  CREATE TABLE memberships (account_id TEXT NOT NULL REFERENCES accounts(id), position INTEGER NOT NULL,
    picker_id TEXT NOT NULL REFERENCES pickers(id), role TEXT NOT NULL, member_id TEXT,
    PRIMARY KEY(account_id, position)) STRICT;
  CREATE UNIQUE INDEX one_membership ON memberships(account_id, picker_id, ifnull(member_id, ''));
  CREATE TABLE capabilities (position INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL, hash TEXT NOT NULL,
    picker_id TEXT NOT NULL REFERENCES pickers(id), account_id TEXT NOT NULL REFERENCES accounts(id),
    member_id TEXT, PRIMARY KEY(kind, hash)) STRICT;
`;

/** Internal storage boundary. Ownership and the domain queue belong to openRegistry.
 * commitPoint is synchronous fault injection, separate from async provisioning hooks. */
export async function openRegistryBackend({ registryDir, registryBackend = 'json', expected = false,
  readOnly = false, validate = () => {}, enforceCaps = () => {}, commitPoint } = {}) {
  if (!['json', 'sqlite'].includes(registryBackend)) throw new TypeError('Invalid registry backend.');
  const file = path.join(registryDir, registryBackend === 'json' ? 'registry.json' : 'registry.sqlite');
  if (registryBackend === 'json') {
    let view;
    try { view = JSON.parse(await readFile(file, 'utf8')); }
    catch (failure) { if (failure.code !== 'ENOENT') throw invalid(); if (readOnly) throw new Error('Registry is missing.'); }
    return {
      readView() { return clone(view); },
      async commit(next) {
        if (readOnly) throw new Error('Registry is read-only.');
        validate(next); enforceCaps(next);
        commitPoint?.('registry-before-commit');
        await writeRegistryJson(file, next);
        commitPoint?.('registry-after-commit');
        view = clone(next);
      },
      close() {},
    };
  }

  // Check before connecting: DatabaseSync's writable constructor otherwise creates
  // an empty file. A surviving ledger or JSON image makes this an expected store.
  let exists = true;
  try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw invalid(); }
  catch (failure) { if (failure.code !== 'ENOENT') throw failure; exists = false; }
  let jsonExists = false;
  try { await lstat(path.join(registryDir, 'registry.json')); jsonExists = true; }
  catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
  if (!exists && (expected || readOnly || jsonExists)) throw new Error('Registry database is missing.');
  const { DatabaseSync } = await import('node:sqlite');
  let db, generation, initialized = exists;
  try {
    if (!exists) { const handle = await open(file, 'wx', 0o600); await handle.close(); }
    db = new DatabaseSync(file, { readOnly });
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    if (exists) {
      if (db.prepare('PRAGMA application_id').get().application_id !== applicationId ||
          db.prepare('PRAGMA user_version').get().user_version !== 1 ||
          db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
          db.prepare('PRAGMA foreign_key_check').all().length) throw invalid();
      generation = db.prepare('SELECT generation FROM metadata WHERE singleton = 1').get()?.generation;
      if (!Number.isSafeInteger(generation) || generation < 0 || db.prepare('SELECT count(*) n FROM metadata').get().n !== 1) throw invalid();
      validate(readView());
    }
    if (!readOnly) {
      if (db.prepare('PRAGMA journal_mode = WAL').get().journal_mode !== 'wal') throw new Error('Registry WAL mode unavailable.');
      db.exec('PRAGMA synchronous = FULL; PRAGMA wal_autocheckpoint = 1000;');
      if (!exists) {
        db.exec('BEGIN IMMEDIATE;');
        try { db.exec(schema); db.exec('COMMIT;'); generation = 0; }
        catch (failure) { db.exec('ROLLBACK;'); throw failure; }
        await syncDirectory(registryDir);
      }
    }
  } catch {
    db?.close();
    throw invalid();
  }

  function readView() {
    if (!initialized) return undefined;
    db.exec('BEGIN;');
    try {
      // The first SELECT pins the snapshot for every table, including WAL pages.
      const version = db.prepare('SELECT generation FROM metadata WHERE singleton = 1').get();
      if (!version) throw invalid();
      const accounts = db.prepare('SELECT * FROM accounts ORDER BY position').all().map(a => ({
        id: a.id, identities: [], memberships: [], defaultPickerId: a.default_picker_id, createdAt: a.created_at }));
      const byId = new Map(accounts.map(a => [a.id, a]));
      for (const i of db.prepare('SELECT * FROM identities ORDER BY account_id, position').all()) {
        byId.get(i.account_id).identities.push({ provider: i.provider, subject: i.subject });
      }
      for (const m of db.prepare('SELECT * FROM memberships ORDER BY account_id, position').all()) {
        byId.get(m.account_id).memberships.push({ pickerId: m.picker_id, role: m.role, memberId: m.member_id });
      }
      const pickers = db.prepare('SELECT * FROM pickers ORDER BY position').all().map(p => ({
        id: p.id, kind: p.kind, ownerAccountId: p.owner_account_id, lifecycle: p.lifecycle,
        provisioning: p.provisioning, memberIds: JSON.parse(p.member_ids), createdAt: p.created_at }));
      const capabilities = db.prepare('SELECT * FROM capabilities ORDER BY position').all().map(c => ({
        kind: c.kind, hash: c.hash, pickerId: c.picker_id, accountId: c.account_id, memberId: c.member_id }));
      const document = { schemaVersion: 1, accounts, pickers, capabilities };
      validate(document);
      db.exec('COMMIT;');
      return document;
    } catch (failure) { db.exec('ROLLBACK;'); throw failure; }
  }

  return {
    readView,
    commit(next) {
      if (readOnly) throw new Error('Registry is read-only.');
      db.exec('BEGIN IMMEDIATE;');
      let committed = false;
      try {
        if (db.prepare('SELECT generation FROM metadata WHERE singleton = 1').get().generation !== generation) throw new Error('Registry generation changed.');
        // Checks are repeated under the write transaction, before changing rows.
        validate(next); enforceCaps(next);
        db.exec('DELETE FROM capabilities; DELETE FROM memberships; DELETE FROM identities; DELETE FROM pickers; DELETE FROM accounts;');
        const account = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)');
        const picker = db.prepare('INSERT INTO pickers VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const identity = db.prepare('INSERT INTO identities VALUES (?, ?, ?, ?)');
        const membership = db.prepare('INSERT INTO memberships VALUES (?, ?, ?, ?, ?)');
        const capability = db.prepare('INSERT INTO capabilities VALUES (?, ?, ?, ?, ?, ?)');
        next.accounts.forEach((a, n) => account.run(a.id, n, a.defaultPickerId, a.createdAt));
        next.pickers.forEach((p, n) => picker.run(p.id, n, p.kind, p.ownerAccountId, p.lifecycle, p.provisioning, JSON.stringify(p.memberIds), p.createdAt));
        for (const a of next.accounts) {
          a.identities.forEach((i, n) => identity.run(a.id, n, i.provider, i.subject));
          a.memberships.forEach((m, n) => membership.run(a.id, n, m.pickerId, m.role, m.memberId));
        }
        next.capabilities.forEach((c, n) => capability.run(n, c.kind, c.hash, c.pickerId, c.accountId, c.memberId));
        db.prepare('UPDATE metadata SET generation = generation + 1 WHERE singleton = 1').run();
        commitPoint?.('registry-before-commit');
        db.exec('COMMIT;'); committed = true;
        commitPoint?.('registry-after-commit');
        generation++; initialized = true;
      } catch (failure) { if (!committed) db.exec('ROLLBACK;'); throw failure; }
    },
    close() { db.close(); },
  };
}
