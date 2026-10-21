import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { BACKUP_FORMAT, SCHEMA_VERSION, importBackup, validateState } from '../app/core/state.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { applyMetadataCorrections } from '../app/data/metadata-corrections.mjs';
import { preCorrectionSurfaceLodestones } from '../app/data/lodestones.mjs';

const staticFields = new Set(['tasks', 'identityRegistry', 'legacy', 'provenance']);
const staticId = /^static-([a-f0-9]{64})\.json\.gz$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const root = new URL('../', import.meta.url);

/** Read a portable state or private compact envelope without opening a store.
 * Static IDs hash decompressed bytes, not gzip bytes or reserialized JSON.
 * The store's 256 KiB threshold controls writing only; readers allow smaller
 * previously retained fields. References contain no size property.
 */
export async function loadPreviewState(filename) {
  const statePath = await realpath(filename);
  let bytes = await readFile(statePath);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const document = JSON.parse(bytes.toString('utf8'));
  if (!object(document)) throw new TypeError('State document must be an object.');
  if (!Object.hasOwn(document, 'state')) {
    if (document.storage !== undefined) throw new TypeError('Static storage requires a backup envelope.');
    return validateState(document);
  }
  if (document.format !== BACKUP_FORMAT || document.schemaVersion !== SCHEMA_VERSION) {
    throw new TypeError('Unsupported backup format or schema version.');
  }
  if (document.storage === undefined) return importBackup(document);
  const metadata = document.storage;
  if (!object(metadata) || metadata.schemaVersion !== 1 || !object(metadata.fields)
    || Object.keys(metadata).some(key => !['schemaVersion', 'fields'].includes(key)) || !object(document.state)) {
    throw new TypeError('Invalid static storage metadata.');
  }
  const state = { ...document.state };
  let staticDirectory;
  for (const [field, reference] of Object.entries(metadata.fields)) {
    if (!staticFields.has(field) || Object.hasOwn(state, field)) throw new TypeError(`Invalid stored static field: ${field}`);
    const match = object(reference) && typeof reference.id === 'string' && staticId.exec(reference.id);
    if (!match || reference.sha256 !== match[1] || Object.keys(reference).some(key => !['id', 'sha256'].includes(key))) {
      throw new TypeError(`Invalid static field reference: ${field}`);
    }
    const expectedDirectory = path.join(path.dirname(statePath), 'static');
    staticDirectory ??= await realpath(expectedDirectory);
    if (staticDirectory !== expectedDirectory) throw new TypeError('Unsafe static directory location.');
    const sidecarPath = await realpath(path.join(staticDirectory, reference.id));
    if (path.dirname(sidecarPath) !== staticDirectory) throw new TypeError(`Unsafe static field location: ${field}`);
    const fieldBytes = gunzipSync(await readFile(sidecarPath));
    if (createHash('sha256').update(fieldBytes).digest('hex') !== reference.sha256) {
      throw new TypeError(`Static field checksum mismatch: ${field}`);
    }
    state[field] = JSON.parse(fieldBytes.toString('utf8'));
  }
  return importBackup({ ...document, state });
}

function differences(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(field => {
    const beforeExists = Object.hasOwn(before, field), afterExists = Object.hasOwn(after, field);
    if (beforeExists === afterExists && isDeepStrictEqual(before[field], after[field])) return [];
    return [{ field, before: beforeExists ? before[field] : null, after: afterExists ? after[field] : null,
      ...(!beforeExists || !afterExists ? { beforeExists, afterExists } : {}) }];
  });
}

const availabilityFields = ['status', 'hidden', 'hiddenReasons', 'blockers', 'personalCompleted', 'challengeSatisfied', 'obligation', 'primaryMethod', 'sources', 'explanation'];
function availability(row) {
  return row ? Object.fromEntries(availabilityFields.map(field => [field, row[field] ?? null])) : {};
}
function indexedTasks(result) {
  const index = new Map();
  for (const row of result.tasks) {
    if (index.has(row.id)) throw new TypeError(`Duplicate generated task ID: ${row.id}`);
    index.set(row.id, row);
  }
  return index;
}

/** Pure comparison. Both engines evaluate the same validated personal facts.
 * Engine options permit a prior travel table to be compared with the new table.
 */
export function previewMetadataCorrections({ state, definitions, corrections, baselineEngineOptions = {}, correctedEngineOptions = {}, reviewedOverlays }) {
  const validated = validateState(state);
  const corrected = applyMetadataCorrections(definitions, { corrections });
  const policy = reviewedOverlays === undefined ? {} : { reviewedOverlays };
  const beforeEngine = createTaskEngine(definitions, { dataset: selectedDataset, ...policy, lodestones: preCorrectionSurfaceLodestones, ...baselineEngineOptions, metadataCorrections: false });
  // Default evaluation uses the app's overlay. Fixture corrections instead
  // use exactly the injected overlay, with no additional default corrections.
  const afterEngine = createTaskEngine(corrected, { dataset: selectedDataset, ...policy, ...correctedEngineOptions, metadataCorrections: corrections === undefined });
  const members = validated.members.map(member => {
    const before = indexedTasks(beforeEngine.evaluate(validated, member.id));
    const after = indexedTasks(afterEngine.evaluate(validated, member.id));
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
    const tasks = ids.flatMap(id => {
      const oldRow = before.get(id), newRow = after.get(id), row = newRow ?? oldRow;
      const metadata = differences(oldRow && definitions.challenges?.[oldRow.category]?.[oldRow.rawLabel], newRow && corrected.challenges?.[newRow.category]?.[newRow.rawLabel]);
      const availabilityChanges = differences(availability(oldRow), availability(newRow));
      if (!metadata.length && !availabilityChanges.length && oldRow?.label === newRow?.label && oldRow?.category === newRow?.category) return [];
      return [{ id, category: row.category, label: row.label,
        ...(oldRow?.label !== newRow?.label ? { labelBefore: oldRow?.label ?? null, labelAfter: newRow?.label ?? null } : {}),
        ...(!oldRow || !newRow ? { presence: { before: !!oldRow, after: !!newRow } } : {}),
        metadata, availability: availabilityChanges }];
    });
    return { id: member.id, name: member.name, checkedTaskCount: ids.length, changedTaskCount: tasks.length, tasks };
  });
  return { revision: validated.revision, members };
}

export function formatPreview(report) {
  const lines = [`Metadata correction preview (state revision ${report.revision})`];
  for (const member of report.members) {
    lines.push('', `${member.name} (${member.id}): ${member.changedTaskCount} changed / ${member.checkedTaskCount} checked tasks`);
    for (const task of member.tasks) {
      lines.push(`  ${task.category}: ${task.label} [${task.id}]`);
      if (task.presence) lines.push(`    presence: ${task.presence.before} -> ${task.presence.after}`);
      if (Object.hasOwn(task, 'labelBefore')) lines.push(`    label: ${JSON.stringify(task.labelBefore)} -> ${JSON.stringify(task.labelAfter)}`);
      for (const [kind, changes] of [['metadata', task.metadata], ['availability', task.availability]]) {
        for (const change of changes) {
          const value = (side, exists) => exists === false ? '(absent)' : JSON.stringify(side);
          lines.push(`    ${kind}.${change.field}: ${value(change.before, change.beforeExists)} -> ${value(change.after, change.afterExists)}`);
        }
      }
    }
  }
  return lines.join('\n');
}

const usage = 'Usage: node scripts/preview-metadata-corrections.mjs --state PATH [--definitions PATH] [--corrections PATH] [--synthetic-definitions] [--json]';
export async function runPreviewCli(args = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') { process.stdout.write(`${usage}\n`); return; }
    if (flag === '--synthetic-definitions') {
      if (options.syntheticDefinitions) throw new TypeError(usage);
      options.syntheticDefinitions = true; continue;
    }
    if (flag === '--json') {
      if (options.json) throw new TypeError(usage);
      options.json = true; continue;
    }
    if (!['--state', '--definitions', '--corrections'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--') || options[flag.slice(2)]) throw new TypeError(usage);
    options[flag.slice(2)] = args[++index];
  }
  if (!options.state || (options.syntheticDefinitions && !options.definitions)) throw new TypeError(usage);
  const state = await loadPreviewState(options.state);
  const definitions = JSON.parse(await readFile(options.definitions ?? new URL('rs3-chunkpicker-chunkinfo-export.json', root), 'utf8'));
  const corrections = options.corrections ? JSON.parse(await readFile(options.corrections, 'utf8')) : undefined;
  const report = previewMetadataCorrections({ state, definitions, corrections,
    ...(options.syntheticDefinitions ? { reviewedOverlays: false } : {}) });
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatPreview(report)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreviewCli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
