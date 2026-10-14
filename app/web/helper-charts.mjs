const NS = 'http://www.w3.org/2000/svg';
const node = (document, tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function shape(document, tag, attributes, text) { const n = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value)); if (text !== undefined) n.textContent = text; return n; }
export function levelChart(document, rows) {
  const visible = rows.filter(row => row.targetLevel !== null), height = 52 + visible.length * 43;
  const svg = shape(document, 'svg', { viewBox: `0 0 680 ${height}`, role: 'img', 'aria-label': 'Current skill levels and highest active task levels', class: 'helper-chart' });
  svg.append(shape(document, 'title', {}, 'Current level compared with active task level goals'));
  const scale = level => 190 + level / 120 * 360;
  for (const level of [1, 30, 60, 90, 120]) {
    svg.append(shape(document, 'line', { x1: scale(level), x2: scale(level), y1: 28, y2: height - 12, class: 'helper-gridline' }),
      shape(document, 'text', { x: scale(level), y: 16, 'text-anchor': 'middle', class: 'helper-chart-muted' }, level));
  }
  visible.forEach((row, index) => {
    const y = 44 + index * 43;
    svg.append(shape(document, 'text', { x: 0, y: y + 7 }, row.skill),
      shape(document, 'line', { x1: 190, x2: scale(row.targetLevel), y1: y + 8, y2: y + 8, class: 'helper-target-line' }),
      shape(document, 'rect', { x: 190, y: y - 1, width: Math.max(0, scale(row.currentLevel ?? 0) - 190), height: 7, class: 'helper-current-bar' }),
      shape(document, 'circle', { cx: scale(row.targetLevel), cy: y + 8, r: 4, class: 'helper-target-dot' }),
      shape(document, 'text', { x: 565, y: y + 7 }, `${row.currentLevel ?? '?'} / ${row.targetLevel}`));
  });
  return svg;
}
export function chanceChart(document, data) {
  const svg = shape(document, 'svg', { viewBox: '0 0 680 230', role: 'img', 'aria-label': 'Chance of at least one drop as kills increase', class: 'helper-chart' });
  svg.append(shape(document, 'title', {}, 'Independent drop chance over repeated kills'));
  const maximum = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, data.kills, data.thresholds[2].kills ?? data.denominator * 4.61)), x = kills => 58 + kills / maximum * 590, y = chance => 185 - chance * 155;
  for (const percent of [0, 50, 90, 100]) svg.append(shape(document, 'line', { x1: 58, x2: 648, y1: y(percent / 100), y2: y(percent / 100), class: 'helper-gridline' }), shape(document, 'text', { x: 48, y: y(percent / 100) + 4, 'text-anchor': 'end' }, `${percent}%`));
  const points = Array.from({ length: 81 }, (_, i) => { const kills = maximum * i / 80; const chance = data.denominator === 1 ? (kills > 0 ? 1 : 0) : -Math.expm1(kills * Math.log1p(-1 / data.denominator)); return `${x(kills)},${y(chance)}`; }).join(' ');
  svg.append(shape(document, 'polyline', { points, fill: 'none', class: 'helper-chance-line' }), shape(document, 'circle', { cx: x(data.kills), cy: y(data.probability), r: 5, class: 'helper-target-dot' }),
    shape(document, 'text', { x: 58, y: 210 }, '0 kills'), shape(document, 'text', { x: 648, y: 210, 'text-anchor': 'end' }, `${Math.ceil(maximum).toLocaleString()} kills`));
  return svg;
}
export function dataTable(document, caption, columns, rows) {
  const wrap = node(document, 'div', undefined, 'helper-table-wrap'), table = node(document, 'table', undefined, 'helper-table');
  table.append(node(document, 'caption', caption));
  const head = node(document, 'thead'), heading = node(document, 'tr');
  for (const title of columns) { const th = node(document, 'th', title); th.scope = 'col'; heading.append(th); } head.append(heading); table.append(head);
  const body = node(document, 'tbody');
  for (const values of rows) { const tr = node(document, 'tr'); values.forEach((value, i) => { const cell = node(document, i === 0 ? 'th' : 'td', value); if (i === 0) cell.scope = 'row'; tr.append(cell); }); body.append(tr); } table.append(body); wrap.append(table); return wrap;
}

/** Null values break the line; the table retains every dated count. */
export function progressChart(document, rows, { title, bars = false }) {
  const svg = shape(document, 'svg', { viewBox: '0 0 680 260', role: 'img', 'aria-label': `${title}. Exact dates and values are in the table below.`, class: 'helper-chart helper-progress-chart' });
  svg.append(shape(document, 'title', {}, title));
  const values = rows.map(row => row.value).filter(value => Number.isFinite(value));
  if (!values.length) { svg.append(shape(document, 'text', { x: 340, y: 125, 'text-anchor': 'middle', class: 'helper-chart-muted' }, 'No saved counts yet')); return svg; }
  const minimum = Math.min(0, ...values), maximum = Math.max(minimum < 0 ? 0 : 1, ...values), y = value => 205 - (value - minimum) / (maximum - minimum) * 170;
  // Bars sit in equal weekly slots; lines keep true time spacing.
  const start = Date.parse(rows[0].at), end = Date.parse(rows.at(-1).at), slot = 570 / rows.length;
  const x = bars ? at => 70 + (rows.findIndex(row => row.at === at) + 0.5) * slot : at => start === end ? 350 : 70 + (Date.parse(at) - start) / (end - start) * 570;
  for (const value of [...new Set(minimum < 0 ? [minimum, 0, maximum] : [minimum, Math.round((minimum + maximum) / 2), maximum])]) {
    svg.append(shape(document, 'line', { x1: 70, x2: 640, y1: y(value), y2: y(value), class: 'helper-gridline' }), shape(document, 'text', { x: 55, y: y(value) + 5, 'text-anchor': 'end' }, value.toLocaleString()));
  }
  const stride = bars ? 1 : Math.max(1, Math.ceil(rows.length / 180)), shown = rows.filter((row, index) => index % stride === 0 || index === rows.length - 1 || row.value === null || rows[index - 1]?.value === null);
  let segment = [];
  const flush = () => { if (segment.length) svg.append(shape(document, 'polyline', { points: segment.join(' '), fill: 'none', class: 'helper-chance-line' })); segment = []; };
  for (const row of shown) {
    if (!Number.isFinite(row.value)) { flush(); continue; }
    const date = new Date(row.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    if (bars) {
      const width = Math.max(4, Math.min(56, slot * 0.6));
      const bar = shape(document, 'rect', { x: x(row.at) - width / 2, y: Math.min(y(0), y(row.value)), width, height: Math.max(1, Math.abs(y(row.value) - y(0))), class: 'helper-current-bar' });
      bar.append(shape(document, 'title', {}, `${date}: ${row.value.toLocaleString()}`)); svg.append(bar);
    } else {
      // Running totals hold their value until the next saved count.
      if (segment.length) segment.push(`${x(row.at)},${segment.at(-1).split(',')[1]}`);
      segment.push(`${x(row.at)},${y(row.value)}`);
      const dot = shape(document, 'circle', { cx: x(row.at), cy: y(row.value), r: 3, class: 'helper-target-dot' });
      dot.append(shape(document, 'title', {}, `${date}: ${row.value.toLocaleString()}`)); svg.append(dot);
    }
  }
  flush();
  const label = at => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bars && rows.length <= 6) {
    for (const row of rows) svg.append(shape(document, 'text', { x: x(row.at), y: 244, 'text-anchor': 'middle' }, label(row.at)));
  } else svg.append(shape(document, 'text', { x: 70, y: 244 }, label(rows[0].at)), shape(document, 'text', { x: 640, y: 244, 'text-anchor': 'end' }, label(rows.at(-1).at)));
  return svg;
}
