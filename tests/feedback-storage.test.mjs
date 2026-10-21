import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openFeedbackStore } from '../app/storage/feedback.mjs';

const root = fileURLToPath(new URL('../.local/feedback-tests/', import.meta.url));
const owner = { kind: 'master', label: 'Player' };
const reed = { kind: 'invite', inviteId: 'reed-link', memberId: 'reed', label: 'Reed' };
async function fixture(t, document) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'storage-'));
  if (document) await writeFile(path.join(dataDir, 'feedback.json'), JSON.stringify(document));
  let store = await openFeedbackStore({ dataDir });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, get store() { return store; }, async restart() { await store.close(); store = await openFeedbackStore({ dataDir }); } };
}

test('seen state survives restart and acknowledges only displayed IDs, including handled notes', async t => {
  const f = await fixture(t);
  const first = await f.store.add({ kind: 'bug', text: 'First' }, reed);
  const displayed = f.store.list().map(item => item.id);
  const arrival = await f.store.add({ kind: 'idea', text: 'Racing arrival' }, reed);
  await f.store.setStatus(first.id, 'done');
  assert.deepEqual(f.store.summary(owner, true), { unread: 2 });
  assert.deepEqual(await f.store.markSeen(displayed, owner, true), { unread: 1 });
  await f.restart();
  assert.deepEqual(f.store.summary({ ...owner, label: 'New label' }, true), { unread: 1 });
  assert.equal(f.store.list().find(item => item.id === first.id).status, 'done');
  await f.store.markSeen([arrival.id], owner, true);
  assert.deepEqual(f.store.summary(owner, true), { unread: 0 });
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir, 'feedback.json'), 'utf8')).seen.master.length, 2);
});

test('linked players share own notes and seen state while unrelated equal labels remain private', async t => {
  const f = await fixture(t);
  const item = await f.store.add({ kind: 'other', text: 'My note' }, reed);
  const samePlayer = { ...reed, inviteId: 'different-link', label: 'New name' };
  const unrelated = { kind: 'invite', inviteId: 'other-link', label: 'Reed' };
  assert.deepEqual(f.store.own(samePlayer).map(value => value.id), [item.id]);
  assert.deepEqual(f.store.own(unrelated), []);
  assert.deepEqual(f.store.own({ ...reed, memberId: 'another-player' }), []);
  await f.store.markSeen([item.id], reed, true);
  assert.deepEqual(f.store.summary(samePlayer, true), { unread: 0 });
  assert.deepEqual(f.store.summary(unrelated, true), { unread: 1 });
  await assert.rejects(f.store.markSeen([item.id], unrelated), { status: 400 });
  await f.store.setStatus(item.id, 'done');
  assert.equal(f.store.own(samePlayer)[0].status, 'done');
});

test('old sidecars retain invitation ownership and begin unread without label matching', async t => {
  const legacy = { id: 'legacy', kind: 'bug', text: 'Old note', status: 'new', from: { label: 'Reed', inviteId: 'legacy-link' } };
  const f = await fixture(t, { schemaVersion: 1, items: [legacy] });
  assert.deepEqual(f.store.summary(owner, true), { unread: 1 });
  assert.equal(f.store.own({ kind: 'invite', inviteId: 'legacy-link', memberId: 'reed' }).length, 1);
  assert.equal(f.store.own({ kind: 'invite', inviteId: 'other', label: 'Reed' }).length, 0);
  await f.store.markSeen(['legacy'], owner, true);
  await f.restart();
  assert.deepEqual(f.store.summary(owner, true), { unread: 0 });
  assert.throws(() => f.store.markSeen('everything', owner, true), { status: 400 });
});

test('a linked player own-list acknowledgment preserves the same member admin seen IDs', async t => {
  const f = await fixture(t);
  const other = await f.store.add({ kind: 'bug', text: 'Someone else’s report' }, owner);
  const own = await f.store.add({ kind: 'idea', text: 'My report' }, reed);
  await f.store.markSeen([other.id], reed, true);
  await f.store.markSeen([own.id], { ...reed, inviteId: 'ordinary-link' });
  assert.deepEqual(f.store.summary(reed, true), { unread: 0 });
  await f.restart();
  assert.deepEqual(f.store.summary(reed, true), { unread: 0 });
  await assert.rejects(f.store.markSeen([other.id], reed), { status: 400 });
});
