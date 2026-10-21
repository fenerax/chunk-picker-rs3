#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { compareOriginalData, diffRecords } from './lib/original-data-compare.mjs';
import { auditLocalOverrides } from './lib/original-data-overrides.mjs';

export { compareOriginalData, auditLocalOverrides };
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ORIGINAL_SITE = 'https://source-chunk.github.io/chunk-picker-rs3/';
export const ORIGINAL_FILES = ['rs3-chunkpicker-chunkinfo-export.json', 'tasksMap.json'];
const FROZEN = ['rs3-chunkpicker-chunkinfo-export.json', 'reference/original-picker/tasksMap.json'];
const USER_AGENT = 'PrivateRS3ChunkPickerDataReview/1.0 (bounded read-only noncommercial data update)';
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async file => { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const readOptionalJSON = async (file, fallback) => {
  try { return JSON.parse(await readFile(file)); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

/** Only two allowlisted public data files. One GET each, sequential, no retry,
 * redirect, credentials, executable source, Firebase or browser interaction. */
export async function fetchOriginalData(directory, { fetchImpl = fetch, maxBytes = 32 * 1024 * 1024,
  pause = () => new Promise(resolve => setTimeout(resolve, 1000)), now = () => new Date().toISOString() } = {}) {
  if (await exists(directory)) throw new Error('Capture directory already exists. Reuse it without --fetch, or choose a new capture directory; no files were fetched.');
  await mkdir(directory, { recursive: true });
  const captures = [];
  for (const name of ORIGINAL_FILES) {
    const url = ORIGINAL_SITE + name;
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error',
      headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Public original data unavailable: HTTP ${response.status} at ${url}. Stopped without retry or login.`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) throw new Error(`Public original file exceeded ${maxBytes} bytes: ${name}. Stopped without retry.`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    JSON.parse(bytes); // HTML/login/error responses fail closed.
    await writeFile(path.join(directory, name), bytes, { flag: 'wx' });
    captures.push({ name, url, fetchedAt: now(), bytes: length, sha256: sha256(bytes),
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), contentType: response.headers.get('content-type') });
    if (name !== ORIGINAL_FILES.at(-1)) await pause();
  }
  const capture = { schemaVersion: 1, method: 'One unauthenticated GET per known public data file; no retries, redirects, browser, logins or service writes.', captures };
  await writeFile(path.join(directory, 'capture.json'), json(capture), { flag: 'wx' });
  return capture;
}

function validateInputs(definitions, taskMap) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  for (const key of ['challenges', 'chunks', 'equipment', 'quests', 'drops', 'shopItems', 'skillItems', 'codeItems']) {
    if (!object(definitions[key])) throw new TypeError(`Original definitions need a ${key} object.`);
  }
  for (const key of ['walkableChunks', 'walkableChunksF2P']) if (!Array.isArray(definitions[key])) throw new TypeError(`Original definitions need a ${key} array.`);
  if (!object(taskMap)) throw new TypeError('Original task map must be an object.');
  for (const [label, id] of Object.entries(taskMap)) {
    if (label === 'currentNextIndex') { if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('Invalid task allocation cursor.'); }
    else if (typeof id !== 'string' || !/^t_[1-9]\d*$/.test(id)) throw new TypeError(`Invalid upstream task code: ${label}`);
  }
}

export function taskMapConflicts(before, after, history = {}) {
  const conflicts = [];
  for (const row of diffRecords(before, after).changed) if (row.key !== 'currentNextIndex') {
    conflicts.push({ kind: 'Legacy task code', target: row.label, message: `Existing label changed from ${row.before} to ${row.after}; preserve historical decoding and review identity.` });
  }
  const labelsById = data => {
    const result = new Map();
    for (const [label, id] of Object.entries(data)) if (label !== 'currentNextIndex') {
      if (!result.has(id)) result.set(id, new Set());
      result.get(id).add(label);
    }
    return result;
  };
  const historical = Object.entries(history.mappings ?? {}).concat(Object.entries(history.tombstones ?? {}), Object.entries(history.current ?? {}),
    (history.conflicts ?? []).flatMap(row => row.ids.map(id => [row.label, id])));
  const associations = new Map();
  for (const [label, id] of Object.entries(before).concat(historical)) {
    if (label === 'currentNextIndex') continue;
    if (!associations.has(label)) associations.set(label, new Set());
    associations.get(label).add(id);
  }
  const old = labelsById(before);
  for (const [label, id] of historical) {
    if (label === 'currentNextIndex') continue;
    if (!old.has(id)) old.set(id, new Set());
    old.get(id).add(label);
  }
  for (const [id, labels] of labelsById(after)) {
    if (labels.size > 1 && [...labels].some(label => !associations.get(label)?.has(id))) {
      conflicts.push({ kind: 'New ambiguous legacy task code', target: id,
        message: `${id} is assigned to ${[...labels].join('; ')}. This duplicate-code association was not present in retained history.` });
    }
    for (const label of labels) {
      if (associations.get(label)?.has(id)) continue; // Retained ambiguity is historical evidence.
      if (associations.has(label)) conflicts.push({ kind: 'Historical legacy task remapping', target: label,
        message: `${label} has retained codes ${[...associations.get(label)].join(', ')}; the new ${id} association requires review.` });
      if (old.has(id)) conflicts.push({ kind: 'Reused legacy task code', target: label,
        message: `${id} previously decoded ${[...old.get(id)].join('; ')}. An upstream rename is not an automatic authored identity merge.` });
    }
  }
  return conflicts;
}

function fieldChanges(row) {
  const labels = { Skills: 'Required skill levels', SkillsNeeded: 'Required skill levels', Items: 'Required items',
    NPCs: 'Required NPCs', Chunks: 'Location chunks', 'Not F2P': 'Members restriction', QuestPoints: 'Quest points',
    Primary: 'Training source', Priority: 'Priority', formatted_name: 'Display name' };
  const at = (value, keys) => keys.reduce((value, key) => value?.[key], value);
  const brief = value => {
    if (value === undefined) return '(absent)';
    const text = typeof value === 'string' ? value.replace(/~\|([^|]+)\|~/g, '$1') : JSON.stringify(value);
    return text.length > 160 ? text.slice(0, 157) + '… (full value in JSON)' : text;
  };
  return row.fields.map(pointer => {
    const keys = pointer === '/' ? [] : pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
    return `${keys.map(key => labels[key] ?? key).join(' / ') || 'Record'}: ${brief(at(row.before, keys))} → ${brief(at(row.after, keys))}`;
  }).join('; ');
}

function renderReport(report) {
  const lines = [`# Original picker data check — ${report.date}`, '',
    report.frozenComparison.definitionsChanged || report.frozenComparison.taskMapChanged
      ? 'The public original differs from the frozen September 28 copy. Entity views below include both F2P and members content.'
      : report.frozenComparison.byteIdentical
        ? 'The current public original is byte-for-byte identical to our frozen September 28 copy. There are no upstream data changes to adopt.'
        : 'The current public original contains the same parsed data as our frozen September 28 copy; only file formatting differs. There are no content changes to adopt.', '',
    `Fetched read-only: ${report.capture.method}`, '',
    ...report.capture.captures.map(row => `- [${row.name}](${row.url}): ${row.bytes.toLocaleString('en-US')} bytes; fetched ${row.fetchedAt}; Last-Modified ${row.lastModified ?? 'not supplied'}; exact SHA-256 \`${row.sha256}\`.`), '',
    'The retained upstream frontend fetches these two relative JSON URLs (`reference/original-picker/index.js:13034–13042`). The public repository is [source-chunk/chunk-picker-rs3](https://github.com/source-chunk/chunk-picker-rs3); retained source commit is `98a3bdc`. The original copy was the repository export plus its task-map seed, rather than a scheduled data feed. Our authored import pipeline is `scripts/updateTasksMap.js` and the runtime world/task adapters. No upstream executable code is adopted.', '',
    '## Changes against the frozen copy', '', '| Data | Frozen | Current | New | Removed | Changed |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of report.frozenComparison.categories) lines.push(`| ${row.label} | ${row.before} | ${row.after} | ${row.added.length} | ${row.removed.length} | ${row.changed.length} |`);
  const map = report.frozenComparison.taskMap;
  lines.push(`| Legacy task labels | ${map.before} | ${map.after} | ${map.added.length} | ${map.removed.length} | ${map.changed.length} |`, '',
    'Tasks are keyed by exact category and label. Chunks include named interiors. Item counts include equipment, spawns and named stock/drop/skill/table outputs (including upstream aliases); monster and shop counts include chunk declarations. Skill data counts method/output records. Views overlap: one drop change can affect both an item and a monster. Other tables and skill-related aliases/settings are checked below, so no top-level section is omitted.', '');
  for (const row of report.frozenComparison.categories) {
    if (!(row.added.length + row.removed.length + row.changed.length)) continue;
    lines.push(`### ${row.label}`, '');
    for (const entry of row.added) lines.push(`- New: ${entry.label}.`);
    for (const entry of row.removed) lines.push(`- Removed: ${entry.label}.`);
    for (const entry of row.changed) lines.push(`- Changed: ${entry.label}. ${fieldChanges(entry)}.`);
    lines.push('');
  }
  const other = report.frozenComparison.otherSections.filter(row => row.changed.length || row.added.length || row.removed.length);
  lines.push(other.length ? `Other changed sections: ${other.map(row => row.key).join(', ')}. Full before/after records and JSON field paths are in the adjacent JSON report.`
    : 'All remaining sections are unchanged, including topology, walkable/F2P lists, aliases, diaries, clues and skill settings.');
  for (const row of other) {
    for (const entry of row.changed) lines.push(`- Changed ${row.key}: ${fieldChanges(entry)}.`);
    if (row.added.length) lines.push(`- New data table: ${row.key}.`);
    if (row.removed.length) lines.push(`- Removed data table: ${row.key}.`);
  }
  for (const row of [...map.added.map(row => ({ ...row, kind: 'New' })), ...map.removed.map(row => ({ ...row, kind: 'Removed' })), ...map.changed.map(row => ({ ...row, kind: 'Changed' }))]) {
    lines.push(`- ${row.kind} legacy task label: ${row.label}; ${row.before ?? '(absent)'} → ${row.after ?? '(absent)'}.`);
  }
  if (map.cursor.before !== map.cursor.after) lines.push(`- Legacy allocation cursor: ${map.cursor.before} → ${map.cursor.after}.`);
  lines.push('', '## Adoption and local data', '', `Status: ${report.adoption.status}. ${report.adoption.reason}`, '',
    `Adopted entity-view rows: ${report.adoption.adopted}. Skipped entity-view rows: ${report.adoption.skipped}. Conflicts: ${report.audit.conflicts.length}.`, '',
    '| Local check | Targets | Result |', '| --- | ---: | --- |',
    ...report.audit.checks.map(row => `| ${row.name} | ${row.count} | ${row.status} |`), '',
    'Historical root data, the archival seed, all retained item icon manifests/artwork, skill guides, reviewed corrections, membership evidence and cache/training additions are preserved. The JSON receipt pins the protected local data files. Optional correction/content switches keep their existing defaults. An unresolved conflict stops the whole adoption batch, because independently merging related requirements and sources can change task eligibility.', '');
  for (const row of report.audit.conflicts) lines.push(`- Conflict — ${row.kind}: ${row.target}. ${row.message}`);
  lines.push('', `Runtime catalogue sizes ${report.activeComparison.definitionsChanged ? 'may change; warmstart should remeasure after adoption' : 'are unchanged; warmstart needs no catalogue-size adjustment'}.`, '',
    'This check establishes public-file freshness on this date, not the completeness of the original author’s game catalogue. No Wiki/news fetch, player save, login, browser, live-service write or screenshot was needed.', '',
    'See [the repeatable workflow](../original-data-updates.md).', '');
  return lines.join('\n');
}

/** Install raw snapshots only after conflict checks. The frozen files and local
 * overlays never change. Legacy regeneration retains every historical decoder.
 * The selection import changes last, so interrupted staging stays inactive. */
export async function adoptOriginalData(report, inputs, { root = ROOT, version = 'v1' } = {}) {
  if (report.audit.conflicts.length) throw new Error(`Adoption stopped: ${report.audit.conflicts.length} unresolved conflicts. See the saved report.`);
  const name = `original-data.${report.date}.${version}.json`, destination = path.join(root, 'app/data', name);
  if (await exists(destination)) throw new Error(`Version already exists: ${name}; choose a new --version. Existing versions are kept.`);
  for (const row of report.audit.protectedFiles) {
    if (sha256RepositoryText(await readFile(path.join(root, row.path))) !== row.sha256) throw new Error(`Local data changed during review: ${row.path}. Rerun the offline comparison.`);
  }
  const loader = path.join(root, 'app/data/original-data.mjs'), stagedLoader = loader + '.origdata.tmp';
  const source = await readFile(loader, 'utf8');
  const pattern = /import selection from '\.\/original-data\.\d{4}-\d{2}-\d{2}\.v\d+\.json'/;
  if (!pattern.test(source)) throw new Error('Selection import could not be located; no adoption files were written.');
  const changed = report.activeComparison.definitionsChanged || report.activeComparison.taskMapChanged;
  const stagedRegistry = path.join(root, 'app/data/identity-registry.origdata.tmp.mjs');
  for (const relative of [stagedLoader,
    ...(report.activeComparison.definitionsChanged ? [path.join(root, `app/data/original-definitions.${report.date}.${version}.json`)] : []),
    ...(report.activeComparison.taskMapChanged ? [path.join(root, `app/data/original-task-map.${report.date}.${version}.json`)] : []),
    ...(changed ? [stagedRegistry, path.join(root, `app/data/identity-registry.${report.date}.${version}.mjs`),
      ...['legacy-task-history.json', 'legacy-task-current.json'].map(name => path.join(root, 'app/data', name + '.origdata.tmp'))] : [])]) {
    if (await exists(relative)) throw new Error(`Staged/versioned output already exists: ${path.relative(root, relative)}. Inspect it before choosing a new version.`);
  }
  let definitions = inputs.activeSelection.definitions, taskMap = inputs.activeSelection.taskMap;
  const install = async (prefix, bytes) => {
    const relative = `app/data/${prefix}.${report.date}.${version}.json`;
    await writeFile(path.join(root, relative), bytes, { flag: 'wx' });
    return { path: relative, sha256: sha256RepositoryText(bytes) };
  };
  if (report.activeComparison.definitionsChanged) definitions = await install('original-definitions', inputs.currentDefinitionBytes);
  if (report.activeComparison.taskMapChanged) taskMap = await install('original-task-map', inputs.currentTaskBytes);
  if (changed) {
    const require = createRequire(import.meta.url);
    const { generateTaskNames, regenerateTaskMap } = require('./updateTasksMap.js');
    const activeTaskMap = JSON.parse(await readFile(path.join(root, inputs.activeSelection.taskMap.path)));
    const previous = await readOptionalJSON(path.join(root, 'app/data/legacy-task-current.json'), activeTaskMap);
    const history = JSON.parse(await readFile(path.join(root, 'app/data/legacy-task-history.json')));
    const conflicts = taskMapConflicts(activeTaskMap, inputs.currentTaskMap, { ...history, current: previous });
    if (conflicts.length) throw new Error(`Retained task history changed during review: ${conflicts.length} code conflicts; staged snapshots remain inactive.`);
    const seeded = regenerateTaskMap({ taskNames: [], taskMap: inputs.currentTaskMap, history }).history;
    const result = regenerateTaskMap({ taskNames: generateTaskNames(inputs.currentDefinitions), taskMap: previous, history: seeded });
    // Use the existing identity generator on a copy; old tokens and aliases stay.
    const registry = path.join(root, 'app/data/identity-registry.mjs');
    await writeFile(stagedRegistry, await readFile(registry), { flag: 'wx' });
    await promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts/update-identities.mjs'), '--definitions', path.join(root, definitions.path),
      '--registry', stagedRegistry, '--seed-only'], { cwd: root, windowsHide: true, timeout: 120000 });
    await writeFile(path.join(root, `app/data/identity-registry.${report.date}.${version}.mjs`), await readFile(stagedRegistry), { flag: 'wx' });
    // Existing identity pipeline order: preserve history before replacing current.
    for (const [relative, value] of [['app/data/legacy-task-history.json', result.history], ['app/data/legacy-task-current.json', result.current]]) {
      const target = path.join(root, relative), staged = target + '.origdata.tmp';
      await writeFile(staged, json(value), { flag: 'wx' });
      await rename(staged, target);
    }
    await rename(stagedRegistry, registry);
    const registryPin = report.audit.protectedFiles.find(row => row.path === 'app/data/identity-registry.mjs');
    if (registryPin) {
      registryPin.beforeSha256 = registryPin.sha256;
      registryPin.sha256 = sha256RepositoryText(await readFile(registry));
      registryPin.reason = 'Existing identity generator retained old tokens/aliases and added new rows; dated registry snapshot kept.';
    }
  }
  const selection = { schemaVersion: 1, checkedOn: report.date, definitions, taskMap,
    hashScope: 'SHA-256 of repository text with CRLF normalized to LF; source capture hashes use exact external bytes.',
    provenance: { frozenDefinitions: FROZEN[0], frozenTaskMap: FROZEN[1], source: report.capture,
      report: `docs/research/original-data-${report.date}.${version}.json`, generators: report.generators },
    adoption: report.adoption, protectedFiles: report.audit.protectedFiles };
  await writeFile(destination, json(selection), { flag: 'wx' });
  await writeFile(stagedLoader, source.replace(pattern, `import selection from './${name}'`), { flag: 'wx' });
  await rename(stagedLoader, loader);
  return selection;
}

function argumentsFor(args) {
  const options = { date: new Date().toISOString().slice(0, 10), version: 'v1' };
  while (args.length) {
    const key = args.shift();
    if (['--fetch', '--adopt'].includes(key)) options[key.slice(2)] = true;
    else if (['--current-dir', '--date', '--version'].includes(key) && args[0] && !args[0].startsWith('--')) options[key.slice(2)] = args.shift();
    else throw new Error('Usage: node scripts/compare-original-data.mjs [--fetch] [--current-dir DIR] [--date YYYY-MM-DD] [--version vN] [--adopt]');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || !/^v[1-9]\d*$/.test(options.version)) throw new Error('Invalid date or version.');
  options['current-dir'] ??= `.local/original-data/${options.date}`;
  return options;
}

export async function run(options, { root = ROOT } = {}) {
  const receipt = path.join(root, 'app/data', `original-data.${options.date}.${options.version}.json`);
  if (await exists(receipt)) throw new Error(`This date/version is already recorded. Its receipt and reports are kept; choose --version v2 (or the next unused version). No fetch or report write was performed.`);
  const directory = path.resolve(root, options['current-dir']);
  if (options.fetch) await fetchOriginalData(directory);
  const capture = JSON.parse(await readFile(path.join(directory, 'capture.json')));
  const currentBytes = [];
  for (const name of ORIGINAL_FILES) {
    const bytes = await readFile(path.join(directory, name));
    const evidence = capture.captures?.find(row => row.name === name);
    if (!evidence || evidence.url !== ORIGINAL_SITE + name || evidence.bytes !== bytes.length
      || evidence.sha256 !== sha256(bytes)) throw new Error(`Capture evidence mismatch: ${name}. No adoption.`);
    evidence.sha256 = sha256(bytes);
    currentBytes.push(bytes);
  }
  const [currentDefinitions, currentTaskMap] = currentBytes.map(bytes => JSON.parse(bytes));
  validateInputs(currentDefinitions, currentTaskMap);
  const frozen = [], frozenBytes = [];
  for (const relative of FROZEN) {
    const bytes = await readFile(path.join(root, relative));
    frozenBytes.push(bytes); frozen.push(JSON.parse(bytes));
  }
  const { loadOriginalData } = await import('../app/data/original-data.mjs');
  const active = await loadOriginalData({ root });
  const activeDefinitions = JSON.parse(active.definitionBytes), activeTaskMap = JSON.parse(active.taskBytes);
  const frozenComparison = compareOriginalData(frozen[0], currentDefinitions, frozen[1], currentTaskMap);
  frozenComparison.byteIdentical = frozenBytes.every((bytes, index) => bytes.equals(currentBytes[index]));
  const activeComparison = compareOriginalData(activeDefinitions, currentDefinitions, activeTaskMap, currentTaskMap);
  const audit = await auditLocalOverrides(activeDefinitions, currentDefinitions, { root });
  const history = JSON.parse(await readFile(path.join(root, 'app/data/legacy-task-history.json')));
  const current = await readOptionalJSON(path.join(root, 'app/data/legacy-task-current.json'), activeTaskMap);
  audit.conflicts.push(...taskMapConflicts(activeTaskMap, currentTaskMap, { ...history, current }));
  const rows = activeComparison.totals.added + activeComparison.totals.removed + activeComparison.totals.changed;
  const changed = activeComparison.definitionsChanged || activeComparison.taskMapChanged;
  const adoption = { status: audit.conflicts.length ? 'blocked' : changed ? 'ready for adoption' : 'unchanged',
    adopted: 0, skipped: audit.conflicts.length ? rows : 0,
    reason: audit.conflicts.length ? 'Local reviews need reconciliation; no runtime data was replaced.' : changed
      ? 'Run the same offline command with --adopt to install this reviewed batch.'
      : 'Zero changes apply today. Kept the existing bytes and recorded a dated check instead of duplicating identical data.' };
  const generators = [];
  for (const relative of ['scripts/compare-original-data.mjs', 'scripts/lib/original-data-compare.mjs', 'scripts/lib/original-data-overrides.mjs', 'scripts/updateTasksMap.js', 'scripts/update-identities.mjs']) {
    generators.push({ path: relative, sha256: sha256RepositoryText(await readFile(path.join(root, relative))) });
  }
  const report = { schemaVersion: 1, date: options.date, capture, frozenComparison, activeComparison, audit, adoption, generators };
  const output = path.join(root, 'docs/research', `original-data-${options.date}.${options.version}`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output + '.json', json(report));
  await writeFile(output + '.md', renderReport(report));
  if (options.adopt) {
    const adoptedReport = { ...report, adoption: changed && !audit.conflicts.length ? { ...adoption, status: 'adopted', adopted: rows,
      reason: 'Installed dated raw snapshots through the existing adapters and legacy task regeneration; kept historical inputs and local overlays.' } : adoption };
    await adoptOriginalData(adoptedReport, { activeSelection: active.selection, currentDefinitionBytes: currentBytes[0],
      currentTaskBytes: currentBytes[1], currentDefinitions, currentTaskMap }, { root, version: options.version });
    Object.assign(adoption, adoptedReport.adoption);
    await writeFile(output + '.json', json(report));
    await writeFile(output + '.md', renderReport(report));
  }
  console.log(`${path.relative(root, output)}.md\nUpstream entity views: ${frozenComparison.totals.added} new, ${frozenComparison.totals.removed} removed, ${frozenComparison.totals.changed} changed.\nAdopted ${adoption.adopted}; skipped ${adoption.skipped}; conflicts ${audit.conflicts.length}. ${adoption.reason}`);
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await run(argumentsFor(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
