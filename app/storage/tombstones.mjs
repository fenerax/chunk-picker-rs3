import { rm } from 'node:fs/promises';
import path from 'node:path';
import { syncDirectory } from './registry-lock.mjs';

/** Reapply even completed tombstones: an older checkpoint may have restored
 * directories or credentials. Call before opening any owned picker context.
 * Runtime hooks must fence delivery, cancel only this picker's jobs and drain
 * all accepted writes before returning. The external ledger must be retained. */
export async function reconcileTombstones({ registry, revokeSessions, drainPicker, revokeAccount } = {}) {
  const result = await registry.reconcileTombstones();
  for (const id of result.blockedPickerIds) {
    const directory = registry.deletionDirectory(id);
    // Revocation and close are one runtime operation, keeping their first
    // synchronous delivery fence ahead of any asynchronous sidecar writes.
    await drainPicker?.(id, 'revoke');
    await revokeSessions?.({ pickerId: id });
    await registry.advanceDeletion('picker', id, 'revoked');
    await drainPicker?.(id, 'drain');
    await registry.advanceDeletion('picker', id, 'drained');
    await rm(directory, { recursive: true, force: true });
    await syncDirectory(path.dirname(directory));
    await registry.advanceDeletion('picker', id, 'directory-removed');
    await rm(directory + '.dataset.json', { force: true });
    await syncDirectory(path.dirname(directory));
    await registry.advanceDeletion('picker', id, 'binding-removed');
    await registry.completePickerDeletion(id);
    await registry.advanceDeletion('picker', id, 'complete');
  }
  const runtimeAccounts = new Set(registry.deletionRecords().accounts.filter(t => t.purgeProgress !== undefined).map(t => t.accountId));
  if (revokeAccount) for (const id of result.deletedAccountIds.filter(id => runtimeAccounts.has(id))) {
    await revokeAccount(id);
    await registry.advanceDeletion('account', id, 'complete');
  }
  return result;
}

export function backupDeletionDisclosure(retentionMs) {
  if (retentionMs !== undefined && (!Number.isSafeInteger(retentionMs) || retentionMs <= 0)) throw new TypeError('Backup retention must be a positive finite number of milliseconds.');
  return { retentionMs: retentionMs ?? null, message: retentionMs === undefined
    ? 'Retained backups are not erased immediately. The retention period is not configured.'
    : `Retained backups are not erased immediately. They expire under the operator-configured retention period of ${retentionMs} milliseconds.` };
}
