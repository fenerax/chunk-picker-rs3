import path from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { openStore } from './store.mjs';
import { createOwnedStorage } from './owned-storage.mjs';
import { atomicWrite } from './atomic-write.mjs';
import { syncDirectory } from './publication.mjs';
import { withStoreWrite } from './snapshot.mjs';
import { acquireProcessGuard } from './process-guard.mjs';
import { validateState } from '../core/state.mjs';
import { runImportJob, registryMetadata } from '../import-jobs.mjs';

const json = JSON.stringify, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(json(value) + '\n');
const intentFile = directory => path.join(directory, 'owned-rebase-intent.json');
const reference = base => ({ datasetDigest: base.dataset.digest, sha256: sha(Buffer.from(json(base))) });
function refuse(message) { throw Object.assign(new Error(message), { code: 'OWNED_REBASE_REFUSED' }); }
function exact(one, two, description) {
  if (!isDeepStrictEqual(one, two) || json(one) !== json(two)) refuse(`Rebase would change ${description}.`);
}
function content(base) {
  return { tasks: Object.fromEntries(base.tasks.map(row => [row.id, row])), identityRegistry: base.identityRegistry };
}
function withoutLabel(value) { const { label, ...rest } = value; return rest; }

/** Conservative reviewed migration: no ID mapping and no historical JSON edits.
 * `complete` must include archived History. Display/retirement activation is a
 * slice-7 seam: these results can be durably staged but cannot be installed yet.
 */
export function stageOwnedDatasetUpgrade(state, complete, oldBase, newBase) {
  const next = structuredClone(state), oldRows = new Map(oldBase.tasks.map(row => [row.id, row]));
  const newRows = new Map(newBase.tasks.map(row => [row.id, row]));
  const surviving = oldBase.tasks.filter(row => newRows.has(row.id)).map(row => row.id);
  if (json(surviving) !== json(newBase.tasks.filter(row => oldRows.has(row.id)).map(row => row.id))) {
    refuse('Catalogue reorder requires an explicit migration/Undo-boundary decision in app/core/state.mjs prepareUndo.');
  }
  const prior = next.provenance?.ownedCatalogue ?? {}, retiredIds = [...(prior.retiredIds ?? [])];
  const names = { ...(prior.names ?? {}) }, decisions = [];
  const live = new Map(next.tasks.map(row => [row.id, row]));
  const historicalIds = new Set();
  function historyIds(value) {
    if (typeof value === 'string') historicalIds.add(value);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { historicalIds.add(key); historyIds(child); }
  }
  historyIds(complete.history); historyIds(complete.provenance?.restore?.previousHistory);
  const known = oldBase.identityRegistry.entries, incoming = newBase.identityRegistry.entries;
  for (const [id, row] of newRows) {
    if (retiredIds.includes(id)) refuse(`Retired ID ${id} cannot be recycled; an explicit identity migration is required.`);
    const old = oldRows.get(id);
    if (!old && (live.has(id) || historicalIds.has(id) || Object.hasOwn(state.identityRegistry?.entries ?? {}, id))) {
      refuse(`ID ${id} is already group-owned; identity reassignment requires an explicit migration/Undo-boundary decision.`);
    }
    if (old && !isDeepStrictEqual(withoutLabel(old), withoutLabel(row))) {
      refuse(`Task ${id} changed identity or semantics; an explicit migration/Undo-boundary decision is required.`);
    }
    if (old && old.label !== row.label) names[id] = row.label;
    if (!old) next.tasks.push(structuredClone(row));
  }
  const appended = next.tasks.length - state.tasks.length;
  if (appended && complete.history.some(event => event.undo?.tasks)) {
    refuse('A live or archived full-catalogue Undo snapshot would erase appended rows; an explicit migration/Undo-boundary decision in app/core/state.mjs prepareUndo is required.');
  }
  // Keep every existing row/entry/candidate verbatim, including removed rows and
  // aliases referenced only by History, old backups or inverse guards.
  if (!next.identityRegistry) refuse('An absent identity registry requires an explicit identity migration decision.');
  for (const [id, entry] of Object.entries(incoming)) {
    if (retiredIds.includes(id)) refuse(`Retired ID ${id} cannot be recycled.`);
    if (known[id] && !isDeepStrictEqual(withoutLabel(known[id]), withoutLabel(entry))) {
      refuse(`Identity ${id} was reassigned; an explicit identity migration/Undo-boundary decision is required.`);
    }
    if (!known[id] && (historicalIds.has(id) || Object.hasOwn(next.identityRegistry.entries, id))) {
      refuse(`Identity ${id} collides with a saved or historical identity; an explicit identity migration/Undo-boundary decision is required.`);
    }
    if (known[id]?.label !== entry.label && known[id]) names[id] = entry.label;
    if (!Object.hasOwn(next.identityRegistry.entries, id)) next.identityRegistry.entries[id] = structuredClone(entry);
  }
  const oldAliases = oldBase.identityRegistry.aliases, groupAliases = next.identityRegistry.aliases;
  for (const [alias, value] of Object.entries(newBase.identityRegistry.aliases)) {
    const old = oldAliases[alias], group = groupAliases[alias];
    // Compare release changes with their baseline, never with generated/group
    // additions alone. Equality includes presence and exact candidate order.
    if (json(old) === json(value)) continue;
    if (!Object.hasOwn(oldAliases, alias) && json(group) === json(value)) continue;
    if (json(group) === json(old)) groupAliases[alias] = structuredClone(value);
    else {
      // Both changed: retain the staged group value, but refuse installation.
      // Removed release aliases are outside this loop and remain untouched.
      decisions.push(`Alias ${alias}: explicit alias migration decision required; old candidate order retained.`);
    }
  }
  for (const id of new Set([...oldRows.keys(), ...Object.keys(known)])) {
    if ((oldRows.has(id) && !newRows.has(id) || Object.hasOwn(known, id) && !Object.hasOwn(incoming, id)) && !retiredIds.includes(id)) retiredIds.push(id);
  }
  if (retiredIds.length) decisions.push('Slice 7: calculator retirement filtering must be decided before activating retired IDs.');
  if (Object.keys(names).length) decisions.push('Slice 7: catalogue display metadata must be consumed before activating name changes.');
  next.provenance = { ...next.provenance, dataset: structuredClone(newBase.dataset),
    ownedCatalogue: { ...prior, retiredIds, names } };
  return { state: next, migration: { kind: 'catalogue-append', appended, retiredIds, names, decisions } };
}

async function exclusive({ dataDir, ownedFormat2 }, work) {
  const directory = path.resolve(dataDir);
  if (!ownedFormat2 || ownedFormat2.pickerId === 'legacy-shared') refuse('Rebase requires explicit owned format-2 options.');
  const storage = createOwnedStorage(ownedFormat2, directory);
  return withStoreWrite(directory, async () => {
    // A live command writer refuses, rather than racing a stopped migration.
    const release = await acquireProcessGuard(directory);
    try { return await storage.withLease(() => work(directory, storage), { mode: 'exclusive' }); }
    finally { await release(); }
  });
}
async function noIntent(directory) {
  try { await readFile(intentFile(directory)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  refuse('An owned rebase intent already exists; explicitly reconcile it first.');
}
function targetStorage(options, target, directory) {
  // Operators supply both trust anchors independently of the intent/save.
  if (!target?.dataset || !target.manifest) refuse('An explicit independently pinned target base is required.');
  return createOwnedStorage({ ...options, ...target, pickerId: options.pickerId,
    catalogueRoot: options.catalogueRoot }, directory);
}
async function binding(directory, dataset) {
  const result = await readFile(directory + '.dataset.json'), value = JSON.parse(result);
  if (value.schemaVersion !== 1 || value.datasetId !== dataset.id || value.datasetContractVersion !== dataset.contractVersion
    || value.digest !== dataset.digest || Object.keys(value).some(key => !['schemaVersion', 'datasetId', 'datasetContractVersion', 'digest', 'requiresPack'].includes(key))
    || Object.hasOwn(value, 'requiresPack') && value.requiresPack !== true) refuse('Source dataset binding does not match its pinned base.');
  return result;
}

/** Stopped-writer API only. Publication is a separate explicit reconciliation.
 * Nothing calls this from startup, commands, profiles, jobs or environment flags.
 */
export async function stageOwnedRebase({ dataDir, ownedFormat2, target, upgrade = false, registry, crash } = {}) {
  return exclusive({ dataDir, ownedFormat2 }, async (directory, source) => {
    await noIntent(directory);
    const oldBytes = await readFile(path.join(directory, 'state.json')), document = JSON.parse(oldBytes);
    if (document.storage?.schemaVersion !== 2) refuse('Rebase requires an existing storage-2 save.');
    await source.select(document.storage.base); // Verify the actual old pin/file first.
    await source.ensurePublished();
    const destination = targetStorage(ownedFormat2, target, directory);
    await destination.codec(); // Exact release bytes, or a verified existing file.
    const oldBase = source.base, newBase = destination.base;
    if (oldBase.dataset.id !== newBase.dataset.id || oldBase.dataset.contractVersion !== newBase.dataset.contractVersion) refuse('Wrong dataset: explicit cross-dataset migration is required.');
    const oldBinding = await binding(directory, oldBase.dataset);
    const reader = await openStore({ dataDir: directory, ownedFormat2, readOnly: true, completionCodec: false, retention: false, registry });
    let state, complete;
    try {
      state = reader.getState();
      complete = (await runImportJob({ kind: 'backup', dataDir: directory, rules: registryMetadata(registry),
        retention: false, completionCodec: false, ownedFormat2: source.readerOptions })).state;
    }
    finally { await reader.close(); }
    let migration = { kind: 'storage-only', decisions: [] }, next = state;
    if (upgrade) ({ state: next, migration } = stageOwnedDatasetUpgrade(state, complete, oldBase, newBase));
    else if (!isDeepStrictEqual(content(oldBase), content(newBase))) refuse('Catalogue content changed; use the explicit dataset-upgrade staging API.');
    const codec = await destination.codec(), encoded = codec.encode(next);
    const inflated = codec.decode(encoded).state;
    exact(next, inflated, 'inflated logical state, ordered rows or dictionaries');
    const hydrated = { ...inflated, history: complete.history, ...(inflated.provenance ? { provenance: { ...inflated.provenance } } : {}) };
    if (hydrated.provenance) delete hydrated.provenance.historyArchive;
    exact(hydrated, validateState(hydrated, registry), 'validated migration result');
    exact(complete.history, hydrated.history, 'ordered History and Undo JSON');
    const historySHA256 = sha(json(complete.history));
    if (!upgrade) exact(complete, hydrated, 'complete logical state');
    const result = bytes({ ...document, ...encoded });
    const receipt = JSON.parse(oldBinding);
    const newBinding = bytes({ ...receipt, digest: newBase.dataset.digest });
    const id = randomUUID(), stage = path.join(directory, 'owned-rebase', id);
    await mkdir(stage, { recursive: true }); await syncDirectory(path.dirname(stage)); await syncDirectory(directory);
    const preimage = `${String(state.revision).padStart(16, '0')}-${id.replaceAll('-', '').slice(0, 16)}.json.gz`;
    await crash?.('before-preimage');
    const pinned = gzipSync(bytes({ ...document, retentionPinned: true, retentionLabel: 'owned-rebase' }));
    await atomicWrite(path.join(directory, 'backups', preimage), pinned);
    await crash?.('after-preimage');
    const files = { oldState: oldBytes, state: result, oldBinding, binding: newBinding, complete: bytes(complete) };
    for (const [name, value] of Object.entries(files)) await atomicWrite(path.join(stage, name), value);
    const intent = { schemaVersion: 1, id, oldBase: document.storage.base, newBase: reference(newBase),
      preimage, preimageSHA256: sha(pinned), historySHA256, migration,
      files: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, sha(value)])) };
    await atomicWrite(intentFile(directory), bytes(intent));
    await crash?.('intent-durable');
    return intent;
  });
}

/** Explicit stopped reconciliation; hash comparisons make every rename resumable.
 * Missing/corrupt dependencies never fall back to another release or empty data.
 */
export async function reconcileOwnedRebase({ dataDir, ownedFormat2, target, action = 'commit', crash } = {}) {
  if (!['commit', 'abort'].includes(action)) refuse('Reconciliation action must be commit or abort.');
  return exclusive({ dataDir, ownedFormat2 }, async (directory, source) => {
    const intent = JSON.parse(await readFile(intentFile(directory)));
    if (intent.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(intent.id)
      || !/^\d{16}-[a-f0-9]{16}\.json\.gz$/.test(intent.preimage)) refuse('Invalid rebase intent.');
    await source.select(intent.oldBase);
    const stage = path.join(directory, 'owned-rebase', intent.id), files = {};
    for (const name of ['oldState', 'state', 'oldBinding', 'binding', 'complete']) {
      files[name] = await readFile(path.join(stage, name));
      if (sha(files[name]) !== intent.files[name]) refuse(`Staged ${name} checksum mismatch.`);
    }
    if (sha(await readFile(path.join(directory, 'backups', intent.preimage))) !== intent.preimageSHA256) refuse('Pinned preimage checksum mismatch.');
    const stateFile = path.join(directory, 'state.json'), bindingFile = directory + '.dataset.json';
    for (const [file, oldKey, newKey] of [[stateFile, 'oldState', 'state'], [bindingFile, 'oldBinding', 'binding']]) {
      if (![intent.files[oldKey], intent.files[newKey]].includes(sha(await readFile(file)))) refuse('Rebase source generation changed; explicit recovery decision required.');
    }
    if (action === 'commit') {
      if (intent.migration.decisions.length) refuse(intent.migration.decisions.join(' '));
      const destination = targetStorage(ownedFormat2, target, directory);
      await destination.codec();
      exact(intent.newBase, reference(destination.base), 'target pin');
      // Inflation is checked again on resume, independently of publication progress.
      const staged = (await destination.codec()).decode(JSON.parse(files.state));
      const complete = JSON.parse(files.complete), hydrated = { ...staged.state, history: complete.history };
      if (hydrated.provenance?.historyArchive) {
        hydrated.provenance = { ...hydrated.provenance }; delete hydrated.provenance.historyArchive;
      }
      if (sha(json(complete.history)) !== intent.historySHA256) refuse('Ordered History checksum mismatch.');
      if (intent.migration.kind === 'storage-only') exact(complete, hydrated, 'complete logical state');
      await crash?.('before-base-publication'); await destination.ensurePublished(); await crash?.('after-base-publication');
    } else await source.ensurePublished();
    const bindingBytes = action === 'commit' ? files.binding : files.oldBinding;
    const stateBytes = action === 'commit' ? files.state : files.oldState;
    await crash?.('before-binding-publication');
    await atomicWrite(bindingFile, bindingBytes); await crash?.('after-binding-publication');
    await crash?.('before-state-rename');
    await atomicWrite(stateFile, stateBytes, { afterRename: () => crash?.('after-state-rename') });
    await crash?.('before-intent-clear');
    await unlink(intentFile(directory)); await syncDirectory(directory);
    return { id: intent.id, action, historySHA256: intent.historySHA256, migration: intent.migration };
  });
}
