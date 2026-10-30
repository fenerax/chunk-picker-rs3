import { reconcileTombstones, backupDeletionDisclosure } from './storage/tombstones.mjs';
import { bodyJSON, httpError, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';

/** Session-derived self-service operations only. No caller-supplied target. */
export function createPickerDeletion({ registry, legacy, backupRetentionMs, fencePicker, fenceSessions, drainPicker }) {
  const backups = backupDeletionDisclosure(backupRetentionMs);
  let deletionQueue = Promise.resolve();
  async function handle(request, response, selected) {
    if (request.method !== 'POST') throw httpError(405, 'Use POST.');
    if (selected.identity?.kind !== 'account' || !selected.identity.accountId) throw httpError(403, 'Signed-in account access required.');
    checkRequestOrigin(request, selected.security);
    const body = await bodyJSON(request, 8192);
    if (Object.keys(body).length) throw httpError(400, 'Deletion takes no fields.');
    const pending = deletionQueue.then(async () => {
      // Reauthenticate after the body and again inside the deletion queue.
      const identity = legacy.authenticate(request, selected.security);
      if (!identity || identity.kind !== 'account' || identity.accountId !== selected.identity.accountId || identity.sessionId !== selected.identity.sessionId) throw httpError(401, 'Access required.');
      const fence = ids => {
        for (const id of ids) fencePicker(id);
        fenceSessions();
      };
      if (selected.deletion === '/api/account/delete') {
        const ids = registry.listPickers().filter(p => p.kind === 'default' && p.ownerAccountId === identity.accountId && p.lifecycle === 'active').map(p => p.id);
        await registry.deleteAccount(identity.accountId, { runtimePurge: true, onTombstone: () => fence(ids) });
      }
      else {
        const picker = identity.pickerId && registry.getPicker(identity.pickerId);
        const membership = registry.getAccount(identity.accountId)?.memberships.find(m => m.pickerId === identity.pickerId);
        if (picker?.kind !== 'default' || picker.ownerAccountId !== identity.accountId || membership?.role !== 'owner') throw httpError(403, 'Owned picker access required. The shared picker cannot be deleted.');
        await registry.beginPickerDeletion(picker.id, { onTombstone: () => fence([picker.id]) });
      }
      await reconcileTombstones({ registry, revokeSessions: scope => legacy.revokeDeletionSessions(scope),
        revokeAccount: id => legacy.revokeDeletedAccount(id), drainPicker });
      await json(request, response, 200, { status: 'deleted', backups });
    });
    deletionQueue = pending.catch(() => {}); await pending;
  }
  return { handle, drain: () => deletionQueue };
}
