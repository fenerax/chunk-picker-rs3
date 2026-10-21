#!/usr/bin/env node
// Advisory copied-cache research. No app imports this module or its outputs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';

export const RECIPE_PARAMS = Object.freeze({ skill: 2640, level: 2645, tool: 2650, outputQuantity: 2653,
  ingredient: 2655, quantity: 2665, group: 2675, quantityFlag: 2686, xpSkill: 2696, xp: 2697 });
const entries = value => value?.stringArrayValue1 ?? value?.stringArrayValue2?.values ?? [];
const clean = value => String(value ?? '').replace(/\*/g, '').trim().toLowerCase();
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const F2P = new Set('Magic Prayer Crafting Runecrafting Smithing Cooking Firemaking Woodcutting Fletching'.split(' '));

// Current Wiki revisions corroborate these bounded units. The remainder retain raw
// XP params: this is deliberately not a universal XP-per-action conversion.
export const VALIDATED_XP = Object.freeze({
  50: { value: 5, unit: 'per completed unstrung bow', revision: 37136718, title: 'Shortbow (unstrung)' },
  54: { value: 10, unit: 'per completed unstrung bow', revision: 37151141, title: 'Oak shortbow (unstrung)' },
  841: { value: 5, unit: 'per completed strung bow', revision: 37198403, title: 'Shortbow' },
  52: { value: 5, unit: 'per normal log cut into 15 shafts', revision: 37171926, title: 'Shaft' },
  53: { value: 1, unit: 'per headless shaft; 15 XP per batch of 15', revision: 37171921, title: 'Headless shaft' },
  315: { value: 30, unit: 'per successfully cooked shrimp', revision: 36950896, title: 'Shrimps' },
  1059: { value: 13.8, unit: 'per completed pair of gloves; displayed rounded XP', revision: 37132088, title: 'Leather gloves' },
  1205: { value: 30, unit: 'per completed forged dagger; not per smithing strike', revision: 37131007, title: 'Bronze dagger' },
  2349: { value: 1, unit: 'per normally smelted bronze bar', revision: 37012046, title: 'Bronze bar' },
});

export function parameterMap(definition) {
  const values = new Map(), duplicates = [];
  for (const row of definition?.extra ?? []) {
    if (values.has(row.prop)) duplicates.push(row.prop);
    values.set(row.prop, row.intvalue ?? row.stringvalue);
  }
  return { values, duplicates };
}

/** A schema type proves obj/struct references, not all server consumption rules. */
export function extractRecipes({ items, structs, params, enums }) {
  const skills = new Map(entries(enums.get(108))), recipes = [], unresolved = [];
  const parameter = (p, id) => p.has(id) ? p.get(id) : params.get(id)?.type?.defaultint ?? null;
  const item = id => ({ id, name: items.get(id)?.name ?? null, membersMarked: items.get(id)?.members === true,
    definitionPresent: items.has(id) });
  const checkType = (id, type) => {
    if (params.get(id)?.type?.vartype !== type) throw new Error(`Recipe param ${id}: expected type ${type}`);
  };
  for (let i = 0; i < 10; i++) { checkType(2655 + i, 33); checkType(2675 + i, 73); }
  for (let i = 0; i < 3; i++) checkType(2650 + i, 33);
  const inputs = definition => {
    const { values: p } = parameterMap(definition), rows = [];
    for (let slot = 0; slot < 10; slot++) {
      const id = parameter(p, 2655 + slot);
      if (id == null || id < 0) continue;
      const quantity = parameter(p, 2665 + slot), flag = parameter(p, 2686 + slot);
      rows.push({ slot, item: item(id), encodedQuantity: quantity,
        quantityUnit: 'unverified cache requirement quantity; batch scaling is not inferred',
        quantityFlag: flag, params: { item: 2655 + slot, quantity: 2665 + slot, flag: 2686 + slot },
        additionalParams: (definition.extra ?? []).filter(e => [5456 + slot, 7762, 7763].includes(e.prop)) });
    }
    return rows;
  };
  for (const [id, definition] of items) {
    const { values: p, duplicates } = parameterMap(definition);
    if (!p.has(2640)) continue;
    const requirements = [], tools = [], groups = [], warnings = [];
    for (let slot = 0; slot < 5; slot++) {
      if (!p.has(2640 + slot)) continue;
      const skillId = p.get(2640 + slot), level = parameter(p, 2645 + slot);
      requirements.push({ skillId, skill: skills.get(skillId) ?? null, level, params: [2640 + slot, 2645 + slot] });
      if (!skills.has(skillId)) warnings.push(`Unmapped requirement skill ${skillId}`);
    }
    for (let slot = 0; slot < 3; slot++) {
      const toolId = parameter(p, 2650 + slot);
      if (toolId != null && toolId >= 0) tools.push({ ...item(toolId), param: 2650 + slot });
    }
    for (let slot = 0; slot < 10; slot++) {
      const structId = parameter(p, 2675 + slot);
      if (structId == null || structId < 0) continue;
      const group = structs.get(structId);
      if (!group) { warnings.push(`Missing requirement struct ${structId}`); unresolved.push({ itemId: id, structId }); }
      groups.push({ slot, structId, param: 2675 + slot, source: { major: 22, minor: Math.floor(structId / 32), subid: structId % 32 },
        interpretation: 'Grouped requirement alternatives candidate; preserve flags and do not flatten into AND ingredients',
        inputs: group ? inputs(group) : [], raw: group ?? null });
    }
    const rawXp = p.has(2697) ? p.get(2697) : null, calibration = VALIDATED_XP[id];
    const xp = calibration && rawXp === Math.round(calibration.value * 10) ? {
      value: rawXp / 10, unit: calibration.unit, raw: rawXp, params: [2696, 2697],
      skill: skills.get(parameter(p, 2696)) ?? null,
      validation: { source: 'RuneScape Wiki current revision', revision: calibration.revision,
        url: `https://runescape.wiki/w/${encodeURIComponent(calibration.title.replaceAll(' ', '_'))}?oldid=${calibration.revision}` },
    } : null;
    const direct = inputs(definition);
    if (!direct.length && !groups.length) warnings.push('No ingredient payload in this item definition');
    if (duplicates.length) warnings.push('Duplicate params preserved in raw extra; normalized value uses last encoded entry');
    recipes.push({ id: `cache:item:${id}:production`, product: item(id), source: { major: 19, minor: Math.floor(id / 256), subid: id % 256 },
      recordKind: 'item production definition candidate', outputQuantity: parameter(p, 2653),
      outputQuantityOrigin: p.has(2653) ? 'explicit param 2653' : 'param 2653 default',
      requirements, tools, directInputs: direct, requirementGroups: groups, xp,
      rawXp: rawXp == null ? null : { value: rawXp, skillId: parameter(p, 2696),
        unit: 'raw integer; tenths-of-XP family corroborated in nine samples, action/batch units unverified here' },
      members: { productMarked: definition.members === true,
        activityEligibility: 'unverified: product membership alone does not establish recipe, ingredient or facility access' },
      rawParams: definition.extra ?? [], duplicateParams: duplicates, warnings,
      missing: ['server recipe execution', 'facility/access requirements', 'failure probability', 'duration/throughput', 'player inventory state'] });
  }
  const fragments = {
    itemsWithoutPrimarySkill: [...items].filter(([, def]) => !def.extra?.some(e => e.prop === 2640)
      && def.extra?.some(e => e.prop >= 2655 && e.prop <= 2664)).map(([id, def]) => ({ item: item(id),
        source: { major: 19, minor: Math.floor(id / 256), subid: id % 256 }, rawParams: def.extra })),
    ingredientStructs: [...structs].filter(([, def]) => def.extra?.some(e => e.prop >= 2655 && e.prop <= 2664))
      .map(([id, def]) => ({ id, source: { major: 22, minor: Math.floor(id / 32), subid: id % 32 }, raw: def })),
    interpretation: 'Preserved research fragments; no product/skill/action association inferred',
  };
  return { recipes, unresolved, fragments, skillEnum: { id: 108, source: { major: 17, minor: 0, subid: 108 }, values: [...skills] },
    parameters: [...params].filter(([id]) => id >= 2639 && id <= 2708 || id >= 5456 && id <= 5465 || id >= 7762 && id <= 7764) };
}

export function compareRetained(recipes, reference) {
  const byOutput = new Map();
  for (const recipe of recipes) {
    const key = clean(recipe.product.name);
    if (!byOutput.has(key)) byOutput.set(key, []);
    byOutput.get(key).push(recipe);
  }
  const comparisons = [];
  for (const [skill, challenges] of Object.entries(reference.challenges ?? {})) for (const [label, record] of Object.entries(challenges)) {
    if (!record.Output || !list(record.Items).length) continue;
    const candidates = list(record.Output).flatMap(output => byOutput.get(clean(output)) ?? [])
      .filter(recipe => recipe.requirements.some(req => req.skill === skill));
    const candidateLevels = candidates.map(recipe => ({ id: recipe.id,
      levels: recipe.requirements.filter(req => req.skill === skill).map(req => req.level) }));
    const agreement = candidateLevels.map(candidate => candidate.levels.includes(record.Level));
    const levelStatus = !agreement.length ? 'unmatched' : agreement.every(Boolean) ? 'all-agree'
      : agreement.every(value => !value) ? 'all-disagree' : 'mixed';
    const tokenAlternatives = token => {
      const value = String(token).replace(/\*/g, '').replace(/x\d+$/, '');
      const key = Object.keys(reference.codeItems?.itemsPlus ?? {}).find(k => clean(k) === clean(value));
      return (key ? reference.codeItems.itemsPlus[key] : [value]).map(clean);
    };
    const inputNameComparisons = candidates.map(recipe => {
      const cacheNames = new Set([...recipe.directInputs.map(input => input.item.name),
        ...recipe.requirementGroups.flatMap(group => group.inputs.map(input => input.item.name)),
        ...recipe.tools.map(tool => tool.name)].filter(Boolean).map(clean));
      const tokens = list(record.Items).map(token => ({ token,
        nameOverlap: tokenAlternatives(token).filter(name => cacheNames.has(name)) }));
      return { recipeId: recipe.id, tokens, allRetainedTokensHaveNameOverlap: tokens.every(token => token.nameOverlap.length),
        interpretation: 'Names only across direct inputs, grouped requirements and tools; no quantities, AND/OR rules or consumption equivalence' };
    });
    comparisons.push({ skill, label, outputs: list(record.Output), retainedLevel: record.Level ?? null,
      retainedItems: list(record.Items), retainedObjects: list(record.Objects),
      cacheRecipeIds: candidates.map(recipe => recipe.id),
      candidateCount: candidates.length, joinStatus: !candidates.length ? 'unmatched' : candidates.length === 1 ? 'unique' : 'ambiguous',
      candidateLevels, levelStatus, levelAgrees: levelStatus === 'unmatched' || levelStatus === 'mixed' ? null : levelStatus === 'all-agree',
      exactNameJoinOnly: true, inputNameComparisons,
      inputComparison: 'Alias-expanded name overlap is audit evidence; consumable markers, quantities and task-gated facilities require authored mapping' });
  }
  return { meaning: 'Exact case-insensitive output/skill joins are audit candidates, not automatic replacement or comprehensive activity matches',
    taskCount: comparisons.length, withOutputSkillMatch: comparisons.filter(r => r.cacheRecipeIds.length).length,
    matchedLevelAgree: comparisons.filter(r => r.levelAgrees === true).length,
    matchedLevelDisagree: comparisons.filter(r => r.levelAgrees === false).length,
    matchedLevelMixed: comparisons.filter(r => r.levelStatus === 'mixed').length,
    ambiguousOutputSkillMatches: comparisons.filter(r => r.joinStatus === 'ambiguous').length,
    matchedWithAllRetainedInputNames: comparisons.filter(r => r.inputNameComparisons.some(candidate => candidate.allRetainedTokensHaveNameOverlap)).length,
    matchedWithInputNameGaps: comparisons.filter(r => r.cacheRecipeIds.length
      && !r.inputNameComparisons.some(candidate => candidate.allRetainedTokensHaveNameOverlap)).length, comparisons };
}

export function summarizeRecipes(result, retained) {
  const skillCounts = new Map(result.skillEnum.values.map(([, name]) => [name, { skill: name, candidates: 0, productNotMembersMarked: 0,
    ingredientPayload: 0, rawXpPresent: 0, normalizedXpValidated: 0 }]));
  for (const recipe of result.recipes) for (const skill of new Set(recipe.requirements.map(req => req.skill).filter(Boolean))) {
    const row = skillCounts.get(skill);
    row.candidates++;
    if (!recipe.product.membersMarked) row.productNotMembersMarked++;
    if (recipe.directInputs.length || recipe.requirementGroups.length) row.ingredientPayload++;
    if (recipe.rawXp !== null) row.rawXpPresent++;
    if (recipe.xp) row.normalizedXpValidated++;
  }
  return { candidates: result.recipes.length, namedProducts: result.recipes.filter(r => r.product.name).length,
    ingredientPayload: result.recipes.filter(r => r.directInputs.length || r.requirementGroups.length).length,
    missingIngredientPayload: result.recipes.filter(r => !r.directInputs.length && !r.requirementGroups.length).length,
    rawXpPresent: result.recipes.filter(r => r.rawXp).length, normalizedXpValidated: result.recipes.filter(r => r.xp).length,
    groupedRequirements: result.recipes.filter(r => r.requirementGroups.length).length,
    fragmentsWithoutPrimarySkill: result.fragments.itemsWithoutPrimarySkill.length,
    ingredientStructFragments: result.fragments.ingredientStructs.length,
    unmappedRequirementSkillCandidates: result.recipes.filter(r => r.requirements.some(req => req.skill === null)).length,
    unresolvedStructReferences: result.unresolved.length, duplicateParamCandidates: result.recipes.filter(r => r.duplicateParams.length).length,
    perSkill: [...skillCounts.values()].map(row => ({ ...row, f2pSkillFamily: F2P.has(row.skill) })),
    retained: { taskCount: retained.taskCount, withOutputSkillMatch: retained.withOutputSkillMatch,
      matchedLevelAgree: retained.matchedLevelAgree, matchedLevelDisagree: retained.matchedLevelDisagree,
      matchedLevelMixed: retained.matchedLevelMixed, ambiguousOutputSkillMatches: retained.ambiguousOutputSkillMatches,
      matchedWithAllRetainedInputNames: retained.matchedWithAllRetainedInputNames, matchedWithInputNameGaps: retained.matchedWithInputNameGaps } };
}

export async function exportRecipes({ cache, context, output, reference }) {
  const tables = {};
  for (const [name, options] of Object.entries({ items: { major: 19, kind: 'item' }, structs: { major: 22, kind: 'struct', groupSize: 32 },
    enums: { major: 17, kind: 'enum' }, params: { major: 2, minor: 11, kind: 'param' } })) tables[name] = loadTable(cache, options);
  const decoded = Object.fromEntries(Object.entries(tables).map(([name, t]) => [name, t.definitions]));
  const result = extractRecipes(decoded), retained = compareRetained(result.recipes, reference), summary = summarizeRecipes(result, retained);
  const interfaces = loadTable(cache, { major: 3, kind: 'interface', groupSize: 65536 });
  const interfaceHits = [...interfaces.definitions].filter(([, def]) => /ingredient|make.?x|production|experience/i.test(JSON.stringify(def)));
  // The pinned parser requires a calibrated opcode map for every script. Probe one
  // rather than performing 21,115 identical failures on every extraction run.
  let scriptProbe;
  const scriptMinor = cache.table(12).entries.keys().next().value;
  const scriptBytes = cache.archive(12, scriptMinor)?.get(0);
  try { cache.decoders.decode('clientscript', scriptBytes); scriptProbe = { status: 'decoded' }; }
  catch (error) { scriptProbe = { status: 'unavailable', reason: error.message }; }
  const scriptHeaders = [], scriptHeaderErrors = [];
  for (const minor of cache.table(12).entries.keys()) {
    try {
      for (const [subid, bytes] of cache.archive(12, minor) ?? []) {
        const { opcodedata, ...header } = cache.decoders.decode('clientscriptdata', bytes);
        scriptHeaders.push({ minor, subid, rawOpcodeBytes: opcodedata.length, ...header });
      }
    } catch (error) { scriptHeaderErrors.push({ minor, message: error.message }); }
  }
  const inspection = { tables: Object.fromEntries(Object.entries(tables).map(([name, t]) => [name, { decoded: t.definitions.size, errors: t.errors }])),
    interfaces: { decoded: interfaces.definitions.size, errors: interfaces.errors, textSearchMatches: interfaceHits.length,
      samples: interfaceHits.slice(0, 20), limit: 'Pinned interface schema supports through build932; modern failures remain unavailable, never suppressed' },
    clientscripts: { declared: cache.table(12).entries.size, headersDecoded: scriptHeaders.length,
      headerErrors: scriptHeaderErrors, headerSamples: scriptHeaders.slice(0, 10), probeMinor: scriptMinor, ...scriptProbe,
      limit: 'No execution or deobfuscation. Raw scripts contain obfuscated opcodes; no recipe semantics inferred from numeric coincidences.' } };
  const provenance = { generatedAt: context.generatedAt, decoder: context.decoder, reference: context.reference, manifest: 'recipes-manifest.v1.json' };
  const dataset = { schemaVersion: 1, kind: 'advisory-cache-production-candidates', provenance, ...result, summary, inspection };
  const file = writeDataset(output, 'recipes.cache-2026-10-08.v1.json', dataset); context.outputs.push(file);
  const comparisonFile = writeDataset(output, 'recipes-retained-comparison.2026-10-08.v1.json', { schemaVersion: 1, provenance, ...retained }); context.outputs.push(comparisonFile);
  const headersFile = writeDataset(output, 'recipes-clientscript-headers.2026-10-08.v1.json', { schemaVersion: 1, provenance,
    status: 'headers only; opcodes not interpreted', scriptHeaders, errors: scriptHeaderErrors }); context.outputs.push(headersFile);
  return { dataset, retained, files: [file, comparisonFile, headersFile] };
}

async function main() {
  const args = cliOptions();
  if (!args.output) throw new Error('Required --output NEW-directory');
  const { cache, context } = await openGameCache({ workspace: args.workspace, build: args.build ? Number(args.build) : 950 });
  try {
    const reference = JSON.parse(readFileSync(context.reference.path, 'utf8'));
    const result = await exportRecipes({ cache, context, output: args.output, reference });
    const manifest = await finishManifest(cache, context, args.output, { name: 'recipes-manifest.v1.json', summary: result.dataset.summary });
    console.log(JSON.stringify({ files: [...result.files, manifest.file], summary: result.dataset.summary }, null, 2));
  } finally { cache.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
