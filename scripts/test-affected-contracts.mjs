import { createHash } from 'node:crypto';

// Audited finite-input loaders only. Their computed `name` comes directly from
// the literal .map arrays beside readFileSync(new URL(name, import.meta.url)).
// Fingerprint the complete source, not just the read expression: changes to the
// array, argument provenance, aliases or additional accesses invalidate the
// audit and restore ordinary uncertainty until explicitly re-reviewed.
export const inputContracts = {
  'app/open-f2p.mjs': {
    sha256: '2fc9f51d547feb0595c4fa5f6e101df2d034ba847ce1f525395d590bf46ac055',
    files: ['app/open-f2p.mjs', 'app/open-starter-data.mjs', 'app/datasets/open-f2p/wiki-derived/dataset.json'],
  },
  'app/open-starter.mjs': {
    sha256: '0811b89878dfe76da32d758235b03aa849b93f74921988195b33635a3a956067',
    files: ['app/open-starter.mjs', 'app/open-starter-data.mjs'],
  },
};

export function checkedInputContract(file, source) {
  const contract = inputContracts[file];
  if (!contract || createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex') !== contract.sha256) return;
  return contract.files;
}
