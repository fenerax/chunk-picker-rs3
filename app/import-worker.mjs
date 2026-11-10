import { normalizeOriginalPaste, ORIGINAL_PASTE_FORMAT } from './original-paste.mjs';
import { assertWorkerHeapLimit } from './tasks/worker-limits.mjs';
if (workerData.enforceMemoryLimit) assertWorkerHeapLimit();
import { parentPort, workerData } from 'node:worker_threads';
import { deserialize } from 'node:v8';
import { backupPreviewState, MAX_PORTABLE_BACKUP_BYTES } from './backup-transfer.mjs';
import { openStore } from './storage/store.mjs';
import { captureOptionalSidecarEvidence, materializeOptionalSidecarEvidence, reconcileOptionalSidecarEvidence } from './optional-sidecar-evidence.mjs';
import { createRuleRegistryFromDefinitions } from './core/rule-registry.mjs';
import { importBackup, previewRestore, applyValidatedCommand, validateState } from './core/state.mjs';
import { decodeCompletionDocument } from './storage/completion-codec.mjs';
import { mapTransferRoster, requireTransferDataset, transferReport, quarantineTransferChunks, transferManifest } from './save-transfer.mjs';
import { migrationSummary, convertLegacyCapture } from './picker-context-http.mjs';
import { migrateOwnedGameplay } from './tasks/migration.mjs';
import { preserveGameIdentity } from './game-profile.mjs';
import { taskRuleDefinitions } from './data/settings.mjs';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createRuleRegistry, evaluateRollPool, partnerConnections } from './core/rules.mjs';
import { projectPlayState, PLAY_VIEW } from './play-view.mjs';
import { projectBrowserState } from './web/browser-state.mjs';
import { boundedImportMessage, boundedOutput, displayText, warningOutput, rosterOutput, importMetadataOutput } from './import-output.mjs';
import { encodeImportBytes, decodeImportBytes } from './import-bytes.mjs';

async function send(value) {
  const bytes = await encodeImportBytes(boundedImportMessage(value));
  parentPort.postMessage({ ...bytes, hook: value.hook === true }, bytes.buffers);
}

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
function mergeGuards(previous = [], rows = []) {
  const key = row => JSON.stringify([row.memberId, row.sourceMapId, row.taskId]);
  const keys = new Set(previous.map(key)), merged = [...previous];
  for (const row of rows) if (!keys.has(key(row))) { keys.add(key(row)); merged.push(row); }
  return merged;
}
function portableBackupBytes(backup, dataset) {
  if (dataset) backup = { ...backup,
    state: { ...backup.state, provenance: { ...backup.state.provenance,
      dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } } },
    transfer: transferManifest(dataset, backup.state.members) };
  const bytes = Buffer.from(JSON.stringify(backup));
  if (bytes.length > MAX_PORTABLE_BACKUP_BYTES) fail(413, 'This replacement would exceed the portable backup limit. No records were imported.');
  return bytes;
}
const start = performance.now();
async function run(job) {
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
  const prepareState = async (state, context) => {
    if (job.prepareHook) state = await new Promise((resolve, reject) => {
      parentPort.once('message', message => decodeImportBytes(message).then(reply => resolve(reply.hookResult), reject));
      const { world, registry, ...preparationContext } = context;
      // world/registry contain caller functions. The writer restores its exact
      // instances; migration/catalogue context travels unchanged with the input.
      const migrationInput = preparationContext.migration?.state === state;
      if (migrationInput) preparationContext.migration = { ...preparationContext.migration, state: undefined };
      send({ hook: true, input: state, context: preparationContext, migrationInput }).catch(reject);
    });
    return identityPreparation ? identityPreparation(state, context) : state;
  };
  prepareState.isCurrent = () => true;
  if (migrateState) migrateState.isCurrent = () => true;
  const store = await openStore({ dataDir: job.dataDir, registry, readOnly: true, importReader: true, migrateState, prepareState, now: options.now,
    retention: job.retention, progressQuestPoints: job.progressQuestPoints, completionCodec: job.completionCodec,
    ownedFormat2: job.ownedFormat2 });
  try {
    if (job.kind === 'backup' || job.kind === 'export') {
      const backup = await store.backup();
      if (job.kind === 'backup') return JSON.parse(JSON.stringify(backup));
      const bytes = portableBackupBytes(backup, job.exportDataset);
      return { bytes: job.gzip ? gzipSync(bytes, { level: 1 }) : job.encoding === 'br'
        ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : bytes, plainBytes: bytes.length };
    }
    const baseline = store.getState();
    const current = materializeOptionalSidecarEvidence(baseline, await captureOptionalSidecarEvidence(baseline, { dataDir: job.dataDir }));
    if (current.revision !== job.baseRevision) fail(409, 'The destination changed. Preview the backup again.');
    if (job.kind === 'replacement') return (await store.previewReplacement(job.document, { actor: job.actor })).state;
    const body = deserialize(Buffer.from(job.input)), { dataset, world, route, actor } = options;
    const previewOnly = route.endsWith('/preview');
    const originalPaste = body.document?.format === ORIGINAL_PASTE_FORMAT;
    if (originalPaste && !options.originalPasteEnabled) fail(404, 'Original picker paste import is unavailable.');
    if (originalPaste && !route.startsWith('/api/member-restore')) fail(422, 'Choose one destination player for original picker paste.');
    const pasted = originalPaste ? normalizeOriginalPaste(body.document, { current, world, dataset, migration: options.migration }) : null;
    let backup;
    if (Object.hasOwn(body, 'backupId')) {
      if (Object.hasOwn(body, 'backup') || Object.hasOwn(body, 'document')) fail(400, 'Choose either a retained save or an uploaded backup.');
      backup = await store.readBackup(body.backupId, { forImport: true });
    } else if (body.backup !== undefined) {
      backup = typeof body.backup === 'string' ? JSON.parse(body.backup) : body.backup;
      backup = decodeCompletionDocument(backup);
    }
    if (backup) {
      requireTransferDataset(dataset, backup);
    }
    const legacy = !backup && !pasted;
    if (legacy && dataset.capabilities?.features?.originalSync === false) fail(422, 'Choose a backup from this starter game dataset.');
    const imported = legacy ? convertLegacyCapture(body.document, { members: body.members, capturedAt: body.capturedAt, registry }) : null;
    const incoming = materializeOptionalSidecarEvidence(pasted?.state ?? (legacy ? imported.state : importBackup(backup, registry, { owned: true })), backup?.optionalSidecarEvidence);
    const sourceRoster = rosterOutput(incoming.members);
    const destinationRoster = rosterOutput(current.members);
    const knownRules = new Set(taskRuleDefinitions.map(rule => rule.id));
    const reportOptions = { world, taskIds: new Set(current.tasks.map(task => task.id)), knownRule: id => knownRules.has(id) };
    let state, operation = 'replace', preview, report, currencySource, warnings = imported?.warnings ?? [];
    if (route.startsWith('/api/member-restore')) {
      const owner = current.members.find(member => member.id === body.memberId);
      if (!owner) fail(400, 'Choose a known player.');
      if (!body.sourceMemberId && !incoming.members.some(member => member.id === owner.id && member.name === owner.name)) {
        if (!previewOnly) fail(422, 'Choose the source member in the preview first.');
        return { response: { mappingRequired: true, sourceRoster, destinationRoster: destinationRoster.filter(member => member.id === owner.id) } };
      }
      const sourceMemberId = body.sourceMemberId ?? owner.id;
      currencySource = { state: incoming, memberId: sourceMemberId };
      const source = incoming.members.find(member => member.id === sourceMemberId);
      if (!source) fail(400, `This backup has no map for ${displayText(owner.name)}.`);
      const mappedMember = mapTransferRoster({ ...incoming, members: [source], history: [], tasks: incoming.tasks.map(({ memberIds, ...task }) => task), taskClaims: undefined, groupGoals: undefined, finishLine: undefined, progressSnapshots: undefined }, [owner], { [sourceMemberId]: owner.id });
      const member = mappedMember.members[0];
      if (pasted) {
        member.name = owner.name;
        member.taskRules = { ...owner.taskRules, ...member.taskRules };
        pasted.report.rules = boundedOutput(pasted.report.rules.map(row => ({ ...row,
          before: owner.taskRules?.[row.key], after: member.taskRules?.[row.key] })));
      }
      if (['unlocked', 'selected', 'pendingRoll', 'blacklisted'].some(field => member[field].some(id => !world.chunks.has(id.split('-')[0])))) fail(422, 'This member backup contains unknown chunks. Ask the owner to preview the full backup to preserve them in quarantine; no member records were imported.');
      if (legacy || pasted) member.obtainedEquipment = [...(owner.obtainedEquipment ?? [])];
      const command = { type: 'replace-member', memberId: owner.id, member, source: legacy || pasted ? 'Original picker import' : 'Backup' };
      report = pasted?.report ?? transferReport(incoming, { ...reportOptions, warnings, memberId: sourceMemberId });
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
      const guarded = reconcileOptionalSidecarEvidence({ ...current }, mappedMember);
      if (pasted) guarded.provenance = { ...guarded.provenance, originalPasteImports: [
        ...(current.provenance?.originalPasteImports ?? []), { ...pasted.archive, memberId: owner.id } ] };
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
      if (!pasted) report.excludedSections = ['Other members', 'Shared rules and group plans', 'Source History and migration archives'].map(field => ({ field, reason: 'Member restore keeps the destination section. The source backup remains the portable copy.' }));
    } else {
      if (legacy) for (const member of incoming.members) member.obtainedEquipment = [...(current.members.find(owner => owner.id === member.id)?.obtainedEquipment ?? [])];
      const mapped = legacy && options.pickerId === 'legacy' ? incoming
        : mapTransferRoster(incoming, current.members, body.rosterMapping, options.requiredMemberIds, { owned: true });
      if (!mapped) {
        if (!previewOnly) fail(422, 'Review and assign the source roster before importing.');
        return { response: { mappingRequired: true, sourceRoster, destinationRoster } };
      }
      warnings = [...warnings, ...migrationSummary(mapped).warnings];
      report = transferReport(mapped, { ...reportOptions, warnings });
      quarantineTransferChunks(mapped, world);
      const replacement = await store.previewReplacement(mapped, { actor });
      state = replacement.state;
      preview = previewRestore(replacement.current, state, registry, { owned: true });
      warnings = [...warnings, ...migrationSummary(state).warnings];
    }
    const summary = { ...preview, warnings: warningOutput(preview.warnings),
      taskCounts: Object.fromEntries(['added', 'removed', 'changed'].map(key => [key, preview.tasks[key].length])) };
    // Include the destination's retained evidence and the exact portable
    // manifest before accepting: metadata must never strand an accepted save.
    const publication = await store.prepareImportPublication(state, operation, {
      currencySource,
      validateBackup: backup => { portableBackupBytes(backup, dataset); },
    });
    if (options.responseView !== undefined) {
      const saved = publication.state, builtInRegistry = createRuleRegistry();
      const rollRegistry = createRuleRegistry((job.rules ?? []).filter(rule => !builtInRegistry.get(rule.id)));
      const projected = options.responseView === PLAY_VIEW ? projectPlayState(saved) : projectBrowserState(saved);
      const metadata = importMetadataOutput({ ...(options.responseView === PLAY_VIEW ? { format: PLAY_VIEW, schemaVersion: 1 } : {}), warnings: warningOutput(warnings), transferReport: report });
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
        : legacy && !options.uploaded ? { ...boundedOutput(state), ...backupPreviewState(state) } : backupPreviewState(state), sourceRoster,
        ...(legacy && options.uploaded ? { format: 'play-v1', schemaVersion: 1 } : {}),
        warnings: warningOutput(warnings), transferReport: report } };
  } finally { await store.close(); }
}
try { await send({ result: await run(await decodeImportBytes(workerData)) }); }
catch (error) { await send({ error: { message: displayText(error.message), status: error.status ?? (error.code === 'ENOENT' ? 404 : undefined) } }); }
