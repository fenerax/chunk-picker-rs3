// Shared by assembly and the object-only drift preflight. An absent manifest
// reviews nothing: even a byte-identical same-name test needs explicit review.
import { createHash } from 'node:crypto';

export const coreOverlaySha256 = bytes => createHash('sha256')
  .update(Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')).digest('hex');

export function reviewCoreOverlays({ manifest = { schemaVersion: 1, files: {} }, coreFiles, privateFiles }) {
  const findings = [];
  const add = (id, path, message, fixHint) => findings.push({ id, path, message, fixHint });
  if (manifest?.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    add('overlay-manifest-invalid', 'tests/core-overlays.json', 'tests/core-overlays.json invalid.', 'Restore schemaVersion 1 and a files object containing reviewed coreSha256 records.');
    return findings;
  }
  const replaced = new Set();
  for (const name of privateFiles.keys()) {
    if (!name.startsWith('tests/') || !coreFiles.has(name)) continue;
    replaced.add(name);
    const record = manifest.files[name], actual = coreOverlaySha256(coreFiles.get(name));
    if (!record) add('overlay-unreviewed', name,
      `Private ${name} would replace core's copy without review.`,
      `Move private-only cases to a .private.test.mjs file, or record core's sha256 ${actual} in tests/core-overlays.json.`);
    else if (record.coreSha256 !== actual) add('overlay-stale', name,
      `Core's ${name} changed since its private replacement was reviewed (recorded ${record.coreSha256}, core now ${actual}).`,
      'Port core\'s changes into the private copy, then record the new sha256 in tests/core-overlays.json.');
  }
  for (const name of Object.keys(manifest.files)) if (!replaced.has(name)) add('overlay-unused', name,
    `Remove entries from tests/core-overlays.json that no longer replace a core file: ${name}.`,
    `Remove the unused ${name} entry from tests/core-overlays.json.`);
  return findings;
}

export function assertReviewedCoreOverlays(options) {
  const findings = reviewCoreOverlays(options);
  if (findings.length) throw new Error(findings.map(row => `${row.message} ${row.fixHint}`).join('\n'));
}
