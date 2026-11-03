import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { prewarmCandidate } from '../scripts/linux/prewarm.mjs';

test('prewarm timeout kills a real child and SIGTERM-ignoring grandchild within the whole-tree budget',
  { skip: process.platform !== 'linux' && 'Linux process-group lifetime.' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prewarm-tree-'));
  const marker = path.join(directory, 'tree.json');
  let tree;
  t.after(async () => {
    if (tree) try { process.kill(-tree.parent, 'SIGKILL'); } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, 'scripts/linux'), { recursive: true });
  const grandchild = `process.on('SIGTERM', () => {}); process.send(process.pid); setInterval(() => {}, 1000);`;
  await writeFile(path.join(directory, 'scripts/linux/prewarm.mjs'), `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('message', pid => writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ parent: process.pid, grandchild: pid })));
    setInterval(() => {}, 1000);
  `);
  // Exercise process lifetime without any service lookup or calculator/cache I/O.
  const getuid = process.getuid; process.getuid = () => 1201;
  t.after(() => { process.getuid = getuid; });
  const timeoutMs = 2500, started = performance.now();
  const result = prewarmCandidate({ settings: { dataDir: path.join(directory, 'live') },
    candidate: { config: { coreRoot: directory, datasetId: 'open-f2p' } }, dataDir: path.join(directory, 'copy'), timeoutMs });
  while (!tree && performance.now() - started < 1500) {
    try { tree = JSON.parse(await readFile(marker, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!tree) await delay(20);
  }
  assert(tree, 'The real child and grandchild must be ready before timeout.');
  assert.equal(await result, false);
  // Allow scheduling jitter, while rejecting the old unbounded tree lifetime.
  assert(performance.now() - started < timeoutMs + 500);
  for (const pid of [tree.parent, tree.grandchild]) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      // A killed orphan can await init reaping; it cannot execute or write.
      assert(['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]), `Process ${pid} survived timeout.`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});
