// Disposable core-test instrumentation; application files remain untouched.
import { registerHooks } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { completeFixtureState } from './fixture-state.mjs';
const directory = process.env.CALC_CHECK_CAPTURE_DIR;
const stringify = JSON.stringify;
const states = new Set(), definitionsSeen = new Set();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let loaded = 0;
function plainData(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return typeof value !== 'function';
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value') && plainData(d.value, seen));
}
mkdirSync(directory, { recursive: true });
globalThis.__calcCheckCapture = (definitions, input, registry, world, catalogue = []) => {
  try {
    if (!plainData(input) || !input?.members?.length || input.members.some(m => typeof m?.id !== 'string')) return;
    const state = completeFixtureState(input, catalogue);
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision)) return;
    if (!plainData(definitions) || !definitions?.chunks || !definitions?.challenges) {
      const ids = new Set(state.members.flatMap(m => m.unlocked.map(id => String(id).split('-')[0])));
      if (world?.chunks instanceof Map) for (const id of world.chunks.keys()) ids.add(id);
      definitions = { chunks: Object.fromEntries([...ids].map(id => [id, {}])), challenges: {}, sections: {}, walkableChunks: [...ids].filter(id => /^\d+$/.test(id)), walkableChunksF2P: [...ids].filter(id => /^\d+$/.test(id)) };
    }
    const extraRules = (registry?.definitions ?? []).filter(r => !globalThis.__calcCheckBuiltins?.has(r.id)).map(({ candidates, exclude, ...metadata }) => metadata);
    const definitionBytes = stringify({ definitions, extraRules, datasetSelection: globalThis.__calcCheckDatasetSelection });
    const definitionHash = digest(definitionBytes), stateBytes = stringify(state);
    const stateHash = digest(stateBytes), key = digest(definitionHash + stateHash);
    if (states.has(key)) return;
    states.add(key);
    if (!definitionsSeen.has(definitionHash)) {
      definitionsSeen.add(definitionHash);
      writeFileSync(`${directory}/defs-${definitionHash}.json.gz`, gzipSync(definitionBytes));
    }
    writeFileSync(`${directory}/${key}.state.gz`, gzipSync(stateBytes));
    writeFileSync(`${directory}/${key}.entry`, stringify({ definitionHash, stateHash, key, revision: state.revision }));
  } catch (error) { if (error.code) throw error; /* Non-JSON test doubles are not saved games. */ }
};
process.on('exit', () => writeFileSync(`${directory}/${process.pid}.stats`, stringify({ states: states.size, loaded })));
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (/\/tests\/[^/]+\.test\.mjs$/.test(url)) loaded++;
  let source = result.source?.toString();
  if (url.endsWith('/app/dataset-runtime.mjs')) {
    source += '\nglobalThis.__calcCheckDatasetSelection = selectedDataset.workerSelection();\n';
  } else if (url.endsWith('/app/tasks/engine.mjs')) {
    source = source.replace('export function createTaskEngine(', 'function capturedTaskEngine(');
    source += '\nexport function createTaskEngine(definitions, options) { const engine = capturedTaskEngine(definitions, options); return Object.freeze({ ...engine, evaluate(state, memberId, options) { const result = engine.evaluate(state, memberId, options); globalThis.__calcCheckCapture(definitions, state, undefined, undefined, [...engine.catalogue, ...result.tasks ?? []]); return result; } }); }\n';
  } else if (url.endsWith('/app/core/state.mjs')) {
    for (const name of ['validateState', 'validateOwnedState', 'applyValidatedCommand']) {
      source = source.replace(`export function ${name}(`, `function captured_${name}(`);
      source += `\nexport function ${name}(...args) { const result = captured_${name}(...args); globalThis.__calcCheckCapture(args[2]?.world?.definitions, result, args[2]?.registry ?? args[1], args[2]?.world); return result; }\n`;
    }
  } else if (url.endsWith('/app/core/rules.mjs')) {
    source += '\nglobalThis.__calcCheckBuiltins = new Set(builtInRules.map(rule => rule.id));\n';
    for (const name of ['evaluateRollPool', 'reachableSections', 'partnerConnections']) {
      source = source.replace(`export function ${name}(`, `function captured_${name}(`);
      source += `\nexport function ${name}(...args) { const result = captured_${name}(...args); globalThis.__calcCheckCapture(args[0]?.definitions, args[1], args[3], args[0]); return result; }\n`;
    }
  } else return result;
  return { ...result, source };
} });
