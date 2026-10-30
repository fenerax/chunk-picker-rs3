import { randomBytes } from 'node:crypto';
import { reconcileTombstones, backupDeletionDisclosure } from './storage/tombstones.mjs';
import { bodyJSON, httpError, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';

/** Session-derived self-service operations only. No caller-supplied target. */
export function createPickerDeletion({ registry, legacy, backupRetentionMs, fencePicker, fenceSessions, drainPicker, afterPurge, now = Date.now }) {
  const backups = backupDeletionDisclosure(backupRetentionMs);
  let deletionQueue = Promise.resolve();
  const confirmations = new Map(), lifetimeMs = 5 * 60 * 1000;
  function accountDeletionToken(identity) {
    if (identity?.kind !== 'account' || !identity.accountId || !identity.sessionId) return undefined;
    const time = now();
    for (const [session, value] of confirmations) if (value.expiresAt <= time) confirmations.delete(session);
    let value = confirmations.get(identity.sessionId);
    if (!value || value.accountId !== identity.accountId) {
      value = { token: randomBytes(32).toString('base64url'), accountId: identity.accountId, expiresAt: time + lifetimeMs };
      confirmations.set(identity.sessionId, value);
      while (confirmations.size > 1000) confirmations.delete(confirmations.keys().next().value);
    }
    return value.token;
  }
  async function handle(request, response, selected) {
    if (request.method !== 'POST') throw httpError(405, 'Use POST.');
    if (selected.identity?.kind !== 'account' || !selected.identity.accountId) throw httpError(403, 'Signed-in account access required.');
    checkRequestOrigin(request, selected.security);
    const body = await bodyJSON(request, 8192);
    const accountDeletion = selected.deletion === '/api/account/delete';
    if (Object.keys(body).some(key => !accountDeletion || key !== 'accountDeletionToken')) throw httpError(400, 'Unexpected deletion fields.');
    const pending = deletionQueue.then(async () => {
      // Reauthenticate after the body and again inside the deletion queue.
      const identity = legacy.authenticate(request, selected.security);
      if (!identity || identity.kind !== 'account' || identity.accountId !== selected.identity.accountId || identity.sessionId !== selected.identity.sessionId) throw httpError(401, 'Access required.');
      const fence = ids => {
        for (const id of ids) fencePicker(id);
        fenceSessions();
      };
      if (accountDeletion) {
        const confirmation = confirmations.get(identity.sessionId);
        if (!confirmation || typeof body.accountDeletionToken !== 'string' || confirmation.token !== body.accountDeletionToken
          || confirmation.accountId !== identity.accountId || confirmation.expiresAt <= now()) {
          throw httpError(409, 'The account confirmation changed or expired. Confirm deletion again.');
        }
        confirmations.delete(identity.sessionId);

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
      afterPurge?.();
      await json(request, response, 200, { status: 'deleted', backups });
    });
    deletionQueue = pending.catch(() => {}); await pending;
  }
  return { handle, accountDeletionToken, drain: () => deletionQueue };
}
