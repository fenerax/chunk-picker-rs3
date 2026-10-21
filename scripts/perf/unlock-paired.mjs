import { selectedDataset } from '../../app/dataset-runtime.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, realpath, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCopiedState } from '../research/local-parity-model.mjs';
import { applyCommand } from '../../app/core/state.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { applyEquipmentCorrections } from '../../app/data/equipment-corrections.mjs';
import { applyCacheShops, cacheShopContentsEnabled } from '../../app/data/cache-shops.mjs';
import { cacheResourceContentsEnabled } from '../../app/data/cache-resources.mjs';
import { cacheArchaeologyContentsEnabled } from '../../app/data/cache-archaeology.mjs';
import { projectPlayResult } from '../../app/play-view.mjs';
import { projectDuoPlayResult, projectDuoSidebarResult } from '../../app/duo-play-view.mjs';
import { taskReuseInputKey } from '../../app/tasks/unlock-reuse.mjs';
import { createGameplayFingerprint } from '../../app/storage/gameplay-fingerprint.mjs';
import { migrateOwnedGameplay } from '../../app/tasks/migration.mjs';
import { ROOT, sha, inside, overlap, relative, valueHash, paths, inputFingerprint, appFingerprint,
  instrument, startWorker, currentMigration, chunksFor, selectCases, resultSummary, taskDelta, request, quantiles, aggregate } from './unlock-calc.mjs';

export function pairedOptions(args) {
  const result = { source: null, output: '.local/perf/unlock-paired.json', oldApp: '.local/perf-fixtures/engine-before-395ceb0/app',
    newApp: 'app', oldRevision: '395ceb0', newRevision: 'HEAD', repetitions: 3, chunks: 8, caseStart: 0, caseLimit: null, heapSamples: 'off', views: 'compact' };
  if (args.includes('--help')) return { help: true };
  const names = new Map([['--source', 'source'], ['--output', 'output'], ['--old-app', 'oldApp'], ['--new-app', 'newApp'],
    ['--old-revision', 'oldRevision'], ['--new-revision', 'newRevision'], ['--repetitions', 'repetitions'],
    ['--case-start', 'caseStart'], ['--case-limit', 'caseLimit'], ['--heap-samples', 'heapSamples'], ['--views', 'views']]);
  for (let index = 0; index < args.length; index += 2) {
    const key = names.get(args[index]);
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option ${args[index]}`);
    result[key] = ['repetitions', 'caseStart', 'caseLimit'].includes(key) ? Number(args[index + 1]) : args[index + 1];
  }
  if (!result.source) throw new Error('An explicit frozen copied --source is required.');
  if (!Number.isSafeInteger(result.repetitions) || result.repetitions < 3) throw new Error('--repetitions must be at least 3.');
  if (!Number.isSafeInteger(result.caseStart) || result.caseStart < 0) throw new Error('--case-start must be a nonnegative integer.');
  if (result.caseLimit !== null && (!Number.isSafeInteger(result.caseLimit) || result.caseLimit < 1)) throw new Error('--case-limit must be a positive integer.');
  if (!['on', 'off'].includes(result.heapSamples)) throw new Error('--heap-samples must be on or off.');
  if (!['compact', 'both'].includes(result.views)) throw new Error('--views must be compact or both.');
  return result;
}

// Alternating pair order forms ABBA blocks. Every observation uses a fresh
// worker with the same two-owner compact baseline warmup (full in views=both).
export function pairedSchedule(cases, repetitions) {
  return cases.flatMap(entry => Array.from({ length: repetitions }, (_, repetition) => {
    const order = (entry.caseIndex + repetition) % 2 === 0 ? ['old', 'new'] : ['new', 'old'];
    return order.map((variant, pairPosition) => ({ ...entry, repetition, pairPosition, variant }));
  }).flat());
}

export function semanticSignature(scenario) {
  return { memberId: scenario.memberId, chunkId: scenario.chunkId, afterTaskInputSha256: scenario.afterTaskInputSha256,
    results: scenario.results.map(row => ({ memberId: row.memberId, lane: row.lane, fullSha256: row.fullSha256,
      playSha256: row.playSha256, projections: row.projections, publicCounters: row.publicCounters, before: row.before, after: row.after, delta: row.delta,
      unchangedDuoProjection: row.unchangedDuoProjection, unchangedFullResult: row.unchangedFullResult })) };
}

// Ratios/deltas are calculated within the same case/repetition/owner/lane/view,
// before aggregating. Retain all raw observations alongside these summaries.
export function pairedStatistics(observations) {
  const pairs = new Map();
  for (const observation of observations) {
    const key = `${observation.caseIndex}:${observation.repetition}`;
    const pair = pairs.get(key) ?? {};
    assert(['old', 'new'].includes(observation.variant), `Invalid paired variant ${key}`);
    assert(!pair[observation.variant], `Duplicate paired observation ${key} ${observation.variant}`);
    pair[observation.variant] = observation; pairs.set(key, pair);
  }
  const matched = [];
  for (const [key, pair] of pairs) {
    if (!pair.old || !pair.new) continue;
    assert.equal(pair.old.memberId, pair.new.memberId, `Mismatched owner ${key}`);
    assert.equal(pair.old.chunkId, pair.new.chunkId, `Mismatched chunk ${key}`);
    for (const oldResult of pair.old.results) {
      const newResult = pair.new.results.find(row => row.memberId === oldResult.memberId && row.lane === oldResult.lane);
      assert(newResult, `Missing matched lane ${key}`);
      for (const view of ['compact', 'full']) {
        const oldTiming = oldResult[view], newTiming = newResult[view];
        if (!oldTiming && !newTiming) continue;
        assert(oldTiming && newTiming, `Mismatched views ${key}`);
        const metrics = { evaluationMs: [oldTiming.evaluationMs, newTiming.evaluationMs], roundTripMs: [oldTiming.roundTripMs, newTiming.roundTripMs],
          calculationTransportMs: [oldTiming.compactCalculationTransportMs, newTiming.compactCalculationTransportMs],
          resultDecodeParseMs: [oldTiming.resultDecodeParseMs, newTiming.resultDecodeParseMs],
          ...Object.fromEntries([...new Set([...Object.keys(oldTiming.stages), ...Object.keys(newTiming.stages)])]
            .map(stage => [`stage.${stage}`, [oldTiming.stages[stage] ?? 0, newTiming.stages[stage] ?? 0]])),
          ...Object.fromEntries([...new Set([...Object.keys(oldTiming.instrumentation?.timings ?? {}), ...Object.keys(newTiming.instrumentation?.timings ?? {})])]
            .map(stage => [`inclusive.${stage}`, [oldTiming.instrumentation?.timings?.[stage] ?? 0, newTiming.instrumentation?.timings?.[stage] ?? 0]])) };
        matched.push({ caseIndex: pair.old.caseIndex, repetition: pair.old.repetition, ownerMemberId: pair.old.memberId,
          memberId: oldResult.memberId, lane: oldResult.lane, view,
          metrics: Object.fromEntries(Object.entries(metrics).map(([name, [old, current]]) => [name,
            { old, new: current, deltaMs: current - old, newOverOld: old > 0 ? current / old : null }])) });
      }
    }
  }
  const summaries = [];
  for (const ownerMemberId of [null, ...new Set(matched.map(row => row.ownerMemberId))])
    for (const lane of ['selected', 'partner']) for (const view of ['compact', 'full']) {
      const rows = matched.filter(row => (ownerMemberId === null || row.ownerMemberId === ownerMemberId) && row.lane === lane && row.view === view);
      const metrics = [...new Set(rows.flatMap(row => Object.keys(row.metrics)))];
      summaries.push({ ownerMemberId, lane, view, matchedSamples: rows.length,
        metrics: Object.fromEntries(metrics.map(name => [name, Object.fromEntries(['old', 'new', 'deltaMs', 'newOverOld']
          .map(stat => [stat, quantiles(rows.map(row => row.metrics[name]?.[stat]))]))])) });
    }
  const caseGroups = new Map();
  for (const row of matched) {
    const key = `${row.caseIndex}:${row.ownerMemberId}:${row.memberId}:${row.lane}:${row.view}`;
    const rows = caseGroups.get(key) ?? []; rows.push(row); caseGroups.set(key, rows);
  }
  const perCase = [...caseGroups.values()].map(rows => {
    const first = rows[0];
    return { caseIndex: first.caseIndex, ownerMemberId: first.ownerMemberId, memberId: first.memberId, lane: first.lane, view: first.view,
      matchedRepetitions: rows.length, metrics: Object.fromEntries(Object.keys(first.metrics).map(name => [name, {
        ratios: rows.map(row => ({ repetition: row.repetition, newOverOld: row.metrics[name]?.newOverOld ?? null })),
        newOverOld: quantiles(rows.map(row => row.metrics[name]?.newOverOld)),
        deltaMs: quantiles(rows.map(row => row.metrics[name]?.deltaMs)) }])) };
  });
  const caseMedianSummaries = [];
  for (const ownerMemberId of [null, ...new Set(perCase.map(row => row.ownerMemberId))])
    for (const lane of ['selected', 'partner']) for (const view of ['compact', 'full']) {
      const rows = perCase.filter(row => (ownerMemberId === null || row.ownerMemberId === ownerMemberId) && row.lane === lane && row.view === view);
      const metrics = [...new Set(rows.flatMap(row => Object.keys(row.metrics)))];
      caseMedianSummaries.push({ ownerMemberId, lane, view, cases: rows.length,
        metrics: Object.fromEntries(metrics.map(name => {
          const values = rows.map(row => row.metrics[name]?.newOverOld?.median).filter(Number.isFinite).sort((a, b) => a - b);
          return [name, { ...quantiles(values), p10: values.length ? values[Math.max(0, Math.ceil(values.length * 0.1) - 1)] : null }];
        })) });
    }
  return { matched, summaries, perCase, caseMedianSummaries };
}

async function main() {
  const configuration = pairedOptions(process.argv.slice(2));
  if (configuration.help) {
    console.log('node scripts/perf/unlock-paired.mjs --source .local/speed-save --output .local/perf/unlock-paired.json [--repetitions 3] [--case-start 0 --case-limit 8] [--heap-samples on] [--views compact|both]\nOne parent world/state load; sequential workers, previous terminated before next starts. Three or more interleaved repetitions per case, alternating AB/BA pairs. Every observation has a fresh worker and matching two-owner compact/sidebar baseline warmup. Default measures selected sidebar and peer duo compact results only; both uses full warmup and verifies fresh full unlock results and compact/full equality. No writable store or server.'); return;
  }
  const locations = await paths({ ...configuration, appDir: configuration.oldApp });
  let secondLocations, worker, activeVariant, copiedBefore, rssTimer, workerGeneration = 0, requestsInWorker = 0;
  let peakRSS = process.memoryUsage.rss();
  const report = { format: 'unlock-paired-calculation-v1', createdAt: new Date().toISOString(), node: process.version,
    configuration: { ...configuration, workerCount: 1, warmupView: configuration.views === 'both' ? 'full' : 'play-v1', warmupSelected: true }, complete: false, baselines: [], workers: [], observations: [],
    normalization: 'elapsedMs only; full ordering, public counters, evidence, diagnostics and projections retained',
    notes: ['One parent world build per invocation; old/new workers never overlap. Each replacement worker calculates compact play/sidebar baseline for both owners before measurements (full baseline only in views=both). Warmup selected=true and owner order are identical for both variants.',
      'Alternating AB/BA pairs form ABBA blocks, with case-index-alternating starting variant. Every observation uses a new worker and identical two-owner baseline warmup, including adjacent identical variants.',
      'Each measured compact/full request clears worker result and state caches; compiled definitions stay warm. Selected is measured before partner, compact before full in both variants.',
      'Compact-only measurements verify complete personal play results, public counters and sidebar/duo projections across variants/repetitions. Compact warmup still runs the task engine; Current BiS and Activity Info are omitted. Full result equality requires views=both or a separately pinned full oracle.',
      'Parent state migration, world construction, corrections and projection equality checks use current root app modules for both variants. Reported Git revision labels resolve from Git; each selected worker app directory is independently pinned by its complete SHA256 manifest.',
      'Input stringify is a cold upper bound; no HTTP, browser, save, scheduling or background queue time. Inclusive instrumentation subphases overlap enclosing stages.',
      'RSS is sampled for the whole parent process and its single worker; optional heap samples are worker boundary maxima, not true high-water marks.'] };
  const saveReport = async () => {
    report.peakRSSBytes = Math.max(peakRSS, process.memoryUsage.rss());
    report.pairedStatistics = pairedStatistics(report.observations);
    const temporary = `${locations.output}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
    await rename(temporary, locations.output);
  };
  try {
    secondLocations = await paths({ ...configuration, appDir: configuration.newApp });
    assert.equal(secondLocations.source, locations.source); assert.equal(secondLocations.output, locations.output);
    copiedBefore = await inputFingerprint(locations.source);
    const appDirs = { old: locations.appDir, new: secondLocations.appDir }, scratchDirs = { old: locations.scratch, new: secondLocations.scratch };
    const fingerprints = { old: await appFingerprint(appDirs.old), new: await appFingerprint(appDirs.new) };
    const revision = value => execFileSync('git', ['rev-parse', '--verify', `${value}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    report.inputs = { ...copiedBefore, source: relative(locations.source), scriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
      harnessSha256: sha(await readFile(path.join(ROOT, 'scripts/perf/unlock-calc.mjs'))),
      apps: Object.fromEntries(['old', 'new'].map(variant => [variant, { directory: relative(appDirs[variant]),
        revision: revision(configuration[`${variant}Revision`]), ...fingerprints[variant] }])) };
    report.contentFlags = { cacheShops: cacheShopContentsEnabled(), cacheResources: cacheResourceContentsEnabled(), cacheArchaeology: cacheArchaeologyContentsEnabled() };
    rssTimer = setInterval(() => { peakRSS = Math.max(peakRSS, process.memoryUsage.rss()); }, 50); rssTimer.unref();
    const registry = createRuleRegistry(), loaded = await readCopiedState(locations.source, registry);
    const definitionRaw = await readFile(path.join(ROOT, 'rs3-chunkpicker-chunkinfo-export.json'));
    const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(definitionRaw.toString('utf8'))));
    const definitionBytes = Buffer.from(JSON.stringify(definitions)), world = buildWorld(definitions, { dataset: selectedDataset });
    report.inputs.definitionSha256 = sha(definitionRaw); report.inputs.effectiveDefinitionSha256 = sha(definitionBytes);
    const transformed = { old: await instrument(scratchDirs.old, appDirs.old), new: await instrument(scratchDirs.new, appDirs.new) };
    report.instrumentationSource = Object.fromEntries(['old', 'new'].map(variant => [variant, { ...transformed[variant], workerFile: relative(transformed[variant].workerFile) }]));
    const ensureWorker = async variant => {
      if (worker) { await worker.close(); worker = undefined; }
      activeVariant = variant;
      worker = await startWorker(transformed[variant].workerFile, definitionBytes, world, configuration.heapSamples === 'on');
      workerGeneration++; requestsInWorker = 0;
      report.workers.push({ workerGeneration, variant, startupMs: worker.startupMs, compileMs: worker.ready.compileMs,
        instrumentation: worker.ready.probe, rssBytes: process.memoryUsage.rss() });
      return true;
    };
    await ensureWorker('old');
    let state = loaded.state;
    report.migrationReused = currentMigration(state, worker.ready);
    if (!report.migrationReused) state = migrateOwnedGameplay(state, { definitions, catalogue: worker.ready.catalogue, dynamicCatalogue: worker.ready.dynamicCatalogue,
      taskMap: JSON.parse(await readFile(path.join(ROOT, 'reference/original-picker/tasksMap.json'), 'utf8')), taskMapHistory: JSON.parse(await readFile(path.join(ROOT, 'app/data/legacy-task-history.json'), 'utf8')) }).state;
    const { history, provenance, ...calculation } = state; calculation.history = [];
    const fingerprint = createGameplayFingerprint(), baseInput = fingerprint(calculation), immutableInput = taskReuseInputKey(calculation);
    report.sourceRevision = state.revision;
    const candidates = calculation.members.map(member => ({ memberId: member.id, chunks: chunksFor(calculation, member, world, registry, 8) }));
    report.candidates = candidates;
    const casePlan = selectCases(candidates, configuration.caseStart, configuration.caseLimit);
    report.casePlan = { total: casePlan.total, indices: casePlan.cases.map(entry => entry.caseIndex), partial: casePlan.cases.length !== casePlan.total };
    report.schedule = pairedSchedule(casePlan.cases, configuration.repetitions);
    const baselineByMember = new Map(), signatures = new Map();
    const warmBaseline = async () => {
      for (const member of calculation.members) {
        const baseline = await request(worker, calculation, member.id, baseInput, report.configuration.warmupView, { selected: true });
        const play = configuration.views === 'both' ? projectPlayResult(baseline.result) : baseline.result;
        const summary = resultSummary(baseline.result);
        summary.duoSha256 = valueHash(transformed[activeVariant].peerProjection === 'sidebar'
          ? projectDuoSidebarResult(play, calculation, registry, member.id) : projectDuoPlayResult(play, calculation));
        const sidebarSha256 = valueHash(projectDuoSidebarResult(play, calculation, registry, member.id));
        if (configuration.views === 'compact') assert.equal(valueHash(baseline.wireProjection), sidebarSha256, 'Warmup sidebar projection mismatch');
        const publicCounters = JSON.parse(JSON.stringify(baseline.result.metrics ?? null, (key, value) => key === 'elapsedMs' ? undefined : value));
        const signature = { fullSha256: configuration.views === 'both' ? summary.fullSha256 : null,
          playSha256: valueHash(play), duoSha256: summary.duoSha256, sidebarSha256, counts: summary.counts,
          fieldHashes: summary.fieldHashes, publicCounters };
        if (baselineByMember.has(member.id)) assert.deepEqual(signature, baselineByMember.get(member.id).signature, `Baseline ${member.id} changed across variants/workers`);
        else baselineByMember.set(member.id, { ...summary, signature, playSummary: resultSummary(play), playSha256: valueHash(play) });
        report.baselines.push({ memberId: member.id, variant: activeVariant, workerGeneration,
          view: report.configuration.warmupView, selected: true, timing: baseline.timing, ...signature });
      }
    };
    await warmBaseline();
    for (const planned of report.schedule) {
      if (report.observations.length > 0 || planned.variant !== activeVariant) {
        await ensureWorker(planned.variant); await warmBaseline();
      }
      const { memberId, chunk, caseIndex, repetition, pairPosition, variant } = planned;
      const commandStarted = performance.now();
      const after = applyCommand(calculation, { type: 'set-chunk', memberId, chunkId: chunk.id, status: 'unlocked' }, { world, registry });
      const commandMs = performance.now() - commandStarted, input = fingerprint(after), results = [];
      assert.equal(taskReuseInputKey(calculation), immutableInput, 'Memory command mutated frozen baseline');
      for (const owner of calculation.members) if (owner.id !== memberId) assert.deepEqual(after.members.find(row => row.id === owner.id), owner, 'Partner ownership/progress changed');
      for (const ownerId of [memberId, ...calculation.members.filter(owner => owner.id !== memberId).map(owner => owner.id)]) {
        const selected = ownerId === memberId;
        const compact = await request(worker, after, ownerId, input, 'play-v1', { selected });
        const full = configuration.views === 'both' ? await request(worker, after, ownerId, input, 'full', { selected }) : null;
        const play = full ? projectPlayResult(full.result) : compact.result;
        const expected = { play: valueHash(play),
          duo: valueHash(transformed[activeVariant].peerProjection === 'sidebar' ? projectDuoSidebarResult(play, after, registry, ownerId) : projectDuoPlayResult(play, after)),
          sidebar: valueHash(projectDuoSidebarResult(play, after, registry, ownerId)) };
        const actual = { play: valueHash(compact.result), ...(selected ? { sidebar: valueHash(compact.wireProjection) } : { duo: valueHash(compact.wireProjection) }) };
        for (const [key, hash] of Object.entries(actual)) assert.equal(hash, expected[key], `${ownerId} ${chunk.id} ${key} projection mismatch`);
        const summary = resultSummary(full ? full.result : play), baseline = baselineByMember.get(ownerId);
        const comparisonBaseline = full ? baseline : baseline.playSummary;
        const publicCounters = JSON.parse(JSON.stringify(play.metrics ?? null, (key, value) => key === 'elapsedMs' ? undefined : value));
        results.push({ memberId: ownerId, lane: selected ? 'selected' : 'partner', compact: compact.timing, full: full?.timing ?? null,
          projections: { equivalent: true, compact: actual, projectedFrom: full ? 'full' : 'play', expected },
          fullSha256: full ? summary.fullSha256 : null, playSha256: valueHash(play), publicCounters,
          unchangedDuoProjection: expected.duo === baseline.duoSha256,
          unchangedFullResult: full ? summary.fullSha256 === baseline.fullSha256 : null,
          before: comparisonBaseline.counts, after: summary.counts, delta: taskDelta(comparisonBaseline, summary) });
      }
      const observation = { memberId, chunkId: chunk.id, caseIndex, repetition, pairPosition, variant, workerGeneration,
        observationInWorker: ++requestsInWorker, classification: chunk, commandMs, afterTaskInputSha256: taskReuseInputKey(after),
        originalInputUnchanged: true, partnerStateUnchanged: true, results };
      const signature = semanticSignature(observation);
      if (signatures.has(caseIndex)) assert.deepEqual(signature, signatures.get(caseIndex), `Case ${caseIndex} semantics changed across variants/repetitions`);
      else signatures.set(caseIndex, signature);
      report.observations.push(observation);
      await saveReport();
      console.error(`Paired case ${caseIndex} ${memberId} ${chunk.id} rep ${repetition + 1} ${variant} (${report.observations.length}/${report.schedule.length})`);
    }
    assert.deepEqual(await inputFingerprint(locations.source), copiedBefore, 'Frozen source changed');
    for (const variant of ['old', 'new']) assert.deepEqual(await appFingerprint(appDirs[variant]), fingerprints[variant], `${variant} application changed`);
    report.sourceUnchanged = true; report.appsUnchanged = true; report.allMeasuredPlayResultsCountersAndProjectionsEquivalent = true;
    report.fullUnlockOracleIncluded = configuration.views === 'both';
    if (configuration.views === 'both') report.aggregates = Object.fromEntries(['old', 'new'].map(variant => [variant, aggregate(report.observations.filter(row => row.variant === variant))]));
    await worker.close(); worker = undefined;
    report.complete = true; report.finishedAt = new Date().toISOString(); await saveReport();
    console.log(JSON.stringify({ report: relative(locations.output), observations: report.observations.length, workers: report.workers.length,
      allMeasuredPlayResultsCountersAndProjectionsEquivalent: true, fullUnlockOracleIncluded: report.fullUnlockOracleIncluded,
      sourceUnchanged: true, appsUnchanged: true, peakRSSMiB: report.peakRSSBytes / 1048576 }));
  } catch (error) {
    report.error = { name: error.name, message: error.message }; await saveReport(); throw error;
  } finally {
    clearInterval(rssTimer); await worker?.close();
    for (const location of [locations, secondLocations].filter(Boolean)) {
      const scratch = await realpath(location.scratch);
      assert(inside(location.perf, scratch) && !overlap(location.source, scratch), 'Unsafe scratch cleanup target');
      await rm(scratch, { recursive: true, force: true });
    }
    if (copiedBefore) assert.deepEqual(await inputFingerprint(locations.source), copiedBefore, 'Frozen source changed during paired run');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
