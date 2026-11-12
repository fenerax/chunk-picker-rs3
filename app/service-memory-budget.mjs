const MiB = 1024 * 1024;
export const BUDGET_SERVICE_CACHE_BYTES = 672 * MiB;
export const BUDGET_RESPONSE_CACHE_BYTES = 128 * MiB;

// Static partitions make the same service cap enforceable across isolates,
// without a controller retaining remote graphs or per-admission IPC.
export function serviceMemoryBudget({ env = process.env, calculators = 1 } = {}) {
  const profile = env.RS3_MEMORY_PROFILE ?? 'default';
  if (!['default', 'budget-672'].includes(profile)) throw new TypeError('Unknown memory profile.');
  if (!Number.isSafeInteger(calculators) || calculators < 1) throw new TypeError('Invalid calculator count.');
  const enforced = profile === 'budget-672' || env.RS3_SERVICE_CACHE_BYTES !== undefined;
  if (!enforced) {
    const responseBytes = boundedMemoryOption(env.RS3_RESPONSE_CACHE_BYTES, null);
    // Preserve the live cache policy until latency has been measured. null is
    // report-only, never a fabricated finite cap in the steady-state census.
    return Object.freeze({ profile: 'default', enforced, totalBytes: null, allocatedBytes: null,
      responseBytes, responseEntries: null, calculators, workerBytes: 384 * MiB,
      engineBytes: null, stateBytes: null, schedulerBytes: 320 * MiB });
  }
  const totalBytes = Number(env.RS3_SERVICE_CACHE_BYTES ?? BUDGET_SERVICE_CACHE_BYTES);
  const responseBytes = Number(env.RS3_RESPONSE_CACHE_BYTES ?? Math.floor(totalBytes * 4 / 21));
  if (![totalBytes, responseBytes, calculators].every(n => Number.isSafeInteger(n) && n >= 0)
    || calculators < 1 || responseBytes > totalBytes) throw new TypeError('Invalid service cache memory budget.');
  const available = totalBytes - responseBytes;
  const workerBytes = Math.floor(available * 8 / 17 / calculators);
  const engineBytes = Math.floor(available * 4 / 17 / calculators);
  const stateBytes = Math.floor(available / 17 / calculators);
  const schedulerBytes = Math.floor(available * 4 / 17);
  return Object.freeze({ profile: env.RS3_SERVICE_CACHE_BYTES === undefined ? 'budget-672' : 'budget-custom', enforced,
    totalBytes, responseBytes, responseEntries: 4096, calculators, workerBytes, engineBytes, stateBytes, schedulerBytes,
    allocatedBytes: responseBytes + schedulerBytes + calculators * (workerBytes + engineBytes + stateBytes) });
}

export function boundedMemoryOption(value, ceiling) {
  if (value === undefined) return ceiling;
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Invalid cache byte option.');
  return ceiling === null ? bytes : Math.min(bytes, ceiling);
}
