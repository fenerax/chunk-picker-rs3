import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const NORMALIZATION = 'worker-json-v1';
// Maintained policy: README.md, beside this implementation. Only telemetry at
// these paths is excluded; similarly named gameplay fields remain significant.
export function normalize(message) {
  function visit(value, path = []) {
    if (Array.isArray(value)) return value.map((child, i) => visit(child, [...path, String(i)]));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().filter(key => {
      if (!path.length && ['id', 'timingMs', 'evaluationMs'].includes(key)) return false;
      if (key === 'elapsedMs' && path.at(-1) === 'metrics') return false;
      if (key === 'cache' && path.length === 1 && path[0] === 'result') return false;
      return true;
    }).map(key => [key, visit(value[key], [...path, key])]));
  }
  return visit(JSON.parse(JSON.stringify(message)));
}
const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
export function differences(a, b, path = '') {
  if (Object.is(a, b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [path || '/'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key =>
    Object.hasOwn(a, key) && Object.hasOwn(b, key) ? differences(a[key], b[key], `${path}/${pointer(key)}`) : [`${path}/${pointer(key)}`]);
}
export const signature = path => path.replace(/\/\d+(?=\/|$)/g, '/*');
export const EXIT = Object.freeze({ pass: 0, mismatch: 10, timeout: 11, crash: 12, memory: 13, invalid: 14, budget: 15, engineError: 16, noise: 17 });
export function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required');
  if (process.platform !== 'linux') throw Error('Linux /proc required');
}
export function publicEnvironment(env = process.env) {
  if (Object.keys(env).some(key => key.startsWith('RS3_') && env[key])) throw Error('Unset RS3_* variables: synthetic/public inputs only');
}
