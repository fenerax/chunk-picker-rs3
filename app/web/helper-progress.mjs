import { dataTable, progressChart } from './helper-charts.mjs';
import { progressMetrics, progressDate, progressSeries, progressRecap } from './helper-progress-model.mjs';

export function renderProgress(host, { document, api, member, stateRevision, isCurrent, draft }) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const number = value => Number.isFinite(value) ? value.toLocaleString() : 'Not recorded';
  const controller = new AbortController(); let disposed = false, scope = draft?.scope ?? member.id;
  const heading = el('h2', 'Progress'), status = el('p', 'Loading saved progress…', 'helper-note'), content = el('div'); status.setAttribute('role', 'status');
  host.append(heading, el('p', 'Your maps, finished tasks and personal account progress, together in one place.', 'helper-intro'), status, content);
  function display(model) {
    const members = model.current.members;
    if (scope !== 'duo' && !members.some(row => row.memberId === scope)) scope = member.id;
    content.replaceChildren();
    const totals = dataTable(document, 'Saved totals for both players and the duo', ['Saved total', ...members.map(row => row.name), 'Duo'],
      progressMetrics.map(([key, label]) => [label, ...members.map(row => number(row.metrics[key])), number(model.current.duo.metrics[key])]));
    totals.className = 'helper-table-wrap helper-progress-totals';
    content.append(totals,
    el('p', 'Duo chunks and tasks count each shared one once. Quest points and levels add both accounts. A task tick does not grant quest points or levels. “Not recorded” means the picker has no complete saved account count.', 'helper-note'));
    const controls = el('div', undefined, 'helper-progress-controls'), label = el('label', 'Show graphs for'), selector = el('select'); selector.id = 'helper-progress-scope'; label.htmlFor = selector.id;
    for (const row of [...members.map(row => ({ id: row.memberId, name: row.name })), { id: 'duo', name: 'Duo' }]) { const option = el('option', row.name); option.value = row.id; selector.append(option); }
    selector.value = scope; label.append(selector); controls.append(label); content.append(controls);
    selector.addEventListener('change', () => { scope = selector.value; display(model); });
    const series = progressSeries(model, scope), name = scope === 'duo' ? 'Duo' : members.find(row => row.memberId === scope)?.name;
    content.append(el('h3', `${name} over time`), el('p', progressRecap(series.thisWeek, series.lastWeek), 'helper-answer helper-progress-recap'));
    const firstHistory = model.history.points[0]?.at, firstDaily = model.daily.points[0]?.at;
    const about = el('details', undefined, 'helper-progress-about'), note = (...nodes) => about.append(...nodes);
    about.append(el('summary', 'Where these numbers come from'));
    content.append(el('p', firstHistory ? `Graphs start ${progressDate(firstHistory)}, the oldest saved History entry.` : 'Graphs start with the first saved count.', 'helper-note'), about);
    note(el('p', firstHistory ? `Saved History starts ${progressDate(firstHistory)}. History keeps only about 150 recent entries, so earlier play is missing. The first week may be incomplete.` : 'There are no dated History counts yet. Earlier play is missing; the first saved total is a starting point.', 'helper-note'),
      el('p', firstDaily ? `Daily counts start ${progressDate(firstDaily)} and are included in your backup. Each day keeps the last saved counts, for up to 3,660 saved days (about ten years).` : 'Daily counts will start with this save and travel with your backup, for up to 3,660 saved days (about ten years).', 'helper-note'),
      el('p', 'Weeks start on Monday (UTC). The graphs show changes when they were saved or synced, which may be later than you played. Unticking, Undo, locking a chunk or restoring a backup can lower the counts.', 'helper-note'));
    if (model.history.boundary) note(el('p', 'Older History counts cannot be checked. Earlier daily counts and complete saved account syncs can still appear.', 'helper-note'));
    if (model.history.undatedEntries) note(el('p', `${model.history.undatedEntries} History entries have no usable date and are left out.`, 'helper-note'));
    if (model.daily.truncated) note(el('p', 'The oldest daily counts have reached the 3,660-day limit and are no longer kept.', 'helper-note'));
    const charts = el('div', undefined, 'helper-progress-charts');
    const chart = (title, rows, bars, note) => {
      const section = el('section'), details = el('details');
      section.append(el('h4', title), progressChart(document, rows, { title, bars }));
      if (note) section.append(el('p', note, 'helper-note'));
      const summary = el('summary', `Read ${title.toLowerCase()} as a table`);
      const table = () => dataTable(document, title, [bars ? 'Week starting (UTC)' : 'Saved date (UTC)', title], rows.map(row => [progressDate(row.at), number(row.value)]));
      details.append(summary);
      if (rows.length <= 200) details.append(table());
      else details.addEventListener('toggle', () => { details.replaceChildren(summary); if (details.open) details.append(table()); });
      section.append(details); charts.append(section);
    };
    chart('Chunks unlocked per week', series.weekly.map(row => ({ at: row.week, value: row.unlockedChunks })), true, 'Net changes in your saved map; the first week may be incomplete.');
    chart('Tasks completed per week', series.weekly.map(row => ({ at: row.week, value: row.completedTasks })), true, 'Net changes in saved task checks, counting each task once.');
    chart('Quest points over time', series.questPoints, false, 'Personal quest records only. Missing counts leave a gap.');
    chart('Total level over time', series.totalLevel, false, 'Complete saved skill observations only. Missing levels leave a gap.');
    content.append(charts);
  }
  function load() {
    status.textContent = 'Loading saved progress…';
    api('/api/helper-progress', undefined, controller.signal).then(model => {
      if (disposed || !isCurrent()) return;
      if (model.stateRevision !== stateRevision) { status.textContent = 'The save changed while loading progress. Wait for the picker to refresh, then reopen Progress.'; return; }
      status.textContent = `Saved counts as of ${progressDate(model.generatedAt)}.`; display(model);
    }).catch(error => {
      if (disposed || error.name === 'AbortError') return;
      status.textContent = `Could not load saved progress. ${error.message}`;
      const retry = el('button', 'Try again'); retry.type = 'button'; retry.addEventListener('click', () => { content.replaceChildren(); load(); }); content.replaceChildren(retry);
    });
  }
  load(); const dispose = () => { disposed = true; controller.abort(); content.replaceChildren(); };
  dispose.getDraft = () => ({ scope }); return dispose;
}
