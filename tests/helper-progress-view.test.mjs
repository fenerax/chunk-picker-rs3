import test from 'node:test';
import assert from 'node:assert/strict';
import { progressSeries, progressRecap } from '../app/web/helper-progress-model.mjs';
import { progressChart } from '../app/web/helper-charts.mjs';
import { renderProgress } from '../app/web/helper-progress.mjs';

const counts = (chunks, tasks, qp = 12, total = 800) => ({ unlockedChunks: chunks, completedTasks: tasks, questPoints: qp, totalLevel: total, combatLevel: 78 });
const point = (at, metrics, revision) => ({ at, revision, members: [{ memberId: 'm', name: 'Player', metrics }], duo: { metrics } });
const model = () => ({ stateRevision: 7, generatedAt: '2026-10-12T12:00:00Z',
  current: point('2026-10-12T12:00:00Z', counts(4, 10)),
  history: { points: [point('2026-10-11T12:00:00Z', counts(2, 3), 1), point('2026-10-12T10:00:00Z', counts(4, 10), 2)], undatedEntries: 0, boundary: null },
  daily: { points: [], truncated: false }, datedRecords: [] });
function dom() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, listener) { this.events[type] = listener; }
    dispatchEvent(event) { this.events[event.type]?.(event); }
  }
  return { host: new Node('div'), document: { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) } };
}
const walk = node => [node, ...node.children.flatMap(walk)];
const text = node => walk(node).map(child => child.textContent).join(' ');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('weekly changes use Monday UTC, preserve same-time before/after History and never count the initial total as gains', () => {
  const data = model();
  data.history.points = [point('2026-10-12T10:00:00Z', counts(2, 3), 1), point('2026-10-12T10:00:00Z', counts(4, 10), 2)];
  const series = progressSeries(data, 'm');
  assert.equal(series.thisWeek.week, '2026-10-12');
  assert.equal(series.thisWeek.unlockedChunks, 2);
  assert.equal(series.thisWeek.completedTasks, 7);
  assert.match(progressRecap(series.thisWeek), /2 chunks, 7 tasks, \+0 quest points.*first saved count/);
  const startOnly = model(); startOnly.history.points = [];
  assert.equal(progressSeries(startOnly, 'm').thisWeek.unlockedChunks, null);
  assert.match(progressRecap(progressSeries(startOnly, 'm').thisWeek), /not enough saved history/);
});

test('Undo and unticks are net negative, and missing quest observations never claim zero quest points earned', () => {
  const data = model(); data.current = point(data.generatedAt, counts(1, 2, null, null));
  data.history.points = [point('2026-10-11T12:00:00Z', counts(4, 10, null, null), 1), point('2026-10-12T10:00:00Z', counts(1, 2, null, null), 2)];
  const series = progressSeries(data, 'm');
  assert.equal(series.thisWeek.unlockedChunks, -3); assert.equal(series.thisWeek.completedTasks, -8); assert.equal(series.thisWeek.questPoints, null);
  assert.match(progressRecap(series.thisWeek), /3 fewer chunks, 8 fewer tasks, quest points not recorded/);
});

test('personal dated skill observations enter personal graphs without inventing duo observations', () => {
  const data = model(); data.datedRecords = [{ at: '2026-10-04T12:00:00Z', memberId: 'm', kind: 'skills', metrics: { totalLevel: 750 } }];
  assert.equal(progressSeries(data, 'm').totalLevel[0].value, 750);
  assert.equal(progressSeries(data, 'duo').totalLevel[0].value, 800);
});

test('SVG graphs keep gaps, describe their table, show negative bars and label an empty graph', () => {
  const h = dom(); const rows = [{ at: '2026-10-01', value: 10 }, { at: '2026-10-02', value: null }, { at: '2026-10-03', value: 20 }];
  const graph = progressChart(h.document, rows, { title: 'Quest points' });
  assert.equal(walk(graph).filter(node => node.tag === 'polyline').length, 2);
  assert.match(graph.attributes['aria-label'], /table below/);
  const bars = progressChart(h.document, [{ at: '2026-10-01', value: -2 }, { at: '2026-10-08', value: 5 }], { title: 'Chunks', bars: true });
  assert.ok(walk(bars).filter(node => node.tag === 'rect').every(node => Number(node.attributes.height) > 0));
  assert.match(text(progressChart(h.document, [{ at: '2026-10-01', value: null }], { title: 'Levels' })), /No saved counts/);
});

test('all weekly bars stay visible and an old History date never drops the latest week', () => {
  const h = dom(), rows = Array.from({ length: 181 }, (_, index) => ({ at: new Date(Date.UTC(2020, 0, 1) + index * 7 * 86400000).toISOString(), value: index % 2 }));
  assert.equal(walk(progressChart(h.document, rows, { title: 'Chunks', bars: true })).filter(node => node.tag === 'rect').length, 181);
  const data = model(); data.history.points[0].at = '2000-01-01T12:00:00Z';
  const series = progressSeries(data, 'm'); assert.equal(series.weekly.length, 530); assert.equal(series.thisWeek.week, '2026-10-12'); assert.equal(series.thisWeek.unlockedChunks, 2);
});

test('Progress reads once, renders all totals and four accessible tables, switches duo locally and never sends a command', async () => {
  const h = dom(), data = model(), before = structuredClone(data), reads = [];
  const dispose = renderProgress(h.host, { document: h.document, member: { id: 'm' }, stateRevision: 7, isCurrent: () => true,
    api: (path, body, signal) => { reads.push({ path, body, signal }); return Promise.resolve(data); } });
  await settle();
  assert.match(text(h.host), /Quest points.*Total level.*Combat level/);
  assert.equal(walk(h.host).filter(node => node.tag === 'svg').length, 4);
  assert.equal(walk(h.host).filter(node => node.tag === 'caption').length, 5);
  const selector = walk(h.host).find(node => node.tag === 'select'); selector.value = 'duo'; selector.dispatchEvent({ type: 'change' });
  assert.match(text(h.host), /Duo over time/); assert.equal(dispose.getDraft().scope, 'duo');
  assert.deepEqual(reads.map(({ path, body }) => ({ path, body })), [{ path: '/api/helper-progress', body: undefined }]);
  assert.deepEqual(data, before); dispose(); assert.equal(reads[0].signal.aborted, true);
});

test('Progress ignores stale revisions, aborted responses and offers a retry after a failed read', async () => {
  const h = dom(); let resolve; const data = model(); data.stateRevision = 8;
  const dispose = renderProgress(h.host, { document: h.document, member: { id: 'm' }, stateRevision: 7, isCurrent: () => true, api: () => new Promise(done => { resolve = done; }) });
  resolve(data); await settle(); assert.match(text(h.host), /save changed/); assert.equal(walk(h.host).filter(node => node.tag === 'svg').length, 0); dispose();
  const closed = dom(); let complete;
  const end = renderProgress(closed.host, { document: closed.document, member: { id: 'm' }, stateRevision: 7, isCurrent: () => true, api: () => new Promise(done => { complete = done; }) });
  end(); complete(model()); await settle(); assert.equal(walk(closed.host).filter(node => node.tag === 'svg').length, 0);
  const failed = dom(); let attempts = 0;
  const stop = renderProgress(failed.host, { document: failed.document, member: { id: 'm' }, stateRevision: 7, isCurrent: () => true, api: () => ++attempts === 1 ? Promise.reject(new Error('Offline')) : Promise.resolve(model()) });
  await settle(); const retry = walk(failed.host).find(node => node.tag === 'button'); assert.equal(retry.textContent, 'Try again'); retry.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(walk(failed.host).filter(node => node.tag === 'svg').length, 4); stop();
});
