import { buildChunkPlanningIndex } from '../tasks/chunk-planning-index.mjs';

// Navigation over the current calculation. Known methods and locations are
// evidence to inspect, never a predicted next chunk or a training recommendation.
export function taskBlockerGuidance(task, result = {}) {
  const blockers = task.blockers ?? [], rows = result.tasks ?? [];
  const rules = [...new Set(blockers.filter(row => row.kind === 'rule').map(row => row.ruleId
    ?? /^Turned off in Rules: (.+)\.$/.exec(row.detail)?.[1]
    ?? (/skiller rule/.test(row.detail) ? 'Skiller' : /^InsidePOH is disabled/.test(row.detail) ? 'InsidePOH' : null)).filter(Boolean))];
  const training = Object.entries(result.training ?? {}).filter(([skill]) => blockers.some(row => row.kind === 'training' && row.detail?.startsWith(`${skill} `))).map(([skill, value]) => ({
    skill, level: value.level,
    methods: rows.filter(row => row.id !== task.id && row.category === skill && row.primaryMethod === true)
      .sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available') || a.level - b.level || a.label.localeCompare(b.label)),
  }));
  const connectionBlockers = blockers.filter(row => row.kind === 'training' && row.detail?.includes('chunks are not connected'));
  const connections = (result.partnerConnections?.regions ?? []).filter(region => !region.connected && connectionBlockers.some(row => row.detail.includes(`${region.ownerName}'s chunks`)));
  const dependencies = new Set(task.dependencyTaskIds ?? []);
  if (blockers.some(row => ['tasks', 'personal-completion'].includes(row.kind))) {
    for (const [name, category] of Object.entries(task.record?.Tasks ?? {})) {
      for (const row of rows) if (row.category === category && row.rawLabel === name) dependencies.add(row.id);
    }
    for (const id of Array.isArray(task.record?.CompletedTasks) ? task.record.CompletedTasks : []) dependencies.add(id);
  }
  return { rules, training, connections, prerequisites: rows.filter(row => row.id !== task.id && dependencies.has(row.id)),
    unknownUnlock: blockers.some(row => !['rule', 'backlog', 'outclassed'].includes(row.kind)) };
}

export function renderTaskBlockerGuidance(c, task, result, { memberId, openTask }) {
  if (!task.blockers?.length) return null;
  const guidance = taskBlockerGuidance(task, result), host = c.el('div', undefined, 'form-stack task-blocker-guidance');
  for (const ruleId of guidance.rules) host.append(c.button(`View blocking rule: ${c.plain(ruleId)}`, () => c.rulesDialog({ ruleId, memberId })));
  if (guidance.unknownUnlock) host.append(c.el('p', 'No specific unlock recommendation is known. Review the recorded requirements, training methods and locations before choosing a chunk.', 'field-help'));
  for (const training of guidance.training) {
    const body = c.el('div', undefined, 'form-stack');
    body.append(c.el('p', `${training.skill}: your chunks currently support level ${training.level}. This is a reachable training limit, not your account level.`, 'field-help'));
    const locationIndex = buildChunkPlanningIndex(c.definitions ?? {}, { tasks: training.methods }, c.world), locationsByMethod = new Map();
    for (const rows of locationIndex.byLocation.values()) for (const [id, row] of rows) {
      const locations = locationsByMethod.get(id) ?? new Map();
      for (const evidence of row.evidence) locations.set(`${evidence.location}:${evidence.reason}`, { kind: 'chunks', name: evidence.reason, locations: [evidence.location] });
      locationsByMethod.set(id, locations);
    }
    if (!training.methods.length) body.append(c.el('p', `No primary ${training.skill} training method is identified in this calculation.`, 'status-detail'));
    let shown = 0;
    const methods = c.el('div', undefined, 'form-stack'), more = c.button('Show more training methods', () => appendMethods());
    function appendMethods() {
      for (const method of training.methods.slice(shown, shown + 6)) {
        const row = c.el('div', undefined, 'form-stack');
        row.append(c.button(`View ${training.skill} training: ${c.plain(method.label)}`, () => openTask(method)), c.el('p', `Level ${method.level} · ${method.status === 'available' ? 'Reachable method' : method.blockers?.[0]?.detail || 'Not reachable yet'}`, 'status-detail'));
        if (method.sources?.length) row.append(c.details('Training sources and locations', c.sourceView(method.sources, result, openTask)));
        const recorded = [...(locationsByMethod.get(method.id)?.values() ?? [])].filter(source => !method.sources?.some(current => [current.location, ...(current.locations ?? [])].includes(source.locations[0])));
        if (recorded.length) {
          const evidence = c.el('div', undefined, 'form-stack');
          evidence.append(c.el('p', 'These are recorded requirement locations. They may still be locked or need other requirements; reaching one does not prove this method is available.', 'field-help'), c.sourceView(recorded, result, openTask));
          row.append(c.details('Recorded training locations', evidence));
        }
        methods.append(row);
      }
      shown += 6; more.hidden = shown >= training.methods.length;
    }
    appendMethods(); body.append(methods, more);
    host.append(c.details(`Review ${training.skill} training methods (${training.methods.length})`, body));
  }
  for (const prerequisite of guidance.prerequisites) host.append(c.button(`View prerequisite: ${c.plain(prerequisite.label)}`, () => openTask(prerequisite)));
  if (guidance.connections.length) {
    const body = c.el('div', undefined, 'form-stack');
    body.append(c.el('p', 'Disconnected partner chunks may provide more training or supplies once connected. The calculation does not identify which connection would meet this task’s requirement.', 'field-help'));
    for (const region of guidance.connections) {
      const id = region.bases?.[0];
      body.append(c.el('p', `${region.ownerName}: ${region.reason}`, 'status-detail'));
      if (id) body.append(c.button(`View disconnected chunk: ${c.plain(c.world.chunks.get(id)?.name ?? id)}`, () => {
        // Connection facts belong to the task owner, including in Group view.
        if (c.state && !c.state.members.some(owner => owner.id === memberId)) throw new Error('This player is no longer in the group. Refresh Tasks.');
        if (c.memberId !== memberId) {
          const picker = c.$('member'); picker.value = memberId; picker.dispatchEvent(new Event('change'));
        }
        c.closeDialog(); c.map.centerOnChunk(id); c.showChunk(id);
      }));
    }
    host.append(c.details('Review partner connections', body));
  }
  return host.childElementCount || host.children?.length ? host : null;
}
