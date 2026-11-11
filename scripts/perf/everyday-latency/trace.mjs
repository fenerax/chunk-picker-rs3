// Probe-only loader instrumentation. Application files on disk are unchanged.
// Preloaded in calculator children as well, where no observer is installed.
import { registerHooks } from 'node:module';
const event = (phase, directory, details) => globalThis.__everydayTrace?.(phase, directory, details);
globalThis.__everydayEvent = event;
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/app/storage/store.mjs') && !url.endsWith('/app/storage/owned-storage.mjs')) return result;
  let source = String(result.source).replaceAll('\r\n', '\n');
  const patch = (anchor, replacement) => {
    if (!source.includes(anchor)) throw Error('Missing trace anchor: ' + anchor);
    source = source.replace(anchor, replacement);
  };
  if (url.endsWith('/owned-storage.mjs')) {
    patch('const previous = admissions.get(root) ?? Promise.resolve();', 'globalThis.__everydayEvent("lease-request", dataDir, { queued: admissions.has(root) }); const previous = admissions.get(root) ?? Promise.resolve();');
    patch('try { return await lease.run(root, work); } finally { await release(); }', 'globalThis.__everydayEvent("lease-enter", dataDir); try { return await lease.run(root, work); } finally { globalThis.__everydayEvent("lease-exit", dataDir); await release(); }');
  } else {
    for (const [anchor, phase] of [
      ['const baseline = current;\n      const reviewedItems', 'command-start'],
      ['const next = applyStoredCommand(input.state, command,', 'apply-start'],
      ['inheritStateMetadata(input.state, next);', 'apply-end'],
      ['next = await publicationState(next, operation', 'publication-start'],
      ['const observed = inheritStateMetadata(next, cleanup', 'publication-end'],
      ['if (!cleanup) await retainBackup(current, operation, backupLabel);', 'backup-start'],
      ['const { ledger: nextReceipts, result: receiptResult }', 'backup-end'],
      ['const diskDocument = await serializedDiskState(validated,', 'encode-start'],
      ['const publication = await publishItemState(validated,', 'encode-end'],
      ['pendingPublication.published = true;', 'durable'],
      ["await ownedStorage?.crash?.('memory-published');", 'memory-published'],
      ['await prepareRollPools();\n      if (view', 'snapshot-start'],
      ['if (current === captured) return commandSnapshot(baseline, omitUnchanged, view);', 'snapshot-ready'],
    ]) patch(anchor, 'globalThis.__everydayEvent(' + JSON.stringify(phase) + ', directory); ' + anchor);
  }
  return { ...result, source };
} });
