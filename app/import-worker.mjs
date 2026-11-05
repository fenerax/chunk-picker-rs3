import { parentPort, workerData } from 'node:worker_threads';
import { serialize, deserialize } from 'node:v8';
import { Readable } from 'node:stream';
import { readBackupRequest, backupPreviewState } from './backup-transfer.mjs';
import { openStore } from './storage/store.mjs';
import { createRuleRegistryFromDefinitions } from './core/rule-registry.mjs';
import { importBackup, previewRestore, applyValidatedCommand, validateState } from './core/state.mjs';
import { decodeCompletionDocument } from './storage/completion-codec.mjs';
import { mapTransferRoster, requireTransferDataset, transferDigest, transferReport, quarantineTransferChunks } from './save-transfer.mjs';
import { migrationSummary, convertLegacyCapture } from './picker-context-http.mjs';
import { migrateOwnedGameplay } from './tasks/migration.mjs';
import { preserveGameIdentity } from './game-profile.mjs';
import { taskRuleDefinitions } from './data/settings.mjs';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { createRuleRegistry, evaluateRollPool, partnerConnections } from './core/rules.mjs';
import { projectPlayState, PLAY_VIEW } from './play-view.mjs';
import { projectBrowserState } from './web/browser-state.mjs';
import { boundedOutput, displayText, warningOutput } from './import-output.mjs';
import { encodeImportBytes, decodeImportBytes } from './import-bytes.mjs';

async function send(value) {
  const bytes = await encodeImportBytes(value);
  parentPort.postMessage(bytes, bytes.buffers);
}

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function mergeGuards(previous = [], rows = []) {
  const key = row => JSON.stringify([row.memberId, row.sourceMapId, row.taskId]);
  const keys = new Set(previous.map(key)), merged = [...previous];
  for (const row of rows) if (!keys.has(key(row))) { keys.add(key(row)); merged.push(row); }
  return merged;
}
const start = performance.now();
async function run(job) {
  if (job.kind === 'parse') {
    const request = Object.assign(job.chunks ? Readable.from(job.chunks.map(chunk => Buffer.from(chunk))) : new Readable({ read() {} }), { headers: job.headers, complete: Boolean(job.chunks) });
    if (!job.chunks) parentPort.on('message', message => {
      if (message.end) { request.complete = true; request.push(null); }
      else request.push(Buffer.from(message.chunk));
    });
    const imported = await readBackupRequest(request, job.options);
    if (!job.defer) return imported;
    const body = imported.body, selectors = new Set();
    const pending = [body];
    while (pending.length) {
      const item = pending.pop();
      for (const [key, value] of Object.entries(item)) {
        if (key === 'picker' || key === 'pickerId') {
          if (typeof value !== 'string' || value.length > 128) fail(403, 'Picker access denied.');
          selectors.add(value);
          if (selectors.size > 1) fail(403, 'Picker access denied.');
        } else if (value && typeof value === 'object') pending.push(value);
      }
    }
    for (const key of ['memberId', 'sourceMemberId', 'previewToken']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 128)) fail(400, 'Invalid backup import options.');
    if (body.expectedRevision !== undefined && !Number.isSafeInteger(body.expectedRevision)) fail(400, 'Invalid expected revision.');
    const transferHash = transferDigest({ backup: body.backup, backupId: body.backupId, document: body.document,
      members: body.members, memberId: body.memberId, sourceMemberId: body.sourceMemberId, rosterMapping: body.rosterMapping });
    return { uploaded: imported.uploaded, input: serialize(body),
      body: { expectedRevision: body.expectedRevision, memberId: body.memberId, previewToken: body.previewToken, transferHash,
        selectors: [...selectors].map(pickerId => ({ pickerId })) } };
  }
  const registry = job.rules ? createRuleRegistryFromDefinitions(job.rules) : undefined;
  const options = job.options ?? {};
  const migrateState = options.migration ? (state, context) => {
    const result = { ...migrateOwnedGameplay(state, options.migration), reused: false };
    if (result.state.legacy?.gameplayMigration) Object.assign(result.state.legacy.gameplayMigration, { warnings: result.warnings, report: result.report });
    context.migration = result;
    context.catalogue = options.migration.catalogue;
    return result.state;
  } : undefined;
  // Loading is an exact read of the writer's committed baseline. Only the
  // replacement passes through first-party migration and identity preparation.
  const identityPreparation = options.dataset ? preserveGameIdentity(options.dataset) : undefined;
  const inputDigest = job.input ? createHash('sha256').update(job.input).digest('hex') : undefined;
  const prepareState = async (state, context) => {
    if (job.prepareHook) await new Promise((resolve, reject) => {
      parentPort.once('message', message => decodeImportBytes(message).then(resolve, reject));
      send({ hook: true, summary: { revision: state.revision, members: state.members.map(({ id, name }) => ({ id, name })),
        provenance: { dataset: state.provenance?.dataset }, digest: inputDigest }, context: { operation: context.operation } }).catch(reject);
    });
    return identityPreparation ? identityPreparation(state, context) : state;
  };
  prepareState.isCurrent = () => true;
  if (migrateState) migrateState.isCurrent = () => true;
  const store = await openStore({ dataDir: job.dataDir, registry, readOnly: true, importReader: true, migrateState, prepareState, now: options.now,
    retention: job.retention, progressQuestPoints: job.progressQuestPoints, completionCodec: job.completionCodec });
  try {
    const current = store.getState();
    if (current.revision !== job.baseRevision) fail(409, 'The destination changed. Preview the backup again.');
    if (job.kind === 'replacement') return (await store.previewReplacement(job.document, { actor: job.actor })).state;
    const body = deserialize(Buffer.from(job.input)), { dataset, world, route, actor } = options;
    const previewOnly = route.endsWith('/preview');
    let backup;
    if (Object.hasOwn(body, 'backupId')) {
      if (Object.hasOwn(body, 'backup') || Object.hasOwn(body, 'document')) fail(400, 'Choose either a retained save or an uploaded backup.');
      backup = await store.readBackup(body.backupId, { forImport: true });
    } else if (body.backup !== undefined) {
      backup = typeof body.backup === 'string' ? JSON.parse(body.backup) : body.backup;
      backup = decodeCompletionDocument(backup);
    }
    if (backup) requireTransferDataset(dataset, backup);
    const legacy = !backup;
    if (legacy && dataset.capabilities?.features?.originalSync === false) fail(422, 'Choose a backup from this starter game dataset.');
    const imported = legacy ? convertLegacyCapture(body.document, { members: body.members, capturedAt: body.capturedAt, registry }) : null;
    const incoming = legacy ? imported.state : importBackup(backup, registry, { owned: true });
    const sourceRoster = incoming.members.map(({ id, name }) => ({ id, name }));
    const knownRules = new Set(taskRuleDefinitions.map(rule => rule.id));
    const reportOptions = { world, taskIds: new Set(current.tasks.map(task => task.id)), knownRule: id => knownRules.has(id) };
    let state, operation = 'replace', preview, report, warnings = imported?.warnings ?? [];
    if (route.startsWith('/api/member-restore')) {
      const owner = current.members.find(member => member.id === body.memberId);
      if (!owner) fail(400, 'Choose a known player.');
      if (!body.sourceMemberId && !incoming.members.some(member => member.id === owner.id && member.name === owner.name)) {
        if (!previewOnly) fail(422, 'Choose the source member in the preview first.');
        return { response: { mappingRequired: true, sourceRoster, destinationRoster: [{ id: owner.id, name: owner.name }] } };
      }
      const sourceMemberId = body.sourceMemberId ?? owner.id;
      const source = incoming.members.find(member => member.id === sourceMemberId);
      if (!source) fail(400, `This backup has no map for ${displayText(owner.name)}.`);
      const mappedMember = mapTransferRoster({ ...incoming, members: [source], history: [], tasks: incoming.tasks.map(({ memberIds, ...task }) => task), taskClaims: undefined, groupGoals: undefined, finishLine: undefined, progressSnapshots: undefined }, [owner], { [sourceMemberId]: owner.id });
      const member = mappedMember.members[0];
      if (['unlocked', 'selected', 'pendingRoll', 'blacklisted'].some(field => member[field].some(id => !world.chunks.has(id.split('-')[0])))) fail(422, 'This member backup contains unknown chunks. Ask the owner to preview the full backup to preserve them in quarantine; no member records were imported.');
      if (legacy) member.obtainedEquipment = [...(owner.obtainedEquipment ?? [])];
      const command = { type: 'replace-member', memberId: owner.id, member, source: legacy ? 'Original picker import' : 'Backup' };
      report = transferReport(incoming, { ...reportOptions, warnings, memberId: sourceMemberId });
      const referenced = new Set([...member.completedTasks, ...['taskStatus', 'questProgress', 'achievementProgress', 'itemProgress', 'xpChoices'].flatMap(field => Object.keys(member[field] ?? {})), ...Object.values(member.taskAlternatives ?? {}).flatMap(groups => Object.values(groups))]);
      const scoped = incoming.tasks.filter(task => !task.memberIds || task.memberIds.includes(sourceMemberId) || referenced.has(task.id));
      const existingTasks = new Map(current.tasks.map(task => [task.id, task]));
      const tasks = [], taskAssignments = [];
      for (const task of scoped) {
        const existing = existingTasks.get(task.id);
        if (!existing) { tasks.push({ ...task, memberIds: [owner.id] }); continue; }
        const { memberIds: ignoredSource, ...sourceDefinition } = task;
        const { memberIds: destinationAssignment, ...destinationDefinition } = existing;
        if (destinationAssignment && !destinationAssignment.includes(owner.id)) taskAssignments.push(task.id);
        if (!isDeepStrictEqual(sourceDefinition, destinationDefinition)) fail(422, 'A saved task ID has a different destination definition. Ask the owner to review a whole-picker restore; no member records were imported.');
      }
      if (tasks.length) command.tasks = tasks;
      if (taskAssignments.length) command.taskAssignments = taskAssignments;
      // Guards describe the imported member's already-migrated fields. Install
      // them before preparing the command, so migration cannot resurrect cleared
      // values and make the newly authored Undo stale. Other members keep theirs.
      const guarded = { ...current };
      for (const field of ['migratedMembers', 'journalMigratedMembers', 'taskStatusProvenance']) {
        const rows = mappedMember.legacy?.gameplayMigration?.[field]?.filter(row => row.memberId === owner.id);
        if (rows?.length) {
          const previous = current.legacy?.gameplayMigration?.[field] ?? [];
          guarded.legacy = { ...guarded.legacy, gameplayMigration: { ...guarded.legacy?.gameplayMigration, [field]: mergeGuards(previous, rows) } };
        }
      }
      const alternatives = mappedMember.provenance?.taskIdentityMigration?.legacyAlternativeMembers?.filter(row => row.memberId === owner.id);
      if (alternatives?.length) {
        const previous = current.provenance?.taskIdentityMigration?.legacyAlternativeMembers ?? [];
        guarded.provenance = { ...guarded.provenance, taskIdentityMigration: { ...guarded.provenance?.taskIdentityMigration,
          legacyAlternativeMembers: mergeGuards(previous, alternatives) } };
      }
      state = applyValidatedCommand(guarded, command, { expectedRevision: current.revision, world, registry, actor, now: options.now });
      // Member commands preserve the complete guarded Undo chain.
      const revision = state.revision;
      const context = { operation: 'command', world, registry };
      if (migrateState) state = migrateState(state, context);
      state = validateState(await prepareState(state, context), registry);
      if (state.revision !== revision) throw new TypeError('prepareState must preserve the authoritative revision.');
      operation = 'command';
      preview = previewRestore({ ...current, history: [] }, { ...state, history: [] }, registry, { owned: true });
      report.excludedSections = ['Other members', 'Shared rules and group plans', 'Source History and migration archives'].map(field => ({ field, reason: 'Member restore keeps the destination section. The source backup remains the portable copy.' }));
    } else {
      if (legacy) for (const member of incoming.members) member.obtainedEquipment = [...(current.members.find(owner => owner.id === member.id)?.obtainedEquipment ?? [])];
      const mapped = legacy && options.pickerId === 'legacy' ? incoming
        : mapTransferRoster(incoming, current.members, body.rosterMapping, options.requiredMemberIds, { owned: true });
      if (!mapped) {
        if (!previewOnly) fail(422, 'Review and assign the source roster before importing.');
        return { response: { mappingRequired: true, sourceRoster, destinationRoster: current.members.map(({ id, name }) => ({ id, name })) } };
      }
      warnings = [...warnings, ...migrationSummary(mapped).warnings];
      report = transferReport(mapped, { ...reportOptions, warnings });
      quarantineTransferChunks(mapped, world);
      const replacement = await store.previewReplacement(mapped, { actor });
      state = replacement.state;
      preview = previewRestore(replacement.current, state, registry, { owned: true });
      warnings = [...warnings, ...migrationSummary(state).warnings];
    }
    const summary = boundedOutput(preview);
    // Display samples stay small while counts describe the entire save.
    summary.members = preview.members.map(member => {
      const row = boundedOutput(member, { bytes: 8192 });
      for (const field of ['unlocked', 'selected', 'obtainedEquipment']) row[field] = {
        ...boundedOutput(member[field]), addedCount: member[field].added.length, removedCount: member[field].removed.length };
      return row;
    });
    summary.rules = boundedOutput(preview.rules);
    summary.warnings = warningOutput(preview.warnings);
    summary.taskCounts = Object.fromEntries(['added', 'removed', 'changed'].map(key => [key, preview.tasks[key].length]));
    const publication = await store.prepareImportPublication(state, operation);
    if (options.responseView !== undefined) {
      const saved = publication.state, builtInRegistry = createRuleRegistry();
      const rollRegistry = createRuleRegistry((job.rules ?? []).filter(rule => !builtInRegistry.get(rule.id)));
      const projected = options.responseView === PLAY_VIEW ? projectPlayState(saved) : projectBrowserState(saved);
      const metadata = { ...(options.responseView === PLAY_VIEW ? { format: PLAY_VIEW, schemaVersion: 1 } : {}), warnings: warningOutput(warnings), transferReport: report };
      if (options.inlineRollPools) publication.reply = { stateBytes: Buffer.from(JSON.stringify(projected)), metadata };
      else {
        const pools = Object.fromEntries(saved.members.map(member => {
          const pool = evaluateRollPool(world, saved, member.id, rollRegistry);
          return [member.id, options.responseView === PLAY_VIEW ? { ...pool, partnerConnections: partnerConnections(world, saved, member.id, rollRegistry) } : pool];
        }));
        const bytes = Buffer.from(JSON.stringify({ state: projected, pools, ...metadata }));
        publication.reply = { bytes, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
      }
    }
    return { publication, operation, workerMs: performance.now() - start,
      response: { preview: summary, state: route.startsWith('/api/member-restore') && body.backup !== undefined ? undefined
        : boundedOutput(legacy && !options.uploaded ? state : backupPreviewState(state)), sourceRoster,
        ...(legacy && options.uploaded ? { format: 'play-v1', schemaVersion: 1 } : {}),
        warnings: warningOutput(warnings), transferReport: report } };
  } finally { await store.close(); }
}
try { await send({ result: await run(await decodeImportBytes(workerData)) }); }
catch (error) { await send({ error: { message: displayText(error.message), status: error.status ?? (error.code === 'ENOENT' ? 404 : undefined) } }); }
