import path from 'node:path';
import { mkdir, writeFile, readFile, rm, cp, readdir } from 'node:fs/promises';
import { openRegistry } from '../../../app/storage/registry.mjs';
import { openStore } from '../../../app/storage/store.mjs';
import { openInviteStore } from '../../../app/storage/invites.mjs';
import { openPluginKeys } from '../../../app/plugin-keys.mjs';
import { createGroupInviteService } from '../../../app/group-invite-service.mjs';
import { createGroupState, applyCommand } from '../../../app/core/state.mjs';
import { createRuleRegistry } from '../../../app/core/rules.mjs';
import { buildWorld } from '../../../app/data/world.mjs';
import { bindDatasetStorage } from '../../../app/dataset-binding.mjs';
import { selectedDataset } from '../../../app/dataset-runtime.mjs';
import { catalogue, syntheticWorld, random, digest } from '../capacity/model.mjs';
import { growthCommands } from '../capacity/growth.mjs';
import { prepareFixtureInputs } from '../capacity/fixture-inputs.mjs';
import { fixtureMigration, calibrateIdentities } from '../capacity/fixture-migration.mjs';
import { plan } from './config.mjs';

export function inputs(c) {
  const definitions = catalogue({ chunks: c.chunks, tasks: c.tasks, dependencyDepth: 8, crossLinks: 3 });
  const rules = createRuleRegistry(), world = syntheticWorld(definitions, buildWorld);
  // This clone changes only synthetic transport capabilities, not a durable format.
  const dataset = { ...selectedDataset, capabilities: { ...selectedDataset.capabilities,
    features: { ...selectedDataset.capabilities.features, runeMetrics: true, externalNames: true } } };
  return { definitions, rules, world, dataset };
}
export const storage = root => ({ registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'),
  tombstoneDir: path.join(root, 'ledger'), legacyDir: path.join(root, 'legacy') });

export async function generate(c, root, progress = console.log) {
  const spec = plan(c), { definitions, rules, world, dataset } = inputs(c), paths = storage(root);
  progress('Preparing synthetic calculator catalogue and identities.');
  const shape = { chunks: c.chunks, tasks: c.tasks, aliases: c.aliases, stateBytes: c['state-bytes'], dependencyDepth: 8, crossLinks: 3 };
  const { migrationInputs } = await prepareFixtureInputs({ catalogue: shape });
  const hooks = fixtureMigration(migrationInputs, dataset);
  const fixedStart = Date.UTC(2026, 0, 1), rng = random(c.seed);
  await mkdir(paths.legacyDir, { recursive: true });
  const registry = await openRegistry(paths), contexts = new Map();
  const open = async id => {
    if (!contexts.has(id)) {
      const picker = registry.getPicker(id), dataDir = registry.pickerDirectory(id);
      await bindDatasetStorage(dataDir, dataset);
      const initialState = createGroupState(picker.memberIds.map(id => ({ id, name: 'Synthetic character' })), rules);
      initialState.provenance = { dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
      const store = await openStore({ dataDir, registry: rules, world,
        initialState });
      let queue = Promise.resolve();
      contexts.set(id, { store, groupRuleDefinitions: () => rules.definitions,
        withGroupAdmission(work) { const job = queue.then(() => work(store)); queue = job.catch(() => {}); return job; },
        async revokeDepartedMember() {}, untouchedOnboarding: () => true });
    }
    return contexts.get(id);
  };
  const service = createGroupInviteService({ registry, acquire: async id => ({ context: await open(id) }), release() {} });
  const groups = [], accounts = [], clients = [], initial = [], used = new Set();
  let legacy, invites;
  try {
    for (let i = 0; i < spec.logins; i++) {
      const result = await registry.firstLogin('discord', `synthetic-beta-${c.seed}-${i}`);
      accounts.push(result.account); initial.push({ ...result, character: registry.listCharacters(result.account.id)[0] });
    }
    const extras = c.phases.includes('lifecycle') ? [{ index: spec.groups.length + 1, size: 3, grown: false, lifecycle: true, variant: 0, members: [{ login: 0 }, { login: 1 }, { login: 2 }] }] : [];
    for (const item of [...spec.groups, { index: spec.groups.length, size: 1, grown: false, nearLimit: true, variant: 0, members: [{ login: 0 }] }, ...extras]) {
      progress(`Provisioning synthetic group ${item.index + 1}/${spec.groups.length + 1 + extras.length}`);
      const ownerLogin = item.members[0].login;
      const first = used.has(ownerLogin) ? await registry.addCharacter(accounts[ownerLogin].id, { requestId: `beta-${c.seed}-${item.index}` }) : initial[ownerLogin];
      used.add(ownerLogin);
      const pickerId = first.picker.id;
      await open(pickerId);
      for (const member of item.members.slice(1)) {
        const invite = await registry.createGroupInvite(accounts[item.members[0].login].id, pickerId);
        const review = await service.review(invite.secret, accounts[member.login].id);
        await service.accept(invite.secret, accounts[member.login].id,
          used.has(member.login) ? {} : { characterId: initial[member.login].character.id }, review.review.revision);
        used.add(member.login);
      }
      const picker = registry.getPicker(pickerId);
      const members = picker.seats.map(seat => {
        const character = registry.getCharacter(seat.characterId);
        return { id: seat.memberId, name: `Synthetic ${item.index}-${seat.memberId}`, runescapeName: `S${item.index}M${picker.seats.indexOf(seat)}`,
          characterId: character.id, accountId: character.accountId, login: accounts.findIndex(a => a.id === character.accountId) };
      });
      // Keep one real pinned restore preimage, including solo rosters. It is
      // copied intact after reinitialization, never fabricated or unpinned.
      const existing = contexts.get(pickerId).store;
      await existing.replace({ format: 'rs3-chunk-picker', schemaVersion: 1, state: existing.getState() }, existing.getInfo().revision);
      await contexts.get(pickerId).store.close(); contexts.delete(pickerId);
      const preimages = path.join(root, `seed-preimages-${item.index}`);
      await cp(path.join(registry.pickerDirectory(pickerId), 'backups'), preimages, { recursive: true, errorOnExist: true, force: false });
      groups.push({ ...item, pickerId, members });
    }
    await service.close();
    for (const context of contexts.values()) await context.store.close(); contexts.clear();

    for (const group of groups) {
      progress(`Growing synthetic group ${group.index + 1}/${groups.length}`);
      const dataDir = registry.pickerDirectory(group.pickerId);
      let state = createGroupState(group.members.map(({ id, name, runescapeName }) => ({ id, name, runescapeName })), rules), tick = 0;
      state.provenance = { dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
      const now = () => fixedStart + tick++ * 1000;
      const chunks = Object.keys(definitions.chunks);
      if (group.grown) {
        for (const { command } of growthCommands(state, group, chunks, { unlockFraction: .6 }, now, rules))
          state = applyCommand(state, command, { world, registry: rules, now: now(), random: rng });
      }
      // Distinct marker is used by HTTP and SSE isolation probes.
      state.members[0].journal = `beta-marker:${c.seed}:${group.index}`;
      state.tasks.push(...migrationInputs.catalogue.map(({ id, label, category }) => ({ id, label, category })));
      state = hooks.migrateState(state, { operation: 'initialize' });
      // Migration may establish an Undo boundary when duplicate custom labels
      // coalesce. Seed recent History AFTER that boundary, never count archived
      // pre-migration events as the requested ~1,000 recent events.
      if (group.grown) {
        const initialHistory = Math.max(0, c['history-events'] - c.snapshots - state.history.length);
        for (let i = 0; i < initialHistory; i++) state = applyCommand(state, { type: 'set-note', memberId: group.members[0].id,
          chunkId: chunks[i % chunks.length], note: `Synthetic history ${group.index}-${i}` }, { world, registry: rules, now: now(), random: rng });
      }
      state = calibrateIdentities(state, shape);
      if (group.nearLimit) {
        const extra = Math.max(0, Math.floor(c['near-limit-mib'] * 1024 * 1024) - Buffer.byteLength(JSON.stringify(state)));
        // Keep the executable catalogue unchanged. Bounded notes fill the
        // adversarial size envelope without duplicating huge labels in aliases.
        state.members[0].notes = Object.fromEntries(chunks.map((id, index) => [id,
          `Synthetic near-limit note ${index} `.padEnd(Math.floor(extra / chunks.length), 'x')]));
      }
      // All stores are closed. Reinitialize only this task-owned synthetic
      // gameplay directory via initialState, preserving the registry placement.
      // A normal restore would move the 700 prior events into restore provenance
      // rather than leave ~1,000 recent History events in the grown fixture.
      if (path.dirname(dataDir) !== paths.pickerRoot) throw new Error('Unsafe synthetic fixture path.');
      await rm(dataDir, { recursive: true });
      await bindDatasetStorage(dataDir, dataset);
      const store = await openStore({ dataDir, registry: rules, world, initialState: state, now, random: rng, ...hooks });
      try {
        if (group.grown) for (let i = 0; i < c.snapshots; i++) await store.command({ type: 'set-note', memberId: group.members[0].id,
          chunkId: chunks[i % chunks.length], note: `Synthetic retained ${i}` }, store.getInfo().revision);
        await store.close();
        for (const name of await readdir(path.join(root, `seed-preimages-${group.index}`)))
          await cp(path.join(root, `seed-preimages-${group.index}`, name), path.join(dataDir, 'backups', name), { recursive: true, errorOnExist: true, force: false });
        // Run the production retention path at the serving clock so old
        // synthetic snapshots pack before the timed load starts.
        const normalized = await openStore({ dataDir, registry: rules, world, ...hooks });
        let saved;
        try {
          await normalized.prepareSnapshot(); saved = normalized.getState();
          if (group.grown && saved.history.length < c['history-events']) throw new Error('Grown fixture lost requested recent History during preparation.');
          if (group.grown && (await normalized.listBackups()).length < c.snapshots) throw new Error('Grown fixture lost requested retained snapshots.');
          Object.assign(group, { historyEvents: saved.history.length, snapshots: (await normalized.listBackups()).length,
            stateBytes: Buffer.byteLength(JSON.stringify(saved)), stateDigest: digest(saved), aliases: Object.keys(saved.identityRegistry?.aliases ?? {}).length,
            catalogueTasks: saved.tasks.length, retention: normalized.getInfo().retention });
        } finally { await normalized.close(); }
        await registry.updateCharacterNames(group.pickerId, saved.members);
      } finally { await store.close(); }
    }
    await bindDatasetStorage(paths.legacyDir, dataset);
    legacy = await openStore({ dataDir: paths.legacyDir, registry: rules, world,
      initialState: createGroupState([{ id: 'one', name: 'Synthetic legacy 1' }, { id: 'two', name: 'Synthetic legacy 2' }], rules) });
    invites = await openInviteStore({ dataDir: paths.legacyDir, masterToken: legacy.getAccessToken(), pickerRegistry: registry });
    const cookies = [];
    for (const account of accounts) cookies.push('duo_access=' + await invites.issueRegistrySession(account.id, 'discord'));
    let storedKeys = 0;
    const normal = groups.filter(g => !g.nearLimit);
    const slots = normal.reduce((n, g) => n + g.members.length, 0);
    if (c['stored-keys'] > slots * 3) throw new Error('Stored keys exceed three per character.');
    for (const group of groups) {
      const keys = await openPluginKeys({ dataDir: registry.pickerDirectory(group.pickerId) });
      try {
        for (const member of group.members) {
          const client = { ...member, memberId: member.id, pickerId: group.pickerId, group: group.index, cookie: cookies[member.login], key: null };
          const count = group.nearLimit ? 0 : Math.min(3, Math.ceil((c['stored-keys'] - storedKeys) / Math.max(1, slots - clients.length)));
          for (let k = 0; k < count; k++) {
            const { key } = await keys.create(member.id, `Synthetic offline ${k}`, member.accountId);
            await registry.setCapability({ kind: 'plugin-key', hash: digest(key), pickerId: group.pickerId, accountId: member.accountId, memberId: member.id });
            client.key ??= key; storedKeys++;
          }
          clients.push(client);
        }
      } finally { await keys.close(); }
    }
    const fixture = { schemaVersion: 1, seed: c.seed, planDigest: spec.digest, catalogueDigest: digest(definitions),
      shape,
      groups, clients, logins: accounts.length, characters: clients.length, storedKeys,
      offlineKeys: storedKeys - Math.min(c['plugin-clients'], clients.filter(m => m.key).length),
      nearLimit: { group: groups.find(g => g.nearLimit).index, bytes: groups.find(g => g.nearLimit).stateBytes, targetMiB: c['near-limit-mib'], sourceLimitMiB: 208, portableLimitMiB: 256,
        qualifying: groups.find(g => g.nearLimit).stateBytes >= 190 * 1024 * 1024 && groups.find(g => g.nearLimit).stateBytes < 208 * 1024 * 1024 },
      initialSolos: initial.length, retiredInitialSolos: initial.filter(i => registry.getPicker(i.picker.id).lifecycle === 'retired').length,
      retiredPickerIds: registry.listPickers().filter(p => p.lifecycle === 'retired').map(p => p.id),
      pickerInventory: { active: registry.listPickers().filter(p => p.lifecycle === 'active').length,
        retired: registry.listPickers().filter(p => p.lifecycle === 'retired').length, legacyAddedAtStartup: 1 },
      setup: 'Synthetic identity, registry, invitation, session and key APIs offline; real store commands and retention; no provider calls',
    };
    await writeFile(path.join(root, 'fixture.json'), JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
    return fixture;
  } finally {
    await service.close(); for (const context of contexts.values()) await context.store.close();
    await invites?.close(); await legacy?.close(); await registry.close();
  }
}

export async function audit(root, fixture, writes, tombstones, journals = [], pickerTombstones = [], historyAcks = {}) {
  const { openStore } = await import('../../../app/storage/store.mjs');
  const document = JSON.parse(await readFile(path.join(root, 'registry', 'registry.json'), 'utf8'));
  const findings = [], revisions = {}; let historyAcknowledgements = 0;
  for (const group of fixture.groups) {
    const picker = document.pickers.find(p => p.id === group.pickerId);
    if (picker?.lifecycle !== 'active') {
      findings.push({ kind: picker ? 'inactive-fixture-group' : 'missing-fixture-group', pickerId: group.pickerId });
      continue;
    }
    const store = await openStore({ dataDir: path.join(root, 'pickers', group.pickerId) });
    try {
      const state = store.getState(); revisions[group.pickerId] = state.revision;
      const wanted = new Set(historyAcks[group.pickerId] ?? []); historyAcknowledgements += wanted.size;
      let before;
      while (wanted.size) {
        const page = await store.queryHistory({ limit: 500, before, stateRevision: state.revision });
        for (const event of page.history) wanted.delete(event.revision);
        if (!page.hasMore) break; before = page.nextBefore;
      }
      if (wanted.size) findings.push({ kind: 'lost-acknowledged-history', missing: wanted.size });
      for (const write of writes.filter(w => w.pickerId === group.pickerId)) {
        if (state.revision < write.revision) findings.push({ kind: 'lost-ack', revision: write.revision });
        if (write.tokens?.some(token => !state.members.find(m => m.id === write.memberId)?.notes?.[write.chunkId]?.split('\n').includes(`beta-write-${token}`))) findings.push({ kind: 'lost-note', revision: write.revision });
      }
      const { openPluginJournalCommits } = await import('../../../app/plugin-items.mjs');
      const commits = await openPluginJournalCommits({ dataDir: path.join(root, 'pickers', group.pickerId), members: () => state.members });
      try {
        for (const journal of journals.filter(j => j.pickerId === group.pickerId && j.acknowledged > 0)) {
          const saved = commits.get(journal.memberId)?.journals.find(j => j.id === journal.id)?.committed ?? -1;
          if (saved < journal.acknowledged) findings.push({ kind: 'lost-plugin-ack', acknowledged: journal.acknowledged, saved });
        }
      } finally { await commits.close(); }
    } finally { await store.close(); }
  }
  for (const id of tombstones) if (document.characters.some(c => c.id === id && c.lifecycle === 'active')) findings.push({ kind: 'revived-tombstone' });
  for (const group of fixture.groups.filter(g => g.lifecycle)) {
    const picker = document.pickers.find(p => p.id === group.pickerId);
    if (picker?.ownerCharacterId !== group.members[0].characterId || group.members.some(member =>
      !document.characters.some(c => c.id === member.characterId && c.lifecycle === 'active' && c.placement.pickerId === group.pickerId))) findings.push({ kind: 'lost-lifecycle-placement' });
  }
  for (const id of [...fixture.retiredPickerIds, ...pickerTombstones]) if (document.pickers.some(p => p.id === id && p.lifecycle === 'active')) findings.push({ kind: 'revived-group' });
  const ledger = JSON.parse(await readFile(path.join(root, 'ledger', 'ledger.json'), 'utf8'));
  for (const id of tombstones) if (!ledger.deletions?.some(d => d.completedAt && d.targets.some(t => t.characterId === id))) findings.push({ kind: 'missing-tombstone' });
  for (const id of pickerTombstones) if (!ledger.pickers.some(p => p.pickerId === id && p.lifecycle === 'deleted')) findings.push({ kind: 'missing-group-tombstone' });
  return { passed: findings.length === 0, acknowledgedWrites: writes.reduce((sum, w) => sum + w.count, 0), historyAcknowledgements, pluginAcknowledgedEvents: journals.reduce((sum, j) => sum + j.acknowledged, 0),
    tombstones: tombstones.length, pickerTombstones: pickerTombstones.length, retiredPickers: fixture.retiredPickerIds.length, findings, revisions };
}
