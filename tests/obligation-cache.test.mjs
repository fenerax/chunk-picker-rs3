import test from 'node:test';
import assert from 'node:assert/strict';
import { createObligationCache } from '../app/tasks/obligation-cache.mjs';

function graph(rows, options) {
  const tasks = new Map(Object.entries(rows).map(([key, row]) => [key, { key, ...row }]));
  const cache = createObligationCache(options), counts = new Map(), seeds = new Set();
  function evaluate(key, visiting = new Set()) {
    const task = tasks.get(key);
    return cache.evaluate(task, visiting, () => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (visiting.has(key)) return seeds.has(key);
      visiting.add(key);
      if (task.value !== undefined) return task.value;
      const check = child => evaluate(child, new Set(visiting));
      return task.any ? task.any.some(check) : task.all.every(check);
    });
  }
  const guard = key => cache.evaluate({ key }, new Set([key]), () => false);
  return { evaluate, counts, seeds, guard, clear: () => cache.clear() };
}

test('shared true and false subproofs are reused until source facts change', () => {
  const f = graph({ first: { all: ['absent'] }, second: { all: ['absent'] }, absent: { value: false } });
  assert.equal(f.evaluate('first'), false); assert.equal(f.evaluate('second'), false);
  assert.equal(f.counts.get('absent'), 1);
  f.clear(); assert.equal(f.evaluate('second'), false); assert.equal(f.counts.get('absent'), 2);
  const positive = graph({ first: { all: ['present'] }, second: { all: ['present'] }, present: { value: true } });
  assert.equal(positive.evaluate('first'), true); assert.equal(positive.evaluate('second'), true);
  assert.equal(positive.counts.get('present'), 1);
});

test('a caller cycle guard cannot poison a later independent negative or positive proof', () => {
  const rows = { a: { any: ['b', 'root'] }, b: { all: ['a'] }, root: { value: true }, missing: { value: false },
    c: { all: ['d', 'missing'] }, d: { all: ['c'] } };
  for (const order of [['a', 'b', 'c', 'd'], ['b', 'a', 'd', 'c']]) {
    const fast = graph(rows), cold = graph(rows, { enabled: false });
    for (const key of [...order, ...order.toReversed()]) assert.equal(fast.evaluate(key), cold.evaluate(key), key);
    assert.equal(fast.evaluate('b'), true, 'b needs a fresh expansion of a after the first guarded attempt');
    fast.seeds.add('c'); cold.seeds.add('c'); fast.clear();
    for (const key of order) assert.equal(fast.evaluate(key), cold.evaluate(key), key);
  }
});

test('an independent cached proof is expanded again when a new caller path intersects its reads', () => {
  const rows = { a: { all: ['b'] }, b: { any: ['a', 'root'] }, root: { value: true } };
  const fast = graph(rows), cold = graph(rows, { enabled: false });
  assert.equal(fast.evaluate('a'), true);
  for (const path of [new Set(['b']), new Set(['root']), new Set(['a'])]) {
    assert.equal(fast.evaluate('a', new Set(path)), cold.evaluate('a', new Set(path)));
  }
});

test('a parent retains the transitive reads of a cached child', () => {
  const rows = { a: { all: ['b'] }, b: { all: ['c'] }, c: { value: true } };
  const fast = graph(rows), cold = graph(rows, { enabled: false });
  assert.equal(fast.evaluate('b'), true);
  assert.equal(fast.evaluate('a'), true);
  assert.equal(fast.counts.get('b'), 1, 'parent traverses a cached child');
  assert.equal(fast.evaluate('a', new Set(['c'])), cold.evaluate('a', new Set(['c'])));
  assert.equal(fast.evaluate('a', new Set(['c'])), false);
});

test('bounded entries and saturated fingerprints remain cold-equivalent on long and wide graphs', () => {
  const rows = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [String(index),
    index === 29 ? { value: true } : { all: [String(index + 1)] }]));
  rows.wide = { all: Object.keys(rows) };
  for (const options of [{ maxEntries: 2 }, { hashBits: 1 }, { hashBits: 2 }, { maxEntries: 0 }]) {
    const fast = graph(rows, options), cold = graph(rows, { enabled: false });
    for (const key of ['0', 'wide', '15', '0', 'wide']) assert.equal(fast.evaluate(key), cold.evaluate(key));
  }
});

test('forced collisions decline independent hits and do not turn caller guards into proofs', () => {
  const rows={ a:{all:['b']}, b:{any:['a','root']}, root:{value:true} };
  const fast=graph(rows,{hashBits:1}), cold=graph(rows,{enabled:false});
  for(const key of ['a','b','a','root']) for(const path of [[],['unrelated'],['a'],['root']]) {
    assert.equal(fast.evaluate(key,new Set(path)),cold.evaluate(key,new Set(path)));
  }
  const before=fast.counts.get('root');
  assert.equal(fast.evaluate('root',new Set(['unrelated'])),true);
  assert.equal(fast.counts.get('root'),before+1,'collision recomputes despite no actual key overlap');
});

test('evicted key masks recompute deterministically while older proof footprints remain retained', () => {
  const rows = { a: { all: ['b'] }, b: { any: ['a', 'root'] }, root: { value: true } };
  const fast = graph(rows), cold = graph(rows, { enabled: false });
  assert.equal(fast.evaluate('a'), true);
  for (let index = 0; index < 32769; index++) assert.equal(fast.guard(`eviction-${index}`), false);
  assert.equal(fast.evaluate('a', new Set(['b'])), cold.evaluate('a', new Set(['b'])));
  assert.equal(fast.evaluate('a', new Set(['b'])), false, 'recomputed mask still rejects the retained root proof');
  assert.equal(fast.evaluate('a'), true, 'the guarded attempt did not replace the independent proof');
});
