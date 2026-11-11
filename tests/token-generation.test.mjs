// @test quick dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateToken } from '../app/security/tokens.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('ordinary tokens redraw every case variant of the reserved plugin prefix', () => {
  const draws = [];
  for (const g of ['g', 'G']) for (const p of ['p', 'P']) for (const k of ['k', 'K']) {
    draws.push(Buffer.from(`${g}${p}${k}_${'A'.repeat(39)}`, 'base64url'));
  }
  const accepted = Buffer.alloc(32, 17);
  draws.push(accepted);
  let calls = 0;
  const token = generateToken(size => {
    assert.equal(size, 32);
    assert.ok(calls < draws.length, 'unexpected extra random draw');
    return draws[calls++];
  });
  assert.equal(calls, 9);
  assert.ok(token === accepted.toString('base64url'));
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
  assert.ok(!/^gpk_/i.test(token));
});

test('ordinary tokens accept a plugin prefix occurring after the start', () => {
  const bytes = Buffer.from(`Agpk_${'A'.repeat(38)}`, 'base64url');
  let calls = 0;
  const token = generateToken(() => { assert.equal(++calls, 1); return bytes; });
  assert.ok(token === bytes.toString('base64url'));
});

test('a persisted reserved-prefix access token is preserved without an existing rotation mechanism', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-token-generation-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const tokenFile = path.join(dataDir, 'access-token');
  const persisted = `GpK_${'A'.repeat(39)}\n`;
  await writeFile(tokenFile, persisted, { mode: 0o600 });
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'owner', name: 'Player 1' }]),
    tokenRandomBytes: () => { assert.fail('existing credentials must not rotate on load'); } });
  t.after(() => store.close());
  assert.ok(store.getAccessToken() === persisted.trim());
  assert.ok(await readFile(tokenFile, 'utf8') === persisted);
});
