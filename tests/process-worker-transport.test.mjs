import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { encodeProcessMessage, encodeReceivedWorkerMessage, decodeProcessMessage, decodeReceivedProcessMessage } from '../app/tasks/process-worker-transport.mjs';

const receive = value => deserialize(serialize(encodeProcessMessage(value)));
function compare(value) {
  const envelope = receive(value), owned = envelope.data;
  const cold = decodeProcessMessage(envelope);
  const result = decodeReceivedProcessMessage(envelope);
  assert.deepEqual(result, cold);
  return { result, owned, cold };
}

test('received plain graphs reuse only the IPC-owned clone, preserving cycles and order', () => {
  const value = { list: new Array(3), map: new Map(), set: new Set(), tag: { shared: [], placeholder: {} } };
  value.self = value; value.list[2] = value;
  value.map.set(value, value.list); value.set.add(value); value.set.add(value.list);
  Object.defineProperty(value, '__proto__', { value: { safe: true }, enumerable: true });
  const { result, owned, cold } = compare(value);
  assert.equal(result, owned); assert.notEqual(cold, owned); assert.notEqual(result, value);
  assert.equal(result.self, result); assert.equal(result.list[2], result);
  assert.equal(0 in result.list, false);
  assert.deepEqual([...result.map.keys()], [result]);
  assert.deepEqual([...result.set], [result, result.list]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  result.tag.changed = true; assert.equal(value.tag.changed, undefined);
});

test('shared replacements preserve aliases, cycles, Map keys, Set order and container identity', () => {
  const buffer = new SharedArrayBuffer(32), view = new Uint16Array(buffer, 4, 3);
  view.set([17, 29, 41]);
  const value = { buffer, view, again: view, map: new Map(), set: new Set(), list: [] };
  value.self = value; value.list.push(value);
  value.map.set(buffer, value); value.map.set(view, value.map); value.map.set('last', value.set);
  value.set.add(view); value.set.add(buffer); value.set.add(value.set);
  Object.defineProperty(value, '__proto__', { value: view, enumerable: true });
  const envelope = receive(value), map = envelope.data.map, set = envelope.data.set, list = envelope.data.list;
  const cold = decodeProcessMessage(envelope), result = decodeReceivedProcessMessage(envelope);
  assert.deepEqual(result, cold);
  assert.equal(result, envelope.data); assert.equal(result.map, map); assert.equal(result.set, set); assert.equal(result.list, list);
  assert.equal(result.self, result); assert.equal(result.list[0], result);
  assert.equal(result.view, result.again); assert.equal(result.view.buffer, result.buffer);
  assert.equal(result.view.byteOffset, 4); assert.deepEqual([...result.view], [17, 29, 41]);
  assert.deepEqual([...map.keys()], [result.buffer, result.view, 'last']);
  assert.deepEqual([...set], [result.view, result.buffer, set]);
  assert.equal(result.__proto__, result.view); assert.equal(Object.getPrototypeOf(result), Object.prototype);
  result.view[0] = 99; assert.equal(view[0], 17);
});

test('root shared buffers and every supported shared view match the cold decoder', () => {
  const buffer = new SharedArrayBuffer(64);
  compare(buffer);
  for (const Type of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView]) {
    const view = new Type(buffer, 8, 2);
    const { result } = compare(view);
    assert.equal(result.constructor, Type); assert.equal(result.byteOffset, 8);
  }
  const { result } = compare(Buffer.from(buffer, 8, 4));
  assert.equal(Buffer.isBuffer(result), true); assert.equal(result.byteOffset, 8);
});

test('binary and atomic values retain cold decode behavior alongside shared replacements', () => {
  const array = new Uint8Array([1, 2, 3]);
  const { result } = compare({ shared: new SharedArrayBuffer(2), array, buffer: Buffer.from('test'),
    date: new Date(0), regex: /x/gi, error: new Error('synthetic'), ordinary: array.buffer });
  assert.deepEqual([...result.array], [1, 2, 3]);
});

test('owned worker encoding matches cold encoding across shared cycles without changing the worker source', () => {
  const buffer = new SharedArrayBuffer(16), view = new Uint16Array(buffer, 4, 2);
  view.set([11, 23]);
  const source = { buffer, view, again: view, map: new Map(), set: new Set(), sparse: new Array(4), tag: { placeholder: {} } };
  source.self = source; source.sparse[3] = source;
  source.map.set(buffer, source); source.map.set(view, source.map); source.set.add(view); source.set.add(source.set);
  Object.defineProperty(source, '__proto__', { value: view, enumerable: true });
  const received = structuredClone(source), map = received.map, set = received.set;
  const coldEnvelope = encodeProcessMessage(received);
  assert.equal(received.buffer instanceof SharedArrayBuffer, true, 'general encoder preserves caller data');
  const ownedEnvelope = encodeReceivedWorkerMessage(received);
  assert.equal(ownedEnvelope.data, received); assert.equal(received.map, map); assert.equal(received.set, set);
  const cold = decodeProcessMessage(deserialize(serialize(coldEnvelope)));
  const result = decodeReceivedProcessMessage(deserialize(serialize(ownedEnvelope)));
  assert.deepEqual(result, cold);
  assert.equal(result.self, result); assert.equal(result.again, result.view); assert.equal(result.view.buffer, result.buffer);
  assert.equal(result.__proto__, result.view); assert.equal(0 in result.sparse, false);
  assert.equal(source.view, view); assert.equal(source.buffer, buffer); assert.equal(source.map.get(buffer), source);
  assert.deepEqual([...view], [11, 23]);
});

test('owned encoding retains ordinary native-cloned graphs and every supported shared view', () => {
  const buffer = new SharedArrayBuffer(64);
  const views = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
    Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView].map(Type => new Type(buffer, 8, 2));
  const source = { views, buffer, binary: Buffer.from('test'), date: new Date(0), regex: /x/g, error: new Error('synthetic') };
  for (const value of [source, buffer, ...views, { plain: ['a', 2, null], map: new Map([['x', 1]]), set: new Set([2, 1]) }]) {
    const cold = decodeProcessMessage(deserialize(serialize(encodeProcessMessage(structuredClone(value)))));
    const received = structuredClone(value), envelope = encodeReceivedWorkerMessage(received);
    if (!(value instanceof SharedArrayBuffer) && !ArrayBuffer.isView(value)) assert.equal(envelope.data, received);
    assert.deepEqual(decodeReceivedProcessMessage(deserialize(serialize(envelope))), cold);
  }
});

test('owner metadata restores direct aliases without traversing unrelated state', () => {
  const shared = new SharedArrayBuffer(8), view = new Uint16Array(shared, 2, 2);
  const untouched = { registry: { entries: ['ordinary', 'save', 'data'] } };
  const input = { state: untouched, cancellation: shared,
    aliases: [shared, view, shared], map: new Map([[shared, view], [view, shared]]), set: new Set([view, shared]),
    parents: ['user data'], nested: { views: { shared: 'ordinary' } } };
  const envelope = receive(input);
  assert.equal(envelope.parents.length, 4, 'only the root, array, Map and Set directly own placeholders');
  const ownedState = envelope.data.state;
  Object.defineProperty(ownedState, 'mustNotVisit', { enumerable: true, get() { assert.fail('decoder walked unrelated save state'); } });
  const result = decodeReceivedProcessMessage(envelope);
  assert.equal(result.state, ownedState);
  assert.equal(result.aliases[0], result.cancellation); assert.equal(result.aliases[2], result.cancellation);
  assert.equal(result.aliases[1].buffer, result.cancellation);
  assert.deepEqual([...result.map], [[result.cancellation, result.aliases[1]], [result.aliases[1], result.cancellation]]);
  assert.deepEqual([...result.set], [result.aliases[1], result.cancellation]);
  assert.deepEqual(result.parents, ['user data']);
  assert.equal(input.state, untouched); assert.equal(input.cancellation, shared);
});

test('old envelopes without owner metadata keep the complete restoration fallback', () => {
  const shared = new SharedArrayBuffer(4);
  const envelope = receive({ nested: { shared }, again: shared });
  delete envelope.parents;
  const result = decodeReceivedProcessMessage(envelope);
  assert.ok(result.nested.shared instanceof SharedArrayBuffer);
  assert.equal(result.again, result.nested.shared);
});
