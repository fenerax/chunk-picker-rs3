// Count source-input exposure only. No save access, output names or gameplay writes.
import { createHash } from 'node:crypto';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { loadDatasetInputs } from '../../app/dataset-bootstrap.mjs';
import { parseDropRate } from '../../app/tasks/rates.mjs';
import { createCollectionEngine } from '../../app/tasks/collection.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
const rarity = rate => /^(?:common|uncommon|rare|very rare)$/i.test(String(rate).trim());
const rare = rate => /^(?:rare|very rare)$/i.test(String(rate).trim());
const rows = value => typeof value === 'string' ? [[value.split('@')[1] ?? '1', value.split('@')[0]]] : entries(value);
const { definitionBytes } = await loadDatasetInputs(selectedDataset, { loadTaskMap: false });
const definitions = JSON.parse(definitionBytes);
const tables = definitions.codeItems?.dropTables ?? {};
const report = { inputSha256: createHash('sha256').update(definitionBytes).digest('hex'), inputBytes: definitionBytes.length, stored: {} };
for (const [section, sources] of Object.entries({ monsters: definitions.drops, sharedTables: tables,
  skills: Object.fromEntries(entries(definitions.skillItems).flatMap(([category, sources]) => entries(sources).map(([name, table]) => [`${category}\0${name}`, table]))),
  objects: definitions.objectItems })) {
  const count = { rows: 0, unknown: 0, rarityWords: 0, rareWords: 0 };
  for (const [, table] of entries(sources)) for (const [, values] of entries(table)) for (const [, rate] of rows(values)) {
    count.rows++;
    if (parseDropRate(rate) === null) count.unknown++;
    if (rarity(rate)) count.rarityWords++;
    if (rare(rate)) count.rareWords++;
  }
  report.stored[section] = count;
}
const affectedItems = new Set(), rarityItems = new Set(), unknownItems = new Set();
const paths = { rows: 0, unknown: 0, rarityWords: 0, rareWords: 0 };
function expand(table, category, seen = [], flags = {}) {
  for (const [item, values] of entries(table)) for (const [, rate] of rows(values)) {
    const next = { unknown: flags.unknown || parseDropRate(rate) === null, rarityWords: flags.rarityWords || rarity(rate), rareWords: flags.rareWords || rare(rate) };
    const nested = definitions.skillItems?.[category]?.[item] ?? tables[item];
    if (nested) {
      if (!seen.includes(item)) expand(nested, category, [...seen, item], next);
      continue;
    }
    if (/DropTable/.test(item)) continue;
    const name = item.replaceAll('*', '');
    paths.rows++;
    if (next.unknown) { paths.unknown++; unknownItems.add(name); }
    if (next.rarityWords) { paths.rarityWords++; rarityItems.add(name); }
    if (next.rareWords) { paths.rareWords++; affectedItems.add(name); }
  }
}
for (const [, table] of entries(definitions.drops)) expand(table);
for (const [category, sources] of entries(definitions.skillItems)) for (const [, table] of entries(sources)) expand(table, category);
report.expandedMonsterAndSkillPaths = paths;
report.items = { unknown: unknownItems.size, rarityWords: rarityItems.size, rareWords: affectedItems.size };
const aliases = definitions.codeItems?.itemsPlus ?? {};
function alternatives(token) {
  const clean = String(token).replaceAll('*', ''), match = /^(.*\[\+\])(?:x(\d+))?$/.exec(clean);
  if (!match) return [clean];
  const exact = aliases[match[1]];
  if (exact) return list(exact);
  const same = Object.keys(aliases).filter(key => key.toLowerCase() === match[1].toLowerCase());
  return same.length === 1 ? list(aliases[same[0]]) : [clean];
}
const tasks = { unknown: 0, rarityWords: 0, rareWords: 0 };
for (const [, records] of entries(definitions.challenges)) for (const [, record] of entries(records)) {
  const inputs = list(record.Items).flatMap(alternatives);
  for (const [key, items] of [['unknown', unknownItems], ['rarityWords', rarityItems], ['rareWords', affectedItems]]) if (inputs.some(item => items.has(item))) tasks[key]++;
}
report.directInputTaskCandidates = tasks;
const collection = { total: 0, unknown: 0, rarityWords: 0, rareWords: 0 };
for (const task of createCollectionEngine(definitions).catalogue) {
  if (!['every-drop', 'all-droptables'].includes(task.objectiveKind)) continue;
  collection.total++;
  const rates = task.aliases.map(alias => /\(([^()]*)\)$/.exec(decodeURIComponent(alias))?.[1]).filter(value => value !== undefined);
  if (rates.some(rate => parseDropRate(rate) === null)) collection.unknown++;
  if (rates.some(rate => rate.split(' × ').some(rarity))) collection.rarityWords++;
  if (rates.some(rate => rate.split(' × ').some(rare))) collection.rareWords++;
}
report.collectionTaskCandidates = collection;
console.log(JSON.stringify(report, null, 2));
