import { createHash, randomUUID } from 'node:crypto';

// One retained, unacknowledged outcome per active tab. Generations fence retired tabs;
// no wall-clock expiry can make an old action executable again.
export const ACTION_RECEIPT_FORMAT = 2;
export const ACTION_CLIENT_SLOTS = 32;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const actionPrincipal = actor => digest(actor ? { kind: actor.kind, inviteId: actor.inviteId, memberId: actor.memberId } : null);
export const actionFingerprint = (command, actor) => digest({ principal: actor ? { kind: actor.kind, inviteId: actor.inviteId, memberId: actor.memberId } : null, command });
const publicSession = (slot, row) => ({ slot, generation: row.generation, sequence: row.sequence, acknowledged: row.acknowledged,
  ...(row.scope ? { scope: row.scope } : {}) });
const idFor = (slot, row) => row.scope ? `v3.${row.scope}.${slot}.${row.generation}.${row.sequence}` : `v2.${slot}.${row.generation}.${row.sequence}`;

export function loadActionReceipts(value, revision) {
  if (value === undefined) return undefined;
  if (!object(value)) throw new TypeError('Invalid action receipt ledger.');
  if (value.format !== ACTION_RECEIPT_FORMAT) {
    // Prototype format: immutable replay-only bridge records. Never grow or
    // silently expire them. Conversion is deferred until the first new write.
    const entries = Object.entries(value);
    if (entries.length > 8192 || entries.some(([id, row]) => !/^[a-zA-Z0-9_-]{16,80}$/.test(id)
      || !object(row) || Object.keys(row).some(key => !['fingerprint', 'revision'].includes(key))
      || !hash.test(row.fingerprint) || !integer(row.revision, 1) || row.revision > revision)) throw new TypeError('Invalid legacy action receipts.');
    return { format: ACTION_RECEIPT_FORMAT, slots: [], legacy: value };
  }
  if (Object.keys(value).some(key => !['format', 'slots', 'legacy'].includes(key)) || !Array.isArray(value.slots)
    || value.slots.length > ACTION_CLIENT_SLOTS) throw new TypeError('Invalid action receipt slots.');
  const clients = new Set();
  for (const [slot, row] of value.slots.entries()) {
    if (!object(row) || Object.keys(row).some(key => !['generation', 'clientId', 'principal', 'sequence', 'acknowledged', 'receipt', 'scope', 'lastUsed', 'retired'].includes(key))
      || !integer(row.generation, 1) || !uuid.test(row.clientId) || clients.has(row.clientId) || !hash.test(row.principal)
      || !integer(row.sequence) || !integer(row.acknowledged) || row.acknowledged > row.sequence || row.sequence - row.acknowledged > 1) throw new TypeError('Invalid action receipt watermark.');
    clients.add(row.clientId);
    if ((row.scope !== undefined && !uuid.test(row.scope)) || (row.lastUsed !== undefined && !integer(row.lastUsed))) throw new TypeError('Invalid action session identity.');
    if (row.retired !== undefined && (!object(row.retired)
      || Object.keys(row.retired).some(key => !['generation', 'sequence', 'scope', 'principal'].includes(key))
      || !integer(row.retired.generation, 1) || row.retired.generation >= row.generation || !integer(row.retired.sequence)
      || !hash.test(row.retired.principal) || (row.retired.scope !== undefined && !uuid.test(row.retired.scope)))) throw new TypeError('Invalid retired action session.');
    if (row.acknowledged === row.sequence && row.receipt !== undefined) throw new TypeError('Acknowledged action retains a receipt.');
    if (row.acknowledged !== row.sequence) {
      const receipt = row.receipt;
      if (!object(receipt) || Object.keys(receipt).some(key => !['requestId', 'fingerprint', 'revision', 'outcome'].includes(key))
        || receipt.requestId !== idFor(slot, row) || !hash.test(receipt.fingerprint)
        || !integer(receipt.revision, 1) || receipt.revision > revision || !object(receipt.outcome)
        || receipt.outcome.revision !== receipt.revision || typeof receipt.outcome.type !== 'string'
        || Buffer.byteLength(JSON.stringify(receipt.outcome)) > 1024) throw new TypeError('Invalid retained action outcome.');
    }
  }
  if (value.legacy !== undefined) {
    if (value.legacy?.format !== undefined) throw new TypeError('Invalid legacy action receipts.');
    loadActionReceipts(value.legacy, revision);
  }
  return value;
}
const ledgerOf = value => value ?? { format: ACTION_RECEIPT_FORMAT, slots: [] };
export function openActionSession(value, clientId, actor, now = Date.now()) {
  if (typeof clientId !== 'string' || !uuid.test(clientId)) throw new TypeError('A valid client session ID is required.');
  const ledger = ledgerOf(value), principal = actionPrincipal(actor);
  let slot = ledger.slots.findIndex(row => row.clientId === clientId);
  if (slot !== -1) {
    const row = ledger.slots[slot];
    if (row.principal !== principal) throw fail('ACTION_SESSION_MISMATCH', 'Restore the original account to confirm this pending save.');
    const slots = [...ledger.slots]; slots[slot] = { ...row, lastUsed: now };
    return { ledger: { ...ledger, slots }, session: publicSession(slot, row) };
  }
  const oldest = confirmedOnly => ledger.slots.reduce((selected, row, index) => row.generation < Number.MAX_SAFE_INTEGER
    && (!confirmedOnly || row.sequence === row.acknowledged)
    && (selected < 0 || (row.lastUsed ?? 0) < (ledger.slots[selected].lastUsed ?? 0)) ? index : selected, -1);
  slot = ledger.slots.length < ACTION_CLIENT_SLOTS ? ledger.slots.length : oldest(true);
  // Closed/killed tabs may never ACK. Retire their LRU slot only after exhausting
  // confirmed slots; fencing refuses their committed sequence without retry proof.
  if (slot < 0) slot = oldest(false);
  if (slot < 0) throw fail('ACTION_SESSION_FULL', 'Saving sessions have reached their limit. Check History and ask for help before saving again.', 507);
  const previous = ledger.slots[slot];
  const row = { generation: previous ? previous.generation + 1 : 1, clientId, principal, sequence: 0, acknowledged: 0,
    scope: randomUUID(), lastUsed: now,
    ...(previous ? { retired: { generation: previous.generation, sequence: previous.sequence, principal: previous.principal,
      ...(previous.scope ? { scope: previous.scope } : {}) } } : {}) };
  const slots = [...ledger.slots]; slots[slot] = row;
  return { ledger: { ...ledger, slots }, session: publicSession(slot, row) };
}
export function acknowledgeActionSession(value, clientId, input, actor) {
  if (!object(input) || !integer(input.slot) || !integer(input.generation, 1) || !integer(input.sequence)) throw new TypeError('Invalid save acknowledgement.');
  const ledger = ledgerOf(value), row = ledger.slots[input.slot];
  if (!row || row.clientId !== clientId || row.generation !== input.generation || row.scope !== input.scope) throw fail('ACTION_SESSION_RETIRED', 'This saving session has ended. Check History before making another change.');
  if (row.principal !== actionPrincipal(actor)) throw fail('ACTION_SESSION_MISMATCH', 'Restore the original account to confirm this pending save.');
  if (input.sequence > row.sequence) throw fail('REQUEST_SEQUENCE', 'This save acknowledgement is ahead of the server.');
  if (input.sequence <= row.acknowledged) return { ledger: value, session: publicSession(input.slot, row) };
  const next = { ...row, acknowledged: input.sequence, lastUsed: Date.now() }; delete next.receipt;
  const slots = [...ledger.slots]; slots[input.slot] = next;
  return { ledger: { ...ledger, slots }, session: publicSession(input.slot, next) };
}
export function inspectActionReceipt(value, command, actor, requestId, acknowledged = 0) {
  if (requestId === undefined) return undefined;
  if (typeof requestId !== 'string') throw new TypeError('Invalid requestId.');
  const ledger = ledgerOf(value), fingerprint = actionFingerprint(command, actor);
  const scoped = /^v3\.([0-9a-f-]{36})\.(0|[1-9]\d*)\.([1-9]\d*)\.([1-9]\d*)$/i.exec(requestId);
  const match = scoped ? scoped.slice(1) : /^v2\.(0|[1-9]\d*)\.([1-9]\d*)\.([1-9]\d*)$/.exec(requestId)?.slice(1);
  if (!match) {
    const legacy = ledger.legacy?.[requestId];
    if (!legacy) throw fail('ACTION_SESSION_REQUIRED', 'Open a saving session before sending this change.');
    if (legacy.fingerprint !== fingerprint) throw fail('REQUEST_ID_MISMATCH', 'This request ID belongs to a different action or actor.');
    return { replay: true, result: { requestId, revision: legacy.revision, outcome: { type: 'legacy', revision: legacy.revision } } };
  }
  const scope = scoped ? match[0] : undefined;
  const [slot, generation, sequence] = (scoped ? match.slice(1) : match).map(Number), row = ledger.slots[slot];
  if (!integer(slot) || !integer(generation, 1) || !integer(sequence, 1) || !row || row.generation !== generation || row.scope !== scope) {
    const retired = row?.retired;
    const safeToRetry = !!scope && !!retired && retired.scope === scope && retired.generation === generation
      && retired.sequence === acknowledged && sequence === acknowledged + 1 && retired.principal === actionPrincipal(actor);
    throw Object.assign(fail('ACTION_SESSION_RETIRED', 'This saving session has ended. Check History before making another change.'), { safeToRetry });
  }
  if (row.principal !== actionPrincipal(actor)) throw fail('ACTION_SESSION_MISMATCH', 'Restore the original account to confirm this pending save.');
  if (sequence <= row.acknowledged) throw fail('REQUEST_ACKNOWLEDGED', 'This save was already confirmed. Check History before making another change.');
  if (sequence === row.sequence) {
    if (row.receipt.fingerprint !== fingerprint) throw fail('REQUEST_ID_MISMATCH', 'This request ID belongs to a different action or actor.');
    const { fingerprint: ignored, ...result } = row.receipt;
    return { replay: true, result };
  }
  if (sequence !== row.sequence + 1 || !integer(acknowledged) || acknowledged !== row.sequence) throw fail('REQUEST_SEQUENCE', 'Confirm the pending save before sending another change.');
  return { requestId, fingerprint, slot, generation, sequence, acknowledged };
}
export function commitActionReceipt(value, receipt, state) {
  if (!receipt) return { ledger: value };
  const ledger = ledgerOf(value), row = ledger.slots[receipt.slot];
  const event = state.history.findLast(item => item.revision === state.revision);
  const outcome = { type: event?.type ?? 'command', revision: state.revision,
    ...Object.fromEntries(['rolled', 'unpicked', 'chunkId', 'starts', 'bankVersion']
      .filter(key => Object.hasOwn(event?.command ?? {}, key)).map(key => [key, event.command[key]])) };
  if (Buffer.byteLength(JSON.stringify(outcome)) > 1024) throw new RangeError('Action outcome exceeds the receipt format limit.');
  const retained = { requestId: receipt.requestId, fingerprint: receipt.fingerprint, revision: state.revision, outcome };
  const slots = [...ledger.slots]; slots[receipt.slot] = { ...row, sequence: receipt.sequence, acknowledged: receipt.acknowledged, receipt: retained, lastUsed: Date.now() };
  const { fingerprint: ignored, ...result } = retained;
  return { ledger: { ...ledger, slots }, result };
}
