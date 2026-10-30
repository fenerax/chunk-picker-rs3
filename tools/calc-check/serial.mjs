import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Calculator } from './client.mjs';
import { comparable, digestTree, treeDifferences, hash } from './compare.mjs';

// Record the oracle's wire sequence, close it, then replay the candidate. Only
// temporary request bodies and value-free result hashes are written here.
export async function sequentialPair(reference, candidate, options, onReady, onDifference) {
  const directory = await mkdtemp(path.join(tmpdir(), 'calc-check-wire-'));
  const oracle = new Calculator(reference, options), operations = [];
  const bodies = new Set();
  let bundle, last, closePromise;
  const originalInit = oracle.init.bind(oracle), originalRequest = oracle.request.bind(oracle), originalControl = oracle.control.bind(oracle), originalClose = oracle.close.bind(oracle);
  oracle.replayDurations = {};
  oracle.init = async input => { bundle = input; return originalInit(input); };
  oracle.control = async header => { operations.push({ control: header }); return originalControl(header); };
  oracle.request = (header, state) => {
    const began = performance.now();
    const pending = originalRequest(header, state), index = operations.length;
    const operation = { header, index, id: pending.id };
    operations.push(operation);
    const stored = state === undefined ? Promise.resolve() : (async () => {
      const bytes = JSON.stringify(state), key = hash(bytes);
      operation.body = key;
      if (!bodies.has(key)) { bodies.add(key); await writeFile(path.join(directory, key), bytes); }
    })();
    last = { id: pending.id, promise: pending.promise.then(async reply => {
      (oracle.replayDurations[header.type] ??= []).push(performance.now() - began);
      await stored;
      operation.snapshotMissing = reply.header.error?.kind === 'snapshot-missing';
      operation.cancelled = !!reply.header.cancelled || Object.values(reply.parts).some(p => p?.cancelled);
      reply.digest = digestTree(comparable(reply));
      operation.rootHash = reply.digest.hash;
      await writeFile(path.join(directory, `${index}.hashes`), JSON.stringify(reply.digest));
      return reply;
    }) };
    return last;
  };
  oracle.close = () => closePromise ??= originalClose();
  const peer = {
    isReplayPeer: true, snapshotResends: 0, cancelledReruns: 0, sentRequests: {}, peakRSSBytes: 0, replayDurations: {}, metadata: undefined,
    init: () => oracle.ready,
    request: () => last,
    control: async () => {},
    async close() {
      await oracle.close();
      const calculator = new Calculator(candidate, options);
      try {
        const ready = await calculator.init(bundle);
        onReady(ready);
        const bodiesByInput = new Map(), ids = new Map();
        const control = header => calculator.control(header.type === 'cancel' ? { ...header, id: ids.get(header.id) ?? header.id } : header);
        const cancelled = reply => !!reply.header.cancelled || Object.values(reply.parts).some(p => p?.cancelled);
        for (const operation of operations) {
          if (operation.replayed) continue;
          if (operation.control) { await control(operation.control); continue; }
          const state = operation.body ? JSON.parse(await readFile(path.join(directory, operation.body), 'utf8')) : undefined;
          const key = JSON.stringify([operation.header.pickerId, operation.header.input]);
          if (operation.body) bodiesByInput.set(key, operation.body);
          const began = performance.now();
          let request = calculator.request(operation.header, state);
          ids.set(operation.id, request.id);
          // A cancellation frame immediately follows its request on the wire.
          const next = operations[operation.index + 1];
          if (next?.control?.type === 'cancel') { await control(next.control); next.replayed = true; }
          let reply = await request.promise;
          if (!operation.cancelled && !operation.snapshotMissing && (reply.header.error?.kind === 'snapshot-missing' || cancelled(reply))) {
            if (cancelled(reply)) peer.cancelledReruns++; else peer.snapshotResends++;
            const body = bodiesByInput.get(key);
            if (!body) throw new Error('failed');
            const rebound = { ...JSON.parse(await readFile(path.join(directory, body), 'utf8')), revision: operation.header.revision };
            request = calculator.request({ ...operation.header, state: 'body' }, rebound);
            ids.set(operation.id, request.id);
            reply = await request.promise;
            if (reply.header.error?.kind === 'snapshot-missing' || cancelled(reply)) throw new Error('failed');
          }
          (peer.replayDurations[operation.header.type] ??= []).push(performance.now() - began);
          if (operation.cancelled || operation.snapshotMissing) continue;
          const actual = digestTree(comparable(reply));
          if (actual.hash !== operation.rootHash) {
            const expected = JSON.parse(await readFile(path.join(directory, `${operation.index}.hashes`), 'utf8'));
            onDifference(operation, treeDifferences(expected, actual));
          }
        }
      } finally {
        await calculator.close();
        peer.sentRequests = calculator.sentRequests;
        peer.peakRSSBytes = calculator.peakRSSBytes;
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
  return [oracle, peer];
}
