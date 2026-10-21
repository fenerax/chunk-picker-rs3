import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseWikiTemplates, wikiNumber } from './equipment-wiki.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

export function validateGuideWikiSamples(guide, snapshot) {
  const specifications = [
    { title: 'Yew', skill: 'Woodcutting', names: ['Yew tree'], template: 'Woodcutting info', levelField: 'level' },
    { title: 'Willow', skill: 'Woodcutting', names: ['Willow tree'], template: 'Woodcutting info', levelField: 'level' },
    { title: 'Acadia tree', skill: 'Woodcutting', names: ['Acadia tree'], template: 'Woodcutting info', levelField: 'level' },
    { title: 'Air rune', skill: 'Runecrafting', names: ['Air rune', 'Air runes'], template: 'Infobox Recipe', levelField: 'skill1lvl' },
    { title: 'Shrimps', skill: 'Cooking', names: ['Shrimp', 'Shrimps'], template: 'Infobox Recipe', levelField: 'skill1lvl', noBurnStructId: 33701 },
    { title: 'Crayfish', skill: 'Cooking', names: ['Crayfish'], template: 'Infobox Recipe', levelField: 'skill1lvl', noBurnStructId: 33702 },
    { title: 'Trout', skill: 'Cooking', names: ['Trout'], template: 'Infobox Recipe', levelField: 'skill1lvl', noBurnStructId: 33713 },
    { title: 'Lobster', skill: 'Cooking', names: ['Lobster'], template: 'Infobox Recipe', levelField: 'skill1lvl', noBurnStructId: 33730 },
    { title: 'Bronze arrow', skill: 'Fletching', names: ['Bronze arrow', 'Bronze arrows'], template: 'Infobox Recipe', levelField: 'skill1lvl' },
  ];
  const samples = specifications.map(spec => {
    const page = snapshot.pages.find(page => page.title === spec.title), revision = page?.revisions?.[0];
    const content = revision?.slots?.main?.content ?? '';
    const templates = parseWikiTemplates(content);
    const template = templates.find(template => template.name === spec.template &&
      (spec.template !== 'Infobox Recipe' || template.fields.skill1 === spec.skill && /^no$/i.test(template.fields.members ?? '')));
    const membersTemplate = templates.find(template => /^Infobox (Scenery|Item)$/.test(template.name));
    const members = /^no$/i.test(membersTemplate?.fields.members ?? template?.fields.members ?? '') ? false
      : /^yes$/i.test(membersTemplate?.fields.members ?? template?.fields.members ?? '') ? true : null;
    const level = wikiNumber(template?.fields[spec.levelField]), noBurnLevel = wikiNumber(template?.fields.noburnlevel);
    const entries = guide.entries.filter(entry => entry.skill === spec.skill && spec.names.includes(entry.name)
      && !/Dungeoneering/i.test(entry.category?.name ?? ''));
    const checks = entries.flatMap(entry => [{ field: 'level', entryId: entry.id, cache: entry.level, wiki: level,
      status: level === null || entry.level === null ? 'unavailable' : entry.level === level ? 'matches' : 'differs' },
    { field: 'members', entryId: entry.id, cache: entry.members, wiki: members,
      status: members === null || entry.members === null ? 'unavailable' : entry.members === members ? 'matches' : 'differs' }]);
    const noBurnEntry = guide.entries.find(entry => entry.structId === spec.noBurnStructId && entry.skill === spec.skill);
    if (spec.noBurnStructId) checks.push({ field: 'noBurnLevel', entryId: noBurnEntry?.id ?? null, cache: noBurnEntry?.level ?? null,
      wiki: noBurnLevel, status: noBurnLevel === null || !noBurnEntry ? 'unavailable' : noBurnEntry.level === noBurnLevel ? 'matches' : 'differs' });
    return { title: spec.title, revisionId: revision?.revid ?? null, timestamp: revision?.timestamp ?? null,
      url: `https://runescape.wiki/w/Special:PermanentLink/${revision?.revid ?? ''}`, sourceContentSha256: sha256(content),
      facts: { skill: spec.skill, level, members, ...(spec.noBurnStructId ? { noBurnLevel } : {}),
        template: spec.template, levelField: spec.levelField,
        ...(spec.noBurnStructId ? { noBurnScope: 'standard fire/range without cooking gauntlets or special cookmatic thresholds' } : {}) },
      checks, ...(entries.length ? {} : { unknown: 'No exact guide activity identity; sample left unmatched.' }) };
  });
  const checks = samples.flatMap(sample => sample.checks);
  return { schemaVersion: 1, reviewedAt: '2026-10-08', samples,
    summary: { pages: samples.length, checks: checks.length, ...Object.fromEntries(['matches', 'differs', 'unavailable']
      .map(status => [status, checks.filter(check => check.status === status).length])), unmatchedSamples: samples.filter(sample => sample.unknown).length },
    limitations: ['Bounded named samples, not a claim that every guide field is current.',
      'Wiki activity membership is checked for the specific sampled activity; UI icons and global flags do not grant map access.',
      'No-burn milestones use the standard threshold; lower special-equipment thresholds remain separate.'] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--guide', '--wiki', '--output'].includes(args[index]) || !args[index + 1]) throw new TypeError('Expected --guide PATH --wiki PATH [--output PATH]');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.guide || !options.wiki) throw new TypeError('--guide and --wiki are required');
  const read = file => readFileSync(resolve(file));
  const result = validateGuideWikiSamples(JSON.parse(read(options.guide)), JSON.parse(read(options.wiki)));
  result.provenance = { guide: { path: options.guide, sha256: sha256(read(options.guide)) },
    wikiSnapshot: { path: options.wiki, sha256: sha256(read(options.wiki)) },
    validator: { path: 'scripts/research/validate-skill-guides.mjs', sha256: sha256RepositoryText(read('scripts/research/validate-skill-guides.mjs')) } };
  writeFileSync(resolve(options.output ?? 'docs/research/skill-guides-wiki.2026-10-08.v1.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result.summary));
}
