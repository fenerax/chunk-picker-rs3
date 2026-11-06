import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { createGroupState, validateState, preferenceDefinitions, importLegacyMaps } from '../../app/core/state.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { openStore } from '../../app/storage/store.mjs';
import { openPluginItems } from '../../app/plugin-items.mjs';
import { openPluginAchievements } from '../../app/plugin-achievements.mjs';
import { openPluginKeys } from '../../app/plugin-keys.mjs';
import { openAccountStore } from '../../app/storage/accounts.mjs';
import { openInviteStore } from '../../app/storage/invites.mjs';
import { openFeedbackStore } from '../../app/storage/feedback.mjs';
import { openUsageStore } from '../../app/storage/usage.mjs';
import { usageEvents } from '../../app/web/usage-catalogue.mjs';
import { mapTransferRoster, quarantineTransferChunks } from '../../app/save-transfer.mjs';
import { openOverlays } from '../../app/overlays.mjs';
import { openLiveTimings } from '../../app/live-timings.mjs';
import { createDeepProfiles } from '../../app/deep-profiles.mjs';
import { createWarmStore, warmHash } from '../../app/tasks/warm-store.mjs';
import { migrateTaskIdentities } from '../../app/tasks/migration.mjs';
import { preserveGameIdentity } from '../../app/game-profile.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const at = '2026-11-01T12:00:00.000Z';
export const roster = [{ id: 'synthetic-one', name: 'Explorer 1', runescapeName: 'FixtureActor' },
  { id: 'synthetic-two', name: 'Explorer 2' }];
export const tasks = [
  { id: 'custom:surface', category: 'Custom', label: 'Synthetic custom task', memberIds: [roster[0].id] },
  { id: 'rs3:task:surface-quest', category: 'Quest', label: 'Synthetic quest' },
  { id: 'rs3:task:surface-diary', category: 'Diary', label: 'Synthetic achievement' },
  { id: 'rs3:goal:surface-item', category: 'BiS', label: 'Synthetic item' },
  { id: 'rs3:task:surface-skill', category: 'Mining', skill: 'Mining', level: 2, label: 'Synthetic skill', completionIds: ['synthetic-completion'] },
];
export const world = { chunks: new Map(['100', '101', '102', '103'].map(id => [id, { id }])),
  neighbors: new Map(), walkable: new Set(['100', '101', '102', '103']), f2p: new Set(['100', '101', '102', '103']) };
export const storeOptions = { retention: { backupDays: 1, historyEntries: 2 }, now: () => at, world,
  taskCatalogue: new Map(tasks.map(task => [task.id, task])), progressQuestPoints: new Map([[tasks[1].id, 1]]) };

function seed() {
  const state = createGroupState(roster), member = state.members[0];
  state.tasks = structuredClone(tasks);
  // Synthetic legacy input exercises the real importer, without reading a map.
  const legacy = importLegacyMaps({ maps: { synthetic: { chunks: { unlocked: ['100'] }, chunkNotes: { 100: 'Synthetic legacy note' } } } },
    { members: [{ id: 'synthetic', name: 'Explorer', mapId: 'synthetic' }], capturedAt: at }).state;
  state.legacy = legacy.legacy; state.provenance = legacy.provenance;
  state.legacy.syntheticPadding = 'x'.repeat(270000); // Real static-field threshold.
  state.identityRegistry = { schemaVersion: 1, entries: Object.fromEntries(tasks.filter(task => task.id.startsWith('rs3:')).map(task =>
    [task.id, { ...task, kind: 'task', aliases: [] }])),
    aliases: { 'synthetic-alias': tasks[1].id, 'synthetic-ambiguous': [tasks[1].id, tasks[2].id] }, unresolved: [] };
  Object.assign(member, {
    unlocked: ['100'], selected: ['101'], pendingRoll: ['102'], blacklisted: ['103'],
    obtainedEquipment: ['Synthetic equipment'], notes: { 100: 'Synthetic note' }, journal: 'Synthetic journal',
    taskStatus: { [tasks[0].id]: { backlogged: true, backlogReason: 'Synthetic reason', favorite: true, note: 'Synthetic status', challengeCompleted: true } },
    taskRules: { 'Synthetic retained rule': true }, sectionOverrides: { '100-1': true },
    sourceBacklogs: { objects: { 'Synthetic object': true }, npcs: { 'Synthetic NPC': true }, monsters: { 'Synthetic monster': true },
      shops: { 'Synthetic shop': true }, spawns: { 'Synthetic spawn': true }, items: { 'Synthetic item': true } },
    areaOverrides: { 'Synthetic area': true }, preferences: {}, primaryOverrides: { Mining: true },
    passiveLevels: { Mining: 2 }, maxLevels: { Mining: 3 }, slayerLock: { level: 2, monster: 'Synthetic monster', boss: 'Synthetic boss' },
    stickers: { 100: [{ id: 'synthetic-sticker', type: 'star', color: '#abcdef', text: 'Synthetic marker' }] },
    chunkColours: { 100: 'red' }, chunkColourNames: { red: 'Synthetic colour' },
    taskAlternatives: { Custom: { 'Synthetic choice': tasks[0].id } }, xpChoices: { [tasks[1].id]: ['Mining', null] }, bossUnlocks: { 'synthetic-boss': true },
    f2pMap: { unlocked: ['100'], at }, teleportOverrides: { 'synthetic-route': true },
    teleports: [{ id: 'synthetic-teleport', label: 'Synthetic teleport', destination: '100', available: true, consumable: false }],
    transportFacts: { levels: { Mining: 2 }, quests: { 'Synthetic quest': true }, items: { 'Synthetic item': 1 },
      currencies: { coins: 100 }, conditions: { 'Synthetic condition': true }, confirmations: { 'Synthetic confirmation': true } },
  });
  for (const preference of preferenceDefinitions) member.preferences[preference.id] = preference.default
    ?? (preference.type === 'boolean' ? true : preference.type === 'enum' ? preference.options[0] : preference.type === 'color' ? '#abcdef' : '');
  member.preferences.topBarHidden = ['search'];
  // Use the dataset's public source identifier without embedding account IDs.
  const sourceMapId = selectedDataset.gameDefaults?.members?.find(row => row.mapId)?.mapId;
  if (sourceMapId) member.originalPickerSync = { sourceMapId, capturedAt: at, appliedAt: at, sourceHash: `sha256:${'a'.repeat(64)}`, groups: ['chunks'] };
  return validateState(state);
}

export async function scratch(t, label = 'corpus') {
  const parent = path.join(root, '.local', 'save-surface-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, `${label}-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Observe actual serializedDiskState output, not exportBackup's projection. */
export async function diskSnapshot(dataDir) {
  const files = [];
  const walk = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else files.push(relative);
    }
  };
  await walk(dataDir);
  const document = JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8'));
  const documents = [document];
  for (const file of files.filter(file => /^backups\/\d{16}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(file))) {
    const bytes = await readFile(path.join(dataDir, file));
    documents.push(JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes) : bytes));
  }
  return { document, documents, files: files.sort() };
}

export async function buildSaveCorpus(t) {
  const dataDir = await scratch(t), snapshots = [], features = new Set();
  let store = await openStore({ ...storeOptions, dataDir, initialState: seed() });
  t.after(() => store?.close());
  const capture = async feature => { features.add(feature); snapshots.push({ feature, ...await diskSnapshot(dataDir), state: store.getState() }); };
  const command = async (payload, feature = 'commands') => {
    await store.command(payload, store.getInfo().revision); await capture(feature);
  };
  await capture('initialize-static');
  await command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 'rules');
  await command({ type: 'update-task', taskId: tasks[0].id, task: { label: 'Synthetic edited task', memberIds: [roster[0].id] } }, 'task-edits');
  await command({ type: 'apply-runemetrics', source: 'platform-api', memberId: roster[0].id, runescapeName: 'FixtureActor', fetchedAt: at,
    skills: [{ skill: 'Attack', level: 7, xp: 700 }], quests: [{ taskId: tasks[1].id, title: tasks[1].label }] }, 'platform-progress');
  await command({ type: 'apply-game-progress', memberId: roster[0].id, fetchedAt: at, skills: [{ skill: 'Mining', level: 8, xp: 900 }], quests: [],
    achievements: [{ taskId: tasks[2].id, title: tasks[2].label, achievementId: 1 }],
    items: [{ taskId: tasks[3].id, title: 'Synthetic item', gameItemId: 857, evidence: 'worn', seen: 'Synthetic observation' }] }, 'plugin-progress');
  await command({ type: 'apply-game-progress', memberId: roster[1].id, fetchedAt: at, skills: [],
    quests: [{ taskId: tasks[1].id, title: tasks[1].label }] }, 'plugin-progress');
  await store.observePluginCurrency({ memberId: roster[0].id, keyId: randomUUID(), seq: 1, sentAt: at, coins: 150 });
  await capture('plugin-currency');
  await command({ type: 'claim-task', memberId: roster[0].id, taskId: tasks[4].id }, 'claim');
  await command({ type: 'clear-task-claim', memberId: roster[0].id, taskId: tasks[4].id }, 'claim-cleanup');
  await command({ type: 'claim-task', memberId: roster[0].id, taskId: tasks[4].id }, 'claim');
  await store.reconcileTaskClaims([], store.getInfo().revision); await capture('claim-cleanup');
  await command({ type: 'set-finish-line-item', itemId: 'skill:Mining', enabled: true, target: 9 }, 'finish-line');
  await command({ type: 'add-finish-line-custom', itemId: 'finish:surface', text: 'Synthetic finish line' }, 'finish-line');
  await command({ type: 'set-finish-line-custom', itemId: 'finish:surface', memberId: roster[0].id, completed: true }, 'finish-line');
  await command({ type: 'set-finish-line-custom', itemId: 'finish:surface', memberId: roster[1].id, completed: true }, 'finish-line');
  await command({ type: 'add-group-goal', goalId: 'group-goal:surface', text: 'Synthetic group goal', completion: 'players' }, 'group-goals');
  await command({ type: 'set-group-goal-done', goalId: 'group-goal:surface', memberId: roster[0].id, done: true }, 'group-goals');
  await command({ type: 'set-group-goal-done', goalId: 'group-goal:surface', memberId: roster[1].id, done: true }, 'group-goals');
  await command({ type: 'set-rule-review', ruleId: 'content.f2p', reviewed: true, note: 'Synthetic review' }, 'rule-reviews');
  await command({ type: 'set-rule-review', ruleId: 'content.f2p', reviewed: false, note: 'Synthetic revised review' }, 'rule-reviews');
  await command({ type: 'set-note', memberId: roster[0].id, chunkId: '100', note: 'Synthetic changed note' }, 'sparse-undo');
  await command({ type: 'undo' }, 'undo');

  // Exercise both receipt-bearing publication and standalone acknowledgement.
  const clientId = randomUUID(), actor = { kind: 'master', label: 'Synthetic operator' };
  const session = await store.openActionSession(clientId, { actor });
  await capture('action-session');
  await store.commandSerialized({ type: 'set-journal', memberId: roster[0].id, note: 'Synthetic receipted journal' }, store.getInfo().revision,
    { actor, requestId: `v3.${session.scope}.${session.slot}.${session.generation}.1`, requestAck: 0 });
  await capture('action-receipt');
  await store.acknowledgeActionSession(clientId, { ...session, sequence: 1 }, { actor });
  await capture('action-ack');

  // Every sidecar is produced by its real writer, using only this synthetic dir.
  const members = () => store.getState().members;
  const achievements = await openPluginAchievements({ dataDir, members });
  const items = await openPluginItems({ dataDir, members });
  try {
    await achievements.add(roster[0].id, [1, 99]);
    await items.put(roster[0].id, { baselineAt: at, items: { 857: { name: 'Synthetic item', ownedAt: at, wornAt: at, first: true } },
      handled: [tasks[3].id], journal: { id: 'aaaaaaaaaaaaaaaa', event: 2 }, bank: { snapshot: 'bbbbbbbbbbbbbbbb', seenAt: at, coins: 50 } });
  } finally { await items.close(); await achievements.close(); }
  const overlays = await openOverlays({ dataDir, store, world, authenticateAdmin: () => ({ admin: true }),
    checkRequestOrigin: () => {} });
  const overlayRequest = Readable.from([Buffer.from(JSON.stringify({ widget: 'goals', player: roster[0].id, label: 'Synthetic overlay' }))]);
  Object.assign(overlayRequest, { method: 'POST', headers: { 'content-type': 'application/json' } });
  try { await overlays.handle(overlayRequest, { writeHead: status => assert.equal(status, 201), end() {} }, { route: '/api/overlays', security: {} }); }
  finally { await overlays.close(); }
  const keys = await openPluginKeys({ dataDir });
  try { await keys.create(roster[0].id, 'Synthetic plugin'); } finally { await keys.close(); }
  const accounts = await openAccountStore({ dataDir });
  try { await accounts.ensureIdentity('discord', randomUUID()); } finally { await accounts.close(); }
  const invites = await openInviteStore({ dataDir, masterToken: store.token });
  try { await invites.create({ label: 'Synthetic invitation', memberId: roster[0].id }); } finally { await invites.close(); }
  const feedback = await openFeedbackStore({ dataDir });
  try { await feedback.add({ kind: 'idea', text: 'Synthetic feedback' }, actor); } finally { await feedback.close(); }
  const usage = await openUsageStore({ dataDir, actors: roster.map(row => row.id), now: () => Date.parse(at) });
  try { await usage.add({ counts: [{ id: usageEvents[0].id, actor: roster[0].id, device: 'desktop', day: at.slice(0, 10), count: 1 }] }, roster[0].id); } finally { await usage.close(); }
  await capture('sidecars');
  const timings = await openLiveTimings(dataDir, { now: () => Date.parse(at), flushMs: 0 });
  try { timings.record('command', 1); } finally { await timings.close(); }
  for (const kind of ['results', 'collections']) {
    const warm = createWarmStore(path.join(dataDir, 'warm-store', kind));
    assert.ok(warm?.put(warmHash('synthetic-' + kind), Buffer.from('synthetic cached result')));
    warm.close();
  }
  const profiles = await createDeepProfiles(dataDir);
  try { await profiles.start(1); await profiles.stop(); } finally { await profiles.close(); }
  await capture('diagnostics-cache');

  // A disposable branch covers replacement/transfer archives without erasing
  // the main corpus's active progress and inverses before the frozen exercise.
  const replacementDir = await scratch(t, 'replacement');
  const transferDir = await scratch(t, 'transfer');
  const replacement = await openStore({ ...storeOptions, dataDir: replacementDir, initialState: createGroupState(roster) });
  try {
    const incoming = mapTransferRoster((await store.backup()).state,
      [{ id: 'mapped-one', name: 'Mapped explorer 1' }, { id: 'mapped-two', name: 'Mapped explorer 2' }],
      { [roster[0].id]: 'mapped-one', [roster[1].id]: 'mapped-two' });
    const transferred = await openStore({ ...storeOptions, dataDir: transferDir, initialState: incoming });
    try { snapshots.push({ feature: 'restore-transfer', ...await diskSnapshot(transferDir), state: transferred.getState() }); }
    finally { await transferred.close(); }
    await replacement.replace(incoming, replacement.getInfo().revision);
    features.add('restore-transfer'); snapshots.push({ feature: 'restore-transfer', ...await diskSnapshot(replacementDir), state: replacement.getState() });
  } finally { await replacement.close(); }

  // End on a harmless note Undo: progress/evidence must be exactly retained.
  await command({ type: 'set-note', memberId: roster[0].id, chunkId: '100', note: 'Synthetic rollback sentinel' }, 'rollback-sentinel');
  const before = (await store.backup()).state;
  assert.ok(before.members[0].itemProgress && before.members[0].achievementProgress);
  await store.close(); store = undefined;
  // Retention archives are an independent file family. Age only synthetic
  // backups so startup invokes the real packing writer without clock sleeps.
  for (const file of await readdir(path.join(dataDir, 'backups'))) if (file.endsWith('.json.gz')) {
    await utimes(path.join(dataDir, 'backups', file), new Date('2026-10-01T12:00:00Z'), new Date('2026-10-01T12:00:00Z'));
  }
  store = await openStore({ ...storeOptions, dataDir });
  await capture('retention-archive');
  await store.close(); store = undefined;
  // Codec and recovery paths use independent synthetic saves. Fault injection
  // changes only these test-owned bytes, then invokes the normal writers.
  const recoveryDir = await scratch(t, 'recovery');
  // Only a synthetic, provably dead owner is recovered. This exercises the
  // real temporary recovery marker without killing or inspecting any process.
  await writeFile(path.join(recoveryDir, 'store.lock'), JSON.stringify({ pid: 2147483647, nonce: 'synthetic-dead-owner' }));
  const codecSeed = seed();
  for (let index = 0; index < 65; index++) {
    codecSeed.tasks.push({ id: `custom:codec-${index}`, label: `Synthetic codec task ${index}`, category: 'Custom' });
    if (index < 64) codecSeed.members[0].completedTasks.push(`custom:codec-${index}`);
  }
  let recovery = await openStore({ ...storeOptions, dataDir: recoveryDir, initialState: codecSeed, completionCodec: true });
  try {
    await recovery.command({ type: 'complete-task', memberId: roster[0].id, taskId: 'custom:codec-64', completed: true }, recovery.getInfo().revision);
    await recovery.command({ type: 'complete-task', memberId: roster[0].id, taskId: 'custom:codec-0', completed: false }, recovery.getInfo().revision);
    features.add('completion-codec'); snapshots.push({ feature: 'completion-codec', ...await diskSnapshot(recoveryDir), state: recovery.getState() });
  } finally { await recovery.close(); }
  const damaged = JSON.parse(await readFile(path.join(recoveryDir, 'state.json'), 'utf8'));
  damaged.actionReceipts = { format: 999 };
  await writeFile(path.join(recoveryDir, 'state.json'), JSON.stringify(damaged));
  recovery = await openStore({ ...storeOptions, dataDir: recoveryDir, completionCodec: true });
  try {
    await recovery.command({ type: 'set-journal', memberId: roster[0].id, note: 'Synthetic recovery journal' }, recovery.getInfo().revision);
    await writeFile(path.join(recoveryDir, 'plugin-achievements.json'), '{synthetic corrupt input');
    await writeFile(path.join(recoveryDir, 'plugin-items.json'), '{synthetic corrupt input');
    const members = () => recovery.getState().members;
    const achievements = await openPluginAchievements({ dataDir: recoveryDir, members, log() {}, clock: () => 1 });
    const items = await openPluginItems({ dataDir: recoveryDir, members, log() {}, clock: () => 1 });
    try {
      await achievements.add(roster[0].id, [1]);
      await items.put(roster[0].id, { baselineAt: at, items: {}, handled: [], journal: null });
    } finally { await achievements.close(); await items.close(); }
    features.add('quarantine-corrupt'); snapshots.push({ feature: 'quarantine-corrupt', ...await diskSnapshot(recoveryDir), state: recovery.getState() });
  } finally { await recovery.close(); }
  const migrationDir = await scratch(t, 'identity');
  const migrationInput = seed(); migrationInput.members[0].taskRules.Boosting = 'Synthetic invalid retained value';
  migrationInput.members[0].unlocked.push('99999');
  const migrated = quarantineTransferChunks(migrateTaskIdentities(migrationInput, { catalogue: tasks }).state, world);
  const migration = await openStore({ ...storeOptions, dataDir: migrationDir, initialState: migrated,
    prepareState: preserveGameIdentity({ datasetId: 'synthetic-dataset', datasetContractVersion: 1, digest: 'synthetic', capabilities: { independent: true } }) });
  try { features.add('identity-migration'); snapshots.push({ feature: 'identity-migration', ...await diskSnapshot(migrationDir), state: migration.getState() }); }
  finally { await migration.close(); }
  const legacyDir = await scratch(t, 'legacy');
  const legacyState = seed(), original = structuredClone(legacyState);
  legacyState.revision = 1; legacyState.members[0].notes['100'] = 'Synthetic old note';
  legacyState.history = [{ id: 'revision-1', revision: 1, type: 'set-note', at, command: { type: 'set-note', memberId: roster[0].id, chunkId: '100', note: 'Synthetic old note' },
    undo: { members: original.members, tasks: original.tasks, rules: original.rules } }];
  let legacyStore = await openStore({ ...storeOptions, dataDir: legacyDir, initialState: legacyState });
  await legacyStore.close();
  const legacyDisk = JSON.parse(await readFile(path.join(legacyDir, 'state.json'), 'utf8'));
  legacyDisk.actionReceipts = { [randomUUID()]: { fingerprint: 'a'.repeat(64), revision: 1 } };
  await writeFile(path.join(legacyDir, 'state.json'), JSON.stringify(legacyDisk));
  legacyStore = await openStore({ ...storeOptions, dataDir: legacyDir });
  try {
    for (let index = 0; index < 33; index++) await legacyStore.openActionSession(randomUUID());
    const client = randomUUID(), actor = { kind: 'invite', label: 'Synthetic player', inviteId: randomUUID(), memberId: roster[0].id };
    const session = await legacyStore.openActionSession(client, { actor });
    await legacyStore.commandSerialized({ type: 'set-journal', memberId: roster[0].id, note: 'Synthetic legacy receipt' }, legacyStore.getInfo().revision,
      { actor, requestId: `v3.${session.scope}.${session.slot}.${session.generation}.1`, requestAck: 0 });
    features.add('legacy-forms'); snapshots.push({ feature: 'legacy-forms', ...await diskSnapshot(legacyDir), state: legacyStore.getState() });
  } finally { await legacyStore.close(); }
  const membersDir = await scratch(t, 'members');
  const membersStore = await openStore({ ...storeOptions, dataDir: membersDir, initialState: seed(), random: () => 0,
    membersStartBanks: { version: 'synthetic', optionA: [{ chunkId: '100', place: 'Synthetic bank' }, { chunkId: '101', place: 'Second synthetic bank' }] } });
  try {
    await membersStore.command({ type: 'go-members', options: { pool: 'optionA' } }, membersStore.getInfo().revision);
    features.add('members-pinned-backup'); snapshots.push({ feature: 'members-pinned-backup', ...await diskSnapshot(membersDir), state: membersStore.getState() });
  } finally { await membersStore.close(); }
  const rollDir = await scratch(t, 'roll'), rollState = createGroupState(roster);
  rollState.members[0].unlocked = ['100']; rollState.members[0].selected = ['101']; rollState.rules['roll.adjacent'] = false;
  const rollStore = await openStore({ dataDir: rollDir, initialState: rollState, now: () => at, random: () => 0, retention: false,
    world });
  try {
    const actor = { kind: 'master', label: 'Synthetic operator' }, session = await rollStore.openActionSession(randomUUID(), { actor });
    await rollStore.commandSerialized({ type: 'roll', memberId: roster[0].id, count: 1 }, rollStore.getInfo().revision,
      { actor, requestId: `v3.${session.scope}.${session.slot}.${session.generation}.1`, requestAck: 0 });
    features.add('roll-receipt'); snapshots.push({ feature: 'roll-receipt', ...await diskSnapshot(rollDir), state: rollStore.getState() });
  } finally { await rollStore.close(); }
  return { dataDir, snapshots, features: [...features], before,
    cases: [{ name: 'full-feature-save', dataDir }, { name: 'restore-transfer', dataDir: replacementDir },
      { name: 'mapped-transfer', dataDir: transferDir },
      { name: 'codec-quarantine', dataDir: recoveryDir, options: { completionCodec: true } }, { name: 'identity-quarantine', dataDir: migrationDir },
      { name: 'legacy-receipts-undo', dataDir: legacyDir }, { name: 'members-pinned-backup', dataDir: membersDir },
      { name: 'roll-receipt', dataDir: rollDir }] };
}
