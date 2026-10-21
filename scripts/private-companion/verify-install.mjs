// Data sync gate: verify the pinned immutable installation without opening gameplay storage.
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const equalPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
try {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index], value = process.argv[index + 1];
    if (!['--core', '--companion', '--receipt'].includes(name) || !value || !path.isAbsolute(value) || Object.hasOwn(options, name)) throw new Error('Arguments');
    options[name] = value;
  }
  const core = options['--core'], companion = options['--companion'];
  if (!core || !companion) throw new Error('Arguments');
  const { safeArtFile, packRelative } = await import(pathToFileURL(path.join(core, 'app/packs.mjs')));
  await safeArtFile(core); await safeArtFile(companion);
  async function containedFile(filename) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || !inside(companion, filename)) throw new Error('Input containment');
    return safeArtFile(companion, path.relative(companion, filename).split(path.sep).join('/'));
  }
  const receipt = JSON.parse(await readFile(await containedFile(options['--receipt'] ?? path.join(companion, 'companion.json')), 'utf8'));
  if (receipt.schemaVersion !== 1 || !path.isAbsolute(receipt.coreRoot ?? '')) throw new Error('Companion core differs');
  await safeArtFile(receipt.coreRoot);
  if (!equalPath(await realpath(core), await realpath(receipt.coreRoot))) throw new Error('Companion core differs');
  for (const record of [receipt.profile, receipt.addons]) {
    if (!record || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error('Pin required');
    if (sha(await readFile(await containedFile(record.path))) !== record.sha256) throw new Error('Pin changed');
  }
  const packsDir = (receipt.packsDir ?? path.join(companion, 'packs'));
  const selection = JSON.parse(await readFile(await safeArtFile(packsDir, 'selection.json'), 'utf8'));
  if (JSON.stringify(selection) !== JSON.stringify(receipt.packs)) throw new Error('Selection changed');
  let files = 0;
  for (const key of ['data', 'rulesText', 'art']) {
    const choice = selection[key]; packRelative(choice.id); packRelative(choice.version);
    const directory = path.join(packsDir, choice.id, choice.version);
    const bytes = await readFile(await safeArtFile(directory, 'pack.json'));
    if (sha(bytes) !== choice.sha256) throw new Error('Manifest changed');
    for (const record of JSON.parse(bytes).files) {
      const payload = await readFile(await safeArtFile(directory, record.path));
      if (payload.length !== record.bytes || sha(payload) !== record.sha256) throw new Error('Payload changed');
      files++;
    }
  }
  const { loadDatasetProfile } = await import(pathToFileURL(path.join(core, 'app/dataset-profile.mjs')));
  const { loadPrivateAddon } = await import(pathToFileURL(path.join(core, 'app/private-addon.mjs')));
  const profile = await loadDatasetProfile({ profilePath: receipt.profile.path, profileSha256: receipt.profile.sha256 });
  const addon = await loadPrivateAddon({ addonPath: receipt.addons.path, addonSha256: receipt.addons.sha256 });
  if (!profile || !addon) throw new Error('Pinned installation required');
  await addon.verify();
  const { resolveDataset } = await import(pathToFileURL(path.join(core, 'app/datasets.mjs')));
  const dataset = await resolveDataset({ datasetId: 'duo-legacy', packsDir, selectionPath: path.join(packsDir, 'selection.json'),
    profilePath: receipt.profile.path, profileSha256: receipt.profile.sha256 });
  if (!dataset.packed || dataset.digest !== profile.profile.datasetDigest) throw new Error('Dataset binding');
  console.log(JSON.stringify({ passed: true, verifiedPackFiles: files, addonPinned: true, profilePinned: true }));
} catch { console.error('Pinned installation verification failed; no selection or storage was changed.'); process.exitCode = 1; }
