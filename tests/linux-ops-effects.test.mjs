import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { effects, installEffects, chown, chmod, lstat, open, rename, rm, spawn } from './helpers/linux-ops-effects.mjs';

test('Linux ops effects preserve inode ownership and open-description locks', async file => {
  file.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.UTC(2026, 0, 1) });
  const restore = installEffects(); file.after(restore);
  const { atomic, exclusive } = await import('../scripts/linux/files.mjs');
  async function fixture(t) {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'linux-ops-effects-'));
    t.after(async () => {
      effects.hook = null;
      assert.equal(effects.handles.size, 0); assert.equal(effects.children.size, 0);
      await fs.rm(root, { recursive: true, force: true });
    });
    return root;
  }
  const flock = async (handle, wait = false) => {
    const child = spawn('flock', ['--exclusive', ...(wait ? ['--wait', '5'] : ['--nonblock']), '3'],
      { stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
    return (await once(child, 'close'))[0];
  };

  await file.test('replacement gets the incoming owner while renamed directories and hard links retain theirs', async t => {
    const root = await fixture(t), directory = path.join(root, 'tree'), moved = path.join(root, 'moved');
    await fs.mkdir(directory); await fs.mkdir(path.join(directory, 'nested'));
    const name = path.join(directory, 'nested', 'ledger'); await fs.writeFile(name, 'old');
    await chown(directory, 1001, 1002); await chmod(directory, 0o750);
    await chown(name, 1003, 1004); await chmod(name, 0o640);
    const handle = await open(name, 'r'); t.after(() => handle.close());
    await rename(directory, moved);
    const ledger = path.join(moved, 'nested', 'ledger'), alias = path.join(root, 'alias');
    assert.equal((await lstat(moved)).uid, 1001); assert.equal((await lstat(moved)).mode & 0o777, 0o750);
    assert.equal((await lstat(ledger)).gid, 1004);
    await fs.link(ledger, alias); await chown(alias, 1005, 1006);
    assert.equal((await lstat(ledger, { bigint: true })).uid, 1005n);
    await atomic(ledger, 'replacement');
    assert.equal((await lstat(ledger)).uid, 0); assert.equal((await lstat(ledger)).gid, 0);
    assert.equal((await lstat(ledger)).mode & 0o777, 0o600);
    assert.equal((await lstat(alias)).uid, 1005);
    await handle.chown(1007, 1008); await handle.chmod(0o620);
    assert.equal((await handle.stat()).uid, 1007); assert.equal((await lstat(alias)).gid, 1008);
    assert.equal((await lstat(alias)).mode & 0o777, 0o620);
    assert.equal((await lstat(ledger)).uid, 0);
    await handle.close();
    await chown(ledger, 1009, 1010); await rm(moved, { recursive: true });
    await fs.mkdir(path.join(moved, 'nested'), { recursive: true }); await fs.writeFile(ledger, 'recreated');
    assert.equal((await lstat(moved)).uid, 0); assert.equal((await lstat(ledger)).uid, 0);
  });

  await file.test('flock survives child exit and pathname changes until the owning description closes', async t => {
    const root = await fixture(t), name = path.join(root, 'guard'), alias = path.join(root, 'alias');
    await fs.writeFile(name, ''); await fs.link(name, alias);
    const first = await open(name, 'a'), second = await open(alias, 'a');
    t.after(async () => { await first.close(); await second.close(); });
    assert.equal(await flock(first), 0); assert.equal(effects.children.size, 0);
    assert.equal(await flock(first), 0, 'inherited descriptors share one lock owner');
    assert.equal(await flock(second), 1, 'a distinct open description contends on the same inode');
    await rename(name, path.join(root, 'renamed'));
    assert.equal(await flock(second), 1, 'renaming never releases the inode lock');
    const waiting = once(effects.lockEvents, 'waiting'), pending = flock(second, true);
    await waiting;
    await first.close(); assert.equal(await pending, 0);
    await second.close();
    const reopened = await open(alias, 'a');
    try { assert.equal(await flock(reopened), 0); } finally { await reopened.close(); }
  });

  await file.test('contended wait expiration uses only the controlled clock', async t => {
    const root = await fixture(t), name = path.join(root, 'guard'); await fs.writeFile(name, '');
    const first = await open(name, 'a'), second = await open(name, 'a');
    t.after(async () => { await first.close(); await second.close(); });
    assert.equal(await flock(first), 0);
    const waiting = once(effects.lockEvents, 'waiting'), pending = flock(second, true);
    await waiting; file.mock.timers.tick(5000);
    assert.equal(await pending, 1); assert.equal(await flock(second), 1);
    await first.close(); assert.equal(await flock(second), 0); await second.close();
  });

  await file.test('concurrent exclusive publishers serialize before the owner file exists', async t => {
    const root = await fixture(t), lock = path.join(root, 'operation.lock');
    const publishing = Promise.withResolvers(), publish = Promise.withResolvers();
    const acting = Promise.withResolvers(), finish = Promise.withResolvers();
    let publications = 0, callbacks = 0, first, second;
    effects.hook = async ({ operation, stage, args: [from, to] }) => {
      if (operation === 'rename' && stage === 'before' && to === lock) {
        publications++; publishing.resolve(); await publish.promise;
      }
    };
    try {
      first = exclusive(lock, async () => { callbacks++; acting.resolve(); await finish.promise; return 'first'; });
      await publishing.promise;
      await assert.rejects(fs.lstat(lock), { code: 'ENOENT' });
      const waiting = once(effects.lockEvents, 'waiting');
      second = assert.rejects(exclusive(lock, () => { callbacks++; }), { code: 'EEXIST' });
      await waiting;
      assert.equal(publications, 1); assert.equal(callbacks, 0);
      publish.resolve(); await acting.promise; await second;
      assert.equal(publications, 1); assert.equal(callbacks, 1);
      finish.resolve(); assert.equal(await first, 'first');
      assert.equal(await exclusive(lock, () => 'after close'), 'after close');
    } finally {
      publish.resolve(); finish.resolve(); effects.hook = null;
      await Promise.allSettled([first, second]);
    }
  });
});
