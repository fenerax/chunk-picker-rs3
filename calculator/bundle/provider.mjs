import { encode } from './codec.mjs';
export const encodeDatasetValue = encode;
// Installed by the preload before the application's import graph is linked.
export function resolveDataset() {
  const provider = globalThis[Symbol.for('rs3.calculator.bundle.provider')];
  if (!provider) throw new Error('Calculator bundle was not installed.');
  return provider;
}
