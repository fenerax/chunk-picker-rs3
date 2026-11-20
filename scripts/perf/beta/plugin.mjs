import { digest } from '../capacity/model.mjs';

export function journalFor(client, seed) {
  return { id: digest(`${seed}:${client.group}:${client.memberId}`).slice(0, 16), event: 0, acknowledged: 0,
    pickerId: client.pickerId, memberId: client.memberId, pending: [], initialized: false, reports: 0, serial: 0 };
}
export function reportPacket(journal, client, seed, sendItems, now = new Date().toISOString()) {
  if (sendItems && journal.initialized && journal.pending.length < 32)
    journal.pending.push([++journal.event, 900000 + journal.event % 1024, 'Synthetic journal item', 'live']);
  return { v: 1, seq: ++journal.serial, sentAt: now, world: { id: 1, beta: false }, position: { x: 20, z: 20, floor: 0 },
    ...(sendItems ? { items: { snapshot: digest(`${seed}:${client.characterId}`).slice(0, 16), worn: [], backpack: [],
      journal: { id: journal.id, events: structuredClone(journal.pending) } } } : { skills: { MINING: { level: 20, xp: 4470 } } }) };
}
export function observeAck(journal, result) {
  const ack = result.items?.journal;
  if (ack?.id !== journal.id) return false;
  if (!Number.isSafeInteger(ack.event) || ack.event < journal.acknowledged || ack.event > journal.event) throw new Error('Plugin journal acknowledgement regressed or exceeds sent evidence.');
  journal.initialized = true; journal.acknowledged = ack.event;
  journal.pending = journal.pending.filter(event => event[0] > ack.event);
  return true;
}
