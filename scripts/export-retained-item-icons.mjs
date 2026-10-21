#!/usr/bin/env node
// Offline artwork supplement. Reads retained repository PNGs; never opens a
// game cache, contacts the web, or changes an existing versioned asset folder.
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';

// LF hash of the upstream index.js at commit 98a3bdc, which binds each equipment
// name to its PNG. The copy is no longer kept; pass a downloaded copy to re-export.
export const RETAINED_BINDING_SHA256 = '8e4d21bbfad09de8fffe263f131e3f5bdb63fca65da27c27f9e3d670623af894';

export const retainedItemIconNames = Object.freeze([
  'First tower hat', "Monk's robe (bottom)", "Monk's robe (top)",
  'Priest gown (bottom)', 'Priest gown (top)', 'Zamorak robe (top)',
]);
const version = '2026-10-12.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function retainedInventoryEntry(name, bytes, equipment) {
  if (!retainedItemIconNames.includes(name) || !equipment?.[name]) throw new Error('Unreviewed retained inventory name');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.length < 33) throw new Error('Expected inventory PNG');
  const sha256 = hash(bytes), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 64 || height > 64) throw new Error('Unexpected inventory dimensions');
  return { file: `item-${sha256.slice(0, 24)}.png`, width, height, bytes: bytes.length, sha256,
    aliases: name.includes("'") ? [name.replaceAll("'", '’'), name.replaceAll("'", '‘')] : [],
    source: { kind: 'retained-equipment-inventory', sourcePath: `resources/equipment_icons/${name.replaceAll(' ', '_')}.png`,
      equipmentName: name, referenceRecordSha256: hash(JSON.stringify(equipment[name])),
      binding: 'Retained upstream checkEquipmentIcons and BiS rows bind the exact equipment key, replacing spaces with underscores only.',
      upstreamCommit: '98a3bdc', licenceNote: 'Retained Jagex game artwork; no new Wiki file or cache identity is asserted.' } };
}

async function absent(file) {
  try { await access(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Refusing to overwrite an existing versioned output');
}

export async function exportRetainedItemIcons({ root, output, manifestPath, bindingPath }) {
  await absent(output); await absent(manifestPath);
  const within = (directory, file) => { const relative = path.relative(path.resolve(directory), path.resolve(file)); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
  if (!within(path.join(root, '.local'), output)
    || ![path.join(root, '.local'), path.join(root, 'app/data')].some(directory => within(directory, manifestPath))) throw new Error('Outputs must stay inside this worktree');
  const reference = JSON.parse(await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json')));
  if (!bindingPath) throw new Error('Pass --binding with the upstream index.js from commit 98a3bdc');
  const bindingBytes = await readFile(bindingPath);
  if (sha256RepositoryText(bindingBytes) !== RETAINED_BINDING_SHA256) throw new Error('Retained inventory binding changed');
  if (!bindingBytes.toString().includes('resources/equipment_icons/${equip.replaceAll(/ /g,')) throw new Error('Retained inventory binding changed');
  const icons = {}, files = new Map();
  for (const name of retainedItemIconNames) {
    const bytes = await readFile(path.join(root, 'resources/equipment_icons', name.replaceAll(' ', '_') + '.png'));
    const entry = retainedInventoryEntry(name, bytes, reference.equipment);
    icons[name] = entry; files.set(entry.file, bytes);
  }
  const manifest = { schemaVersion: 1, kind: 'items', version, assetDirectory: `icons-items.${version}`,
    source: { kind: 'retained-equipment-inventory', upstreamCommit: '98a3bdc', bindingFile: 'index.js', bindingSha256: sha256RepositoryText(bindingBytes),
      selectionPolicy: 'Reviewed exact equipment key and retained PNG basename. No tier stripping, similarly named robe substitution, or ambiguous Ghost hunter variant.' },
    icons, coverage: { mappedNames: Object.keys(icons).length, uniquePngFiles: files.size, totalBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) },
    unmatched: [{ name: 'Zamorak robe (bottom)', reason: 'No exact retained PNG; Zamorak robe legs has a different recorded item ID.' },
      ...['backpack', 'body', 'goggles', 'legs'].map(part => ({ name: `Ghost hunter ${part}`, reason: 'Variant inventory images differ; the bare name does not establish the artwork tier.' }))] };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  for (const [file, bytes] of files) await writeFile(path.join(output, file), bytes, { flag: 'wx' });
  // Publishing the installation manifest last matches the existing icon loader.
  await writeFile(path.join(output, 'manifest.json'), json, { flag: 'wx' });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, json, { flag: 'wx' });
  return manifest.coverage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(import.meta.dirname, '..');
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--output', '--manifest', '--binding'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: node scripts/export-retained-item-icons.mjs --binding UPSTREAM_INDEX_JS [--output NEW_FOLDER] [--manifest NEW_JSON]');
    options[args[index].slice(2)] = path.resolve(args[index + 1]);
  }
  exportRetainedItemIcons({ root, output: options.output ?? path.join(root, '.local/icon-assets', `icons-items.${version}`),
    manifestPath: options.manifest ?? path.join(root, 'app/data', `item-icons.${version}.json`), bindingPath: options.binding })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
