import { neededForChains, setStanding, taskWarnings, taskBossGates } from './task-provenance.mjs';

export const TASK_WHY_DISPLAY_LIMIT = 64 * 1024;
export const WRITER_WHY_BUDGET = Object.freeze({ rows: 128, work: 32_768, allocation: 512 * 1024 });
const WORKER_WHY_BUDGET = Object.freeze({ work: 400_000, allocation: 8 * 1024 * 1024 });
export const WHY_INDEX_BUDGET = Object.freeze({ rows: 100_000, work: 16_000_000, allocation: 32 * 1024 * 1024 });
const identityKey = (category, label) => `${category}\u0000${label}`;

// Admission precedes index construction, Set scans, sorting and JSON allocation.
// Strings count UTF-8/JSON escapes without allocating an encoded copy, so no serialization is needed
// to discover an oversized projection. Counters also make the work bound testable.
function budget(limits, stats) {
  Object.assign(stats, { work: 0, allocation: 0, derived: 0, serialized: 0 });
  return (work = 1, allocation = 0) => {
    if (work > limits.work - stats.work || allocation > limits.allocation - stats.allocation) throw exhausted;
    stats.work += work; stats.allocation += allocation;
  };
}
const exhausted = Symbol('explanation budget exhausted');
// Worker-only producer. Its maps reference immutable snapshot rows. The worker
// attaches the index only through snapshot-cache admission; no global weak cache.
export function createTaskWhyIndex(result, { stats = {}, cancelled = () => false } = {}) {
  const spend = budget(WHY_INDEX_BUDGET, stats), tasks = result?.tasks;
  try {
    if (!Array.isArray(tasks) || tasks.length > WHY_INDEX_BUDGET.rows) throw exhausted;
    spend(tasks.length, tasks.length * 96);
    const byId = new Map(), dependents = new Map(), sets = new Map();
    const text = value => { const length = String(value ?? '').length; if (length > 4096) throw exhausted; spend(length + 1, length * 2 + 32); };
    const append = (map, key, row) => { spend(1, 96); let rows = map.get(key); if (!rows) map.set(key, rows = []); rows.push(row); };
    let steps = 0;
    const checkpoint = () => { if ((steps++ & 255) === 0 && cancelled()) throw exhausted; };
    for (const row of tasks) {
      checkpoint();
      text(row.id); byId.set(row.id, row);
      if (row.record?.Set) { text(row.category); text(row.record.Set); append(sets, identityKey(row.category, row.record.Set), row); }
      for (const label in row.record?.Tasks ?? {}) if (Object.hasOwn(row.record.Tasks, label)) {
        checkpoint();
        const category = row.record.Tasks[label]; text(label); text(category);
        append(dependents, identityKey(category, label), row);
      }
    }
    return Object.freeze({ tasks, byId, dependents, sets });
  } catch (error) { if (error === exhausted) return undefined; throw error; }
}
function jsonBound(value, spend, remaining = TASK_WHY_DISPLAY_LIMIT, depth = 0) {
  spend();
  if (remaining < 0 || depth > 24) throw exhausted;
  if (value === undefined) return 0;
  if (typeof value === 'string') {
    if (value.length + 2 > remaining) throw exhausted;
    spend(value.length);
    let bytes = 2;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
      else if (code < 32) bytes += 6;
      else if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
      if (bytes > remaining) throw exhausted;
    }
    spend(0, bytes * 2); return bytes;
  }
  if (value === null || typeof value !== 'object') return 24;
  let bytes = 2;
  const add = item => { bytes += 1 + jsonBound(item, spend, remaining - bytes - 1, depth + 1); if (bytes > remaining) throw exhausted; };
  if (Array.isArray(value)) {
    if (value.length > remaining - bytes) throw exhausted;
    spend(value.length, value.length * 8);
    for (const item of value) add(item);
  } else {
    for (const key in value) if (Object.hasOwn(value, key)) { add(key); add(value[key]); }
  }
  return bytes;
}

function admitGraph(tasks, limits, spend) {
  if (!Array.isArray(tasks) || tasks.length > (limits.rows ?? Infinity)) throw exhausted;
  spend(tasks.length, tasks.length * 96);
  let edges = 0;
  for (const row of tasks) {
    // These are the only fields read by the dependency/set algorithms. Ignore
    // unrelated descriptions and catalogue fields without walking them.
    for (const value of [row.id, row.category, row.rawLabel, row.label, row.record?.Set]) jsonBound(value, spend);
    const blockers = row.blockers ?? [];
    spend(blockers.length, blockers.length * 8);
    for (const blocker of blockers) { spend(); if (blocker.kind !== undefined) jsonBound(blocker.kind, spend); }
    for (const label in row.record?.Tasks ?? {}) if (Object.hasOwn(row.record.Tasks, label)) {
      jsonBound(label, spend); jsonBound(row.record.Tasks[label], spend);
      spend(1, 160); edges++;
    }
  }
  // At most ten dependent sorts (three chains of depth three plus the root),
  // each bounded by the admitted edge count. Set scans are linear in rows.
  spend(10 * edges * Math.ceil(Math.log2(edges + 1)) + tasks.length * 4, edges * 32);
}

function admitRelated(task, tasks, spend) {
  let setBytes = 128, longest = 0;
  const outclassed = task.blockers?.some(row => row.kind === 'outclassed');
  for (const row of tasks) {
    spend(); longest = Math.max(longest, String(row.label ?? '').length);
    if (!outclassed && task.record?.Set && row.id !== task.id && row.record?.Set === task.record.Set
      && row.category === task.category && row.blockers?.some(blocker => blocker.kind === 'outclassed')) {
      setBytes += 3 + String(row.label ?? '').length * 6;
      if (setBytes > TASK_WHY_DISPLAY_LIMIT) throw exhausted;
    }
  }
  // plain() only removes characters; nine labels bound the three depth-3 chains.
  if (setBytes + longest * 6 * 9 > TASK_WHY_DISPLAY_LIMIT) throw exhausted;
}

// Project only inputs consumed by explainTask. Keep the same set/dependency
// algorithms and order as a full result. Worker reads reuse the dependency
// index admitted with their ledger-owned snapshot; writer reads stay bounded.
export function taskWhyDisplay(result, taskId, memberId, stateRevision, { limits = WORKER_WHY_BUDGET, stats = {}, index } = {}) {
  const spend = budget(limits, stats);
  try {
    if (index === false || index && index.tasks !== result?.tasks) return undefined;
    if (!index) admitGraph(result?.tasks, limits, spend);
    const task = index ? index.byId.get(taskId) : result?.tasks?.find(row => row.id === taskId);
    if (!task) return undefined;
    const setMembers = index ? index.sets.get(identityKey(task.category, task.record?.Set)) ?? [] : result.tasks;
    let chainBytes = 0;
    const visit = (rows, sorting = false) => {
      spend(rows.length * (sorting ? 1 + Math.ceil(Math.log2(rows.length + 1)) : 1), rows.length * 128);
      for (const row of rows) {
        for (const value of [row.id, row.category, row.rawLabel, row.label, row.record?.Set]) jsonBound(value, spend);
      }
    };
    const chainVisit = (rows, sorting) => {
      visit(rows, sorting);
      if (!sorting) for (const row of rows) {
        chainBytes += 3 + String(row.label ?? '').length * 6;
        if (chainBytes > TASK_WHY_DISPLAY_LIMIT) throw exhausted;
      }
    };
    if (index) {
      visit([task]); visit(setMembers);
      for (const row of new Set([task, ...setMembers])) {
        spend(row.blockers?.length ?? 0);
        for (const blocker of row.blockers ?? []) { spend(); jsonBound(blocker.kind, spend); }
      }
    }
    admitRelated(task, setMembers, spend);
    const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
    // Inspect selected inputs before allocating a projection or derived arrays.
    // Arrays/strings that cannot fit are rejected by length before walking them.
    for (const value of [task.monster, task.sources, task.slayerUnlockGate, task.sourcePolicyRejections, task.sourceExclusion,
      task.record?.Category, task.record?.Label, task.record?.Monsters,
      result.presentation?.suppressed?.[taskId]]) jsonBound(value, spend);
    const gates = result.bossGates ?? [], diagnostics = result.presentation?.diagnostics ?? [];
    spend(gates.length + diagnostics.length, gates.length * 96);
    for (const gate of gates) jsonBound(gate.monsters, spend);
    stats.derived++;
    const relevantGates = taskBossGates(task, result);
    for (const gate of relevantGates) for (const key of ['boss', 'monsters', 'open', 'reason']) jsonBound(gate[key], spend);
    for (const reason of diagnostics) if (reason.kind === 'unavailable-task-alternative' && reason.chosen === task.id) jsonBound(reason, spend);
    const display = {
      format: 'task-why-display-v1', memberId, stateRevision,
      task: { ...pick(task, ['id', 'label', 'category', 'status', 'monster', 'slayerUnlockGate', 'sourcePolicyRejections', 'sourceExclusion']),
        record: pick(task.record, ['Category', 'Label', 'Monsters']), sources: task.sources ?? [] },
      result: { bossGates: relevantGates.map(gate => pick(gate, ['boss', 'monsters', 'open', 'reason'])), presentation: {
        suppressed: { [taskId]: result.presentation?.suppressed?.[taskId] ?? [] }, diagnostics: taskWarnings(task, result),
      } },
      related: { set: setStanding(task, index ? { tasks: setMembers } : result),
        neededFor: neededForChains(task, { tasks: result.tasks }, index ? { index: index.dependents, visit: chainVisit } : undefined) },
    };
    // Never truncate an explanation. Oversized evidence uses the full-path fallback.
    jsonBound(display, spend);
    const json = JSON.stringify(display); stats.serialized++;
    return Buffer.byteLength(json) <= TASK_WHY_DISPLAY_LIMIT ? display : undefined;
  } catch (error) { if (error === exhausted) return undefined; throw error; }
}
