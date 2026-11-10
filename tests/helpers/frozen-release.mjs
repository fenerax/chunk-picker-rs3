import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './save-surface-corpus.mjs';
import { openFrozenRuntime, requireFrozenCommit as requireCommit } from '../../scripts/lib/frozen-runtime.mjs';

export const manifest = JSON.parse(await readFile(new URL('../../docs/save-surface.json', import.meta.url), 'utf8'));
export const requireFrozenCommit = (repository = root, release = manifest.frozenRelease) => requireCommit(repository, release);

export async function frozenRuntime(t, { release = manifest.frozenRelease } = {}) {
  const runtime = await openFrozenRuntime({ repository: root, release,
    cacheRoot: path.resolve(process.env.RS3_FROZEN_CACHE ?? path.join(root, '.local', 'frozen-release-cache')),
    workRoot: path.join(root, '.local', 'save-surface-tests') });
  t.after(() => runtime.close());
  return runtime;
}
