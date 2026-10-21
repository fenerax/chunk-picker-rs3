// Audited current file identities in app/data, archive/data and docs. External exports,
// binaries, logical JSON fingerprints and historical Markdown snapshots are
// deliberately outside this inventory; see docs/provenance-hashes.md.
const reference = 'rs3-chunkpicker-chunkinfo-export.json';
const data = name => `${name === 'map-pin-details' ? 'archive' : 'app'}/data/${name}.2026-10-08.v1.json`;
const research = name => `docs/research/${name}.2026-10-08.v1.json`;
const walking = 'app/data/cache-walkability.2026-10-07.v1.json';
const selectors = 'app/data/cache-selector-evidence.2026-10-07.v1.json';

export const repositoryProvenance = {
  'docs/research/training-coverage.2026-10-13.v1.json': {
    '/provenance/catalogue/sha256': 'app/data/training/methods.f2p.json',
    '/provenance/evidence/sha256': 'app/data/training/f2p-expansion.2026-10-13.v1.json',
    '/provenance/audit/sha256': 'scripts/research/training-data-coverage.mjs',
  },
  'app/data/training/f2p-expansion.2026-10-13.v1.json': {
    '/provenance/reference/sha256': reference,
    '/provenance/builder/sha256': 'scripts/research/build-training-data.mjs',
    '/provenance/catalogue/sha256': 'app/data/training/methods.f2p.json',
  },
  'app/data/cache-component-policy.2026-10-07.v1.json': { '/provenance/selectorEvidenceSha256': selectors },
  [walking]: { '/provenance/referenceSha256': reference },
  [data('cache-resource-selectors')]: {
    '/provenance/catalogueSha256': data('cache-resources'), '/provenance/referenceSha256': reference,
  },
  [data('cache-resources')]: {
    '/provenance/walkability/sha256': walking,
    '/provenance/walkability/masks/reference/sha256': reference,
    '/provenance/selectorEvidence/sha256': selectors, '/provenance/reference/sha256': reference,
    '/provenance/generatorSha256': 'scripts/build-resource-catalogue.mjs',
    '/provenance/classificationSha256': 'scripts/cache/resource-catalogue.mjs',
    '/provenance/surfaceCorrections/sha256': data('cache-surface-corrections'),
  },
  [data('equipment-corrections')]: {
    '/evidence/0/sha256': research('cache-equipment-corrections'), '/reference/sha256': reference,
  },
  [data('equipment-weights')]: { '/provenance/cacheReferenceSha256': reference },
  [data('equipment-permanence')]: {
    '/provenance/reference/sha256': reference,
    '/provenance/implementation/0/sha256': 'scripts/research/build-equipment-permanence.mjs',
    '/provenance/implementation/1/sha256': 'scripts/research/equipment-wiki.mjs',
    '/provenance/implementation/2/sha256': 'app/data/equipment-permanence.mjs',
  },
  [data('item-icons')]: {
    '/source/referenceSha256': reference, '/source/identityReviewSha256': research('cache-equipment-corrections'),
  },
  [data('map-pin-details.inputs')]: { '/sources/3/sha256': data('cache-resources') },
  [data('metadata-corrections')]: {
    '/evidence/0/sha256': research('cache-quest-metadata-corrections'),
    '/evidence/1/sha256': research('cache-achievement-metadata-corrections'),
    '/evidence/2/sha256': research('cache-lodestone-corrections'),
  },
  [data('skill-guides')]: {
    '/provenance/reference/sha256': reference, '/provenance/training/sha256': 'app/data/training/methods.f2p.json',
    '/provenance/builder/sha256': 'scripts/research/build-skill-guides.mjs',
    '/provenance/wikiValidation/sha256': research('skill-guides-wiki'),
  },
  [research('skill-guides-comparison')]: {
    '/provenance/reference/sha256': reference, '/provenance/training/sha256': 'app/data/training/methods.f2p.json',
    '/provenance/builder/sha256': 'scripts/research/build-skill-guides.mjs',
    '/provenance/wikiValidation/sha256': research('skill-guides-wiki'),
  },
  [research('skill-guides-wiki')]: { '/provenance/validator/sha256': 'scripts/research/validate-skill-guides.mjs' },
  [research('skill-guides-extraction')]: { '/extractor/sha256': 'scripts/cache/game-data-skill-guides.mjs' },
  [data('skillguide-combat-corrections')]: {
    '/provenance/referenceSha256': reference, '/provenance/generatorSha256': 'scripts/research/skillguide-combat-corrections.mjs',
  },
  [research('skillguide-combat-review')]: {
    '/provenance/referenceSha256': reference, '/provenance/generatorSha256': 'scripts/research/skillguide-combat-corrections.mjs',
  },
  [data('transport-components')]: {
    '/runtime/sha256': walking, '/witnesses/*/runtimeSha256': walking,
  },
  [data('transport-routes')]: {
    '/inputs/0/sha256': data('transport-routes.f2p'),
    '/inputs/1/sha256': data('transport-routes.interiors-members'),
    '/inputs/2/sha256': data('transport-routes.ships'),
    '/inputs/3/sha256': data('transport-components'), '/inputs/4/sha256': data('transport-access-anchors'),
    '/stations/*/componentWitness/runtimeSha256': walking,
  },
  [research('cache-achievement-metadata-corrections')]: { '/sources/retained/sha256': reference },
  [research('cache-equipment-corrections')]: {
    '/sources/reference/sha256': reference, '/sources/cache/compactReport/sha256': research('cache-game-data-items'),
    '/sources/implementation/0/sha256': 'scripts/research/build-equipment-corrections.mjs',
    '/sources/implementation/1/sha256': 'scripts/research/equipment-wiki.mjs',
  },
  [research('cache-game-data')]: { '/reference/sha256': reference },
  [research('cache-lodestone-corrections')]: { '/provenance/reference/sha256': reference },
  [research('cache-quest-metadata-corrections')]: { '/sources/reference/sha256': reference },
};

for (const version of ['v1', 'v2']) {
  repositoryProvenance[`archive/data/map-connections.2026-10-08.${version}.json`] = {
    '/inputs/0/sha256': reference, '/inputs/4/sha256': walking,
    '/inputs/5/sha256': data('cache-surface-corrections'), '/inputs/6/sha256': data('map-pin-details'),
    '/inputs/7/sha256': 'scripts/build-map-connections.mjs', '/provenance/walking/referenceSha256': reference,
    ...(version === 'v2' ? { '/inputs/8/sha256': data('transport-routes') } : {}),
  };
  repositoryProvenance[`${version === 'v1' ? 'archive' : 'app'}/data/map-pin-details.2026-10-08.${version}.json`] = {
    '/sources/3/sha256': data('cache-resources'), '/generator/sha256': 'scripts/build-map-pin-details.mjs',
  };
}
for (const category of ['objects', 'items', 'places', 'quests', 'recipes']) {
  repositoryProvenance[research(`cache-game-data-${category}`)] = {
    [category === 'quests' || category === 'recipes' ? '/provenance/reference/sha256' : '/reference/sha256']: reference,
  };
  repositoryProvenance[research('cache-game-data')][`/categories/${category}/reportSha256`] = research(`cache-game-data-${category}`);
}
const reproductionSources = [
  'scripts/import-rs3-game-data.mjs', 'scripts/cache/game-data-common.mjs', 'scripts/cache/game-data-items.mjs',
  'scripts/cache/game-data-objects.mjs', 'scripts/cache/game-data-places.mjs', 'scripts/cache/game-data-quests.mjs',
  'scripts/cache/game-data-recipes.mjs', 'scripts/cache/report-game-data-places.mjs',
  'scripts/cache/report-game-data.mjs', 'scripts/cache/verify-game-data.mjs',
];
reproductionSources.forEach((source, index) => {
  repositoryProvenance[research('cache-game-data')][`/reproductionSources/${index}/sha256`] = source;
});

// Return matching existing leaves, expanding arrays at '*'. Optional station
// witnesses are absent on unresolved stations; direct pointers must exist.
export function provenanceLeaves(value, pointer) {
  const parts = pointer.slice(1).split('/');
  const walk = (node, index, parent, key) => {
    if (index === parts.length) return [{ parent, key, value: node }];
    if (parts[index] === '*') return Object.entries(node).flatMap(([key, child]) => walk(child, index + 1, node, key));
    if (node == null || !(parts[index] in node)) {
      if (parts.includes('*')) return [];
      throw new Error(`Missing provenance pointer ${pointer}`);
    }
    return walk(node[parts[index]], index + 1, node, parts[index]);
  };
  return walk(value, 0);
}
