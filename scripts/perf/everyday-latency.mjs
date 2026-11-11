// Diagnostic only: three synthetic command streams and one real calculator.
// Run with --import ./scripts/perf/everyday-latency/trace.mjs; no server or saves input.
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { Session } from 'node:inspector';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { openStore } from '../../app/storage/store.mjs';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
import { calculationInput } from './owned-acceptance/trial.mjs';
import { makeCatalogue, prepareFixtures, pickerId, clock } from './owned-acceptance/fixture.mjs';
if (typeof globalThis.__everydayEvent !== 'function') throw Error('Preload scripts/perf/everyday-latency/trace.mjs.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 20) throw Error('Use Node 24.20+ within 24.x.');
setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw Error('--out is required; choose a fresh output directory.');
const output = path.resolve(values.out);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'started.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version }), { flag: 'wx' });
const root = await mkdtemp(path.join(output, 'synthetic-'));
const shape = { groups: 3, tasks: 24000, aliases: 100000, members: 4, history: 4, archiveSegments: 1, archiveEvents: 1, chunks: 256 };
const data = makeCatalogue(shape, { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest });
const registry = createRuleRegistry(), fixture = await prepareFixtures({ root, mode: 'format2', shape, data, registry });
let label = 'setup', active;
const events = [], records = [], sends = [], stores = [], completions = [];
globalThis.__everydayTrace = (phase, directory, details) => {
  const row = { label, phase, group: path.basename(directory), at: performance.now(), ...details };
  events.push(row);
};
let pauseGroup, pauseReached, resume;
const pause = () => new Promise(resolve => { resume = resolve; });
for (const group of fixture.groups.slice(0, 5)) stores.push(await openStore({ dataDir: group.directory, world: data.world, registry, now: clock,
  completionCodec: false, retention: { backupDays: 90, historyEntries: shape.history },
  ownedFormat2: { ...group.owned, crash: async phase => { if (phase === 'memory-published' && pauseGroup === group.index) { pauseReached(); await pause(); } } } }));
const scheduler = await createTaskScheduler({ maxCalculators: 1, residency: {}, maxRestarts: 0,
  workerFactory: input => {
    const worker = new ProcessWorker(input), post = worker.postMessage.bind(worker);
    worker.postMessage = message => { if (message.id && !['cancel', 'supersede'].includes(message.type)) {
      sends.push({ label, at: performance.now(), type: message.type, pickerId: message.pickerId }); active?.(); active = undefined;
    } return post(message); };
    return worker;
  }, workerData: { definitions: data.definitions, world: { chunks: data.world.chunks, surface: data.world.surface, neighbors: data.world.neighbors },
    datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
    datasetOptions: { reviewedOverlays: false, cacheWalking: false }, skillGuideCatalogue: { skills: [], tasks: [] } } });
async function calculate(index, suffix) {
  const { revision, members, inputKey, stateInput } = calculationInput(stores[index]);
  const start = performance.now();
  const result = await scheduler.forPicker(pickerId(index)).evaluate({ revision, members }, 'member-0', 'evaluate', undefined,
    `${index}-${revision}-${suffix}`, inputKey, undefined, [], 'full', stateInput);
  if (result.error || result.cancelled || !result.result) throw Error('Calculation failed');
  completions.push({ label, kind: 'calculator', at: performance.now(), wallMs: performance.now() - start });
}
async function command(index, kind) {
  const store = stores[index], start = performance.now(), cpu = process.cpuUsage(), eventStart = events.length;
  const tickMember = ['warm', 'serial', 'parallel-no-calculator', 'parallel-with-calculator'].indexOf(label);
  const input = kind === 'tick' ? { type: 'tick-active-tasks', memberId: `member-${tickMember}`, taskIds: [data.base.tasks[index].id, `rs3:goal:acceptance-${index}`] }
    : kind === 'note' ? { type: 'set-note', memberId: 'member-1', chunkId: [...data.world.chunks.keys()][1], note: `Synthetic measured ${index}` }
    : { type: 'undo' };
  const result = await store.commandSerialized(input, store.getInfo().revision, { view: 'play-v1' });
  const end = performance.now(), used = process.cpuUsage(cpu);
  records.push({ label, index, kind, start, end, wallMs: end - start, cpuMs: (used.user + used.system) / 1000,
    events: events.slice(eventStart).filter(e => e.group === `synthetic-${index}`), revision: result.revision });
}
async function everyday(index) { for (const kind of ['tick', 'note', 'undo']) await command(index, kind); }
const inspector = new Session(); inspector.connect();
const post = (method, params = {}) => new Promise((resolve, reject) => inspector.post(method, params, (e, result) => e ? reject(e) : resolve(result)));
try {
  label = 'warm'; await calculate(4, 'warm');
  for (let i = 0; i < 3; i++) await everyday(i);
  label = 'serial';
  await post('Profiler.enable'); await post('Profiler.start');
  for (let i = 0; i < 3; i++) await everyday(i);
  const { profile } = await post('Profiler.stop'); await writeFile(path.join(output, 'main.cpuprofile'), JSON.stringify(profile));
  label = 'parallel-no-calculator'; await Promise.all([0, 1, 2].map(everyday));
  label = 'parallel-with-calculator';
  const started = new Promise(resolve => { active = resolve; });
  const heavy = calculate(3, 'heavy'); await started;
  await Promise.all([0, 1, 2].map(everyday));
  const commandsFinished = performance.now(); await heavy;
  label = 'paused-after-publication'; pauseGroup = 0;
  const paused = new Promise(resolve => { pauseReached = resolve; });
  const first = command(0, 'note'); await paused;
  const secondRevision = stores[1].getInfo().revision;
  const second = command(1, 'note'); await second;
  const proof = { firstRevisionAlreadyPublished: stores[0].getInfo().revision,
    secondEnteredWhileFirstPaused: events.some(e => e.label === label && e.group === 'synthetic-1' && e.phase === 'lease-enter'),
    secondRevisionBeforeRelease: stores[1].getInfo().revision, calculatorSendsDuringPause: sends.filter(e => e.label === label).length };
  resume(); await Promise.all([first, second]); pauseGroup = undefined;
  // Causal checks only. Wall/CPU measurements above are observations, never gates.
  assert.equal(proof.secondEnteredWhileFirstPaused, true);
  assert.equal(proof.secondRevisionBeforeRelease, secondRevision + 1);
  assert.equal(proof.calculatorSendsDuringPause, 0);
  assert.equal(stores[1].getInfo().revision, proof.secondRevisionBeforeRelease);
  assert.deepEqual(sends.map(row => row.type), ['evaluate', 'evaluate']);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ node: process.version, shape, root, proof, commandsFinished,
    completions, sends, records, events, scheduler: scheduler.getDiagnostics() }, null, 2), { flag: 'wx' });
  for (const label of ['serial', 'parallel-no-calculator', 'parallel-with-calculator']) console.log(JSON.stringify({ label,
    rows: records.filter(r => r.label === label).map(r => ({ index: r.index, kind: r.kind, wallMs: r.wallMs,
      leaseWaitMs: r.events.find(e => e.phase === 'lease-enter').at - r.events.find(e => e.phase === 'lease-request').at,
      publicationMs: r.events.find(e => e.phase === 'durable').at - r.events.find(e => e.phase === 'command-start').at,
      replyMs: r.end - r.events.find(e => e.phase === 'memory-published').at })) }));
  console.log(JSON.stringify({ proof, completions }));
} finally {
  resume?.(); inspector.disconnect();
  await scheduler.close(); for (const store of stores) await store.close();
  delete globalThis.__everydayTrace;
}
