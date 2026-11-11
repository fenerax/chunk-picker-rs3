import path from 'node:path';
import { readFile, readdir, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { totals, ioDelta, measuredTimes, decision } from './metrics.mjs';
import { digest } from '../capacity/model.mjs';
import { calculatorEvidence } from './lifecycle.mjs';
import { deferredTaskInput } from '../../../app/tasks/deferred-input.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const probeURL = new URL('./probe.mjs', import.meta.url).href;

export function calculationInput(store) {
  const capture = store.getCalculationSnapshot(), inputKey = capture.taskInputKey;
  return { revision: capture.revision, members: capture.members, inputKey,
    stateInput: deferredTaskInput(store, inputKey) };
}

export async function trial({ root, mode, shape, rounds, smoke, snapshots = false, signal, forkProcess }) {
  signal.throwIfAborted();
  if (!smoke && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Full measurement requires hosted CI.');
  process.env.RS3_ACCEPTANCE_CONTROLLER_PID = String(process.pid);
  // Environment is cleared by the fresh-process launcher before any app import.
  const [{ selectedDataset }, { createRuleRegistry }, { openStore }, { createTaskScheduler }, { ProcessWorker },
    { makeCatalogue, prepareFixtures, pickerId, clock }, { withIdentityDictionaryCallCountsForTests }, { buildIdentityIndex },
    { createResponseCache, createRepresentation }] = await Promise.all([
    import('../../../app/dataset-runtime.mjs'), import('../../../app/core/rules.mjs'), import('../../../app/storage/store.mjs'),
    import('../../../app/tasks/scheduler.mjs'), import('../../../app/tasks/process-worker.mjs'), import('./fixture.mjs'),
    import('../../../app/tasks/identity-dictionary.mjs'), import('../../../app/tasks/identity.mjs'), import('../../../app/http-response.mjs')]);
  const probe = globalThis[Symbol.for('rs3.acceptance.probe')];
  if (!probe) throw new Error('Acceptance probe preload is required.');
  const directory = process.env.RS3_ACCEPTANCE_PROBE_DIR;
  let sequence = 0, lastCompletedBarrier = 0, stage = 'fixture-setup', scheduler;
  const workers = [], handles = [], releases = [], records = [], errors = [];
  const context = () => ({ stage, barrier: sequence, lastCompletedBarrier });
  const evidence = calculatorEvidence({ context, diagnostics: () => scheduler?.getDiagnostics() });
  // Named root helps DevTools dominator/retainer inspection of optional snapshots.
  globalThis.__ownedAcceptanceHandles = handles;
  async function rows() {
    const receipts = path.join(directory, 'checkpoints', String(sequence));
    const files = (await readdir(receipts)).filter(file => /^\d+-\d+\.json$/.test(file));
    return (await Promise.all(files.map(async file => JSON.parse(await readFile(path.join(receipts, file), 'utf8')))))
      .filter(row => row.pid === process.pid ? row.threadId === 0 : workers.some(worker => worker.pid === row.pid));
  }
  async function checkpoint({ gc = true, snapshot = false, resetPeaks = false } = {}) {
    signal.throwIfAborted();
    const request = { sequence: ++sequence, gc, snapshot, resetPeaks };
    await mkdir(path.join(directory, 'checkpoints', String(sequence)), { recursive: true });
    await appendFile(path.join(directory, 'control.jsonl'), JSON.stringify(request) + '\n');
    await probe.collect(request);
    const end = Date.now() + 30000;
    while (true) {
      signal.throwIfAborted();
      if (evidence.hasExited) throw new Error('Calculator retired during measurement; refusing incomplete residency evidence.');
      const failed = (await readdir(directory)).filter(file => /^\d+-\d+\.error$/.test(file));
      if (failed.length) throw new Error(`Isolate probe publication failed: ${await readFile(path.join(directory, failed[0]), 'utf8')}`);
      const samples = await rows();
      const complete = workers.every(worker => samples.some(row => row.pid === worker.pid && row.threadId === 0)
        && samples.some(row => row.pid === worker.pid && row.threadId !== 0));
      if (complete && samples.every(row => row.sequence === sequence)) {
        lastCompletedBarrier = sequence;
        return { total: totals(samples), isolates: samples };
      }
      if (Date.now() >= end) throw new Error(`Incomplete isolate measurement at barrier ${sequence}: ${samples.map(row => `${row.pid}/${row.threadId}=${row.sequence}`).join(', ')}; refusing partial heap accounting.`);
      await pause(10);
    }
  }
  const childCPU = checkpoint => checkpoint.isolates.filter(row => row.pid !== process.pid && row.threadId === 0)
    .reduce((sum, row) => sum + row.cpu.user + row.cpu.system, 0);
  async function timed(kind, index, work, { concurrent = false, record = true } = {}) {
    signal.throwIfAborted();
    const before = concurrent ? undefined : await checkpoint({ gc: false });
    const cpu = process.cpuUsage(), started = performance.now();
    let error;
    try { await work(); } catch (cause) {
      error = { kind, index, code: cause.code ?? cause.status ?? cause.name, message: cause.message };
      errors.push(error);
    }
    const wallMs = performance.now() - started, used = process.cpuUsage(cpu);
    const after = concurrent ? undefined : await checkpoint({ gc: false });
    const row = { kind, index, wallMs, mainCpuMs: concurrent ? null : (used.user + used.system) / 1000,
      childCpuMs: concurrent ? null : Math.max(0, childCPU(after) - childCPU(before)) / 1000, ...(error ? { error } : {}) };
    row.cpuMs = concurrent ? null : row.mainCpuMs + row.childCpuMs;
    if (record) records.push(row);
    return row;
  }
  const dataset = { id: selectedDataset.datasetId, contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest };
  const registry = createRuleRegistry(), beforeShared = await checkpoint();
  const data = makeCatalogue(shape, dataset);
  const setupBefore = probe.record().io;
  let publicationBefore;
  const fixture = await prepareFixtures({ root, mode, shape, data, registry,
    onPublished: () => { publicationBefore = probe.record().io; } });
  const setupIO = ioDelta(setupBefore, probe.record().io);
  const options = group => ({ dataDir: group.directory, world: data.world, registry, now: clock,
    completionCodec: false, ownedFormat2: group.owned, retention: { backupDays: 90, historyEntries: shape.history } });
  const responseCache = () => createResponseCache({ maxEntries: 32, maxBytes: 48 * 1024 * 1024 });
  async function stateResponse(handle, view) {
    // Same envelope and cache limits as picker-context stateRepresentation.
    // Exercise full wire bytes/encodings without starting an HTTP server.
    const info = handle.store.getInfo(), key = `state:${info.revision}:${view ?? 'full'}`;
    let representation = handle.responses.get(key);
    if (!representation) {
      const saved = await handle.store.getStateSnapshot({ view });
      representation = handle.responses.set(key, createRepresentation(Buffer.from(`{"state":${saved.stateJSON},"pools":${JSON.stringify(saved.pools)},"store":${JSON.stringify(info)}${view ? ',"format":"play-v1","schemaVersion":1' : ''}}`)));
    }
    await representation.encoded('gzip');
    probe.record();
  }
  async function calculate(handle, memberIndex = 0, suffix = '') {
    const { revision, members, inputKey, stateInput } = calculationInput(handle.store);
    const response = await handle.lane.evaluate({ revision, members }, `member-${memberIndex}`,
      'evaluate', undefined, `${handle.id}-${revision}-${memberIndex}${suffix}`, inputKey, undefined, [], 'full', stateInput);
    if (response.cancelled || response.error) throw new Error('Calculator failed or cancelled.');
    // Access the ordinary result graph as well as shared bytes, then release our
    // reference. The application's bounded result/snapshot caches stay intact.
    if (!response.result) throw new Error('Missing calculator result.');
  }
  async function exercise(handle, index, concurrent = false) {
    const command = (kind, input) => timed(kind, index, () => handle.store.commandSerialized(input,
      handle.store.getInfo().revision, { view: 'play-v1' }), { concurrent });
    await command('tick', { type: 'tick-active-tasks', memberId: concurrent ? 'member-2' : 'member-0',
      taskIds: [data.base.tasks[index % shape.tasks].id, `rs3:goal:acceptance-${index}`] });
    await command('note', { type: 'set-note', memberId: 'member-1', chunkId: [...data.world.chunks.keys()][1], note: `Synthetic measured ${index}` });
    await command('undo', { type: 'undo' });
    await timed('calculator', index, () => calculate(handle, index % shape.members), { concurrent });
    await timed('full-response', index, () => stateResponse(handle), { concurrent });
    await timed('play-and-claims', index, async () => {
      await stateResponse(handle, 'play-v1'); handle.store.getTaskClaimState();
      const state = handle.store.getCalculationState(), id = data.base.tasks[index % shape.tasks].id;
      buildIdentityIndex(state.tasks, { savedRegistry: state.identityRegistry, lookupIds: new Set([id]) }).lookup(id);
    }, { concurrent });
  }
  let warm;
  try {
    stage = 'scheduler-startup';
    scheduler = await createTaskScheduler({ maxCalculators: 1, residency: {}, maxRestarts: 0,
      onCalculatorLifecycle: evidence.onLifecycle,
      workerFactory: input => {
        const worker = new ProcessWorker(input, { probeImport: probeURL, forkProcess });
        workers.push(worker); evidence.onWorker(worker); return worker;
      },
      workerData: { definitions: data.definitions, world: { chunks: data.world.chunks, surface: data.world.surface, neighbors: data.world.neighbors },
        datasetSelection: selectedDataset.workerSelection(), datasetDigest: selectedDataset.digest,
        datasetOptions: { reviewedOverlays: false, cacheWalking: false }, skillGuideCatalogue: { skills: [], tasks: [] } } });
    stage = 'warmup';
    const warmGroup = fixture.groups[shape.groups];
    warm = { id: pickerId(warmGroup.index), store: await openStore(options(warmGroup)), lane: scheduler.forPicker(pickerId(warmGroup.index)), responses: responseCache() };
    // Populate all ordinary lazy indexes/transport paths before charging groups.
    await exercise(warm, warmGroup.index);
    warm.lane.cancelPicker(); await warm.store.close(); warm = undefined;
    records.length = 0;
    if (errors.length) throw new Error('Warmup failed; cannot establish shared baseline.');
    stage = 'shared-baseline';
    const baseline = await checkpoint({ snapshot: snapshots, resetPeaks: true });
    if (process.env.RS3_ACCEPTANCE_NOTIFY_READY === '1')
      process.send?.({ kind: 'acceptance-ready', children: workers.map(worker => worker.pid) });
    const measuredBefore = probe.record().io, openSamples = [], groups = [], commandSamples = [];
    const readyStarted = performance.now();
    stage = 'open-groups';
    for (let index = 0; index < shape.groups; index++) {
      let handle;
      await timed('open', index, async () => {
        const store = await openStore(options(fixture.groups[index])), id = pickerId(index);
        handle = { id, store, lane: scheduler.forPicker(id), sessions: [], responses: responseCache() }; handles.push(handle);
        for (let member = 0; member < shape.members; member++) {
          const clientId = `00000000-0000-4000-8000-${(index * 4 + member + 1).toString(16).padStart(12, '0')}`;
          handle.sessions.push(await store.openActionSession(clientId));
          releases.push(handle.lane.openSession());
        }
      });
      if (!handle) throw new Error('Group open failed.');
      const sample = { count: handles.length, ...await checkpoint({ snapshot: snapshots && (index === 0 || index === shape.groups - 1) }) };
      const previous = openSamples.at(-1) ?? baseline;
      groups.push({ index, openBytes: sample.total.heapUsed - previous.total.heapUsed, commandBytes: 0,
        openExternalBytes: sample.total.external - previous.total.external,
        openArrayBufferBytes: sample.total.arrayBuffers - previous.total.arrayBuffers });
      openSamples.push(sample);
    }
    const allGroupsReadyWallMs = performance.now() - readyStarted;
    let previous = openSamples.at(-1);
    let copyCounts;
    stage = 'serial-commands';
    await withIdentityDictionaryCallCountsForTests(async counts => {
      for (const [index, handle] of handles.entries()) {
        await exercise(handle, index);
        const sample = { count: index + 1, ...await checkpoint() };
        groups[index].commandBytes = sample.total.heapUsed - previous.total.heapUsed;
        groups[index].commandExternalBytes = sample.total.external - previous.total.external;
        groups[index].commandArrayBufferBytes = sample.total.arrayBuffers - previous.total.arrayBuffers;
        previous = sample; commandSamples.push(sample);
      }
      copyCounts = { ...counts };
    });
    // Every store/session is retained while all 50 request streams overlap.
    // Keep queue/deadline/cache limits unchanged; record refusals, never retry.
    stage = 'simultaneous-batch';
    const simultaneous = await timed('simultaneous-batch', -1,
      () => Promise.all(handles.map((handle, index) => exercise(handle, index, true))));
    stage = 'settled';
    const settled = await checkpoint();
    // First read-only round saturates caches; following four rounds use exactly
    // the same keys and no History writes, so monotonic growth is actionable.
    for (let round = 0; round < rounds; round++) {
      stage = `read-only-repeat-${round}`;
      const roundTimes = [];
      for (const [index, handle] of handles.entries()) roundTimes.push(await timed('read-only-repeat', index, async () => {
        await calculate(handle, index % shape.members); await stateResponse(handle);
      }, { record: false }));
      // Persist outside the measured store root and release receipts between
      // rounds. Growing arrays of harness receipts must not masquerade as a
      // growing application cache in the strict monotonic-growth rejection.
      await writeFile(path.join(directory, `repeat-times-${round}.json`), JSON.stringify(roundTimes));
      roundTimes.length = 0;
      await writeFile(path.join(directory, `repeat-${round}.json`), JSON.stringify({ round, ...await checkpoint() }));
    }
    // New revisions exercise mutation-keyed caches as well as the read-only
    // working set above. Undo restores the tick and note, preventing unbounded
    // task-status/note data from being confused with a revision-cache leak.
    const mutationHistoryBaseline = handles.map((handle, index) => ({ index, ...handle.store.getInfo().retention }));
    for (let round = 0; round < rounds; round++) {
      stage = `mutation-repeat-${round}`;
      const roundTimes = [], history = [];
      for (const [index, handle] of handles.entries()) {
        const before = handle.store.getInfo();
        const command = async (kind, input) => roundTimes.push(await timed(kind, index,
          () => handle.store.commandSerialized(input, handle.store.getInfo().revision, { view: 'play-v1' }), { record: false }));
        await command('tick', { type: 'tick-active-tasks', memberId: 'member-3', taskIds: [data.base.tasks[index % shape.tasks].id] });
        await command('undo', { type: 'undo' });
        await command('note', { type: 'set-note', memberId: 'member-1', chunkId: [...data.world.chunks.keys()][1], note: `Synthetic repeat ${index}` });
        await command('undo', { type: 'undo' });
        roundTimes.push(await timed('mutation-repeat-read', index, async () => {
          await calculate(handle, index % shape.members); await stateResponse(handle); await stateResponse(handle, 'play-v1');
        }, { record: false }));
        const after = handle.store.getInfo();
        // Metadata only: these logical bytes are NOT subtracted from V8 heap.
        // The complete History, inverse guards and archive references stay
        // charged; dominators distinguish their bounded growth from leaks.
        history.push({ index, revisionDelta: after.revision - before.revision,
          activeEvents: after.retention.activeHistoryEntries, archiveSegments: after.retention.historyArchives,
          activeEventDelta: after.retention.activeHistoryEntries - before.retention.activeHistoryEntries,
          archiveSegmentDelta: after.retention.historyArchives - before.retention.historyArchives,
          logicalBytes: Buffer.byteLength(JSON.stringify(handle.store.getHistory())) });
      }
      await writeFile(path.join(directory, `mutation-times-${round}.json`), JSON.stringify(roundTimes));
      await writeFile(path.join(directory, `mutation-history-${round}.json`), JSON.stringify(history));
      roundTimes.length = 0; history.length = 0;
      await writeFile(path.join(directory, `mutation-${round}.json`), JSON.stringify({ round,
        ...await checkpoint({ snapshot: snapshots && (round === 0 || round === rounds - 1) }) }));
    }
    const measuredIO = ioDelta(measuredBefore, probe.record().io);
    const postPublicationIO = ioDelta(publicationBefore, probe.record().io);
    const repeated = await Promise.all(Array.from({ length: rounds }, (_, round) =>
      readFile(path.join(directory, `repeat-${round}.json`), 'utf8').then(JSON.parse)));
    const repeatTimes = await Promise.all(Array.from({ length: rounds }, (_, round) =>
      readFile(path.join(directory, `repeat-times-${round}.json`), 'utf8').then(JSON.parse)));
    const mutations = await Promise.all(Array.from({ length: rounds }, async (_, round) => ({
      ...JSON.parse(await readFile(path.join(directory, `mutation-${round}.json`), 'utf8')),
      history: JSON.parse(await readFile(path.join(directory, `mutation-history-${round}.json`), 'utf8')),
    })));
    const mutationTimes = await Promise.all(Array.from({ length: rounds }, (_, round) =>
      readFile(path.join(directory, `mutation-times-${round}.json`), 'utf8').then(JSON.parse)));
    records.push(...repeatTimes.flat(), ...mutationTimes.flat());
    const result = { mode, smoke, shape, fixtureHashes: fixture.hashes, groups, beforeShared, baseline,
      sharedCharge: { total: baseline.total, allocationSinceImports: ioDelta(beforeShared.total, baseline.total),
        baseCanonicalBytes: data.bytes.length, note: 'All warm main/relay/calculator heaps charged once, including base/index/transport copies; no V8 size estimate subtraction.' },
      setupIO, measuredIO, postPublicationIO, openSamples, checkpoints: openSamples.filter(row => [1, 10, 25, 50].includes(row.count)),
      commandSamples, simultaneous, settled, repeated: repeated.slice(1), readOnlyWarmup: repeated[0], records, errors, copyCounts,
      mutationHistoryBaseline, mutationWarmup: mutations[0], mutationRepeated: mutations.slice(1),
      sessionsRetained: handles.reduce((sum, handle) => sum + handle.sessions.length, 0),
      responseCaches: handles.map((handle, index) => ({ index, entries: handle.responses.size, bytes: handle.responses.bytes })),
      scheduler: scheduler.getDiagnostics(), calculatorLifecycle: evidence.records, schedulerLifecycle: evidence.schedulerEvents,
      allGroupsReadyWallMs, bounded: [] };
    // Capture ordinary measurements before explicit flat/export/stopped lanes.
    result.decision = decision(result);
    for (const kind of ['open', 'tick', 'note', 'undo', 'calculator', 'full-response', 'play-and-claims', 'read-only-repeat', 'mutation-repeat-read']) {
      (result.times ??= {})[kind] = measuredTimes(records.filter(row => row.kind === kind));
    }
    result.speedBar = { gating: false,
      everyday: { targetP95WallMs: 300, measured: measuredTimes(records.filter(row => ['tick', 'note', 'undo'].includes(row.kind))) },
      heavy: { targetWallMs: 3000, measured: result.times.calculator },
      coldOpen: { targetWallMs: 2000, measured: result.times.open },
      restartReady: { targetApproxWallMs: 300000, measuredWallMs: allGroupsReadyWallMs,
        scope: 'warm shared runtime to all stores and sessions open; complete restart/load acceptance remains later' } };
    for (const kind of ['exceptional-order', 'full-hook', 'compatibility-export', 'stopped-rebase']) {
      stage = kind;
      const before = await checkpoint({ resetPeaks: true });
      const priorIsolates = new Set((await readdir(directory)).filter(file => /^\d+-\d+\.jsonl$/.test(file)));
      const ioBefore = probe.record().io;
      let store;
      const time = await timed(kind, -1, async () => {
        if (kind === 'compatibility-export') {
          handles[0].store.getState(); // Explicit flat compatibility snapshot.
          await handles[0].store.exportBackup(); return;
        }
        const group = fixture.groups[shape.groups + (kind === 'exceptional-order' ? 1 : kind === 'full-hook' ? 2 : 3)];
        if (kind === 'stopped-rebase') {
          if (mode === 'format1') return;
          const { bindDatasetStorage } = await import('../../../app/dataset-binding.mjs');
          const { stageOwnedRebase, reconcileOwnedRebase } = await import('../../../app/storage/owned-rebase.mjs');
          await bindDatasetStorage(group.directory, selectedDataset);
          await stageOwnedRebase({ dataDir: group.directory, ownedFormat2: group.owned, target: group.owned, registry });
          await reconcileOwnedRebase({ dataDir: group.directory, ownedFormat2: group.owned, target: group.owned }); return;
        }
        store = await openStore({ ...options(group), ...(kind === 'full-hook' ? { beforeCommit: () => {} } : {}) });
        await store.commandSerialized({ type: 'set-note', memberId: 'member-0', chunkId: [...data.world.chunks.keys()][0], note: kind }, store.getInfo().revision);
      }, { record: false });
      await store?.close();
      store = undefined;
      const after = await checkpoint();
      const transientIsolates = await Promise.all((await readdir(directory))
        .filter(file => /^\d+-\d+\.jsonl$/.test(file) && !priorIsolates.has(file))
        .map(async file => {
          const text = await readFile(path.join(directory, file), 'utf8');
          return JSON.parse(text.slice(0, text.lastIndexOf('\n')).split('\n').at(-1));
        }));
      result.bounded.push({ kind, applicable: kind !== 'stopped-rebase' || mode === 'format2', time, before, after, transientIsolates,
        io: ioDelta(ioBefore, probe.record().io), retainedHeapBytes: after.total.heapUsed - before.total.heapUsed });
    }
    stage = 'post-lanes';
    result.postLanes = await checkpoint({ snapshot: snapshots });
    // Equivalence hashes are an explicit detached-snapshot lane AFTER ordinary
    // measurement; neither format gets to retain these as a group cache.
    stage = 'final-hashes';
    result.finalHashes = [];
    for (const [index, handle] of handles.entries()) {
      const state = handle.store.getState();
      // Retention names contain application entropy. Compare archive CONTENT,
      // as the capacity fixture does, while retaining all logical History.
      for (const reference of state.provenance?.historyArchive ?? [])
        reference.id = digest(await readFile(path.join(fixture.groups[index].directory, 'history', reference.id)));
      result.finalHashes.push(digest(state));
    }
    result.compatibilitySnapshots = { calls: handles.length + 1, includedInOrdinaryBudget: false };
    result.allPostPublicationIO = ioDelta(publicationBefore, probe.record().io);
    if (result.allPostPublicationIO.baseWrites !== 0 && !result.decision.reasons.includes('base-rewritten-after-publication'))
      result.decision.reasons.push('base-rewritten-after-publication');
    if (errors.length && !result.decision.reasons.includes('incomplete-command-workload')) result.decision.reasons.push('incomplete-command-workload');
    if (result.decision.reasons.length && !smoke) { result.decision.status = 'reject'; result.decision.acceptanceClaim = false; }
    return result;
  } catch (error) {
    // Capture before cleanup clears the scheduler and wait for owned process
    // closure in finally, so the attached records also contain late exit codes.
    Object.defineProperty(error, 'trialEvidence', { value: { ...context(),
      calculatorLifecycle: evidence.records, schedulerLifecycle: evidence.schedulerEvents,
      scheduler: scheduler?.getDiagnostics() ?? null, errors, records } });
    throw error;
  } finally {
    evidence.seal(); stage = 'cleanup';
    await warm?.store.close();
    for (const release of releases) release();
    for (const handle of handles) await handle.store.close();
    await scheduler?.close();
    for (const worker of workers) await worker.terminate();
    delete globalThis.__ownedAcceptanceHandles;
  }
}
