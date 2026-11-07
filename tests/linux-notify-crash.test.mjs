import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { notify } from '../scripts/linux/notify.mjs';
import { atomic, encode } from '../scripts/linux/files.mjs';

const now = Date.parse('2026-11-05T12:00:00Z');
const helper = fileURLToPath(new URL('./helpers/notify-crash.mjs', import.meta.url));
async function fixture(t, scenario) {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-crash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'notify-spool'));
  if (scenario === 'state') await atomic(path.join(dir, 'notify-state.json'), '{private-corrupt-bytes');
  else if (scenario === 'mailbox' || scenario === 'claimed') await atomic(path.join(dir, 'notify-spool',
    'unit-writer.critical.json' + (scenario === 'claimed' ? '.claimed' : '')), '{private-corrupt-bytes');
  else if (scenario === 'compaction') await atomic(path.join(dir, 'notify-state.json'), encode({ active: {}, announced: {}, sent: [],
    pending: Array.from({ length: 1000 }, (_, at) => ({ code: 'disk-low', ...(at % 2 ? {} : { level: 'urgent' }), at })) }));
  else await atomic(path.join(dir, 'notify-spool/unit-writer.critical.json'), encode({ code: 'unit-writer', level: 'critical', at: now, suppressed: false }));
  return dir;
}
function start(t, dir, phase = '', failSend = false) {
  const child = spawn(process.execPath, [helper, dir, phase, String(failSend)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  const message = Promise.race([once(child, 'message').then(([value]) => value),
    exited.then(() => { throw Error('Child exited before boundary: ' + stderr); })]);
  return { child, exited, message };
}

for (const scenario of ['state', 'mailbox', 'claimed', 'compaction', 'delivery', 'offline']) {
  test(`SIGKILL at every ${scenario} boundary retains eventual delivery`, { skip: process.platform !== 'linux'}, async t => {
    const baseline = await fixture(t, scenario), probe = start(t, baseline, '', scenario === 'offline');
    const { trace } = await probe.message;
    assert.deepEqual(await probe.exited, [0, null]); assert(trace.length > 0);
    for (const phase of new Set(trace)) await t.test(phase, async t => {
      const dir = await fixture(t, scenario), p = start(t, dir, phase, scenario === 'offline');
      assert.deepEqual(await p.message, { boundary: phase });
      // A quarantined file always has an already-published, fixed reset intent.
      if (phase === 'quarantine:renamed') assert.equal(await readFile(path.join(dir, 'notify-reset.json'), 'utf8'),
        encode({ code: 'notifier-reset', level: 'critical', at: 0 }));
      p.child.kill('SIGKILL'); assert.deepEqual(await p.exited, [null, 'SIGKILL']);
      const sent = [];
      // Simulate a wholly healthy next sample, including a failed first retry.
      await notify({ controlDir: dir, faults: {}, now: now + 600000, send: async () => { throw Error('offline'); } });
      for (let step = 1; step <= 5; step++) {
        const result = await notify({ controlDir: dir, faults: {}, merge: true, now: now + 600000 + step * 31000,
          send: async text => sent.push(text) });
        if (!result.pending) break;
      }
      const delivered = await readFile(path.join(dir, 'delivered.log'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
      const text = delivered + sent.join('\n');
      assert.match(text, scenario === 'state' || scenario === 'mailbox' || scenario === 'claimed' ? /CRITICAL: notifier state was reset/
        : scenario === 'compaction' ? /URGENT: Disk reserve is low/ : /CRITICAL: Writer service failed/);
      if (scenario === 'compaction') assert.match(text, /998 alerts were dropped/);
      assert(!text.includes('private-corrupt-bytes'));
      const state = JSON.parse(await readFile(path.join(dir, 'notify-state.json')));
      assert.deepEqual(state.pending, []); assert.equal(state.dropped, 0);
      await assert.rejects(readFile(path.join(dir, 'notify-reset.json')), { code: 'ENOENT' });
    });
  });
}
