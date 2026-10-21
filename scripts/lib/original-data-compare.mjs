import { isDeepStrictEqual as equal } from 'node:util';

const entries = value => Object.entries(value ?? {});
const escape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const plain = value => String(value).replace(/~\|([^|]+)\|~/g, '$1').replace(/\*+$/g, '');

/** Object order is immaterial to a data diff; array order remains meaningful. */
export function changedFields(before, after, prefix = '') {
  if (equal(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
    || Array.isArray(before) || Array.isArray(after)) return [prefix || '/'];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key => {
    const pointer = `${prefix}/${escape(key)}`;
    return Object.hasOwn(before, key) && Object.hasOwn(after, key)
      ? changedFields(before[key], after[key], pointer) : [pointer];
  });
}

export function diffRecords(before = {}, after = {}, label = key => plain(key)) {
  const added = [], removed = [], changed = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const row = { key, label: label(key) };
    if (!Object.hasOwn(before, key)) added.push({ ...row, after: after[key] });
    else if (!Object.hasOwn(after, key)) removed.push({ ...row, before: before[key] });
    else if (!equal(before[key], after[key])) changed.push({ ...row, before: before[key], after: after[key], fields: changedFields(before[key], after[key]) });
  }
  return { before: Object.keys(before).length, after: Object.keys(after).length, added, removed, changed };
}

function tasks(data) {
  return Object.fromEntries(entries(data.challenges).flatMap(([category, records]) =>
    entries(records).map(([label, record]) => [JSON.stringify([category, label]), record])));
}

function contents(data, field) {
  const result = new Map();
  const add = (name, location, value) => {
    if (!result.has(name)) result.set(name, {});
    result.get(name)[location] = value;
  };
  for (const [chunk, record] of entries(data.chunks)) {
    for (const [name, value] of entries(record[field])) add(name, `chunk:${chunk}`, value);
    for (const [section, part] of entries(record.Sections)) {
      for (const [name, value] of entries(part[field])) add(name, `chunk:${chunk}-${section}`, value);
    }
  }
  return { result, add };
}

function items(data) {
  const { result, add } = contents(data, 'Spawn');
  for (const [name, row] of entries(data.equipment)) add(name, 'equipment', row);
  for (const [name, row] of entries(data.objectItems)) add(name, 'objectItems', row);
  for (const [shop, stock] of entries(data.shopItems)) for (const [name, value] of entries(stock)) add(name, `shop:${shop}`, value);
  for (const [monster, drops] of entries(data.drops)) for (const [name, value] of entries(drops)) add(name, `drop:${monster}`, value);
  for (const [skill, methods] of entries(data.skillItems)) for (const [method, outputs] of entries(methods)) {
    for (const [name, value] of entries(outputs)) add(name, `skill:${skill}:${method}`, value);
  }
  for (const [table, rows] of entries(data.codeItems?.dropTables)) for (const [name, value] of entries(rows)) add(name, `table:${table}`, value);
  return Object.fromEntries(result);
}

function monsters(data) {
  const { result, add } = contents(data, 'Monster');
  for (const [name, value] of entries(data.drops)) add(name, 'drops', value);
  for (const [name, value] of entries(data.slayerMonsters)) add(name, 'slayer', value);
  for (const [name, value] of entries(data.codeItems?.monstersPlus)) add(name, 'alias', value);
  return Object.fromEntries(result);
}

function shops(data) {
  const { result, add } = contents(data, 'Shop');
  for (const [name, value] of entries(data.shopItems)) add(name, 'stock', value);
  return Object.fromEntries(result);
}

function skills(data) {
  return Object.fromEntries(entries(data.skillItems).flatMap(([skill, methods]) =>
    entries(methods).map(([method, value]) => [`${skill}: ${method}`, value])));
}

/** Entity views deliberately overlap: an updated drop may change an item and a
 * monster. Remaining top-level sections ensure no declarative changes vanish. */
export function compareOriginalData(before, after, beforeTaskMap = {}, afterTaskMap = {}) {
  const views = [
    ['tasks', 'Tasks', tasks, key => { const [category, label] = JSON.parse(key); return `${category}: ${plain(label)}`; }],
    ['chunks', 'Chunks and named areas', data => data.chunks ?? {}, key => `${key}: ${plain(after.chunks?.[key]?.Nickname ?? before.chunks?.[key]?.Nickname ?? key)}`],
    ['items', 'Items', items], ['monsters', 'Monsters', monsters], ['shops', 'Shops', shops],
    ['quests', 'Quests', data => data.quests ?? {}], ['skills', 'Skill outputs and methods', skills],
  ];
  const categories = views.map(([key, label, view, format]) => ({ key, label, ...diffRecords(view(before), view(after), format) }));
  const viewed = new Set(['challenges', 'chunks', 'equipment', 'objectItems', 'drops', 'slayerMonsters', 'shopItems', 'quests', 'skillItems']);
  const otherSections = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !viewed.has(key)).sort()
    .map(key => ({ key, ...diffRecords(Object.hasOwn(before, key) ? { value: before[key] } : {}, Object.hasOwn(after, key) ? { value: after[key] } : {}) }));
  const cursor = { before: beforeTaskMap.currentNextIndex ?? null, after: afterTaskMap.currentNextIndex ?? null };
  const withoutCursor = data => Object.fromEntries(entries(data).filter(([key]) => key !== 'currentNextIndex'));
  const taskMap = { ...diffRecords(withoutCursor(beforeTaskMap), withoutCursor(afterTaskMap)), cursor };
  const totals = Object.fromEntries(['added', 'removed', 'changed'].map(kind => [kind, categories.reduce((sum, row) => sum + row[kind].length, 0)]));
  return { categories, otherSections, taskMap, totals, definitionsChanged: !equal(before, after), taskMapChanged: !equal(beforeTaskMap, afterTaskMap) };
}
