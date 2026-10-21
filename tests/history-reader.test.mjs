import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { readHistoryEvents } from '../app/storage/history-reader.mjs';

async function fixture(t, contents) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-history-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'segment.json.gz');
  await writeFile(file, gzipSync(contents));
  return file;
}

test('archive reader parses individual events across UTF-8, escaped strings and nested undo boundaries', async t => {
  const events = Array.from({ length: 4000 }, (_, index) => ({ revision: index + 1, type: 'set-note',
    command: { note: `Player 🦉 ${index} \\" [ ] } { ,`, memberId: 'actor1' }, undo: { rows: [{ note: 'before' }] } }));
  const file = await fixture(t, JSON.stringify({ format: 'rs3-chunk-picker-history', events }));
  const parsed = [];
  for await (const event of readHistoryEvents(file)) parsed.push(event);
  assert.deepEqual(parsed, events);
});

test('archive reader never JSON-parses the whole inflated segment', async t => {
  const events = Array.from({ length: 20000 }, (_, index) => ({ revision: index + 1, type: 'catalogue-refresh' }));
  const file = await fixture(t, JSON.stringify({ format: 'rs3-chunk-picker-history', events }));
  const original = JSON.parse;
  let maximum = 0, count = 0;
  JSON.parse = (value, ...args) => { maximum = Math.max(maximum, value.length); return original(value, ...args); };
  try { for await (const event of readHistoryEvents(file)) { assert.equal(event.revision, ++count); } }
  finally { JSON.parse = original; }
  assert.equal(count, 20000);
  assert.ok(maximum < 100, `Largest parsed JSON value was ${maximum} characters`);
});

test('archive reader rejects corrupt envelopes and missing source files', async t => {
  for (const contents of [
    '{"format":"wrong","events":[]}',
    '{"format":"rs3-chunk-picker-history","events":[{"revision":1,"type":"restore"},]}',
    '{"format":"rs3-chunk-picker-history","events":[{"revision":1,"type":"restore"}',
    '{"format":"rs3-chunk-picker-history","events":[]} trailing',
  ]) {
    const file = await fixture(t, contents);
    await assert.rejects(async () => { for await (const event of readHistoryEvents(file)) void event; });
  }
  await assert.rejects(async () => { for await (const event of readHistoryEvents(path.join(os.tmpdir(), 'rs3-history-file-does-not-exist.gz'))) void event; }, { code: 'ENOENT' });
});
