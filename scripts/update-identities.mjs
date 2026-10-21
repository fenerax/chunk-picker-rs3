import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// New rows mint opaque tokens. Existing rows, aliases and removed rows survive
// regeneration. A rename must name the existing identity explicitly.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const definitionPath = resolve(option('--definitions') ?? `${root}/rs3-chunkpicker-chunkinfo-export.json`);
const defaultRegistryPath = resolve(`${root}/app/data/legacy-dataset-values.2026-10-13.v1.json`);
const registryPath = resolve(option('--registry') ?? defaultRegistryPath);
const registryKey = name => `app/data/identity-registry.mjs#${name}`;
let registryDocument;
const definitions = JSON.parse(await readFile(definitionPath, 'utf8'));
let previous;
try {
  if (registryPath === defaultRegistryPath) {
    registryDocument = JSON.parse(await readFile(registryPath, 'utf8'));
    previous = Object.fromEntries(['authoredTasks', 'authoredEntities', 'authoredGoals', 'authoredSources'].map(name => [name, registryDocument.values[registryKey(name)]]));
  } else previous = await import(`${pathToFileURL(registryPath)}?read=${Date.now()}`);
}
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; previous = {}; }
const tasks = structuredClone(previous.authoredTasks ?? []);
const entities = structuredClone(previous.authoredEntities ?? []);
// Generated objectives are recoverable from kind + canonical entity subjects.
// Only hand-reviewed exceptional aliases belong here; no full rate catalogue.
const goals = structuredClone(previous.authoredGoals ?? []);
const sources = structuredClone(previous.authoredSources ?? []);
const normalize = value => String(value).normalize('NFC');
const clean = value => normalize(value).replaceAll('*', '').replaceAll('[+]', '');
const lists = value => value == null ? [] : Array.isArray(value) ? value : [value];
const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
function mint(prefix, rows) {
  let next = rows.reduce((maximum, row) => Math.max(maximum, parseInt(row[0].split(':').at(-1), 16) || 0), 0) + 1;
  return () => `rs3:${prefix}:${(next++).toString(16).padStart(6, '0')}`;
}
const mintTask = mint('task', tasks), mintEntity = mint('entity', entities);
function applyRename(optionName, rows, task = false) {
  const position = args.indexOf(optionName);
  if (position < 0) return;
  const [id, kind, label] = args.slice(position + 1, position + 4);
  const row = rows.find(value => value[0] === id);
  if (!row || !kind || !label) throw new Error(`${optionName} needs an existing ID, category/kind and full new label`);
  const old = task ? [row[1], row[2]] : row[2];
  row[3] ??= [];
  if (!row[3].some(value => JSON.stringify(value) === JSON.stringify(old))) row[3].push(old);
  row[1] = kind; row[2] = normalize(label);
}
applyRename('--rename-task', tasks, true); applyRename('--rename-entity', entities);
const taskKeys = new Set(tasks.flatMap(([, category, label, aliases = []]) => [[category, label], ...aliases.map(alias => Array.isArray(alias) ? alias : [category, alias])].map(([cat, name]) => `${cat}\u0000${name}`)));
for (const [category, rows] of entries(definitions.challenges)) for (const [label, data] of entries(rows)) {
  const key = `${category}\u0000${normalize(label)}`;
  if (!taskKeys.has(key)) {
    if (data.PickerId !== undefined && (typeof data.PickerId !== 'string' || !data.PickerId.startsWith('rs3:task:'))) throw new Error(`Task PickerId must use the rs3:task namespace: ${category}/${label}`);
    tasks.push([typeof data.PickerId === 'string' ? data.PickerId : mintTask(), category, normalize(label)]); taskKeys.add(key);
  }
}
const entityRows = new Map();
for (const row of entities) for (const name of [row[2], ...(row[3] ?? [])]) entityRows.set(`${row[1]}\u0000${clean(name)}`, row);
function entity(kind, name) {
  if (typeof name !== 'string' || !name || name.includes('^^')) return;
  const label = clean(name), key = `${kind}\u0000${label}`;
  let row = entityRows.get(key);
  if (!row) { row = [mintEntity(), kind, label]; entities.push(row); entityRows.set(key, row); }
  if (name !== label && !(row[3] ?? []).includes(name)) { row[3] ??= []; row[3].push(name); }
}
function item(name) { entity('item', name); }
function output(name) {
  if (typeof name !== 'string') return;
  entity('output', name); entity('output', name.replaceAll(' jar', ''));
  if (/^Bird nest \(.+\) loot$/.test(name)) entity('output', name.slice(0, -5));
}
for (const [name, data] of entries(definitions.equipment)) {
  item(name);
  const row = entityRows.get(`item\u0000${clean(name)}`), formatted = data.formatted_name ?? name.toLowerCase();
  if (formatted !== name && !(row[3] ?? []).includes(formatted)) { row[3] ??= []; row[3].push(formatted); }
}
for (const [source, table] of entries(definitions.drops)) { entity('monster', source); for (const name of Object.keys(table)) item(name); }
for (const [shop, stock] of entries(definitions.shopItems)) { entity('shop', shop); for (const name of Object.keys(stock)) item(name); }
for (const table of Object.values(definitions.codeItems?.dropTables ?? {})) for (const name of Object.keys(table)) item(name);
for (const category of Object.values(definitions.skillItems ?? {})) for (const [name, table] of entries(category)) {
  output(name); for (const name of Object.keys(table)) item(name);
}
for (const category of Object.values(definitions.challenges ?? {})) for (const [label, data] of entries(category)) {
  for (const name of lists(data.Items)) item(name);
  for (const name of lists(data.Output)) { output(name); item(name); }
  for (const name of lists(data.Reward)) item(name);
  if (data.Source === 'shop') entity('shop', /~\|([^|]+)\|~/.exec(label)?.[1]);
}
for (const node of Object.values(definitions.chunks ?? {})) for (const data of [node, ...Object.values(node.Sections ?? {})]) {
  for (const name of Object.keys(data.Monster ?? {})) entity('monster', name);
  for (const name of Object.keys(data.Shop ?? {})) entity('shop', name);
  for (const name of Object.keys(data.Spawn ?? {})) item(name);
}
for (const names of Object.values(definitions.codeItems?.monstersPlus ?? {})) for (const name of lists(names)) entity('monster', name);
for (const names of Object.values(definitions.codeItems?.itemsPlus ?? {})) for (const name of lists(names)) item(name);
for (const [kind, rows] of [['item', definitions.taskUnlocks?.Items], ['shop', definitions.taskUnlocks?.Shops]]) for (const selector of Object.keys(rows ?? {})) {
  const [name, variant] = selector.split('^'); entity(kind, name); if (kind === 'shop') item(variant);
}
async function save() {
  if (registryPath === defaultRegistryPath) {
    for (const [name, rows] of Object.entries({ authoredTasks: tasks, authoredEntities: entities, authoredGoals: goals, authoredSources: sources })) registryDocument.values[registryKey(name)] = rows;
    await writeFile(registryPath, `${JSON.stringify(registryDocument, null, 2)}\n`, 'utf8');
    return;
  }
  const rows = (name, values) => `export const ${name} = [\n${values.map(row => `  ${JSON.stringify(row)},`).join('\n')}\n];\n`;
  await writeFile(registryPath, '// Authored permanent identities. Maintained by scripts/update-identities.mjs.\n// Tokens are minted once; never reorder and remint, remove rows, or recycle IDs.\nexport const identityRegistryVersion = 1;\n'
    + rows('authoredTasks', tasks) + rows('authoredEntities', entities) + rows('authoredGoals', goals) + rows('authoredSources', sources), 'utf8');
}
await save();
if (args.includes('--seed-sources') || !args.includes('--seed-only') && registryPath === defaultRegistryPath) {
  const [{ createCollectionEngine }, { buildEquipmentCatalogue }] = await Promise.all([import('../app/tasks/collection.mjs'), import('../app/tasks/presentation.mjs')]);
  const byId = new Map(sources.map(row => [row[0], row]));
  for (const goal of createCollectionEngine(definitions).catalogue) {
    const match = /^([\s\S]+): ~\|/.exec(goal.rawLabel);
    if (!match || !goal.sourceId) continue;
    let row = byId.get(goal.sourceId);
    if (!row) { row = [goal.sourceId, [], []]; sources.push(row); byId.set(goal.sourceId, row); }
    if (!row[1].includes(match[1])) row[1].push(match[1]);
    if (!row[2].includes(goal.objectiveKind)) row[2].push(goal.objectiveKind);
  }
  for (const goal of buildEquipmentCatalogue(definitions)) {
    const formatted = /^Obtain(?: an? | )~\|([^|]+)\|~$/.exec(goal.rawLabel)?.[1];
    if (!formatted || !goal.itemId) continue;
    let row = byId.get(goal.itemId);
    if (!row) { row = [goal.itemId, [], []]; sources.push(row); byId.set(goal.itemId, row); }
    if (!row[1].includes(formatted)) row[1].push(formatted);
    if (!row[2].includes('equipment')) row[2].push('equipment');
  }
  await save();
}
console.log(JSON.stringify({ tasks: tasks.length, entities: entities.length, exceptionalGoals: goals.length, sourceBindings: sources.length, registryPath }));
