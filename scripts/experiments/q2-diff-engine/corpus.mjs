// Public-only fixture harvest using the existing calc-check instrumentation.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { captureTests } from '../../../tools/calc-check/fixture-tools.mjs';
import { completeFixtureState } from '../../../tools/calc-check/fixture-state.mjs';
import { definitions, makeState, requestsFor } from '../y03-fuzz-ci/generator.mjs';
import { options, sha, harvestTests } from './inputs.mjs';
const [root, scratch, destination, countText] = process.argv.slice(2);
process.env.RS3_DATASET = 'duo-legacy';
process.env.RS3_PACKS_DIR = path.join(scratch, 'packs');
process.env.RS3_MAP_ASSETS_DIR = path.join(scratch, 'maps');
process.env.RS3_GAME_DATA_DIR = path.join(scratch, 'data');
const [{ createGroupState, validateState }, { taskId }] = await Promise.all([
  import(pathToFileURL(path.join(root, 'app/core/state.mjs'))), import(pathToFileURL(path.join(root, 'app/tasks/engine.mjs'))),
]);
const groups = [], raw = definitions();
function add(defs, states, source, datasetId, extraRules = []) {
  const definitionBytes = JSON.stringify(defs);
  const frames = states.flatMap((state, i) => {
    // The existing harvest includes partial unit-test states and intermediate
    // command snapshots. Preserve them as calc-check does, including history.
    if (source === 'synthetic') validateState(state);
    const requestState = { ...state, tasks: state.tasks.length ? state.tasks : [{ id: 'missing-task' }] };
    const requestDefinitions = { ...defs, chunks: Object.keys(defs.chunks ?? {}).length ? defs.chunks
      : Object.fromEntries(state.members.flatMap(m => m.unlocked).map(id => [id, {}])) };
    // Empty fixture worlds still exercise worker handling of an unknown chunk.
    if (!Object.keys(requestDefinitions.chunks).length) requestDefinitions.chunks = { '0': {} };
    return requestsFor(requestState, requestDefinitions, i).map(request => ({ state, request: { ...request,
      // Harvested snapshots are independent histories, not a revision stream.
      pickerId: 'q2-public-' + sha(JSON.stringify(state)).slice(0, 20), input: sha(JSON.stringify(state)), snapshotKey: sha(JSON.stringify(state)) } }));
  });
  groups.push({ source, datasetId, definitionBytes, datasetOptions: options, extraRules, frames });
}
add(raw, Array.from({ length: Number(countText) }, (_, i) => makeState(i, 19003 + i % 3, raw, createGroupState, taskId)), 'synthetic', 'duo-legacy');
const captureDir = path.join(scratch, 'harvest'); await mkdir(captureDir);
const coverage = await captureTests(root, harvestTests, captureDir);
const bundles = new Map();
for (const name of (await readdir(captureDir)).filter(name => name.endsWith('.entry')).sort()) {
  const entry = JSON.parse(await readFile(path.join(captureDir, name), 'utf8'));
  if (![entry.definitionHash, entry.stateHash, entry.key].every(value => /^[a-f0-9]{64}$/.test(value)) || name !== entry.key + '.entry') throw Error('Invalid harvest entry');
  const bytes = gunzipSync(await readFile(path.join(captureDir, 'defs-' + entry.definitionHash + '.json.gz')));
  const stateBytes = gunzipSync(await readFile(path.join(captureDir, entry.key + '.state.gz')));
  if (sha(bytes) !== entry.definitionHash || sha(stateBytes) !== entry.stateHash) throw Error('Invalid harvest digest');
  let group = bundles.get(entry.definitionHash);
  if (!group) { group = { ...JSON.parse(bytes), states: [] }; bundles.set(entry.definitionHash, group); }
  group.states.push(completeFixtureState(JSON.parse(stateBytes)));
}
for (const group of bundles.values()) add({ walkableChunks: [], walkableChunksF2P: [], ...group.definitions }, group.states, 'harvest', group.datasetSelection.datasetId ?? 'duo-legacy', group.extraRules);
if (!bundles.size || coverage.failed) throw Error('Incomplete fixture harvest');
groups.sort((a,b) => a.datasetId.localeCompare(b.datasetId));
await writeFile(destination, JSON.stringify({ groups, coverage, harvestTests }));
