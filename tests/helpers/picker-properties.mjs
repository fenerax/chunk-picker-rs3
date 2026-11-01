// Public synthetic inputs only: no pack, save, socket, or third-party dependency.
// CLI: node tests/helpers/picker-properties.mjs --cases 5000 --seed 163643374
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../../app/tasks/presentation.mjs';

export const defaultCases = 1000;
export const defaultSeed = 163643374;
export const engineOptions = { reviewedOverlays: false, cacheWalking: false, cacheResources: false,
  cacheArchaeology: false, cacheShops: false, metadataCorrections: false, equipmentCorrections: false,
  retainedTaskCorrections: false, retainedUnsupportedCorrections: false, divinationTraining: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };

export function random(seed) {
  let value = seed >>> 0;
  return n => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return Math.floor(value / 2 ** 32 * n); };
}
const id = i => `rs3:task:x09-${i}`;
const fields = { Chunks: null, Items: 'Spawn', Objects: 'Object', NPCs: 'NPC', Monsters: 'Monster', Shops: 'Shop' };
export function generate(seed) {
  const pick = random(seed), count = 3 + pick(4), chunks = {}, challenges = { Nonskill: {}, Extra: {} };
  const ids = Array.from({ length: count }, (_, i) => String(100 + i));
  for (const chunk of ids) {
    chunks[chunk] = {};
    for (const field of ['Spawn', 'Object', 'NPC', 'Monster', 'Shop']) {
      chunks[chunk][field] = { [`X09 ${field} ${pick(4)}`]: 1 };
    }
  }
  const tasks = 6 + pick(7), categories = Array.from({ length: tasks }, () => pick(2) ? 'Extra' : 'Nonskill');
  for (let i = 0; i < tasks; i++) {
    const record = { PickerId: id(i) };
    if (pick(3)) record.Chunks = [ids[pick(count)]];
    if (pick(2)) record.Items = [pick(2) ? `X09 Spawn ${pick(4)}` : `X09 output ${pick(tasks)}`];
    for (const [field, source] of Object.entries(fields)) if (source && field !== 'Items' && !pick(5)) record[field] = [`X09 ${source} ${pick(4)}`];
    if (!pick(3)) record.Items = [`X09 alternatives[+]x${1 + pick(3)}`];
    if (!pick(2)) record.Requirements = { Mining: 1 + pick(30) };
    if (!pick(4)) record.RequirementAlternatives = [{ Skills: { Mining: 1 + pick(30) } }, { Skills: { Crafting: 1 + pick(30) } }];
    if (!pick(3)) { const target = pick(tasks); record.Tasks = { [`X09 task ${target}`]: categories[target] }; }
    if (!pick(6)) record.CompletedTasks = [id(pick(tasks))];
    if (categories[i] === 'Nonskill') record.Output = `X09 output ${i}`;
    challenges[categories[i]][`X09 task ${i}`] = record;
  }
  const definitions = { chunks, challenges, codeItems: { itemsPlus: {
    'X09 alternatives[+]': ['X09 Spawn 0', 'X09 Spawn 1', 'X09 Spawn 2', 'X09 Spawn 3'],
  } } };
  const member = (name, offset) => ({ id: name, name, unlocked: ids.filter((_, i) => i === offset || !pick(3)),
    completedTasks: Array.from({ length: tasks }, (_, i) => id(i)).filter(() => !pick(12)),
    passiveLevels: { Mining: 1 + pick(30), Crafting: 1 + pick(30) } });
  const members = [member('a', 0)];
  if (!pick(2)) members.push(member('b', 1));
  return { definitions, state: { rules: { 'content.f2p': false, 'access.shared': false },
    taskRules: { 'Show Nonskill Tasks': true }, members }, unlock: ids.find(chunk => !members[0].unlocked.includes(chunk)) };
}

// These are exclusions from the positive oracle, NOT permissions to ignore a
// failing check. Named witnesses in picker-properties.test.mjs pin their behavior.
export const oracleExceptions = Object.freeze({
  processing: 'processing-method frontier can retract downstream supplies',
  sources: 'redundant NoXp producer / AllowedSources consumer can retract eligibility',
  preferred: 'preferred Extra sets can replace an eligible task',
  goals: 'higher skill goals can replace presented lower goals',
  diary: 'available diary parents can suppress presented children',
});
const list = x => x === undefined ? [] : Array.isArray(x) ? x : [x];
const reject = message => { throw new Error(`Outside positive oracle: ${message}`); };
function keys(value, allowed, location) {
  for (const key of Object.keys(value ?? {})) if (!allowed.includes(key)) reject(`${location}.${key}`);
}
function skills(value) {
  keys(value, ['Mining', 'Crafting'], 'skills');
  for (const level of Object.values(value ?? {})) if (!Number.isInteger(level) || level < 1 || level > 99) reject('skill level');
}
// Fail closed when the generated language grows. Never infer an exception from
// a blocker or engine result: a new rule must gain an independent model/contract.
export function assertOracleLanguage(definitions, member) {
  keys(definitions, ['chunks', 'challenges', 'codeItems'], 'definitions');
  if (!definitions.chunks || !definitions.challenges) reject('missing definitions');
  keys(definitions.codeItems, ['itemsPlus'], 'codeItems');
  keys(member, ['id', 'name', 'unlocked', 'completedTasks', 'passiveLevels'], 'member');
  if (typeof member.id !== 'string' || !Array.isArray(member.unlocked) || !Array.isArray(member.completedTasks)) reject('member roots');
  skills(member.passiveLevels);
  for (const chunk of member.unlocked) if (!Object.hasOwn(definitions.chunks, chunk)) reject('unknown unlocked chunk');
  for (const chunk of Object.values(definitions.chunks)) keys(chunk, Object.values(fields).filter(Boolean), 'chunk');
  const ids = new Set();
  for (const [category, entries] of Object.entries(definitions.challenges)) {
    for (const record of Object.values(entries)) {
      if ('NoXp' in record || 'AllowedSources' in record) reject(oracleExceptions.sources);
      if ('Set' in record || 'Priority' in record) reject(oracleExceptions.preferred);
      if (category === 'Diary' || 'BaseQuest' in record) reject(oracleExceptions.diary);
      if (category === 'Crafting') reject(oracleExceptions.processing);
      if (category === 'Mining') reject(oracleExceptions.goals);
      if (!['Nonskill', 'Extra'].includes(category)) reject(`category ${category}`);
      if ('Level' in record || 'Primary' in record) reject(oracleExceptions.goals);
      keys(record, ['PickerId', ...Object.keys(fields), 'Requirements', 'RequirementAlternatives', 'Tasks', 'CompletedTasks', 'Output'], 'task');
      if (typeof record.PickerId !== 'string' || ids.has(record.PickerId)) reject('missing/duplicate PickerId');
      ids.add(record.PickerId);
      skills(record.Requirements);
      for (const clause of record.RequirementAlternatives ?? []) { keys(clause, ['Skills'], 'alternative'); skills(clause.Skills); }
      for (const chunk of list(record.Chunks)) if (!Object.hasOwn(definitions.chunks, chunk)) reject('unknown task chunk');
      for (const [label, cat] of Object.entries(record.Tasks ?? {})) {
        if (!definitions.challenges[cat]?.[label]) reject('dangling task dependency');
      }
      for (const token of [...list(record.Output), ...list(record.CompletedTasks)]) {
        if (typeof token !== 'string') reject('non-string output/completion');
      }
      for (const field of Object.keys(fields)) for (const token of list(record[field])) {
        if (typeof token !== 'string') reject('non-string requirement');
        const match = /^(.*\[\+\])x(\d+)$/.exec(token);
        if (match && !Array.isArray(definitions.codeItems?.itemsPlus?.[match[1]])) reject('unknown counted alternative');
      }
    }
  }
}

// Independent least-fixed-point interpreter. Imports no engine eligibility,
// access, requirement, or collection helpers. Unconditional tasks and historical
// completions are legitimate roots; self-task links are annotations.
export function oracle(definitions, member) {
  assertOracleLanguage(definitions, member);
  const resources = Object.fromEntries(Object.keys(fields).map(field => [field, new Set()]));
  for (const chunk of member.unlocked) {
    resources.Chunks.add(chunk);
    for (const [field, source] of Object.entries(fields)) if (source) {
      for (const name of Object.keys(definitions.chunks[chunk]?.[source] ?? {})) resources[field].add(name);
    }
  }
  const rows = Object.entries(definitions.challenges).flatMap(([category, entries]) => Object.entries(entries).map(([label, record]) => ({ category, label, record })));
  const valid = new Set(member.completedTasks), completed = new Set(member.completedTasks);
  const has = (field, token) => {
    const match = /^(.*\[\+\])x(\d+)$/.exec(token);
    if (match) return definitions.codeItems.itemsPlus[match[1]].filter(name => resources[field].has(name)).length >= Number(match[2]);
    return resources[field].has(token);
  };
  const levels = needs => Object.entries(needs ?? {}).every(([skill, level]) => (member.passiveLevels?.[skill] ?? 1) >= level);
  let changed;
  do {
    changed = false;
    for (const { category, label, record } of rows) {
      const eligible = Object.keys(fields).every(field => list(record[field]).every(token => has(field, token)))
        && levels(record.Requirements)
        && (!record.RequirementAlternatives || record.RequirementAlternatives.some(clause => levels(clause.Skills)))
        && list(record.CompletedTasks).every(task => completed.has(task))
        && Object.entries(record.Tasks ?? {}).every(([name, cat]) => name === label && cat === category
          || valid.has(definitions.challenges[cat][name].PickerId));
      if (eligible && !valid.has(record.PickerId)) { valid.add(record.PickerId); changed = true; }
      if (valid.has(record.PickerId)) for (const output of list(record.Output)) if (!resources.Items.has(output)) {
        resources.Items.add(output); changed = true;
      }
    }
  } while (changed);
  return valid;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
// Preserve array order for same-input requests; omit only instrumentation.
export function stableResult(result) {
  const copy = structuredClone(result);
  delete copy.metrics;
  return JSON.stringify(canonical(copy));
}
// Unlock insertion order changes provenance serialization. Compare these exact
// picker semantics separately, and count raw ordering differences in coverage.
export function semanticResult(result, state, memberId, definitions) {
  return JSON.stringify(canonical({
    tasks: result.tasks.map(({ id, status, obligation, primaryMethod, sourceEligible, hidden, personalCompleted }) =>
      ({ id, status, obligation, primaryMethod, sourceEligible, hidden, personalCompleted })),
    pool: selectPresentedTasks(result, state, memberId, definitions).tasks.map(row => row.id),
    items: result.items.map(row => row.name), equipment: result.equipment.map(row => row.name),
    training: result.training, points: result.points,
  }));
}

function assertFixture({ definitions, state, unlock }) {
  keys(state, ['rules', 'taskRules', 'members'], 'state');
  keys(state.rules, ['content.f2p', 'access.shared'], 'rules');
  keys(state.taskRules, ['Show Nonskill Tasks'], 'taskRules');
  if (state.rules?.['content.f2p'] !== false || state.rules?.['access.shared'] !== false
    || state.taskRules?.['Show Nonskill Tasks'] !== true) reject('state rules');
  if (!state.members?.length) reject('missing members');
  if (new Set(state.members.map(member => member.id)).size !== state.members.length) reject('duplicate member');
  for (const member of state.members) assertOracleLanguage(definitions, member);
  if (unlock !== undefined && (!Object.hasOwn(definitions.chunks, unlock) || state.members[0].unlocked.includes(unlock))) reject('unlock transition');
}

function inspectCase(fixture, n, check, coverage) {
  assertFixture(fixture);
  const { definitions, state, unlock } = fixture, engine = createTaskEngine(definitions, engineOptions);
  coverage[state.members.length === 1 ? 'solo' : 'duo']++;
  const input = JSON.stringify({ definitions, state });
  for (const member of state.members) {
    const context = { member: member.id };
    const result = engine.evaluate(state, member.id), available = new Set(result.tasks.filter(row => row.status === 'available').map(row => row.id));
    const expected = oracle(definitions, member);
    coverage.rows += result.tasks.length; coverage.completedRoots += member.completedTasks.length;
    for (const row of result.tasks) check('grounded-eligibility', available.has(row.id) === expected.has(row.id), { ...context, task: row.id });
    // Catch dropped task rows as well as wrong eligibility on returned rows.
    for (const entries of Object.values(definitions.challenges)) for (const record of Object.values(entries)) {
      check('task-row-present', result.tasks.filter(row => row.id === record.PickerId).length === 1, { ...context, task: record.PickerId });
    }
    const pool = selectPresentedTasks(result, state, member.id, definitions).tasks;
    coverage.presented += pool.length;
    for (const row of pool) check('grounded-pool', expected.has(row.id) && row.status === 'available' && row.obligation, { ...context, task: row.id });
    const changed = structuredClone(state), target = changed.members.find(row => row.id === member.id);
    target.passiveLevels ??= {};
    target.passiveLevels.Mining = 99; target.passiveLevels.Crafting = 99;
    const raised = engine.evaluate(changed, member.id);
    for (const task of available) check('skill-monotonicity', raised.tasks.some(row => row.id === task && row.status === 'available'), { ...context, task });
    if (unlock && member.id === 'a') {
      coverage.unlock++;
      const unlocked = structuredClone(state); unlocked.members[0].unlocked.push(unlock);
      const after = engine.evaluate(unlocked, member.id);
      for (const task of available) check('unlock-monotonicity', after.tasks.some(row => row.id === task && row.status === 'available'), { ...context, task });
      const reversed = structuredClone(unlocked); reversed.members[0].unlocked.reverse();
      const reordered = engine.evaluate(reversed, member.id);
      if (stableResult(after) !== stableResult(reordered)) coverage.rawUnlockOrderDifferences++;
      check('unlock-order-semantics', semanticResult(after, unlocked, member.id, definitions) === semanticResult(reordered, reversed, member.id, definitions), context);
    }
    const candidate = pool[n % Math.max(1, pool.length)];
    if (candidate) {
      const completed = structuredClone(changed), owner = completed.members.find(row => row.id === member.id);
      if (!owner.completedTasks.includes(candidate.id)) owner.completedTasks.push(candidate.id);
      if (unlock && member.id === 'a') owner.unlocked.push(unlock);
      const after = engine.evaluate(completed, member.id);
      check('completion-stays-absent', !selectPresentedTasks(after, completed, member.id, definitions).tasks.some(row => row.id === candidate.id), { ...context, task: candidate.id });
    }
    check('request-order', stableResult(result) === stableResult(engine.evaluate(state, member.id)), context);
  }
  check('input-immutable', JSON.stringify({ definitions, state }) === input, {});
}
const newCoverage = () => ({ solo: 0, duo: 0, unlock: 0, rows: 0, presented: 0, completedRoots: 0, rawUnlockOrderDifferences: 0 });

// Bounded greedy deletion, on failure only. Report the smallest found, not a
// claim of a global minimum. Preserve the exact property/member/task signature.
function* deletions(value, prefix = []) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    yield [...prefix, key];
    yield* deletions(value[key], [...prefix, key]);
  }
}
export function shrinkFixture(original, fails, maxAttempts = 300) {
  let fixture = structuredClone(original), attempts = 0, reductions = 0;
  for (;;) {
    let reduced = false;
    for (const trail of deletions(fixture)) {
      if (attempts >= maxAttempts) return { fixture, attempts, reductions, exhausted: true };
      const candidate = structuredClone(fixture), key = trail.at(-1);
      const parent = trail.slice(0, -1).reduce((value, part) => value[part], candidate);
      if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
      attempts++;
      try { assertFixture(candidate); } catch { continue; }
      if (!fails(candidate)) continue;
      fixture = candidate; reductions++; reduced = true;
      break;
    }
    if (!reduced) return { fixture, attempts, reductions, exhausted: false };
  }
}

export function run({ cases = defaultCases, seed = defaultSeed } = {}) {
  if (!Number.isSafeInteger(cases) || cases < 1 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid cases or seed.');
  const started = performance.now(), checks = {}, failures = [], coverage = newCoverage();
  let failureCount = 0, smallestFailure;
  for (let n = 0; n < cases; n++) {
    const caseSeed = (seed + Math.imul(n, 2654435761)) >>> 0, fixture = generate(caseSeed);
    let firstFailure;
    inspectCase(structuredClone(fixture), n, (property, ok, context) => {
      checks[property] = (checks[property] ?? 0) + 1;
      if (ok) return;
      const failure = { property, seed: caseSeed, ...context };
      failureCount++;
      firstFailure ??= failure;
      if (failures.length < 25) failures.push(failure);
    }, coverage);
    if (firstFailure && !smallestFailure) {
      const signature = ({ property, member, task }) => JSON.stringify([property, member, task]);
      const shrunk = shrinkFixture(fixture, candidate => {
        let failed = false;
        inspectCase(structuredClone(candidate), n, (property, ok, context) => {
          if (!ok && signature({ property, ...context }) === signature(firstFailure)) failed = true;
        }, newCoverage());
        return failed;
      });
      smallestFailure = { failure: firstFailure, ...shrunk };
    }
  }
  return { seed, cases, checks, coverage, failureCount, failures, ...(smallestFailure ? { smallestFailure } : {}),
    durationMs: performance.now() - started, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { cases: { type: 'string', default: String(defaultCases) }, seed: { type: 'string', default: String(defaultSeed) } } });
  const result = run({ cases: Number(values.cases), seed: Number(values.seed) });
  console.log(JSON.stringify(result));
  if (result.failureCount) process.exitCode = 1;
}
