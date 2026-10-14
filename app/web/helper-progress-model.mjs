const DAY = 86400000;
export const progressMetrics = Object.freeze([
  ['unlockedChunks', 'Chunks unlocked'], ['completedTasks', 'Tasks completed'],
  ['questPoints', 'Quest points'], ['totalLevel', 'Total level'], ['combatLevel', 'Combat level'],
]);
export function progressDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
const numeric = value => Number.isFinite(value) ? value : null;
const metricsFor = (point, scope) => scope === 'duo' ? point.duo?.metrics : point.members?.find(row => row.memberId === scope)?.metrics;
const monday = at => { const date = new Date(at); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); return date.toISOString().slice(0, 10); };

/** Only saved counts and dated observations enter the graphs. A missing account
 * observation remains a gap, and the first count is never counted as an earn. */
export function progressSeries(model, scope) {
  const records = [...(model.history?.points ?? []), ...(model.daily?.points ?? []),
    { at: model.generatedAt, ...model.current }]
    .filter(point => Number.isFinite(Date.parse(point.at)) && metricsFor(point, scope))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.revision ?? Infinity) - (b.revision ?? Infinity));
  const unique = new Map();
  for (const record of records) unique.set(`${record.at}:${record.revision ?? 'daily'}`, record);
  const points = [...unique.values()].map(point => ({ at: point.at, metrics: metricsFor(point, scope) }));
  const observed = (model.datedRecords ?? []).filter(row => row.memberId === scope && Number.isFinite(Date.parse(row.at)));
  const trends = key => {
    const rows = [...points.map(point => ({ at: point.at, value: numeric(point.metrics[key]) })),
      ...observed.filter(row => Object.hasOwn(row.metrics, key)).map(row => ({ at: row.at, value: numeric(row.metrics[key]) }))]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const byTime = new Map(); for (const row of rows) byTime.set(row.at, row);
    return [...byTime.values()];
  };
  const weeks = new Map();
  if (points.length) {
    const firstWeek = monday(points[0].at), lastWeek = monday(model.generatedAt);
    for (let at = Math.max(Date.parse(firstWeek), Date.parse(lastWeek) - DAY * 7 * 529); at <= Date.parse(lastWeek); at += DAY * 7) {
      const week = new Date(at).toISOString().slice(0, 10);
      weeks.set(week, { week, unlockedChunks: 0, completedTasks: 0, questPoints: 0, partial: week === firstWeek });
    }
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1], point = points[index], row = weeks.get(monday(point.at));
      if (!row) continue;
      for (const key of ['unlockedChunks', 'completedTasks', 'questPoints']) {
        if (numeric(previous.metrics[key]) === null || numeric(point.metrics[key]) === null) row[key] = null;
        else if (row[key] !== null) row[key] += point.metrics[key] - previous.metrics[key];
      }
    }
    if (points.length === 1) for (const key of ['unlockedChunks', 'completedTasks', 'questPoints']) weeks.get(firstWeek)[key] = null;
    // No zero-point recap can be claimed before quest points were recorded.
    for (const row of weeks.values()) {
      const latest = points.findLast(point => monday(point.at) <= row.week);
      if (numeric(latest?.metrics.questPoints) === null) row.questPoints = null;
    }
  }
  const weekly = [...weeks.values()], thisWeek = weekly.find(row => row.week === monday(model.generatedAt));
  const lastWeek = thisWeek ? weekly[weekly.indexOf(thisWeek) - 1] : undefined;
  return { points, weekly, thisWeek, lastWeek, questPoints: trends('questPoints'), totalLevel: trends('totalLevel'),
    startsAt: points[0]?.at, weekStartsAt: thisWeek?.week };
}

const recapKeys = ['unlockedChunks', 'completedTasks', 'questPoints'];
const weekLine = (name, week) => {
  const amount = (value, label, plus = false) => value === null ? `${label} not recorded` : value < 0 ? `${(-value).toLocaleString()} fewer ${label}` : `${plus ? '+' : ''}${value.toLocaleString()} ${label}`;
  return `${name}: ${amount(week.unlockedChunks, 'chunks')}, ${amount(week.completedTasks, 'tasks')}, ${amount(week.questPoints, 'quest points', true)}${week.partial ? ' (since the first saved count)' : ''}.`;
};

/** A quiet current week also shows last week, so early-week recaps stay useful. */
export function progressRecap(week, lastWeek) {
  if (!week || recapKeys.every(key => week[key] === null)) return 'This week: there is not enough saved history to count changes yet.';
  const quiet = recapKeys.every(key => !week[key]), earlier = lastWeek && recapKeys.some(key => lastWeek[key]);
  return quiet && earlier ? `${weekLine('This week', week)} ${weekLine('Last week', lastWeek)}` : weekLine('This week', week);
}
