import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCopyList } from '../app/web/copy-list-model.mjs';

const defaults = { player: 'Player', title: 'Unlocked chunks', date: '2026-10-12' };
const format = (groups, extra = {}) => formatCopyList({ ...defaults, groups, ...extra });

test('chunks have a plain header, count, date and ordered bullets without a group label', () => {
  assert.deepEqual(format([{ items: ['Lumbridge (12850)', 'Draynor (12339)'] }]), {
    text: 'Player — Unlocked chunks (2) — 2026-10-12\n- Lumbridge (12850)\n- Draynor (12339)',
    count: 2, copiedCount: 2, omittedCount: 0,
  });
});

test('task categories and their items retain supplied order, omitting empty groups', () => {
  const result = format([
    { label: 'Quests', items: ['Druidic Ritual', 'Ernest the Chicken'] },
    { label: 'Empty', items: [] },
    { label: 'Skills', items: ['Mine copper'] },
  ], { title: 'Active tasks' });
  assert.equal(result.text, 'Player — Active tasks (3) — 2026-10-12\n\nQuests:\n- Druidic Ritual\n- Ernest the Chicken\n\nSkills:\n- Mine copper');
  assert.equal(result.count, 3);
});

test('an empty list includes only its zero-count header', () => {
  assert.deepEqual(format([{ label: 'Empty', items: [] }]), {
    text: 'Player — Unlocked chunks (0) — 2026-10-12',
    count: 0, copiedCount: 0, omittedCount: 0,
  });
});

test('completion review headers name players and range while complete exports retain every task', () => {
  const items = Array.from({ length: 100 }, (_, index) => `Completed task ${index}`);
  const list = format([{ items }], { title: 'Completed', player: 'Player & Reed', range: 'last 7 days', limit: Infinity });
  assert.match(list.text, /^Player & Reed · Completed · last 7 days · 100 tasks\n/);
  assert.equal(list.copiedCount, 100); assert.equal(list.omittedCount, 0); assert.ok(list.text.endsWith('- Completed task 99'));
  assert.equal(format([], { title: 'Completed', range: 'today' }).text, 'Player · Completed · today · 0 tasks');
});

test('a full item fitting the exact 2000-character boundary is copied', () => {
  const header = format([{ items: ['x'] }]).text.split('\n')[0];
  const item = 'x'.repeat(2000 - header.length - 3);
  const result = format([{ items: [item] }]);
  assert.equal(result.text.length, 2000);
  assert.equal(result.copiedCount, 1);
  assert.equal(result.omittedCount, 0);
  assert.ok(result.text.endsWith(item));
});

test('one character over the limit omits the entire item', () => {
  const header = format([{ items: ['x'] }]).text.split('\n')[0];
  const result = format([{ items: ['x'.repeat(2001 - header.length - 3)] }]);
  assert.equal(result.text, `${header}\n…and 1 more`);
  assert.equal(result.copiedCount, 0);
  assert.equal(result.omittedCount, 1);
});

test('a full list fitting exactly is kept even if a temporary omission suffix would overflow', () => {
  const header = format([{ items: ['x', 'y'] }]).text.split('\n')[0];
  const item = 'x'.repeat(2000 - header.length - 7);
  const result = format([{ items: [item, 'y'] }]);
  assert.equal(result.text.length, 2000);
  assert.equal(result.copiedCount, 2);
  assert.equal(result.omittedCount, 0);
  assert.ok(result.text.endsWith(`\n- ${item}\n- y`));
});

test('the omission suffix fits exactly and reports the complete remaining prefix', () => {
  const header = format([{ items: ['x', 'y'] }]).text.split('\n')[0];
  const suffix = '\n…and 1 more';
  const item = 'x'.repeat(2000 - header.length - 3 - suffix.length);
  const result = format([{ items: [item, 'y'.repeat(30)] }]);
  assert.equal(result.text, `${header}\n- ${item}${suffix}`);
  assert.equal(result.text.length, 2000);
  assert.equal(result.copiedCount, 1);
  assert.equal(result.omittedCount, 1);
});

test('trimming stops at a category boundary without copying a dangling heading', () => {
  const result = format([
    { label: 'Quests', items: ['Druidic Ritual'] },
    { label: 'Skills', items: ['x'.repeat(2000), 'Mine copper'] },
    { label: 'Achievements', items: ['Visit Varrock'] },
  ]);
  assert.equal(result.text, 'Player — Unlocked chunks (4) — 2026-10-12\n\nQuests:\n- Druidic Ritual\n…and 3 more');
  assert.equal(result.copiedCount, 1);
  assert.equal(result.omittedCount, 3);
});

test('a large first item prevents smaller later items from being copied', () => {
  const result = format([{ items: ['x'.repeat(3000), 'small', 'also small'] }]);
  assert.ok(result.text.endsWith('\n…and 3 more'));
  assert.equal(result.copiedCount, 0);
});

test('huge header fields stay bounded even when escaping doubles their length', () => {
  const result = format([{ items: ['Short item'] }], {
    player: '*'.repeat(5000), title: '@'.repeat(5000), date: '`'.repeat(5000),
  });
  assert.ok(result.text.length <= 2000);
  assert.equal(result.copiedCount, 1);
  assert.ok(result.text.endsWith('\n- Short item'));
});

test('huge group headings omit their items whole', () => {
  const result = format([{ label: 'a'.repeat(3000), items: ['Small item'] }]);
  assert.ok(result.text.endsWith('\n…and 1 more'));
  assert.equal(result.copiedCount, 0);
});

test('emoji item labels remain intact and count as UTF-16 code units at the boundary', () => {
  const header = format([{ items: ['x'] }]).text.split('\n')[0];
  const available = 2000 - header.length - 3;
  const item = '😀'.repeat(Math.floor(available / 2)) + (available % 2 ? 'x' : '');
  const fitting = format([{ items: [item] }]);
  assert.equal(fitting.text.length, 2000);
  assert.equal(fitting.copiedCount, 1);
  assert.ok(fitting.text.endsWith(item));
  const overflowing = format([{ items: [`${item}😀`] }]);
  assert.equal(overflowing.copiedCount, 0);
  assert.ok(!overflowing.text.includes('😀'));
});

test('bounded emoji headers never split surrogate pairs', () => {
  const result = format([], { player: `a${'😀'.repeat(2000)}` });
  assert.ok(result.text.isWellFormed());
  assert.ok(result.text.startsWith(`a${'😀'.repeat(49)} —`));
});

test('all plain text fields normalize whitespace, escape markdown and neutralize mentions', () => {
  const result = format([{ label: '  **Tasks**\n@here ', items: [' \t`code` _a_ ~~b~~ ||c|| \\ [link] <@123> @everyone\nnext  '] }], {
    player: '  Player\n**GIM** ', title: '  Tasks\tlist ', date: ' 2026-10-12\n',
  });
  assert.equal(result.text,
    'Player \\*\\*GIM\\*\\* — Tasks list (1) — 2026-10-12\n\n\\*\\*Tasks\\*\\* @\u200bhere:\n- \\`code\\` \\_a\\_ \\~\\~b\\~\\~ \\|\\|c\\|\\| \\\\ \\[link\\] \\<@\u200b123\\> @\u200beveryone next');
  assert.ok(!result.text.includes('@everyone'));
  assert.ok(!result.text.includes('<@123>'));
});

test('formatting is deterministic and leaves deeply frozen inputs unchanged', () => {
  const input = Object.freeze({
    ...defaults,
    groups: Object.freeze([Object.freeze({ label: 'Skills', items: Object.freeze(['Mine copper', 'Fish shrimp']) })]),
  });
  const before = JSON.stringify(input);
  assert.deepEqual(formatCopyList(input), formatCopyList(input));
  assert.equal(JSON.stringify(input), before);
});
