// Optional admission diagnostics. Preload with NODE_OPTIONS=--import=... and
// RS3_CACHE_ADMISSION_TRACE=/tmp/.... Logs only counts, byte sizes and public
// cache/request kinds. Exclude this synchronous trace from latency comparisons.
import { registerHooks } from 'node:module';
import { isMainThread, parentPort } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = process.env.RS3_CACHE_ADMISSION_TRACE;
if (output && !resolve(output).startsWith('/tmp/')) throw new Error('Trace location must be temporary.');
if (output && !isMainThread) {
  let job = {}, count = 0;
  const owners = new Map();
  parentPort?.on('message', message => { job = { request: message.id, type: message.type }; });
  globalThis[Symbol.for('rs3.cacheAdmissionTrace')] = (event, token, cost, owner, extra = {}) => {
    if (count++ >= 4096) return;
    if (!owners.has(owner) && owners.size < 64) owners.set(owner, owners.size + 1);
    const kind = token?.baseline ? token.state ? 'sandbox' : 'complete' : 'eligibility';
    appendFileSync(output, JSON.stringify({ event, ...job, kind, cost, owner: owners.get(owner) ?? 0, ...extra }) + '\n');
  };
  const call = 'globalThis[Symbol.for("rs3.cacheAdmissionTrace")]';
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    let source = String(result.source);
    if (url.endsWith('/tasks/snapshot-cache.mjs')) {
      const anchor = 'entry.version = next;';
      if (!source.includes(anchor)) throw new Error('Snapshot admission anchor changed.');
      source = source.replace(anchor, `${call}('measure', value, cost, 'picker:' + entry.owner, { planned: +!!value.planningIndex, predicted: +!!value.predict, views: +!!value.includeViews, estimates: value.estimates?.size ?? 0 });\n    ${anchor}`);
    } else if (url.endsWith('/tasks/eligibility-cache.mjs')) {
      const anchor = "const ownerLimit = owner === 'eligibility' ? eligibilityByteLimit : ownerByteLimit;";
      if (!source.includes(anchor)) throw new Error('Budget admission anchor changed.');
      source = source.replace(anchor, `${anchor}\n      ${call}('admit', bytes, cost, owner, { bytes: retainedBytes, snapshots: snapshotRetainedBytes, ownerBytes: owners.get(owner) ?? 0, limit: byteLimit, ownerLimit, snapshotLimit: snapshotByteLimit, rejected: +(cost > byteLimit || cost > ownerLimit || owner !== 'eligibility' && cost > snapshotByteLimit || entryLimit === 0) });`);
      let reason = 0;
      source = source.replaceAll('release(oldest, entry); entry.onEvict();', () => `${call}('evict', oldest, entry.cost, entry.owner, { reason: ${++reason}, bytes: retainedBytes, snapshots: snapshotRetainedBytes }); release(oldest, entry); entry.onEvict();`);
      if (reason !== 3) throw new Error('Budget eviction anchors changed.');
    } else return result;
    return { ...result, source };
  } });
}
