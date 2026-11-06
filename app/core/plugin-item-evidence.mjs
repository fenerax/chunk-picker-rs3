const ITEM_LIMIT = 500, HANDLED_LIMIT = 2000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(value);

export function validateItemRecord(record) {
  // bank is optional: records written before the plugin read the bank have none.
  if (!exactKeys(record, ['baselineAt', 'items', 'handled', 'journal']) && !exactKeys(record, ['baselineAt', 'items', 'handled', 'journal', 'bank']) || !time(record.baselineAt) || !object(record.items)
    || Object.keys(record.items).length > ITEM_LIMIT || !Array.isArray(record.handled) || record.handled.length > HANDLED_LIMIT
    || record.handled.some((id, index, ids) => !text(id, 200) || index > 0 && ids[index - 1] >= id)) throw new TypeError('Invalid plugin item record.');
  for (const [id, fact] of Object.entries(record.items)) {
    if (!/^(0|[1-9]\d{0,6})$/.test(id) || !exactKeys(fact, ['name', 'ownedAt', 'wornAt', 'first']) || !text(fact.name, 80) || !time(fact.ownedAt)
      || fact.wornAt !== null && !time(fact.wornAt) || typeof fact.first !== 'boolean') throw new TypeError('Invalid plugin item fact.');
  }
  if (record.journal !== null && (!exactKeys(record.journal, ['id', 'event']) || !/^[a-f0-9]{16}$/.test(record.journal.id)
    || !Number.isSafeInteger(record.journal.event) || record.journal.event < 0)) throw new TypeError('Invalid plugin item journal.');
  if (record.bank !== undefined && (!exactKeys(record.bank, ['snapshot', 'seenAt', 'coins']) || !/^[a-f0-9]{16}$/.test(record.bank.snapshot) || !time(record.bank.seenAt)
    || !Number.isSafeInteger(record.bank.coins) || record.bank.coins < 0)) throw new TypeError('Invalid plugin item bank.');
  return record;
}

export function validateJournalCommits(record) {
  if (!exactKeys(record, ['journals']) || !Array.isArray(record.journals) || record.journals.length > 8) throw new TypeError('Invalid journal commit ledger.');
  const ids = new Set(); let count = 0;
  for (const journal of record.journals) {
    if (!exactKeys(journal, ['id', 'committed', 'pending']) || !/^[a-f0-9]{16}$/.test(journal.id) || ids.has(journal.id)
      || !Number.isSafeInteger(journal.committed) || journal.committed < 0 || !Array.isArray(journal.pending)) throw new TypeError('Invalid journal commit ledger.');
    ids.add(journal.id); count += journal.pending.length;
    let after = journal.committed;
    for (const event of journal.pending) {
      if (!Array.isArray(event) || event.length !== 4 || !Number.isSafeInteger(event[0]) || event[0] <= after
        || !Number.isSafeInteger(event[1]) || event[1] < 0 || event[1] > 1000000 || !text(event[2], 80)
        || !['live', 'beta', 'unknown'].includes(event[3])) throw new TypeError('Invalid pending journal event.');
      after = event[0];
    }
  }
  if (count > 256) throw new TypeError('Too many pending journal events.');
  return record;
}

export function mergeJournalCommits(...inputs) {
  const journals = new Map();
  for (const input of inputs.filter(Boolean)) for (const entry of validateJournalCommits(input).journals) {
    const prior = journals.get(entry.id) ?? { id: entry.id, committed: 0, pending: [] };
    const committed = Math.max(prior.committed, entry.committed), events = new Map();
    for (const event of [...prior.pending, ...entry.pending]) if (event[0] > committed) {
      if (events.has(event[0]) && JSON.stringify(events.get(event[0])) !== JSON.stringify(event)) throw new TypeError('Journal event identity changed.');
      events.set(event[0], event);
    }
    journals.set(entry.id, { id: entry.id, committed, pending: [...events.values()].sort((a, b) => a[0] - b[0]) });
  }
  // Only completed journal identities may age out; unresolved evidence is never evicted.
  while (journals.size > 8) {
    const old = [...journals].find(([, entry]) => !entry.pending.length);
    if (!old) throw new TypeError('Too many unfinished journals.');
    journals.delete(old[0]);
  }
  return validateJournalCommits({ journals: [...journals.values()] });
}

export function mergeItemRecords(...inputs) {
  let result = null;
  for (const input of inputs.filter(Boolean)) {
    validateItemRecord(input);
    if (!result) { result = structuredClone(input); continue; }
    for (const [id, fact] of Object.entries(input.items)) {
      const prior = result.items[id];
      result.items[id] = prior ? { ...prior, ownedAt: prior.ownedAt < fact.ownedAt ? prior.ownedAt : fact.ownedAt,
        wornAt: prior.wornAt ?? fact.wornAt } : structuredClone(fact);
    }
    result.handled = [...new Set([...result.handled, ...input.handled])].sort();
    if (input.bank && (!result.bank || input.bank.seenAt > result.bank.seenAt)) result.bank = structuredClone(input.bank);
    if (!result.journal || input.journal?.id === result.journal.id && input.journal.event > result.journal.event) result.journal = structuredClone(input.journal);
  }
  return result && validateItemRecord(result);
}

export function mergePluginItemEvidence(...inputs) {
  const players = new Map();
  for (const input of inputs.filter(input => input !== undefined)) {
    if (!exactKeys(input, ['v', 'players']) || input.v !== 1 || !object(input.players) || Object.keys(input.players).length > 256) throw new TypeError('Invalid portable plugin item evidence.');
    for (const [id, record] of Object.entries(input.players)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)
        || !exactKeys(record, ['records', 'commits']) || !object(record.records)
        || Object.keys(record.records).some(world => !['live', 'beta', 'unknown'].includes(world))) throw new TypeError('Invalid portable plugin item player.');
      const prior = players.get(id) ?? { records: {}, commits: { journals: [] } };
      for (const [world, facts] of Object.entries(record.records)) prior.records[world] = mergeItemRecords(prior.records[world], validateItemRecord(facts));
      validateJournalCommits(record.commits);
      prior.commits = mergeJournalCommits(prior.commits, record.commits);
      players.set(id, prior);
    }
  }
  if (players.size > 256) throw new TypeError('Too many plugin item players.');
  return { v: 1, players: Object.fromEntries(players) };
}

export function reconcilePluginItemEvidence(state, ...sources) {
  const inputs = [state, ...sources].map(source => source.provenance?.pluginItemEvidence).filter(Boolean);
  if (!inputs.length) return state;
  const evidence = mergePluginItemEvidence(...inputs);
  evidence.players = Object.fromEntries(Object.entries(evidence.players).filter(([id]) => state.members.some(member => member.id === id)));
  return { ...state, provenance: { ...state.provenance, pluginItemEvidence: evidence } };
}
