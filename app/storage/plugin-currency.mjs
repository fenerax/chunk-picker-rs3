import { applyValidatedCommand } from '../core/state.mjs';

const LIMIT = 1000, HISTORY_INTERVAL = 60000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const id = value => /^[a-f0-9-]{36}$/.test(value);
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Private envelope metadata, never portable gameplay or Undo. Missing metadata is
// the legacy format; damaged metadata must fail closed rather than admit replays.
export function loadPluginCurrency(value) {
  if (value === undefined) return { format: 1, keys: {}, players: {} };
  if (!exact(value, ['format', 'keys', 'players']) || value.format !== 1 || !object(value.keys) || !object(value.players)
    || Object.keys(value.keys).length > LIMIT || Object.keys(value.players).length > LIMIT) throw new TypeError('Invalid plugin currency metadata.');
  for (const [key, seq] of Object.entries(value.keys)) if (!id(key) || !integer(seq)) throw new TypeError('Invalid plugin currency sequence.');
  for (const [player, row] of Object.entries(value.players)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(player) || ['__proto__', 'constructor', 'prototype'].includes(player)
      || !exact(row, ['keyId', 'seq', 'sentAt', 'coins', 'historyAt', 'historyRevision']) || !id(row.keyId) || !integer(row.seq)
      || value.keys[row.keyId] < row.seq || !Object.hasOwn(value.keys, row.keyId) || !time(row.sentAt)
      || row.coins !== null && (!integer(row.coins) || row.coins > 1e12)
      || row.historyAt !== null && !time(row.historyAt) || row.historyRevision !== null && !integer(row.historyRevision)) throw new TypeError('Invalid plugin currency observation.');
  }
  return value;
}

// Manual travel edits release plugin ownership even if they explicitly confirm
// the same amount. Keep the replay fence when their History later gets archived.
export function currencyAfterCommand(metadata, command) {
  const row = command.type === 'set-transport-facts' && metadata?.players[command.memberId];
  return row ? { ...metadata, players: { ...metadata.players,
    [command.memberId]: { ...row, coins: null, historyAt: null, historyRevision: null } } } : metadata;
}

/** One transaction computes both the current fact and its durable freshness fence. */
export function observePluginCurrency(state, metadata, { memberId, keyId, seq, sentAt, coins }, options = {}) {
  const ledger = loadPluginCurrency(metadata), prior = ledger.players[memberId];
  if (!id(keyId) || !integer(seq) || !time(sentAt) || coins !== null && (!integer(coins) || coins > 1e12)) throw new TypeError('Invalid plugin currency report.');
  if (seq <= (ledger.keys[keyId] ?? -1) || prior && (Date.parse(sentAt) < Date.parse(prior.sentAt)
    || Date.parse(sentAt) === Date.parse(prior.sentAt) && keyId !== prior.keyId)) {
    throw Object.assign(new Error('The currency report must be newer than the saved observation.'), { status: 409 });
  }
  const owner = state.members.find(row => row.id === memberId);
  if (!owner) throw new TypeError('Unknown plugin currency member.');
  const current = owner.transportFacts?.currencies?.coins;
  // Legacy plugin writes had no actor. A manual fact with a different current
  // value is not owned by this observation and must survive an unreadable report.
  const legacy = !prior && state.history.findLast(row => row.command?.type === 'set-transport-facts' && row.command.memberId === memberId);
  const owned = prior ? prior.coins !== null && prior.coins === current
    : legacy && !legacy.actor && legacy.command.facts.currencies?.coins === current;
  const facts = structuredClone(owner.transportFacts ?? {});
  if (coins !== null) facts.currencies = { ...facts.currencies, coins };
  else if (owned) {
    delete facts.currencies.coins;
    if (!Object.keys(facts.currencies).length) delete facts.currencies;
  }
  let next = state, historyAt = prior?.historyAt ?? null, historyRevision = prior?.historyRevision ?? null;
  if (JSON.stringify(facts) !== JSON.stringify(owner.transportFacts ?? {})) {
    let base = state;
    const last = state.history.at(-1), at = (options.now ?? (() => new Date().toISOString()))();
    // Only coalesce the immediately preceding, still reversible plugin currency
    // entry. Rebuild its inverse through the normal command engine so old releases
    // can undo the whole group, with no new History command or patch format.
    if (last?.revision === historyRevision && last.type === 'set-transport-facts' && !last.undoneRevision
      && last.command.memberId === memberId && Date.parse(at) - Date.parse(historyAt) < HISTORY_INTERVAL) {
      const undone = applyValidatedCommand(state, { type: 'undo', undoRevision: historyRevision }, options);
      base = { ...undone, revision: state.revision, history: state.history.slice(0, -1) };
    } else historyAt = at;
    next = applyValidatedCommand(base, { type: 'set-transport-facts', memberId, facts }, options);
    historyRevision = next.revision;
  }
  const players = { ...ledger.players, [memberId]: { keyId, seq, sentAt, coins: next !== state || owned ? coins : null, historyAt, historyRevision } };
  const nextMetadata = loadPluginCurrency({ format: 1, keys: { ...ledger.keys, [keyId]: seq }, players });
  return { state: next, metadata: nextMetadata };
}
