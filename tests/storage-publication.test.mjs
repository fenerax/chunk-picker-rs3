import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { publishFile } from '../app/storage/publication.mjs';

const file = path.resolve('synthetic-save', 'state.json'), temporary = file + '.tmp';
function spy({ renameFailure, openFailure, syncFailure } = {}) {
  const events = [];
  const filesystem = {
    async rename(from, to) { events.push(['rename', from, to]); if (renameFailure) throw renameFailure; },
    async open(directory, flags) {
      events.push(['open', directory, flags]);
      if (openFailure) throw openFailure;
      return {
        async sync() { events.push(['sync']); if (syncFailure) throw syncFailure; },
        async close() { events.push(['close']); },
      };
    },
  };
  return { filesystem, events };
}

test('publication awaits rename before opening, syncing and closing the parent directory', async () => {
  const { filesystem, events } = spy();
  let finishRename;
  filesystem.rename = async (from, to) => {
    events.push(['rename', from, to]);
    await new Promise(resolve => { finishRename = resolve; });
    events.push(['renamed']);
  };
  const published = publishFile(temporary, file, { filesystem, platform: 'linux' });
  assert.deepEqual(events, [['rename', temporary, file]]);
  finishRename();
  assert.deepEqual(await published, { durable: true });
  assert.deepEqual(events, [['rename', temporary, file], ['renamed'], ['open', path.dirname(file), 'r'], ['sync'], ['close']]);
});

test('a failed rename never syncs the directory', async () => {
  const failure = Object.assign(new Error('Synthetic rename failure'), { code: 'EIO' });
  const { filesystem, events } = spy({ renameFailure: failure });
  await assert.rejects(publishFile(temporary, file, { filesystem, platform: 'linux' }), error => error === failure);
  assert.deepEqual(events, [['rename', temporary, file]]);
});

for (const policy of [undefined, 'throw']) test(`directory sync failure is fatal with ${policy ?? 'default'} policy and closes the handle`, async () => {
  const failure = Object.assign(new Error('Synthetic sync failure'), { code: 'EIO' });
  const { filesystem, events } = spy({ syncFailure: failure });
  await assert.rejects(publishFile(temporary, file, { filesystem, platform: 'linux', onPostPublishSyncError: policy }), error => error === failure);
  assert.deepEqual(events, [['rename', temporary, file], ['open', path.dirname(file), 'r'], ['sync'], ['close']]);
});

test('warn policy reports a published write after directory sync failure and closes the handle', async () => {
  const failure = Object.assign(new Error('Synthetic sync failure'), { code: 'EIO' });
  const { filesystem, events } = spy({ syncFailure: failure });
  assert.deepEqual(await publishFile(temporary, file, { filesystem, platform: 'linux', onPostPublishSyncError: 'warn' }), { durable: false, error: failure });
  assert.deepEqual(events.slice(-2), [['sync'], ['close']]);
});

test('Windows retries the same replacement before attempting an unsupported folder sync', async () => {
  const { filesystem, events } = spy({ openFailure: Object.assign(new Error('Unsupported directory open'), { code: 'EPERM' }) });
  let attempts = 0;
  filesystem.rename = async (from, to) => {
    events.push(['rename', from, to]);
    if (attempts++ < 2) throw Object.assign(new Error('Synthetic scanner contention'), { code: 'EACCES' });
  };
  await publishFile(temporary, file, { filesystem, platform: 'win32', wait: async ms => { events.push(['wait', ms]); } });
  assert.deepEqual(events, [['rename', temporary, file], ['wait', 20], ['rename', temporary, file], ['wait', 40],
    ['rename', temporary, file], ['open', path.dirname(file), 'r']]);
});

test('Windows replacement retries stay bounded and never remove the old destination', async () => {
  const failure = Object.assign(new Error('Synthetic scanner contention'), { code: 'EBUSY' });
  const { filesystem, events } = spy({ renameFailure: failure });
  const waits = [];
  await assert.rejects(publishFile(temporary, file, { filesystem, platform: 'win32', wait: async ms => { waits.push(ms); } }), error => error === failure);
  assert.equal(events.length, 7);
  assert(events.every(event => event[0] === 'rename' && event[1] === temporary && event[2] === file));
  assert.deepEqual(waits, [20, 40, 80, 160, 320, 640]);
});

test('unsupported directory sync errors are tolerated only on Windows', async () => {
  const failure = Object.assign(new Error('Unsupported directory sync'), { code: 'EINVAL' });
  for (const platform of ['linux', 'win32']) {
    const { filesystem, events } = spy({ syncFailure: failure });
    const published = publishFile(temporary, file, { filesystem, platform });
    if (platform === 'win32') assert.deepEqual(await published, { durable: true });
    else await assert.rejects(published, error => error === failure);
    assert.deepEqual(events.at(-1), ['close']);
  }
});

test('Windows still reports directory I/O failures', async () => {
  const failure = Object.assign(new Error('Synthetic directory I/O failure'), { code: 'EIO' });
  const { filesystem } = spy({ openFailure: failure });
  await assert.rejects(publishFile(temporary, file, { filesystem, platform: 'win32' }), error => error === failure);
});


for (const onPostPublishSyncError of ['warn', 'throw']) test(`directory close failure after rename follows ${onPostPublishSyncError} policy`, async () => {
  const failure = Object.assign(new Error('Synthetic close failure'), { code: 'EIO' });
  const { filesystem } = spy();
  filesystem.open = async () => ({ async sync() {}, async close() { throw failure; } });
  const published = publishFile(temporary, file, { filesystem, platform: 'linux', onPostPublishSyncError });
  if (onPostPublishSyncError === 'warn') assert.deepEqual(await published, { durable: false, error: failure });
  else await assert.rejects(published, error => error === failure);
});

test('invalid sync policy fails before publishing', async () => {
  const { filesystem, events } = spy();
  await assert.rejects(publishFile(temporary, file, { filesystem, onPostPublishSyncError: 'ignore' }), TypeError);
  assert.deepEqual(events, []);
});
