import { storageBudget } from './storage-budget.mjs';

export const DEFAULT_LOGIN_STORAGE_BUDGET = Object.freeze({ maxMaps: 20 });
export function loginStorageBudget(options = {}, env = process.env) {
  if (!options || Object.keys(options).some(key => key !== 'maxMaps')) throw new TypeError('Invalid login storage budget.');
  const maxMaps = options.maxMaps ?? (env.RS3_LOGIN_MAX_MAPS === undefined ? DEFAULT_LOGIN_STORAGE_BUDGET.maxMaps : Number(env.RS3_LOGIN_MAX_MAPS));
  if (!Number.isSafeInteger(maxMaps) || maxMaps < 1) throw new TypeError('Invalid RS3_LOGIN_MAX_MAPS. Use a positive safe integer.');
  return Object.freeze({ maxMaps });
}
const refusal = () => Object.assign(new Error('This login has reached its retained map storage limit. Delete an unwanted character or group, or contact the server operator before adding more. Existing maps, Past maps and downloads are unchanged.'), { status: 507, code: 'LOGIN_STORAGE_BUDGET_EXCEEDED' });

// Registry records only: no store acquisition, directory walks or usage reads.
// Shared pickers count once per controlling login; retired owned solos still
// occupy storage. Pending intents reserve the same IDs recovery will publish.
function holdings(doc) {
  const result = new Map();
  const add = (account, key) => { if (!account) return; if (!result.has(account)) result.set(account, new Set()); result.get(account).add(key); };
  const pickers = new Map(doc.pickers.filter(p => p.kind === 'default' && p.lifecycle !== 'deleted').map(p => [p.id, p]));
  for (const p of pickers.values()) add(p.ownerAccountId, p.id);
  for (const a of doc.accounts) {
    for (const m of a.memberships) if (m.role !== 'viewer' && pickers.has(m.pickerId)) add(a.id, m.pickerId);
    if (a.pendingCreation) add(a.id, a.pendingCreation.pickerId);
  }
  for (const c of doc.characters ?? []) if (c.lifecycle === 'active' && pickers.has(c.placement?.pickerId)) add(c.accountId, c.placement.pickerId);
  for (const d of doc.departures ?? []) if (!d.completedAt) { add(d.accountId, d.destination.pickerId); add(d.accountId, 'past:' + d.id); }
  for (const i of doc.groupInvites ?? []) if (i.transaction) {
    add(i.acceptingAccountId, i.pickerId);
    if (i.transaction.pastMapId) add(i.acceptingAccountId, 'past:' + i.transaction.pastMapId);
  }
  for (const m of doc.pastMaps ?? []) add(m.accountId, 'past:' + m.id);
  return result;
}

// Called only by map admissions inside the registry's existing transaction
// queue. Reads, ordinary saves, imports into existing maps and deletion never
// enter this helper. Published/pending IDs deduplicate so recovery can finish
// even when the operator lowered the cap after admitting a transaction.
export function createLoginStorageBudget({ read, limits = loginStorageBudget() }) {
  limits = loginStorageBudget(limits, {});
  return {
    admit(next) {
      const before = holdings(read()), after = holdings(next);
      for (const [account, maps] of after) if ([...maps].some(key => !before.get(account)?.has(key)) && maps.size > limits.maxMaps) throw refusal();
    },
  };
}

// Each newly admitted frozen snapshot has at most one group budget of bytes.
// Existing snapshots and already-admitted recovery are never truncated.
export function assertPastMapFits(document, maxBytes = storageBudget().maxBytes) {
  if (Buffer.byteLength(JSON.stringify(document)) + 1 > maxBytes) throw Object.assign(new Error('This Past map would exceed the retained save storage limit. Contact the server operator. Existing maps are unchanged.'), { status: 507, code: 'STORAGE_BUDGET_EXCEEDED' });
}
