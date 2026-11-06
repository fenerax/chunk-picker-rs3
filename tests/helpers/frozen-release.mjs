import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './save-surface-corpus.mjs';

const execute = promisify(execFile);
export const manifest = JSON.parse(await readFile(new URL('../../docs/save-surface.json', import.meta.url), 'utf8'));
const git = (cwd, args) => execute('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

export async function requireFrozenCommit(repository = root, release = manifest.frozenRelease) {
  try { await git(repository, ['cat-file', '-e', `${release}^{commit}`]); }
  catch (cause) { throw new Error(`Required frozen rollback commit ${release} is missing. Fetch full history (git fetch --unshallow), then rerun the test.`, { cause }); }
}

/** Cache an independent exact-SHA repository, never a runner-specific .git
 * worktree pointer. Each test run still executes a temporary real git worktree.
 * CI caches this directory by OS and SHA; no live app modules are imported. */
export async function frozenRuntime(t) {
  // Even a cache hit must not conceal a shallow/missing source pin.
  await requireFrozenCommit();
  const cacheRoot = path.resolve(process.env.RS3_FROZEN_CACHE ?? path.join(root, '.local', 'frozen-release-cache'));
  await mkdir(cacheRoot, { recursive: true });
  const repository = path.join(cacheRoot, manifest.frozenRelease);
  await mkdir(repository, { recursive: true });
  let cached = false;
  try { cached = (await git(repository, ['rev-parse', 'HEAD'])).stdout.trim() === manifest.frozenRelease; } catch { /* cache miss */ }
  if (!cached) {
    await git(repository, ['init']);
    await git(repository, ['-c', 'protocol.file.allow=always', 'fetch', '--depth=1', root, manifest.frozenRelease]);
    await git(repository, ['checkout', '--detach', 'FETCH_HEAD']);
  }
  // Refuse edited cached source instead of accidentally testing a hybrid.
  const status = (await git(repository, ['status', '--porcelain', '--untracked-files=all'])).stdout;
  if (status.trim()) throw new Error('Frozen rollback cache is dirty; use a fresh RS3_FROZEN_CACHE directory.');
  const parent = path.join(root, '.local', 'save-surface-tests');
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, 'frozen-'));
  const checkout = path.join(temporary, 'checkout');
  try { await git(repository, ['worktree', 'add', '--detach', checkout, manifest.frozenRelease]); }
  catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  t.after(async () => {
    await git(repository, ['worktree', 'remove', checkout]);
    await rm(temporary, { recursive: true, force: true });
  });
  const load = relative => import(pathToFileURL(path.join(checkout, relative)).href);
  return { checkout, ...(await load('app/storage/store.mjs')), core: await load('app/core/state.mjs'),
    items: await load('app/plugin-items.mjs'), achievements: await load('app/plugin-achievements.mjs') };
}
