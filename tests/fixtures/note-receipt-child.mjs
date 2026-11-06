import { randomUUID } from 'node:crypto';
import { openStore } from '../../app/storage/store.mjs';

const dataDir = process.argv[2];
if (!dataDir || !process.send) throw Error('Use the isolated receipt-recovery test harness.');
const store = await openStore({ dataDir, beforeCommit: async ({ state }) => {
  if (state.revision !== 2) return;
  setInterval(() => {}, 1000);
  process.send({ phase: 'synced-before-rename' });
  await new Promise(() => {});
} });
const session = await store.openActionSession(randomUUID());
const requestId = n => `v3.${session.scope}.${session.slot}.${session.generation}.${n}`;
await store.command({ type: 'set-rule', ruleId: 'access.shared', value: true }, 0,
  { requestId: requestId(1), requestAck: 0 });
process.send({ phase: 'acknowledged', first: requestId(1), second: requestId(2) });
await store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 1,
  { requestId: requestId(2), requestAck: 1 });
