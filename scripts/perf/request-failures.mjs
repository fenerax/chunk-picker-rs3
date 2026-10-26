// Local synthetic API-dispatch comparison. No servers, datasets or external IO.
// node scripts/perf/request-failures.mjs <START full SHA>
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { calculationLabel } from '../../app/web/calculation-feedback.mjs';
import { createRequestReader, requestError } from '../../app/web/live-swap-client.mjs';

const start = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(start ?? '')) throw new Error('Supply the full START commit SHA');
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = (variant, file) => variant === 'before'
  ? execFileSync('git', ['show', `${start}:${file}`], { cwd: root, encoding: 'utf8' }) : readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
function api(variant, fetch) {
  const scope = { fetch, calculationLabel, createRequestReader, requestError, groupGoalCommandTypes: [],
    createCalculationFeedback: () => ({ begin: () => () => {} }), createSaveRecovery: () => () => {} };
  runInNewContext(source(variant, 'app/web/screen-commands.mjs').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.install = createScreenCommands;', scope);
  const c = { canWrite: () => true, sandbox: { active: false }, state: { revision: 7, members: [{ id: 'a', name: 'Player' }] }, memberId: 'a' };
  scope.install(c); return c.api;
}
const answer = (status, value, retry = false) => ({ ok: status < 400, status, headers: { get: () => retry ? '5' : null }, json: async () => value });
async function probes(variant) {
  let rawErrors = 0;
  for (const failure of [429, 503, 409, 413, 'offline', 'ECONNRESET']) {
    const call = api(variant, async () => {
      if (typeof failure === 'string') throw new TypeError(`ECONNRESET ${failure}`);
      return answer(failure, { message: 'Error: internal stack\n at server (/synthetic/file:1)' });
    });
    try { await call('/api/tasks?memberId=a'); } catch (error) { if (/ECONNRESET|internal stack/.test(error.message)) rawErrors++; }
  }
  let cooldownDispatches = 0;
  const call = api(variant, async () => { cooldownDispatches++; return answer(429, {}, true); });
  for (let i = 0; i < 5; i++) { try { await call('/api/tasks?memberId=a'); } catch {} }
  const timers = [], streams = [];
  const scope = { setTimeout: (fn, delay) => timers.push(delay), EventSource: class {
    constructor() { this.readyState = 2; this.listeners = {}; streams.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; } close() {}
  } };
  runInNewContext(source(variant, 'app/web/screen-live.mjs').replace(/^export /gm, '') + '\nglobalThis.install = createScreenLive;', scope);
  const c = { queue: Promise.resolve(), recoverPendingCommand: async () => {}, saved() {}, showError() {} };
  scope.install(c); c.connectEvents(); await c.queue;
  streams[0].listeners.error(); streams[0].listeners.error();
  return { rawErrorsOfSix: rawErrors, dispatchesForFiveCooldownClicks: cooldownDispatches, reconnectTimersForTwoClosedErrors: timers.length };
}
if (process.argv[3] === '--child') {
  const variant = process.argv[4];
  const payload = JSON.stringify({ stateRevision: 7, memberId: 'a', tasks: Array.from({ length: 100 }, (_, i) => ({ id: `synthetic:${i}`, label: `Task ${i}`, status: 'available' })) });
  const call = api(variant, async () => ({ ok: true, status: 200, json: async () => JSON.parse(payload) }));
  for (let i = 0; i < 2000; i++) await call('/api/tasks?memberId=a');
  const iterations = 10000, began = performance.now();
  for (let i = 0; i < iterations; i++) await call('/api/tasks?memberId=a');
  const usPerCall = (performance.now() - began) * 1000 / iterations;
  console.log(JSON.stringify({ variant, usPerCall, peakMiB: process.resourceUsage().maxRSS / 1024, probes: await probes(variant) }));
} else {
  const pairs = [];
  for (let i = 0; i < 8; i++) {
    const order = i % 2 ? ['after', 'before'] : ['before', 'after'], pair = { order };
    for (const variant of order) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), start, '--child', variant], { cwd: root, encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr || child.error?.message || 'Measurement failed');
      pair[variant] = JSON.parse(child.stdout);
    }
    pairs.push(pair);
  }
  const summary = values => {
    const sorted = values.toSorted((a, b) => a - b);
    return { median: (sorted[3] + sorted[4]) / 2, min: sorted[0], max: sorted[7] };
  };
  console.log(JSON.stringify({ start, node: process.version, pairs,
    beforeUs: summary(pairs.map(p => p.before.usPerCall)), afterUs: summary(pairs.map(p => p.after.usPerCall)),
    pairedDeltaUs: summary(pairs.map(p => p.after.usPerCall - p.before.usPerCall)),
    beforePeakMiB: summary(pairs.map(p => p.before.peakMiB)), afterPeakMiB: summary(pairs.map(p => p.after.peakMiB)) }, null, 2));
}
