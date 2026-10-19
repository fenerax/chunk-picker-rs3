import { duoCommandTarget } from './duo-tasks.mjs';

/** Splits the rows shown in Active Tasks into what one bulk tick would change.
 * Only rows the acting player could tick alone are included. Duo rows that ask
 * "for whom?" are left and counted; blocked rows shown for inspection are too. */
export function tickActiveTaskPlan({ rows = [], ownerId, duo = false, personalFacts = () => ({}) }) {
  const taskIds = [], seen = new Set();
  let needChoice = 0, blocked = 0;
  for (const row of rows) {
    if (duo) {
      const entry = row.personalCompletion ? { ...row, memberIds: row.filterMemberIds } : row;
      let target;
      try { target = duoCommandTarget(entry, ownerId); } catch { continue; }
      if (!target.memberIds.includes(ownerId)) continue;
      const done = row.personalCompletion ? row.facts?.personal : row.facts?.group;
      if (done) continue;
      if ((row.tasksByMember?.[ownerId] ?? row.task)?.status !== 'available') { blocked++; continue; }
      if (target.requiresChoice) { needChoice++; continue; }
      const id = row.id ?? row.task.id;
      if (!seen.has(id)) { seen.add(id); taskIds.push(id); }
    } else {
      if (personalFacts(row).personal) continue;
      if (row.status !== 'available') { blocked++; continue; }
      if (!seen.has(row.id)) { seen.add(row.id); taskIds.push(row.id); }
    }
  }
  return { taskIds, needChoice, blocked };
}

const tasks = count => `${count.toLocaleString()} ${count === 1 ? 'task' : 'tasks'}`;

/** Plain confirmation wording, e.g. "Tick 14 active tasks? 2 need a choice and will be left." */
export function tickActiveTaskQuestion({ taskIds, needChoice, blocked }, name) {
  const count = taskIds.length;
  const lines = [`Tick ${count.toLocaleString()} active ${count === 1 ? 'task' : 'tasks'}${name ? ` for ${name}` : ''}?`];
  if (needChoice) lines.push(`${needChoice.toLocaleString()} ${needChoice === 1 ? 'needs' : 'need'} a choice and will be left.`);
  if (blocked) lines.push(`${tasks(blocked)} shown as blocked will be left.`);
  return lines.join(' ');
}
