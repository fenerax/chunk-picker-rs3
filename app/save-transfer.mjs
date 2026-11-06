import { boundedOutput, REPORT_RECORDS } from './import-output.mjs';
import { createHash, randomUUID } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function transferDigest(value) {
  const hash = createHash('sha256');
  // Native serialization runs only in the checker worker. Hash large batches,
  // rather than reconstructing JSON and entering crypto for every leaf.
  const json = JSON.stringify(value);
  for (let offset = 0; offset < json.length;) {
    // Keep UTF-16 surrogate pairs together when converting a batch to UTF-8.
    let end = Math.min(json.length, offset + 64 * 1024);
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    hash.update(json.slice(offset, end));
    offset = end;
  }
  return hash.digest('hex');
}
export const backupCoverage = Object.freeze({ included: ['Gameplay state', 'Hydrated saved History', 'Identity and migration archives'],
  excluded: ['Unaccepted plugin evidence and review sidecars', 'Accounts, sessions, invitations and plugin keys', 'Reference datasets and artwork'] });

export function transferManifest(dataset, members) {
  return { version: 1, app: 'rs3-chunk-picker', schemaVersion: 1,
    dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest,
      coordinateSystem: dataset.coordinateSystem, identityNamespace: dataset.identityNamespace },
    roster: members.map(({ id, name }) => ({ id, name })), coverage: backupCoverage };
}

export function requireTransferDataset(dataset, backup) {
  const identity = backup.state?.provenance?.dataset;
  // Version-1 legacy backups predate manifests. Only the legacy world can adopt them.
  if (!identity && dataset.datasetId === 'duo-legacy' && !backup.transfer) return;
  if (!identity || identity.id !== dataset.datasetId || identity.contractVersion !== dataset.datasetContractVersion || identity.digest !== dataset.digest) {
    fail(422, 'Dataset mismatch: this backup needs the same dataset ID, contract version and digest. No records were imported.');
  }
  const contract = backup.transfer?.dataset;
  if (contract && (contract.id !== identity.id || contract.contractVersion !== identity.contractVersion || contract.digest !== identity.digest
    || contract.coordinateSystem !== dataset.coordinateSystem || contract.identityNamespace !== dataset.identityNamespace)) {
    fail(422, 'Coordinate or identity dataset contract mismatch. No records were imported.');
  }
}

// Remap only schema-defined member references. Notes, task IDs, source map IDs
// and historical archives are evidence, never identifiers to search-and-replace.
export function mapTransferRoster(state, destinations, mapping, requiredIds = destinations.map(m => m.id), { owned = false } = {}) {
  const source = state.members.map(m => m.id), existing = destinations.map(m => m.id);
  const destinationById = new Map(destinations.map(member => [member.id, member]));
  const sameNames = state.members.every(member => {
    const destination = destinationById.get(member.id);
    return destination?.name === undefined || destination.name === member.name;
  });
  if (!mapping && (JSON.stringify(source) !== JSON.stringify(existing) || !sameNames)) return null;
  const entries = mapping ?? Object.fromEntries(source.map(id => [id, id]));
  if (!entries || Array.isArray(entries) || Object.keys(entries).length !== source.length
    || source.some(id => !Object.hasOwn(entries, id))) fail(400, 'Assign every source member exactly once.');
  const targets = source.map(id => entries[id]), targetIds = new Set(targets);
  if (targets.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id))
    || targetIds.size !== targets.length || requiredIds.some(id => !targetIds.has(id))) {
    fail(422, 'Map each source member to a different destination member, keeping every assigned destination participant. Use a fresh picker when an assigned roster cannot fit.');
  }
  const next = owned ? state : structuredClone(state), mapped = id => Object.hasOwn(entries, id) ? entries[id] : id;
  const changed = source.some(id => entries[id] !== id);
  if (next.provenance?.pluginCurrencyFacts) next.provenance = { ...next.provenance,
    pluginCurrencyFacts: Object.fromEntries(Object.entries(next.provenance.pluginCurrencyFacts)
      .filter(([id]) => Object.hasOwn(entries, id)).map(([id, fact]) => [mapped(id), fact])) };
  // Foreign inverses must never become live at another roster. Keep the exact
  // original history in provenance, as the normal restore boundary does.
  if (changed) {
    next.provenance = { ...next.provenance, transferRoster: { ...(next.provenance?.transferRoster ? { previous: next.provenance.transferRoster } : {}), mapping: entries, sourceRoster: state.members.map(({ id, name }) => ({ id, name })), history: next.history,
      ...(next.legacy?.gameplayMigration ? { gameplayMigration: structuredClone(next.legacy.gameplayMigration) } : {}) } };
    next.history = [];
  }
  for (const member of next.members) {
    member.id = mapped(member.id);
    for (const field of ['skillProgress', 'questProgress', 'achievementProgress', 'itemProgress']) {
      for (const row of Object.values(member[field] ?? {})) if (row.memberId !== undefined) row.memberId = mapped(row.memberId);
    }
  }
  // These records drive readiness and live compatibility projection. The exact
  // source attribution remains in transferRoster above, alongside source History.
  const migration = next.legacy?.gameplayMigration;
  for (const field of ['migratedMembers', 'journalMigratedMembers', 'unresolved', 'taskStatusProvenance']) {
    for (const row of migration?.[field] ?? []) if (row.memberId !== undefined) row.memberId = mapped(row.memberId);
  }
  for (const row of next.provenance?.taskIdentityMigration?.legacyAlternativeMembers ?? []) row.memberId = mapped(row.memberId);
  for (const task of next.tasks) if (task.memberIds) task.memberIds = task.memberIds.map(mapped);
  for (const claim of Object.values(next.taskClaims ?? {})) claim.memberId = mapped(claim.memberId);
  for (const goal of next.groupGoals ?? []) goal.completedBy = goal.completedBy.map(mapped);
  for (const item of next.finishLine?.customItems ?? []) item.completedBy = item.completedBy.map(mapped);
  if (next.progressSnapshots) next.progressSnapshots.memberIds = next.progressSnapshots.memberIds.map(mapped);
  return next;
}

export function transferReport(state, { world, taskIds = new Set(), knownRule = () => true, warnings = [], memberId } = {}) {
  const records = [];
  let total = 0;
  const definitions = new Map(state.tasks.map(task => [task.id, task]));
  const add = (owner, field, key, rawValue, reason, outcome = 'preserved-for-review') => {
    total++;
    if (records.length < REPORT_RECORDS) records.push(boundedOutput({ owner, field, key, rawValue, candidateMatches: [], reason, outcome }, { bytes: 1536 }));
  };
  for (const member of state.members.filter(m => !memberId || m.id === memberId)) {
    for (const field of ['unlocked', 'selected', 'pendingRoll', 'blacklisted']) for (const id of member[field]) {
      if (world && !world.chunks.has(id.split('-')[0])) add(member.id, field, id, id, 'Unknown chunk; quarantined in the portable archive and excluded from active territory.');
    }
    const completed = new Set(member.completedTasks);
    for (const id of new Set([...completed, ...Object.keys(member.taskStatus ?? {})])) if (!taskIds.has(id)) add(member.id, 'taskProgress', id,
      { definition: definitions.get(id), completed: completed.has(id), status: member.taskStatus?.[id] }, 'Not in the destination saved catalogue; the source task definition and progress are retained.');
    for (const [id, raw] of Object.entries(member.taskRules ?? {})) if (!knownRule(id)) add(member.id, 'taskRules', id, raw, 'Unknown task rule retained for review.');
  }
  for (const row of state.legacy?.gameplayMigration?.unresolved ?? []) {
    if (memberId && row.memberId !== memberId) continue;
    const raw = state.legacy?.maps?.[row.sourceMapId]?.chunkinfo?.[row.source]?.[row.category]?.[row.legacyKey];
    add(row.memberId, `chunkinfo.${row.source}.${row.category}`, row.legacyKey, raw ?? row, row.reason);
    if (total <= REPORT_RECORDS) records.at(-1).candidateMatches = boundedOutput(row.candidates ?? [], { bytes: 512 });
  }
  const archives = [state.provenance];
  while (archives.length) {
    const archive = archives.pop();
    if (!archive) continue;
    for (const row of archive.taskIdentityMigration?.unresolved ?? []) add(row.memberId ?? null, row.path, row.originalId, row, 'Unresolved task identity retained in migration archives.');
    for (const row of archive.transferQuarantine?.records ?? []) add(row.memberId, row.field, row.id, row, 'Previously quarantined chunk retained in the portable archive.');
    if (archive.restore?.incomingProvenance) archives.push(archive.restore.incomingProvenance);
  }
  for (const warning of warnings) add(null, 'migration', null, warning, warning);
  return { format: 'rs3-chunk-transfer-report', version: 1, coverage: backupCoverage, records,
    counts: { preservedForReview: total, dropped: 0, omitted: total - records.length },
    ...(total > records.length ? { more: `and ${total - records.length} more; complete records are retained in the backup` } : {}),
    history: 'Whole-save restore starts a new Undo boundary; previous saves and incoming History remain retained.' };
}

export function quarantineTransferChunks(state, world) {
  const records = [];
  for (const member of state.members) for (const field of ['unlocked', 'selected', 'pendingRoll', 'blacklisted']) {
    member[field] = member[field].filter((id, index) => {
      if (world.chunks.has(id.split('-')[0])) return true;
      records.push({ memberId: member.id, field, id, index }); return false;
    });
  }
  if (records.length) {
    state.provenance = { ...state.provenance, transferQuarantine: { ...(state.provenance?.transferQuarantine ? { previous: state.provenance.transferQuarantine } : {}), records: [...(state.provenance?.transferQuarantine?.records ?? []), ...records], history: state.history } };
    state.history = [];
  }
  return state;
}

// Small bounded receipts bind reviewed bytes/options to the caller and revision.
export function createTransferReviews({ now = Date.now } = {}) {
  const reviews = new Map();
  const digest = body => body.transferHash ?? transferDigest({ backup: body.backup, backupId: body.backupId,
    document: body.document, members: body.members, memberId: body.memberId, sourceMemberId: body.sourceMemberId, rosterMapping: body.rosterMapping });
  return {
    preview(body, identity, revision) {
      for (const [id, review] of reviews) if (review.until <= now()) reviews.delete(id);
      if (reviews.size >= 8) reviews.delete(reviews.keys().next().value);
      const token = randomUUID(); reviews.set(token, { hash: digest(body), actor: identity.sessionId ?? identity.id, revision, until: now() + 15 * 60 * 1000 }); return token;
    },
    check(body, identity, revision) {
      const review = reviews.get(body.previewToken);
      if (!review || review.until <= now() || review.actor !== (identity.sessionId ?? identity.id) || review.revision !== revision || review.hash !== digest(body)) {
        fail(409, 'The reviewed backup, mapping or destination changed, or the preview expired. Preview the backup again.');
      }
    },
  };
}
