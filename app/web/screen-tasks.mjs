import { createTaskFactsIndex, goalProgress } from './core/progress-index.mjs';
import { createTaskIconPainter } from './task-icon-painter.mjs';
import { taskIcon, taskCategoryIcon } from './browser-task-icons.mjs';
import { itemIcon, skillIcon } from './icons.mjs';
import { createTaskHover } from './task-hover.mjs';
import { appendTaskPin, createTaskFilters } from './task-filters.mjs';
import { isTaskPinned, createTaskPinChecker } from './task-filters-model.mjs';
import { createDuoResultCache, selectDuoTasks } from './duo-tasks.mjs';
import { createDuoTaskView } from './duo-task-view.mjs';
import { appendTaskClaim, createTaskClaimClock } from './task-claims.mjs';
import { isCustomTask, customTaskAssignedTo, personalCustomTaskRows } from './custom-tasks-model.mjs';
import { createCopyLists } from './copy-lists.mjs';
import { createBacklogView } from './screen-backlog.mjs';
import { selectDuoTaskLists } from './duo-task-lists.mjs';
import { createDuoBacklogView } from './duo-backlog-view.mjs';
import { createTickActiveTasks } from './tick-active-tasks.mjs';
import { appendTaskWhy, catalogued, createRuleDescriber, savedTaskWhyResult } from './task-why.mjs';
import { createTaskFocus } from './task-focus.mjs';

// Main-screen tasks; shared values and callbacks live in the explicit screen context.
export function createScreenTasks(c) {
  const taskDisplayState = () => c.taskDisplayState?.() ?? c.state;
  const displayResults = new WeakMap();
  function currentDisplayResult(value) {
    if (value.stateRevision === c.state.revision) return value;
    let display = displayResults.get(value);
    if (display?.stateRevision !== c.state.revision) { display = { ...value, stateRevision: c.state.revision }; displayResults.set(value, display); }
    return display;
  }
  c.taskClaimClock = createTaskClaimClock({ document });
  if (typeof createCopyLists === 'function') c.copyLists = createCopyLists(c);
  if (typeof createTickActiveTasks === 'function') c.tickActiveTasks = createTickActiveTasks(c);
  function buildTaskFactsCache(snapshot, activeMemberId, ruleRegistry, sourceResult) {
    return { ...createTaskFactsIndex(snapshot, activeMemberId, ruleRegistry, { tasks: sourceResult?.tasks ?? [], completionGroups: sourceResult?.collectionPlanning?.completionGroups ?? {} }), sourceResult };
  }

  function taskFacts(task) {
    const state = taskDisplayState();
    const source = c.result ?? (typeof c.shownResult !== 'undefined' && c.shownResult?.memberId === c.memberId ? c.shownResult : undefined);
    if (c.taskFactsCache?.state !== state || c.taskFactsCache.memberId !== c.memberId || c.taskFactsCache.registry !== c.registry || c.taskFactsCache.sourceResult !== source) c.taskFactsCache = c.buildTaskFactsCache(state, c.memberId, c.registry, source);
    return c.taskFactsCache.get(task.id, task.completionIds);
  }

  function backlogForm(host, task, after, owner = c.memberId) {
    if (!c.canWrite()) return;
    const existing = host.querySelector?.(':scope > .backlog-form');
    if (existing) { existing.querySelector('input')?.focus(); return; }
    const form = c.el('form', undefined, 'backlog-form'), reason = c.input('text');
    const trigger = document.activeElement;
    const dismiss = () => {
      form.remove();
      const available = node => node && node !== document.body && typeof node.focus === 'function' && node.isConnected !== false && !node.disabled && !node.hidden && !node.closest?.('[hidden]');
      const fallback = host.querySelector?.('.task-backlog, .backlog-open, .task-label-button');
      (available(trigger) ? trigger : available(fallback) ? fallback : null)?.focus();
    };
    reason.placeholder = 'Reason (optional)'; reason.maxLength = 200; reason.setAttribute('aria-label', `Why backlog ${c.plain(task.label)}?`);
    const save = c.el('button', 'Backlog', 'primary-action'); save.type = 'submit';
    const cancel = c.button('Cancel', dismiss);
    form.append(reason, save, cancel);
    form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      const text = reason.value.trim();
      try { await c.command({ type: 'set-task-status', memberId: owner, taskId: task.id, backlogged: true, backlogReason: text }); after?.(); }
      catch (error) { save.disabled = false; c.showError(error); }
    });
    host.append(form); reason.focus?.();
  }

  // The command identity a row's controls act on; task-focus.mjs matches it across redraws.
  const soloTaskFocusKey = task => JSON.stringify(['solo', c.memberId, task.id, 'challenge']);

  function taskRow(task) {
    const facts = c.taskFacts(task), row = c.el('div', undefined, 'task-row'); row.dataset.completed = facts.group;
    row.dataset.taskId = task.id; row.dataset.focusTask = soloTaskFocusKey(task);
    const checkbox = c.input('checkbox'); checkbox.dataset.taskControl = 'complete'; checkbox.checked = facts.personal; checkbox.disabled = !c.canWrite(); checkbox.setAttribute('aria-label', `Mark ${c.plain(task.label)} done for ${c.member().name}`); checkbox.title = 'Counts for our chunk challenge. Record personal in-game completion in task details.'; checkbox.addEventListener('change', async () => { if (!c.canWrite()) { checkbox.checked = c.taskFacts(task).personal; return; } checkbox.disabled = true; try { await c.command({ type: 'set-task-status', memberId: c.memberId, taskId: task.id, challengeCompleted: checkbox.checked }); } catch (error) { checkbox.checked = c.taskFacts(task).personal; c.showError(error); } finally { checkbox.disabled = !c.canWrite(); } });
    const content = c.el('div'), label = c.button(task.label, () => c.showTask(task), 'task-label-button'); label.dataset.taskControl = 'open'; content.append(label);
    appendTaskPin(document, label, c.taskPins ? c.taskPins(task) : isTaskPinned(task, { state: c.state, memberId: c.memberId }));
    if (c.sandbox.isNewTask(task.id)) content.append(c.el('span', 'new', 'sandbox-new'));
    if (task.level && !(task.record?.RequirementAlternatives && task.level === 1) && !(task.generated && task.category === 'BiS')) content.append(c.el('span', `Level ${task.level}${task.primary ? ' · Primary method' : ''}`, 'task-meta'));
    if (facts.group) content.append(c.el('span', `Done by ${facts.completedBy.map(id => c.state.members.find(item => item.id === id)?.name || id).join(' and ')}`, 'task-meta'));
    const taskState = c.member().taskStatus?.[task.id] ?? {};
    const completed = facts.group || facts.personal;
    if (completed || (!taskState.backlogged && task.status === 'available')) appendTaskClaim({ document, host: content, task, completed,
      readOnly: !c.canWrite(), getState: () => c.state, getMemberId: () => c.sessionMember ?? c.memberId, actingForMember: () => !c.sessionMember, command: c.command, showError: c.showError,
      canEdit: () => c.canWrite() && !c.sandbox.active && (!isCustomTask(task) || customTaskAssignedTo(task, c.sessionMember ?? c.memberId)) && c.result?.stateRevision === c.state.revision && (completed || c.claimableTaskIds?.has(task.id)) });
    if (taskState.backlogged && taskState.backlogReason) content.append(c.el('span', `Backlogged: ${taskState.backlogReason}`, 'task-meta backlog-reason'));
    c.appendCustomTaskEdit(content, task);
    // In the Backlog list the backlog itself is the reason; don't repeat it as a blocker.
    if (task.status !== 'available' && !c.member().taskStatus?.[task.id]?.backlogged) content.append(c.el('span', task.blockers?.[0]?.detail || 'Needs review', 'blocked-reason'));
    const body = c.el('div', undefined, 'task-body'); c.taskIconPainter.append(body, task);
    body.append(content);
    row.append(c.canWrite() ? checkbox : c.el('span', facts.personal ? 'Done' : 'Not done', 'task-completion-status'), body);
    appendWhy(row, task);
    // One hop to the Wiki instead of opening the task first.
    if (task.wiki) row.append(c.iconLink(task.wiki, `Open ${c.plain(task.label)} on the RuneScape Wiki`, 'wiki'));
    const backlogAction = taskState.backlogged
      ? c.iconButton(`Restore ${c.plain(task.label)} from the backlog`, 'restore', () => c.command({ type: 'set-task-status', memberId: c.memberId, taskId: task.id, backlogged: false }).catch(c.showError))
      : c.iconButton(`Backlog ${c.plain(task.label)}…`, 'backlog', () => c.backlogForm(row, task));
    backlogAction.classList?.add('task-backlog'); backlogAction.dataset.taskControl = 'backlog'; row.append(backlogAction);
    backlogAction.hidden = !c.canWrite(); backlogAction.disabled = !c.canWrite() || c.sandbox.active;
    c.hoverTasks().attach(row, label, task);
    return row;
  }

  function paintTaskJobs(jobs, generation) {
    // A complete catalogue still supplies counts and order; row construction
    // yields between small slices so map input can run during a large render.
    const nextSlice = index => {
      const start = globalThis.performance?.now?.() ?? 0;
      for (; index < jobs.length; index++) {
        if (generation !== c.taskRenderGeneration) return Promise.resolve(false);
        jobs[index]();
        if (typeof requestAnimationFrame === 'function' && performance.now() - start >= 8 && index + 1 < jobs.length) {
          const next = index + 1;
          return new Promise(resolve => requestAnimationFrame(() => resolve(nextSlice(next))));
        }
      }
      return Promise.resolve(true);
    };
    return nextSlice(0);
  }

  // Show more is view state: a redraw keeps each category as deep as the player
  // opened it, and deep enough for a row whose control is waiting for focus.
  function categoryDepth(target, category, rows, keyOf) {
    return Math.max(70, c.taskListDepths?.get(target)?.get(category) ?? 0, c.taskFocus?.depth(target, rows, keyOf) ?? 0);
  }

  function rememberDepth(target, category, shown) {
    c.taskListDepths ??= new WeakMap();
    if (!c.taskListDepths.has(target)) c.taskListDepths.set(target, new Map());
    c.taskListDepths.get(target).set(category, shown);
  }

  function appendTaskRow(body, node) { body.append(node); c.taskFocus?.offer(node); }

  function grouped(target, tasks, jobs = [], generation = c.taskRenderGeneration, fold = false, row = c.taskRow, keyOf = soloTaskFocusKey) {
    target.replaceChildren(); if (!tasks.length) { target.append(c.el('p', 'No tasks in this view.', 'empty-list')); return; }
    const groups = new Map(); for (const task of tasks) { if (!groups.has(task.category)) groups.set(task.category, []); groups.get(task.category).push(task); }
    for (const [category, rows] of groups) {
      const heading = c.el('h3', `${category} (${rows.length})`, 'category-heading'); c.categoryIconPainter.append(heading, category);
      const section = c.el('section'), body = fold ? c.el('div', undefined, 'task-category-body') : section; section.append(heading); if (fold) section.append(body);
      let shown = 0, limit = categoryDepth(target, category, rows, keyOf);
      const appendMore = () => { if (shown < rows.length) { more.textContent = `Show more ${category} tasks (${rows.length - shown})`; body.append(more); } };
      const rowJobs = () => { const slice = rows.slice(shown, shown + limit); limit = 70; shown += slice.length; return [...slice.map(task => () => appendTaskRow(body, row(task))), appendMore]; };
      const renderMore = async () => { more.disabled = true; more.remove(); try { const next = rowJobs(); rememberDepth(target, category, shown); await c.paintTaskJobs(next, generation); } finally { more.disabled = false; } };
      const more = c.button('Show more', renderMore, 'wide-button');
      if (!fold || c.activeTaskFilters().category(heading, category, body, () => c.paintTaskJobs(rowJobs(), generation))) jobs.push(...rowJobs());
      target.append(section);
    }
  }

  function activeTaskFilters() {
    if (!c.taskFiltersView) {
      c.taskFiltersView = createTaskFilters({ document, getClaimMemberId: () => c.sessionMember ?? c.memberId, getStorage: () => globalThis.localStorage, onChange: c.renderTasks, clearSearch: () => { c.$('task-filter').value = ''; c.duoTaskView?.clearFilter(); } });
      c.$('task-filter').after(c.taskFiltersView.element);
    }
    return c.taskFiltersView;
  }

  function bindTaskSearch() {
    let timer;
    c.$('task-filter').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(c.renderTasks, 100); });
  }

  function renderBacklog(tasks, jobs = [], generation = c.taskRenderGeneration) {
    if (c.duoEnabled()) {
      c.duoBacklogView ??= createDuoBacklogView({ document, getState: () => c.state, getMemberId: () => c.memberId,
        getOwnerFilter: () => c.duoView().filter(), enabled: c.duoEnabled,
        canEdit: () => c.canWrite() && c.duoEnabled() && c.duoRowsReady, command: (...args) => c.command(...args), showError: c.showError,
        onChange: () => c.renderTasks(), locationName: id => (c.world?.chunks.get(id) ?? c.world?.areas.get(id))?.name ?? id,
        loadTasks: id => c.api(`/api/backlog-search?memberId=${encodeURIComponent(id)}`), row: entry => c.duoView().row(entry, { backlogged: true }), paint: (...args) => c.paintTaskJobs(...args) });
      return c.duoBacklogView.render(c.$('backlog-actions'), c.$('backlog-tasks'), tasks, { open: c.$('backlog-details').open, jobs, generation });
    }
    c.backlogView ??= createBacklogView({ document, getState: () => c.state, getMemberId: () => c.memberId,
      canEdit: () => c.canWrite() && !c.sandbox.active, command: (...args) => c.command(...args), showError: c.showError,
      onChange: () => c.renderTasks(), locationName: id => (c.world?.chunks.get(id) ?? c.world?.areas.get(id))?.name ?? id,
      loadTasks: id => c.api(`/api/backlog-search?memberId=${encodeURIComponent(id)}`), row: task => c.taskRow(task), paint: (...args) => c.paintTaskJobs(...args) });
    return c.backlogView.render(c.$('backlog-actions'), c.$('backlog-tasks'), tasks, { open: c.$('backlog-details').open, jobs, generation });
  }

  function renderCompleted(tasks, jobs = [], generation = c.taskRenderGeneration) {
    if (!c.$('completed-details').open) { c.$('completed-tasks').replaceChildren(); return; }
    if (c.duoEnabled()) c.grouped(c.$('completed-tasks'), tasks.map(entry => ({ ...entry, category: entry.task.category })), jobs, generation, false, entry => c.duoView().row(entry), entry => c.duoView().focusKey(entry));
    else c.grouped(c.$('completed-tasks'), tasks, jobs, generation);
  }

  function duoEnabled() { return c.$('group-view').checked && !c.sandbox.active; }

  function duoResults() {
    return c.duoResultCache ??= createDuoResultCache({
      getScope: () => ({ revision: c.state.revision, selectedMemberId: c.memberId, memberIds: c.state.members.map(owner => owner.id), groupOn: c.duoEnabled(), sandbox: c.sandbox.active }),
      fetchResult: (id, revision, peerFor) => c.fetchSavedTasks(id, revision, undefined, undefined, peerFor),
      onChange: () => { if (c.duoEnabled() && c.result?.memberId === c.memberId && c.result.stateRevision === c.state.revision) c.renderTasks(); },
    });
  }

  function startDuoTaskLoad(allowBeforeSelected = false) {
    if (!c.duoEnabled() || c.hasProvisionalTasks()) return;
    const scope = `${c.state.revision}:${c.memberId}:${c.sandbox.signature()}`;
    if (c.duoLoadScope !== scope) { c.duoLoadScope = scope; c.duoLoadError = undefined; }
    const cache = c.duoResults();
    // The selected request belongs to the foreground loader. Once every partner
    // is cached, waiting for it must not restart an already-empty peer load.
    const cached = cache.results();
    if (c.duoLoading?.scope === scope || c.duoLoadError || c.state.members.every(owner => owner.id === c.memberId || cached.has(owner.id))) return;
    if (!allowBeforeSelected && (c.result?.memberId !== c.memberId || c.result.stateRevision !== c.state.revision)) return;
    const request = { scope, promise: cache.ensure({ allowBeforeSelected }) }; c.duoLoading = request;
    const currentScope = () => c.duoEnabled() && !c.hasProvisionalTasks() && scope === `${c.state.revision}:${c.memberId}:${c.sandbox.signature()}`;
    request.promise.catch(error => { if (currentScope()) { c.duoLoadError = error.code === 'TASK_RESULTS_UNAVAILABLE' ? 'waiting' : error.message; c.renderTasks(); } }).finally(() => {
      if (c.duoLoading !== request) return;
      c.duoLoading = undefined;
    });
  }

  function duoInspectionResults() {
    return c.duoInspectionCache ??= createDuoResultCache({
      getScope: () => ({ revision: c.state.revision, memberIds: c.state.members.map(owner => owner.id), groupOn: c.duoEnabled(), sandbox: c.sandbox.active }),
      fetchResult: (id, revision) => c.fetchSavedTasks(id, revision, 'duo-inspection-v1'),
      onChange: () => { if (c.duoEnabled()) c.renderTasks(); },
    });
  }

  function startDuoInspectionLoad() {
    if (!c.duoEnabled() || c.hasProvisionalTasks()) return;
    const scope = `${c.state.revision}:${c.sandbox.signature()}`;
    if (c.duoInspectionScope !== scope) { c.duoInspectionScope = scope; c.duoInspectionError = undefined; }
    const cache = c.duoInspectionResults();
    if (c.duoInspectionLoading?.scope === scope || c.duoInspectionError || c.state.members.every(owner => cache.results().has(owner.id))) return;
    const request = { scope, promise: cache.ensure({ allowBeforeSelected: true }) }; c.duoInspectionLoading = request;
    request.promise.catch(error => {
      if (c.duoEnabled() && scope === `${c.state.revision}:${c.sandbox.signature()}`) {
        c.duoInspectionError = error.code === 'TASK_RESULTS_UNAVAILABLE' ? 'waiting' : error.message;
        c.renderTasks();
      }
    }).finally(() => {
      if (c.duoInspectionLoading !== request) return;
      c.duoInspectionLoading = undefined;
      // Entering and leaving Sandbox can discard the old request while
      // returning to the same saved scope. Resume that inspection once idle.
      if (c.duoEnabled() && scope === `${c.state.revision}:${c.sandbox.signature()}` && !c.duoInspectionError
        && cache.results().size !== c.state.members.length) c.renderTasks();
    });
  }

  async function refreshDuoInspection(revision) {
    if (!c.duoEnabled() || (!c.duoInspectionError && !c.duoInspectionLoading)) return;
    await c.duoInspectionLoading?.promise.catch(() => {});
    if (c.duoEnabled() && c.state.revision === revision && c.duoInspectionError) {
      c.duoInspectionError = undefined;
      c.renderTasks();
    }
  }

  // Sources name chunk sections as "<chunk>-<section>"; those take their chunk's name.
  function placeName(id) {
    const place = key => c.world?.chunks.get(key) ?? c.world?.areas.get(key);
    return c.plain((place(String(id)) ?? place(String(id).replace(/-\d+$/, '')))?.name ?? '');
  }

  // The explanation reads the full result only when a player opens it.
  function appendWhy(row, task, ownerId = c.memberId) {
    if (isCustomTask(task)) return;
    const openRule = ruleId => Promise.resolve(c.rulesDialog({ ruleId, memberId: ownerId })).catch(c.showError);
    appendTaskWhy(row, task, { document, button: c.button, icon: c.icon, openRule, readOnly: !c.canWrite(), load: async value => {
      const revision = c.state.revision, selected = c.memberId;
      let result;
      if (c.canWrite()) result = await c.ensureDuoDetails(ownerId, false, false);
      else {
        const [saved] = await Promise.all([c.api(`/api/tasks?memberId=${encodeURIComponent(ownerId)}`).catch(error => {
          if (error.code !== 'TASK_DETAILS_UNAVAILABLE') throw error;
          return c.api(`/api/tasks?view=play-v1&memberId=${encodeURIComponent(ownerId)}`);
        }), c.ensureFullDefinitions()]);
        if (selected !== c.memberId || revision !== c.state.revision || saved.stateRevision !== revision || saved.memberId !== ownerId) throw new Error('The selected map or saved state changed while loading. Try again.');
        result = saved.format === 'play-v1' ? savedTaskWhyResult(saved, c.definitions) : saved;
      }
      const describeRule = catalogued(await createRuleDescriber(taskDisplayState(), ownerId));
      return { task: result.tasks.find(item => item.id === value.id) ?? value, result, describeRule, locationName: placeName };
    } });
  }

  async function ensureDuoDetails(ownerId, guardDialog = true, requireDuo = true) {
    if (ownerId === c.memberId) return c.ensureFullResult(guardDialog);
    const selected = c.memberId, revision = c.state.revision, generation = c.dialogGeneration;
    const key = `${revision}:${ownerId}`;
    if (!c.duoDetailRequests.has(key) && !c.duoDetails.has(key)) {
      const request = Promise.all([c.api(`/api/tasks?memberId=${encodeURIComponent(ownerId)}`), c.ensureFullDefinitions()]).then(([value]) => value);
      c.duoDetailRequests.set(key, request); request.finally(() => c.duoDetailRequests.delete(key)).catch(() => {});
    }
    const value = c.duoDetails.get(key) ?? await c.duoDetailRequests.get(key);
    if ((requireDuo && !c.duoEnabled()) || selected !== c.memberId || revision !== c.state.revision || value.stateRevision !== revision || value.memberId !== ownerId || (guardDialog && !c.dialogCurrent(generation))) throw new Error('The duo view changed while loading. Open this task again.');
    if (c.duoDetails.size >= c.state.members.length) c.duoDetails.clear();
    c.duoDetails.set(key, value); return value;
  }

  function attachDuoHover(row, label, task, ownerId) {
    if (!c.duoHovers.has(ownerId)) c.duoHovers.set(ownerId, createTaskHover({
      document, viewport: globalThis, setTimeout, clearTimeout,
      getScope: () => `${c.duoEnabled()}:${c.memberId}:${c.state.revision}:${c.sandbox.signature()}`,
      getContext: () => ({ result: c.duoDetails.get(`${c.state.revision}:${ownerId}`) ?? c.duoResults().results().get(ownerId), equipment: c.definitions.equipment,
        locationName: id => placeName(id) || id }),
      // A checkbox can retain focus during refresh. Its tooltip must not start
      // an expensive full-detail calculation for rows being replaced.
      getDetails: async value => !c.duoRowsReady || value.record || isCustomTask(value) ? value : (await c.ensureDuoDetails(ownerId, false)).tasks.find(item => item.id === value.id) ?? value,
    }));
    c.duoHovers.get(ownerId).attach(row, label, task);
  }

  function duoView() {
    if (!c.duoTaskView) {
      c.duoTaskView = createDuoTaskView({ document, getState: () => c.state, getSelectedMember: () => c.memberId,
        getStorage: () => globalThis.localStorage, getViewerId: () => c.sessionMember ?? (c.canWrite() ? 'admin' : 'viewer'),
        getClaimMember: () => c.sessionMember ?? c.memberId, actingForMember: () => !c.sessionMember,
        command: c.command, backlog: c.backlogForm, showTask: c.showTask, attachHover: c.attachDuoHover, appendWhy, appendIcon: (body, task) => c.taskIconPainter.append(body, task),
        readOnly: () => !c.canWrite(), canComplete: () => c.canWrite() && !c.sandbox.active && c.duoEnabled(),
        canEdit: () => c.canWrite() && !c.sandbox.active && c.duoEnabled() && c.duoRowsReady, canInspect: () => !c.sandbox.active && (c.duoRowsReady || !c.canWrite() && c.result?.stateRevision === c.state.revision && c.result.memberId === c.memberId), showError: c.showError, onFilter: c.renderTasks,
        appendPin: (content, entry) => appendTaskPin(document, content, c.duoPins(entry)),
        appendEdit: (content, task) => { c.appendCustomTaskEdit(content, task); const edit = content.querySelector('.custom-task-edit'); if (edit) edit.disabled ||= !c.duoRowsReady; } });
      c.$('task-count').parentElement.after(c.duoTaskView.controls());
      const sheet = c.el('link'); sheet.rel = 'stylesheet'; sheet.href = '/duo-tasks.css'; document.head.append(sheet);
    }
    return c.duoTaskView;
  }

  function renderDuoTasks(target, jobs, generation, filter) {
    const scope = `${c.state.revision}:${c.memberId}:${c.sandbox.signature()}`;
    if (c.duoLoadScope !== scope) { c.duoLoadScope = scope; c.duoLoadError = undefined; }
    const cache = c.duoResults();
    if (c.result?.stateRevision === c.state.revision && c.result.memberId === c.memberId) cache.remember(c.result);
    const current = [...cache.results().values()];
    const baseReady = current.length === c.state.members.length;
    if (baseReady) c.duoLoadError = undefined;
    const ownerFilter = c.duoView().filter(), personalFilter = c.duoView().personalFilter();
    const showCompleted = !c.$('hide-completed').checked, showBlocked = c.$('show-blocked').checked, showAll = c.$('show-all').checked;
    const inspect = showBlocked || showAll || !!filter || c.duoView().selectionNeedsInspection();
    let inspectionValues = [];
    if (inspect) {
      const inspection = c.duoInspectionResults();
      // Ordinary compact results omit inspection exclusions such as NeverShow.
      // Reuse only the explicit inspection projection or a full catalogue.
      for (const value of current) if (value.projection === 'duo-inspection-v1' || !value.projection && value.format !== 'play-v1') inspection.remember(value);
      inspectionValues = [...inspection.results().values()];
      if (baseReady && inspectionValues.length !== c.state.members.length) c.startDuoInspectionLoad();
    }
    const ready = baseReady && (!inspect || inspectionValues.length === c.state.members.length) && taskDisplayState() === c.state;
    if (ready && inspect) c.duoInspectionError = undefined;
    if (ready && inspect) c.lastDuoInspectionResults = inspectionValues;
    c.duoRowsReady = ready;
    if (baseReady) c.lastDuoResults = current;
    // Keep each partner's last rows until their replacement arrives. Completion
    // facts always come from saved state plus queued checks, never result bytes.
    const inspected = inspect ? c.state.members.map(owner => inspectionValues.find(value => value.memberId === owner.id)
      ?? c.lastDuoInspectionResults?.find(value => value.memberId === owner.id)).filter(Boolean) : [];
    const showInspection = inspect && inspected.length === c.state.members.length;
    const sourceValues = showInspection ? inspected
      : c.state.members.map(owner => current.find(value => value.memberId === owner.id) ?? c.lastDuoResults?.find(value => value.memberId === owner.id)).filter(Boolean);
    const state = taskDisplayState();
    c.duoDisplayResults = sourceValues.map(currentDisplayResult);
    const selectionKey = [state, c.state.revision, c.registry, c.memberId, ownerFilter, personalFilter, showCompleted, showBlocked, showAll, !!filter, ready, ...sourceValues];
    if (!c.duoSelectionKey || selectionKey.length !== c.duoSelectionKey.length || selectionKey.some((value, index) => value !== c.duoSelectionKey[index])) {
      c.duoSelection = selectDuoTasks({ state, results: c.duoDisplayResults, registry: c.registry, selectedMemberId: c.memberId, ownerFilter,
        personalFilter: showInspection ? personalFilter : 'group', showCompleted,
        showBlocked: showInspection && showBlocked, showAll: showInspection && showAll, searchAll: showInspection && !!filter });
      c.duoSelectionKey = selectionKey;
    }
    const duo = c.duoSelection;
    const rows = c.activeTaskFilters().select(duo.rows, { state: c.state, memberId: c.memberId, ownerFilter }, { group: true, ownerHidden: duo.counts.union - duo.rows.length, search: filter, externalActive: personalFilter !== 'group' || ownerFilter !== 'all', doableFixed: personalFilter !== 'group' });
    c.copyActiveTasks = rows.map(entry => entry.task); c.activeDuoRows = rows;
    target.replaceChildren();
    const loadError = inspect && baseReady ? c.duoInspectionError : c.duoLoadError;
    const waiting = loadError === 'waiting';
    // The status line above already carries the note when no list is saved yet.
    const shownAbove = waiting && c.$('task-engine-status').textContent === c.viewerTaskWait();
    if (!ready && !shownAbove) target.append(c.el('p', waiting ? c.viewerTaskWait() : loadError ? `Duo tasks could not load: ${loadError}` : inspect && baseReady ? 'Loading more group tasks…' : 'Updating tasks for both players… Previous tasks and counts are shown until ready.', 'status-detail'));
    if (loadError && !waiting) target.append(c.button('Retry duo tasks', () => { c.duoLoadError = c.duoInspectionError = undefined; c.renderTasks(); }));
    if (!rows.length && ready) target.append(c.el('p', 'No tasks in this view.', 'empty-list'));
    const groups = new Map();
    for (const entry of rows) { if (!groups.has(entry.task.category)) groups.set(entry.task.category, []); groups.get(entry.task.category).push(entry); }
    for (const [category, rows] of groups) {
      const section = c.el('section'), body = c.el('div', undefined, 'task-category-body'), heading = c.el('h3', `${category} (${rows.length})`, 'category-heading'); c.categoryIconPainter.append(heading, category); section.append(heading, body); target.append(section);
      let shown = 0, limit = categoryDepth(target, category, rows, entry => c.duoView().focusKey(entry));
      const rowJobs = () => { const slice = rows.slice(shown, shown + limit); limit = 70; shown += slice.length; return [...slice.map(entry => () => appendTaskRow(body, c.duoView().row(entry))), () => { if (shown < rows.length) { more.textContent = `Show more ${category} tasks (${rows.length - shown})`; body.append(more); } }]; };
      const more = c.button('Show more', async () => { more.remove(); const next = rowJobs(); rememberDepth(target, category, shown); await c.paintTaskJobs(next, generation); }, 'wide-button');
      if (c.activeTaskFilters().category(heading, category, body, () => c.paintTaskJobs(rowJobs(), generation))) jobs.push(...rowJobs());
    }
    const count = { union: rows.length, byMember: Object.fromEntries(c.state.members.map(owner => [owner.id, rows.filter(row => (row.displayMemberIds ?? row.memberIds).includes(owner.id)).length])), shared: rows.filter(row => (row.displayMemberIds ?? row.memberIds).length > 1).length };
    c.$('task-count').textContent = sourceValues.length ? `Duo tasks ${count.union} · ${c.state.members.map(owner => `${owner.name} ${count.byMember[owner.id] ?? 0}`).join(' · ')} · shared ${count.shared}${ready ? '' : ' · previous counts, updating'}` : waiting ? 'Duo tasks' : 'Loading duo tasks…';
    if (!baseReady) c.startDuoTaskLoad(c.foregroundTaskLoad?.memberId === c.memberId && c.foregroundTaskLoad.revision === c.state.revision);
    return ready;
  }

  function renderTasks() {
    c.taskFocus?.capture();
    c.groupGoals?.render();
    if (typeof c.reconcileForegroundMode === 'function') c.reconcileForegroundMode();
    c.taskHover?.hide();
    for (const hover of c.duoHovers.values()) hover.hide();
    if (!c.state || !c.member()) return;
    const generation = ++c.taskRenderGeneration, jobs = [];
    const depthScope = `${c.duoEnabled()}:${c.memberId}:${c.sandbox.signature()}`;
    if (c.taskListDepthScope !== depthScope) { c.taskListDepthScope = depthScope; c.taskListDepths = undefined; }
    if (c.result?.memberId === c.memberId) c.shownResult = c.result;
    const view = c.result ?? (typeof c.shownResult !== 'undefined' && c.shownResult?.memberId === c.memberId ? c.shownResult : undefined);
    const countLine = c.$('task-engine-status').firstChild;
    if (view?.metrics && view.memberId === c.memberId && view.stateRevision === c.state.revision && / possible tasks/.test(countLine?.textContent)) {
      countLine.textContent = c.taskEngineCount(view) + (countLine.textContent.match(/ · .*/)?.[0] ?? '');
    }
    c.map.setConnections?.(view?.partnerConnections);
    c.renderLegend();
    const filter = c.$('task-filter').value.toLowerCase().trim(), status = c.member().taskStatus ?? {};
    const known = new Set(view?.tasks.map(task => task.id) ?? []);
    const completedIds = new Set(c.member().completedTasks);
    const extras = c.state.tasks.filter(task => !known.has(task.id) && !isCustomTask(task) && (Object.hasOwn(status, task.id) || completedIds.has(task.id))).map(task => ({ ...task, status: 'unsupported', blockers: [{ kind: 'unsupported', detail: 'Preserved imported task; it has no current availability result.' }], explanation: 'Preserved imported task.' }));
    const allRows = (c.sandbox.active ? [...(view?.tasks ?? []), ...extras] : personalCustomTaskRows([...(view?.tasks ?? []), ...extras], c.state, c.member())).filter(task => task.obligation !== false && !task.hidden);
    const rows = filter ? allRows.filter(task => `${task.label} ${task.category}`.toLowerCase().includes(filter)) : allRows;
    const completed = rows.filter(task => c.taskFacts(task).group), backlog = allRows.filter(task => status[task.id]?.backlogged);
    // Completion is a display filter, independent of the other presentation
    // gates. Both the compact result and full catalogue identify rows hidden
    // only by completion; do not re-admit rows suppressed for another reason.
    const completionRows = view?.presentation?.completedTasks ?? (view?.tasks ?? []).filter(task => {
      const reasons = view?.presentation?.suppressed?.[task.id];
      return reasons?.length && reasons.every(reason => reason === 'Challenge already satisfied.');
    });
    const presentedIds = new Set([...(view?.presentation?.tasks ?? rows), ...(!c.$('hide-completed').checked ? completionRows : [])].map(task => task.id));
    c.claimableTaskIds = new Set([...presentedIds, ...allRows.filter(isCustomTask).map(task => task.id)]);
    const groupOn = c.duoEnabled();
    c.duoInspectionCache?.results();
    c.taskPins = createTaskPinChecker({ state: c.state, memberId: c.memberId });
    if (groupOn) c.duoPins = createTaskPinChecker({ state: c.state, memberId: c.memberId, ownerFilter: c.duoView().filter() });
    const goals = groupOn ? [] : rows.filter(task => !status[task.id]?.backlogged && (task.status === 'available' || c.$('show-blocked').checked) && (presentedIds.has(task.id) || isCustomTask(task) || c.$('show-all').checked || c.$('show-blocked').checked || !!filter));
    const unsearchedGoals = filter && !groupOn ? allRows.filter(task => !status[task.id]?.backlogged && (task.status === 'available' || c.$('show-blocked').checked)) : goals;
    let active = unsearchedGoals.filter(task => !c.$('hide-completed').checked || !c.taskFacts(task).group);
    active.sort((a, b) => Number(!!status[b.id]?.favorite) - Number(!!status[a.id]?.favorite) || a.category.localeCompare(b.category) || (b.level ?? 0) - (a.level ?? 0) || a.label.localeCompare(b.label));
    if (!groupOn) active = c.activeTaskFilters().select(active, { state: c.state, memberId: c.memberId }, { search: filter });
    // Personal lists and their settings retain the existing path when Group view is off.
    if (groupOn || c.duoTaskView) c.duoView().setEnabled(groupOn);
    const personalGroup = groupOn && c.duoView().personalFilter() !== 'group';
    for (const id of ['show-blocked', 'show-all', 'hide-completed']) {
      const control = c.$(id);
      const allIncluded = groupOn && id === 'show-all' && (c.$('show-blocked').checked || !!filter);
      control.disabled = personalGroup || allIncluded;
      const hint = personalGroup ? `This view only shows tasks ${c.member().name} can do now and has not done.`
        : allIncluded ? c.$('show-blocked').checked ? 'Show blocked already includes all possible tasks.' : 'Search already includes all possible tasks.' : '';
      control.title = hint;
      if (control.parentElement) control.parentElement.title = hint;
    }
    const inclusionHint = c.$('task-inclusion-hint');
    inclusionHint.textContent = 'Show blocked already includes all possible tasks.';
    inclusionHint.hidden = !groupOn || !c.$('show-blocked').checked || personalGroup;
    const duoReady = groupOn ? c.renderDuoTasks(c.$('active-tasks'), jobs, generation, filter) : (c.grouped(c.$('active-tasks'), active, jobs, generation, true), false);
    c.mapTaskCounts?.refresh();
    let completedRows = completed, backlogRows = backlog;
    if (groupOn) {
      const results = c.duoDisplayResults, state = taskDisplayState(), ownerFilter = c.duoView().filter();
      const key = [state, c.registry, c.memberId, ownerFilter, filter, ...results];
      if (!c.duoListKey || key.length !== c.duoListKey.length || key.some((value, index) => value !== c.duoListKey[index])) {
        c.duoListSelection = selectDuoTaskLists({ state, results, registry: c.registry, selectedMemberId: c.memberId, ownerFilter, filter });
        c.duoListKey = key;
      }
      completedRows = c.duoListSelection.completed.rows; backlogRows = c.duoListSelection.backlog.rows;
    }
    c.copyLists?.tasks(groupOn ? c.copyActiveTasks : active, completedRows, groupOn, groupOn ? c.duoView().filter() : undefined);
    // ⋯ sits in Copy's own group so the two stay on one line.
    c.tickActiveTasks?.update(groupOn ? c.activeDuoRows ?? [] : active, { duo: groupOn, host: c.$('copy-active-tasks')?.parentElement ?? c.$('task-count').parentElement,
      ready: groupOn ? duoReady : view?.memberId === c.memberId && view.stateRevision === c.state.revision && taskDisplayState() === c.state });
    c.taskListRows.set('completed-tasks', completedRows); c.renderCompleted(completedRows, jobs, generation);
    c.taskListRows.set('backlog-tasks', backlogRows);
    if (typeof c.renderBacklog === 'function') c.renderBacklog(backlogRows, jobs, generation);
    if (!groupOn) c.$('task-count').textContent = c.preferences().numTasksPercent ? `${goalProgress(goals, c.taskFactsCache).percent}% complete` : active.length.toLocaleString();
    if (!groupOn && view && view.stateRevision !== c.state.revision) c.$('task-count').textContent += ' · previous count, updating';
    const updating = groupOn && !duoReady ? ' · updating' : '';
    c.$('backlog-count').textContent = `(${backlogRows.length}${updating})`; c.$('completed-count').textContent = `(${completedRows.length}${updating})`;
    const areaList = c.$('accessible-areas');
    if (!areaList.parentElement || areaList.parentElement.open) areaList.replaceChildren(c.list(view?.access.areas ?? []));
    c.taskRenderDone = c.paintTaskJobs(jobs, generation).then(async painted => {
      if (painted && generation === c.taskRenderGeneration) c.taskFocus?.finish();
      if (painted && typeof requestAnimationFrame === 'function') await new Promise(resolve => requestAnimationFrame(resolve));
      if (painted && duoReady && generation === c.taskRenderGeneration && c.duoEnabled()) c.perfMark('duo-tasks-shown', { revision: c.state.revision, memberId: c.memberId });
      if (painted && generation === c.taskRenderGeneration && c.foregroundSettled?.()) { c.deathChunks?.refresh(); c.syncPredictionIntents?.(); }
      return painted;
    });
  }

  // View-only links never start calculations; a player's next visit fills them in.
  const viewerTaskWait = () => `Tasks will appear here when ${c.state.members.map(owner => owner.name).join(' or ')} opens the picker. This page updates by itself.`;

  Object.assign(c, { viewerTaskWait, buildTaskFactsCache, taskFacts, backlogForm, taskRow, paintTaskJobs, grouped, activeTaskFilters, bindTaskSearch, renderBacklog, renderCompleted, duoEnabled, duoResults, startDuoTaskLoad, duoInspectionResults, startDuoInspectionLoad, refreshDuoInspection, ensureDuoDetails, attachDuoHover, duoView, renderDuoTasks, renderTasks });

  if (typeof createTaskFocus === 'function') c.taskFocus = createTaskFocus({ document, host: () => c.$('active-tasks'),
    scope: () => JSON.stringify([c.duoEnabled(), c.memberId, c.sandbox.signature(), c.dialogGeneration, !!c.$('tool-dialog').open, c.duoTaskView?.filter(), c.duoTaskView?.personalFilter()]),
    // Restoring focus is not a new visit to the row; keep its tooltip closed.
    onRestore: () => { c.taskHover?.hide(); for (const hover of c.duoHovers?.values() ?? []) hover.hide(); } });

  c.taskIconPainter = createTaskIconPainter({
    resolveIcon: task => taskIcon(task, { itemIcon, skillIcon }), createImage: () => c.el('img'), refreshOnSettle: true,
  });

  c.categoryIconPainter = createTaskIconPainter({
    resolveIcon: category => taskCategoryIcon(category, skillIcon), createImage: () => c.el('img'), className: 'category-icon', size: 18, refreshOnSettle: true,
  });

  c.hoverTasks = () => c.taskHover ??= createTaskHover({
    document, viewport: globalThis, setTimeout, clearTimeout,
    getScope: () => `${c.memberId}:${c.state?.revision}:${c.sandbox.signature()}`,
    getContext: () => ({ result: c.fullResult?.memberId === c.memberId && c.fullResult.stateRevision === c.state?.revision ? c.fullResult : c.result, equipment: c.definitions?.equipment, locationName: id => placeName(id) || id }),
    getDetails: async task => {
      if (task.record || task.id.startsWith('custom:') || task.id.startsWith('rs3:task:custom:')) return task;
      const value = await c.ensureFullResult(false);
      return value.tasks.find(row => row.id === task.id) ?? task;
    },
  });
}
