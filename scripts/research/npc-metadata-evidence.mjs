import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseWikiTemplates, wikiTemplateVariants, wikiPlainText, wikiNumber, hasWikiFieldConflict } from './equipment-wiki.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { collectPickerNpcNames } from '../cache/game-data-npcs.mjs';

export const NPC_EVIDENCE_LIMITS = [
  'Combat corrections fill only the previously empty NPC metadata namespace for an exact retained label; names, counts, locations, drops and tasks are unchanged.',
  'Every exact-name cache candidate must have the same explicit combat level; at least one matching explicit Wiki NPC ID must confirm it, and all Wiki variants for that name must agree.',
  'Membership remains unknown: the pinned NPC schema has no overall members field. Member-only actions cannot establish membership.',
  'Combat parameter semantics are inferred from independent ID-bound Wiki samples, not documented by the client schema. Unmatched parameters and absent values remain unknown.',
  'Life points were not identified. A numeric coincidence with maximum-hit parameter 641 is not a life-point mapping.',
  'Client definitions do not certify server spawns, placement counts, drops, shop stock, prices or respawn times.',
];

export function parseNpcWikiPage(page) {
  const revision = page?.revisions?.[0];
  const content = revision?.slots?.main?.content ?? revision?.['*'] ?? page?.content ?? '';
  const revisionId = revision?.revid ?? page?.revisionId ?? null;
  return { title: page?.title, missing: Boolean(page?.missing), revisionId,
    url: `https://runescape.wiki/w/${encodeURIComponent(String(page?.title).replace(/ /g, '_'))}?oldid=${revisionId ?? ''}`,
    variants: parseWikiTemplates(content).filter(t => /^Infobox (Monster|NPC)$/i.test(t.name)).flatMap(wikiTemplateVariants),
  };
}

const identityFields = ['name', 'id', 'version', 'bucketname'];
/** Multiple ID-bound variants may agree on a field; no suffix position or name-only binding. */
export function resolveNpcWikiNumber(parsed, id, field) {
  const candidates = parsed.variants.filter(v => v.ids.includes(id));
  if (!candidates.length) return { value: null, reason: 'no-explicit-wiki-id', variants: [] };
  if (candidates.some(v => hasWikiFieldConflict(v, [...identityFields, field]))) return { value: null, reason: 'conflicting-wiki-fields', variants: [] };
  const values = candidates.map(v => wikiNumber(v.fields[field]));
  if (values.some(value => value === null)) return { value: null, reason: 'missing-or-nonliteral-wiki-field', variants: candidates.map(v => v.version) };
  if (new Set(values).size !== 1) return { value: null, reason: 'wiki-id-variant-disagreement', variants: candidates.map(v => v.version) };
  return { value: values[0], reason: null, variants: candidates.map(v => v.version), fields: [...new Set(candidates.map(v => v.fieldSources[field]))] };
}

export function proposeNpcCombatCorrection({ label, candidates, parsed, cache }) {
  if (!candidates.length) return { correction: null, reason: 'no-exact-cache-name' };
  if (!parsed.revisionId || parsed.missing) return { correction: null, reason: 'missing-wiki-revision' };
  if (candidates.some(row => (row.normalizedName ?? row.name) !== label)) return { correction: null, reason: 'non-exact-cache-name' };
  const levels = candidates.map(row => row.combatLevel);
  if (levels.some(level => !Number.isInteger(level) || level < 0)) return { correction: null, reason: 'unknown-cache-combat-level' };
  if (new Set(levels).size !== 1) return { correction: null, reason: 'cache-name-variant-level-disagreement' };
  const variants = parsed.variants.filter(v => v.name === label);
  if (!variants.length || variants.some(v => hasWikiFieldConflict(v, [...identityFields, 'level']) || wikiNumber(v.fields.level) !== levels[0])) return { correction: null, reason: 'wiki-name-variant-level-disagreement-or-unknown' };
  const bound = candidates.map(row => ({ row, result: resolveNpcWikiNumber(parsed, row.id, 'level') })).filter(({ result }) => !result.reason);
  if (!bound.length) return { correction: null, reason: 'no-confirmed-explicit-wiki-id' };
  if (bound.some(({ result }) => result.value !== levels[0])) return { correction: null, reason: 'cache-wiki-combat-mismatch' };
  return { reason: null, correction: { label, field: 'combatLevel', before: null, after: levels[0], combatLevel: levels[0],
    cacheIds: bound.map(({ row }) => row.id),
    cache: { ...cache, field: 'combatLevel; explicit opcode 0x5f', allCandidateIds: candidates.map(row => row.id),
      candidates: candidates.map(row => ({ id: row.id, combatLevel: row.combatLevel, source: row.source, definitionSha256: row.definitionSha256 })) },
    wiki: { url: parsed.url, revisionId: parsed.revisionId, field: [...new Set(bound.flatMap(({ result }) => result.fields))],
      variants: [...new Set(bound.flatMap(({ result }) => result.variants))] },
  } };
}

const numericParam = (row, prop) => {
  const params = row.params.filter(p => p.prop === prop);
  return params.length === 1 && Number.isFinite(params[0].intvalue) ? params[0].intvalue : null;
};

export function calibrateNpcParam({ rows, parsedPages, prop, divisor, wikiField, field, sampleIds }) {
  const samples = sampleIds.map(id => {
    const row = rows.find(r => r.id === id), parsed = parsedPages.find(p => p.variants.some(v => v.ids.includes(id)));
    const result = parsed ? resolveNpcWikiNumber(parsed, id, wikiField) : { value: null, reason: 'no-wiki-page' };
    const rawValue = row ? numericParam(row, prop) : null;
    return { id, name: row?.name ?? null, param: prop, divisor, rawValue, expectedValue: result.value,
      matches: rawValue !== null && result.value !== null && rawValue / divisor === result.value && !result.reason,
      wiki: parsed ? { url: parsed.url, revisionId: parsed.revisionId, field: result.fields ?? [], variants: result.variants ?? [] } : null,
      cache: row ? { source: row.source, definitionSha256: row.definitionSha256 } : null };
  });
  const independentNames = [...new Set(samples.filter(s => s.matches).map(s => s.name))];
  const validated = samples.length >= 2 && samples.every(s => s.matches) && independentNames.length >= 2;
  return { field, param: prop, divisor, wikiField, validated, independentNames,
    status: validated ? 'inferred-and-sample-calibrated' : 'unvalidated-candidate', samples };
}

/** Search every retained numeric parameter for a common LP mapping across independent samples. */
export function inspectLifePointCandidates(rows, parsedPages, sampleIds) {
  const samples = sampleIds.map(id => {
    const row = rows.find(r => r.id === id), parsed = parsedPages.find(p => p.variants.some(v => v.ids.includes(id)));
    return { id, name: row?.name, expectedLifePoints: parsed ? resolveNpcWikiNumber(parsed, id, 'lifepoints').value : null,
      numericParams: (row?.params ?? []).filter(p => Number.isFinite(p.intvalue)).map(p => ({ param: p.prop, value: p.intvalue })) };
  });
  const params = [...new Set(samples.flatMap(s => s.numericParams.map(p => p.param)))], divisors = [1, 10, 100, 1000];
  const candidates = params.flatMap(param => divisors.filter(divisor => samples.every(s => s.expectedLifePoints !== null && s.numericParams.filter(p => p.param === param).length === 1 && s.numericParams.find(p => p.param === param).value / divisor === s.expectedLifePoints)).map(divisor => ({ param, divisor })));
  return { status: candidates.length ? 'candidate-needs-further-validation' : 'unavailable-no-common-parameter-mapping', candidates,
    testedDivisors: divisors, samples, limitation: 'This tests common linear scales only. It does not prove no server-side or encoded life-point field exists.' };
}

function compareActions(row, parsed) {
  const variants = parsed.variants.filter(v => v.ids.includes(row.id) && !hasWikiFieldConflict(v, [...identityFields, 'actions', 'options']));
  const wikiOptions = [...new Set(variants.flatMap(v => wikiPlainText(v.fields.actions ?? v.fields.options).split(',').map(s => s.trim()).filter(Boolean)))];
  const cacheOptions = [...new Set([...(row.options ?? []), ...(row.memberOptions ?? [])].filter(Boolean))];
  const normalize = value => value.replace(/^Talk-to$/i, 'Talk to');
  return { cacheOptions, wikiOptions, cacheOnly: cacheOptions.filter(v => !wikiOptions.map(normalize).includes(normalize(v))),
    wikiOnly: wikiOptions.filter(v => !cacheOptions.map(normalize).includes(normalize(v)) && v !== 'Examine'),
    examineStatus: 'Wiki Examine is implicit client interaction, not an NPC action-slot correction', mutationAllowed: false };
}

export async function buildNpcMetadataEvidence({ npcArtifact, wikiSnapshots, reference, output, correctionsOutput }) {
  const npcBytes = await readFile(npcArtifact), dataset = JSON.parse(npcBytes), rows = dataset.records;
  const snapshots = await Promise.all(wikiSnapshots.map(async path => { const bytes = await readFile(path); return { path, sha256: sha256(bytes), snapshot: JSON.parse(bytes) }; }));
  const parsedPages = snapshots.flatMap(({ snapshot }) => snapshot.pages.map(parseNpcWikiPage)).filter(p => p.variants.length);
  const refBytes = await readFile(reference), retained = collectPickerNpcNames(JSON.parse(refBytes));
  const byName = new Map();
  for (const row of rows) { const name = row.normalizedName ?? row.name; if (!name) continue; const group = byName.get(name) ?? []; group.push(row); byName.set(name, group); }
  const cache = { artifact: npcArtifact.replaceAll('\\', '/'), sha256: sha256(npcBytes), hashScope: 'raw-file-bytes' };
  const corrections = [], records = [];
  for (const parsed of parsedPages) {
    const label = parsed.title, candidates = byName.get(label) ?? [], referenceRow = retained.find(r => r.normalizedName === label);
    const result = referenceRow ? proposeNpcCombatCorrection({ label: referenceRow.name, candidates, parsed, cache }) : { correction: null, reason: 'not-exact-retained-label' };
    if (result.correction) corrections.push(result.correction);
    records.push({ label, retained: Boolean(referenceRow), origins: referenceRow?.origins ?? [], cacheCandidateCount: candidates.length,
      cacheLevels: [...new Set(candidates.map(r => r.combatLevel))],
      cacheCandidates: candidates.map(r => ({ id: r.id, combatLevel: r.combatLevel })),
      wiki: { url: parsed.url, revisionId: parsed.revisionId, variants: parsed.variants.map(v => ({ name: v.name, version: v.version, ids: v.ids, combatLevel: wikiNumber(v.fields.level), members: wikiPlainText(v.fields.members), fields: { level: v.fieldSources.level ?? null, members: v.fieldSources.members ?? null } })) },
      correctionStatus: result.reason ?? 'confirmed', membershipStatus: 'unknown-cache-schema-has-no-overall-members-field',
      byIdValidation: candidates.filter(row => parsed.variants.some(v => v.ids.includes(row.id))).map(row => {
        const level = resolveNpcWikiNumber(parsed, row.id, 'level');
        return { id: row.id, cacheCombatLevel: row.combatLevel, wikiCombatLevel: level.value,
          combatLevelStatus: level.reason ?? (row.combatLevel === level.value ? 'confirmed-by-id' : 'cache-wiki-mismatch'),
          wikiFields: level.fields ?? [], wikiVersions: level.variants, actions: compareActions(row, parsed) };
      }),
    });
  }
  const calibration = [
    { field: 'maxMeleeHit', prop: 641, divisor: 10, wikiField: 'max_melee', sampleIds: [41,81,117,59] },
    { field: 'maxMagicHit', prop: 965, divisor: 10, wikiField: 'max_magic', sampleIds: [82,13,172,174] },
    { field: 'meleeAccuracy', prop: 29, divisor: 1, wikiField: 'acc_melee', sampleIds: [41,81,117,59] },
    { field: 'magicAccuracy', prop: 3, divisor: 1, wikiField: 'acc_magic', sampleIds: [82,13,172,174] },
    { field: 'armour', prop: 2865, divisor: 1, wikiField: 'armour', sampleIds: [41,81,117,59,82,13,172,174] },
  ].map(spec => calibrateNpcParam({ ...spec, rows, parsedPages }));
  const mappings = calibration.filter(row => row.validated).map(row => ({ field: row.field, param: row.param, divisor: row.divisor,
    status: row.status, samples: row.samples.map(sample => ({ id: sample.id, name: sample.name, rawValue: sample.rawValue,
      expectedValue: sample.expectedValue, source: { url: sample.wiki.url, revid: sample.wiki.revisionId, field: sample.wiki.field }, cache: sample.cache })) }));
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: cache,
    generator: { path: 'scripts/research/npc-metadata-evidence.mjs', sha256: sha256RepositoryText(await readFile(new URL(import.meta.url))), hashScope: 'repository-text-lf' },
    reference: { path: relative(resolve('.'), resolve(reference)).replaceAll('\\', '/'), sha256: sha256RepositoryText(refBytes), hashScope: 'repository-text-lf' },
    wikiSnapshots: snapshots.map(({ path, sha256, snapshot }) => ({ path: path.replaceAll('\\', '/'), sha256, fetchedAt: snapshot.fetchedAt, completedAt: snapshot.completedAt })),
    summary: { cacheRecords: rows.length, sampledNames: records.length, combatLevelCorrections: corrections.length, membershipCorrections: 0,
      byIdCombatMatches: records.flatMap(r => r.byIdValidation).filter(r => r.combatLevelStatus === 'confirmed-by-id').length,
      byIdCombatUnknowns: records.flatMap(r => r.byIdValidation).filter(r => r.wikiCombatLevel === null).length,
      byIdCombatMismatches: records.flatMap(r => r.byIdValidation).filter(r => r.combatLevelStatus === 'cache-wiki-mismatch').length,
      genericLabelsWithheld: records.filter(r => r.correctionStatus !== 'confirmed').length,
      sampledMembershipUnknowns: records.length,
      blockedByCacheVariantLevels: records.filter(r => r.correctionStatus === 'cache-name-variant-level-disagreement').length,
      validatedParamMappings: calibration.filter(r => r.validated).length },
    records, calibration, mappings, lifePoints: inspectLifePointCandidates(rows, parsedPages, [41,81,117,82,13,172,174]), limits: NPC_EVIDENCE_LIMITS };
  const artifact = { schemaVersion: 1, generatedAt: report.generatedAt, evidence: { artifact: relative(resolve('.'), resolve(output)).replaceAll('\\', '/'),
    sha256: sha256RepositoryText(JSON.stringify(report, null, 2) + '\n'), hashScope: 'repository-text-lf' }, corrections, limits: NPC_EVIDENCE_LIMITS };
  for (const path of [output, correctionsOutput]) await mkdir(dirname(path), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await writeFile(correctionsOutput, JSON.stringify(artifact, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
  const report = await buildNpcMetadataEvidence({
    npcArtifact: option('--npcs', 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/npcs-2026-10-08-v3/npcs.v1.json'),
    wikiSnapshots: option('--wiki', 'C:/Users/User/Projects/rs3-cache-work/npcshops-wiki-2026-10-08.v1.json,C:/Users/User/Projects/rs3-cache-work/npcshops-combat-calibration-wiki-2026-10-08.v1.json,C:/Users/User/Projects/rs3-cache-work/npcshops-consensus-wiki-2026-10-08.v1.json').split(','),
    reference: option('--reference', 'rs3-chunkpicker-chunkinfo-export.json'),
    output: option('--output', 'docs/research/npc-wiki-validation.2026-10-08.v1.json'),
    correctionsOutput: option('--corrections', 'app/data/npc-metadata-corrections.2026-10-08.v1.json'),
  });
  console.log(JSON.stringify(report.summary));
}
