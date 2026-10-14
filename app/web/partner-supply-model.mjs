import { createTaskFactsIndex } from '../core/progress-index.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';

// Personal rewards prove access, but do not establish a transferable supply.
const ordinary = source => source && source.processingMode !== 'multi' && source.kind !== 'reward';
const sourceIdentity = source => JSON.stringify([
  source.kind ?? null, source.source ?? null, source.name ?? null, source.category ?? null,
  source.taskId ?? null, source.task ?? null, source.location ?? null,
  [...(source.locations ?? [])].sort(),
]);
const validQuantity = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const defaultRegistry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };

/** Read-only projection of engine-admitted item needs. Availability is source
 * capability, never evidence of stock in a player's inventory or group bank. */
export function buildPartnerSupplyModel(state, results, registry = defaultRegistry) {
  const current = new Map(state.members.map(member => {
    const result = results instanceof Map ? results.get(member.id) : results?.find(value => value.memberId === member.id);
    return [member.id, result?.memberId === member.id && result.stateRevision === state.revision
      && Array.isArray(result.items) ? result : null];
  }));
  const ready = state.members.every(member => current.get(member.id));
  const catalogue = state.members.flatMap(member => current.get(member.id)?.tasks ?? []);
  return { revision: state.revision, members: state.members.map(owner => {
    const member = { id: owner.id, name: owner.name ?? owner.id, ready: !!ready, requests: [] };
    if (!ready) return member;
    const result = current.get(owner.id), saved = projectMemberTaskFacts(state, owner, catalogue);
    const presented = result.presentation ? new Set((result.presentation.tasks ?? [])
      .map(task => typeof task === 'string' ? task : task.id)) : null;
    const facts = createTaskFactsIndex(state, owner.id, registry, { tasks: catalogue,
      completionGroups: result.collectionPlanning?.completionGroups ?? {} });
    const requests = new Map();
    const eligibleItem = (task, name, quantity = null, admittedSources) => {
      if (!task.sources?.some(source => source.item === name && source.own === false && ordinary(source))) return null;
      const admitted = admittedSources === undefined ? null : new Set(admittedSources
        .filter(source => source.own === false && ordinary(source)).map(sourceIdentity));
      const sources = state.members.filter(giver => giver.id !== owner.id).flatMap(giver => {
        const item = current.get(giver.id).items?.find(value => value.name === name);
        return (item?.sources ?? []).filter(source => source.own === true && ordinary(source)
          && (!admitted || admitted.has(sourceIdentity(source))))
          .map(source => ({ ...source, memberId: giver.id, memberName: giver.name ?? giver.id }));
      });
      return sources.length ? { name, quantity: validQuantity(quantity), sources } : null;
    };
    const add = (task, candidates, choiceCount = null, label = '') => {
      const items = [...new Map(candidates.filter(Boolean).map(item => [item.name, item])).values()].sort((a, b) => a.name.localeCompare(b.name));
      if (!items.length || choiceCount !== null && items.length < choiceCount) return;
      const concrete = choiceCount === null || items.length === 1 && choiceCount === 1;
      const sourceKey = items.map(item => [item.name, [...new Set(item.sources
        .map(source => JSON.stringify([source.memberId, sourceIdentity(source)])))].sort()]);
      const key = concrete ? `item:${items[0].name}:${JSON.stringify(sourceKey)}`
        : `choice:${choiceCount}:${JSON.stringify(sourceKey)}`;
      let request = requests.get(key);
      if (!request) {
        request = { key, label: concrete ? items[0].name : label, items, choiceCount: concrete ? null : choiceCount, needs: [] };
        requests.set(key, request);
      }
      const taskId = resolveSavedTaskId(state.identityRegistry, task.id, task.category);
      const quantity = concrete ? items[0].quantity : null;
      if (!request.needs.some(need => need.taskId === taskId && need.quantity === quantity)) {
        request.needs.push({ taskId, label: task.label, category: task.category, status: task.status, quantity });
      }
      if (concrete) request.items[0].quantity = request.needs.every(need => need.quantity !== null && need.quantity === quantity) ? quantity : null;
    };
    const byId = new Map((result.tasks ?? []).map(task => [task.id, task]));
    const addGroups = (task, reason) => {
      for (const group of task.partnerItemNeeds ?? []) {
        if (!Number.isSafeInteger(group.count) || group.count < 1 || !Number.isSafeInteger(group.ownCount) || group.ownCount < 0) continue;
        const needed = group.count - group.ownCount;
        if (needed < 1) continue;
        add(reason, (group.items ?? []).map(name => typeof name === 'string'
          ? eligibleItem(task, name, null, group.sources?.[name] ?? []) : null), needed, group.requirement);
      }
    };
    // Only the engine's direct same-quest links authorize inheritance. Hidden
    // steps are prerequisites of the visible goal, rather than new obligations.
    // Alternative and external quest dependencies are deliberately excluded.
    const addQuestDependencies = root => {
      const visited = new Set([root.id]);
      const baseQuest = root.baseQuest ?? root.record?.BaseQuest;
      const visit = task => {
        for (const id of task.dependencyTaskIds ?? []) {
          if (visited.has(id)) continue;
          visited.add(id);
          const child = byId.get(id);
          if (!child || child.category !== 'Quest' || (child.baseQuest ?? child.record?.BaseQuest) !== baseQuest
            || child.record?.NeverShow || child.neverShow || !['available', 'blocked'].includes(child.status)
            || child.blockers?.some(blocker => blocker.kind === 'membership')
            || saved.taskStatus?.[resolveSavedTaskId(state.identityRegistry, child.id, child.category)]?.backlogged
            || child.personalCompleted || facts.get(child.id, child.completionIds).actual) continue;
          addGroups(child, root); visit(child);
        }
      };
      if (root.category === 'Quest' && baseQuest) visit(root);
    };
    for (const task of result.tasks ?? []) {
      const id = resolveSavedTaskId(state.identityRegistry, task.id, task.category);
      if (task.obligation !== true || task.hidden || task.record?.NeverShow || task.neverShow
        || !['available', 'blocked'].includes(task.status) || saved.taskStatus?.[id]?.backlogged
        || task.blockers?.some(blocker => blocker.kind === 'membership')
        || task.status === 'available' && presented && !presented.has(task.id)
        || task.kind === 'collection' || ['Every Drop', 'All Droptables', 'All Shops', 'Kill X'].includes(task.record?.Label)
        || facts.get(task.id, task.completionIds).group) continue;
      addGroups(task, task);
      addQuestDependencies(task);
      if (task.houseStorage) {
        const materials = task.houseStorage.materials ?? {};
        const names = [...new Set([...(task.houseStorage.parts ?? []), ...Object.keys(materials)])];
        for (const name of names) {
          if (result.ownItems?.includes(name) || task.sources?.some(source => source.item === name && source.own === true && ordinary(source))) continue;
          add(task, [eligibleItem(task, name, materials[name])]);
        }
      }
    }
    member.requests = [...requests.values()].sort((a, b) => a.label.localeCompare(b.label));
    return member;
  }) };
}

const discordText = value => String(value ?? '').replace(/@/g, '@\u200b').replace(/([\\`*_~|<>\[\]])/g, '\\$1').replace(/[\r\n]+/g, ' ');

export function formatPartnerSupplySummary(model) {
  const lines = [];
  for (const member of model.members) {
    if (!member.ready) continue;
    if (!member.requests.length) { lines.push(`${discordText(member.name)}: No partner supplies needed.`); continue; }
    lines.push(`${discordText(member.name)}:`);
    for (const request of member.requests) {
      const suppliers = [...new Set(request.items.flatMap(item => item.sources.map(source => source.memberName)))];
      const items = request.items.map(item => `${item.quantity === null ? '' : `${item.quantity} × `}${discordText(item.name)}`).join(' or ');
      const choice = request.choiceCount === null ? items : `${request.choiceCount} distinct choice${request.choiceCount === 1 ? '' : 's'} from ${items}`;
      const reasons = request.needs.map(need => `${discordText(need.label)}${need.quantity === null ? '' : ` (${need.quantity})`}`).join('; ');
      lines.push(`Ask ${suppliers.map(discordText).join(' / ')} for ${choice} — ${reasons}`);
    }
  }
  const text = lines.join('\n');
  if (text.length <= 1920) return text;
  const clipped = text.slice(0, 1880), newline = clipped.lastIndexOf('\n');
  return `${clipped.slice(0, newline > 0 ? newline : 1880)}\n… More requests in Ask your partner.`;
}
