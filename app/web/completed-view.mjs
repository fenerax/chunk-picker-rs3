import { createCompletedModel, filterCompletedRows, groupCompletedRows } from './completed-model.mjs';
import { completedRangeOptions, selectCompletedRange } from './completed-range.mjs';
import { createCompletedRangePreference } from './completed-range-preference.mjs';
import { completedReviewList, createCompletedReviewCopy } from './copy-lists.mjs';

// Completed extends the picker's warm ledger: a compact progress register above
// searchable category folios, with completion evidence beside each task. The
// selected review player is independent of the map. Dates require saved history.
const PAGE_SIZE = 60;
export function createCompletedView(context) {
  const { document, el, button, input, select, field, plain = String } = context;
  let root, generation, selected, model, history, historyRevision, revision, sequence = 0;
  let query = '', attribution = 'all', layout = 'category', busy = false;
  const rangePreference = createCompletedRangePreference(context.storage);
  let range = rangePreference.get(), from = '', to = '';
  let listNode, countNode, unknownNode, rangeErrorNode, confirmationNode, reviewCopy;
  const results = new Map(), requests = new Map(), collapsed = new Set();
  let paintVersion = 0, paintJobs = [], paintScheduled = false;
  function enqueuePaint(job) {
    if (!context.schedulePaint) { job(); return; }
    paintJobs.push({ version: paintVersion, job });
    if (paintScheduled) return;
    paintScheduled = true;
    const paint = () => {
      const started = performance.now();
      while (paintJobs.length) {
        const next = paintJobs.shift();
        if (current() && next.version === paintVersion) next.job();
        if (performance.now() - started >= 8) break;
      }
      if (paintJobs.length && current()) context.schedulePaint(paint);
      else { paintScheduled = false; paintJobs = []; }
    };
    context.schedulePaint(paint);
  }
  const current = () => root && context.dialogCurrent(generation);
  const members = () => context.state().members;
  const date = at => at ? new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date unknown';
  function activeOwners() { return selected === 'both' ? members() : members().filter(owner => owner.id === selected); }
  async function resultFor(owner, snapshot) {
    const key = `${snapshot.revision}:${owner}`;
    if (results.has(key)) return results.get(key);
    if (!requests.has(key)) requests.set(key, Promise.resolve(context.loadResult(owner)).then(value => {
      if (value.stateRevision !== undefined && value.stateRevision !== snapshot.revision) throw new Error('The saved state changed while loading completed tasks. Try again.');
      results.set(key, value); return value;
    }).finally(() => requests.delete(key)));
    return requests.get(key);
  }
  async function detailsFor(owner, snapshot) {
    const key = `${snapshot.revision}:${owner}`, cached = results.get(key);
    if (cached?.format !== 'play-v1') return cached;
    const requestKey = `details:${key}`;
    if (!requests.has(requestKey)) requests.set(requestKey, Promise.resolve(context.loadDetails(owner)).then(value => {
      if (context.state().revision !== snapshot.revision || value.stateRevision !== snapshot.revision || value.memberId !== owner) throw new Error('The saved task details changed. Open the task again.');
      results.set(key, value); return value;
    }).finally(() => requests.delete(requestKey)));
    return requests.get(requestKey);
  }
  async function refresh(force = false) {
    if (!current()) return;
    const snapshot = context.state();
    if (!force && snapshot.revision === revision) return;
    for (const key of results.keys()) if (!key.startsWith(`${snapshot.revision}:`)) results.delete(key);
    const request = ++sequence, selectedAtStart = selected;
    busy = true;
    if (!model) root.replaceChildren(el('p', 'Loading completed tasks…', 'completed-loading'));
    else root.setAttribute('aria-busy', 'true');
    try {
      if (historyRevision !== snapshot.revision) {
        const loaded = context.loadHistory ? await context.loadHistory() : snapshot.history;
        if (!current() || request !== sequence) return;
        history = Array.isArray(loaded) ? loaded : loaded?.history ?? snapshot.history;
        historyRevision = snapshot.revision;
      }
      const loaded = await Promise.all(activeOwners().map(owner => resultFor(owner.id, snapshot)));
      if (!current() || request !== sequence || selectedAtStart !== selected || context.state().revision !== snapshot.revision) return;
      model = createCompletedModel({ state: { ...snapshot, history }, result: loaded, memberId: selected, registry: context.registry() });
      revision = snapshot.revision; busy = false; draw();
    } catch (error) {
      if (!current() || request !== sequence) return;
      busy = false;
      const failure = el('div', undefined, 'completed-empty');
      failure.append(el('p', `Completed tasks could not load. ${error.message}`), button('Try again', () => refresh(true)));
      root.replaceChildren(failure);
    } finally { if (current() && request === sequence) { busy = false; root.setAttribute('aria-busy', 'false'); } }
  }
  function summary() {
    const section = el('section', undefined, 'completed-overview'); section.setAttribute('aria-label', 'Completion summary');
    const line = el('div', undefined, 'completed-totals');
    line.append(el('strong', `${model.summary.total.toLocaleString()} done all time`), el('span', `${model.summary.thisWeek ?? 0} this week`, 'completed-week'));
    const denominator = model.summary.denominator ?? model.summary.totalTasks ?? model.summary.total;
    const progress = el('progress'); progress.max = Math.max(1, denominator); progress.value = model.summary.total;
    progress.setAttribute('aria-label', `${model.summary.total} done out of ${denominator} possible tasks`);
    section.append(line, progress, el('p', `${model.summary.total.toLocaleString()} of ${denominator.toLocaleString()} possible tasks`, 'completed-progress-label'));
    const categories = el('div', undefined, 'completed-category-counts');
    for (const group of model.categories) {
      const count = button(`${group.category} ${group.count}`, () => { query = group.category; draw(); }, 'completed-category-count');
      context.categoryIconPainter?.append(count, group.category); categories.append(count);
    }
    if (model.categories.length) {
      const breakdown = el('details', undefined, 'completed-breakdown');
      breakdown.append(el('summary', `Per-category counts (${model.categories.length})`), categories); section.append(breakdown);
    }
    return section;
  }
  function draw() {
    if (!current() || !model) return;
    const toolbar = el('div', undefined, 'completed-controls');
    const players = el('div', undefined, 'completed-players'); players.setAttribute('role', 'group'); players.setAttribute('aria-label', 'Review completed tasks for');
    for (const owner of [...members(), { id: 'both', name: 'Both' }]) {
      const choice = button(owner.name, () => { if (selected === owner.id) return; selected = owner.id; attribution = 'all'; revision = undefined; refresh(true); }, 'completed-player');
      choice.setAttribute('aria-pressed', String(selected === owner.id)); players.append(choice);
    }
    const search = input('search', query); search.placeholder = 'Find a completed task…'; search.setAttribute('aria-label', 'Filter completed tasks');
    // Only list content changes while typing, preserving focus and selection.
    search.addEventListener('input', () => { query = search.value; renderList(); });
    const order = select([{ value: 'category', label: 'Group by category' }, { value: 'recent', label: 'Most recently completed' }], layout);
    order.setAttribute('aria-label', 'Completed task layout'); order.addEventListener('change', () => { layout = order.value; renderList(); });
    toolbar.append(players, field('Find a task', search), field('View', order));
    const rangeControls = el('div', undefined, 'completed-range-controls');
    const rangeSelect = select(completedRangeOptions, range); rangeSelect.setAttribute('aria-label', 'Completion date range');
    const custom = el('div', undefined, 'completed-custom-range'); custom.hidden = range !== 'custom';
    const fromInput = input('date', from), toInput = input('date', to);
    fromInput.setAttribute('aria-label', 'Completed from'); toInput.setAttribute('aria-label', 'Completed to');
    fromInput.setAttribute('aria-describedby', 'completed-range-error'); toInput.setAttribute('aria-describedby', 'completed-range-error');
    const updateDates = () => { from = fromInput.value; to = toInput.value; renderList(); };
    fromInput.addEventListener('change', updateDates); toInput.addEventListener('change', updateDates);
    rangeSelect.addEventListener('change', () => {
      rangePreference.set(rangeSelect.value); range = rangePreference.get(); custom.hidden = range !== 'custom'; renderList();
    });
    custom.append(field('From', fromInput), field('To', toInput));
    rangeErrorNode = el('p', '', 'completed-range-error'); rangeErrorNode.id = 'completed-range-error'; rangeErrorNode.setAttribute('role', 'status');
    rangeControls.append(field('Date range', rangeSelect), custom, rangeErrorNode);
    const chips = el('div', undefined, 'completed-filters'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Completion evidence');
    const options = [{ value: 'all', label: 'All completed' }];
    for (const owner of activeOwners()) options.push({ value: `ticked:${owner.id}`, label: `Ticked by ${owner.name}` });
    for (const owner of members().filter(owner => selected === 'both' || owner.id !== selected)) options.push({ value: `done:${owner.id}`, label: `Done by ${owner.name}` });
    options.push({ value: 'runemetrics', label: 'Done in-game (RuneMetrics)' }, { value: 'imported', label: 'Imported from original picker' });
    options.push({ value: 'game-plugin', label: 'Done in-game (Game plugin)' });
    for (const option of options) {
      const chip = button(option.label, () => { attribution = attribution === option.value ? 'all' : option.value; for (const node of chips.children) node.setAttribute('aria-pressed', String(node.dataset.filter === attribution)); renderList(); }, 'completed-chip');
      chip.dataset.filter = option.value; chip.setAttribute('aria-pressed', String(attribution === option.value)); chips.append(chip);
    }
    const listHeading = el('div', undefined, 'completed-list-heading');
    const status = el('h3', '', 'completed-result-count'); status.setAttribute('aria-live', 'polite'); status.dataset.role = 'count';
    listHeading.append(status, reviewCopy.element);
    unknownNode = el('p', '', 'completed-undated-note');
    const list = el('div', undefined, 'completed-list'); list.dataset.role = 'list';
    listNode = list; countNode = status; confirmationNode = undefined;
    const footer = el('div', undefined, 'completed-footer');
    footer.append(el('span', 'Either player can satisfy a duo task. Imported ticks may have no completion date.'), ...(context.canWrite?.() === false ? [] : [button('Undo last change', async () => { await context.command({ type: 'undo' }); await refresh(true); })]));
    root.replaceChildren(summary(), toolbar, rangeControls, chips, listHeading, reviewCopy.fallback, unknownNode, list, footer); renderList();
  }
  function renderList() {
    if (!current() || !model) return;
    paintVersion++; paintJobs = [];
    const list = listNode, count = countNode;
    const filtered = filterCompletedRows(model.rows, { query, attribution, sort: layout === 'recent' ? 'recent' : 'category' });
    const selection = selectCompletedRange(filtered, { range, from, to, now: context.now?.() ?? new Date() }), rows = selection.rows;
    count.textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? 'task' : 'tasks'}${rows.length === model.rows.length ? '' : ` of ${model.rows.length.toLocaleString()}`} · ${selection.label}`;
    unknownNode.hidden = !selection.unknownDates;
    unknownNode.textContent = selection.unknownDates ? `${selection.unknownDates.toLocaleString()} ${selection.unknownDates === 1 ? 'completion has' : 'completions have'} no date${range === 'all' ? '' : ' · shown under All time'}` : '';
    rangeErrorNode.textContent = selection.error ?? ''; rangeErrorNode.hidden = !selection.error;
    reviewCopy.update(completedReviewList({ rows, players: activeOwners().map(owner => owner.name), range: selection.label, layout, plain, date }));
    list.replaceChildren();
    if (!rows.length) {
      const empty = el('div', undefined, 'completed-empty');
      empty.append(el('h3', model.rows.length ? 'No matching completed tasks' : 'No completed tasks yet'), el('p', selection.error || (model.rows.length ? `No completed tasks match ${selection.label} and the current filters.` : `No completed tasks in ${selection.label}. Tasks completed by either player will appear here.`)));
      if (query || attribution !== 'all' || range !== 'all') empty.append(button('Clear filters', () => { query = ''; attribution = 'all'; range = 'all'; rangePreference.set(range); draw(); }));
      list.append(empty); return;
    }
    if (layout === 'recent') { appendPaged(list, rows, 'completed tasks'); return; }
    for (const group of groupCompletedRows(rows)) {
      const section = el('details', undefined, 'completed-category'); section.open = !collapsed.has(group.category);
      const heading = el('summary'), text = el('span', group.category), tally = el('span', String(group.count), 'completed-category-tally');
      heading.append(text, tally); context.categoryIconPainter?.append(text, group.category); section.append(heading);
      const contents = el('div', undefined, 'completed-category-rows'); section.append(contents); list.append(section);
      let painted = false;
      const paint = () => { if (!painted && section.open) { painted = true; appendPaged(contents, group.rows, group.category); } };
      section.addEventListener('toggle', () => { if (section.open) collapsed.delete(group.category); else collapsed.add(group.category); paint(); }); paint();
    }
  }
  function appendPaged(host, rows, name) {
    let shown = 0;
    const more = button('', () => { more.remove(); append(); }, 'completed-more');
    const append = () => {
      const stop = Math.min(shown + PAGE_SIZE, rows.length);
      for (; shown < stop; shown++) { const row = rows[shown]; enqueuePaint(() => host.append(rowView(row))); }
      if (shown < rows.length) { more.textContent = `Show more ${name} (${rows.length - shown})`; enqueuePaint(() => host.append(more)); }
    };
    append();
  }
  function rowView(row) {
    const task = row.task, labelText = plain(task.label), host = el('article', undefined, 'completed-row'); host.dataset.taskId = task.id;
    const body = el('div', undefined, 'completed-task'); context.taskIconPainter?.append(body, task);
    const owner = selected === 'both' ? context.memberId() : selected;
    const copy = el('div', undefined, 'completed-copy'), label = button(labelText, async () => {
      const snapshot = context.state(), source = results.get(`${snapshot.revision}:${owner}`);
      await context.showTask(task, source?.format !== 'play-v1', { memberId: owner, result: source,
        loadResult: () => detailsFor(owner, snapshot),
        onReturn: () => { generation = context.openDialog('Completed Tasks', root); refresh(true); } });
    }, 'completed-task-label');
    copy.append(label, el('span', `${row.category}${task.level && !(task.record?.RequirementAlternatives && task.level === 1) && !(task.generated && task.category === 'BiS') ? ` · Level ${task.level}` : ''}`, 'completed-task-meta'));
    body.append(copy); host.append(body);
    const evidence = el('div', undefined, 'completed-evidence');
    for (const completion of row.completions) {
      const name = completion.name ?? completion.memberName;
      const how = `Done by ${name} (${completion.kind === 'ticked' ? 'ticked' : completion.source === 'runemetrics' ? 'in-game, RuneMetrics' : completion.source === 'game-plugin' ? 'in-game, Game plugin' : 'in-game'})`;
      const detail = el('div', undefined, 'completed-attribution');
      detail.append(el('span', how), el('span', `${date(completion.at)}${completion.imported ? ' · Imported from original picker' : ''}`, 'completed-task-meta'));
      evidence.append(detail);
    }
    host.append(evidence);
    if (context.canWrite?.() === false) return host;
    const actions = el('div', undefined, 'completed-actions');
    const ticks = row.completions.filter(value => value.kind === 'ticked');
    for (const completion of ticks) {
      const name = completion.name ?? completion.memberName;
      const untick = button(ticks.length > 1 ? `Untick ${name}` : 'Untick', () => confirmUntick(host, row, completion), 'completed-untick');
      untick.setAttribute('aria-label', `Untick ${labelText} for ${name}`); untick.title = `Untick for ${name}`; untick.disabled = busy || context.isSandbox?.(); actions.append(untick);
    }
    const backlogged = context.state().members.find(value => value.id === owner)?.taskStatus?.[task.id]?.backlogged;
    const ownerName = members().find(value => value.id === owner)?.name ?? owner;
    const backlog = button(backlogged ? 'Restore backlog' : 'Backlog', async () => {
      if (backlogged) { await context.command({ type: 'set-task-status', memberId: owner, taskId: task.id, backlogged: false }); await refresh(true); }
      else context.backlogForm(host, task, () => refresh(true), owner);
    });
    backlog.setAttribute('aria-label', `${backlogged ? 'Restore' : 'Backlog'} ${labelText} for ${ownerName}…`); backlog.disabled = busy || context.isSandbox?.(); actions.append(backlog);
    host.append(actions); return host;
  }
  function confirmUntick(host, row, completion) {
    confirmationNode?.remove();
    const confirmation = el('div', undefined, 'completed-confirm'), snapshot = context.state(), name = completion.name ?? completion.memberName;
    confirmationNode = confirmation;
    confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'Confirm untick');
    confirmation.append(el('p', `Remove ${name}’s tick for ${plain(row.task.label)}? Undo can restore it.`));
    const confirm = button(`Untick for ${name}`, async () => {
      confirm.disabled = true;
      try { await context.command({ type: 'set-task-status', memberId: completion.memberId, taskId: completion.taskId, challengeCompleted: false }, snapshot.revision); await refresh(true); }
      catch (error) { confirm.disabled = false; context.showError(error); }
    }, 'completed-confirm-action');
    confirmation.append(confirm, button('Cancel', () => confirmation.remove())); host.append(confirmation); confirm.focus?.();
  }
  async function open(memberId = context.memberId()) {
    if (context.isReviewReady && !context.isReviewReady()) throw new Error('Exit Sandbox to review saved completed tasks.');
    selected = memberId; query = ''; attribution = 'all'; range = rangePreference.get(); model = undefined; revision = undefined; collapsed.clear();
    results.clear(); root = el('div', undefined, 'completed-view');
    reviewCopy = createCompletedReviewCopy({ document, getClipboard: context.getClipboard });
    generation = context.openDialog('Completed Tasks', root); await refresh(true);
  }
  return { open, refresh };
}
