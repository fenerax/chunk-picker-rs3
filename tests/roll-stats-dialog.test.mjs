import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenRollStats, renderRollStats, formatRollGap } from '../app/web/screen-roll-stats.mjs';

function node(tag, text = '', className = '') {
  return { tag, textContent: text, className, children: [], attributes: {},
    append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    replaceWith(next) { const siblings = this.parent.children; siblings[siblings.indexOf(this)] = next; next.parent = this.parent; } };
}
const row = (id, name, overrides = {}) => ({ id, name, totalUnlocked: 5, datedUnlocked: 0, unknownDateCount: 5,
  unlocksLast7Days: 0, averageIntervalMs: null, medianIntervalMs: null, longestGapMs: null, timeline: [], ...overrides });
const model = (overrides = {}) => ({ stateRevision: 7, asOf: '2026-10-12T12:00:00Z',
  members: [row('actor1', 'Player'), row('reed', 'Reed')], duo: row('duo', 'Duo'), ...overrides });
const all = root => [root, ...root.children.flatMap(all)];
function harness() {
  let generation = 0, content, response = async () => model();
  const calls = [], c = { state: { revision: 7 }, el: node,
    button: (label, action) => ({ ...node('button', label), action }),
    openDialog: (title, value) => { content = value; return ++generation; }, dialogCurrent: value => value === generation,
    api: path => { calls.push(path); return response(); } };
  createScreenRollStats(c);
  return { c, calls, respond: value => { response = value; }, close: () => generation++,
    get content() { return content; }, find: text => all(content).find(value => value.textContent === text) };
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('Roll stats is a read-only dialog with totals, missing dates and a semantic summary table', async () => {
  const h = harness(); await h.c.rollStatsDialog();
  assert.deepEqual(h.calls, ['/api/roll-stats?stateRevision=7']);
  assert.ok(h.find('No dated unlocks yet.')); assert.ok(h.find('Player: 5 chunks have no date.'));
  const nodes = all(h.content), table = nodes.find(value => value.tag === 'table');
  assert.ok(table.children.some(value => value.tag === 'caption' && value.textContent === 'Unlock summary'));
  assert.equal(nodes.filter(value => value.tag === 'th' && value.attributes.scope === 'row').length, 5);
  assert.ok(h.find('Chunks unlocked')); assert.ok(h.find('Last 7 days'));
  assert.ok(!nodes.some(value => ['input', 'select', 'button'].includes(value.tag)));
});

test('SVG uses step geometry and CSS classes, with caption and text alternatives', () => {
  const timeline = [{ at: '2026-10-10T12:00:00Z', unlocked: 1 }, { at: '2026-10-11T12:00:00Z', unlocked: 2 }];
  const c = { el: node }, document = { createElementNS: (namespace, tag) => { assert.equal(namespace, 'http://www.w3.org/2000/svg'); return node(tag); } };
  const panel = renderRollStats(c, model({ members: [row('actor1', 'Player', { datedUnlocked: 2, timeline }), row('reed', 'Reed')],
    duo: row('duo', 'Duo', { datedUnlocked: 2, timeline }) }), document);
  const nodes = all(panel), chart = nodes.find(value => value.tag === 'svg');
  assert.equal(chart.attributes.viewBox, '0 0 360 220'); assert.equal(chart.attributes.role, 'img');
  assert.match(chart.attributes['aria-labelledby'], /roll-stats-caption/);
  assert.ok(nodes.some(value => value.tag === 'desc' && value.textContent.includes('distinct chunks')));
  const paths = nodes.filter(value => value.tag === 'path'); assert.equal(paths.length, 3);
  assert.equal(paths[1].attributes.d, 'M36 174 H348');
  for (const path of paths) { assert.match(path.attributes.d, /^M36 174 H\d/); assert.match(path.attributes.class, /roll-stats-line/); }
  assert.ok(nodes.every(value => !Object.keys(value.attributes).some(key => /^(?:style|on|stroke|fill)/.test(key))));
  assert.ok(!nodes.some(value => value.tag === 'script'));
});

const chipper = { el: node, button: (label, action) => ({ ...node('button', label), action }) };
const svgDocument = { createElementNS: (namespace, tag) => node(tag) };
const withTimeline = timeline => model({ members: [row('actor1', 'Player', { datedUnlocked: timeline.length, timeline }), row('reed', 'Reed')],
  duo: row('duo', 'Duo', { datedUnlocked: timeline.length, timeline }) });

test('long histories can zoom the chart to the last 30 days without changing the table', () => {
  const timeline = [{ at: '2026-07-01T12:00:00Z', unlocked: 1 }, { at: '2026-08-01T12:00:00Z', unlocked: 4 }, { at: '2026-10-01T12:00:00Z', unlocked: 6 }];
  const panel = renderRollStats(chipper, withTimeline(timeline), svgDocument);
  const chips = all(panel).filter(value => value.tag === 'button');
  assert.deepEqual(chips.map(value => [value.textContent, value.attributes['aria-pressed']]), [['All time', 'true'], ['Last 30 days', 'false']]);
  chips[1].action();
  assert.deepEqual(chips.map(value => value.attributes['aria-pressed']), ['false', 'true']);
  const nodes = all(panel), paths = nodes.filter(value => value.tag === 'path');
  assert.equal(nodes.filter(value => value.tag === 'svg').length, 1);
  assert.ok(nodes.some(value => value.tag === 'title' && value.textContent === 'Unlocked chunks over the last 30 days'));
  // Player enters the window at 4 and Reed at 0, so the y axis spans 0..6; only the October unlock is drawn as a step.
  assert.match(paths[0].attributes.d, /^M36 78 H\d+(\.\d+)? V30 H348$/);
  assert.equal(paths[1].attributes.d, 'M36 174 H348');
  assert.ok(nodes.some(value => value.tag === 'th' && value.textContent === 'Last 7 days'));
  chips[0].action();
  assert.ok(all(panel).some(value => value.tag === 'title' && value.textContent === 'Unlocked chunks over time'));
});

test('short histories get no zoom chips', () => {
  const panel = renderRollStats(chipper, withTimeline([{ at: '2026-10-10T12:00:00Z', unlocked: 1 }]), svgDocument);
  assert.ok(!all(panel).some(value => value.tag === 'button'));
});

test('closed or changed-save dialogs discard delayed stats and offer refresh for revision conflicts', async () => {
  for (const reason of ['closed', 'changed', 'response']) {
    const h = harness(), pending = deferred(); h.respond(() => pending.promise);
    const loading = h.c.rollStatsDialog();
    if (reason === 'closed') h.close(); else if (reason === 'changed') h.c.state.revision++;
    pending.resolve(model({ stateRevision: reason === 'response' ? 8 : 7 })); await loading;
    assert.ok(!all(h.content).some(value => value.tag === 'table'));
    if (reason !== 'closed') assert.ok(h.find('Refresh roll stats'));
  }
  const h = harness(); h.respond(async () => { throw Object.assign(new Error('internal detail'), { status: 409 }); });
  await h.c.rollStatsDialog(); assert.ok(h.find('Refresh roll stats'));
});

test('failed reads show a plain retry and do not expose internal errors', async () => {
  const h = harness(); h.respond(async () => { throw new Error('C:\\private\\save'); });
  await h.c.rollStatsDialog(); assert.ok(h.find('Retry roll stats'));
  assert.ok(!all(h.content).some(value => value.textContent.includes('private')));
  h.respond(async () => model()); await h.find('Retry roll stats').action(); assert.ok(h.find('Unlock summary'));
});

test('gap wording covers absent intervals, simultaneous unlocks and short/long waits', () => {
  assert.equal(formatRollGap(null), '—'); assert.equal(formatRollGap(0), '0 min');
  assert.equal(formatRollGap(1000), '<1 min'); assert.equal(formatRollGap(5 * 60000), '5 min');
  assert.equal(formatRollGap(90 * 60000), '1.5 h'); assert.equal(formatRollGap(3 * 86400000), '3 days');
  assert.equal(formatRollGap(86400000), '1 day');
});
