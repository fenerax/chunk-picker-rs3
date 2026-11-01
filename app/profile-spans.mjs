// Loaded only behind RS3_PROFILE=1. No clocks, observers or inspector when off.
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, mkdirSync } from 'node:fs';
import { threadId, isMainThread } from 'node:worker_threads';
const CPU_ENABLED = process.env.RS3_PROFILE_CPU === '1';
const Session = CPU_ENABLED ? (await import('node:inspector/promises')).Session : undefined;
import { PerformanceObserver, monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';

const storage = new AsyncLocalStorage();
const directory = process.env.RS3_PROFILE_DIR;
const role = isMainThread ? (process.env.RS3_PROFILE_ROLE ?? 'server') : 'engine';
const processId = `${process.pid}-${threadId}`;
if (directory) try { mkdirSync(directory, { recursive: true }); } catch {}
let sequence = 0;
// Trace output is bounded per process so a long-running profiled server cannot fill the disk.
const maxBytes = Number(process.env.RS3_PROFILE_MAX_BYTES) > 0 ? Number(process.env.RS3_PROFILE_MAX_BYTES) : 256 * 2 ** 20;
let written = 0, truncated = false;
export const now = () => Number(process.hrtime.bigint()) / 1e6;
export const current = () => storage.getStore();
export const capture = () => current() && { ...current() };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value);
export function emit(value) {
  if (!directory || truncated) return;
  try {
    let line = JSON.stringify({ processId, layer: role, ...value }) + '\n';
    if (written + Buffer.byteLength(line) > maxBytes) { truncated = true; line = JSON.stringify({ processId, layer: role, kind: 'truncated', maxBytes }) + '\n'; }
    written += Buffer.byteLength(line);
    appendFileSync(path.join(directory, `${processId}.jsonl`), line);
  }
  catch { /* Diagnostics must never alter gameplay. */ }
}
export function interval(name, start, end, context = current(), extra = {}) {
  if (!context || !Number.isFinite(start) || end < start) return;
  emit({ kind: 'span', id: `${processId}:${++sequence}`, parentId: context.spanId, profileId: context.profileId, name, start, end, ...extra });
}
export function span(name, work, context = current()) {
  if (!context) return work();
  const start = now(), id = `${processId}:${++sequence}`;
  const finish = () => emit({ kind: 'span', id, parentId: context.spanId, profileId: context.profileId, name, start, end: now(), ...(['http.routing','worker.evaluate','worker.predict','worker.how-task','worker.roll-pool','worker.chunk-planning','worker.sandbox','worker.area-check','worker.death-estimates'].includes(name) ? { envelope: true } : {}) });
  try {
    const value = storage.run({ ...context, spanId: id }, work);
    if (value && typeof value.then === 'function') return value.then(result => { finish(); return result; }, error => { finish(); throw error; });
    finish(); return value;
  } catch (error) { finish(); throw error; }
}
export const bind = work => { const context = capture(); return (...args) => storage.run(context, () => work(...args)); };
export function wrapMethods(object, names, prefix) {
  for (const name of names) if (typeof object[name] === 'function') {
    const original = object[name]; object[name] = function (...args) { return span(`${prefix}.${name}`, () => original.apply(this, args)); };
  }
  return object;
}
export function request(request, response, work) {
  const profileId = request.headers['x-rs3-profile'];
  // Client headers are honoured only while the harness has a scenario running.
  if (!activeScenario || !validId(profileId)) return work();
  const start = now(), id = `${processId}:${++sequence}`, context = { profileId, spanId: id };
  const route = (request.url ?? '').split('?')[0];
  // Open-ended SSE is deliberately excluded from request wall-time coverage.
  if (route === '/api/events') return work();
  let ended = false;
  const finish = () => { if (ended) return; ended = true; emit({ kind: 'span', id, profileId, name: 'http.request', start, end: now(), envelope: true }); };
  response.once('finish', finish); response.once('close', finish);
  const end = response.end;
  response.end = function (...args) {
    const at = now(); response.once('finish', () => interval('http.write.flush', at, now(), context));
    return storage.run(context, () => end.apply(this, args));
  };
  return storage.run(context, () => span('http.routing', work));
}
export function startup(phase, start, end) { emit({ kind: 'startup', phase, start, end }); }
let laneSequence = 0;
export const lane = () => ({ id: `${processId}:lane:${++laneSequence}`, starts: [], jobs: [] });
export function workerStarting(lane) { lane.starting = { start: now() }; }
export function workerSpawned(lane, worker) {
  if (!lane.starting) return;
  Object.assign(lane.starting, { spawnedAt: now(), pid: worker.pid ?? process.pid, threadId: worker.threadId });
}
export function workerReady(lane, worker) {
  if (!lane.starting) return;
  const row = { ...lane.starting, end: now(), pid: worker.pid ?? process.pid, threadId: worker.threadId };
  lane.starts.push(row); lane.starting = undefined;
  emit({ kind: 'worker-start', laneId: lane.id, ...row });
}
export function queued(entry, lane) { entry._profile = capture(); entry._profileQueuedAt = now(); entry._profileLane = lane; }
export function dispatch(entry) {
  if (!entry._profile) return;
  const end = now(), start = entry._profileQueuedAt, lane = entry._profileLane;
  const intervals = [start,end];
  const starts = (lane?.starts??[]).filter(s=>s.end>start&&s.start<end);
  const jobs = (lane?.jobs??[]).filter(j=>j.end>start&&j.start<end);
  for(const s of [...starts,...jobs])intervals.push(Math.max(start,s.start),Math.min(end,s.end));
  const points=[...new Set(intervals)].sort((a,b)=>a-b);
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],boot=starts.find(s=>s.start<=a&&s.end>=b),job=jobs.find(j=>j.start<=a&&j.end>=b);
    interval(boot?'worker.startup.wait':job?'worker.queue.behind':'worker.queue.scheduler',a,b,entry._profile,
      boot?{workerPid:boot.pid,workerThreadId:boot.threadId,spawnStart:boot.start,spawnedAt:boot.spawnedAt}:job?{blockingJob:{id:job.id,type:job.type,profileId:job.profileId}}:{});
  }
  entry._profileDispatchAt = end;
  entry._profileJob = { id: `${lane?.id??processId}:job:${entry.id??++sequence}`, type: entry.type??'evaluate', profileId: entry._profile.profileId, start: end };
  // Bound retained diagnostic history. Only recent jobs can overlap a queued request.
  if(lane&&lane.jobs.length>4096)lane.jobs.splice(0,lane.jobs.length-4096);
}
export function sending(entry) {
  if (!entry._profile) return;
  const sentAt = now();
  interval('worker.dispatch.prepare', entry._profileDispatchAt, sentAt, entry._profile);
  entry._profile = { ...entry._profile, sentAt, jobId: entry._profileJob?.id };
  entry._profileSentAt = sentAt;
}
export function completed(entry, message) {
  if (!entry._profile) return;
  const end = now();
  if(Number.isFinite(message?._profileReplySentAt)) interval('worker.message.return',message._profileReplySentAt,end,entry._profile);
  interval('worker.roundTrip',entry._profileSentAt??entry._profileDispatchAt,end,entry._profile,{envelope:true});
  if(entry._profileJob) { entry._profileJob.end=end; entry._profileLane?.jobs.push(entry._profileJob); }
}
export function workerHandler(handler) {
  return message => {
    if (!validId(message._profile?.profileId)) return handler(message);
    if (Number.isFinite(message._profile.sentAt)) interval('worker.message.inbound', message._profile.sentAt, now(), message._profile, { jobId: message._profile.jobId });
    return span(`worker.${message.type ?? 'evaluate'}`, () => handler(message), message._profile);
  };
}

// A separate inspector session per isolate; controls travel over existing worker
// channels and are intercepted before the calculator protocol sees them.
let cpu, cpuStart, scenario;
const delay = CPU_ENABLED ? monitorEventLoopDelay({ resolution: 10 }) : undefined;
const gc = [];
// Observed only during a capture, and bounded, so an idle profiled process retains nothing.
const gcObserver = CPU_ENABLED ? new PerformanceObserver(list => { for (const e of list.getEntries()) if (gc.length < 100000) gc.push({ start: now() - (performance.now() - e.startTime), duration: e.duration }); }) : undefined;
export async function control(message) {
  if (message.action === 'clock') return { clock: now(), processId };
  if (!CPU_ENABLED) return;
  if (message.action === 'start') {
    if (cpu) return;
    scenario = message.scenario; gc.length = 0; gcObserver.observe({ entryTypes: ['gc'] }); delay.reset(); delay.enable();
    cpu = new Session(); cpu.connect(); await cpu.post('Profiler.enable');
    await cpu.post('Profiler.setSamplingInterval', { interval: 1000 });
    cpuStart = now(); await cpu.post('Profiler.start');
  } else if (message.action === 'stop' && cpu) {
    const session = cpu; cpu = undefined;
    const { profile } = await session.post('Profiler.stop'); session.disconnect(); delay.disable(); gcObserver.disconnect();
    const end = now();
    const events = gc.splice(0);
    emit({ kind: 'cpu', scenario, start: cpuStart, end, profile, gc: events, eventLoop: { meanMs: Number.isFinite(delay.mean) ? delay.mean / 1e6 : 0, maxMs: delay.max / 1e6 }, rssBytes: process.memoryUsage().rss });
  }
}
const endpoints = new Map(); let controlSequence = 0, activeScenario;
export function attach(worker) {
  // Pooled endpoints speak a job protocol, not the native worker control
  // protocol. Never inject diagnostic jobs into that queue.
  if (!Number.isInteger(worker.threadId) && !Number.isInteger(worker.pid)) return;
  const pending = new Map();
  const send = payload => new Promise((resolve, reject) => {
    const id = ++controlSequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Profile worker control timeout')); }, 30000); timer.unref();
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ _rs3ProfileControl: id, ...payload });
  });
  const needsRelay = !!worker.pid && process.env.RS3_PROFILE_RELAY === '1';
  endpoints.set(worker, send);
  worker.on('message', message => {
    const id = message._rs3ProfileReply ?? message._rs3ProfileRelayReply;
    const item = pending.get(id); if (!item) return;
    if (message._rs3ProfileReply) item.reply = message;
    if (message._rs3ProfileRelayReply) item.relay = true;
    if (!item.reply || needsRelay && !item.relay) return;
    clearTimeout(item.timer); pending.delete(id); item.resolve(item.reply);
  });
  worker.once('exit', () => { endpoints.delete(worker); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Profile worker exited')); } });
  const t0 = now();
  void send({ action: 'clock' }).then(reply => {
    const t1 = now(); emit({ kind: 'clock', target: reply.processId, offsetMs: reply.clock - (t0 + t1) / 2, uncertaintyMs: (t1 - t0) / 2 });
    if (activeScenario) return send({ action: 'start', scenario: activeScenario });
  }).catch(() => {});
}
export async function scenarioControl(action, name) {
  activeScenario = action === 'start' ? name : undefined;
  if (activeScenario) process.env.RS3_PROFILE_SCENARIO = activeScenario;
  else delete process.env.RS3_PROFILE_SCENARIO;
  await control({ action, scenario: name });
  await Promise.all([...endpoints.values()].map(send => send({ action, scenario: name })));
}
export function installWorker(port, handler) {
  const run = workerHandler(handler);
  port.on('message', message => {
    if (!message._rs3ProfileControl) return run(message);
    void control(message).then(result => port.postMessage({ _rs3ProfileReply: message._rs3ProfileControl, ...result }));
  });
}

// Newly spawned calculator isolates join a running scenario before compiling.
if (!isMainThread && process.env.RS3_PROFILE_SCENARIO) await control({ action: 'start', scenario: process.env.RS3_PROFILE_SCENARIO });
