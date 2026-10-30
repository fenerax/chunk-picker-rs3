import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const volatile = JSON.parse(readFileSync(new URL('./volatile.json', import.meta.url)));
for (const entry of volatile) if (typeof entry.path !== 'string' || !/^[\w/.-]+:\d+$/.test(entry.source) || !entry.reason) throw new TypeError('invalid');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const valueHash = value => hash(value === undefined ? 'missing' : `json:${JSON.stringify(value)}`);
function ignored(path) {
  return volatile.some(entry => {
    const pattern = entry.path.split('.');
    return pattern[0] === '**' ? path.slice(-pattern.length + 1).join('.') === pattern.slice(1).join('.') : path.join('.') === entry.path;
  });
}
export function canonical(value, path = []) {
  if (Array.isArray(value)) return value.map((child, index) => canonical(child, [...path, String(index)]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !ignored([...path, key])).map(key => [key, canonical(value[key], [...path, key])]));
  return value;
}
// Dynamic dictionary keys can themselves contain private names or task text.
// Keep schema keys readable; identify every other path segment by its hash.
const schemaKeys = new Set(('play full duo duo-sidebar delta owner-reuse partner-reuse estimates planning sandbox area-check pool prepared error kind prediction-prepared result parts metrics elapsedMs availableCount catalogueCount unsupportedCount memberId stateRevision sourceRevision taskInputKey priority cancelled tasks rows id label category status hidden obligation sources blockers access coverage items training points presentation equipment currentBiS activityInfo changes unlockChunks lockChunks doneTasks eligible excluded candidates reasons ruleId detail format resultType chunkId chunkIds memberCount tasksAdded tasksRemoved itemsAdded areasAdded basesAdded trainingChanged cache baselineHit hypotheticalHit estimateHits estimatedCount baselineEvaluations predictionEvaluations').split(' '));
const segment = (key, index = false) => index && /^\d+$/.test(key) || schemaKeys.has(key) ? key.replaceAll('~', '~0').replaceAll('/', '~1') : `@sha256:${hash(key)}`;
export function differences(left, right, prefix = '') {
  const found = [];
  function walk(a, b, path) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], `${path}/${segment(key, Array.isArray(a))}`);
    } else found.push({ path: path || '/', referenceHash: valueHash(a), candidateHash: valueHash(b) });
  }
  walk(canonical(left), canonical(right), prefix);
  return found;
}
export function comparable(reply) {
  return reply.header.type === 'error' ? { error: { kind: reply.header.error.kind } }
    : { ...reply.parts, ...(reply.prepared?.length ? { 'prediction-prepared': reply.prepared } : {}) };
}

const scalarMemo = new Map(), scalarOrder = [];
let scalarCursor = 0;
function scalarTree(value) {
  const key = value === undefined ? 'missing' : `json:${JSON.stringify(value)}`;
  if (key.length > 4096) return { hash: hash(key), type: 'value' };
  const retained = scalarMemo.get(key);
  if (retained) return retained;
  const node = Object.freeze({ hash: hash(key), type: 'value' });
  if (scalarOrder.length < 32768) scalarOrder.push(key);
  else { scalarMemo.delete(scalarOrder[scalarCursor]); scalarOrder[scalarCursor] = key; scalarCursor = (scalarCursor + 1) % 32768; }
  scalarMemo.set(key, node);
  return node;
}

// Hash trees retain no gameplay values. Their children identify an exact path
// without retaining several complete result graphs during sequence checks.
export function digestTree(value, path = []) {
  if (!value || typeof value !== 'object') return scalarTree(value);
  const type = Array.isArray(value) ? 'array' : 'object';
  const keys = Object.keys(value).filter(key => !ignored([...path, key])).sort();
  const children = {}, digest = createHash('sha256').update(type);
  for (const key of keys) {
    const child = digestTree(value[key], [...path, key]);
    children[segment(key, type === 'array')] = child;
    digest.update(JSON.stringify(key)).update(':').update(child.hash).update(';');
  }
  return { hash: digest.digest('hex'), type, children };
}
export function treeDifferences(a, b, prefix = '') {
  const found = [];
  function visit(left, right, path) {
    if (left?.hash === right?.hash) return;
    if (left?.children && right?.children && left.type === right.type) {
      for (const key of [...new Set([...Object.keys(left.children), ...Object.keys(right.children)])].sort()) visit(left.children[key], right.children[key], `${path}/${key}`);
    } else found.push({ path: path || '/', referenceHash: left?.hash ?? valueHash(undefined), candidateHash: right?.hash ?? valueHash(undefined) });
  }
  visit(a, b, prefix);
  return found;
}
