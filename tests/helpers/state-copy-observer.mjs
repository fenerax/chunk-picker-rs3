import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Instrument the real validator/copy boundaries, including internal calls that
// cannot be replaced through an ESM namespace spy. No production counters.
export function observeStateCopies(sourceFor = (_url, source) => source) {
  let active;
  const full = value => value?.members && value?.tasks && Object.hasOwn(value, 'legacy');
  globalThis.__recordStateCopy = (kind, value) => {
    if (active && (kind === 'residentCopies' || full(value))) active[kind]++;
    if (active && kind === 'validations' && !full(value)) active.partialValidations++;
  };
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = (value, ...args) => {
    if (active && full(value)) active.structuredCopies++;
    return clone(value, ...args);
  };
  const hook = registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (!/\/app\/(core\/(state|resident-copy)|storage\/store|game-plugin)\.mjs$/.test(url)) return loaded;
    let source = sourceFor(url, String(loaded.source));
    const replacements = url.endsWith('/core/state.mjs') ? [
      ['function validateStateCopy(copy, registry, cache) {', "globalThis.__recordStateCopy?.('validations', copy);"],
      ['function jsonClone(value) {', "globalThis.__recordStateCopy?.('jsonCopies', value);"],
      ['export function materializeResidentState(state) {', "globalThis.__recordStateCopy?.('materializations', state);"],
    ] : url.endsWith('/core/resident-copy.mjs') ? [
      ['export function cloneResidentState(state) {', "globalThis.__recordStateCopy?.('residentCopies', state);"],
    ] : [];
    for (const [anchor, counter] of replacements) {
      assert.equal(source.split(anchor).length, 2, anchor);
      source = source.replace(anchor, `${anchor}\n${counter}`);
    }
    return { ...loaded, source };
  } });
  return { loaded: () => hook.deregister(), async measure(work) {
    assert.equal(active, undefined, 'counter scopes cannot overlap');
    const counts = active = { structuredCopies: 0, jsonCopies: 0, residentCopies: 0, materializations: 0, validations: 0, partialValidations: 0 };
    try { return { result: await work(), counts }; }
    finally { active = undefined; }
  } };
}
