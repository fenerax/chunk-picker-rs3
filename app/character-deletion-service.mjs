const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
export function createCharacterDeletionService({ registry, using, purge, fenceSessions, point = async () => {} }) {
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const receipt = d => ({ status: 'deleted', requestId: d.id, kind: d.kind, characters: d.targets.map(t => t.characterId), groups: d.groups,
    href: d.kind === 'account' ? '/auth/signin' : '/characters' });
  async function finish(d) {
    const ids = [...new Set(d.targets.map(t => t.pickerId))].filter(id => registry.getPicker(id)?.lifecycle === 'active').sort();
    for (const id of ids) await using(id, c => c.withGroupAdmission(async () => {
      for (const t of d.targets.filter(t => t.pickerId === id)) {
        c.fenceRevokedSessions?.();
        if (!d.groups.includes(t.pickerId) && c.store.getReadState().members.some(m => m.id === t.memberId)) {
          await c.store.departMember({ memberId: t.memberId, id: d.id + '-' + t.characterId, createdAt: d.createdAt });
        }
        await point('deletion-roster', t.pickerId);
        await c.revokeDepartedMember(t.memberId);
        await point('deletion-credentials', t.pickerId);
      }
    }));
    const done = await registry.finishCharacterDeletion(d.id);
    fenceSessions?.();
    return receipt(done);
  }
  return {
    async review(accountId, selection) {
      const plan = registry.deletionPlan(accountId, selection), revisions = {};
      for (const id of [...new Set(plan.targets.map(t => t.pickerId))].sort()) await using(id, c => { revisions[id] = c.store.getInfo().revision; });
      return { ...plan, revisions };
    },
    delete(accountId, input, review, recheck = () => {}) { return serialized(async () => {
      const old = registry.getDeletion(input.requestId);
      if (!old) for (const id of [...new Set(review.targets.map(t => t.pickerId))].sort()) await using(id, c => c.withGroupAdmission(() => {
        if (review.revisions[id] !== c.store.getInfo().revision) fail('A map changed. Review the complete deletion list again.');
      }));
      // One context at a time keeps ten-character logins deletable within the
      // residency cap. The registry intent fences every target before the
      // final per-group drain; accepted writes remain accounted for.
      const d = await registry.beginCharacterDeletion(accountId, { ...input, revision: review.revision }, recheck);
      const result = await finish(d);
      await purge(); return result;
    }); },
    recover() { return serialized(async () => {
      // Reapply completed receipts too: restored gameplay/sidecars can be older
      // than the live ledger. The retained History boundary makes this inert
      // on an ordinary restart and preserves all surviving maps.
      for (const d of registry.deletionTransactions()) {
        await finish(d);
      }
      await purge();
    }); },
    close: () => queue,
  };
}
