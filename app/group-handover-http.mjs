import { bodyJSON, httpError, json } from './picker-context-http.mjs';
import { checkRequestOrigin } from './security/request.mjs';

export function createGroupHandoverHandler({ registry, authenticate, using, limits }) {
  return async (request, response, security, bindBody) => {
    const identity = authenticate(request, security);
    if (identity?.kind !== 'account' || !identity.characterId || !identity.pickerId) throw httpError(403, 'Select a group character to manage ownership.');
    bindBody?.({ accountId: identity.accountId, pickerId: identity.pickerId });
    const args = [identity.accountId, identity.characterId, identity.pickerId];
    if (request.method === 'GET') { await json(request, response, 200, registry.listGroupHandovers(...args)); return; }
    if (request.method !== 'POST') throw httpError(405, 'Use GET or POST.');
    checkRequestOrigin(request, security);
    const body = await bodyJSON(request, 4096);
    if (!['propose', 'accept', 'decline', 'cancel'].includes(body.action) || body.confirmed !== true
      || Object.keys(body).some(k => !(body.action === 'propose' ? ['action', 'confirmed', 'requestId', 'targetCharacterId'] : ['action', 'confirmed', 'id']).includes(k))) throw httpError(400, 'Review and confirm the handover request.');
    limits?.invitation(identity, identity.pickerId);
    // Order owner changes with durable restores and accepted gameplay writes.
    // Reauthenticate inside the same picker queue after slow request bodies.
    const result = await using(identity.pickerId, context => context.withGroupAdmission(async () => {
      const active = authenticate(request, security);
      if (!active || active.accountId !== identity.accountId || active.characterId !== identity.characterId || active.pickerId !== identity.pickerId) throw httpError(403, 'Character access changed. Reopen your account menu.');
      return body.action === 'propose' ? registry.proposeGroupHandover(...args, body)
        : registry.resolveGroupHandover(...args, body.id, body.action);
    }));
    await json(request, response, 200, result);
  };
}
