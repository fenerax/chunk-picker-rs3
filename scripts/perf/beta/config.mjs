import { parseArgs } from 'node:util';
import { random, digest } from '../capacity/model.mjs';
import { MP7_DEFAULTS, pickerLimitOptions } from '../../../app/security/picker-limits.mjs';
import { COLD_OPEN_ADMISSION } from '../../../app/picker-admission.mjs';

const defaults = {
  groups: 50, seed: 'beta-1', seconds: 3600, 'ramp-seconds': 60, actions: 15,
  'plugin-clients': 150, 'plugin-rate': 75, 'stored-keys': 450,
  'history-events': 1000, snapshots: 300, chunks: 4096, tasks: 23939, aliases: 91000, 'state-bytes': 15400000,
  'near-limit-mib': 200, 'max-open-contexts': 7, 'streams-global': 64,
  'cold-global': 1, 'cold-pending': 64, 'cold-per-account': 2, 'cold-deadline-ms': 2000,
  'expensive-global': 1200, 'plugin-global': 128, 'deadline-ms': 45000,
  'max-in-flight': 2000, 'sample-ms': 1000, 'soak-seconds': 43200,
  'optional-seconds': 60, 'os-reserve-mib': 1024, 'sync-per-minute': 10,
};
export function parse(argv = process.argv.slice(2)) {
  const strings = ['target', 'host', 'port', 'key-file', 'out', 'phases', 'limits-json', 'admission-json', ...Object.keys(defaults)];
  const { values } = parseArgs({ args: argv, options: Object.fromEntries([
    ...strings.map(k => [k, { type: 'string', ...(defaults[k] !== undefined ? { default: String(defaults[k]) } : {}) }]),
    ...['serve', 'smoke', 'help'].map(k => [k, { type: 'boolean', default: false }]),
  ]) });
  const c = { ...values };
  for (const [key, fallback] of Object.entries(defaults)) if (typeof fallback === 'number') {
    c[key] = Number(c[key]);
    if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1e9) throw new Error(`Invalid --${key}.`);
  }
  if (c.smoke) {
    for (const [key, value] of Object.entries({ groups: 5, seconds: 90, 'ramp-seconds': 10, actions: 2,
      'plugin-clients': 10, 'plugin-rate': 5, 'stored-keys': 30, snapshots: 10, chunks: 64, tasks: 120, aliases: 1000, 'state-bytes': 0,
      'near-limit-mib': 1, 'max-open-contexts': 12, 'streams-global': 64 }))
      if (!argv.some(a => a === `--${key}` || a.startsWith(`--${key}=`))) c[key] = value;
  }
  for (const key of ['groups', 'plugin-clients', 'stored-keys', 'history-events', 'snapshots', 'chunks', 'tasks', 'aliases', 'state-bytes',
    'max-open-contexts', 'streams-global', 'cold-global', 'cold-pending', 'cold-per-account', 'cold-deadline-ms',
    'expensive-global', 'plugin-global', 'deadline-ms', 'max-in-flight', 'sample-ms'])
    if (!Number.isSafeInteger(c[key]) || c[key] < (['plugin-clients', 'history-events', 'snapshots', 'stored-keys', 'aliases', 'state-bytes'].includes(key) ? 0 : 1)) throw new Error(`Invalid --${key}.`);
  if (c.groups < 5 || c.groups > 200 || c.tasks > 100000 || c.chunks < 2 || c.chunks > 10000 || c['near-limit-mib'] > 207) throw new Error('Fixture exceeds the harness bounds (groups 5–200).');
  if (c.aliases > 1e6 || c['state-bytes'] > 208 * 1024 * 1024 || c.actions > 1000 || c['plugin-rate'] > 10000 || c['max-in-flight'] > 20000 || c['history-events'] > 10000) throw new Error('Workload exceeds the harness bounds.');
  if (c.snapshots > c['history-events'] || c.snapshots > 1000) throw new Error('Snapshots must be <= history-events and <= 1000.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.seed) || c.seconds < 1 || c['sample-ms'] < 100) throw new Error('Use a short synthetic seed, positive steady duration and sample interval >=100 ms.');
  c.phases = (c.phases ?? '').split(',').filter(Boolean);
  if (c.phases.some(p => !['headroom', 'extra-tabs', 'cold', 'lifecycle', 'overload', 'restart', 'backup', 'soak'].includes(p))) throw new Error('Unknown optional phase.');
  const override = (text, allowed) => {
    const value = text ? JSON.parse(text) : {};
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !Object.hasOwn(allowed, key)) ||
      Object.values(value).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Invalid runtime JSON override.');
    return value;
  };
  c.limits = pickerLimitOptions({ streamsGlobal: c['streams-global'], coldStartsGlobal: c['cold-global'],
    expensiveGlobal: c['expensive-global'], pluginRequestsGlobal: c['plugin-global'], ...override(c['limits-json'], MP7_DEFAULTS) });
  c.admission = { ...COLD_OPEN_ADMISSION, maxPending: c['cold-pending'], perAccount: c['cold-per-account'], deadlineMs: c['cold-deadline-ms'],
    ...override(c['admission-json'], COLD_OPEN_ADMISSION) };
  return c;
}

export function plan(c) {
  const rng = random(c.seed), count = c.phases.includes('headroom') ? Math.max(100, c.groups) : c.groups;
  // Slightly more than three seats/group leaves room for multi-character logins.
  const sizes = Array.from({ length: count }, (_, i) => [1, 2, 3, 4, 5, 5, 4, 3, 4, 4][i % 10]);
  for (let i = sizes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [sizes[i], sizes[j]] = [sizes[j], sizes[i]]; }
  const seats = sizes.reduce((a, b) => a + b, 0), logins = Math.min(3 * count, seats - Math.max(1, Math.floor(count / 5)));
  let seat = 0;
  const groups = sizes.map((size, index) => ({ index, size, grown: Math.round((index + 1) / 4) === Math.round(index / 4), variant: Math.floor(rng() * 4),
    members: Array.from({ length: size }, () => { const index = seat++; return { login: index < logins ? index : Math.floor((index - logins) / 2) % logins }; }) }));
  return { groups, logins, seats, digest: digest({ seed: c.seed, groups, logins }) };
}

export function stages(c, available) {
  const cap = n => Math.min(n, available), ramp = c['ramp-seconds'];
  const list = [25, 75, 150].map(n => ({ name: `ramp-${n}`, seconds: ramp, users: cap(n), actions: c.actions, plugins: c['plugin-rate'] }));
  list.push({ name: 'steady', seconds: c.seconds, users: cap(150), actions: c.actions, plugins: c['plugin-rate'] });
  for (const phase of c.phases) list.push({ name: phase, seconds: phase === 'soak' ? c['soak-seconds'] : c['optional-seconds'],
    users: cap(phase === 'headroom' ? 200 : 150), actions: phase === 'headroom' ? 20 : phase === 'overload' ? c.actions * 2 : c.actions,
    plugins: c['plugin-rate'] * (phase === 'overload' ? 2 : 1) });
  return list.filter(s => s.seconds > 0);
}

export const actionMix = [ ['read', 30], ['filter', 12], ['edit', 9], ['switch', 3], ['expensive', 5], ['lifecycle', 1] ];
export function actionAt(ordinal, seed) {
  // Seeded permutations of exact 60-action blocks avoid random mix drift in short runs.
  const block = actionMix.flatMap(([kind, count]) => Array(count).fill(kind)), rng = random(`${seed}:${Math.floor(ordinal / 60)}`);
  for (let i = block.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [block[i], block[j]] = [block[j], block[i]]; }
  return block[ordinal % 60];
}
