import { createHash, timingSafeEqual } from 'node:crypto';
import { generateToken } from './security/tokens.mjs';
import { reconcileTombstones, backupDeletionDisclosure } from './storage/tombstones.mjs';
import { bodyJSON, httpError, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';
import { createCharacterDeletionService } from './character-deletion-service.mjs';

const cookieDigest = request => createHash('sha256').update(request.headers.cookie ?? '').digest('hex');
export function createPickerDeletion({ registry, legacy, using, backupRetentionMs, fencePicker, fenceSessions, drainPicker, afterPurge, now = Date.now }) {
  const backups = backupDeletionDisclosure(backupRetentionMs), confirmations = new Map(), lifetimeMs = 5 * 60 * 1000;
  const purge = async () => {
    for (const d of registry.deletionRecords().pickers) fencePicker(d.pickerId);
    await reconcileTombstones({ registry, revokeSessions: scope => legacy.revokeDeletionSessions(scope), revokeAccount: id => legacy.revokeDeletedAccount(id), drainPicker });
    afterPurge?.();
  };
  const service = createCharacterDeletionService({ registry, using, purge, fenceSessions, point: (name, id) => registry.groupInvitePoint(name, id) });
  const clean = () => { for (const [key, value] of confirmations) if (value.expiresAt <= now() && !registry.getDeletion(value.requestId)) confirmations.delete(key); };
  async function handle(request, response, security, bindBody) {
    const url = new URL(request.url, 'http://localhost'), alias = url.pathname !== '/api/deletion';
    if (!['GET', 'POST'].includes(request.method) || alias && request.method !== 'POST') throw httpError(405, alias ? 'Use POST.' : 'Use GET or POST.');
    clean();
    const admitted = legacy.authenticate(request, security);
    bindBody?.({ accountId: admitted?.accountId ?? security.rateKey, pickerId: 'account' });
    let body, confirmation;
    if (request.method === 'POST') {
      checkRequestOrigin(request, security); body = await bodyJSON(request, 4096);
      if (Object.keys(body).some(k => !['requestId', 'reviewToken', 'confirmed', 'finalGroupConfirmed'].includes(k))) throw httpError(400, 'Unexpected deletion fields.');
      confirmation = confirmations.get(body.reviewToken);
    }
    const allowed = ['kind', 'character', 'picker', 'deleteGroup'];
    if ([...url.searchParams.keys()].some(k => !allowed.includes(k)) || allowed.some(k => url.searchParams.getAll(k).length > 1)) throw httpError(403, 'Conflicting deletion targets.');
    const kind = alias ? url.pathname.split('/')[2] : url.searchParams.get('kind');
    const selection = { kind, characterId: kind === 'account' ? null : url.searchParams.get('character'), pickerId: kind === 'account' ? null : url.searchParams.get('picker'), deleteGroup: url.searchParams.get('deleteGroup') === 'true' };
    if (kind === 'account' && (url.searchParams.has('character') || url.searchParams.has('picker'))) throw httpError(403, 'Account deletion always reviews the complete login.');
    for (const [header, value] of [['x-character-id', selection.characterId], ['x-picker-id', selection.pickerId], ['x-picker', selection.pickerId]]) {
      if (request.headers[header] !== undefined && kind !== 'account' && request.headers[header] !== value) throw httpError(403, 'Conflicting deletion targets.');
    }
    const receiptProof = body && createHash('sha256').update(JSON.stringify([body.reviewToken, cookieDigest(request), selection])).digest('hex');
    const retained = body && registry.getDeletion(body.requestId);
    if (retained?.completedAt && retained.receiptProof && body.confirmed === true && (!retained.groups.length || body.finalGroupConfirmed === true)
      && timingSafeEqual(Buffer.from(retained.receiptProof, 'hex'), Buffer.from(receiptProof, 'hex'))) {
      // This proof permits only the already-committed receipt, including after
      // login/session removal and restart. It grants no gameplay or new action.
      await json(request, response, 200, { status: 'deleted', requestId: retained.id, kind: retained.kind,
        characters: retained.targets.map(t => t.characterId), groups: retained.groups, href: retained.kind === 'account' ? '/auth/signin' : '/characters', backups }); return;
    }
    const identity = legacy.authenticate(request, security);
    if (identity?.kind !== 'account') throw httpError(identity ? 403 : 401, 'Signed-in account access required.');
    if (request.method === 'GET') {
      const review = await service.review(identity.accountId, selection), token = generateToken();
      const checked = legacy.authenticate(request, security);
      if (checked?.accountId !== identity.accountId || checked.sessionId !== identity.sessionId) throw httpError(401, 'Sign in again before deleting.');
      confirmations.set(token, { accountId: identity.accountId, sessionId: identity.sessionId, cookie: cookieDigest(request), selection: JSON.stringify(selection), review, expiresAt: now() + lifetimeMs });
      while (confirmations.size > 1000) confirmations.delete(confirmations.keys().next().value);
      await json(request, response, 200, { ...review, reviewToken: token, backups }); return;
    }
    if (body.confirmed !== true || !confirmation || confirmation.accountId !== identity.accountId || confirmation.sessionId !== identity.sessionId
      || confirmation.selection !== JSON.stringify(selection) || confirmation.cookie !== cookieDigest(request)) throw httpError(409, 'Review and explicitly confirm the complete deletion target list again.');
    if (confirmation.review.groups.length && body.finalGroupConfirmed !== true) throw httpError(409, 'Explicitly confirm final group deletion.');
    if (confirmation.requestId && confirmation.requestId !== body.requestId) throw httpError(409, 'Retry the same deletion request.');
    confirmation.requestId = body.requestId;
    const recheck = () => {
      if (confirmation.expiresAt <= now() && !registry.getDeletion(body.requestId)) throw httpError(409, 'Deletion review expired. Review the complete target list again.');
      const checked = legacy.authenticate(request, security);
      if (checked?.accountId !== identity.accountId || checked.sessionId !== identity.sessionId) throw httpError(401, 'Sign in again before deleting.');
    };
    const result = await service.delete(identity.accountId, { ...selection, requestId: body.requestId, receiptProof }, confirmation.review, recheck);
    await json(request, response, 200, { ...result, backups });
  }
  return { handle, recover: () => service.recover(), drain: () => service.close() };
}
