import { readFile, writeFile } from 'node:fs/promises';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const evidenceFiles = [
  'docs/research/cache-quest-metadata-corrections.2026-10-08.v1.json',
  'docs/research/cache-achievement-metadata-corrections.2026-10-08.v1.json',
  'docs/research/cache-lodestone-corrections.2026-10-08.v1.json',
];

export async function buildMetadataCorrectionBundle() {
  const evidence = [];
  for (const path of evidenceFiles) {
    const bytes = await readFile(new URL(path, root));
    evidence.push({ path, sha256: sha256RepositoryText(bytes), data: JSON.parse(bytes) });
  }
  const [quests, achievements, places] = evidence.map(source => source.data);
  const anachronia = places.lodestones.find(row => row.name === 'Anachronia');
  const location = anachronia.correction.retainedTask;
  const cache = anachronia.cache[0];
  const retained = JSON.parse(await readFile(new URL('rs3-chunkpicker-chunkinfo-export.json', root), 'utf8'));
  const oldChunks = retained.challenges[location.category][location.rawLabel][location.field];
  const oldLocations = Array.isArray(oldChunks) ? oldChunks : [oldChunks];
  if (!oldLocations.includes(location.oldValue)) throw new TypeError('Anachronia retained location has drifted.');
  const newLocations = oldLocations.map(value => value === location.oldValue ? location.newValue : value);
  const corrections = [...quests.corrections, ...achievements.corrections, {
    category: location.category, label: location.rawLabel,
    rationale: anachronia.correction.reason,
    changes: [{ field: location.field, before: oldChunks, after: Array.isArray(oldChunks) ? newLocations : newLocations[0],
      cache: { artifact: 'places-2026-10-08-v3/travel.v1.json', id: cache.structId,
        field: 'typedCoordinates[param=2941].surface[mapId=28].region', value: location.newValue,
        coordinate: cache.coordinates[0].surface[0] },
      wiki: { title: anachronia.wiki.title, revisionId: anachronia.wiki.revision,
        url: anachronia.wiki.permalink, field: 'Object map coordinate → region',
        value: location.newValue, coordinate: anachronia.wiki.coordinate } }],
  }];
  const merged = new Map();
  for (const row of corrections) {
    const key = `${row.category}\0${row.label}`;
    if (!merged.has(key)) merged.set(key, { ...row, changes: [] });
    const target = merged.get(key);
    for (const change of row.changes) {
      if (target.changes.some(existing => existing.field === change.field)) throw new TypeError(`Duplicate correction: ${row.label}: ${change.field}`);
      target.changes.push(change);
    }
  }
  const rows = [...merged.values()].sort((left, right) => `${left.category}\0${left.label}`.localeCompare(`${right.category}\0${right.label}`, 'en'));
  const counts = {};
  for (const row of rows) for (const change of row.changes) {
    const key = `${row.category}.${change.field}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { schemaVersion: 1, verifiedOn: '2026-10-08',
    evidence: evidence.map(({ path, sha256 }) => ({ path, sha256 })),
    policy: 'Exact authored labels and reviewed old values only; preserve task IDs, text, steps and all unrelated authored fields. No personal progress or access grants.',
    counts: { rows: rows.length, fields: rows.reduce((sum, row) => sum + row.changes.length, 0), byField: counts },
    corrections: rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bundle = await buildMetadataCorrectionBundle();
  await writeFile(new URL('app/data/metadata-corrections.2026-10-08.v1.json', root), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify(bundle.counts));
}
