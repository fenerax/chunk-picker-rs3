#!/usr/bin/env node
// Offline advisory extraction. No application module imports this file or its outputs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { sha256 } from './cache-reader.mjs';

// Same stat order as the retained RuneMetrics adapter; achievement skill text
// independently corroborates IDs (e.g. skill17 has "Skill: 5 Thieving").
export const SKILL_NAMES = ['Attack', 'Defence', 'Strength', 'Constitution', 'Ranged', 'Prayer', 'Magic',
  'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining',
  'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Hunter', 'Construction',
  'Summoning', 'Dungeoneering', 'Divination', 'Invention', 'Archaeology', 'Necromancy'];
export const plainText = value => typeof value === 'string' ? value.replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
const nameKey = value => plainText(value).normalize('NFC').replace(/[’‘]/g, "'").toLowerCase();
export const enumEntries = raw => raw?.stringArrayValue1 ?? raw?.stringArrayValue2?.values
  ?? raw?.intArrayValue1 ?? raw?.intArrayValue2?.values ?? [];
const extraValue = (raw, id) => raw.extra?.find(row => row.prop === id)?.intvalue ?? null;
const skills = rows => (rows ?? []).map(row => ({ ...row, skillName: SKILL_NAMES[row.skill] ?? null }));
const sourceAddress = (major, id, groupSize, minor = null) => ({ major,
  minor: minor ?? Math.floor(id / groupSize), subid: minor === null ? id % groupSize : id });
const refs = (ids, definitions) => (ids ?? []).map(id => ({ id, name: definitions.get(id)?.name ?? null,
  resolved: definitions.has(id) }));
const bucket = rows => {
  const map = new Map();
  for (const row of rows) { const key = nameKey(row.name), values = map.get(key) ?? []; values.push(row); map.set(key, values); }
  return map;
};

export function normalizeQuest(id, raw, questDefinitions, enumDefinitions) {
  const lengthCode = extraValue(raw, 7855);
  const difficultyLabels = new Map(enumEntries(enumDefinitions.get(2251)));
  const lengthLabels = new Map(enumEntries(enumDefinitions.get(13354)));
  return { id, source: sourceAddress(2, id, 1, 35), name: raw.name ?? null, questListName: raw.quest_list_name ?? null,
    listEntry: !!raw.quest_list_name, discontinuedStatus: raw.discontinued_status ?? null,
    // Missing booleans are absence of the true opcode; nameless/alias records
    // remain in the raw export but are excluded from membership comparisons.
    members: !!raw.members, questPoints: raw.quest_points ?? null,
    difficulty: { code: raw.quest_difficulty ?? null, label: difficultyLabels.get(raw.quest_difficulty) ?? null,
      enumId: 2251, evidence: 'Named quest_difficulty schema field; enum labels corroborated by Wiki samples.' },
    length: { code: lengthCode, label: lengthLabels.get(lengthCode) ?? null, paramId: 7855, enumId: 13354,
      interpretation: 'inferred: quest UI script4011 contains adjacent enum13354 and param7855; three Wiki revision samples agree',
      missingPolicy: 'No default is substituted when the quest omits this param.' },
    requirements: { skills: skills(raw.skill_requirements), quests: refs(raw.required_quests, questDefinitions),
      questPoints: raw.quest_point_req ?? null },
    subquestOf: raw.subquest_of === undefined ? null : refs([raw.subquest_of], questDefinitions)[0],
    stateFields: { varps: raw.varps ?? [], varbits: raw.varbits ?? [], varbitsV2: raw.varbits_v2 ?? [] },
    startLocationPath: raw.start_location_path ?? [], alternateQuestStart: raw.alternate_quest_start ?? null,
    raw };
}

export function normalizeAchievement(id, raw, achievementDefinitions, questDefinitions) {
  return { id, source: sourceAddress(57, id, 128), name: raw.name ?? null,
    description: raw.description ?? null, category: raw.category ?? null, subcategory: raw.subcategory ?? null,
    runescore: raw.runescore ?? null, f2pFlag: !!raw.f2p, removed: !!raw.removed, hiddenCode: raw.hidden ?? null,
    encodedRequirements: { skills: skills(raw.subach_skills), skills2: skills(raw.skill_reqs_2),
      previousAchievements: refs(raw.previous_achievements, achievementDefinitions),
      subAchievements: (raw.sub_achievements ?? []).map(row => ({ ...row,
        ...refs([row.achievement], achievementDefinitions)[0] })),
      miniquestQuestReferences: refs(raw.quest_req_for_miniquests, questDefinitions),
      associatedQuestReferences: refs(raw.quest_ids, questDefinitions) },
    // These are encoded state tests, not proven player prerequisites. Keep all
    // type/ironman/unknown selector fields in raw and in these arrays.
    stateConditions: Object.fromEntries(['subach_varbits', 'varbit_partial_state', 'varbit_partial_state_v2',
      'subreqs', 'progress_states', 'progress_states_v2', 'reqs23', 'reqs25', 'reqs25_v2']
      .filter(key => raw[key] !== undefined).map(key => [key, raw[key]])), raw };
}

function compareScalar(fields, expected, observed) {
  return fields.map(field => ({ field, retained: expected[field], cache: observed[field],
    status: expected[field] === observed[field] ? 'match' : 'mismatch' }));
}

export function compareRetained(definitions, quests, achievements) {
  const listQuests = quests.filter(row => row.listEntry), qnames = bucket(listQuests), anames = bucket(achievements);
  const questNames = Object.keys(definitions.quests ?? {});
  const questNameRows = questNames.map(name => {
    const q = qnames.get(nameKey(name)) ?? [], a = anames.get(nameKey(name)) ?? [];
    return { name, questIds: q.map(row => row.id), achievementIds: a.map(row => row.id),
      status: q.length === 1 ? 'unique-quest' : q.length > 1 ? 'ambiguous-quest' : a.length === 1 ? 'achievement-only-name' : a.length > 1 ? 'ambiguous-achievement-only-name' : 'unmatched' };
  });
  const questRows = Object.entries(definitions.challenges?.Quest ?? {}).map(([label, raw]) => {
    const name = raw.BaseQuest ?? /~\|([^|]+)\|~/.exec(label)?.[1]?.split('#')[0] ?? label;
    const candidates = qnames.get(nameKey(name)) ?? [], wholeCompletion = Object.hasOwn(raw, 'QuestPoints');
    return { label, name, wholeCompletion, questIds: candidates.map(row => row.id),
      status: candidates.length === 1 ? 'unique-name' : candidates.length > 1 ? 'ambiguous-name' : 'unmatched',
      metadata: wholeCompletion && candidates.length === 1 ? compareScalar(['questPoints', 'members'],
        { questPoints: raw.QuestPoints, members: !!raw['Not F2P'] }, candidates[0]) : [],
      authoredFields: Object.keys(raw), replacement: wholeCompletion && candidates.length === 1
        ? 'name-members-points candidate; retained chunks, task dependencies and rewards still require authored data'
        : 'step/miniquest requirements and location dependencies remain authored' };
  });
  const achievementRows = Object.entries(definitions.challenges?.Diary ?? {}).map(([label, raw]) => {
    const suffix = label.replace(/^~\|[^|]+\|~\s*/, '');
    const candidates = anames.get(nameKey(suffix)) ?? [];
    const cache = candidates.length === 1 ? candidates[0] : null;
    return { label, name: suffix, achievementIds: candidates.map(row => row.id),
      status: candidates.length === 1 ? 'unique-name' : candidates.length > 1 ? 'ambiguous-name' : 'unmatched',
      metadata: cache ? [
        ...(raw.RuneScore === undefined ? [] : compareScalar(['runescore'], { runescore: raw.RuneScore }, cache)),
        ...(raw.Description === undefined ? [] : [{ field: 'description', retained: plainText(raw.Description),
          cache: plainText(cache.description?.descr), status: plainText(raw.Description) === plainText(cache.description?.descr) ? 'match' : 'mismatch' }]),
      ] : [], authoredFields: Object.keys(raw),
      replacement: cache ? 'name-description-score candidate; locations, access, step dependencies and item gates remain authored' : 'unresolved name' };
  });
  const tally = rows => Object.fromEntries([...new Set(rows.map(row => row.status))].map(key => [key, rows.filter(row => row.status === key).length]));
  const metadataTally = rows => {
    const fields = rows.flatMap(row => row.metadata), result = {};
    for (const field of new Set(fields.map(row => row.field))) result[field] = tally(fields.filter(row => row.field === field));
    return result;
  };
  return { normalization: 'NFC, case, whitespace, curly apostrophes and cache display tags only; no fuzzy or hand-picked aliases',
    summary: { retainedQuestNames: questNames.length, questNames: tally(questNameRows),
      questTaskRows: questRows.length, wholeQuestCompletionRows: questRows.filter(row => row.wholeCompletion).length,
      questRows: tally(questRows), questMetadata: metadataTally(questRows),
      achievementTaskRows: achievementRows.length, achievementRows: tally(achievementRows), achievementMetadata: metadataTally(achievementRows),
      replacementEstimates: { wholeQuestNameMembersPointsCandidates: questRows.filter(row => row.wholeCompletion && row.status === 'unique-name').length,
        achievementNameDescriptionScoreCandidates: achievementRows.filter(row => row.status === 'unique-name').length,
        completeQuestStepReplacement: 0, completeAchievementTaskReplacement: 0 } },
    questNameRows, questRows, achievementRows };
}

export function buildWikiEvidence(apiJson, quests, achievements) {
  const samples = { "Cook's Assistant": 'quest', "Gunnar's Ground": 'quest', 'Dragon Slayer': 'quest',
    'Yoink!': 'achievement', 'Lumbridge Strikes Back': 'achievement' };
  return Object.values(apiJson.query?.pages ?? {}).map(page => {
    const revision = page.revisions?.[0], text = revision?.slots?.main?.['*'] ?? '';
    const kind = samples[page.title];
    if (!kind) return { title: page.title, status: 'unplanned-sample' };
    const fieldValue = key => new RegExp(`^\\|${key}\\s*=\\s*([^\\n]+)`, 'm').exec(text)?.[1]?.trim();
    const sample = { id: Number(fieldValue('id')) };
    if (kind === 'quest') Object.assign(sample, { members: fieldValue('members') === undefined ? null : fieldValue('members') === 'Yes',
      difficulty: fieldValue('difficulty'), length: fieldValue('length'), questPoints: Number(fieldValue('qp')) });
    else Object.assign(sample, { f2pFlag: fieldValue('members') === undefined ? null : fieldValue('members') === 'No', runescore: Number(fieldValue('score')) });
    if (page.title === 'Dragon Slayer') sample.questPointRequirement = Number(/\{\{Skillreq\|Quest points\|(\d+)\}\}/.exec(text)?.[1]);
    if (page.title === "Gunnar's Ground" || page.title === 'Yoink!') {
      const match = /\{\{Skillreq\|(Crafting|Thieving)\|(\d+)\}\}/.exec(text);
      sample.skills = match ? [{ skill: SKILL_NAMES.indexOf(match[1]), level: Number(match[2]) }] : null;
    }
    const record = (kind === 'quest' ? quests : achievements).find(row => row.id === sample.id);
    const scalar = kind === 'quest' ? { id: record?.id, members: record?.members,
      difficulty: record?.difficulty?.label, length: record?.length?.label, questPoints: record?.questPoints }
      : { id: record?.id, f2pFlag: record?.f2pFlag, runescore: record?.runescore };
    if (sample.questPointRequirement !== undefined) scalar.questPointRequirement = record?.requirements?.questPoints;
    if (sample.skills) scalar.skills = (kind === 'quest' ? record?.requirements.skills : record?.encodedRequirements.skills)
      ?.map(row => ({ skill: row.skill, level: row.level }));
    const fields = Object.keys(sample).map(field => ({ field, wiki: sample[field], cache: scalar[field],
      status: sample[field] === undefined || sample[field] === null || (typeof sample[field] === 'number' && !Number.isFinite(sample[field]))
        ? 'wiki-field-missing' : JSON.stringify(sample[field]) === JSON.stringify(scalar[field]) ? 'match' : 'mismatch' }));
    // Extracted evidence remains short. Full response is retained only in scratch.
    const evidenceLines = text.split('\n').filter(line => /^\|(id|members|difficulty|length|score|qp)\s*=/.test(line)
      || /^\* \{\{Skillreq\|(Crafting\|5|Thieving\|5|Quest points\|33)\}\}/.test(line));
    return { title: page.title, pageId: page.pageid, revisionId: revision?.revid,
      revisionTimestamp: revision?.timestamp, revisionUrl: `https://runescape.wiki/w/Special:PermanentLink/${revision?.revid}`,
      responsePageSha256: sha256(JSON.stringify(page)), evidenceLines, fields,
      status: fields.every(row => row.status === 'match') ? 'match' : 'mismatch',
      interpretation: 'Fields parsed from this exact Wiki revision; requirements limited to the named sample fields, no whole-catalog validation claim.' };
  });
}

export async function extractQuestsAchievements({ workspace, output, build = 950, wikiSnapshot = null } = {}) {
  if (!output) throw new Error('A new output directory is required');
  const { cache, context } = await openGameCache({ workspace, build });
  try {
    const tables = {
      quests: loadTable(cache, { major: 2, minor: 35, kind: 'quest' }),
      achievements: loadTable(cache, { major: 57, groupSize: 128, kind: 'achievement' }),
      enums: loadTable(cache, { major: 17, groupSize: 256, kind: 'enum' }),
      structs: loadTable(cache, { major: 22, groupSize: 32, kind: 'struct' }),
      params: loadTable(cache, { major: 2, minor: 11, kind: 'param' }),
    };
    const errors = Object.entries(tables).flatMap(([table, value]) => value.errors.map(row => ({ table, ...row })));
    const qd = tables.quests.definitions, ad = tables.achievements.definitions, ed = tables.enums.definitions;
    const quests = [...qd].map(([id, raw]) => normalizeQuest(id, raw, qd, ed));
    const achievements = [...ad].map(([id, raw]) => normalizeAchievement(id, raw, ad, qd));
    const reference = JSON.parse(readFileSync(context.reference.path, 'utf8'));
    const comparison = compareRetained(reference, quests, achievements);
    const provenance = { generatedAt: context.generatedAt, decoder: context.decoder, reference: context.reference,
      manifest: 'quests-achievements.manifest.v1.json', status: 'advisory; no runtime integration' };
    const script = cache.file(12, 4011);
    const enumPosition = script?.indexOf(Buffer.from([0, 0, 52, 42])) ?? -1;
    const paramPosition = script?.indexOf(Buffer.from([0, 0, 30, 175])) ?? -1;
    const lengthEvidence = { schemaField: 'quest extra param7855', paramDefinition: tables.params.definitions.get(7855),
      enumId: 13354, enumDefinition: ed.get(13354), script: { major: 12, minor: 4011,
        containsLengthLabel: script?.toString('latin1').includes('>Length:</col>') ?? false,
        enumPosition, paramPosition, adjacentConstantBytesHex: enumPosition < 0 ? null : script.subarray(enumPosition - 2, paramPosition + 9).toString('hex'),
        limitation: 'Byte adjacency is supporting evidence; obfuscated client opcodes were not executed or fully decompiled.' } };
    const wikiEvidence = wikiSnapshot ? buildWikiEvidence(JSON.parse(readFileSync(wikiSnapshot, 'utf8')), quests, achievements) : [];
    const counts = { questConfigs: quests.length, namedQuestListEntries: quests.filter(row => row.listEntry).length,
      questListEntriesWithoutDiscontinuedFlag: quests.filter(row => row.listEntry && row.discontinuedStatus === null).length,
      achievements: achievements.length, removedAchievements: achievements.filter(row => row.removed).length,
      enums: ed.size, structs: tables.structs.definitions.size, params: tables.params.definitions.size, decodeErrors: errors.length,
      questsWithSkills: quests.filter(row => row.requirements.skills.length).length,
      questsWithQuestRequirements: quests.filter(row => row.requirements.quests.length).length,
      questsWithLengthParam: quests.filter(row => row.length.code !== null).length,
      achievementsWithSkillArrays: achievements.filter(row => row.encodedRequirements.skills.length || row.encodedRequirements.skills2.length).length,
      achievementsWithStateConditions: achievements.filter(row => Object.keys(row.stateConditions).length).length };
    const limits = ['Quest list entries include subquests and discontinued seasonal entries; counts are not a live-game quest total.',
      'Associated quest IDs, child achievement IDs, previous achievement IDs, skill arrays and varbit tests retain distinct schema meanings.',
      'Unknown selectors/type/ironman fields remain encoded. State tests do not certify server gates or current completion.',
      'Structs/enums/params are retained as typed support tables; an integer or typed reference alone is not classified as a requirement.',
      'No internal filename database exists in this local cache snapshot; semantic names for extra params could not be read.',
      'Authored quest steps, chunk geography, exact item gates, XP/reward parsing and account conditions remain necessary.'];
    context.limits.push(...limits);
    const summary = { schemaVersion: 1, provenance, counts, comparison: comparison.summary, lengthEvidence, wikiEvidence,
      samples: { quests: quests.filter(row => row.listEntry && [257, 341, 66].includes(row.id)),
        achievements: achievements.filter(row => [448, 1248].includes(row.id)) }, limits };
    for (const [name, data] of [
      ['quests.v1.json', { schemaVersion: 1, provenance, counts, records: quests, errors: tables.quests.errors }],
      ['achievements.v1.json', { schemaVersion: 1, provenance, counts, records: achievements, errors: tables.achievements.errors }],
      ['quests-achievements.support.v1.json', { schemaVersion: 1, provenance,
        note: 'Typed raw support tables, not automatically interpreted requirement rules.',
        tables: Object.fromEntries(['enums', 'structs', 'params'].map(name => [name, { definitions: [...tables[name].definitions], errors: tables[name].errors }])) }],
      ['quests-achievements.comparison.v1.json', { schemaVersion: 1, provenance, ...comparison }],
      ['quests-achievements.summary.v1.json', summary],
    ]) context.outputs.push(writeDataset(output, name, data));
    const result = await finishManifest(cache, context, output, { name: 'quests-achievements.manifest.v1.json', counts,
      extraction: 'quests-achievements', errors, wikiSnapshot: wikiSnapshot ? { sha256: sha256(readFileSync(wikiSnapshot)),
        revisionIds: wikiEvidence.map(row => row.revisionId) } : null });
    return { summary, outputs: context.outputs, manifest: result.file };
  } finally { cache.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = cliOptions();
  for (const key of Object.keys(options)) if (!['workspace', 'output', 'build', 'wiki-snapshot'].includes(key)) throw new Error(`Unknown --${key}`);
  const result = await extractQuestsAchievements({ workspace: options.workspace, output: options.output,
    build: Number(options.build ?? 950), wikiSnapshot: options['wiki-snapshot'] });
  console.log(JSON.stringify({ counts: result.summary.counts, comparison: result.summary.comparison,
    manifest: result.manifest }, null, 2));
}
