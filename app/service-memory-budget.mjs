const MiB = 1024 * 1024;
export const DEFAULT_SERVICE_CACHE_BYTES = 672 * MiB;
export const DEFAULT_RESPONSE_CACHE_BYTES = 128 * MiB;

// Static partitions make the same service cap enforceable across isolates,
// without a controller retaining remote graphs or per-admission IPC.
export function serviceMemoryBudget({ env = process.env, calculators = 1 } = {}) {
  const totalBytes = Number(env.RS3_SERVICE_CACHE_BYTES ?? DEFAULT_SERVICE_CACHE_BYTES);
  const responseBytes = Number(env.RS3_RESPONSE_CACHE_BYTES ?? Math.floor(totalBytes * 4 / 21));
  if (![totalBytes, responseBytes, calculators].every(n => Number.isSafeInteger(n) && n >= 0)
    || calculators < 1 || responseBytes > totalBytes) throw new TypeError('Invalid service cache memory budget.');
  const available = totalBytes - responseBytes;
  const workerBytes = Math.floor(available * 8 / 17 / calculators);
  const engineBytes = Math.floor(available * 4 / 17 / calculators);
  const stateBytes = Math.floor(available / 17 / calculators);
  const schedulerBytes = Math.floor(available * 4 / 17);
  return Object.freeze({ totalBytes, responseBytes, calculators, workerBytes, engineBytes, stateBytes, schedulerBytes,
    allocatedBytes: responseBytes + schedulerBytes + calculators * (workerBytes + engineBytes + stateBytes) });
}

export function boundedMemoryOption(value, ceiling) {
  if (value === undefined) return ceiling;
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Invalid cache byte option.');
  return Math.min(bytes, ceiling);
}
