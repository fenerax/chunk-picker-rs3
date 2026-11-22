// @test full dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { viewerFixture } from './helpers/picker-routing-fixture.mjs';

const actor = memberId => ({ kind: 'invite', label: 'Synthetic login', inviteId: 'synthetic-' + memberId, memberId });
const scope = (pickerId, characterId) => ({ 'X-Picker-Id': pickerId, 'X-Character-Id': characterId });
const hash = key => createHash('sha256').update(key).digest('hex');
async function setup(t, options = {}) {
  const f = await groupHttpFixture(t, { progressSources: { webSource: 'official-api', officialApi: { async snapshot() { return { available: false }; } } }, ...options, dataset: { ...fixtureDataset, capabilities: { ...fixtureDataset.capabilities,
    features: { ...fixtureDataset.capabilities.features, runeMetrics: true, externalNames: true } } } });
  const owner = await f.login('101'), player = await f.login('102');
  const invitation = await f.send('/api/group-invites', owner.cookie, {});
  assert.equal(invitation.status, 200, invitation.text);
  const opened = await f.send(new URL(invitation.json().link).pathname, player.cookie); player.cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', player.cookie)).json(), playerId = review.characters[0].id;
  const joined = await f.send('/auth/group-invite/accept', player.cookie, { confirmed: true, reviewToken: review.reviewToken, characterId: playerId });
  assert.equal(joined.status, 200, joined.text);
  const d = await f.document(), pickerId = invitation.json().pickerId, ownerId = d.pickers.find(p => p.id === pickerId).ownerCharacterId;
  const memberId = d.characters.find(c => c.id === playerId).placement.memberId;
  const os = scope(pickerId, ownerId), ps = scope(pickerId, playerId);
  const state = async () => (await f.send('/api/state', owner.cookie, undefined, os)).json().state;
  const command = async (who, headers, command) => f.send('/api/command', who.cookie, { command, expectedRevision: (await state()).revision }, headers);
  const rename = (who, headers, memberId, name) => command(who, headers, { type: 'set-runescape-name', memberId, name });
  return { f, owner, player, pickerId, ownerId, playerId, memberId, os, ps, state, command, rename };
}

test('writer checks actual names for commands, Undo/Redo inverses, replacement and imports without rewriting attribution', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rename-writer-'));
  const original = createGroupState([{ id: 'a', name: 'Player' }, { id: 'b', name: 'Partner' }]);
  original.members[0].runescapeName = 'AccountA'; original.members[1].runescapeName = 'AccountB';
  let refuseRevocation = false;
  const changes = [], store = await openStore({ dataDir: directory, initialState: original, beforeMemberNameChange: names => {
    if (refuseRevocation) throw Object.assign(new Error('Synthetic revocation failure'), { status: 503 });
    changes.push(names);
  } });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true }); });
  const denied = promise => assert.rejects(promise, error => error.status === 403 && /login controlling/.test(error.message));
  await denied(store.command({ type: 'set-runescape-name', memberId: 'b', name: 'Other' }, 0, { actor: actor('a'), admin: true }));
  await denied(store.command({ type: 'set-runescape-name', memberId: 'a', name: 'Other' }, 0, { actor: { kind: 'master', label: 'Admin' }, admin: true }));
  const renamed = await store.command({ type: 'set-runescape-name', memberId: 'b', name: 'NewB' }, 0, { actor: actor('b') });
  const event = structuredClone(renamed.history[0]);
  await denied(store.command({ type: 'undo', undoRevision: 1 }, 1, { actor: actor('a'), admin: true }));
  await store.command({ type: 'undo', undoRevision: 1 }, 1, { actor: actor('b') });
  await denied(store.command({ type: 'set-runescape-name', memberId: 'b', name: 'NewB' }, 2, { actor: actor('a') }));
  const redone = await store.command({ type: 'set-runescape-name', memberId: 'b', name: 'NewB' }, 2, { actor: actor('b') });
  assert.deepEqual(redone.history[0], { ...event, undoneRevision: 2 });
  const incoming = structuredClone(redone); incoming.members[1].runescapeName = 'ImportedB';
  incoming.history = [];
  await denied(store.replace(exportBackup(incoming), 3, { actor: actor('a') }));
  const replacement = { ...incoming.members[1] };
  await denied(store.command({ type: 'replace-member', memberId: 'b', member: replacement }, 3, { actor: actor('a') }));
  await store.command({ type: 'replace-member', memberId: 'b', member: replacement }, 3, { actor: actor('b') });
  await denied(store.command({ type: 'undo', undoRevision: 4 }, 4, { actor: actor('a') }));
  await store.replace(exportBackup(incoming), 4, { actor: actor('b') });
  assert.equal(store.getState().members[1].runescapeName, 'ImportedB');
  assert.equal(changes.length, 4); // Refused writes and same-name restore have no effects.
  refuseRevocation = true;
  const beforeFailure = store.getState();
  await assert.rejects(store.command({ type: 'set-runescape-name', memberId: 'b', name: 'Refused' }, beforeFailure.revision, { actor: actor('b') }), /revocation failure/);
  assert.deepEqual(store.getState(), beforeFailure);
});

test('HTTP refuses partner rename/Undo and owner restore of another name; self rename projects and revokes only exact keys', async t => {
  const h = await setup(t), { f, owner, player, pickerId, playerId, memberId, os, ps } = h;
  assert.equal((await h.rename(owner, os, 'owner', 'First_Name')).status, 200);
  assert.equal((await h.rename(player, ps, memberId, 'Partner')).status, 200);
  const keys = [];
  for (const [who, headers, id] of [[owner, os, 'owner'], [player, ps, memberId]]) {
    const r = await f.send('/api/game-plugin/keys', who.cookie, { memberId: id, label: 'Synthetic plugin' }, headers);
    assert.equal(r.status, 201, r.text); keys.push(r.json().key);
  }
  const before = await h.state(), partner = before.members.find(m => m.id === memberId);
  const forbidden = await h.rename(owner, os, memberId, 'Stolen');
  assert.equal(forbidden.status, 403, forbidden.text); assert.match(forbidden.json().message, /login controlling/);
  assert.deepEqual(await h.state(), before);
  const renamed = await h.rename(player, ps, memberId, 'Renamed'); assert.equal(renamed.status, 200, renamed.text);
  const saved = await h.state(), nameEvent = saved.history.at(-1);
  assert.equal((await h.command(owner, os, { type: 'undo', undoRevision: saved.revision })).status, 403);
  assert.deepEqual((await h.state()).members.find(m => m.id === memberId), { ...partner, runescapeName: 'Renamed' });
  assert.equal((await f.send('/api/characters', player.cookie)).json().characters.find(c => c.id === playerId).runescapeName, 'Renamed');
  const capabilities = (await f.document()).capabilities;
  assert.ok(capabilities.some(c => c.hash === hash(keys[0]))); assert.ok(!capabilities.some(c => c.hash === hash(keys[1])));
  const keyFile = path.join(f.multiPicker.pickerRoot, pickerId, 'plugin-keys.json');
  assert.deepEqual(JSON.parse(await readFile(keyFile)).keys.map(k => k.revoked), [false, true]);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + keys[1] })).status, 401);
  const backup = (await f.send('/api/backup', owner.cookie, undefined, os)).json();
  backup.state.members.find(m => m.id === memberId).runescapeName = 'FromBackup';
  backup.state.history = [];
  const preview = await f.send('/api/restore/preview', owner.cookie, { backup }, os); assert.equal(preview.status, 403, preview.text);
  const restore = await f.send('/api/restore', owner.cookie, { backup, expectedRevision: saved.revision }, os);
  assert.equal(restore.status, 403, restore.text); assert.match(restore.json().message, /login controlling/);
  assert.deepEqual((await h.state()).history.at(-1), nameEvent);
  const undone = await h.command(player, ps, { type: 'undo', undoRevision: saved.revision }); assert.equal(undone.status, 200, undone.text);
  const input = { backup, memberId, sourceMemberId: memberId };
  const mapPreview = await f.send('/api/member-restore/preview', owner.cookie, input, os); assert.equal(mapPreview.status, 200, mapPreview.text);
  const mapRefused = await f.send('/api/member-restore', owner.cookie, { ...input, previewToken: mapPreview.json().previewToken, expectedRevision: (await h.state()).revision }, os);
  assert.equal(mapRefused.status, 403, mapRefused.text);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + keys[0] })).status, 200);
  backup.state.members.find(m => m.id === 'owner').runescapeName = 'ImportedSelf';
  const ownInput = { backup, memberId: 'owner', sourceMemberId: 'owner' };
  const selfPreview = await f.send('/api/member-restore/preview', owner.cookie, ownInput, os); assert.equal(selfPreview.status, 200, selfPreview.text);
  const selfRestore = await f.send('/api/member-restore', owner.cookie, { ...ownInput, previewToken: selfPreview.json().previewToken, expectedRevision: (await h.state()).revision }, os);
  assert.equal(selfRestore.status, 200, selfRestore.text);
  assert.equal((await h.state()).members.find(m => m.id === 'owner').runescapeName, 'ImportedSelf');
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + keys[0] })).status, 401);
  await f.restart();
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + keys[1] })).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + keys[0] })).status, 401);
});

test('formatting changes keep keys but expire web/plugin reviews, and normalized changes require new pairing', async t => {
  const h = await setup(t), { f, owner, os } = h;
  assert.equal((await h.rename(owner, os, 'owner', 'First_Name')).status, 200);
  const keyResponse = await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Synthetic plugin' }, os);
  const key = keyResponse.json().key, auth = { Authorization: 'Bearer ' + key };
  const report = seq => ({ v: 1, seq, sentAt: new Date().toISOString(), world: { id: 84, beta: false }, position: { x: 46, z: 49, floor: 0 }, skills: { ATTACK: { level: 20, xp: 4470 } } });
  assert.equal((await f.send('/api/plugin/v1/report', '', report(0), auth)).status, 200);
  const plugin = (await f.send('/api/game-plugin/review?memberId=owner', owner.cookie, undefined, os)).json();
  assert.ok(plugin.previewId);
  const web = await f.send('/api/runemetrics/preview', owner.cookie, { memberId: 'owner' }, os); assert.equal(web.status, 200, web.text);
  const preview = web.json(); assert.ok(preview.previewId);
  assert.equal((await h.rename(owner, os, 'owner', 'first name')).status, 200);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, auth)).status, 200);
  assert.deepEqual((await f.send('/api/game-plugin/review?memberId=owner', owner.cookie, undefined, os)).json(), { preview: null });
  assert.equal((await f.send('/api/runemetrics/apply', owner.cookie, { previewId: preview.previewId, expectedRevision: (await h.state()).revision }, os)).status, 410);
  assert.equal((await f.send('/api/game-plugin/apply', owner.cookie, { previewId: plugin.previewId, expectedRevision: (await h.state()).revision }, os)).status, 410);
  assert.equal((await f.send('/api/plugin/v1/report', '', report(1), auth)).status, 200);
  assert.ok((await f.send('/api/game-plugin/review?memberId=owner', owner.cookie, undefined, os)).json().previewId);
  const unchangedWeb = (await f.send('/api/runemetrics/preview', owner.cookie, { memberId: 'owner' }, os)).json();
  assert.ok(unchangedWeb.previewId);
  assert.equal((await h.rename(owner, os, 'owner', ' first name ')).status, 200);
  assert.equal((await h.state()).members.find(member => member.id === 'owner').runescapeName, 'first name');
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, auth)).status, 200);
  assert.deepEqual((await f.send('/api/game-plugin/review?memberId=owner', owner.cookie, undefined, os)).json(), { preview: null });
  assert.equal((await f.send('/api/runemetrics/apply', owner.cookie, { previewId: unchangedWeb.previewId, expectedRevision: (await h.state()).revision }, os)).status, 410);
  assert.equal((await h.rename(owner, os, 'owner', 'NewAccount')).status, 200);
  assert.equal((await f.send('/api/plugin/v1/report', '', report(2), auth)).status, 401);
  assert.deepEqual((await f.send('/api/game-plugin/review?memberId=owner', owner.cookie, undefined, os)).json(), { preview: null });
  const paired = await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Paired again' }, os); assert.equal(paired.status, 201, paired.text);
  assert.equal((await f.send('/api/plugin/v1/report', '', report(0), { Authorization: 'Bearer ' + paired.json().key })).status, 200);
});

test('a viewer gets a clear refusal without changing names or History', async t => {
  const f = await viewerFixture(t);
  const before = (await f.send('/api/state', f.viewerCookie, { headers: { 'X-Picker-Id': f.groupId } })).json().state;
  const refused = await f.send('/api/command', f.viewerCookie, { headers: { 'X-Picker-Id': f.groupId },
    body: { expectedRevision: before.revision, command: { type: 'set-runescape-name', memberId: 'owner', name: 'Other' } } });
  assert.equal(refused.status, 403, refused.text); assert.match(refused.json().message, /view only/i);
  assert.deepEqual((await f.send('/api/state', f.viewerCookie, { headers: { 'X-Picker-Id': f.groupId } })).json().state, before);
});

test('renaming to a normalized duplicate within the same login requires explicit acknowledgement without changing keys or History first', async t => {
  const h = await setup(t), { f, owner, pickerId, ownerId, os } = h;
  assert.equal((await h.rename(owner, os, 'owner', 'Hero_One')).status, 200);
  const second = await f.send('/api/characters', owner.cookie, { requestId: 'second-for-dup', runescapeName: 'SecondChar' });
  assert.equal(second.status, 200, second.text);
  const secondChar = second.json().character, ss = scope(secondChar.placement.pickerId, secondChar.id);
  const secondKey = (await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Second plugin' }, ss)).json().key;
  const beforeSecond = (await f.send('/api/state', owner.cookie, undefined, ss)).json().state;
  // Normalized duplicate ("hero one" matches "Hero_One") refuses with DUPLICATE_CHARACTER_NAME before mutating or revoking keys.
  const duplicate = await f.send('/api/command', owner.cookie, { expectedRevision: beforeSecond.revision, command: { type: 'set-runescape-name', memberId: 'owner', name: 'hero one' } }, ss);
  assert.equal(duplicate.status, 409, duplicate.text);
  assert.equal(duplicate.json().code, 'DUPLICATE_CHARACTER_NAME');
  assert.deepEqual((await f.send('/api/state', owner.cookie, undefined, ss)).json().state, beforeSecond);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + secondKey })).status, 200);
  // Non-boolean acknowledgeDuplicate is rejected.
  const badFlag = await f.send('/api/command', owner.cookie, { expectedRevision: beforeSecond.revision, acknowledgeDuplicate: 'yes', command: { type: 'set-runescape-name', memberId: 'owner', name: 'hero one' } }, ss);
  assert.equal(badFlag.status, 400, badFlag.text);
  // Explicit acknowledgement commits the rename, projects into the character menu, and revokes the renamed character's key.
  const confirmed = await f.send('/api/command', owner.cookie, { expectedRevision: beforeSecond.revision, acknowledgeDuplicate: true, command: { type: 'set-runescape-name', memberId: 'owner', name: 'hero one' } }, ss);
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal((await f.send('/api/state', owner.cookie, undefined, ss)).json().state.members[0].runescapeName, 'hero one');
  assert.equal((await f.send('/api/characters', owner.cookie)).json().characters.find(c => c.id === secondChar.id).runescapeName, 'hero one');
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + secondKey })).status, 401);
  // Formatting-only edit on the already-acknowledged duplicate does not re-prompt or revoke its new key.
  const newKey = (await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Repaired' }, ss)).json().key;
  const revAfter = (await f.send('/api/state', owner.cookie, undefined, ss)).json().state.revision;
  const formatted = await f.send('/api/command', owner.cookie, { expectedRevision: revAfter, command: { type: 'set-runescape-name', memberId: 'owner', name: 'Hero_One' } }, ss);
  assert.equal(formatted.status, 200, formatted.text);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + newKey })).status, 200);
  // Original character's group remains untouched.
  assert.equal((await f.send('/api/state', owner.cookie, undefined, os)).json().state.members.find(m => m.id === 'owner').runescapeName, 'Hero_One');
});
