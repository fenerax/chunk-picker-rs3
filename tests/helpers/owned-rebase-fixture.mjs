import { buildOwnedBase } from '../../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../../app/storage/owned-base-schema.mjs';
import { fixture, options } from './owned-format2-fixture.mjs';

export function targetBase(change = projection => projection) {
  const { base } = fixture();
  const projection = structuredClone({ dataset: { ...base.dataset, digest: 'c'.repeat(64) },
    tasks: base.tasks.map(row => Object.fromEntries(Object.entries(row).reverse())).reverse(),
    identityRegistry: { ...base.identityRegistry, entries: Object.fromEntries(Object.entries(base.identityRegistry.entries).reverse()) } });
  const built = buildOwnedBase(change(projection));
  return { ...built, dataset: built.pin.dataset, manifest: createOwnedBaseManifest([built.pin]), releaseBytes: built.bytes };
}
export function rebaseOptions(catalogueRoot) {
  const target = targetBase(), source = options(catalogueRoot);
  source.retainedManifests = [target.manifest];
  const newer = { ...source, dataset: target.dataset, manifest: target.manifest,
    releaseBytes: target.bytes, retainedManifests: [source.manifest] };
  return { source, newer, target };
}
