// Practice-only inventory proof. No CLI or environment switch enables this.
import path from 'node:path';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hashTree, digestValue } from './release-identity.mjs';
import { reopenLivePayloadContext, liveRuleHandling, livePayloadProof } from './live-payload-rules.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const capabilities = new WeakMap();
const testName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(name);
async function ordinary(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || current === path.resolve(file) && stat.isFile() && stat.nlink !== 1) throw Error('Practice proof links refused.');
    if (path.dirname(current) === current) break;
  }
}

/** Reopen the original full tooling kit, not the mixed live-era private tree.
 * Its manifest pins the private tests and its exact, intake-checked core SHA.
 * Absence of a core pin permits private provenance only; no branch/ref guessing.
 * Missing registrations additionally require a reopened original-live context. */
export async function practiceInventoryCapability(proof) {
  if (proof?.schema !== 'rs3-practice-inputs-v1' || !path.isAbsolute(proof.kit ?? '') || !path.isAbsolute(proof.coreRepo ?? '')) throw Error('Practice input proof required.');
  const manifestFile = path.join(proof.kit, 'kit.json');
  await ordinary(manifestFile);
  const manifestBytes = await readFile(manifestFile);
  if (sha(manifestBytes) !== proof.kitSha256) throw Error('Practice tooling manifest changed.');
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, '')), source = path.join(proof.kit, 'checks/private-source');
  if (manifest.schemaVersion !== 2) throw Error('Practice tooling manifest schema refused.');
  const tree = await hashTree(source);
  if (tree.digest !== manifest.sourceTreeDigest) throw Error('Practice tooling private input changed.');
  const allowed = new Map();
  for (const file of tree.files) if (file.path.startsWith('tests/') && testName(file.path.slice(6))) {
    const name = file.path.slice(6);
    allowed.set(name, { name, side: 'private-source', path: file.path, reason: 'Present in tooling private tests; absent from live test trees.', input: 'tooling-private-tests', sha256: file.sha256 });
  }
  if (manifest.coreRevision != null) {
    if (!/^[a-f0-9]{40}$/.test(manifest.coreRevision)) throw Error('Practice tooling core pin refused.');
    const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', proof.coreRepo, ...args], { windowsHide: true, stdio: ['ignore','pipe','pipe'], maxBuffer: 16 * 1024 ** 2 });
    if (git('rev-parse', '--verify', manifest.coreRevision + '^{commit}').toString().trim() !== manifest.coreRevision) throw Error('Practice core pin unavailable.');
    const rows = git('ls-tree', '-rz', manifest.coreRevision, '--', 'tests').toString().split('\0');
    for (const row of rows) {
      const match = /^(?:100644|100755) blob ([a-f0-9]{40})\t(tests\/(.+))$/.exec(row);
      if (!match || !testName(match[3])) continue;
      const name = match[3];
      if (!allowed.has(name)) allowed.set(name, { name, side: 'core', path: match[2], reason: 'Present at tooling pinned core revision; absent from live test trees.', input: 'tooling-core-revision', revision: manifest.coreRevision, blobOid: match[1] });
    }
  }
  const livePayload = proof.livePayload === undefined ? undefined : await reopenLivePayloadContext(proof.livePayload);
  if (livePayload && livePayloadProof(livePayload).tooling?.kitSha256 !== proof.kitSha256) throw Error('Practice live payload identifies different tooling.');
  const capability = Object.freeze({});
  capabilities.set(capability, { allowed: new Map([...allowed].map(([name, row]) => [name, Object.freeze(row)])),
    proof: JSON.parse(JSON.stringify(proof)), livePayload });
  return capability;
}

export function practiceInventoryLivePayload(capability) {
  if (!capabilities.has(capability)) throw Error('Practice inventory capability refused.');
  return capabilities.get(capability).livePayload;
}

export function inventoryMissing(registered, discovered, capability) {
  const present = new Set(discovered), missing = [...new Set(registered)].filter(name => !present.has(name)).sort();
  if (capability !== undefined && !capabilities.has(capability)) throw Error('Practice inventory capability refused.');
  const input = capabilities.get(capability), tolerated = [];
  for (const name of missing) {
    const handling = liveRuleHandling(input?.livePayload, 'registered-test-inventory', name);
    if (input?.allowed.has(name) && handling.treatment === 'grandfather') {
      const { revision: liveRevision, ...declaration } = handling;
      tolerated.push({ ...input.allowed.get(name), ...declaration, liveRevision });
    }
  }
  const exempted = new Set(tolerated.map(row => row.name));
  return { missing: missing.filter(name => !exempted.has(name)), tolerated };
}

/** companion-check writes this marker only for a practice release receipt.
 * The contract reopens both that receipt and the original proof. A stray env
 * variable or ordinary release cannot reduce the quick-file expectation. */
export async function practiceQuickExpectation(root, registered) {
  const markerFile = path.join(root, '.local/practice-inventory.json');
  let marker;
  try { await ordinary(markerFile); marker = await json(markerFile); }
  catch (error) { if (error.code === 'ENOENT') return registered.size; throw error; }
  if (!path.isAbsolute(marker.release ?? '')) throw Error('Practice contract release required.');
  await ordinary(path.join(marker.release, 'release.json'));
  await ordinary(path.join(marker.release, 'companion.json'));
  const manifest = await json(path.join(marker.release, 'release.json'));
  const receipt = await json(path.join(marker.release, 'companion.json'));
  if (manifest.practice !== true || manifest.releaseId !== 'practice-candidate' || path.resolve(receipt.coreRoot) !== path.join(marker.release, 'core')
      || digestValue(receipt.practiceInventory) !== digestValue(marker.inventory)) throw Error('Practice contract receipt differs.');
  const capability = await practiceInventoryCapability(marker.inventory.proof);
  const names = (await readdir(path.join(root, 'tests'))).filter(testName);
  const result = inventoryMissing([...registered], names, capability);
  if (result.missing.length) throw Error('Unproved missing quick registrations: ' + result.missing.join(', '));
  for (const row of result.tolerated) if (!marker.inventory.tolerated.some(value => digestValue(value) === digestValue(row))) throw Error('Practice quick exception was not reported by preflight.');
  return registered.size - result.tolerated.length;
}
