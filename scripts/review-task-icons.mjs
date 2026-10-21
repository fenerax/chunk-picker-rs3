#!/usr/bin/env node
// Read-only save comparison. No server, store, network, account sync or gameplay writes.
import { readFile, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const root = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const flags = process.argv.slice(2);
function option(name, fallback) {
  const index = flags.indexOf(name);
  if (index < 0) return fallback;
  if (!flags[index + 1] || flags[index + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return flags[index + 1];
}
const within = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
async function noLinks(absolute) {
  for (let cursor = absolute; ; cursor = path.dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlinks/junctions are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cursor === path.dirname(cursor)) break;
  }
}
async function copiedDirectory(input) {
  const absolute = path.resolve(input); await noLinks(absolute);
  const resolved = await realpath(absolute);
  if (!within(path.join(root, '.local'), resolved) || /[\\/]\.local[\\/]duo(?:[\\/]|$)/i.test(resolved)) {
    throw new Error('Save must be a separately named copy inside this worktree .local, outside .local/duo');
  }
  return resolved;
}
async function inventory(directory) {
  const records = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Copied input contains a symlink/junction');
      if (/^(store\.lock|invites\.json|feedback(?:\.json)?|access-token(?:\..*)?)$/i.test(entry.name)) throw new Error('Remove lock, invitation, feedback and access-token files from the COPY first');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) records.push({ file: path.relative(directory, file).replaceAll('\\', '/'), sha256: hash(await readFile(file)) });
      else throw new Error('Copied input contains a non-regular file');
    }
  }
  await visit(directory);
  return { count: records.length, sha256: hash(JSON.stringify(records)) };
}
async function hydrate(directory) {
  const stateBytes = await readFile(path.join(directory, 'state.json'));
  const envelope = JSON.parse(stateBytes);
  if (envelope.format !== 'rs3-chunk-picker' || envelope.schemaVersion !== 1) throw new Error('Expected picker state.json envelope');
  if (envelope.storage) {
    if (envelope.storage.schemaVersion !== 1 || Object.keys(envelope.storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new Error('Invalid static storage metadata');
    const allowed = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
    for (const [key, reference] of Object.entries(envelope.storage.fields ?? {})) {
      if (!allowed.has(key) || Object.hasOwn(envelope.state, key) || !/^static-[a-f0-9]{64}\.json\.gz$/.test(reference.id)
        || reference.id !== `static-${reference.sha256}.json.gz`) throw new Error('Invalid static save reference');
      const file = path.join(directory, 'static', reference.id), resolved = await realpath(file);
      if (!within(directory, resolved)) throw new Error('Static dependency escapes copied save');
      const bytes = gunzipSync(await readFile(file));
      if (hash(bytes) !== reference.sha256) throw new Error('Static save checksum mismatch');
      envelope.state[key] = JSON.parse(bytes);
    }
  }
  return { state: envelope.state, sha256: hash(stateBytes) };
}
async function startWorker(definitions, world) {
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), { workerData: { definitions, world: { chunks: world.chunks, surface: world.surface } } });
  let nextId = 0;
  const pending = new Map();
  const fail = error => { for (const callbacks of pending.values()) callbacks.reject(error); pending.clear(); };
  worker.on('error', fail); worker.on('exit', code => fail(new Error(`Task worker exited (${code})`)));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup exceeded 120 seconds')), 120000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited before readiness (${code})`)); });
    worker.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message); }
      else if (pending.has(message.id)) { const callbacks = pending.get(message.id); pending.delete(message.id); message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message); }
    });
  }).catch(async error => { await worker.terminate(); throw error; });
  return { worker, ready, evaluate: (state, memberId, input) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('Task calculation exceeded 120 seconds')); }, 120000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value.result); }, reject: error => { clearTimeout(timer); reject(error); } });
    worker.postMessage({ id, state, memberId, input });
  }) };
}
// Suggestions describe spelling transformations only. They never resolve an icon.
export function aliasSuggestions(name, lookup) {
  const proposals = [];
  const add = (kind, candidate) => {
    if (candidate !== name && lookup(candidate) && !proposals.some(row => row.candidate === candidate)) proposals.push({ kind, candidate, suggestionOnly: true });
  };
  if (/s$/i.test(name)) add('plural', name.slice(0, -1));
  if (/ies$/i.test(name)) add('plural', name.slice(0, -3) + 'y');
  if (/ves$/i.test(name)) add('plural', name.slice(0, -3) + 'f');
  add('unfinished', name.replace(/\s*\((?:unf|unfinished)\)$/i, ''));
  add('unfinished', name.replace(/\(unf\)/gi, '(unfinished)'));
  add('unfinished', name.replace(/\(unfinished\)/gi, '(unf)'));
  add('dose', name.replace(/\s*\((?:[1-6]|[1-6] doses?)\)$/i, ''));
  add('charge', name.replace(/\s*\((?:\d+ charges?|charged|uncharged)\)$/i, ''));
  add('noted', name.replace(/\s*\(noted\)$/i, ''));
  add('set', name.replace(/\s+set$/i, ''));
  add('apostrophe', name.replace(/[‘’]/gu, "'"));
  return proposals;
}

export function diagnoseTask(task, { names, lookup, manifestNames, manifestUnmatched = new Map() }) {
  const candidates = names(task);
  const unmatched = candidates.map(name => ({ name,
    reason: manifestNames.has(name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()) ? 'ambiguous-manifest-alias' : 'not-in-manifest',
    manifestReasons: manifestUnmatched.get(name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()) ?? [],
    suggestions: aliasSuggestions(name, lookup) }));
  const category = ['Quest', 'Achievement', 'Activity', 'Diary', 'Slayer', 'Clue'].includes(task.category);
  const reason = category ? 'category-without-icon' : unmatched.some(row => row.suggestions.length) ? 'possible-alias' : candidates.length ? 'item-not-in-manifest' : 'no-identifiable-item';
  return { id: task.id, label: task.label, category: task.category, candidates, reason, unmatched };
}

const countBy = (rows, key) => Object.fromEntries([...new Set(rows.map(row => row[key]))].sort().map(value => [value, rows.filter(row => row[key] === value).length]));

async function main() {
  if (flags.includes('--help')) { console.log('node scripts/review-task-icons.mjs --save .local/<COPY> [--baseline|--current]\nJSON on stdout; both before/after counts, selected iconless rows. Read-only: no server, store, network or file writes.'); return; }
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === '--save') { index++; if (!flags[index] || flags[index].startsWith('--')) throw new Error('Missing --save value'); }
    else if (!['--baseline', '--current'].includes(flags[index])) throw new Error(`Unknown option ${flags[index]}`);
  }
  if (flags.includes('--baseline') && flags.includes('--current')) throw new Error('Choose --baseline or --current');
  if (!option('--save')) throw new Error('An explicit copied --save is required');
  const mode = flags.includes('--baseline') ? 'baseline' : 'current';
  const directory = await copiedDirectory(option('--save'));
  const beforeInput = await inventory(directory), loaded = await hydrate(directory);
  const { validateState } = await import('../app/core/state.mjs');
  const { selectedDataset } = await import('../app/dataset-runtime.mjs');
  const { buildWorld } = await import('../app/data/world.mjs');
  const { applyCacheShops } = await import('../app/data/cache-shops.mjs');
  const { applyEquipmentCorrections } = await import('../app/data/equipment-corrections.mjs');
  const { createIconCatalogue, ICON_BUNDLES, normalizeIconName } = await import('../app/data/icons.mjs');
  const { taskItemNames, taskItemIcon, ...taskHelpers } = await import('../app/tasks/task-icons.mjs');
  const bundles = await Promise.all(ICON_BUNDLES.map(async spec => JSON.parse(await readFile(path.join(root, 'app/data', spec.manifest)))));
  const catalogue = createIconCatalogue(bundles);
  const manifestUnmatched = new Map();
  for (const bundle of bundles) for (const entry of bundle.unmatched ?? []) {
    const key = normalizeIconName(entry.name), prior = manifestUnmatched.get(key) ?? [];
    prior.push({ version: bundle.version, reason: entry.reason }); manifestUnmatched.set(key, prior);
  }
  const baselineIndexes = { skills: new Map(), items: new Map() };
  for (const bundle of bundles.filter(bundle => ['2026-10-08.v1', '2026-10-09.v1'].includes(bundle.version))) {
    for (const [name, entry] of Object.entries(bundle.icons)) for (const alias of [name, ...entry.aliases]) {
      const index = baselineIndexes[bundle.kind], key = normalizeIconName(alias), url = `/assets/map/${bundle.assetDirectory}/${entry.file}`;
      index.set(key, index.has(key) && index.get(key) !== url ? null : url);
    }
  }
  const baselineLookups = { itemIcon: name => baselineIndexes.items.get(normalizeIconName(name)) ?? null, skillIcon: name => baselineIndexes.skills.get(normalizeIconName(name)) ?? null };
  const currentLookups = { itemIcon: name => catalogue.lookup('item', name)?.url ?? null, skillIcon: name => catalogue.lookup('skill', name)?.url ?? null };
  const baselineIcon = task => taskItemIcon(task, baselineLookups.itemIcon) || baselineLookups.skillIcon(task.category);
  const currentIcon = task => typeof taskHelpers.taskIcon === 'function' ? taskHelpers.taskIcon(task, currentLookups) : taskItemIcon(task, currentLookups.itemIcon) || currentLookups.skillIcon(task.category);
  const manifestNames = new Set(Object.entries(catalogue.manifest.items).flatMap(([name, entry]) => [name, ...entry.aliases]).map(normalizeIconName));
  const state = validateState(loaded.state);
  const definitionBytes = await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'));
  const definitions = applyCacheShops(applyEquipmentCorrections(JSON.parse(definitionBytes))), world = buildWorld(definitions, { dataset: selectedDataset });
  const members = [], { worker, evaluate } = await startWorker(definitions, world);
  try {
    for (const member of state.members) {
      const result = await evaluate(state, member.id, `review-icons:${member.id}`);
      const possible = result.tasks.filter(row => row.status === 'available' && row.obligation !== false);
      if (possible.length !== result.metrics.availableCount) throw new Error('Possible count disagrees with production metric');
      const visible = possible.filter(row => !row.hidden && !member.taskStatus?.[row.id]?.backlogged);
      const presented = new Set(result.presentation.tasks.map(row => row.id));
      const summarize = (rows, resolver, lookups, knownNames) => {
        const missing = rows.filter(row => !resolver(row));
        return { total: rows.length, withIcon: rows.length - missing.length, iconless: missing.length,
          byCategory: countBy(missing, 'category'), byReason: countBy(missing.map(row => diagnoseTask(row, { names: taskItemNames, lookup: lookups.itemIcon, manifestNames: knownNames, manifestUnmatched })), 'reason') };
      };
      const selectedLookup = mode === 'baseline' ? baselineLookups : currentLookups;
      const selectedNames = mode === 'baseline' ? new Set(baselineIndexes.items.keys()) : manifestNames;
      const rows = possible.filter(row => !(mode === 'baseline' ? baselineIcon : currentIcon)(row)).map(row => ({
        ...diagnoseTask(row, { names: taskItemNames, lookup: selectedLookup.itemIcon, manifestNames: selectedNames, manifestUnmatched }),
        hidden: !!row.hidden, backlogged: !!member.taskStatus?.[row.id]?.backlogged, presented: presented.has(row.id) }));
      members.push({ id: member.id, name: member.name, runescapeName: member.runescapeName,
        before: summarize(possible, baselineIcon, baselineLookups, new Set(baselineIndexes.items.keys())), after: summarize(possible, currentIcon, currentLookups, manifestNames),
        visibleAllPossible: { before: summarize(visible, baselineIcon, baselineLookups, new Set(baselineIndexes.items.keys())), after: summarize(visible, currentIcon, currentLookups, manifestNames) },
        resolvedIds: possible.filter(row => !baselineIcon(row) && currentIcon(row)).map(row => row.id),
        regressionIds: possible.filter(row => baselineIcon(row) && !currentIcon(row)).map(row => row.id),
        groups: Object.fromEntries([...new Set(rows.map(row => row.reason))].sort().map(reason => [reason, rows.filter(row => row.reason === reason)])), rows });
    }
  } finally { await worker.terminate(); }
  const afterInput = await inventory(directory);
  if (JSON.stringify(beforeInput) !== JSON.stringify(afterInput)) throw new Error('Copied save changed during review');
  console.log(JSON.stringify({ schemaVersion: 1, mode, currentUsesSharedTaskIcon: typeof taskHelpers.taskIcon === 'function',
    copiedInput: { ...beforeInput, unchanged: true }, sourceSha256: loaded.sha256, sourceRevision: state.revision,
    definitionSha256: hash(definitionBytes),
    possibleDefinition: 'Production availableCount: all available own obligations, including hidden/completed/backlogged rows.',
    visibleDefinition: 'All possible main-screen rows without search: available own obligations excluding engine-hidden and backlogged; completion/category filters unapplied.',
    suggestions: 'Spelling transformations are review suggestions only; they never select artwork or assert item identity.', members }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
