import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Extract pure orchestration/statistics only; importing the harness would load
// game modules. These fixtures never create a full worker or read copied saves.
const source = readFileSync(new URL('../scripts/perf/unlock-paired.mjs', import.meta.url), 'utf8');
const ordinary = readFileSync(new URL('../scripts/perf/unlock-calc.mjs', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('export function pairedOptions('), source.indexOf('\nasync function main()')).replace(/export /g, '');
const quantileSource = ordinary.slice(ordinary.indexOf('function quantiles('), ordinary.indexOf('\nfunction aggregate('));
const { pairedOptions, pairedSchedule, semanticSignature, pairedStatistics } = new Function('assert',
  `${quantileSource}\n${helpers}\nreturn { pairedOptions, pairedSchedule, semanticSignature, pairedStatistics };`)(assert);

const options = args => pairedOptions(['--source', '.local/copied-fixture', ...args]);
test('paired default preserves sixteen cases, three repeats each, and ABBA interleaving', () => {
  assert.equal(options([]).repetitions, 3);
  assert.equal(options([]).views, 'compact');
  assert.equal(options(['--views', 'both']).views, 'both');
  assert.throws(() => options(['--repetitions', '2']), /at least 3/);
  assert.throws(() => options(['--views', 'bad']), /compact or both/);
  assert.throws(() => options(['--case-limit', '0']), /positive/);
  assert.throws(() => options(['--case-start', '-1']), /nonnegative/);
  assert.throws(() => options(['--heap-samples', 'bad']), /on or off/);
  const cases = Array.from({ length: 16 }, (_, caseIndex) => ({ caseIndex, memberId: caseIndex < 8 ? 'a' : 'b', chunk: { id: String(caseIndex) } }));
  const schedule = pairedSchedule(cases, 3);
  assert.equal(schedule.length, 96);
  assert.deepEqual(schedule.slice(0, 6).map(row => row.variant), ['old', 'new', 'new', 'old', 'old', 'new']);
  assert.deepEqual(schedule.slice(6, 12).map(row => row.variant), ['new', 'old', 'old', 'new', 'new', 'old']);
  for (const entry of cases) for (let repetition = 0; repetition < 3; repetition++) {
    const pair = schedule.filter(row => row.caseIndex === entry.caseIndex && row.repetition === repetition);
    assert.deepEqual(pair.map(row => row.variant).sort(), ['new', 'old']);
    assert.deepEqual(pair.map(row => row.pairPosition), [0, 1]);
  }
  assert.deepEqual([...pairedSchedule(cases.slice(0, 8), 3), ...pairedSchedule(cases.slice(8), 3)], schedule);
});

const timing = value => ({ evaluationMs: value, roundTripMs: value + 2, compactCalculationTransportMs: value + 3,
  resultDecodeParseMs: 1, stages: { totalMs: value, engineMs: value / 2 }, instrumentation: { timings: { accessEvaluateMs: value / 4 } } });
const observation = (caseIndex, repetition, variant, ratio = 0.5, owner = 'a') => ({
  caseIndex, repetition, variant, memberId: owner, chunkId: String(caseIndex), afterTaskInputSha256: `input-${caseIndex}`,
  results: ['selected', 'partner'].map((lane, index) => ({ memberId: index ? 'b' : owner, lane,
    compact: timing((variant === 'old' ? 10 : 10 * ratio) + index), full: null,
    fullSha256: null, playSha256: 'identical-play', projections: { compact: { play: 'same', duo: 'same' } },
    publicCounters: { tasks: 4, checks: 20 }, before: { tasks: 4 }, after: { tasks: 5 }, delta: { added: 1 } })) });

test('statistics match case/repetition/lane before aggregating and retain raw ratios and per-case medians', () => {
  const observations = [0, 1].flatMap(caseIndex => [0, 1, 2].flatMap(repetition => ['new', 'old']
    .map(variant => observation(caseIndex, repetition, variant, [0.2, 0.5, 0.9][repetition]))));
  const stats = pairedStatistics(observations);
  assert.equal(stats.matched.length, 12);
  assert(stats.matched.every(row => row.view === 'compact'));
  const selectedCase = stats.perCase.find(row => row.caseIndex === 0 && row.lane === 'selected');
  assert.equal(selectedCase.matchedRepetitions, 3);
  assert.deepEqual(selectedCase.metrics.evaluationMs.ratios, [
    { repetition: 0, newOverOld: 0.2 }, { repetition: 1, newOverOld: 0.5 }, { repetition: 2, newOverOld: 0.9 }]);
  assert.equal(selectedCase.metrics.evaluationMs.newOverOld.median, 0.5);
  assert.equal(selectedCase.metrics['stage.totalMs'].newOverOld.median, 0.5);
  assert.equal(selectedCase.metrics['inclusive.accessEvaluateMs'].newOverOld.median, 0.5);
  const owner = stats.caseMedianSummaries.find(row => row.ownerMemberId === 'a' && row.lane === 'selected' && row.view === 'compact');
  assert.equal(owner.cases, 2);
  assert.deepEqual(owner.metrics.evaluationMs, { samples: 2, median: 0.5, p90: 0.5, min: 0.5, max: 0.5, p10: 0.5 });
  assert.equal(stats.summaries.find(row => row.ownerMemberId === 'a' && row.lane === 'selected' && row.view === 'compact').matchedSamples, 6);
  assert.equal(pairedStatistics([observation(0, 0, 'old')]).matched.length, 0, 'partial checkpoints retain unpaired rows without inventing ratios');
});

test('statistics reject duplicate and mismatched pairs while semantics ignore timing values', () => {
  const old = observation(0, 0, 'old'), current = observation(0, 0, 'new');
  assert.deepEqual(semanticSignature(old), semanticSignature(current));
  const changed = structuredClone(current); changed.results[0].publicCounters.checks++;
  assert.notDeepEqual(semanticSignature(old), semanticSignature(changed));
  assert.throws(() => pairedStatistics([old, old]), /Duplicate/);
  assert.throws(() => pairedStatistics([old, { ...current, memberId: 'another' }]), /Mismatched owner/);
  assert.throws(() => pairedStatistics([old, { ...current, chunkId: 'another' }]), /Mismatched chunk/);
  assert.throws(() => pairedStatistics([{ ...old, variant: 'bad' }]), /Invalid paired variant/);
});

test('per-owner case summaries use matched ratios when old timings vary across repetitions', () => {
  const rows = ['a', 'b'].flatMap((owner, ownerIndex) => [0, 1, 2].flatMap(repetition => ['old', 'new'].map(variant => {
    const row = observation(ownerIndex, repetition, variant, 1, owner);
    const value = variant === 'old' ? [10, 100, 1000][repetition] : [20, 200, 100][repetition];
    for (const result of row.results) result.compact = timing(value);
    return row;
  })));
  const result = pairedStatistics(rows);
  for (const ownerMemberId of ['a', 'b']) for (const lane of ['selected', 'partner']) {
    const row = result.caseMedianSummaries.find(row => row.ownerMemberId === ownerMemberId && row.lane === lane && row.view === 'compact');
    assert.equal(row.metrics.evaluationMs.median, 2, 'median paired ratios differ from ratio of pooled medians');
    assert.equal(row.cases, 1);
  }
});

test('both warmup and observation counter normalization strips only elapsedMs', () => {
  const expressions = [...source.matchAll(/const publicCounters = (JSON\.parse\(JSON\.stringify\([^;]+);/g)].map(match => match[1]);
  assert.equal(expressions.length, 2);
  for (const expression of expressions) {
    const normalize = new Function('baseline', 'play', `return ${expression};`);
    const metrics = { elapsedMs: 150, checks: 22, nested: { elapsedMs: 9, count: 1 } };
    const actual = normalize({ result: { metrics } }, { metrics });
    assert.deepEqual(actual, { checks: 22, nested: { count: 1 } });
  }
});

test('every observation can replace even the same variant, and termination finishes before next startup', async () => {
  const lifecycle = source.slice(source.indexOf('    const ensureWorker = async variant => {'), source.indexOf("    await ensureWorker('old');"));
  const events = [];
  let active = 0;
  const startWorker = async filename => {
    assert.equal(active, 0, 'two workers must never coexist'); active++;
    events.push(`start:${filename}`);
    return { startupMs: 1, ready: { compileMs: 1, probe: {} }, close: async () => {
      await Promise.resolve(); active--; events.push(`stop:${filename}`);
    } };
  };
  const ensure = new Function('startWorker', `let worker, activeVariant, workerGeneration = 0, requestsInWorker = 0;
    const transformed = { old: { workerFile: 'old' }, new: { workerFile: 'new' } }, configuration = { heapSamples: 'off' };
    const definitionBytes = null, world = null, report = { workers: [] };
    ${lifecycle}
    return ensureWorker;`)(startWorker);
  await ensure('old'); await ensure('new'); await ensure('new'); await ensure('old');
  assert.deepEqual(events, ['start:old', 'stop:old', 'start:new', 'stop:new', 'start:new', 'stop:new', 'start:old']);
  assert.equal(active, 1);
});

test('compact warmup evaluates both owners with fixed sidebar flags and records compact equality without full hashes', async () => {
  const warmup = source.slice(source.indexOf('    const warmBaseline = async () => {'), source.indexOf('    await warmBaseline();'));
  const calls = [];
  const request = async (worker, state, memberId, input, view, flags) => {
    calls.push({ memberId, view, selected: flags.selected });
    return { result: { tasks: [], metrics: { checks: 7, elapsedMs: calls.length } }, wireProjection: { sidebar: memberId }, timing: {} };
  };
  const resultSummary = result => ({ fullSha256: 'play-summary', taskHashes: new Map(), counts: { tasks: result.tasks.length }, fieldHashes: {} });
  const valueHash = result => JSON.stringify(result, (key, value) => key === 'elapsedMs' ? undefined : value);
  const context = new Function('assert', 'request', 'resultSummary', 'valueHash', `
    const worker = {}, calculation = { members: [{ id: 'a' }, { id: 'b' }] }, baseInput = 'fixture', registry = {};
    const configuration = { views: 'compact' }, report = { configuration: { warmupView: 'play-v1' }, baselines: [] }, baselineByMember = new Map();
    const transformed = { old: { peerProjection: 'sidebar' }, new: { peerProjection: 'sidebar' } };
    let activeVariant = 'old', workerGeneration = 1;
    const projectPlayResult = () => { throw new Error('compact warmup must not use full result projection'); };
    const projectDuoPlayResult = play => ({ duo: play.tasks });
    const projectDuoSidebarResult = (play, state, registry, memberId) => ({ sidebar: memberId });
    ${warmup}
    return { warmBaseline, report, changeVariant() { activeVariant = 'new'; workerGeneration++; } };`
  )(assert, request, resultSummary, valueHash);
  await context.warmBaseline(); context.changeVariant(); await context.warmBaseline();
  assert.deepEqual(calls, [
    { memberId: 'a', view: 'play-v1', selected: true }, { memberId: 'b', view: 'play-v1', selected: true },
    { memberId: 'a', view: 'play-v1', selected: true }, { memberId: 'b', view: 'play-v1', selected: true }]);
  assert(context.report.baselines.every(row => row.fullSha256 === null && row.view === 'play-v1' && row.selected === true));
  assert(context.report.baselines.every(row => row.publicCounters.checks === 7 && !('elapsedMs' in row.publicCounters)));
});
