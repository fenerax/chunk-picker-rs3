import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { safeArtFile, packRelative } from '../app/packs.mjs';
import { isAllowed, validateRules } from './public-export/common.mjs';
import { buildPrivateAddon } from './build-private-addon.mjs';
import { buildDatasetProfile } from './build-dataset-profile.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Historical provenance sources used by retained-item-icons tests, absent from selected runtime art.
const privateTestArt = new Set(['First_tower_hat', "Monk's_robe_(bottom)", "Monk's_robe_(top)", 'Priest_gown_(bottom)', 'Priest_gown_(top)', 'Zamorak_robe_(top)']
  .map(name => `resources/equipment_icons/${name}.png`));
export function privateCompanionSource(name, rules) {
  if (privateTestArt.has(name)) return true;
  if ((isAllowed(name, rules) || Object.hasOwn(rules.overrides ?? {}, name)) && !name.startsWith('tests/') && !['scripts/test-selection.mjs', 'scripts/test.mjs'].includes(name)) return false;
  return /^(?:app\/|tests\/|scripts\/|docs\/|reference\/|archive\/|rs3-chunkpicker-chunkinfo-export\.json$|PRODUCT\.md$|README\.md$)/.test(name)
    && !/\.(?:png|jpe?g|gif|webp|woff2?|mp[34]|zip)$/i.test(name);
}
export async function buildPrivateCompanion({ publicRoot, packsDir, output, sourceRoot = root, corpusDir = path.join(sourceRoot, '.local/export-gate') } = {}) {
  if (![publicRoot, packsDir, output, sourceRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new TypeError('Absolute paths required.');
  for (const directory of [publicRoot, packsDir, sourceRoot, path.dirname(output)]) await safeArtFile(directory);
  for (const directory of [publicRoot, packsDir, path.join(sourceRoot, 'app'), path.join(sourceRoot, 'resources')]) {
    const relative = path.relative(directory, output);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Unsafe companion output.');
  }
  try { await lstat(output); throw new Error('Companion output exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rules = validateRules(JSON.parse(await readFile(path.join(sourceRoot, 'scripts/public-export/allowlist.json'), 'utf8')));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: sourceRoot, windowsHide: true, maxBuffer: 16 * 1024 ** 2 }).toString().split('\0').filter(Boolean);
  await mkdir(output);
  const copied = [];
  // Private inputs and tooling are the complement of public source. Shared application code is never mirrored here.
  for (const name of tracked) {
    if (!privateCompanionSource(name, rules)) continue;
    packRelative(name);
    const source = await safeArtFile(sourceRoot, name);
    const target = path.join(output, 'checks/private-source', name);
    await mkdir(path.dirname(target), { recursive: true }); await cp(source, target, { errorOnExist: true, force: false });
    copied.push({ path: name, sha256: sha(await readFile(target)) });
  }
  await mkdir(path.join(output, 'tools'));
  for (const name of (await readdir(path.join(sourceRoot, 'scripts/private-companion'))).filter(name => name.endsWith('.mjs')).sort())
    await cp(path.join(sourceRoot, 'scripts/private-companion', name), path.join(output, 'tools', name));
  await mkdir(path.join(output, 'operator'));
  // Carry the entire private operator kit; integration/gallery runners stay in tools/.
  for (const name of (await readdir(path.join(sourceRoot, 'scripts/private-companion'))).filter(name => name.endsWith('.ps1') || /^cutover-.*\.mjs$/.test(name) || name === 'RELEASING.md').sort())
    await cp(path.join(sourceRoot, 'scripts/private-companion', name), path.join(output, 'operator', name));
  const selection = JSON.parse(await readFile(await safeArtFile(packsDir, 'selection.json'), 'utf8'));
  await mkdir(path.join(output, 'packs'));
  for (const choice of [selection.data, selection.rulesText, selection.art]) {
    if (!choice || !/^[a-z0-9-]+$/.test(choice.id) || !/^[\w.+-]+$/.test(choice.version) || !/^[a-f0-9]{64}$/.test(choice.sha256)) throw new Error('Invalid selection.');
    const relative = `${choice.id}/${choice.version}`;
    const manifestBytes = await readFile(await safeArtFile(packsDir, relative + '/pack.json'));
    if (sha(manifestBytes) !== choice.sha256) throw new Error('Changed selected pack.');
    // Copy only the manifest's explicit verified payloads; never follow an unlisted tree.
    const manifest = JSON.parse(manifestBytes);
    for (const record of manifest.files) {
      packRelative(record.path);
      const source = await safeArtFile(packsDir, relative + '/' + record.path), bytes = await readFile(source);
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw new Error('Changed pack payload.');
      const target = path.join(output, 'packs', relative, record.path);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
    }
    await writeFile(path.join(output, 'packs', relative, 'pack.json'), manifestBytes, { flag: 'wx' });
  }
  await writeFile(path.join(output, 'packs/selection.json'), JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
  const profile = await buildDatasetProfile({ sourceRoot, packsDir: path.join(output, 'packs'), output: path.join(output, 'profile.json') });
  const addons = await buildPrivateAddon({ sourceRoot, output: path.join(output, 'addons') });
  await mkdir(path.join(output, 'release-gate'), { recursive: true });
  // Fail closed if the private leak corpus has not been seeded for this release.
  const { loadCorpus } = await import('./public-export/fingerprints.mjs');
  await loadCorpus(corpusDir);
  await mkdir(path.join(output, 'release-gate/corpus'));
  for (const filename of ['key', 'corpus.json']) await writeFile(path.join(output, 'release-gate/corpus', filename),
    await readFile(await safeArtFile(corpusDir, filename)), { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(output, '.gitignore'), '.local/\nrelease-gate/\noperator/*.json\n', { flag: 'wx' });
  const receipt = { schemaVersion: 1, coreRoot: publicRoot, profile: { path: profile.output, sha256: profile.sha256 }, addons,
    privateFiles: copied, packs: selection, instructions: 'Maintain shared files only in coreRoot; edit private-source only for excluded inputs/tools/tests. Rebuild immutable profile/addons after private changes.' };
  await writeFile(path.join(output, 'companion.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return { privateFiles: copied.length, addonFiles: addons.files, profileSha256: profile.sha256, addonsSha256: addons.sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--public-root': 'publicRoot', '--packs-dir': 'packsDir', '--output': 'output', '--source-root': 'sourceRoot', '--corpus-dir': 'corpusDir' }[process.argv[index]];
      if (!key || !process.argv[index + 1] || Object.hasOwn(options, key)) throw new Error('Arguments invalid.');
      options[key] = process.argv[index + 1];
    }
    console.log(JSON.stringify(await buildPrivateCompanion(options)));
  } catch { console.error('Private companion build failed.'); process.exitCode = 1; }
}
