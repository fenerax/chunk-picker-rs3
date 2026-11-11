// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { applyCommand } from '../app/core/state.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { createOwnedStorage } from '../app/storage/owned-storage.mjs';
import { fixture, options, commands, first, custom, world, now, taskCatalogue } from './helpers/owned-format2-fixture.mjs';

const settings = { world: { ...world, surface: new Set(['100', '101']) }, now, taskCatalogue, random: () => 0, completionCodec: false };
test('default-off delta sessions preserve saved state and serialized replies in both formats', { timeout: 240000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-delta-validation-'));
  const handles = [];
  t.after(async () => { for (const store of handles) await store.close(); await rm(root, { recursive: true, force: true }); });
  for (const format of [1, 2]) for (const archived of [false, true]) await t.test(`format ${format}, archive ${archived}`, async () => {
    const built = fixture(), stores = [], directories = [], wire = [];
    if (format === 2) {
      const publisherDir = path.join(root, `publisher-${archived}`);
      await mkdir(publisherDir);
      const publisher = createOwnedStorage(options(path.join(root, `catalogue-${format}-${archived}`)), publisherDir);
      await publisher.withLease(() => publisher.ensurePublished());
    }
    let state = built.state;
    state.members[1].completedTasks = ['first-alias'];
    // Put the only undoable event in the archive, so the first Undo crosses it.
    if (archived) state = applyCommand(state, { type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Archived synthetic' }, settings);
    for (const deltaValidation of [false, true]) {
      const dataDir = path.join(root, `${format}-${archived}-${deltaValidation}`);
      await mkdir(path.join(dataDir, 'history'), { recursive: true });
      const saved = structuredClone(state);
      if (archived) {
        const id = 'history-0000000000000001-0000000000000001-0000000000000000.json.gz';
        await writeFile(path.join(dataDir, 'history', id), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events: saved.history })));
        saved.history = []; saved.provenance = { historyArchive: [{ id }] };
      }
      await writeFile(path.join(dataDir, 'state.json'), JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1,
        ...(format === 2 ? ownedCodec(built.base, built.pin).encode(saved) : { state: saved }) }) + '\n');
      const store = await openStore({ ...settings, dataDir, deltaValidation, retention: false,
        ownedFormat2: format === 2 ? options(path.join(root, `catalogue-${format}-${archived}`)) : false });
      handles.push(store); stores.push(store); directories.push(dataDir);
    }
    const sequence = [
      ...(archived ? [{ type: 'undo' }] : []),
      { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first, first] },
      { type: 'set-note', memberId: 'member-2', chunkId: '101', note: 'Synthetic note' },
      { type: 'undo' },
      ...commands,
      { type: 'undo' },
      { type: 'set-task-status', memberId: 'member-1', taskId: custom, favorite: true },
    ];
    for (const command of sequence) {
      const replies = [];
      for (const [index, store] of stores.entries()) {
        try {
          const result = await store.commandSerialized(command, store.getInfo().revision, { view: 'play-v1' });
          replies.push({ accepted: true, ...result });
        } catch (error) { replies.push({ accepted: false, message: error.message }); }
        wire[index] = await readFile(path.join(directories[index], 'state.json'), 'utf8');
      }
      assert.deepEqual(replies[1], replies[0], `serialized reply: ${JSON.stringify(command)}`);
      assert.equal(wire[1], wire[0], 'exact saved envelope bytes');
      assert.deepEqual(stores[1].getState(), stores[0].getState());
      assert.deepEqual((await stores[1].backup()).state, (await stores[0].backup()).state);
    }
    for (const store of stores) await store.close();
    // Fresh sessions cannot rely on a previous process's in-memory proof.
    const reopened = [];
    for (const [index, dataDir] of directories.entries()) {
      const store = await openStore({ ...settings, dataDir, retention: false, deltaValidation: index === 1,
        ownedFormat2: format === 2 ? options(path.join(root, `catalogue-${format}-${archived}`)) : false });
      handles.push(store); reopened.push(store);
    }
    assert.deepEqual(reopened[1].getState(), reopened[0].getState());
    for (const store of reopened) await store.close();
  });
  await t.test('hook output crosses full validation after a hot command', async () => {
    for (const ownedFormat2 of [false, options(path.join(root, 'hook-catalogue'))]) {
      const store = await openStore({ ...settings, dataDir: path.join(root, `hook-${!!ownedFormat2}`), ownedFormat2,
        initialState: fixture().state, deltaValidation: true,
        prepareState(state, { operation }) { if (operation === 'command') state.tasks[1].memberIds = ['absent']; return state; } });
      handles.push(store);
      await assert.rejects(() => store.command({ type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic' }, 0), /absent member/);
      assert.equal(store.getInfo().revision, 0);
      await store.close();
    }
  });
});
