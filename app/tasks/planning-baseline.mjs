import { gzipSync, gunzipSync } from 'node:zlib';
import { serialize, deserialize } from 'node:v8';
import { projectPlayTask } from '../play-task.mjs';
import { buildChunkPlanningIndex } from './chunk-planning-index.mjs';

// Independent of the calculator/result caches. Oversized baselines fall back to
// the existing advisory calculator; planning never asks the save lane for work.
export const PLANNING_BASELINE_BYTES = 32 * 1024 * 1024;
export const PLANNING_BASELINE_RAW_BYTES = 128 * 1024 * 1024;
const fields = ['Chunks', 'Objects', 'NPCs', 'Monsters', 'Monster', 'Shops', 'Spawns', 'Items', 'SourceLocations', 'ClueTier'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
function chunk(record) {
  return { ...pick(record, ['Name', 'Object', 'NPC', 'Monster', 'Shop', 'Spawn']),
    ...(record.Sections ? { Sections: Object.fromEntries(Object.entries(record.Sections).map(([id, row]) => [id, chunk(row)])) } : {}) };
}

/** Transport the evaluated statuses, never evaluate a reduced task graph. The
 * declaration fields are exactly those read by buildChunkPlanningIndex. */
export function encodePlanningBaseline(definitions, result, world) {
  const value = {
    definitions: { chunks: Object.fromEntries(Object.entries(definitions.chunks ?? {}).map(([id, row]) => [id, chunk(row)])),
      taskUnlocks: pick(definitions.taskUnlocks, ['Objects', 'NPCs', 'Monsters', 'Shops', 'Spawns']),
      codeItems: pick(definitions.codeItems, ['chunksPlus', 'objectsPlus', 'npcsPlus', 'monstersPlus', 'shopsPlus', 'itemsPlus']), clues: definitions.clues },
    chunks: [...world?.chunks?.keys?.() ?? []], areas: [...world?.areas?.keys?.() ?? []],
    result: { access: result.access, tasks: (result.tasks ?? []).map(task => ({
      id: task.id, display: projectPlayTask(task, { retainHiddenDisplay: true }), record: pick(task.record, fields),
      sources: task.sources?.map(source => pick(source, ['location', 'locations', 'name', 'source', 'kind'])),
    })) },
  };
  const raw = serialize(value);
  if (raw.length > PLANNING_BASELINE_RAW_BYTES) return;
  const bytes = gzipSync(raw, { level: 1 });
  return bytes.length <= PLANNING_BASELINE_BYTES ? bytes : undefined;
}

export function decodePlanningBaseline(bytes) {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength > PLANNING_BASELINE_BYTES) throw new TypeError('Invalid planning baseline.');
  return deserialize(gunzipSync(bytes, { maxOutputLength: PLANNING_BASELINE_RAW_BYTES }));
}
export function indexPlanningBaseline(value) {
  return buildChunkPlanningIndex(value.definitions, value.result, { chunks: new Map(value.chunks.map(id => [id, null])), areas: new Map(value.areas.map(id => [id, null])) });
}
export function projectChunkPlanning(baseline, index, chunkId) {
  return { format: 'chunk-planning-v1', chunkId, rows: [...(index.byLocation.get(String(chunkId))?.values() ?? [])].map(({ task, evidence }) => ({
    task: { ...(task.display ?? projectPlayTask(task, { retainHiddenDisplay: true })), ...(task.record?.ClueTier !== undefined ? { record: { ClueTier: task.record.ClueTier } } : {}) }, evidence,
  })), clueLocations: index.clueLocations.get(String(chunkId)) ?? [], access: baseline.access };
}
