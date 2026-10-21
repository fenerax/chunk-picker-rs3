#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sha256 } from './cache-reader.mjs';
import { cliOptions, writeDataset } from './game-data-common.mjs';

const options = cliOptions();
if (!options.input || !options.wiki) throw new Error('Supply --input extracted directory --wiki recorded Wiki snapshot');
const input = resolve(options.input), repo = resolve(import.meta.dirname, '../..');
const read = file => JSON.parse(readFileSync(join(input, file)));
const manifestBytes = readFileSync(join(input, 'manifest.v1.json')), manifest = JSON.parse(manifestBytes);
for (const file of manifest.outputs) {
  const bytes = readFileSync(file.path);
  if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Output hash mismatch: ${file.path}`);
}
const places = read('places.v1.json'), travel = read('travel.v1.json'), comparison = read('comparison.v1.json');
const wiki = JSON.parse(readFileSync(options.wiki));
const names = ['Lumbridge Lodestone', 'Varrock Lodestone', 'Wendlewick Lodestone', 'City of Um Lodestone', 'Anachronia Lodestone'];
const samples = names.map(name => travel.lodestones.find(row => row.name === name));
const validation = samples.map(row => {
  const page = wiki.find(page => page.page.toLowerCase() === row.name.toLowerCase());
  const membershipValue = /^\|members\s*=\s*(Yes|No)\s*$/i.exec(page.fields.find(s => /^\|members/.test(s)) ?? '')?.[1]?.toLowerCase();
  const expectedMembership = membershipValue === 'yes' ? 1 : membershipValue === 'no' ? 0 : null;
  const coord = row.coordinates[0], displayed = coord.surface[0] ?? coord;
  const mapField = page.fields.find(s => /^\|map/.test(s)) ?? '';
  const x = Number(/(?:x[=:]|\|)(\d+)(?=[,|}])/.exec(mapField)?.[1]);
  const y = Number(/y[=:](\d+)/.exec(mapField)?.[1] ?? /\|(\d+),\s*(\d+)/.exec(mapField)?.[2]);
  const wikiPlaneMatch = /(?:^|\|)plane[=:](\d+)/.exec(mapField);
  const wikiPlane = wikiPlaneMatch ? Number(wikiPlaneMatch[1]) : null;
  const distance = Math.max(Math.abs(displayed.x - x), Math.abs(displayed.y - y));
  const sameRegion = Number.isFinite(x) && Number.isFinite(y) && Math.floor(displayed.x / 64) === Math.floor(x / 64)
    && Math.floor(displayed.y / 64) === Math.floor(y / 64);
  return { name: row.name, structId: row.structId, revision: page.revision, url: page.url,
    wikiObjectAnchor: { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, plane: wikiPlane },
    cacheCoordinate: { x: displayed.x, y: displayed.y, plane: displayed.plane },
    membership: { wiki: expectedMembership, cacheCandidate: row.membersCandidate, match: expectedMembership === null ? null : row.membersCandidate === expectedMembership },
    coordinateCheck: distance === 0 ? 'exact x/y coordinate' : distance <= 1 && sameRegion ? 'adjacent landing and scenery anchor; same region'
      : distance <= 1 ? 'adjacent anchors across a region boundary' : 'difference or missing coordinate requiring review',
    sourcePlaneCheck: wikiPlane === null ? 'Wiki plane unavailable' : coord.plane === wikiPlane ? 'match' : 'difference',
    cacheMembershipVariants: [...new Set(travel.lodestones.filter(r => r.name === row.name).map(r => r.membersCandidate))] };
});
const summary = { schemaVersion: 1, datasetDirectory: input.replaceAll('\\', '/'), manifestSha256: sha256(manifestBytes),
  decoder: manifest.decoder, reference: manifest.reference, sources: manifest.sources, counts: places.summary,
  archiveHashes: manifest.archives.filter(a => a.major !== 22 || samples.some(s => Math.floor(s.structId / 32) === a.minor)),
  outputHashes: manifest.outputs, samples: { labels: places.placements.filter(p => ['Lumbridge', 'Varrock', 'Falador', 'Wendlewick', 'City of Um'].includes(p.label)),
    lodestones: samples, teleports: travel.travelStructs.filter(s => [14753, 14756, 14759].includes(s.id)) }, validation,
  unresolvedLodestones: comparison.lodestoneComparison.filter(p => !p.regionMatch),
  limits: ['Coordinates in structs are typed coordgrid values. Destination meaning requires textual evidence and sample checks.',
    'Map projections establish display placement, not which server route or map a player can use.',
    'Lodestone param2809 is candidate membership metadata; City of Um variants disagree.',
    'Labels are anchors, not polygons or authored section names.'] };
const reportOutput = resolve(options.output ?? join(repo, 'docs/research/cache-game-data-places.2026-10-08.v1.json'));
writeDataset(resolve(reportOutput, '..'), reportOutput.split(/[/\\]/).at(-1), summary);
console.log(JSON.stringify({ counts: places.summary, validation, unresolved: summary.unresolvedLodestones.map(p => p.retained.name) }, null, 2));
