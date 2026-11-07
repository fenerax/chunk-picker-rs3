import './helpers/file-safety-stop.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prewarmCandidate } from '../scripts/linux/prewarm.mjs';

test('prewarm timeout kills a real child and SIGTERM-ignoring grandchild after the controlled whole-tree deadline',
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
    child.once('message', pid => { const tree = { parent: process.pid, grandchild: pid }; writeFileSync(${JSON.stringify(marker)}, JSON.stringify(tree)); process.send(tree); });
    setInterval(() => {}, 1000);
  `);
  // Exercise process lifetime without any service lookup or calculator/cache I/O.
  const getuid = process.getuid; process.getuid = () => 1201;
  t.after(() => { process.getuid = getuid; });
  const clock = createManualClock(), ready = Promise.withResolvers();
  let child, closed;
  const result = prewarmCandidate({ settings: { dataDir: path.join(directory, 'live') },
    candidate: { config: { coreRoot: directory, datasetId: 'open-f2p' } }, dataDir: path.join(directory, 'copy'), timeoutMs: 2500, clock,
    execute(program, args, options) {
      child = spawn(program, args, { ...options, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      closed = once(child, 'close'); child.once('message', ready.resolve);
      return child;
    } });
  tree = await Promise.race([ready.promise, result.then(() => { throw new Error('Prewarm ended without starting its process tree'); })]);
  await clock.advance(2250);
  await closed;
  await clock.advance(250);
  assert.equal(await result, false);
  for (const pid of [tree.parent, tree.grandchild]) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      // A killed orphan can await init reaping; it cannot execute or write.
      assert(['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]), `Process ${pid} survived timeout.`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});
