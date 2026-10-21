import { datasetSourceEvidence } from './helpers/dataset-source-evidence.mjs';
import { TRANSPORT_RUNTIME_SHA256 } from '../app/data/cache-entry-policy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { repositoryProvenance, provenanceLeaves } from './helpers/repository-provenance.mjs';

const bytes = source => readFileSync(new URL(`../${source}`, import.meta.url));
const hashes = new Map();
const hash = source => {
  if (!hashes.has(source)) hashes.set(source, sha256RepositoryText(bytes(datasetSourceEvidence(source))));
  return hashes.get(source);
};

test('all audited repository file provenance agrees with canonical LF text', () => {
  for (const [artifact, pointers] of Object.entries(repositoryProvenance)) {
    const document = JSON.parse(bytes(artifact));
    for (const [pointer, source] of Object.entries(pointers)) {
      const leaves = provenanceLeaves(document, pointer);
      assert.ok(leaves.length, `${artifact}:${pointer} has no hashes`);
      for (const leaf of leaves) assert.equal(leaf.value, hash(source), `${artifact}:${pointer} -> ${source}`);
    }
  }
  assert.equal(TRANSPORT_RUNTIME_SHA256, hash('app/data/cache-walkability.2026-10-07.v1.json'));
  const resourceDoc = bytes('docs/research/cache-resources-application.md').toString('utf8');
  for (const source of ['app/data/cache-resources.2026-10-08.v1.json', 'app/data/cache-resource-selectors.2026-10-08.v1.json']) {
    assert.ok(resourceDoc.includes(hash(source)), `Current resource documentation hash: ${source}`);
  }
  assert.ok(bytes('docs/research/cache-walkability.md').toString('utf8').includes(hash('app/data/cache-walkability.2026-10-07.v1.json')));
});
