import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Calculator } from './client.mjs';
import { packValue, unpackValue } from './values.mjs';
import { parseShard, partitionCorpus, mergeReportFiles } from './shards.mjs';
import { buildCorpus, randomFor, sample } from './corpus.mjs';
import { comparable, compareValues, hash, volatile } from './compare.mjs';

export const referenceCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(fileURLToPath(new URL('../../calculator/reference/main.mjs', import.meta.url)))}`;
const types = ['evaluate', 'predict', 'death-estimates', 'chunk-planning', 'sandbox', 'area-check', 'roll-pool', 'prepare-rules'];
export const defaultCaps = { evaluate: 2, predict: 4, 'death-estimates': 8, 'chunk-planning': 2, sandbox: 1, 'area-check': 1, 'roll-pool': 2, 'prepare-rules': 1 };
function summary(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return { count: sorted.length, median: sorted.length ? (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.ceil((sorted.length-1)/2)]) / 2 : 0,
    min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 };
}
export async function check({ reference = referenceCommand, candidate = referenceCommand, corpus: spec = { generated: { steps: 4 }, fixtures: {} }, seed = 1,
  caps = {}, shard = '1/1', serial = false, onProgress, sequence = 8, timeoutMs = 180000, reportFile } = {}) {
  const began = performance.now(), limits = { ...defaultCaps, ...caps }, random = randomFor(seed);
  const selectedShard = parseShard(shard);
  const activeTypes = types.filter(type => limits[type] > 0);
  const report = { format: 'calc-check-shard-report-v1', shard: selectedShard, stateIds: [], checkConfiguration: { caps: limits, sequence, serial }, seed, corpusManifestHash: null, corpus: { states: 0, generated: 0, fixtures: 0, save: 0, bundles: 0 },
    engineVersions: { reference: [], candidate: [] }, requests: Object.fromEntries(types.map(type => [type, 0])),
    sentRequests: { reference: {}, candidate: {} }, sequenceRequests: 0, controls: { cancel: 0, supersede: 0 }, cancelledReruns: 0, snapshotResends: 0,
    differences: [], differenceCount: 0, errors: 0, volatile, peakRSSBytes: { reference: 0, candidate: 0 },
    durationsMs: { corpus: 0, snapshotLoading: 0, total: 0 }, requestDurationsMs: {}, supported: { reference: [], candidate: [] } };
  const durations = { reference: Object.fromEntries(types.map(t => [t, []])), candidate: Object.fromEntries(types.map(t => [t, []])) };
  let corpus;
  async function loadEntry(entry) {
    const start = performance.now();
    try { return entry.load ? await entry.load() : entry.state; }
    finally { report.durationsMs.snapshotLoading += performance.now() - start; }
  }
  try {
    corpus = await buildCorpus(spec, seed);
    report.corpusManifestHash = corpus.manifestHash;
    report.corpusManifest = corpus.manifest;
    const fullGroups = corpus.groups;
    corpus.groups = partitionCorpus(corpus, selectedShard);
    report.coverage = corpus.coverage;
    report.durationsMs.corpus = performance.now() - began;
    report.corpus.bundles = corpus.groups.length;
    for (const group of corpus.groups) for (const entry of group.states) { report.corpus.states++; report.corpus[entry.source]++; }
    const runGroups = serial ? corpus.groups.flatMap(group => {
      const taskCount = Object.values(group.bundle.definitions.challenges ?? {}).reduce((n, rows) => n + Object.keys(rows).length, 0);
      const batchSize = group.states.some(s => s.source === 'save') || taskCount > 2000 ? 2 : 16;
      const batches = [];
      for (let i = 0; i < group.states.length; i += batchSize) batches.push({ ...group, states: group.states.slice(i, i + batchSize) });
      return batches;
    }) : corpus.groups;
    if (!runGroups.length) runGroups.push({ ...fullGroups[0], states: [] });
    report.calculatorBatches = runGroups.length;
    onProgress?.({ states: report.corpus.states, batches: runGroups.length, durationMs: performance.now() - began });
    for (let groupIndex = 0; groupIndex < runGroups.length; groupIndex++) {
      const group = runGroups[groupIndex];
      const calculators = serial ? await (await import('./serial.mjs')).sequentialPair(reference, candidate, { timeoutMs }, ready => {
        if (ready.header.datasetDigest !== group.bundle.datasetDigest || activeTypes.some(type => !ready.header.supports?.includes(type))) throw new Error('unsupported');
        if (!report.engineVersions.candidate.some(v => JSON.stringify(v) === JSON.stringify(ready.header.engine))) report.engineVersions.candidate.push(ready.header.engine);
        report.supported.candidate = ready.header.supports;
      }, (operation, diff) => {
        report.differences.push(...diff.map(d => ({ requestType: operation.header.type, memberSlot: operation.header.memberId === undefined ? null : operation.header.memberIds.indexOf(operation.header.memberId), phase: 'candidate-replay', ...d })));
      }) : [new Calculator(reference, { timeoutMs }), new Calculator(candidate, { timeoutMs })];
      const slots = ['reference', 'candidate'];
      try {
        const ready = await Promise.all(calculators.map(c => c.init(group.bundle)));
        for (let index = 0; index < 2; index++) {
          const side = slots[index], header = ready[index].header;
          if (calculators[index].isReplayPeer) continue;
          if (header.datasetDigest !== group.bundle.datasetDigest) throw new Error('failed');
          if (!report.engineVersions[side].some(v => JSON.stringify(v) === JSON.stringify(header.engine))) report.engineVersions[side].push(header.engine);
          report.supported[side] = header.supports;
          if (activeTypes.some(type => !header.supports?.includes(type))) throw new Error('unsupported');
        }
        const retained = [], preparedRules = new Set(), sent = calculators.map(() => new Map());
        let observed = 0;
        async function dispatch(c, side, descriptor, state, ref = false) {
          const cache = sent[side === 'reference' ? 0 : 1];
          const key = JSON.stringify([descriptor.header.pickerId, descriptor.header.input]);
          const useRef = ref || cache.has(key);
          const header = { ...descriptor.header, state: useRef ? 'ref' : 'body' };
          cache.delete(key); cache.set(key, true);
          while (cache.size > 2) cache.delete(cache.keys().next().value);
          let began = performance.now();
          let reply = await c.request(header, useRef ? undefined : state).promise;
          if (reply.header.error?.kind === 'snapshot-missing') {
            report.snapshotResends++;
            reply = await c.request({ ...header, state: 'body' }, state).promise;
          }
          if (reply.header.cancelled || Object.values(reply.parts).some(part => part?.cancelled)) {
            report.cancelledReruns++;
            reply = await c.request({ ...header, state: 'body' }, state).promise;
            if (reply.header.cancelled || Object.values(reply.parts).some(part => part?.cancelled)) throw new Error('failed');
          }
          if (!serial) durations[side][header.type].push(performance.now() - began);
          return reply;
        }
        function compare(a, b, descriptor, phase) {
          const diff = compareValues(Buffer.isBuffer(a) ? unpackValue(a) : a, Buffer.isBuffer(b) ? unpackValue(b) : b);
          report.differences.push(...diff.map(d => ({ requestType: descriptor.header.type, memberSlot: descriptor.memberSlot, phase, ...d })));
        }
        async function run(descriptor, state, ref = false, baseline) {
          report.requests[descriptor.header.type]++;
          if (ref) report.sequenceRequests++;
          const replies = await Promise.all(calculators.map((c,i) => dispatch(c, slots[i], descriptor, state, ref)));
          const left = comparable(replies[0]);
          const values = [left, serial ? left : comparable(replies[1])];
          compare(...values, descriptor, ref ? 'sequence-pair' : 'cold');
          if (baseline) { compare(baseline, values[0], descriptor, 'reference-sequence'); if (!serial) compare(baseline, values[1], descriptor, 'candidate-sequence'); }
          else if (sequence > 0) {
            // Reservoir sampling bounds retained outputs even for large saves.
            const entry = () => ({ descriptor, baseline: packValue(values[0]) });
            const sameType = retained.findIndex(e => e.descriptor.header.type === descriptor.header.type);
            observed++;
            if (sameType >= 0) { if (random() < 0.2) retained[sameType] = entry(); }
            else if (retained.length < sequence) retained.push(entry());
          }
          return replies[0];
        }
        for (let stateIndex = 0; stateIndex < group.states.length; stateIndex++) {
          const entry = group.states[stateIndex], state = await loadEntry(entry);
          const pickerId = 'legacy-shared';
          function descriptor(type, memberSlot, fields = {}) {
            return { entry, memberSlot, header: { type, pickerId, revision: state.revision, input: entry.digest,
              snapshotKey: JSON.stringify([state.revision, entry.digest]), memberIds: state.members.map(m => m.id),
              ...(memberSlot === null ? {} : { memberId: state.members[memberSlot].id }), ...fields } };
          }
          const ruleKey = hash(JSON.stringify(state.rules));
          if (limits['prepare-rules'] && !preparedRules.has(ruleKey)) { await run(descriptor('prepare-rules', null), state); preparedRules.add(ruleKey); }
          for (let memberSlot = 0; memberSlot < state.members.length; memberSlot++) {
            const member = state.members[memberSlot];
            let pool;
            if (limits['roll-pool']) pool = (await run(descriptor('roll-pool', memberSlot), state)).parts.pool;
            // Candidate choice is oracle-owned, so candidates receive the same
            // sequence even when their pool is deliberately wrong.
            pool ??= { eligible: [] };
            const candidates = sample((pool?.eligible ?? []).map(row => row.id), Infinity, random);
            const chunkIds = sample([...group.world.chunks.keys()], Math.max(limits['chunk-planning'], 1), random);
            for (const view of ['play-v1', 'full'].slice(0, limits.evaluate)) await run(descriptor('evaluate', memberSlot, { view, projections: ['duo', 'duo-sidebar'] }), state);
            for (const chunkId of candidates.slice(0, limits.predict)) await run(descriptor('predict', memberSlot, { chunkId }), state);
            if (limits['death-estimates']) await run(descriptor('death-estimates', memberSlot, { chunkIds: candidates.slice(0, limits['death-estimates']) }), state);
            for (const chunkId of chunkIds.slice(0, limits['chunk-planning'])) await run(descriptor('chunk-planning', memberSlot, { chunkId }), state);
            const future = sample([...group.world.surface ?? group.world.chunks.keys()].filter(id => !member.unlocked.includes(id)), 1, random);
            const draft = { changes: { unlockChunks: future, lockChunks: sample(member.unlocked, Math.min(member.unlocked.length, 1), random),
              doneTasks: sample(state.tasks.map(task => task.id), Math.min(state.tasks.length, 1), random) } };
            for (let n = 0; n < limits.sandbox; n++) await run(descriptor('sandbox', memberSlot, { draft }), state);
            for (let n = 0; n < limits['area-check']; n++) await run(descriptor('area-check', memberSlot, { draft: { chunkIds: future, asMembers: random() < 0.5 } }), state);
            for (let n = 1; n < limits['roll-pool']; n++) await run(descriptor('roll-pool', memberSlot, { draft }), state);
          }
          report.stateIds.push(entry.id);
        }
        // An unrelated picker's high revision must never abandon this work.
        // Reuse the selected body, then replay in shuffled order through refs.
        for (const entry of sample(retained, retained.length, random)) {
          const { descriptor: d, baseline } = entry;
          const state = await loadEntry(d.entry);
          for (const c of calculators) {
            await c.control({ type: 'supersede', pickerId: 'p_ffffffffffffffffffffffffffffffff', revision: Number.MAX_SAFE_INTEGER }); report.controls.supersede++;
            // A prepare-rules body primes the state LRU without warming views.
            const prime = { ...d.header, type: 'prepare-rules', state: 'body' };
            await c.request(prime, state).promise;
          }
          await run(d, state, true, baseline);
        }
        // Cooperative cancellation is exercised separately; its completion is
        // intentionally not compared, and the same request is rerun normally.
        const chosen = retained.find(e => e.descriptor.header.type === 'death-estimates' || e.descriptor.header.type === 'predict');
        if (chosen) {
          const d = chosen.descriptor, state = await loadEntry(d.entry);
          for (const c of calculators) {
            const pending = c.request({ ...d.header, state: 'body' }, state);
            await c.control({ type: 'cancel', id: pending.id }); report.controls.cancel++;
            await pending.promise;
          }
          await run(d, state, false, chosen.baseline);
        }
      } finally {
        await Promise.all(calculators.map(c => c.close()));
        for (let i = 0; i < calculators.length; i++) {
          report.snapshotResends += calculators[i].snapshotResends ?? 0;
          report.cancelledReruns += calculators[i].cancelledReruns ?? 0;
          if (calculators[i].replayDurations) for (const [type, times] of Object.entries(calculators[i].replayDurations)) durations[slots[i]][type].push(...times);
          report.peakRSSBytes[slots[i]] = Math.max(report.peakRSSBytes[slots[i]], calculators[i].peakRSSBytes);
          for (const [type, count] of Object.entries(calculators[i].sentRequests)) report.sentRequests[slots[i]][type] = (report.sentRequests[slots[i]][type] ?? 0) + count;
        }
      }
      onProgress?.({ completedBatches: groupIndex + 1, requests: Object.values(report.requests).reduce((a,b) => a+b,0), differences: report.differences.length, durationMs: performance.now() - began });
    }
  } catch (error) {
    report.errors++;
    report.errorKind = ['fixture-capture-failed', 'unsupported'].includes(error.message) ? error.message : error instanceof TypeError ? 'invalid' : 'failed';
  } finally {
    await corpus?.close?.();
    report.differenceCount = report.differences.length;
    report.durationsMs.total = performance.now() - began;
    for (const side of ['reference', 'candidate']) report.requestDurationsMs[side] = Object.fromEntries(types.map(t => [t, summary(durations[side][t])]));
    if (reportFile) await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
export async function cli(args = process.argv.slice(2)) {
  if (args[0] === '--merge-reports') {
    if (args.length < 2 || args.slice(1).some(value => value.startsWith('--'))) throw new TypeError('invalid');
    const merged = await mergeReportFiles(args.slice(1));
    console.log(JSON.stringify(merged));
    if (merged.differences || merged.errors) process.exitCode = 1;
    return merged;
  }
  if (args.includes('--help')) { console.log('calc-check --reference <cmd> --candidate <cmd> --corpus <JSON-file|fixtures,generated,save> --seed N --report <file> [--data-dir <copied-save>] [--cap-<request-type> N] [--sequence N] [--timeout-ms N] [--shard i/n] | calc-check --merge-reports <files...>'); return; }
  const options = {}, caps = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i+1];
    if (!key.startsWith('--') || value === undefined) throw new TypeError('invalid');
    if (key.startsWith('--cap-') && types.includes(key.slice(6))) caps[key.slice(6)] = integer(value);
    else if (['--reference','--candidate','--corpus','--report','--seed','--data-dir','--sequence','--timeout-ms','--serial','--shard'].includes(key)) options[key.slice(2)] = value;
    else throw new TypeError('invalid');
  }
  if (!options.reference || !options.candidate || !options.corpus || !options.report) throw new TypeError('invalid');
  let corpus;
  if (/^(?:fixtures|generated|save)(?:,(?:fixtures|generated|save))*$/.test(options.corpus)) corpus = Object.fromEntries(options.corpus.split(',').map(source => [source, source === 'save' ? { dataDir: options['data-dir'] } : {}]));
  else corpus = JSON.parse(await readFile(options.corpus, 'utf8'));
  if (options['data-dir']) corpus.save = { ...corpus.save, dataDir: options['data-dir'] };
  if (corpus.save?.gameDefaultsFile) process.env.RS3_GAME_DEFAULTS_FILE = corpus.save.gameDefaultsFile;
  let lastProgress = 0;
  const report = await check({ onProgress: progress => { if (performance.now() - lastProgress >= 10000) { console.log(JSON.stringify(progress)); lastProgress = performance.now(); } }, reference: options.reference, candidate: options.candidate, corpus, seed: integer(options.seed ?? '1'), caps,
    shard: options.shard ?? '1/1', serial: options.serial === 'true', sequence: integer(options.sequence ?? '8'), timeoutMs: integer(options['timeout-ms'] ?? '180000'), reportFile: options.report });
  console.log(JSON.stringify({ states: report.corpus.states, requests: report.requests, differences: report.differenceCount, errors: report.errors, durationMs: report.durationsMs.total, peakRSSBytes: report.peakRSSBytes }));
  if (report.differenceCount || report.errors) process.exitCode = 1;
}
function integer(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('invalid'); return n; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli().catch(() => { console.error('invalid'); process.exitCode = 1; });
