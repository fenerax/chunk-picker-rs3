// Shared exact-SHA rollback harness. No network fetches and no live app imports.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export const FROZEN_RELEASE = '06e15939dbf73ecd1a0e7bc9c29088e0281ca11e';
const git = (cwd, args) => {
  const windows = process.platform === 'linux' && process.env.RS3_TEST_WINDOWS_GIT === '1';
  const winPath = value => value.replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:/`);
  return execute(windows ? '/mnt/c/Program Files/Git/cmd/git.exe' : 'git',
    windows ? ['-C', winPath(cwd), ...args.map(winPath)] : args,
    { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
};
export async function requireFrozenCommit(repository, release = FROZEN_RELEASE) {
  const provision = `Provision a local Git repository with git fetch --no-tags --depth=1 origin ${release}, then set --frozen-repository or RS3_FROZEN_REPOSITORY.`;
  if (typeof repository !== 'string' || !path.isAbsolute(repository)) throw new Error(`Frozen rollback repository is missing. ${provision}`);
  try { await git(repository, ['cat-file', '-e', `${release}^{commit}`]); }
  catch (cause) { throw new Error(`Required frozen rollback commit ${release} is missing. ${provision}`, { cause }); }
}
export async function openFrozenRuntime({ repository, cacheRoot, workRoot, release = FROZEN_RELEASE }) {
  await requireFrozenCommit(repository, release);
  await mkdir(cacheRoot, { recursive: true });
  const cache = path.join(cacheRoot, release);
  await mkdir(cache, { recursive: true });
  let cached = false;
  try { cached = (await git(cache, ['rev-parse', 'HEAD'])).stdout.trim() === release; } catch { /* cache miss */ }
  if (!cached) {
    await git(cache, ['init']);
    await git(cache, ['-c', 'protocol.file.allow=always', 'fetch', '--depth=1', repository, release]);
    await git(cache, ['checkout', '--detach', 'FETCH_HEAD']);
  }
  if ((await git(cache, ['status', '--porcelain', '--untracked-files=all'])).stdout.trim()) throw new Error('Frozen rollback cache is dirty; use a fresh RS3_FROZEN_CACHE directory.');
  await mkdir(workRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(workRoot, 'frozen-')), checkout = path.join(temporary, 'checkout');
  try { await git(cache, ['worktree', 'add', '--detach', checkout, release]); }
  catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  const close = async () => {
    await git(cache, ['worktree', 'remove', checkout]);
    await rm(temporary, { recursive: true, force: true });
  };
  try {
    const load = relative => import(pathToFileURL(path.join(checkout, relative)).href);
    return { release, checkout, close, ...(await load('app/storage/store.mjs')), core: await load('app/core/state.mjs'),
      items: await load('app/plugin-items.mjs'), achievements: await load('app/plugin-achievements.mjs') };
  } catch (error) { await close(); throw error; }
}
