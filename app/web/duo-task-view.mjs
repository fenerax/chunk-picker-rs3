import { gameStorage } from './screen-save-status.mjs';
import { duoCommandTarget } from './duo-tasks.mjs';
import { appendTaskClaim } from './task-claims.mjs';
import { isCustomTask, customTaskAssignedTo } from './custom-tasks-model.mjs';
import { readDuoPersonalFilter, writeDuoPersonalFilter, normalizeDuoPersonalFilter } from './duo-task-preferences.mjs';

// The command identity a row's controls act on; task-focus.mjs matches it across redraws.
export function duoTaskFocusKey(entry) {
  const owners = entry.personalCompletion ? entry.filterMemberIds : entry.memberIds;
  return JSON.stringify(['group', owners?.join(','), entry.id ?? entry.task.id, entry.personalCompletion ? 'personal' : 'group']);
}

/** Duo rows keep their task owner separate from the selected map. */
export function createDuoTaskView({ document, getState, getSelectedMember, command, backlog, showTask, attachHover,
  getClaimMember = getSelectedMember, appendWhy = () => {}, getViewerId = () => 'viewer', getStorage = () => gameStorage(), actingForMember = () => false, appendIcon = () => {}, appendPin = () => {}, appendEdit = () => {}, showError, readOnly = () => false, canEdit = () => true, canComplete = canEdit, canInspect = canEdit, onFilter = () => {} }) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const button = (text, action, cls) => { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return node; };
  let ownerFilter = 'all', enabled = false;
  let storage;
  try { storage = getStorage(); } catch { /* Storage may be denied by the browser. */ }
  let viewerId = getViewerId(), personalFilter = readDuoPersonalFilter(storage, viewerId);
  const controlsNode = el('div', undefined, 'duo-task-controls'); controlsNode.hidden = true;
  const chips = el('div', undefined, 'duo-task-filters'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Filter group tasks');
  const hint = el('p', 'Tasks from each player’s own chunks. Shared checks count for the duo.', 'duo-task-hint');
  const secondaryLabel = el('label', undefined, 'duo-personal-filter'), secondary = el('select');
  secondary.id = 'duo-personal-filter'; secondary.setAttribute('aria-label', 'Personal group task filter');
  secondaryLabel.append(secondary);
  secondary.addEventListener('change', () => { personalFilter = normalizeDuoPersonalFilter(secondary.value); writeDuoPersonalFilter(storage, personalFilter, viewerId); refresh(); onFilter(); });
  const controlRow = el('div', undefined, 'duo-task-control-row'); controlRow.append(chips, secondaryLabel);
  controlsNode.append(controlRow, hint);
  function refresh() {
    if (viewerId !== getViewerId()) { viewerId = getViewerId(); personalFilter = readDuoPersonalFilter(storage, viewerId); }
    const owners = getState().members;
    if (!['all', 'both', ...owners.map(owner => owner.id)].includes(ownerFilter)) ownerFilter = 'all';
    chips.replaceChildren(...[{ id: 'all', name: 'All' }, ...owners, { id: 'both', name: 'Both' }].map(owner => {
      const chip = button(owner.name, () => { ownerFilter = owner.id; refresh(); onFilter(); }, 'duo-task-chip');
      chip.setAttribute('aria-pressed', String(owner.id === ownerFilter)); return chip;
    }));
    const name = owners.find(owner => owner.id === getSelectedMember())?.name ?? 'selected player';
    secondary.replaceChildren(...[['group', 'Normal group tasks'], ['not-done', `Not done by ${name}`], ['only-player', `Only ${name} can do`]].map(([value, text]) => { const option = el('option', text); option.value = value; return option; }));
    secondary.value = personalFilter;
    hint.textContent = personalFilter === 'group' ? 'Tasks from each player’s own chunks. Shared checks count for the duo.'
      : personalFilter === 'not-done' ? `Tasks ${name} can do now and has not personally completed, including tasks their partner has done.`
        : `Tasks ${name} can do now and has not personally completed, which their partner cannot do on their own map.`;
  }
  function choose(host, entry, action, done, completion = false) {
    const current = () => completion ? canComplete() && entry.memberIds.every(id => getState().members.some(owner => owner.id === id))
      : canEdit() && (entry.stateRevision === undefined || entry.stateRevision === getState().revision);
    if (!current()) throw new Error('The task list changed. Review it and try again.');
    const commandEntry = entry.personalCompletion ? { ...entry, memberIds: entry.filterMemberIds } : entry;
    const target = duoCommandTarget(commandEntry, getSelectedMember());
    if (!target.requiresChoice) return action(target.memberId);
    host.querySelector?.('.duo-task-chooser')?.remove();
    const form = el('form', undefined, 'duo-task-chooser'), picker = el('select');
    picker.setAttribute('aria-label', 'Player for this task');
    for (const id of target.memberIds) { const option = el('option', getState().members.find(owner => owner.id === id)?.name ?? id); option.value = id; picker.append(option); }
    picker.value = target.preferredMemberId;
    const confirm = el('button', done, 'primary-action'); confirm.type = 'submit';
    const cancel = button('Cancel', () => { form.remove(); onFilter(); });
    form.append(el('span', 'For', 'task-meta'), picker, confirm, cancel);
    form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); confirm.disabled = true;
      try { if (!current()) throw new Error('The task list changed. Review it and try again.'); const choice = duoCommandTarget(commandEntry, getSelectedMember(), picker.value); await action(choice.memberId); form.remove(); }
      catch (error) { confirm.disabled = false; showError(error); }
    });
    host.append(form); picker.focus?.();
  }
  function row(entry, { backlogged = false } = {}) {
    const task = entry.task, commandTaskId = entry.id ?? task.id, facts = entry.facts, node = el('div', undefined, 'task-row duo-task-row');
    const checked = entry.personalCompletion ? facts.personal : facts.group;
    node.dataset.completed = String(checked); node.dataset.taskId = task.id; node.dataset.owners = entry.memberIds.join(',');
    node.dataset.focusTask = duoTaskFocusKey(entry);
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = checked; checkbox.dataset.taskControl = 'complete';
    checkbox.disabled = !canComplete(); checkbox.setAttribute('aria-label', `Counts for our chunk challenge: ${task.label} · ${entry.label}`);
    checkbox.title = 'Records challenge completion. Open task details to record personal in-game completion.';
    checkbox.addEventListener('change', async () => {
      if (!canComplete()) { checkbox.checked = checked; return; }
      const completed = checkbox.checked; checkbox.checked = checked;
      try { await choose(node, entry, async owner => { checkbox.checked = completed; node.dataset.completed = String(completed); try { await command({ type: 'set-task-status', memberId: owner, taskId: commandTaskId, challengeCompleted: completed }); } catch (error) { checkbox.checked = checked; node.dataset.completed = String(checked); throw error; } }, completed ? 'Mark done' : 'Clear check', true); }
      catch (error) { showError(error); }
    });
    const body = el('div', undefined, 'task-body'), content = el('div');
    const target = duoCommandTarget(entry, getSelectedMember());
    const ownerId = entry.displayMemberIds ? entry.memberId : target.preferredMemberId ?? target.memberId;
    const label = button(task.label, () => showTask(entry.tasksByMember?.[ownerId] ?? task, false, { memberId: ownerId, duoEntry: entry }), 'task-label-button');
    label.disabled = !canInspect(); label.dataset.taskControl = 'open';
    content.append(label, el('span', entry.label, 'duo-task-owner'));
    appendPin(label, entry);
    if (task.level && !(task.record?.RequirementAlternatives && task.level === 1) && !(task.generated && task.category === 'BiS')) content.append(el('span', `Level ${task.level}`, 'task-meta'));
    if (facts.group) content.append(el('span', `Done by ${facts.completedBy.map(id => getState().members.find(owner => owner.id === id)?.name ?? id).join(' and ')}`, 'task-meta'));
    if (!backlogged) for (const id of entry.displayMemberIds ?? entry.memberIds) {
      const personal = entry.tasksByMember?.[id] ?? task;
      if (personal.status !== 'available') {
        const name = getState().members.find(owner => owner.id === id)?.name ?? id;
        content.append(el('span', `${name}: ${personal.blockers?.[0]?.detail || 'Needs review'}`, 'blocked-reason'));
      }
    }
    if (facts.group || (!backlogged && task.status === 'available')) appendTaskClaim({ document, host: content, task, taskId: commandTaskId, getState, getMemberId: getClaimMember, command, showError,
      canEdit: () => canEdit() && (!entry.inspectionOnly || facts.group) && (!isCustomTask(task) || customTaskAssignedTo(task, getClaimMember())), actingForMember,
      readOnly: readOnly(), completed: facts.group || entry.factsByMember?.[getClaimMember()]?.personal === true || facts.completedBy?.includes(getClaimMember()) === true });
    appendEdit(content, task);
    appendIcon(body, task); body.append(content); node.append(readOnly() ? el('span', checked ? 'Done' : 'Not done', 'task-completion-status') : checkbox, body);
    const defer = button(backlogged ? 'Restore…' : 'Backlog…', () => choose(node, entry, owner => backlogged
      ? command({ type: 'clear-backlog', memberId: owner, taskIds: [commandTaskId] }, entry.stateRevision)
      : backlog(node, { ...(entry.tasksByMember?.[owner] ?? task), id: commandTaskId }, undefined, owner), backlogged ? 'Restore' : 'Backlog…'), 'duo-task-backlog');
    appendWhy(node, entry.tasksByMember?.[ownerId] ?? task, ownerId);
    defer.hidden = defer.disabled = !canEdit(); defer.dataset.taskControl = 'backlog'; node.append(defer);
    attachHover?.(node, label, entry.tasksByMember?.[ownerId] ?? task, ownerId);
    return node;
  }
  return { controls: () => controlsNode, filter: () => ownerFilter, personalFilter: () => personalFilter,
    selectionNeedsInspection: () => personalFilter !== 'group', refresh, row, focusKey: duoTaskFocusKey,
    clearFilter() { ownerFilter = 'all'; personalFilter = 'group'; writeDuoPersonalFilter(storage, personalFilter, viewerId); refresh(); },
    setEnabled(on) { enabled = on; controlsNode.hidden = !enabled; refresh(); },
  };
}
