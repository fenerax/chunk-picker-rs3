import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

export const surface = JSON.parse(await readFile(new URL('../../docs/save-surface.json', import.meta.url), 'utf8'));

// JSON-pointer-like paths: [] is an array element, * one dictionary key.
// Opaque subtrees are explicit preservation boundaries for archived raw input;
// they must never be used for the live state/member/envelope object itself.
export function* jsonPaths(value, prefix = []) {
  if (prefix.length) yield prefix;
  if (Array.isArray(value)) {
    for (const item of value) yield* jsonPaths(item, [...prefix, '[]']);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) yield* jsonPaths(item, [...prefix, key]);
  }
}
const segments = path => path.split('/').slice(1);
const patterns = new WeakMap(surface.json.map(entry => [entry, segments(entry.path)]));
const matches = new Map();
const prefixMatches = (pattern, actual) => actual.every((part, index) => pattern[index] === '*' || pattern[index] === part);
export function matchingEntry(actual, entries = surface.json) {
  const key = JSON.stringify(actual);
  if (entries === surface.json && matches.has(key)) return matches.get(key);
  const match = entries.find(entry => {
    const pattern = patterns.get(entry) ?? segments(entry.path);
    return actual.length <= pattern.length ? prefixMatches(pattern, actual)
      : entry.opaque && prefixMatches(pattern, actual.slice(0, pattern.length));
  });
  if (entries === surface.json) matches.set(key, match);
  return match;
}
export function assertDeclared(document, files, entries = surface.json) {
  for (const actual of jsonPaths(document)) assert.ok(matchingEntry(actual, entries), `Undeclared save path: /${actual.join('/')}`);
  for (const file of files) assert.ok(surface.files.some(entry => new RegExp(entry.pattern).test(file)), `Undeclared data-dir file: ${file}`);
}

// Observe successful real writes, including scratch/lock files that disappear
// before a directory snapshot. No filesystem operation is replaced with a fake.
export function observeSaveWrites(t, directory) {
  const files = new Set();
  const record = file => {
    if (typeof file !== 'string') return;
    const relative = path.relative(directory, file).split(path.sep);
    if (relative[0] === '..' || path.isAbsolute(relative[0]) || relative.length < 2) return;
    files.add(relative.slice(1).join('/')); // Each corpus case owns one child dir.
  };
  for (const name of ['open', 'writeFile', 'link']) {
    const original = fs.promises[name];
    t.mock.method(fs.promises, name, async (...args) => {
      const result = await original(...args);
      if (name !== 'open' || typeof args[1] === 'string' && /[wa+]/.test(args[1])) record(args[name === 'link' ? 1 : 0]);
      return result;
    });
  }
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (...args) => { const result = write(...args); record(args[0]); return result; });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return files;
}

export function assertCorpusCoverage(documents, files) {
  const unique = new Map();
  for (const document of documents) for (const actual of jsonPaths(document)) unique.set(JSON.stringify(actual), actual);
  const observed = [...unique.values()];
  assert.deepEqual(surface.json.filter(entry => !observed.some(actual =>
    actual.length >= segments(entry.path).length && matchingEntry(actual, [entry]))).map(entry => entry.path),
  [], 'Every declared JSON path needs a synthetic writer scenario');
  assert.deepEqual(surface.files.filter(entry => !files.some(file => new RegExp(entry.pattern).test(file))).map(entry => entry.path),
    [], 'Every declared data-dir file family needs a real writer scenario');
}

// A leaf digest, rather than counts: losing one fact and adding another cannot
// disguise shrinkage. Stable paths use member IDs/task IDs/history revisions.
function leaves(value, prefix, result) {
  if (Array.isArray(value)) {
    for (const item of value) result.add(JSON.stringify([prefix, item]));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) leaves(item, [...prefix, key], result);
  } else result.add(JSON.stringify([prefix, value]));
}
export function preservationDigest(state, sidecars) {
  const result = new Set();
  for (const task of state.tasks) result.add(JSON.stringify(['task', task.id]));
  for (const member of state.members) {
    for (const key of ['unlocked', 'selected', 'pendingRoll', 'blacklisted', 'completedTasks', 'obtainedEquipment',
      'taskStatus', 'xpChoices', 'bossUnlocks', 'f2pMap', 'originalPickerSync',
      'skillProgress', 'questProgress', 'achievementProgress', 'itemProgress', 'transportFacts', 'runeMetricsSync']) {
      if (Object.hasOwn(member, key)) leaves(member[key], ['member', member.id, key], result);
    }
  }
  for (const event of state.history) {
    // Undo adds a marker on its target; every existing event and inverse stays.
    const { undoneRevision, ...retained } = event;
    leaves(retained, ['history', String(event.revision)], result);
  }
  leaves(state.provenance ?? {}, ['provenance'], result);
  leaves(state.progressSnapshots ?? {}, ['progressSnapshots'], result);
  for (const key of ['identityRegistry', 'finishLine', 'groupGoals']) leaves(state[key] ?? {}, [key], result);
  for (const [file, value] of Object.entries(sidecars)) leaves(value, ['file', file], result);
  return result;
}
export function assertNeverShrinks(before, after, label) {
  const missing = [...before].filter(value => !after.has(value));
  assert.deepEqual(missing, [], `${label}: History, progress, task IDs or plugin evidence shrank`);
}
export async function pluginEvidenceFiles(dataDir) {
  const result = {};
  for (const entry of surface.files.filter(entry => entry.evidence)) {
    try { result[entry.path] = JSON.parse(await readFile(path.join(dataDir, entry.path), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return result;
}
