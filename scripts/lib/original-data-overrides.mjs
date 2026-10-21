import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import { sha256RepositoryText } from './provenance-hash.mjs';
import { applyRetainedTaskCorrections, retainedTaskCorrections, retainedEntryCorrections, retainedWordingCorrections } from '../../app/data/retained-task-corrections.mjs';
import { applyMetadataCorrections, metadataCorrections } from '../../app/data/metadata-corrections.mjs';
import { applyEquipmentCorrections, equipmentCorrections, equipmentWeights, equipmentIdentities } from '../../app/data/equipment-corrections.mjs';
import { applySkillguideCombatCorrections, skillguideCombatCorrections } from '../../app/data/skillguide-combat-corrections.mjs';
import { skillGuideCatalogue } from '../../app/data/skill-guides.mjs';
import { applyArchaeologyTaskCorrections, archaeologyTaskCorrections } from '../../app/data/archaeology-task-corrections.mjs';
import { applyMapCorrections, MAP_CORRECTIONS } from '../../app/data/map-corrections.mjs';
import { applyCacheShops, shopMetadataPayload } from '../../app/data/cache-shops.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sameBytes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const task = (data, row) => data.challenges?.[row.category ?? row.skill]?.[row.label];

async function localFiles(root, directory = 'app/data') {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await localFiles(root, relative));
    else if (/\.(?:json|mjs)$/.test(entry.name) && !/^(?:original-(?:data|definitions|task-map)|legacy-task-(?:current|history)|changelog\.json|roadmap\.json)/.test(entry.name)) result.push(relative);
  }
  return result.sort();
}

/** Conservative audit: reviewed overlays never disappear silently. Changes to
 * other locally pinned source selectors require a review, rather than guessing
 * whether old membership, terrain or training evidence covers the new row. */
export async function auditLocalOverrides(before, after, { root = ROOT } = {}) {
  const conflicts = [], checks = [];
  const conflict = (kind, target, message) => conflicts.push({ kind, target, message });
  let identityFields = 0;
  function identitySeams(old, current, pointer = '') {
    if ((!current || typeof current !== 'object') && (!old || typeof old !== 'object')) return;
    const keys = new Set([...Object.keys(old && typeof old === 'object' ? old : {}), ...Object.keys(current && typeof current === 'object' ? current : {})]);
    for (const key of keys) {
      const target = `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (key === 'PickerId' || key === 'PickerEntityId') {
        identityFields++;
        if (!equal(old?.[key], current?.[key])) conflict('Authored identity seam', target,
          'The public source introduced, removed or changed an explicit local identity. Review its existing token and aliases before adopting.');
      } else identitySeams(old?.[key], current?.[key], target);
    }
  }
  identitySeams(before, after);
  checks.push({ name: 'Authored explicit task/entity identities', status: conflicts.length ? 'conflict' : 'preserved', count: identityFields });
  const retained = [...retainedTaskCorrections.corrections, ...retainedEntryCorrections.corrections, ...retainedWordingCorrections.corrections];
  function guardedTasks(name, rows, apply) {
    let affected = 0;
    for (const row of rows) {
      if (sameBytes(task(before, row), task(after, row))) continue;
      affected++;
      try { apply(after, row); }
      catch (error) { conflict(name, `${row.category ?? row.skill}: ${row.label}`, error.message); }
    }
    checks.push({ name, status: conflicts.some(row => row.kind === name) ? 'conflict' : 'preserved', count: rows.length, affected });
  }
  guardedTasks('Retained task corrections', retained, (data, row) => applyRetainedTaskCorrections(data, { corrections: [row], strict: true }));
  guardedTasks('Metadata corrections', metadataCorrections, (data, row) => applyMetadataCorrections(data, { corrections: [row], strict: true }));
  guardedTasks('Skill guide combat corrections', skillguideCombatCorrections, (data, row) => applySkillguideCombatCorrections(data, { corrections: [row], strict: true }));

  const equipmentNames = new Set([...equipmentCorrections, ...equipmentWeights, ...equipmentIdentities].map(row => row.name));
  let affectedEquipment = 0;
  for (const name of equipmentNames) {
    if (sameBytes(before.equipment?.[name], after.equipment?.[name])) continue;
    affectedEquipment++;
    try {
      applyEquipmentCorrections(after, { strict: true,
        corrections: equipmentCorrections.filter(row => row.name === name),
        weights: equipmentWeights.filter(row => row.name === name), identities: equipmentIdentities.filter(row => row.name === name) });
    } catch (error) { conflict('Equipment corrections, weights and identities', name, error.message); }
  }
  checks.push({ name: 'Equipment corrections, weights and identities', status: affectedEquipment && conflicts.some(row => row.kind.startsWith('Equipment')) ? 'conflict' : 'preserved', count: equipmentNames.size, affected: affectedEquipment });

  for (const row of archaeologyTaskCorrections.corrections) {
    if (sameBytes(task(before, row), task(after, row))) continue;
    const record = task(after, row);
    const patched = applyArchaeologyTaskCorrections(after, { enabled: true });
    if (!record || !equal(record.Objects, row.expectedObjects) || task(patched, row)?.Level !== row.after) {
      conflict('Archaeology corrections', `${row.category}: ${row.label}`, 'The reviewed level/object selector no longer applies.');
    }
  }
  checks.push({ name: 'Archaeology corrections (including optional mode)', status: conflicts.some(row => row.kind === 'Archaeology corrections') ? 'conflict' : 'preserved', count: archaeologyTaskCorrections.corrections.length });

  const reviewedShops = shopMetadataPayload().shops.filter(row => row.confidence === 'reviewed-complete-stock');
  for (const shop of reviewedShops) {
    if (sameBytes(before.shopItems?.[shop.name], after.shopItems?.[shop.name])) continue;
    try { applyCacheShops(after, { enabled: true, shops: [shop], strict: true }); }
    catch (error) { conflict('Reviewed shop stock', shop.name, error.message); }
  }
  checks.push({ name: 'Reviewed shop stock (including optional mode)', status: conflicts.some(row => row.kind === 'Reviewed shop stock') ? 'conflict' : 'preserved', count: reviewedShops.length });

  const afterIds = new Map(Object.entries(after.challenges ?? {}).flatMap(([category, rows]) => Object.entries(rows)
    .filter(([, row]) => row.PickerId).map(([label, row]) => [row.PickerId, `${category}: ${label}`])));
  for (const row of skillGuideCatalogue.generatedTasks) {
    const old = task(before, row), current = task(after, row), identity = row.record.PickerId;
    if (!sameBytes(old, current) && current && !equal(current, row.record)) {
      conflict('Generated skill guide task', `${row.category}: ${row.label}`, `Upstream now occupies a locally generated label (${identity}); reconcile its meaning and identity.`);
    }
    if (afterIds.has(identity) && afterIds.get(identity) !== `${row.category}: ${row.label}`) {
      conflict('Generated skill guide task', identity, `Upstream reused the local identity at ${afterIds.get(identity)}.`);
    }
  }
  checks.push({ name: 'Generated skill guide tasks and opt-in defaults', status: conflicts.some(row => row.kind === 'Generated skill guide task') ? 'conflict' : 'preserved', count: skillGuideCatalogue.generatedTasks.length });

  const oldMap = applyMapCorrections(before), newMap = applyMapCorrections(after);
  for (const row of MAP_CORRECTIONS) {
    const { chunk, section, field } = row;
    let old, current;
    if (field === 'record') { old = oldMap.definitions.chunks[chunk]; current = newMap.definitions.chunks[chunk]; }
    else if (field === 'connections') { old = oldMap.definitions.sections?.[chunk]?.[section]; current = newMap.definitions.sections?.[chunk]?.[section]; }
    else if (field === 'walkable' || field === 'f2p') {
      const key = field === 'walkable' ? 'walkableChunks' : 'walkableChunksF2P';
      old = oldMap.definitions[key]?.includes(chunk); current = newMap.definitions[key]?.includes(chunk);
    } else if (field === 'sectionF2p') { old = oldMap.sectionMembership.get(chunk)?.get(section); current = newMap.sectionMembership.get(chunk)?.get(section); }
    else { old = oldMap.sectionRoutes.get(`${chunk}-${section}`)?.get(row.edge); current = newMap.sectionRoutes.get(`${chunk}-${section}`)?.get(row.edge); }
    if (!equal(old, current)) conflict('Map correction', `${chunk}${section === undefined ? '' : `-${section}`} ${field}`, 'The effective locally reviewed map value changed; review the new geography.');
  }
  checks.push({ name: 'Map corrections and section policies', status: conflicts.some(row => row.kind === 'Map correction') ? 'conflict' : 'preserved', count: MAP_CORRECTIONS.length });

  const protectedFiles = [];
  const changedNames = new Set();
  for (const section of ['chunks', 'shopItems', 'equipment', 'drops', 'quests', 'slayerMonsters']) {
    for (const name of Object.keys(before[section] ?? {})) if (!equal(before[section][name], after[section]?.[name])) changedNames.add(name);
  }
  for (const [category, rows] of Object.entries(before.challenges ?? {})) {
    for (const [label, record] of Object.entries(rows)) if (!equal(record, after.challenges?.[category]?.[label])) changedNames.add(label);
  }
  const policyPattern = /(?:source-|membership|access-policy|training\/|cache-resource-selectors|cache-topology|cache-archaeology|transport-|map-connections|map-pin-details)/;
  for (const relative of await localFiles(root)) {
    const bytes = await readFile(path.join(root, relative));
    protectedFiles.push({ path: relative, sha256: sha256RepositoryText(bytes) });
    if (!changedNames.size || !policyPattern.test(relative)) continue;
    // Exact quoted selector only, never substring names (Cow != Cow calf).
    const text = bytes.toString('utf8');
    for (const name of changedNames) if (text.includes(JSON.stringify(name))) {
      conflict('Pinned local source policy', name, `${relative} refers to this changed/removed upstream target. Review membership, selectors and access evidence before adopting.`);
    }
  }
  checks.push({ name: 'Local icons, guides, membership, training and cache files kept intact', status: 'preserved', count: protectedFiles.length });
  return { conflicts, protectedFiles, checks };
}
