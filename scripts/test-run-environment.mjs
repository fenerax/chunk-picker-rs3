import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Node validates cached bytecode against its source. Every assertion and every
// module's top-level initialization still runs in its own isolated test process.
export async function testRunEnvironment(environment = process.env) {
  if (environment.NODE_COMPILE_CACHE || environment.NODE_DISABLE_COMPILE_CACHE) {
    return { env: { ...environment }, cleanup: async () => {} };
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'picker-test-compile-'));
  return { env: { ...environment, NODE_COMPILE_CACHE: directory },
    cleanup: () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}
