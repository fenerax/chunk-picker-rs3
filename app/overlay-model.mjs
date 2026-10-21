import { createTaskPinChecker } from './web/task-filters-model.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from './tasks/fact-projection.mjs';

/** The overlay boundary selects display fields before any response is serialized. */
export function overlayText(value, limit = 240) {
  return String(value ?? '').replace(/<[^>]*>/g, '')
    .replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]')
    .replace(/(?:#|%23)key(?:=|%3d)[^\s"'<>]*/gi, '#key=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{43,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function goalsFor(state, member) {
  const pinned = createTaskPinChecker({ state, memberId: member.id, ownerFilter: member.id });
  const projected = state.members.map(owner => projectMemberTaskFacts(state, owner, state.tasks ?? []));
  const own = projected.find(owner => owner.id === member.id);
  const complete = (owner, ids) => ids.some(id => owner.completedTasks?.includes(id) || owner.taskStatus?.[id]?.challengeCompleted === true);
  return (state.tasks ?? []).filter(task => {
    const id = resolveSavedTaskId(state.identityRegistry, task.id, task.category), status = own.taskStatus?.[id];
    const family = [id, ...(task.completionIds ?? []).map(alias => resolveSavedTaskId(state.identityRegistry, alias))];
    const owners = projected.filter(owner => !task.memberIds || task.memberIds.includes(owner.id));
    const mode = state.rules?.['tasks.completion'] ?? 'any';
    const done = mode === 'personal' ? complete(own, family) : mode === 'all' ? owners.length > 0 && owners.every(owner => complete(owner, family)) : owners.some(owner => complete(owner, family));
    return pinned(task) && !status?.backlogged && !done
      && task.obligation !== false && !task.hidden && (!task.memberIds || task.memberIds.includes(member.id));
  }).map(task => ({ label: overlayText(task.label ?? task.name ?? task.id) })).filter(goal => goal.label);
}

function groupGoalsFor(state) {
  return (state.groupGoals ?? []).filter(goal => !goal.done).map(goal => ({
    label: overlayText(goal.text, 200),
    ...(goal.completion === 'players' ? { players: state.members.map(member => ({
      name: overlayText(member.name ?? member.id, 80), done: goal.completedBy.includes(member.id),
    })) } : {}),
  })).filter(goal => goal.label);
}

export function overlayRollCandidate({ state, world, player }) {
  const members = player === 'duo' ? state.members : state.members.filter(member => member.id === player);
  const candidates = [];
  for (const member of members) {
    const rolls = [];
    for (const event of state.history ?? []) {
      if (event.undoneRevision !== undefined || event.command?.memberId !== member.id) continue;
      const command = event.command;
      if (['roll', 'random-start'].includes(event.type) && command.rolled?.length) {
        rolls.push({ revision: event.revision, member, phase: command.rolled.length > 1 ? 'offered' : 'unlocked', ids: command.rolled });
      } else if (event.type === 'cancel-roll') {
        const offered = rolls.findLast(roll => roll.phase === 'offered');
        if (offered) rolls.splice(rolls.indexOf(offered), 1);
      } else if (['unlock-selection', 'pick-for-me', 'unlock-both'].includes(event.type)) {
        const offered = rolls.findLast(roll => roll.phase === 'offered');
        if (offered) { offered.phase = 'unlocked'; if (command.chunkId) offered.ids = [command.chunkId]; }
      }
    }
    const pending = member.pendingRoll ?? [];
    const latest = rolls.at(-1);
    // Imported pending choices remain meaningful even without an owned roll event.
    if (pending.length) candidates.push({ revision: latest?.phase === 'offered' ? latest.revision : -1, member, phase: 'offered', ids: pending });
    else if (latest?.phase === 'unlocked') candidates.push(latest);
  }
  const roll = candidates.sort((a, b) => b.revision - a.revision)[0];
  if (!roll) return null;
  return { revision: roll.revision, roll: { player: overlayText(roll.member.name ?? roll.member.id, 80), phase: roll.phase,
    chunks: roll.ids.map(id => ({ id, name: overlayText(world.chunks.get(id)?.name ?? world.chunks.get(id.split('-')[0])?.name ?? `Chunk ${id}`) })) } };
}

export function overlayPayload({ state, world, widget, player, goals = 'personal' }) {
  const members = player === 'duo' ? state.members : state.members.filter(member => member.id === player);
  const base = { revision: state.revision, widget };
  if (widget === 'goals') return { ...base, heading: 'Current goals',
    ...(goals !== 'group' ? { players: members.map(member => ({ name: overlayText(member.name ?? member.id, 80), goals: goalsFor(state, member) })) } : {}),
    ...(goals !== 'personal' ? { groupGoals: groupGoalsFor(state) } : {}),
  };
  if (widget === 'roll') return { ...base, heading: 'Last roll', roll: overlayRollCandidate({ state, world, player })?.roll ?? null };
  if (widget === 'count') {
    const surface = new Set([...(world.surface ?? world.chunks.keys())].map(id => String(id).split('-')[0]));
    const unlocked = new Set(members.flatMap(member => member.unlocked ?? []).map(id => id.split('-')[0]).filter(id => surface.has(id)));
    const name = player === 'duo' ? 'Duo' : overlayText(members[0]?.name ?? player, 80);
    return { ...base, heading: `${name} · Unlocked chunks`, unlocked: unlocked.size, total: surface.size };
  }
  throw new TypeError('Unknown overlay widget.');
}
