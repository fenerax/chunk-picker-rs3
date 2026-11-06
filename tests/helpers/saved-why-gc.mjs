import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createResponseCache } from '../../app/http-response.mjs';
import { createSavedWhyEvidence } from '../../app/saved-why-evidence.mjs';

assert.equal(typeof global.gc, 'function');
const owners = [];
async function seed(mode) {
  let expire;
  const clock = { setTimeout(fn, ms) { expire = fn; return setTimeout(fn, ms); },
    clearTimeout(id) { clearTimeout(id); expire = undefined; } };
  const cache = createResponseCache(), owner = createSavedWhyEvidence({ cache, clock });
  owners.push(owner);
  const entry = { revision: 7, fullGzip: gzipSync(JSON.stringify({ tasks: [{ id: 'synthetic', label: 'retained '.repeat(1000) }] })) };
  const parsed = await owner.read(entry, 7), refs = [new WeakRef(entry), new WeakRef(parsed)];
  if (mode === 'revision') { entry.revision = 8; await owner.read(entry, 7); }
  else if (mode === 'eviction') cache.clear();
  else if (mode === 'close') await owner.close();
  else if (mode === 'expiry') expire();
  else owner.forget(entry); // replacement of the saved entry uses this same release
  assert.equal(owner.stats().bytes, 0);
  assert.equal(expire, undefined, 'retirement clears the timer callback too');
  return refs;
}
for (const mode of ['replacement', 'revision', 'eviction', 'expiry', 'close']) {
  const refs = await seed(mode);
  let collected = false;
  for (let i = 0; i < 30; i++) {
    await nextTurn(); global.gc(); await nextTurn();
    if (refs.every(ref => ref.deref() === undefined)) { collected = true; break; }
  }
  assert.ok(collected, `${mode}: timer/owner must not retain the old entry or parsed graph`);
}
assert.equal(owners.length, 5);
await Promise.all(owners.map(owner => owner.close()));
console.log('collected all saved evidence');
