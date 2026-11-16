import { memberDisplay } from './screen-ui.mjs';
import { taskExplanation } from '../tasks/task-provenance.mjs';
import { appendTaskWhy, catalogued, createRuleDescriber } from './task-why.mjs';
import { appendTaskHow } from './task-how.mjs';
import { createWhyChainDisclosure } from './task-why-chain.mjs';
import { createNoteEditor } from './info-panels.mjs';
import { renderTaskEquipment } from './task-equipment.mjs';
import { itemIcon } from './icons.mjs';
import { createTaskMethods } from './task-methods.mjs';
import { resolveTaskAlternatives } from './core/task-alternatives.mjs';
import { createQuestMap } from './quest-map.mjs';
import { renderTaskBlockerGuidance } from './screen-task-guidance.mjs';

// Main-screen taskDialogs; shared values and callbacks live in the explicit screen context.
export function createScreenTaskDialogs(c) {
  const noteDrafts = new Map();
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
    const ownerResult = review.result ?? (ownerId === c.memberId ? c.result ?? (c.shownResult?.memberId === ownerId ? c.shownResult : undefined) ?? (c.duoEnabled() ? c.duoResults().results().get(ownerId) : undefined) : c.duoResults().results().get(ownerId));
    // A display-cache row at the current revision is still provisional until
    // the live answer arrives (a release can change availability without a
    // new save revision), so it gets the same Updating… path as an old one.
    // Identity, not origin: a prerequisite opened from a cached dialog passes
    // the same cached object back in as review.result.
    const provisional = !c.sandbox.active && ownerId === c.memberId && !c.result && !!c.shownResult && ownerResult === c.shownResult;
    const stale = !!ownerResult && (ownerResult.stateRevision !== c.state.revision || provisional);
    const custom = task.id.startsWith('custom:');
    // Validated details already loaded at this revision decide whether an old
    // or cached row still exists; they never fall back to the cached row.
    const removed = stale && !!loadedFull && !custom && !loadedFull.tasks.some(row => row.id === task.id);
    const progressive = !c.sandbox.active && !custom && !loadedFull && (stale || (!detailed && ownerResult?.format === 'play-v1' && ownerResult.tasks.some(row => row.id === task.id)));
    if ((!detailed || stale) && !progressive && loadedFull) task = loadedFull.tasks.find(row => row.id === task.id) ?? task;
    const detailResult = loadedFull ?? ownerResult;
    const commandTaskId = duoEntry?.id ?? task.id;
    const dialogMemberId = ownerId, dialogRevision = c.state.revision, status = owner.taskStatus?.[commandTaskId] ?? owner.taskStatus?.[task.id] ?? {}, name = owner.name;
    const reportContext = { dialog: 'Task details', taskId: task.id, task: task.label, memberId: dialogMemberId, player: name, revision: detailResult?.stateRevision ?? dialogRevision, sandbox: c.sandbox.active };
    let generation;
    const stack = c.el('div', undefined, 'form-stack');
    stack.dataset.usage = 'tasks:detail';
    if (review.onReturn) stack.append(c.button('Back to Completed Tasks', review.onReturn, 'completed-return'));
    if (duoEntry) {
      const names = duoEntry.memberIds.map(id => c.state.members.find(value => value.id === id)?.name ?? id).join(' and ');
      const owners = c.el('div', undefined, 'duo-task-dialog-owners'); owners.append(c.el('span', `For ${names} · showing ${name}'s details`, 'task-meta'));
      for (const id of duoEntry.memberIds.filter(id => id !== ownerId)) owners.append(memberDisplay(c.button(`View for ${c.state.members.find(value => value.id === id)?.name ?? id}`, () => c.showTask(duoEntry.tasksByMember[id], false, {
        ...review, memberId: id, result: c.duoResults().results().get(id), loadResult: () => c.ensureDuoDetails(id),
      })), c.state.members));
      stack.append(owners);
    }
    // What the task actually asks for, before any status detail.
    const asks = task.record?.Description ?? task.description;
    if (asks) stack.append(c.el('p', c.plain(asks), 'task-asks'));
    const updating = c.el('p', 'Updating… · Last known task details', 'status-detail'); updating.hidden = !stale; updating.setAttribute('role', 'status');
    if (stale) stack.append(updating);
    const topSlot = c.el('div', undefined, 'task-detail-slot'), bottomSlot = c.el('div', undefined, 'task-detail-slot');
    const mapSlot = c.el('div');
    if (task.category === 'Quest') stack.append(mapSlot);
    stack.append(topSlot);
    const displayLevel = task.record?.RequirementAlternatives && task.level === 1 ? undefined : task.level;
    const explanation = c.el('p', taskExplanation(task, detailResult) || (progressive ? task.blockers?.[0]?.detail ?? '' : 'Custom task.'));
    const guidanceSlot = c.el('div', undefined, 'task-blocker-actions');
    const showGuidance = (full, result) => {
      const guidance = renderTaskBlockerGuidance(c, full, result ?? {}, { memberId: dialogMemberId, openTask: row => c.showTask(row, true, { ...review, memberId: dialogMemberId, result }) });
      guidanceSlot.replaceChildren(...(guidance ? [guidance] : []));
    };
    const taskStatus = c.el('p', `${task.category}${displayLevel && !(task.generated && task.category === 'BiS') ? ` · Level ${displayLevel}` : ''} · ${task.status}`, 'status-detail');
    stack.append(taskStatus, explanation, guidanceSlot);
    if (progressive) showGuidance(task, detailResult);
    const backlogBox = c.el('div', undefined, 'task-backlog-box');
    const showBacklogReason = () => {
      backlogBox.replaceChildren(c.el('p', status.backlogReason ? `Backlogged: ${status.backlogReason}` : 'Backlogged.', 'backlog-reason'));
      if (!c.canWrite()) return;
      const edit = c.button('Edit reason', () => {
        const form = c.el('form', undefined, 'backlog-reason-dialog'), reason = c.el('textarea');
        const presets = ['Later', 'Need progress', 'Task looks wrong', 'Other'], original = status.backlogReason ?? '';
        const initialPreset = presets.find(value => original === value || original.startsWith(`${value}: `)) ?? '';
        const initialText = initialPreset ? original === initialPreset ? '' : original.slice(initialPreset.length + 2) : original;
        reason.value = initialText;
        const initialValue = reason.value;
        // Match new backlog details while keeping longer imported text editable.
        reason.maxLength = Math.max(200, initialText.length);
        const choices = c.el('fieldset'), radios = [];
        choices.append(c.el('legend', 'Reason (optional)'));
        for (const value of ['', ...presets]) {
          const radio = c.input('radio'), label = c.el('label', undefined, 'backlog-reason-choice');
          radio.name = 'edit-backlog-reason'; radio.value = value; radio.checked = value === initialPreset;
          label.append(radio, c.el('span', value || 'No reason')); choices.append(label); radios.push(radio);
        }
        const details = c.el('label', 'Details (optional)'); details.append(reason);
        const lengthError = c.el('p', '', 'error field-help'); lengthError.hidden = true;
        lengthError.id = 'backlog-reason-length-error'; lengthError.setAttribute('role', 'alert');
        reason.setAttribute('aria-describedby', lengthError.id);
        const save = c.el('button', 'Save reason', 'primary-action'); save.type = 'submit';
        const cancel = () => { showBacklogReason()?.focus(); };
        const actions = c.el('div', undefined, 'form-actions'); actions.append(save, c.button('Cancel', cancel));
        form.append(choices, details, lengthError, actions);
        form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
        form.addEventListener('submit', async event => {
          event.preventDefault(); if (save.disabled || !c.canWrite() || !c.dialogCurrent(generation)) return;
          const preset = radios.find(radio => radio.checked)?.value ?? '';
          const backlogReason = preset === initialPreset && reason.value === initialValue ? original : [preset, reason.value.trim()].filter(Boolean).join(': ');
          if (backlogReason === original) { c.closeDialog(generation); return; }
          const excess = backlogReason.length - 500;
          lengthError.hidden = excess <= 0; reason.setAttribute('aria-invalid', String(excess > 0));
          if (excess > 0) {
            lengthError.textContent = `Reasons can be at most 500 characters. Remove ${excess} character${excess === 1 ? '' : 's'}.`;
            reason.focus(); return;
          }
          save.disabled = true;
          try {
            await c.command({ type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId, backlogReason }, dialogRevision);
            if (c.dialogCurrent(generation)) c.closeDialog(generation);
          } catch (error) { save.disabled = false; c.showError(error); }
        });
        backlogBox.replaceChildren(form); radios.find(radio => radio.checked)?.focus();
      });
      backlogBox.append(edit, c.button('Restore from backlog', () => c.command({ type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId, backlogged: false }).then(() => c.closeDialog(generation))));
      return edit;
    };
    if (status.backlogged) showBacklogReason();
    else if (c.canWrite()) backlogBox.append(c.button('Backlog…', () => c.backlogForm(backlogBox, { ...task, id: commandTaskId }, () => c.closeDialog(generation), dialogMemberId), 'backlog-open'));
    if (['blocked', 'unsupported'].includes(task.status) && !task.id.startsWith('custom:')) stack.append(createWhyChainDisclosure(c, { taskId: task.id }, {
      memberId: dialogMemberId, revision: dialogRevision, advanced: c.advanced,
      loadFull: async () => ({ result: await c.ensureDuoDetails(dialogMemberId, false, false), definitions: c.definitions }),
      current: () => c.dialogCurrent(generation) && c.state.revision === dialogRevision,
      ...(c.sandbox.active ? { result: detailResult, definitions: c.definitions } : {}),
    }));
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
    const draftKey = JSON.stringify([dialogMemberId, commandTaskId]);
    const noteReview = (c.canWrite() ? noteDrafts.get(draftKey) : undefined) ?? { revision: dialogRevision, original: owner.taskStatus?.[commandTaskId]?.note ?? '', value: status.note ?? '' };
    stack.append(createNoteEditor(c.panelContext, {
      label: 'Task note', saveLabel: 'Save note', payload: { type: 'set-task-status', memberId: dialogMemberId, taskId: commandTaskId },
      review: noteReview, isCurrent: () => c.dialogCurrent(generation),
      onChange: () => noteDrafts.set(draftKey, noteReview),
      onSaved: value => { if (noteDrafts.get(draftKey)?.value === value) noteDrafts.delete(draftKey); },
    }));
    if (task.wiki && c.supportsFeature?.('rsCatalogues') !== false) { const link = c.el('a', 'Open RuneScape Wiki', 'standalone-link'); link.href = task.wiki; link.target = '_blank'; link.rel = 'noopener noreferrer'; stack.append(link); }
    stack.append(bottomSlot);
    if (c.canWrite()) stack.append(c.button('Report a problem with this task', () => c.openFeedback({
      text: `Problem with task: ${reportContext.task}\n\nWhat looks wrong: `, context: reportContext,
    }), 'task-report'));
    const fillDetails = (full, fullResultValue) => {
      Object.assign(reportContext, { task: full.label, revision: fullResultValue?.stateRevision ?? dialogRevision });
      updating.hidden = true;
      if (full.category === 'Quest' && c.supportsFeature?.('quests') !== false) mapSlot.replaceChildren(c.questMap.controls({ task: full, guard: () => c.dialogCurrent(generation) }));
      const equipment = c.supportsFeature?.('equipment') === false ? null : renderTaskEquipment(full, fullResultValue, c.definitions.equipment, { document, iconLookup: itemIcon, advanced: c.advanced() });
      topSlot.replaceChildren(...(equipment ? [equipment] : []));
      const fullLevel = full.record?.RequirementAlternatives && full.level === 1 ? undefined : full.level;
      taskStatus.textContent = `${full.category}${fullLevel && !(full.generated && full.category === 'BiS') ? ` · Level ${fullLevel}` : ''} · ${full.status}`;
      explanation.textContent = taskExplanation(full, fullResultValue) || full.blockers?.[0]?.detail || '';
      showGuidance(full, fullResultValue);
      if (!asks && full.record?.Description) stack.prepend(c.el('p', c.plain(full.record.Description), 'task-asks'));
      bottomSlot.replaceChildren(...c.taskDetailSections(full, fullResultValue, () => generation, review));
    };
    // The shown row came from an older or cached answer; drop its status and
    // controls so nothing on screen still claims it is current.
    const showRemoved = () => {
      updating.hidden = true;
      for (const node of [taskStatus, explanation, guidanceSlot, backlogBox, completion]) node.remove?.();
      bottomSlot.replaceChildren(c.el('p', 'This task is no longer in the current calculation. Refresh Tasks.', 'status-detail'));
    };
    if (removed) showRemoved();
    else if (!progressive) fillDetails(task, detailResult);
    else {
      bottomSlot.append(c.el('p', 'Loading sources and details…', 'status-detail task-detail-loading'));
      const requestedMember = c.memberId, revision = c.state.revision;
      // Defer until the dialog generation exists. Review loaders retain their owner.
      Promise.resolve().then(() => review.loadResult ? review.loadResult() : c.ensureDuoDetails(ownerId, true, !!duoEntry)).then(value => {
        if (requestedMember !== c.memberId || revision !== c.state.revision || !c.dialogCurrent(generation)) return;
        if (value.memberId !== dialogMemberId || value.stateRevision !== revision) throw new Error('The saved task details changed. Open the task again.');
        const fullTask = value.tasks.find(row => row.id === task.id);
        if (!fullTask) { showRemoved(); return; }
        fillDetails(fullTask, value);
      }).catch(error => { if (c.dialogCurrent(generation)) bottomSlot.replaceChildren(c.el('p', error.message || String(error), 'error')); });
    }
    generation = c.openDialog(task.label, stack);
    return Promise.resolve();
  }

  function taskDetailSections(task, detailResult, currentGeneration, review = {}) {
    const dialogMemberId = review.memberId ?? c.memberId;
    const nodes = [], selectedMember = c.memberId, dialogRevision = c.state.revision;
    if (!task.id.startsWith('custom:')) {
      const why = c.el('div', undefined, 'task-detail-why');
      appendTaskWhy(why, task, { cache: c.viewCache, cacheKey: JSON.stringify([dialogMemberId, task.id]), revision: () => c.state.revision,
        scope: () => JSON.stringify([c.memberId, c.state.revision, c.viewCache?.token(), c.dialogGeneration]), document, button: c.button, icon: c.icon, readOnly: !c.canWrite(),
        openRule: ruleId => Promise.resolve(c.rulesDialog({ ruleId, memberId: dialogMemberId })).catch(c.showError),
        load: async () => {
          const describeRule = catalogued(await createRuleDescriber(c.taskDisplayState?.() ?? c.state, dialogMemberId));
          if (c.state.revision !== dialogRevision || !c.dialogCurrent(currentGeneration())) throw new Error('The saved map changed. Open the task again.');
          const place = key => c.world?.chunks.get(key) ?? c.world?.areas.get(key);
          return { task, result: detailResult ?? { tasks: [task] }, describeRule,
            locationName: id => c.plain((place(String(id)) ?? place(String(id).replace(/-\d+$/, '')))?.name ?? '') };
        } });
      nodes.push(why);
      const how = c.el('div', undefined, 'task-detail-how');
      appendTaskHow(how, task, { cache: c.viewCache, cacheKey: JSON.stringify([dialogMemberId, task.id]), revision: () => c.state.revision,
        document, button: c.button, readOnly: !c.canWrite(), enabled: c.preferences().showTaskHow !== false,
        scope: () => JSON.stringify([c.memberId, c.state.revision, c.viewCache?.token(), c.sandbox.signature(), c.preferences().showTaskHow !== false, c.dialogCurrent(currentGeneration())]),
        advanced: c.advanced, locationName: id => {
          const place = key => c.world?.chunks.get(key) ?? c.world?.areas.get(key);
          return c.plain((place(String(id)) ?? place(String(id).replace(/-\d+$/, '')))?.name ?? '');
        },
        load: async (value, signal) => {
          if (c.preferences().showTaskHow === false) throw new Error('How is off in Settings > Tasks.');
          if (c.sandbox.active) throw new Error('How is available for the saved map. Leave Sandbox to open it.');
          if (c.memberId !== selectedMember || c.state.revision !== dialogRevision || !c.dialogCurrent(currentGeneration())) throw new Error('The saved map changed. Open the task again.');
          const proof = await c.api(`/api/task-how?memberId=${encodeURIComponent(dialogMemberId)}&taskId=${encodeURIComponent(value.id)}&revision=${dialogRevision}`, undefined, signal);
          if (proof.context?.stateRevision !== dialogRevision || proof.context?.memberId !== dialogMemberId || proof.subject?.id !== value.id) throw new Error('The saved map changed. Open How again.');
          return proof;
        } });
      if (how.children.length) nodes.push(how);
    }
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
