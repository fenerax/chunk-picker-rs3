import { createNoteEditor } from './info-panels.mjs';
import { renderTaskEquipment } from './task-equipment.mjs';
import { itemIcon } from './icons.mjs';
import { createTaskMethods } from './task-methods.mjs';
import { resolveTaskAlternatives } from './core/task-alternatives.mjs';
import { createQuestMap } from './quest-map.mjs';
import { renderTaskBlockerGuidance } from './screen-task-guidance.mjs';

// Main-screen taskDialogs; shared values and callbacks live in the explicit screen context.
export function createScreenTaskDialogs(c) {
  c.questMap = createQuestMap(c);
  function showTask(task, detailed = false, review = {}) {
    const ownerId = review.memberId ?? c.memberId;
    let duoEntry = review.duoEntry;
    if (duoEntry && duoEntry.tasksByMember?.[ownerId]?.id !== task.id) duoEntry = undefined;
    review = { ...review, memberId: ownerId, duoEntry };
    const owner = c.state.members.find(value => value.id === ownerId);
    if (!owner) throw new Error('This player is no longer in the group. Refresh Tasks.');
    const cachedFull = ownerId === c.memberId ? c.fullResult : c.duoDetails.get(`${c.state.revision}:${ownerId}`);
    const loadedFull = cachedFull?.stateRevision === c.state.revision && cachedFull.memberId === ownerId ? cachedFull : undefined;
    const ownerResult = review.result ?? (ownerId === c.memberId ? c.result ?? (c.duoEnabled() ? c.duoResults().results().get(ownerId) : undefined) : c.duoResults().results().get(ownerId));
    const progressive = !c.sandbox.active && !detailed && ownerResult?.format === 'play-v1' && !task.id.startsWith('custom:') && ownerResult.tasks.some(row => row.id === task.id) && !loadedFull;
    if (!detailed && !progressive && loadedFull) task = loadedFull.tasks.find(row => row.id === task.id) ?? task;
    const detailResult = loadedFull ?? ownerResult;
    const commandTaskId = duoEntry?.id ?? task.id;
    const dialogMemberId = ownerId, dialogRevision = c.state.revision, status = owner.taskStatus?.[commandTaskId] ?? owner.taskStatus?.[task.id] ?? {}, name = owner.name;
    let generation;
    const stack = c.el('div', undefined, 'form-stack');
    stack.dataset.usage = 'tasks:detail';
    if (review.onReturn) stack.append(c.button('Back to Completed Tasks', review.onReturn, 'completed-return'));
    if (duoEntry) {
      const names = duoEntry.memberIds.map(id => c.state.members.find(value => value.id === id)?.name ?? id).join(' and ');
      const owners = c.el('div', undefined, 'duo-task-dialog-owners'); owners.append(c.el('span', `For ${names} · showing ${name}'s details`, 'task-meta'));
      for (const id of duoEntry.memberIds.filter(id => id !== ownerId)) owners.append(c.button(`View for ${c.state.members.find(value => value.id === id)?.name ?? id}`, () => c.showTask(duoEntry.tasksByMember[id], false, {
        ...review, memberId: id, result: c.duoResults().results().get(id), loadResult: () => c.ensureDuoDetails(id),
      })));
      stack.append(owners);
    }
    // What the task actually asks for, before any status detail.
    const asks = task.record?.Description ?? task.description;
    if (asks) stack.append(c.el('p', c.plain(asks), 'task-asks'));
    const topSlot = c.el('div', undefined, 'task-detail-slot'), bottomSlot = c.el('div', undefined, 'task-detail-slot');
    const mapSlot = c.el('div');
    if (task.category === 'Quest') stack.append(mapSlot);
    stack.append(topSlot);
    const displayLevel = task.record?.RequirementAlternatives && task.level === 1 ? undefined : task.level;
    const explanation = c.el('p', task.explanation || (progressive ? task.blockers?.[0]?.detail ?? '' : 'Custom task.'));
    const guidanceSlot = c.el('div', undefined, 'task-blocker-actions');
    const showGuidance = (full, result) => {
      const guidance = renderTaskBlockerGuidance(c, full, result ?? {}, { memberId: dialogMemberId, openTask: row => c.showTask(row, true, { ...review, memberId: dialogMemberId, result }) });
      guidanceSlot.replaceChildren(...(guidance ? [guidance] : []));
    };
    stack.append(c.el('p', `${task.category}${displayLevel && !(task.generated && task.category === 'BiS') ? ` · Level ${displayLevel}` : ''} · ${task.status}`, 'status-detail'), explanation, guidanceSlot);
    if (progressive) showGuidance(task, detailResult);
    const backlogBox = c.el('div', undefined, 'task-backlog-box');
    if (status.backlogged) backlogBox.append(c.el('p', status.backlogReason ? `Backlogged: ${status.backlogReason}` : 'Backlogged.', 'backlog-reason'), ...(c.canWrite() ? [c.button('Restore from backlog', () => c.command({ type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId, backlogged: false }).then(() => c.closeDialog(generation)))] : []));
    else if (c.canWrite()) backlogBox.append(c.button('Backlog…', () => c.backlogForm(backlogBox, { ...task, id: commandTaskId }, () => c.closeDialog(generation), dialogMemberId), 'backlog-open'));
    stack.append(backlogBox);
    const completion = c.el('div', undefined, 'form-stack task-completion-controls');
    const challengeCheck = c.check(`Counts for our chunk challenge · ${name}`, !!status.challengeCompleted, value => c.command({ type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId, challengeCompleted: value }));
    const challengeHelp = c.el('p', 'The task-list checkbox records this challenge check. Your group completion rule decides whose checks satisfy the task.', 'field-help'); challengeHelp.id = 'task-challenge-completion-help';
    challengeCheck.querySelector?.('input')?.setAttribute('aria-describedby', challengeHelp.id);
    const personalCheck = c.check(`${name} did this in-game personally`, (owner.completedTasks.includes(commandTaskId) || owner.completedTasks.includes(task.id)), value => c.command({ type: 'complete-task', memberId: dialogMemberId, taskId: commandTaskId, completed: value }));
    const personalHelp = c.el('p', `Records ${name}’s own in-game completion. Personal completion also counts toward the challenge; a challenge check alone does not record personal completion.`, 'field-help'); personalHelp.id = 'task-personal-completion-help';
    personalCheck.querySelector?.('input')?.setAttribute('aria-describedby', personalHelp.id);
    completion.append(challengeCheck, challengeHelp, personalCheck, personalHelp);
    stack.append(completion, ...(c.canWrite() ? [c.check('Pin to the top of the list', !!status.favorite, value => c.command({ type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId, favorite: value }))] : []));
    stack.append(createNoteEditor(c.panelContext, { label: 'Task note', saveLabel: 'Save note', payload: { type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId }, review: { revision: dialogRevision, original: owner.taskStatus?.[commandTaskId]?.note ?? '', value: status.note ?? '' }, isCurrent: () => c.dialogCurrent(generation) }));
    if (task.wiki && c.supportsFeature?.('rsCatalogues') !== false) { const link = c.el('a', 'Open RuneScape Wiki'); link.href = task.wiki; link.target = '_blank'; link.rel = 'noopener noreferrer'; stack.append(link); }
    stack.append(bottomSlot);
    const fillDetails = (full, fullResultValue) => {
      if (full.category === 'Quest' && c.supportsFeature?.('quests') !== false) mapSlot.replaceChildren(c.questMap.controls({ task: full, guard: () => c.dialogCurrent(generation) }));
      const equipment = c.supportsFeature?.('equipment') === false ? null : renderTaskEquipment(full, fullResultValue, c.definitions.equipment, { document, iconLookup: itemIcon, advanced: c.advanced() });
      topSlot.replaceChildren(...(equipment ? [equipment] : []));
      if (full.explanation) explanation.textContent = full.explanation;
      showGuidance(full, fullResultValue);
      if (!asks && full.record?.Description) stack.prepend(c.el('p', c.plain(full.record.Description), 'task-asks'));
      bottomSlot.replaceChildren(...c.taskDetailSections(full, fullResultValue, () => generation, review));
    };
    if (!progressive) fillDetails(task, detailResult);
    else {
      bottomSlot.append(c.el('p', 'Loading sources and details…', 'status-detail task-detail-loading'));
      const requestedMember = c.memberId, revision = c.state.revision;
      // Defer until the dialog generation exists. Review loaders retain their owner.
      Promise.resolve().then(() => review.loadResult ? review.loadResult() : c.ensureDuoDetails(ownerId, true, !!duoEntry)).then(value => {
        if (requestedMember !== c.memberId || revision !== c.state.revision || !c.dialogCurrent(generation)) return;
        if (value.memberId !== dialogMemberId || value.stateRevision !== revision) throw new Error('The saved task details changed. Open the task again.');
        const fullTask = value.tasks.find(row => row.id === task.id);
        if (!fullTask) { bottomSlot.replaceChildren(c.el('p', 'This task is no longer in the current calculation. Refresh Tasks.', 'status-detail')); return; }
        fillDetails(fullTask, value);
      }).catch(error => { if (c.dialogCurrent(generation)) bottomSlot.replaceChildren(c.el('p', error.message || String(error), 'error')); });
    }
    generation = c.openDialog(task.label, stack);
    return Promise.resolve();
  }

  function taskDetailSections(task, detailResult, currentGeneration, review = {}) {
    const dialogMemberId = review.memberId ?? c.memberId;
    const nodes = [], selectedMember = c.memberId, dialogRevision = c.state.revision;
    const openTask = row => c.showTask(row, true, { ...review, memberId: dialogMemberId, result: detailResult });
    if (task.sources?.length) nodes.push(c.details('Sources and locations', c.sourceView(task.sources, detailResult, openTask)));
    const alternativesByTask = detailResult?.presentation?.alternatives ?? {};
    const activeId = Object.hasOwn(alternativesByTask, task.id) ? task.id : Object.keys(alternativesByTask).find(id => alternativesByTask[id].includes(task.id));
    const activeTask = detailResult?.tasks.find(row => row.id === activeId) ?? task;
    const alternativeIds = activeId ? [activeId, ...alternativesByTask[activeId]] : [];
    const alternativeGroup = activeTask.record?.Label === 'Every Drop' ? `Every Drop ${activeTask.item}`
      : Object.hasOwn(detailResult?.training ?? {}, activeTask.category) ? String(detailResult.presentation?.effectiveLevels?.[activeTask.id] ?? activeTask.level) : null;
    if (alternativeIds.length) {
      const choose = async id => {
        if (c.state.revision !== dialogRevision) throw new Error('The saved map changed. Open this task again before choosing an alternative.');
        await c.command({ type: 'set-task-alternative', memberId: dialogMemberId, category: task.category, group: alternativeGroup, taskId: id }, dialogRevision);
        if (c.memberId !== selectedMember || !c.dialogCurrent(currentGeneration())) return;
        const refreshed = await c.ensureDuoDetails(dialogMemberId, true, !!review.duoEntry);
        if (c.memberId === selectedMember && c.dialogCurrent(currentGeneration())) c.showTask(refreshed.tasks.find(row => row.id === (id ?? activeTask.id)) ?? task, true, {
          ...review, memberId: dialogMemberId, result: refreshed, loadResult: () => c.ensureDuoDetails(dialogMemberId, true, !!review.duoEntry),
        });
      };
      const taskIndex = new Map(detailResult.tasks.map(row => [row.id, row]));
      const alternatives = createTaskMethods({ document, tasks: alternativeIds.map(id => taskIndex.get(id)).filter(Boolean), activeId,
        canChoose: c.canWrite() && !!alternativeGroup && (!review.onReturn || !!review.duoEntry || dialogMemberId === c.memberId), choose, open: openTask, automatic: !resolveTaskAlternatives(c.state, c.state.members.find(owner => owner.id === dialogMemberId))[task.category]?.[alternativeGroup] });
      nodes.push(c.details('Alternative methods', alternatives));
    }
    if (task.blockers?.length) nodes.push(c.details('All blockers', c.list(task.blockers.map(blocker => blocker.detail))));
    if (c.advanced() && task.record) nodes.push(c.lazyJSON('Full requirements', task.record));
    return nodes;
  }

  function sourceView(sources, sourceResult = c.fullResult?.stateRevision === c.state.revision && c.fullResult.memberId === c.memberId ? c.fullResult : c.result ?? { tasks: [] }, openTask) {
    const ownerId = sourceResult?.memberId;
    return c.infoPanels.sourceView(sources, sourceResult, openTask ?? (ownerId && ownerId !== c.memberId ? task => c.showTask(task, false, { memberId: ownerId, result: sourceResult }) : undefined));
  }

  function showItem(item, itemResult) {
    if (itemResult && (itemResult.memberId !== c.memberId || itemResult.stateRevision !== c.state.revision)) throw new Error('Saved state changed. Search again before viewing this item.');
    const content = c.el('div', undefined, 'form-stack');
    content.dataset.usage = 'tasks:item-detail';
    if (item.slot) content.append(c.el('p', `${item.slot} · ${item.class} · Tier ${item.tier}`, 'status-detail'));
    if (item.slot) { const requirements = c.definitions.equipment?.[item.name]?.requirements; if (requirements) content.append(c.details('Equip requirements', c.list(Object.entries(requirements).map(([skill, level]) => `${skill}: ${level}`)))); }
    if (item.sources?.length) content.append(c.sourceView(item.sources, itemResult));
    if (c.advanced()) content.append(c.lazyJSON('Full item details', item)); c.openDialog(item.name, content);
  }

  Object.assign(c, { showTask, taskDetailSections, sourceView, showItem });
}
