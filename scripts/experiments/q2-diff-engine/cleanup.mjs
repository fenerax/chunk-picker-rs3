import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export async function cleanupOwned(out) {
  let owned;
  try { owned = JSON.parse(await readFile(path.join(out, 'owned.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const scratch = path.join(path.resolve(out), 'owned');
  if (owned.scratch !== scratch || !Array.isArray(owned.worktrees) || owned.worktrees.some(root =>
    !['reference', 'candidate'].some(name => root === path.join(scratch, name)))) throw Error('Invalid owned paths');
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  const registered = new Set(git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)));
  for (const root of [...owned.worktrees].reverse()) {
    // SIGKILL during checkout may leave the owned worktree locked. Two forces
    // remove only this validated path, even when its directory is already gone.
    if (registered.has(root)) git('worktree', 'remove', '--force', '--force', root);
  }
  await rm(scratch, { recursive: true, force: true });
}
