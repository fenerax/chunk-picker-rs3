// Reviewed package contracts. Entries are closure roots, never supplied by an
// untrusted manifest. Keep historical contracts when adding a new version.
import { tools128CliChecks, toolsCliChecks } from './entrypoint-checks.mjs';

const entries = names => Object.freeze([
  ...names.map(name => `scripts/linux/${name}.mjs`),
  'app/tasks/warm-store.mjs', 'scripts/release/vps/release.mjs', 'scripts/release/vps/review.mjs',
].sort());
const earlierEntries = entries(['operator', 'recovery', 'online', 'files', 'runtime', 'start-check', 'serve', 'probe',
  'prewarm', 'rehearse', 'tools-package', 'tools-install']);
const currentEntries = entries(['operator', 'recovery', 'online', 'files', 'runtime', 'start-check', 'serve', 'probe',
  'prewarm', 'rehearse', 'notify', 'monitor', 'offhost-backup', 'recovery-bundle', 'restic', 'ops-status',
  'scratch-alerts', 'bootstrap-alerts', 'tools-package', 'tools-install']);
export const toolsContracts = Object.freeze([
  Object.freeze({ version: 1, entries: earlierEntries, closureRoots: earlierEntries, probes: tools128CliChecks }),
  Object.freeze({ version: 2, entries: currentEntries, closureRoots: currentEntries, probes: toolsCliChecks }),
]);
export const currentToolsContract = toolsContracts.at(-1);

export function toolsContract(manifest) {
  // Only the exact unversioned #128 entry inventory may imply version 1.
  // A missing field is distinct from null, strings and unknown version numbers.
  const version = Object.hasOwn(manifest, 'contractVersion') ? manifest.contractVersion : 1;
  const contract = toolsContracts.find(row => row.version === version);
  if (!contract || JSON.stringify(manifest.entries) !== JSON.stringify(contract.entries)) {
    throw Error('Unknown tools package contract.');
  }
  return contract;
}
