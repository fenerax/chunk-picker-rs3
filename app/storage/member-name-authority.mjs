import { sameRuneScapeName } from '../core/game-progress.mjs';

export function memberNameChanges(before, after) {
  const previous = new Map(before.members.map(member => [member.id, member]));
  return after.members.flatMap(member => {
    const old = previous.get(member.id);
    if (!old || (old.runescapeName ?? '') === (member.runescapeName ?? '')) return [];
    return [{ memberId: member.id, normalized: !sameRuneScapeName(old.runescapeName, member.runescapeName) }];
  });
}

// An absent actor is an internal/offline writer. Authenticated HTTP callers
// always supply their actor, including unbound administrators and viewers.
export function authorizeMemberNames(changes, actor) {
  if (actor !== undefined && changes.some(change => change.memberId !== actor.memberId)) {
    throw Object.assign(new Error('Only the login controlling this character can change its RuneScape name. Open your own character to rename it.'), { status: 403 });
  }
}
