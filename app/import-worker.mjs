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
import { boundedOutput, displayText, warningOutput } from './import-output.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
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
  const prepareState = async (state, context) => {
    if (job.prepareHook) state = await new Promise(resolve => {
      parentPort.once('message', message => resolve(message.hookResult));
      parentPort.postMessage({ hook: true, state, context: { operation: context.operation, migration: context.migration, catalogue: context.catalogue } });
    });
    return identityPreparation ? identityPreparation(state, context) : state;
  };
  prepareState.isCurrent = () => true;
  if (migrateState) migrateState.isCurrent = () => true;
  const store = await openStore({ dataDir: job.dataDir, registry, readOnly: true, importReader: true, migrateState, prepareState, now: options.now });
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
    const incoming = legacy ? imported.state : importBackup(backup, registry);
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
      const member = mapTransferRoster({ ...incoming, members: [source], history: [], tasks: incoming.tasks.map(({ memberIds, ...task }) => task), taskClaims: undefined, groupGoals: undefined, finishLine: undefined, progressSnapshots: undefined }, [owner], { [sourceMemberId]: owner.id }).members[0];
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
      state = applyValidatedCommand(current, command, { expectedRevision: current.revision, world, registry, actor, now: options.now });
      // Member commands preserve the complete guarded Undo chain.
      const revision = state.revision;
      const context = { operation: 'command', world, registry };
      if (migrateState) state = migrateState(state, context);
      state = validateState(await prepareState(state, context), registry);
      if (state.revision !== revision) throw new TypeError('prepareState must preserve the authoritative revision.');
      operation = 'command';
      preview = previewRestore({ ...current, history: [] }, { ...state, history: [] }, registry);
      report.excludedSections = ['Other members', 'Shared rules and group plans', 'Source History and migration archives'].map(field => ({ field, reason: 'Member restore keeps the destination section. The source backup remains the portable copy.' }));
    } else {
      if (legacy) for (const member of incoming.members) member.obtainedEquipment = [...(current.members.find(owner => owner.id === member.id)?.obtainedEquipment ?? [])];
      const mapped = legacy && options.pickerId === 'legacy' ? incoming
        : mapTransferRoster(incoming, current.members, body.rosterMapping, options.requiredMemberIds);
      if (!mapped) {
        if (!previewOnly) fail(422, 'Review and assign the source roster before importing.');
        return { response: { mappingRequired: true, sourceRoster, destinationRoster: current.members.map(({ id, name }) => ({ id, name })) } };
      }
      warnings = [...warnings, ...migrationSummary(mapped).warnings];
      report = transferReport(mapped, { ...reportOptions, warnings });
      quarantineTransferChunks(mapped, world);
      const replacement = await store.previewReplacement(mapped, { actor });
      state = replacement.state;
      preview = previewRestore(replacement.current, state, registry);
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
    return { state, operation, workerMs: performance.now() - start,
      response: { preview: summary, state: legacy && !options.uploaded ? state : backupPreviewState(state), sourceRoster,
        ...(legacy && options.uploaded ? { format: 'play-v1', schemaVersion: 1 } : {}),
        warnings: warningOutput(warnings), transferReport: report } };
  } finally { await store.close(); }
}
try { parentPort.postMessage({ result: await run(workerData) }); }
catch (error) { parentPort.postMessage({ error: { message: displayText(error.message), status: error.status } }); }
