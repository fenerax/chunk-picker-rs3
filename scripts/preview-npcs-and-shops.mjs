import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateState } from '../app/core/state.mjs';
import { applyCacheShops } from '../app/data/cache-shops.mjs';
import { npcMetadataPayload } from '../app/data/cache-npcs.mjs';
import { applyEquipmentCorrections } from '../app/data/equipment-corrections.mjs';
import { applyMetadataCorrections } from '../app/data/metadata-corrections.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createCollectionEngine, collectionRules } from '../app/tasks/collection.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';
import { readStateCopy } from './preview-resource-contents.mjs';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';

const unique = values => [...new Set(values)].sort();
const fields = ['label', 'category', 'status', 'hidden', 'hiddenReasons', 'blockers', 'obligation',
  'sources', 'explanation', 'equipmentGoals', 'equipRequirements', 'maintenance', 'record'];
const snapshot = row => row ? { ...Object.fromEntries(fields.map(key => [key, row[key] ?? null])),
  obligation: row.obligation !== false, hidden: !!row.hidden, hiddenReasons: row.hiddenReasons ?? [], blockers: row.blockers ?? [] } : null;
function changedRows(before, after) {
  const index = rows => new Map(rows.map(row => [row.id, row]));
  const prior = index(before), next = index(after);
  return unique([...prior.keys(), ...next.keys()]).flatMap(id => {
    const old = prior.get(id), current = next.get(id);
    const left = snapshot(old), right = snapshot(current);
    return isDeepStrictEqual(left, right) ? [] : [{ id, label: (current ?? old).label,
      category: (current ?? old).category, before: left, after: right }];
  });
}

/** Uses the same personal state for both sides; creates no store or server. */
export function previewNpcsAndShops({ state, definitions, shops }) {
  state = validateState(state);
  definitions = applyMetadataCorrections(applyEquipmentCorrections(definitions));
  const corrected = applyCacheShops(definitions, { enabled: true, shops });
  const build = data => {
    const engine = createTaskEngine(data, { cacheShops: false });
    const collections = createCollectionEngine(data, { cacheShops: false });
    const names = Object.keys(data.equipment ?? {});
    const equipmentById = new Map(buildEquipmentCatalogue(data).map((row, index) => [row.id, names[index]]));
    const derivedIds = new Set([...equipmentById.keys(), ...collections.catalogue.map(row => row.id),
      ...engine.catalogue.filter(row => row.kind === 'house-storage').map(row => row.id)]);
    return { engine, collections, data, equipmentById, derivedIds };
  };
  const before = build(definitions), after = build(corrected);
  const evaluate = (side, memberId) => {
    const member = state.members.find(row => row.id === memberId);
    const savedIds = new Set([...Object.keys(member.taskStatus ?? {}), ...member.completedTasks]);
    const result = side.engine.evaluate(state, memberId, {
      ownItemQueries: [...savedIds].filter(id => side.equipmentById.has(id)).map(id => side.equipmentById.get(id)),
    });
    const collections = side.collections.evaluate(state, memberId, result, { obligationQueries: [...savedIds] });
    const equipment = evaluateEquipment(result, state, memberId, side.data);
    let dutyEquipment = equipment;
    if ([false, 'false', 0].includes(collectionRules(state, memberId)['Show Best in Slot Tasks'])) {
      const dutyState = { ...state, members: state.members.map(owner => owner.id === memberId
        ? { ...owner, taskRules: { ...owner.taskRules, 'Show Best in Slot Tasks': true } } : owner) };
      dutyEquipment = evaluateEquipment(result, dutyState, memberId, side.data);
    }
    const visibleIds = new Set(equipment.catalogue.map(row => row.id));
    const hiddenDuties = dutyEquipment.catalogue.filter(row => !visibleIds.has(row.id)).map(row => ({ ...row,
      hidden: true, hiddenReasons: [...(row.hiddenReasons ?? []), 'Hidden by the Show Best in Slot Tasks display setting.'] }));
    const tasks = [...new Map([...result.tasks, ...collections.tasks, ...equipment.catalogue, ...hiddenDuties].map(row => [row.id, row])).values()];
    const present = new Set(tasks.map(row => row.id)), ownSaved = new Set(collections.obligationIds), ownOrigins = new Set(result.ownItemOrigins);
    tasks.push(...state.tasks.filter(row => savedIds.has(row.id) && side.derivedIds.has(row.id) && !present.has(row.id)).map(row => {
      const own = ownSaved.has(row.id) || ownOrigins.has(side.equipmentById.get(row.id));
      const detail = own ? 'The defining source is on this member’s own map; current requirements, rules or backlog prevent an active goal.'
        : 'No defining source on this member’s own reachable map.';
      return { ...row, obligation: own, hidden: !own, hiddenReasons: own ? [] : ['Outside the current own obligation map.'],
        status: 'blocked', explanation: detail, blockers: [{ kind: 'access', detail }], sources: [] };
    }));
    return { ...result, tasks, equipmentPlanning: { recommendations: equipment.recommendations,
      loadouts: equipment.loadouts, specialist: equipment.specialist, dutyTaskIds: dutyEquipment.tasks.map(row => row.id) } };
  };
  const members = state.members.map(member => {
    const old = evaluate(before, member.id), current = evaluate(after, member.id);
    const tasks = changedRows(old.tasks, current.tasks);
    const oldItems = new Set(old.items.map(row => row.name)), newItems = new Set(current.items.map(row => row.name));
    const oldOwn = new Set(old.ownItems), newOwn = new Set(current.ownItems);
    const oldSources = new Map(old.items.map(row => [row.name, row.sources]));
    const newSources = new Map(current.items.map(row => [row.name, row.sources]));
    const changedItemSources = unique([...oldSources.keys(), ...newSources.keys()]).flatMap(name => {
      const before = oldSources.get(name) ?? [], after = newSources.get(name) ?? [];
      return isDeepStrictEqual(before, after) ? [] : [{ name, before, after }];
    });
    return { id: member.id, name: member.name,
      checkedTaskCount: new Set([...old.tasks, ...current.tasks].map(row => row.id)).size,
      changedTaskCount: tasks.length, tasks,
      equipmentChanges: Object.keys(current.equipmentPlanning).flatMap(field => isDeepStrictEqual(old.equipmentPlanning[field], current.equipmentPlanning[field])
        ? [] : [{ field, before: old.equipmentPlanning[field], after: current.equipmentPlanning[field] }]),
      availability: { addedItems: [...newItems].filter(name => !oldItems.has(name)).sort(),
        removedItems: [...oldItems].filter(name => !newItems.has(name)).sort(),
        addedOwnItems: [...newOwn].filter(name => !oldOwn.has(name)).sort(),
        removedOwnItems: [...oldOwn].filter(name => !newOwn.has(name)).sort(), changedItemSources } };
  });
  return { schemaVersion: 1, revision: state.revision,
    switch: { name: 'RS3_CACHE_SHOP_CONTENTS', default: false, baseline: false, comparison: true },
    npcMetadataOnly: true, reviewedNpcMetadataCount: Object.values(npcMetadataPayload().records).filter(row => row.reviewedMetadata).length,
    changedShops: Object.keys(corrected.shopItems ?? {}).filter(name => !isDeepStrictEqual(definitions.shopItems?.[name], corrected.shopItems[name])),
    members };
}

export function formatNpcShopPreview(report) {
  const lines = [`NPC/shop preview (state revision ${report.revision}); shop switch OFF -> ON`,
    `NPC metadata: ${report.reviewedNpcMetadataCount} reviewed labels; no task/access changes`,
    `Changed shop contents: ${report.changedShops.join(', ') || 'none'}`];
  for (const member of report.members) {
    lines.push('', `${member.name} (${member.id}): ${member.changedTaskCount} changed / ${member.checkedTaskCount} checked tasks`);
    for (const [field, names] of Object.entries(member.availability)) if (names.length) lines.push(`  ${field}: ${field === 'changedItemSources' ? JSON.stringify(names) : names.join(', ')}`);
    for (const task of member.tasks) lines.push(`  ${task.category}: ${task.label} [${task.id}]\n    ${JSON.stringify(task.before)} -> ${JSON.stringify(task.after)}`);
    for (const change of member.equipmentChanges) lines.push(`  equipment.${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = key => args[args.indexOf(key) + 1];
  if (!args.includes('--state') || !option('--state') || option('--state').startsWith('--')) throw new TypeError('An explicit --state copy path is required.');
  const copy = await readStateCopy(option('--state'));
  const definitionPath = args.includes('--definitions') ? resolve(option('--definitions')) : new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url);
  const bytes = await readFile(definitionPath);
  const report = previewNpcsAndShops({ state: copy.state, definitions: JSON.parse(bytes.toString('utf8')) });
  report.referenceSha256 = sha256RepositoryText(bytes);
  report.stateSourceSha256 = copy.sourceSha256;
  await copy.verifyUnchanged();
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatNpcShopPreview(report));
}
