// Served by group-personal-filter.mjs. Execute shipped selection and screen
// rendering, with already-loaded results and no map, icons, network or calculator.
export async function setup(prefix, fixture) {
  const [{ selectDuoTasks }, { selectDuoTaskLists }, { createTaskFactsIndex, goalProgress },
    { personalCustomTaskRows, isCustomTask, customTaskAssignedTo }, { selectTaskFilters, createTaskPinChecker },
    { createDuoTaskView }, { createScreenTasks }, { appendTaskClaim }] = await Promise.all([
    import(`${prefix}/app/web/duo-tasks.mjs`), import(`${prefix}/app/web/duo-task-lists.mjs`), import(`${prefix}/app/core/progress-index.mjs`),
    import(`${prefix}/app/web/custom-tasks-model.mjs`), import(`${prefix}/app/web/task-filters-model.mjs`),
    import(`${prefix}/app/web/duo-task-view.mjs`), import(`${prefix}/screen.mjs`), import(`${prefix}/app/web/task-claims.mjs`),
  ]);
  const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
  const { state, results } = fixture;
  const times = {};
  const timed = (name, action) => { const start = performance.now(); try { return action(); } finally { times[name] = (times[name] ?? 0) + performance.now() - start; } };
  let personalFilter = 'group', group = true;
  const nodes = new Map();
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const $ = id => { if (!nodes.has(id)) { const n = el(id.endsWith('details') ? 'details' : 'div'); n.id = id; n.value = ''; document.body.append(n); nodes.set(id, n); } return nodes.get(id); };
  const button = (text, action, cls) => { const n = el('button', text, cls); n.addEventListener('click', action); return n; };
  $('hide-completed').checked = true;
  const c = { state, registry, memberId: 'one', member: () => state.members.find(m => m.id === c.memberId),
    result: results[0], taskRenderGeneration: 0, taskListRows: new Map(), duoHovers: new Map(),
    el, $, button, input: type => { const n = el('input'); n.type = type; return n; }, plain: x => x,
    sandbox: { active: false, signature: () => '', isNewTask: () => false }, preferences: () => ({}), canWrite: () => true,
    map: {}, renderLegend() {}, perfMark() {}, appendCustomTaskEdit() {}, iconButton: (text, _icon, action) => button(text, action), iconLink: () => el('a'),
    list: () => el('span'), showError: error => { throw error; },
  };
  createScreenTasks(c, { selectDuoTasks: args => timed('selection', () => selectDuoTasks(args)),
    selectDuoTaskLists: args => timed('sideLists', () => selectDuoTaskLists(args)),
    createTaskFactsIndex, goalProgress, personalCustomTaskRows, isCustomTask, customTaskAssignedTo, createTaskPinChecker, appendTaskClaim });
  c.renderBacklog = () => {};
  c.duoEnabled = () => group;
  const cached = { results: () => new Map(results.map(r => [r.memberId, r])), remember() {} };
  c.duoResults = c.duoInspectionResults = () => cached;
  c.activeTaskFilters = () => ({ select: (rows, options, extra) => timed('displayFilters', () => selectTaskFilters(rows, { ...options, filters: {}, search: extra?.search }).rows), category: () => true });
  const view = createDuoTaskView({ document, getState: () => state, getSelectedMember: () => c.memberId,
    getStorage: () => null, appendPin: (node, entry) => { if (c.duoPins(entry)) node.append(el('span', '★')); },
    showError: c.showError, command() {}, backlog() {}, showTask() {},
  });
  c.duoView = () => ({ ...view, filter: () => 'all', personalFilter: () => personalFilter, selectionNeedsInspection: () => personalFilter !== 'group' });
  c.hoverTasks = () => ({ attach() {} });
  const renderDuo = c.renderDuoTasks;
  c.renderDuoTasks = (...args) => timed('activeList', () => renderDuo(...args));
  const paint = c.paintTaskJobs;
  c.paintTaskJobs = async (...args) => { const t = performance.now(); const done = await paint(...args); times.paint = performance.now() - t; return done; };
  return {
    async action(filter, memberId = 'one', groupOn = true) {
      personalFilter = filter; group = groupOn; c.memberId = memberId; c.result = results.find(r => r.memberId === memberId);
      for (const key of Object.keys(times)) delete times[key];
      // Invalidate just the selection when measuring repeated filter actions.
      c.duoSelectionKey = undefined;
      globalThis.groupFilterParts = {};
      const start = performance.now();
      c.renderTasks(); const synchronous = performance.now() - start;
      await c.taskRenderDone;
      return { ...times, ...globalThis.groupFilterParts, synchronous, total: performance.now() - start,
        count: $('task-count').textContent, paintedRows: $('active-tasks').querySelectorAll('.task-row').length,
        rows: groupOn ? c.activeDuoRows?.length ?? 0 : $('active-tasks').querySelectorAll('.task-row').length };
    },
    snapshot() { return [$('active-tasks').outerHTML, $('task-count').textContent, $('completed-count').textContent, $('backlog-count').textContent]; },
    selection(options) { return selectDuoTasks({ state, results, registry, selectedMemberId: 'one', ...options }); },
  };
}
