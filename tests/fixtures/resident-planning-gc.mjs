import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { registerHooks } from 'node:module';
import { setImmediate as turn } from 'node:timers/promises';
import { createGroupState } from '../../app/core/state.mjs';
import { genericWorkerData } from '../helpers/worker-dataset.mjs';

assert.equal(typeof globalThis.gc, 'function');
const port = new EventEmitter(), pending = new Map();
port.postMessage = message => {
  if (message.type === 'ready') port.emit('ready');
  else if (message.id !== undefined && message.type !== 'progress') {
    const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
  }
};
// Run the real worker module behind a synthetic port so GC can be requested
// between completed handlers. No production protocol or instrumentation added.
const probe = globalThis.__planningGC = { parentPort: port, workerData: genericWorkerData({
  definitions: { challenges: { Extra: { Alpha: { Chunks: ['12850'] } } }, chunks: { '12850': {} },
    drops: {}, equipment: {}, codeItems: {}, clues: {}, walkableChunks: ['12850'], walkableChunksF2P: ['12850'] },
  skillGuideCatalogue: { skills: [], tasks: [] },
}) };
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/tasks/worker.mjs')) return result;
  const source = 'const { parentPort, workerData } = globalThis.__planningGC;\n' + String(result.source)
    .replace("import { parentPort, workerData } from 'node:worker_threads';", '')
    .replace('const stateSnapshots = new Map();', `const stateSnapshots = new Map();
      globalThis.__planningGC.read = () => ({ transfers: stateSnapshots.size,
        indexes: [...snapshots.values()].filter(value => value.planningIndex).length });`)
    .replace('const isCurrent = () => !abandoned()', 'globalThis.__planningGC.state = new WeakRef(state);\n  const isCurrent = () => !abandoned()');
  return { ...result, source };
} });
const ready = once(port, 'ready');
await import('../../app/tasks/worker.mjs'); await ready;
let sequence = 0;
async function send(message) {
  const id = ++sequence;
  const reply = new Promise(resolve => pending.set(id, resolve));
  port.emit('message', { id, memberId: 'one', ...message });
  const result = await reply;
  assert.equal(result.error, undefined);
  await turn(); // Let the handler's finally block and promise context finish.
  return result;
}
const transfer = process.argv[2] === 'transfer';
async function materialize() {
  let state = createGroupState(['one', 'two'].map(id => ({ id, name: 'Explorer', unlocked: ['12850'] })));
  const snapshotKey = transfer ? JSON.stringify([state.revision, 'input']) : undefined;
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length);
  Buffer.from(stateJSON).set(bytes);
  await send({ type: 'evaluate', ...(transfer ? { stateTransport: 'json-shared-v1', stateJSON,
    stateJSONBytes: bytes.length, stateRevision: state.revision, stateMemberIds: state.members.map(({ id }) => id) } : { state }),
    snapshotKey, input: 'input', resultTransport: 'json-shared-v1', resultView: 'play-v1' });
  const planned = await send({ type: 'chunk-planning', ...(transfer ? {} : { state }), snapshotKey,
    input: 'input', chunkId: '12850', residentOnly: true });
  assert.equal(planned.result.format, 'chunk-planning-v1');
  await send({ type: 'evaluate', ...(transfer ? {} : { state }), snapshotKey, input: 'input' });
  state = undefined;
}
await materialize();
async function collect() {
  for (let i = 0; i < 12; i++) {
    await turn(); globalThis.gc(); await turn();
    if (probe.state.deref() === undefined) return true;
  }
  return false;
}
if (transfer) {
  assert.equal(await collect(), false, 'transfer cache still deliberately owns the state');
  for (const input of ['evict-one', 'evict-two']) {
    await send({ type: 'prepare-rules', state: createGroupState(['one', 'two'].map(id => ({ id, name: 'Explorer' }))),
      snapshotKey: JSON.stringify([0, input]), input });
  }
  assert.equal(probe.read().transfers, 2);
}
assert.equal(await collect(), true, 'no retained index or ledger callback may keep the request state');
assert.equal(probe.read().indexes, 1, 'the completed index remains resident throughout GC');
console.log('request state collected; planning index retained');
