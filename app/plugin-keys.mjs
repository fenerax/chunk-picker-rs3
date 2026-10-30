import { withStoreWrite } from './storage/snapshot.mjs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = token => createHash('sha256').update(token).digest('hex');
const same = (a, b) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const publicRecord = ({ tokenHash, accountId, ...record }) => structuredClone(record);
function validate(value) {
  if (!value || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'keys'].includes(key)) || !Array.isArray(value.keys) || value.keys.length > 1000) throw new TypeError('Invalid plugin key store.');
  const ids = new Set(), hashes = new Set();
  for (const record of value.keys) {
    if (!record || Object.keys(record).some(key => !['id', 'player', 'label', 'createdAt', 'lastUsedAt', 'lastWorld', 'revoked', 'tokenHash', 'accountId'].includes(key))
      || !/^[a-f0-9-]{36}$/.test(record.id ?? '') || ids.has(record.id) || !/^[a-f0-9]{64}$/.test(record.tokenHash ?? '') || hashes.has(record.tokenHash)
      || record.accountId !== undefined && (typeof record.accountId !== 'string' || !/^[a-f0-9-]{36}$/.test(record.accountId))
      || !/^[A-Za-z0-9_-]{1,64}$/.test(record.player ?? '') || typeof record.label !== 'string' || !record.label.trim() || record.label.length > 80
      || typeof record.revoked !== 'boolean' || !Number.isFinite(Date.parse(record.createdAt))
      || record.lastUsedAt !== null && !Number.isFinite(Date.parse(record.lastUsedAt))
      || record.lastWorld !== null && (!Number.isInteger(record.lastWorld?.id) || record.lastWorld.id < 1 || record.lastWorld.id > 10000 || typeof record.lastWorld.beta !== 'boolean')) throw new TypeError('Invalid plugin key record.');
    ids.add(record.id); hashes.add(record.tokenHash);
  }
  return value;
}
async function write(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`; let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(`${JSON.stringify(validate(value))}\n`);
    await handle.sync(); await handle.close(); handle = null;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(20 * 2 ** attempt);
      }
    }
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
}

/** Separate hash-only credentials, protected by the save directory's existing lock. */
export async function openPluginKeys({ dataDir, clock = Date.now, maxActiveKeysPerPlayer }) {
  const file = path.join(dataDir, 'plugin-keys.json'); let current, queue = Promise.resolve(), closed = false, dirty = false;
  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; current = { schemaVersion: 1, keys: [] }; }
  const bearerHash = request => {
    const token = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
    return token ? hash(token) : null;
  };
  function mutate(operation) {
    const pending = queue.then(() => withStoreWrite(dataDir, async () => {
      if (closed) throw fail(503, 'The picker is stopping.');
      const next = structuredClone(current), result = operation(next);
      await write(file, next); current = next; dirty = false; return result;
    })); queue = pending.catch(() => {}); return pending;
  }
  return {
    isCredential(request) { return /^Bearer gpk_/i.test(request.headers.authorization ?? '') || !!bearerHash(request); },
    authenticate(request) {
      // Cookies and every other credential are irrelevant here, even if supplied alongside the key.
      const digest = bearerHash(request);
      const record = digest && current.keys.find(record => !record.revoked && same(record.tokenHash, digest));
      if (!record) throw fail(401, 'A game plugin key is required.');
      return publicRecord(record);
    },
    list(player) { return current.keys.filter(record => player === undefined || record.player === player).map(publicRecord); },
    create(player, label, accountId) {
      return mutate(next => {
        if (next.keys.filter(record => record.player === player && !record.revoked).length >= (maxActiveKeysPerPlayer ?? 3)) throw maxActiveKeysPerPlayer ? Object.assign(fail(429, 'Revoke an existing plugin key and retry.'), { retryAfter: 1 }) : fail(409, 'Revoke a key first. Each player can have three active keys.');
        if (next.keys.length >= 1000) throw maxActiveKeysPerPlayer ? Object.assign(fail(429, 'The plugin key record limit has been reached. Ask the operator to review key retention before retrying.'), { retryAfter: 60 }) : fail(409, 'The game plugin key limit has been reached.');
        const key = `gpk_${randomBytes(32).toString('base64url')}`, record = { id: randomUUID(), player, label, ...(accountId ? { accountId } : {}),
          createdAt: new Date(clock()).toISOString(), lastUsedAt: null, lastWorld: null, revoked: false, tokenHash: hash(key) };
        next.keys.push(record); return { key, record: publicRecord(record) };
      });
    },
    revoke(id, player) { return mutate(next => {
      const record = next.keys.find(record => record.id === id && (player === undefined || player === record.player));
      if (!record) throw fail(404, 'Game plugin key not found.'); record.revoked = true; return publicRecord(record);
    }); },
    revokeDeletion() { return mutate(next => { for (const record of next.keys) record.revoked = true; }); },
    touch(id, world) {
      const record = current.keys.find(record => record.id === id && !record.revoked);
      if (!record) throw fail(401, 'A game plugin key is required.');
      record.lastUsedAt = new Date(clock()).toISOString(); if (world !== undefined) record.lastWorld = structuredClone(world); dirty = true;
    },
    async flush() { await mutate(() => {}); },
    async close() { await queue; await withStoreWrite(dataDir, async () => { if (dirty) await write(file, current); closed = true; }); },
  };
}
