const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000, MONTH_MS = 30 * DAY_MS;

export function formatRollGap(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return '—';
  if (milliseconds === 0) return '0 min';
  if (milliseconds < 60000) return '<1 min';
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(milliseconds / 3600000 * 10) / 10;
  if (hours < 24) return `${hours.toLocaleString()} h`;
  // Tenths only help for short gaps; 481.8 days reads better as 482.
  const days = milliseconds < 10 * 86400000 ? Math.round(milliseconds / 86400000 * 10) / 10 : Math.round(milliseconds / 86400000);
  return `${days.toLocaleString()} ${days === 1 ? 'day' : 'days'}`;
}

// All presentation styling lives in roll-stats.css; SVG attributes are geometry only.
export function renderRollStats(c, model, document = globalThis.document) {
  const panel = c.el('div', undefined, 'roll-stats-panel');
  const series = [...model.members, model.duo];
  const className = index => index === series.length - 1 ? 'roll-stats-duo' : `roll-stats-player-${index % 4}`;
  const figure = c.el('figure', undefined, 'roll-stats-figure');
  const caption = c.el('figcaption', 'Dated unlocks that are still unlocked. Totals include chunks with no date.');
  caption.id = 'roll-stats-caption';
  const legend = c.el('ul', undefined, 'roll-stats-legend');
  series.forEach((row, index) => {
    const item = c.el('li'), key = c.el('span', undefined, `roll-stats-key ${className(index)}`);
    key.setAttribute('aria-hidden', 'true'); item.append(key, c.el('span', row.name)); legend.append(item);
  });
  const dates = series.flatMap(row => row.timeline.map(point => Date.parse(point.at))).filter(Number.isFinite);
  if (dates.length) {
    const svg = (tag, attributes = {}, text) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const first = Math.min(...dates), last = Math.max(...dates);
    const end = Math.max(last, Date.parse(model.asOf) || last, first + DAY_MS);
    const drawChart = range => {
      const chart = svg('svg', { viewBox: '0 0 360 220', role: 'img', 'aria-labelledby': 'roll-stats-title roll-stats-caption', class: 'roll-stats-chart' });
      chart.append(svg('title', { id: 'roll-stats-title' }, range === 'month' ? 'Unlocked chunks over the last 30 days' : 'Unlocked chunks over time'),
        svg('desc', {}, 'Step lines count dated chunks still unlocked for each player and distinct chunks for the duo. See the unlock summary table for totals and gaps.'));
      const start = range === 'month' ? end - MONTH_MS : first;
      // A zoomed window starts each line at its count on the window's first day, and fits the y axis to the window.
      const lines = series.map(row => {
        const points = row.timeline.map(point => ({ at: Date.parse(point.at), unlocked: point.unlocked })).filter(point => Number.isFinite(point.at));
        return { from: points.filter(point => point.at < start).at(-1)?.unlocked ?? 0, points: points.filter(point => point.at >= start) };
      });
      const floor = range === 'month' ? Math.min(...lines.map(line => line.from)) : 0;
      const maximum = Math.max(floor + 1, ...lines.flatMap(line => [line.from, ...line.points.map(point => point.unlocked)]));
      const x = at => 36 + (at - start) / (end - start) * 312;
      const y = count => 174 - (count - floor) / (maximum - floor) * 144;
      const coord = number => Number(number.toFixed(2));
      const ticks = [...new Set([floor, Math.round((floor + maximum) / 2), maximum])];
      for (const tick of ticks) {
        chart.append(svg('line', { x1: 36, x2: 348, y1: coord(y(tick)), y2: coord(y(tick)), class: 'roll-stats-grid' }),
          svg('text', { x: 29, y: coord(y(tick) + 4), class: 'roll-stats-y-label' }, tick.toLocaleString()));
      }
      chart.append(svg('text', { x: 36, y: 15, class: 'roll-stats-axis-label' }, 'Chunks'));
      const dateLabel = at => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      chart.append(svg('text', { x: 36, y: 201, class: 'roll-stats-date-start' }, dateLabel(start)),
        svg('text', { x: 348, y: 201, class: 'roll-stats-date-end' }, dateLabel(end)));
      lines.forEach((line, index) => {
        let path = `M36 ${coord(y(line.from))}`;
        for (const point of line.points) path += ` H${coord(x(point.at))} V${coord(y(point.unlocked))}`;
        path += ' H348';
        chart.append(svg('path', { d: path, class: `roll-stats-line ${className(index)}` }));
      });
      return chart;
    };
    let chart = drawChart('all');
    // Zooming only helps once the history is longer than the window.
    if (end - first > MONTH_MS && c.button) {
      const ranges = c.el('div', undefined, 'roll-stats-ranges');
      ranges.setAttribute('role', 'group'); ranges.setAttribute('aria-label', 'Chart range');
      const choices = [['all', 'All time'], ['month', 'Last 30 days']].map(([range, label]) => {
        const choice = c.button(label, () => {
          const next = drawChart(range); chart.replaceWith(next); chart = next;
          for (const [other, value] of choices) other.setAttribute('aria-pressed', String(value === range));
        }, 'roll-stats-range');
        choice.setAttribute('aria-pressed', String(range === 'all'));
        return [choice, range];
      });
      ranges.append(...choices.map(([choice]) => choice));
      figure.append(ranges);
    }
    figure.append(chart, legend, caption);
  } else {
    figure.append(c.el('p', 'No dated unlocks yet.', 'status-detail'), caption);
  }
  panel.append(figure);
  const table = c.el('table', undefined, 'roll-stats-table');
  table.append(c.el('caption', 'Unlock summary'));
  const head = c.el('thead'), titles = c.el('tr');
  const metric = c.el('th', 'Measure'); metric.setAttribute('scope', 'col'); titles.append(metric);
  for (const row of series) { const title = c.el('th', row.name); title.setAttribute('scope', 'col'); titles.append(title); }
  head.append(titles); table.append(head);
  const body = c.el('tbody');
  for (const [label, value] of [
    ['Chunks unlocked', row => row.totalUnlocked.toLocaleString()],
    ['Average gap', row => formatRollGap(row.averageIntervalMs)],
    ['Median gap', row => formatRollGap(row.medianIntervalMs)],
    ['Longest gap', row => formatRollGap(row.longestGapMs)],
    ['Last 7 days', row => row.unlocksLast7Days.toLocaleString()],
  ]) {
    const tr = c.el('tr'), title = c.el('th', label); title.setAttribute('scope', 'row'); tr.append(title);
    for (const row of series) tr.append(c.el('td', value(row))); body.append(tr);
  }
  table.append(body); panel.append(table,
    c.el('p', 'Gaps only use unlocks with a date. Duo counts a chunk once, when the first of you unlocked it.', 'roll-stats-note'));
  const unknown = series.filter(row => row.unknownDateCount);
  if (unknown.length) {
    const list = c.el('ul', undefined, 'roll-stats-missing');
    for (const row of unknown) list.append(c.el('li', `${row.name}: ${row.unknownDateCount.toLocaleString()} ${row.unknownDateCount === 1 ? 'chunk has' : 'chunks have'} no date.`));
    panel.append(list);
  }
  return panel;
}

export function createScreenRollStats(c) {
  async function rollStatsDialog() {
    const revision = c.state.revision;
    const content = c.el('div'), status = c.el('p', 'Loading roll stats…', 'status-detail');
    status.setAttribute('role', 'status'); content.append(status);
    const generation = c.openDialog('Roll stats', content);
    const current = () => c.dialogCurrent(generation);
    const changed = () => content.replaceChildren(c.el('p', 'Your save changed. Refresh to see the latest roll stats.', 'status-detail'), c.button('Refresh roll stats', rollStatsDialog));
    try {
      const model = await c.api(`/api/roll-stats?stateRevision=${revision}`);
      if (!current()) return;
      if (revision !== c.state.revision || model.stateRevision !== revision) { changed(); return; }
      content.replaceChildren(renderRollStats(c, model));
    } catch (error) {
      if (!current()) return;
      if (revision !== c.state.revision || error.status === 409 || error.code === 'REVISION_CONFLICT') { changed(); return; }
      content.replaceChildren(c.el('p', 'Roll stats could not be loaded. Try again.', 'status-detail'), c.button('Retry roll stats', rollStatsDialog));
    }
  }
  Object.assign(c, { rollStatsDialog });
}
