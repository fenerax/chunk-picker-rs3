import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { packValue, unpackValue } from './values.mjs';
import path from 'node:path';
import { Calculator } from './client.mjs';
import { comparable, compareValues, hash } from './compare.mjs';

// Record the oracle's wire sequence, close it, then replay the candidate. Only
// private temporary request bodies and compressed expected values are written here.
export async function sequentialPair(reference, candidate, options, onReady, onDifference) {
  const directory = await mkdtemp(path.join(tmpdir(), 'calc-check-wire-'));
  const oracle = new Calculator(reference, options), operations = [];
  const bodies = new Set(), bodyCache = new WeakMap();
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
      let cached = bodyCache.get(state);
      if (!cached) { const bytes = JSON.stringify(state); cached = { bytes, key: hash(bytes) }; bodyCache.set(state, cached); }
      const { bytes, key } = cached;
      operation.body = key;
      if (!bodies.has(key)) { bodies.add(key); await writeFile(path.join(directory, key), bytes); }
    })();
    last = { id: pending.id, promise: pending.promise.then(async reply => {
      (oracle.replayDurations[header.type] ??= []).push(performance.now() - began);
      await stored;
      operation.snapshotMissing = reply.header.error?.kind === 'snapshot-missing';
      operation.cancelled = !!reply.header.cancelled || Object.values(reply.parts).some(p => p?.cancelled);
      await writeFile(path.join(directory, `${index}.expected`), packValue(comparable(reply)));
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
          const expected = unpackValue(await readFile(path.join(directory, `${operation.index}.expected`)));
          onDifference(operation, compareValues(expected, comparable(reply)));
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
