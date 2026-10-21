import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, applyValidatedCommand, createGroupState, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';

const invite = { kind: 'invite', inviteId: 'invite_player2', label: 'Player 2' };
const master = { kind: 'master', label: 'Player 1' };
const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
const now = () => '2026-10-08T12:00:00.000Z';
const world = { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() };
const initial = () => createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2', sourceMapId: 'qxb' }]);

async function directory(t) {
  const root = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'invite-attribution-'));
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(root) + path.sep));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('sync and undo identify the caller while preserving the original event actor', () => {
  const sync = { type: 'sync-original', capturedAt: now(), sourceHash: `sha256:${'a'.repeat(64)}`,
    members: [{ memberId: 'player2', sourceMapId: 'qxb', groups: ['chunks'], unlocked: ['101'] }] };
  const state = applyCommand(initial(), sync, { actor: invite, now });
  const undone = applyCommand(state, { type: 'undo' }, { actor: master, now });
  assert.deepEqual(undone.members[1].unlocked, []);
  assert.deepEqual(undone.history.map(event => event.actor), [invite, master]);
  assert.equal(undone.history[0].undoneRevision, 2);
  assert.equal(undone.history[1].command.undoRevision, 1);
  assert.deepEqual(importBackup(exportBackup(undone)).history, undone.history);
});

