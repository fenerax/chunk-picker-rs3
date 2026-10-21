const active = event => event.type !== 'undo' && event.undoneRevision === undefined;
const fields = ['challengeCompleted', 'backlogged'];

/** Find local decisions after the last original-sync change to each value.
 * A sync that leaves a value alone must not consume its local protection.
 * Reverse the active undo chain to also support older whole-member snapshots.
 * The server supplies complete (including archived) History. */
export function originalLocalChanges(state, owner, resolveTaskId = id => id, facts = owner) {
  const chunks = new Set(), tasks = new Map(), seenChunks = new Set(), seenTasks = new Set();
  const current = { unlocked: owner.unlocked, completedTasks: facts.completedTasks.map(resolveTaskId), taskStatus: facts.taskStatus ?? {} };
  let cursor = { unlocked: owner.unlocked, completedTasks: owner.completedTasks, taskStatus: { ...(owner.taskStatus ?? {}) } };
  const rememberChunk = (id, unlocked, event) => {
    if (seenChunks.has(id)) return;
    seenChunks.add(id);
    if (event.type !== 'sync-original' && unlocked && current.unlocked.includes(id)) chunks.add(id);
  };
  const rememberTask = (id, field, value, event) => {
    id = resolveTaskId(id);
    const key = `${id}\u0000${field}`;
    if (seenTasks.has(key)) return;
    seenTasks.add(key);
    if (event.type === 'sync-original') return;
    const kept = field === 'backlogged' ? value === true && current.taskStatus[id]?.backlogged === true
      : value !== true && (field === 'completedTasks' ? !current.completedTasks.includes(id) : current.taskStatus[id]?.challengeCompleted !== true);
    if (kept) {
      const reasons = tasks.get(id) ?? new Set();
      reasons.add(field === 'backlogged' ? 'Backlogged here' : 'Unticked here');
      tasks.set(id, reasons);
    }
  };
  const arrayChanges = (field, before = [], after = [], event) => {
    const old = new Set(before), next = new Set(after);
    for (const id of new Set([...old, ...next])) if (old.has(id) !== next.has(id)) {
      if (field === 'unlocked') rememberChunk(id, next.has(id), event);
      else rememberTask(id, field, next.has(id), event);
    }
  };
  const statusChanges = (id, before = {}, after = {}, event) => {
    for (const field of fields) if (before[field] !== after[field]) rememberTask(id, field, after[field], event);
  };

  for (const event of [...(state.history ?? [])].sort((a, b) => b.revision - a.revision)) {
    if (!active(event)) continue;
    const command = event.command ?? {};
    // Explicit choices also count when the command was a deliberate no-op.
    if (command.memberId === owner.id) {
      if (event.type === 'set-chunk') rememberChunk(command.chunkId, command.status === 'unlocked', event);
      if (event.type === 'set-task-status') for (const field of fields) {
        if (Object.hasOwn(command, field)) rememberTask(command.taskId, field, command[field], event);
      }
      if (event.type === 'clear-challenge-ticks') for (const id of command.taskIds ?? []) rememberTask(id, 'challengeCompleted', false, event);
      if (event.type === 'complete-task') rememberTask(command.taskId, 'completedTasks', command.completed, event);
    }
    const snapshot = event.undo?.members?.find(member => member.id === owner.id);
    if (snapshot) {
      arrayChanges('unlocked', snapshot.unlocked, cursor.unlocked, event);
      arrayChanges('completedTasks', snapshot.completedTasks, cursor.completedTasks, event);
      for (const id of new Set([...Object.keys(snapshot.taskStatus ?? {}), ...Object.keys(cursor.taskStatus)])) {
        statusChanges(id, snapshot.taskStatus?.[id], cursor.taskStatus[id], event);
      }
      cursor = { unlocked: snapshot.unlocked, completedTasks: snapshot.completedTasks, taskStatus: { ...(snapshot.taskStatus ?? {}) } };
    }
    for (const patch of event.undo?.memberChanges?.find(member => member.id === owner.id)?.changes ?? []) {
      const [field, id] = patch.path;
      if (patch.kind !== 'value') continue;
      const before = patch.before.exists ? patch.before.value : undefined;
      const after = patch.after.exists ? patch.after.value : undefined;
      if (field === 'unlocked' || field === 'completedTasks') {
        arrayChanges(field, before, after, event);
        cursor[field] = before ?? [];
      } else if (field === 'taskStatus') {
        statusChanges(id, before, after, event);
        if (before === undefined) delete cursor.taskStatus[id];
        else cursor.taskStatus[id] = before;
      }
    }
  }
  return { chunks, tasks };
}
