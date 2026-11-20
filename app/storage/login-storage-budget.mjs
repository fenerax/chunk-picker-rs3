import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, opendir } from 'node:fs/promises';
import { SNAPSHOT_EXCLUSIONS } from './store-identity-policy.mjs';

export const DEFAULT_LOGIN_STORAGE_BUDGET = Object.freeze({ maxBytes: 10 * 1024 ** 3, maxMaps: 20 });
const variables = { maxBytes: 'RS3_LOGIN_MAX_BYTES', maxMaps: 'RS3_LOGIN_MAX_MAPS' };
export function loginStorageBudget(options = {}, env = process.env) {
  if (!options || Object.keys(options).some(k => !Object.hasOwn(variables, k))) throw new TypeError('Invalid login storage budget.');
  const result = {};
  for (const [key, variable] of Object.entries(variables)) {
    const value = options[key] ?? (env[variable] === undefined ? DEFAULT_LOGIN_STORAGE_BUDGET[key] : Number(env[variable]));
    if (!Number.isSafeInteger(value) || value < 1 || key === 'maxMaps' && value > 128) throw new TypeError(`Invalid ${variable}. Use a positive safe integer${key === 'maxMaps' ? ' at most 128' : ''}.`);
    result[key] = value;
  }
  return Object.freeze(result);
}
const refusal = () => Object.assign(new Error('This login has reached its retained map or save storage limit. Delete an unwanted character or group, or contact the server operator before adding more. Existing maps, Past maps and downloads are unchanged.'), { status: 507, code: 'LOGIN_STORAGE_BUDGET_EXCEEDED' });
const scopes = new Set(), relief = new AsyncLocalStorage(), admitted = new AsyncLocalStorage();
async function during(context, work, details = {}) {
  const owner = { ...details, active: true };
  return context.run(owner, async () => { try { return await work(); } finally { owner.active = false; } });
}
// Async callbacks/timers may inherit this context, but cannot retain a bypass
// after the deletion, recovery or publication which admitted them has finished.
export const withLoginStorageRelief = work => relief.getStore()?.active ? work() : during(relief, work);
const inside = (root, file) => file.startsWith(root + path.sep);
async function info(file) {
  try { const value = await lstat(file); if (!value.isFile() && !value.isDirectory()) throw refusal(); return value; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// Bounded metadata only. Even malformed stores with unlimited directories stop
// after 4096 entries; opendir avoids materializing an unbounded readdir result.
async function pickerBytes(directory, ignore) {
  let bytes = 0, remaining = 4096;
  const pending = [directory, directory + '.dataset.json'];
  while (pending.length) {
    const file = pending.pop();
    if (ignore.has(file)) continue;
    if (--remaining < 0) throw refusal();
    const entry = await info(file);
    if (entry?.isDirectory()) {
      for await (const row of await opendir(file)) {
        if (file === directory && SNAPSHOT_EXCLUSIONS.includes(row.name)) continue;
        if (pending.length >= remaining) throw refusal();
        pending.push(path.join(file, row.name));
      }
    } else bytes += entry?.size ?? 0;
  }
  return bytes;
}

// A shared picker is charged in full once to each controlling login. Retired
// onboarding/rejoin directories remain owned storage until explicitly purged.
function holdings(doc) {
  const result = new Map();
  const add = (account, key) => { if (!account) return; if (!result.has(account)) result.set(account, new Set()); result.get(account).add(key); };
  const reserveRoster = (pickerId, id) => {
    for (const [account, maps] of result) if (maps.has(pickerId)) add(account, 'growth:' + id);
  };
  const pickers = new Map(doc.pickers.filter(p => p.kind === 'default' && p.lifecycle !== 'deleted').map(p => [p.id, p]));
  for (const p of pickers.values()) add(p.ownerAccountId, p.id);
  for (const a of doc.accounts) {
    for (const m of a.memberships) if (m.role !== 'viewer' && pickers.has(m.pickerId)) add(a.id, m.pickerId);
    if (a.pendingCreation) add(a.id, a.pendingCreation.pickerId);
  }
  for (const c of doc.characters ?? []) if (c.lifecycle === 'active' && pickers.has(c.placement?.pickerId)) add(c.accountId, c.placement.pickerId);
  for (const d of doc.departures ?? []) if (!d.completedAt) {
    add(d.accountId, d.destination.pickerId); add(d.accountId, 'past:' + d.id);
    reserveRoster(d.source.pickerId, 'departure:' + d.id);
  }
  for (const i of doc.groupInvites ?? []) if (i.transaction) {
    add(i.acceptingAccountId, i.pickerId);
    reserveRoster(i.pickerId, 'join:' + i.id);
    if (i.transaction.pastMapId) add(i.acceptingAccountId, 'past:' + i.transaction.pastMapId);
  }
  for (const m of doc.pastMaps ?? []) add(m.accountId, 'past:' + m.id);
  return result;
}

export function createLoginStorageBudget({ read, pickerRoot, registryDir, limits = loginStorageBudget(), groupMaxBytes }) {
  limits = loginStorageBudget(limits, {});
  if (!Number.isSafeInteger(groupMaxBytes) || groupMaxBytes < 1) throw new TypeError('A positive group byte budget is required.');
  pickerRoot = path.resolve(pickerRoot); registryDir = path.resolve(registryDir);
  const mutex = new AsyncLocalStorage();
  let queue = Promise.resolve();
  function run(work) {
    if (mutex.getStore()?.active) return work();
    const owner = { active: true };
    const result = queue.then(() => mutex.run(owner, async () => { try { return await work(); } finally { owner.active = false; } }));
    queue = result.catch(() => {}); return result;
  }
  const resourceFile = key => key.startsWith('past:') ? path.join(registryDir, 'past-maps', key.slice(5) + '.json') : path.join(pickerRoot, key);
  async function check(doc, accounts, publications = [], ignore = new Set(), measured) {
    const owned = holdings(doc), sizes = new Map();
    for (const account of accounts) {
      const maps = owned.get(account) ?? new Set();
      if ([...maps].filter(key => !key.startsWith('growth:')).length > limits.maxMaps) throw refusal();
      let total = 0;
      for (const key of maps) {
        if (key.startsWith('growth:')) sizes.set(key, groupMaxBytes);
        else if (!sizes.has(key)) {
          const file = resourceFile(key), past = key.startsWith('past:');
          const snapshot = past && await info(file);
          if (snapshot && !snapshot.isFile()) throw refusal();
          let size = past ? snapshot?.size : measured?.directory === file ? measured.usage.bytes : await pickerBytes(file, ignore);
          for (const row of publications) if (past ? row.file === file : inside(file, row.file) || row.file === file + '.dataset.json') {
            size = (size ?? 0) + row.size - ((await info(row.file))?.size ?? 0);
          }
          // Lazy initialization and admitted lifecycle intents reserve a whole
          // group budget until state/the frozen snapshot has been published.
          const initialized = past ? size !== undefined : await info(path.join(file, 'state.json')) || publications.some(r => r.file === path.join(file, 'state.json'));
          sizes.set(key, initialized ? size : Math.max(size ?? 0, groupMaxBytes));
        }
        total += sizes.get(key);
        if (total > limits.maxBytes) throw refusal();
      }
    }
  }
  const scope = {
    run,
    matches(file) {
      if (inside(pickerRoot, file)) return !SNAPSHOT_EXCLUSIONS.includes(path.relative(pickerRoot, file).split(path.sep)[1]);
      return inside(path.join(registryDir, 'past-maps'), file);
    },
    async publication(rows, work, ignore, measured) {
      return run(async () => {
        if (!relief.getStore()?.active) {
          const doc = read(), accounts = [];
          let growth = 0;
          for (const row of rows) growth += row.size - ((await info(row.file))?.size ?? 0);
          if (growth > 0) for (const [account, maps] of holdings(doc)) if ([...maps].some(key => {
            if (key.startsWith('growth:')) return false;
            const file = resourceFile(key); return rows.some(r => key.startsWith('past:') ? r.file === file : inside(file, r.file) || r.file === file + '.dataset.json');
          })) accounts.push(account);
          await check(doc, accounts, rows, ignore, measured);
        }
        return during(admitted, work, { scope, rows, ignore });
      });
    },
  };
  scopes.add(scope);
  return { run,
    async admit(next) {
      const before = holdings(read()), after = holdings(next);
      const accounts = [...after].filter(([id, maps]) => [...maps].some(key => !before.get(id)?.has(key))).map(([id]) => id);
      await check(next, accounts);
    },
    close() { scopes.delete(scope); },
  };
}

export function withLoginStorageGate(directory, work) {
  const file = path.resolve(directory) + path.sep;
  const scope = [...scopes].find(s => s.matches(file));
  return scope ? scope.run(work) : work();
}
export function loginStorageEntryBudget(directory) {
  return [...scopes].some(s => s.matches(path.resolve(directory) + path.sep)) ? 4096 : Infinity;
}

export function withLoginStoragePublication(publications, work, { ignore = [], maintenance = false, measured } = {}) {
  const rows = [...new Map(publications.map(r => [path.resolve(r.file), { ...r, file: path.resolve(r.file) }])).values()];
  const scope = [...scopes].find(s => rows.some(r => s.matches(r.file)));
  if (!scope) return work(); // Single-picker mode never installs a scope.
  const execute = async () => {
    for (const row of rows) row.size ??= row.temporary ? (await info(row.temporary)).size : Buffer.byteLength(row.bytes);
    const parent = admitted.getStore(), ignored = new Set(ignore.map(f => path.resolve(f)));
    if (parent?.active && parent.scope === scope) {
      for (const file of parent.ignore) ignored.add(file);
      const planned = new Map(parent.rows.map(row => [row.file, row]));
      if (rows.every(row => planned.get(row.file)?.size === row.size)) return during(admitted, work, { scope, rows: parent.rows, ignore: ignored });
      // A nested sidecar which was not in the gameplay plan must fit alongside
      // all still-pending outputs, rather than inheriting an unlimited bypass.
      for (const row of rows) planned.set(row.file, { ...row, size: Math.max(row.size, planned.get(row.file)?.size ?? 0) });
      return scope.publication([...planned.values()], work, ignored);
    }
    return scope.publication(rows, work, ignored, measured);
  };
  return maintenance ? withLoginStorageRelief(execute) : execute();
}
