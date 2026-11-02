import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeReport } from '../scripts/perf/profile-stack.mjs';

test('the streamed profile writer produces the same JSON as JSON.stringify', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'profile-writer-'));
  try {
    const report = { runs: 2, complete: true, skipped: undefined, summary: { cold: { median: 1.5 } },
      clicks: [{ scenario: 'cold', cpu: [{ top: [] }] }, undefined, { scenario: 'roll', wallMs: 3 }], empty: [], label: 'x"y' };
    const file = path.join(dir, 'profile.json');
    await writeReport(file, report);
    const text = await readFile(file, 'utf8');
    assert.equal(text, JSON.stringify(report));
    assert.deepEqual(JSON.parse(text).clicks[1], null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
