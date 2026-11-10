import { createIdentityDictionary, reconcileIdentityDictionary, isIdentityDictionary, freezeIdentityTree } from '../tasks/identity-dictionary.mjs';

const taskBases = new WeakMap(), residentBases = new WeakMap();
export const isResidentState = state => residentBases.has(state);
export const hasResidentIdentities = state => isIdentityDictionary(state?.identityRegistry?.entries)
  && isIdentityDictionary(state?.identityRegistry?.aliases);

/** Read-only validation, archive hydration and command snapshots own all group
 * payload/events, while sharing immutable catalogue trees. Not a portable copy. */
export function cloneResidentState(state) {
  if (!isResidentState(state) || !Object.isFrozen(state.tasks) || state.identityRegistry !== undefined
    && (!hasResidentIdentities(state) || !Object.isFrozen(state.identityRegistry))) {
    throw new TypeError('Expected immutable resident catalogue');
  }
  const copy = Object.fromEntries(Object.entries(state).map(([key, value]) => [key,
    key === 'tasks' || key === 'identityRegistry' ? value : structuredClone(value)]));
  residentBases.set(copy, residentBases.get(state));
  return copy;
}
export function freezeResidentCatalogue(state) {
  freezeIdentityTree(state.tasks);
  return state;
}
export function reconcileResidentIdentities(state, previous) {
  residentBases.set(state, residentBases.get(previous));
  if (state.identityRegistry !== undefined && !hasResidentIdentities(state)) state.identityRegistry = freezeIdentityTree(Object.fromEntries(Object.entries(state.identityRegistry).map(([key, value]) => [key,
    key === 'entries' || key === 'aliases' ? reconcileIdentityDictionary(previous.identityRegistry[key], value) : value])));
  return freezeResidentCatalogue(state);
}
/** Input is fully validated detached logical JSON, never a save codec. */
export function shareResidentCatalogue(state, base) {
  if (!Object.isFrozen(base) || !Object.isFrozen(base.tasks) || !Object.isFrozen(base.identityRegistry)) {
    throw new TypeError('Expected a verified frozen owned base');
  }
  let rows = taskBases.get(base);
  if (!rows) { rows = new Map(base.tasks.map(row => [row.id, row])); taskBases.set(base, rows); }
  state.tasks = state.tasks.map(row => JSON.stringify(row) === JSON.stringify(rows.get(row.id)) ? rows.get(row.id) : row);
  if (state.identityRegistry !== undefined) {
    state.identityRegistry = freezeIdentityTree(Object.fromEntries(Object.entries(state.identityRegistry).map(([key, value]) => [key,
      key === 'entries' || key === 'aliases' ? createIdentityDictionary(base.identityRegistry[key], value) : value])));
  }
  residentBases.set(state, base);
  return freezeResidentCatalogue(state);
}
