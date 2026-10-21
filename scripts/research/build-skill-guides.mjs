import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256RepositoryText, sha256 } from '../lib/provenance-hash.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const plain = value => String(value ?? '').replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0])
  .replace(/<[^>]+>/g, ' ').replace(/\*+$/g, '').replace(/&amp;/g, '&').trim();
const key = value => plain(value).toLowerCase().replace(/\s+/g, ' ');
const caps = { Attack: 120, Strength: 120, Ranged: 120, Runecrafting: 110, Crafting: 110, Mining: 110,
  Smithing: 110, Firemaking: 110, Woodcutting: 110, Fletching: 110, Dungeoneering: 120,
  Archaeology: 20, Construction: 20, Necromancy: 20, Agility: 5, Herblore: 5, Thieving: 5,
  Farming: 5, Hunter: 5, Slayer: 5, Divination: 5, Summoning: 5, Invention: 0 };
export const isF2PGuideEntry = entry => entry.members === false && Number.isSafeInteger(entry.level)
  && entry.level >= 1 && entry.level <= (caps[entry.skill] ?? 99);

/** Exact output/link-label candidates only. An icon is a UI item reference,
 * not proof that the action creates or consumes that item. Candidate joins
 * remain review data and never rewrite an authored task. */
export function compareSkillGuides(guide, definitions, training) {
  const comparisons = guide.entries.map(entry => {
    const names = new Set([entry.name, entry.item?.name].filter(Boolean).map(key));
    const tasks = Object.entries(definitions.challenges?.[entry.skill] ?? {}).flatMap(([label, record]) => {
      const links = [...label.matchAll(/~\|([^|]+)\|~/g)].map(match => match[1].split('#')[0]);
      const outputs = list(record.Output).filter(value => typeof value === 'string');
      const exactLabel = names.has(key(label));
      const outputMatches = outputs.filter(value => names.has(key(value)));
      const linkMatches = links.filter(value => names.has(key(value)));
      if (!exactLabel && !outputMatches.length && !linkMatches.length) return [];
      return [{ label, level: record.Level ?? 1, members: Boolean(record['Not F2P'] ?? record.NotF2P),
        join: exactLabel ? 'exact-label' : outputMatches.length ? 'same-skill-output-item' : 'exact-linked-label',
        matchedNames: [...outputMatches, ...linkMatches], levelAgrees: Number(record.Level ?? 1) === entry.level }];
    });
    const methods = training.methods.filter(method => method.skill === entry.skill).flatMap(method => {
      const matches = (method.matches ?? []).filter(label => tasks.some(task => task.label === label));
      const itemMatches = [...(method.outputs ?? []), ...(entry.skill === 'Firemaking' ? method.inputs ?? [] : [])]
        .filter(item => names.has(key(item.item)));
      if (!matches.length && !itemMatches.length && !names.has(key(method.label))) return [];
      return [{ id: method.id, label: method.label, level: method.level, levelAgrees: method.level === entry.level,
        join: matches.length ? 'authored-task-link' : 'same-skill-item-candidate' }];
    });
    return { entryId: entry.id, structId: entry.structId, skill: entry.skill, name: entry.name, level: entry.level,
      category: entry.category, members: entry.members, f2pWithinCap: isF2PGuideEntry(entry),
      tasks, trainingMethods: methods, status: tasks.length ? 'candidate-match' : 'no-exact-candidate',
      ambiguity: tasks.length > 1, levelDisagreements: tasks.filter(task => !task.levelAgrees) };
  });
  const bySkill = guide.skills.map(skill => {
    const rows = comparisons.filter(row => row.skill === skill.name), f2p = rows.filter(row => row.f2pWithinCap);
    return { skill: skill.name, guideEntries: rows.length, freeFlags: rows.filter(row => row.members === false).length,
      f2pWithinCap: f2p.length, members: rows.filter(row => row.members === true).length,
      unknownMembership: rows.filter(row => row.members === null).length,
      pickerTasks: Object.keys(definitions.challenges?.[skill.name] ?? {}).length,
      matchedEntries: rows.filter(row => row.tasks.length).length,
      missingEntries: rows.filter(row => !row.tasks.length).length,
      f2pMatched: f2p.filter(row => row.tasks.length).length, f2pMissing: f2p.filter(row => !row.tasks.length).length,
      levelDisagreementEntries: rows.filter(row => row.levelDisagreements.length).length,
      trainingMethods: training.methods.filter(method => method.skill === skill.name).length,
      guideEntriesWithTrainingCandidates: rows.filter(row => row.trainingMethods.length).length };
  });
  return { schemaVersion: 1, semantics: 'Exact-name/output candidates, not complete semantic task coverage. Multiple activities can share an icon or product; all disagreements remain advisory.',
    counts: { entries: comparisons.length, candidateMatches: comparisons.filter(row => row.tasks.length).length,
      missing: comparisons.filter(row => !row.tasks.length).length, f2pWithinCap: comparisons.filter(row => row.f2pWithinCap).length,
      f2pMissing: comparisons.filter(row => row.f2pWithinCap && !row.tasks.length).length,
      ambiguous: comparisons.filter(row => row.ambiguity).length,
      disagreementEntries: comparisons.filter(row => row.levelDisagreements.length).length,
      trainingCandidateEntries: comparisons.filter(row => row.trainingMethods.length).length }, bySkill, comparisons };
}

export function reliableTrainingBreakpoints(guide, training) {
  // Explicit guide activities and reviewed training methods must agree. No
  // item icon or arbitrary guide level can modify a method or XP/hour model.
  const reviewed = {
    'woodcutting.normal': 'Normal tree', 'woodcutting.oak': 'Oak tree', 'woodcutting.willow': 'Willow tree',
    'woodcutting.teak': 'Teak tree', 'woodcutting.maple': 'Maple tree', 'woodcutting.acadia': 'Acadia tree',
    'woodcutting.yew': 'Yew tree', 'mining.copper': 'Copper ore', 'mining.tin': 'Tin ore',
    'mining.iron': 'Iron ore', 'mining.coal': 'Coal', 'mining.mithril': 'Mithril ore',
    'mining.adamantite': 'Adamantite ore', 'mining.luminite': 'Luminite', 'mining.runite': 'Runite ore',
    'cooking.crayfish': 'Crayfish', 'cooking.trout': 'Trout', 'cooking.lobster': 'Lobster',
    'runecrafting.air': 'Air runes', 'runecrafting.water': 'Water runes',
  };
  return Object.entries(reviewed).flatMap(([methodId, name]) => {
    const method = training.methods.find(value => value.id === methodId);
    if (!method) return [];
    const entries = guide.entries.filter(entry => entry.skill === method.skill && key(entry.name) === key(name)
      && isF2PGuideEntry(entry) && !/Dungeoneering|Milestones/i.test(entry.category?.name ?? ''));
    if (!entries.length || entries.some(entry => entry.level !== method.level)) return [];
    return [{ skill: method.skill, level: method.level, members: false, entryIds: entries.map(entry => entry.id), methodIds: [methodId],
      evidence: 'Reviewed activity identity; direct guide level agrees with existing sourced training method. Advisory breakpoint only.' }];
  });
}

/** Four validated no-burn level unlocks reuse exact authored cooking selectors.
 * These objectives produce nothing and do not establish a training method. */
export function proposeGeneratedGuideTasks(guide, definitions, wiki) {
  if (!wiki) return [];
  const reviewed = [[33701, 'Shrimps', 'Shrimps'], [33702, 'Crayfish', 'Crayfish'],
    [33713, 'Trout', 'Trout'], [33730, 'Lobster', 'Lobster']];
  return reviewed.flatMap(([structId, title, product]) => {
    const entry = guide.entries.find(value => value.structId === structId && value.skill === 'Cooking');
    const facts = wiki.samples?.find(value => value.title === title)?.facts;
    const page = wiki.samples?.find(value => value.title === title);
    if (!entry || !isF2PGuideEntry(entry) || entry.requirementText || !facts || facts.noBurnLevel !== entry.level
      || facts.members !== false || !page.url) return [];
    const candidates = Object.entries(definitions.challenges?.Cooking ?? {}).filter(([label, record]) =>
      list(record.Output).includes(product) && /^Cook /i.test(plain(label)) && !record['Not F2P']);
    if (candidates.length !== 1) return [];
    const [sourceLabel, original] = candidates[0];
    const label = `Unlock no-burn ${title.toLowerCase()} cooking (standard fire/range)`;
    if (definitions.challenges.Cooking[label]) return [];
    const selectorFields = ['Items', 'Objects', 'Chunks', 'Tasks', 'Skills'];
    const selectors = Object.fromEntries(selectorFields.filter(field => original[field] !== undefined)
      .map(field => [field, structuredClone(original[field])]));
    if (!list(selectors.Items).length) return [];
    return [{ category: 'Cooking', label, entryIds: [entry.id], record: { ...selectors,
      PickerId: `rs3:task:skill-guide:cooking-no-burn:${structId}`, Level: entry.level,
      Primary: false, NoBoost: true, Category: ['Skill guide unlock'],
      Description: 'Reach the standard no-burn level with a reachable raw ingredient. Cooking gauntlets and special ranges have separate thresholds. This milestone produces no item.' },
      selectorEvidence: { sourceCategory: 'Cooking', sourceLabel, selectors, structId,
        wiki: { title, url: page.url, revisionId: page.revisionId, noBurnLevel: facts.noBurnLevel, members: facts.members },
        objective: 'Level unlock milestone using an existing exact raw-ingredient selector; not a new recipe or source.' } }];
  });
}

export function reviewedGuideMetadataCorrections(guide, definitions, wiki) {
  const label = 'Cook a ~|trout|~', original = definitions.challenges?.Cooking?.[label];
  const page = wiki?.samples?.find(sample => sample.title === 'Trout');
  const entries = guide.entries.filter(entry => entry.skill === 'Cooking' && entry.name === 'Trout'
    && entry.level === 15 && entry.members === false && !/Dungeoneering/.test(entry.category?.name ?? ''));
  if (!original || original.Level !== 15 || original['Not F2P'] !== true || !entries.length
    || page?.facts.members !== false || page.facts.level !== 15) return [];
  return [{ category: 'Cooking', label, changes: [{ field: 'Not F2P', before: true, after: false }],
    entryIds: entries.map(entry => entry.id), wiki: { title: page.title, url: page.url, revisionId: page.revisionId, members: false, level: 15 },
    rationale: 'Exact ordinary trout-cooking row has no members-only location/equipment gate; guide and Wiki recipe both mark the action free.' }];
}

export function buildSkillGuideArtifacts({ guidePath, manifestPath, output = 'app/data/skill-guides.2026-10-08.v1.json',
  report = 'docs/research/skill-guides-comparison.2026-10-08.v1.json', wikiPath, combatPath }) {
  const read = file => readFileSync(resolve(file));
  const guide = JSON.parse(read(guidePath)), definitions = JSON.parse(read('rs3-chunkpicker-chunkinfo-export.json')),
    training = JSON.parse(read('app/data/training/methods.f2p.json'));
  const provenance = { guide: { path: guidePath.replaceAll('\\', '/'), sha256: sha256(read(guidePath)), hashScope: 'external bytes' },
    decoder: guide.provenance?.decoder ?? null, extractor: guide.provenance?.extractor ?? null,
    ...(manifestPath ? { manifest: { path: manifestPath.replaceAll('\\', '/'), sha256: sha256(read(manifestPath)) } } : {}),
    reference: { path: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(read('rs3-chunkpicker-chunkinfo-export.json')) },
    training: { path: 'app/data/training/methods.f2p.json', sha256: sha256RepositoryText(read('app/data/training/methods.f2p.json')) },
    builder: { path: 'scripts/research/build-skill-guides.mjs', sha256: sha256RepositoryText(read('scripts/research/build-skill-guides.mjs')) } };
  const wiki = wikiPath ? JSON.parse(read(wikiPath)) : null;
  const combat = combatPath ? JSON.parse(read(combatPath)) : null;
  if (combatPath) provenance.combat = { path: combatPath.replaceAll('\\', '/'), sha256: sha256(read(combatPath)), hashScope: 'external bytes' };
  if (wikiPath) provenance.wikiValidation = { path: wikiPath, sha256: sha256RepositoryText(read(wikiPath)), hashScope: 'LF-normalized text' };
  const metadataCorrections = reviewedGuideMetadataCorrections(guide, definitions, wiki);
  const generationDefinitions = metadataCorrections.length ? { ...definitions, challenges: { ...definitions.challenges,
    Cooking: { ...definitions.challenges.Cooking, [metadataCorrections[0].label]: { ...definitions.challenges.Cooking[metadataCorrections[0].label], 'Not F2P': false } } } } : definitions;
  const generatedTasks = proposeGeneratedGuideTasks(guide, generationDefinitions, wiki);
  const comparison = { ...compareSkillGuides(guide, definitions, training), provenance, generatedTasks, metadataCorrections,
    generatedTaskPolicy: 'Only four Wiki/cache-validated no-burn milestones with exact authored ingredient selectors. No automatic tasks from item icons, umbrella unlocks, unresolved requirements or Dungeoneering products.' };
  const compact = { schemaVersion: 1, version: '2026-10-08.v1', provenance, skills: guide.skills,
    entries: guide.entries.map(({ rawParams, evaluation, rawTitle, rawRequirementText, membersOrigin, requirementTextScope, flag2219, ...entry }) => entry),
    semantics: { requirementText: 'Rendered guide description; levelUpText separately preserves level-up/requirement text. Neither certifies complete executable gates.',
      item: 'Display item/linked typed records. Icons do not certify outputs, consumption or map sources.',
      members: 'Evaluated guide UI membership including inherited and production overrides; not server eligibility.' },
    ...(combat ? { combat: { summary: combat.summary, fieldSemantics: combat.fieldSemantics,
      actions: combat.actions.map(({ rawParams, enumReferences, guideReferences, ...action }) => action) } } : {}),
    generatedTasks, metadataCorrections,
    trainingBreakpoints: reliableTrainingBreakpoints(guide, training), coverage: comparison.bySkill,
    limitations: ['Guide levels/flags describe client guide entries, not complete server eligibility.',
      'Item links may be display icons. They are never automatically treated as action outputs, ingredients or location selectors.',
      'Generated unlock objectives and combat corrections require separate switches, both default OFF.',
      'Training breakpoints are advisory metadata; rates, method eligibility and XP units are unchanged.'] };
  writeFileSync(resolve(output), `${JSON.stringify(compact)}\n`);
  writeFileSync(resolve(report), `${JSON.stringify(comparison)}\n`);
  return { counts: comparison.counts, runtimeEntries: compact.entries.length, generatedTasks: generatedTasks.length, trainingBreakpoints: compact.trainingBreakpoints.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--guide', '--manifest', '--output', '--report', '--wiki', '--combat'].includes(args[index]) || !args[index + 1]) throw new TypeError('Expected --guide PATH [--manifest PATH] [--wiki PATH] [--combat PATH] [--output PATH] [--report PATH]');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.guide) throw new TypeError('--guide is required');
  console.log(JSON.stringify(buildSkillGuideArtifacts({ guidePath: options.guide, manifestPath: options.manifest,
    output: options.output, report: options.report, wikiPath: options.wiki, combatPath: options.combat })));
}
