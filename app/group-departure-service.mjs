import { withLoginStorageRelief } from './storage/login-storage-budget.mjs';
import { storageBudget } from './storage/storage-budget.mjs';
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
export function createGroupDepartureService({ registry, using, point = async () => {} }) {
  let queue = Promise.resolve();
  const serialized = work => { const p = queue.then(work); queue = p.catch(() => {}); return p; };
  const receipt = d => ({ message: d.reason === 'removed' ? 'Member removed. Their character now has an empty solo and a Past maps receipt.' : 'Left group. Your previous map is in Past maps.',
    ...(d.actorAccountId === d.accountId ? { character: { id: d.characterId, href: `/characters/${d.characterId}` }, pastMap: { href: `/past-maps/${d.id}` } } : {}) });
  const finish = (d, source) => withLoginStorageRelief(() => complete(d, source));
  async function complete(d, source) {
    if (d.completedAt) return receipt(d);
    source.fenceRevokedSessions?.();
    await registry.prepareDeparture(d.id);
    await using(d.destination.pickerId, async destination => {
      // Opening installs an empty schema-1 solo, never a source-map import.
      if (destination.store.getInfo().revision !== 0) fail('The reserved solo changed. Recovery needs review.');
      await point('departure-destination', d.source.pickerId);
    });
    if (!registry.listPastMaps(d.accountId).some(m => m.id === d.id)) await registry.capturePastMap({ id: d.id, accountId: d.accountId, characterId: d.characterId,
      pickerId: d.source.pickerId, memberId: d.source.memberId, reason: d.reason, createdAt: d.createdAt }, await source.store.backup());
    await source.store.departMember({ ...d, memberId: d.source.memberId });
    await point('departure-roster', d.source.pickerId);
    await source.revokeDepartedMember(d.source.memberId);
    await point('departure-credentials', d.source.pickerId);
    return receipt(await registry.finishDeparture(d.id));
  }
  return {
    async review(accountId, characterId, pickerId) {
      const c = registry.selectCharacter(accountId, characterId, pickerId), p = registry.getPicker(pickerId);
      if (p.kind !== 'default') fail('The legacy shared picker needs a reviewed migration before departure.');
      return using(pickerId, async context => ({ characterId: c.id, ownerCharacterId: p.ownerCharacterId, solo: p.seats.length === 1,
        revision: context.store.getInfo().revision, roster: p.seats.map(s => { const c = registry.getCharacter(s.characterId); return { id: c.id, runescapeName: c.runescapeName, owner: c.id === p.ownerCharacterId }; }) }));
    },
    depart(accountId, characterId, pickerId, input) { return serialized(async () => {
      const old = registry.getDeparture(input.requestId);
      if (old?.completedAt) {
        // The old document is no longer authorized for gameplay, but its exact
        // account/request receipt remains available through the account API.
        const d = await registry.beginDeparture(accountId, characterId, pickerId, input); return receipt(d);
      }
      return using(pickerId, source => source.withGroupAdmission(async () => {
        if (!old && source.store.getInfo().revision !== input.revision) fail('The group changed. Review departure again before confirming.');
        if (!old && Buffer.byteLength(JSON.stringify(await source.store.backup())) + 1 > storageBudget().maxBytes) fail('This Past map would exceed the retained save storage limit. Contact the server operator. Existing maps are unchanged.');
        const d = await registry.beginDeparture(accountId, characterId, pickerId, input);
        return finish(d, source);
      }));
    }); },
    recover() { return serialized(async () => { for (const d of registry.departureTransactions()) await using(d.source.pickerId, source => source.withGroupAdmission(() => finish(d, source))); }); },
    close: () => queue,
  };
}
