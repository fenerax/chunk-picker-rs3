// Write the same save-stage probes into an isolated temporary worktree before
// running save-path.mjs against it. No runtime module loader is patched.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function instrumentSavePath(root) {
  const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '-q', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  if (branch.status !== 1 || !path.basename(root).startsWith('perf-probe-')) throw Error('Use a detached temporary worktree named perf-probe-*.');
  const targets = {
    'app/storage/store.mjs': ['atomicWrite', 'prepared', 'retainBackup', 'serializedDiskState', 'compactHistory', 'playProjection', 'rollPools', 'commandSnapshot', 'capturedCalculation'],
    'app/core/state.mjs': ['applyValidatedCommand'],
    'app/server.mjs': ['bodyJSON', 'commandJSON'],
  };
  for (const [relative, names] of Object.entries(targets)) {
    const filename = path.join(root, relative);
    let source = (await readFile(filename, 'utf8')).replace(/\r\n/g, '\n');
    for (const name of names) {
      const pattern = new RegExp(`(async )?function ${name}\\(`);
      if (!pattern.test(source)) continue;
      source = source.replace(pattern, (_match, asyncKeyword = '') =>
        `function ${name}(...args) { return globalThis.__saveProbe ? globalThis.__saveProbe('${name}', __probe_${name}, args) : __probe_${name}(...args); }\n${asyncKeyword}function __probe_${name}(`);
    }
    if (relative === 'app/storage/store.mjs') for (const [name, expression] of Object.entries({ tempWrite: 'handle.writeFile(contents)', fsync: 'handle.sync()', rename: 'rename(temporary, file)' })) {
      source = source.replace('await ' + expression, `await (globalThis.__saveProbe ? globalThis.__saveProbe('${name}', () => ${expression}, []) : ${expression})`);
    }
    await writeFile(filename, source);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Pass an isolated temporary worktree.');
  await instrumentSavePath(path.resolve(process.argv[2]));
}
