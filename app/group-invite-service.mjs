import { MOVE_UNAVAILABLE } from './storage/group-invites.mjs';
import { builtInRules } from './core/rules.mjs';
import { taskRuleDefinitions } from './data/settings.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
export function createGroupInviteService({ registry, acquire, release, point = async () => {} }) {
  // One service operation at a time prevents cross-group lock-order cycles.
  let queue = Promise.resolve();
  const serialized = work => { const p = queue.then(work); queue = p.catch(() => {}); return p; };
  async function using(id, work) { const entry = await acquire(id); try { return await work(entry.context); } finally { release(entry); } }
  function template(pickerId) {
    const p = registry.getPicker(pickerId), c = registry.getCharacter(p?.ownerCharacterId);
    if (!c || p.lifecycle !== 'active') fail('The destination group is unavailable.');
    return c.placement.memberId;
  }
  async function cancelConflict(i, context) {
    // Older builds could admit another character into this source solo before
    // retiring it. The admission wins; the owner stays, with no implicit
    // handover. Remove only an unplaced destination projection, retaining its
    // preimage in the store's ordinary backup and a non-Undo roster boundary.
    if (context.store.getCalculationSnapshot().members.some(m => m.id === i.transaction.memberId)) {
      await context.store.departMember({ memberId: i.transaction.memberId, id: i.id, createdAt: i.terminalAt });
    }
    await point('invite-conflict-roster', i.pickerId);
    await context.revokeDepartedMember(i.transaction.memberId);
    await registry.cancelConflictingGroupJoin(i.id);
  }
  async function finish(i, context, source) {
    if (i.transaction) {
      if (registry.groupJoinConflict(i.id)) {
        await cancelConflict(i, context);
        fail('A prior admission won the source group. This outgoing invitation was revoked; review the current group before trying again.');
      }
      if (i.transaction.pastMapId) {
        const freeze = async source => {
          source.fenceRevokedSessions?.();
          if (!registry.listPastMaps(i.acceptingAccountId).some(m => m.id === i.id)) await registry.capturePastMap({ id: i.id, accountId: i.acceptingAccountId,
            characterId: i.acceptingCharacterId, pickerId: i.transaction.source.pickerId, memberId: i.transaction.source.memberId, reason: 'rejoined', createdAt: i.terminalAt }, await source.store.backup());
          await source.revokeDepartedMember(i.transaction.source.memberId);
          await point('rejoin-credentials', i.pickerId);
        };
        if (source) await freeze(source);
        else await using(i.transaction.source.pickerId, c => c.withGroupAdmission(() => freeze(c)));
      }
      await context.store.installInvitedMember({ ...i.transaction, templateMemberId: template(i.pickerId) });
      await point('invite-roster', i.pickerId);
      i = await registry.finishGroupJoin(i.id);
    }
    return { message: 'Already joined', character: { id: i.acceptingCharacterId, href: `/characters/${i.acceptingCharacterId}` } };
  }
  return {
    async review(secret, accountId) {
      const invite = registry.previewGroupInvite(secret);
      if (invite.status !== 'pending') return { invite, characters: [], review: null };
      return using(invite.pickerId, async destination => {
        const state = destination.store.getCalculationSnapshot().readState;
        const m = state.members.find(m => m.id === template(invite.pickerId));
        const characters = [];
        for (const c of registry.listCharacters(accountId)) {
          const rejoining = registry.rejoinEligible(accountId, c.id);
          const eligible = registry.groupJoinEligible(accountId, c.id) && c.placement.pickerId !== invite.pickerId
            && (rejoining || await using(c.placement.pickerId, source => source.untouchedOnboarding()));
          characters.push({ id: c.id, runescapeName: c.runescapeName, eligible, rejoining, reason: eligible ? null : MOVE_UNAVAILABLE });
        }
        return { invite, characters, review: { revision: state.revision, unlocked: [...m.unlocked], blacklisted: [...m.blacklisted], rules: state.rules,
          taskRules: m.taskRules ?? {}, startingChunk: m.preferences?.startingChunk ?? null,
          sectionOverrides: m.sectionOverrides ?? {}, areaOverrides: m.areaOverrides ?? {},
          ruleRows: (destination.groupRuleDefinitions?.() ?? builtInRules).map(d => ({ label: d.label ?? d.id, value: state.rules[d.id] ?? d.default })),
          taskRuleRows: Object.entries(m.taskRules ?? {}).map(([id, value]) => ({ label: taskRuleDefinitions.find(d => d.id === id)?.label ?? id, value })) } };
      });
    },
    accept(secret, accountId, input, revision) { return serialized(async () => {
      const preview = registry.previewGroupInvite(secret);
      const replay = preview.status === 'accepted';
      if (replay && !preview.joining && registry.getCharacter(preview.acceptingCharacterId)?.placement?.pickerId !== preview.pickerId) fail('This invitation was previously accepted. Rejoining requires a fresh owner invitation.');
      if (!replay && preview.status !== 'pending') await registry.beginGroupJoin(secret, accountId, input); // release expired/revoked reservation even on a stale review
      return using(preview.pickerId, destination => destination.withGroupAdmission(async store => {
        if (!replay && store.getInfo().revision !== revision) fail('The destination map changed. Review it again before joining.');
        const commit = async source => {
          const i = await registry.beginGroupJoin(secret, accountId, input);
          const result = await finish(i, destination, source);
          return { ...result, message: replay ? 'Already joined' : 'Joined group' };
        };
        if (input.characterId && !replay) {
          if (!registry.groupJoinEligible(accountId, input.characterId)) fail(MOVE_UNAVAILABLE);
          const c = registry.getCharacter(input.characterId);
          if (c.placement.pickerId === preview.pickerId) fail('Choose a character outside this group.');
          return using(c.placement.pickerId, source => source.withGroupAdmission(() => {
            if (!registry.rejoinEligible(accountId, input.characterId) && !source.untouchedOnboarding()) fail(MOVE_UNAVAILABLE);
            return commit(source);
          }));
        }
        return commit();
      }));
    }); },
    recover() { return serialized(async () => {
      // Reconcile conflicts before completing either transaction. Completing
      // the incoming one first changes its source solo's roster, so the same
      // conflict predicate also recognizes that older partial publication.
      for (const i of registry.groupJoinTransactions()) if (registry.groupJoinConflict(i.id)) {
        await using(i.pickerId, c => c.withGroupAdmission(() => cancelConflict(i, c)));
      }
      for (const i of registry.groupJoinTransactions()) await using(i.pickerId, c => c.withGroupAdmission(() => finish(i, c)));
      await registry.cleanGroupInvites();
    }); },
    close: () => queue,
  };
}
