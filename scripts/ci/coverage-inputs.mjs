// Connect verified public CI packs to input-gated tests. No operator configuration
// or automatic pack discovery is used here.
import { appendFileSync, existsSync, readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheWikiPages, pageFilename } from '../fetch-open-f2p-wiki.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
function inputFile(root, name) {
  if (!relative(name)) throw Error('Coverage input has an invalid relative path.');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw Error('Coverage inputs cannot contain links.');
  }
  if (!lstatSync(current).isFile()) throw Error('Coverage input must be a regular file.');
  return readFileSync(current);
}
function placedRoot(checkout, name) {
  const root = path.join(checkout, name), metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw Error('Coverage placed input root is invalid.');
  return root;
}

/** Return only the environment owned by this setup step and visible absence reasons.
 * An absent selection is supported for pack-free checkouts. Once supplied, every
 * selected manifest and payload must verify; corruption never turns into a skip.
 */
export function buildCoverageInputs({ checkout, tree }) {
  if (!checkout || !tree) throw Error('Usage: coverage-inputs.mjs <checkout> <packs tree>');
  checkout = path.resolve(checkout); tree = path.resolve(tree);
  const env = {}, missing = [];
  // The harness contract compares an authentic private overlay with its paired
  // public reference. A single checkout cannot provide that independent input.
  if (!existsSync(path.join(tree, 'selection.json'))) {
    missing.push('public pack selection is absent; pack-dependent tests remain skipped');
    return { env, missing };
  }
  const selection = JSON.parse(inputFile(tree, 'selection.json'));
  if (selection.schemaVersion !== 1) throw Error('Coverage pack selection is invalid.');
  const packs = {};
  for (const [kind, id] of Object.entries({ data: 'duo-data', rulesText: 'duo-rules-text', art: 'duo-art' })) {
    const choice = selection[kind];
    if (!choice) { missing.push(`public ${kind} pack is absent`); continue; }
    if (choice.id !== id || !relative(choice.version) || choice.version.includes('/') || !/^[a-f0-9]{64}$/.test(choice.sha256 ?? '')) throw Error('Coverage pack selection is invalid.');
    const prefix = `${choice.id}/${choice.version}`;
    const bytes = inputFile(tree, `${prefix}/pack.json`);
    if (hash(bytes) !== choice.sha256) throw Error(`Coverage ${kind} manifest hash mismatch.`);
    const manifest = JSON.parse(bytes);
    if (!Array.isArray(manifest.files)) throw Error(`Coverage ${kind} manifest is invalid.`);
    const names = new Set();
    for (const record of manifest.files) {
      if (!relative(record.path) || names.has(record.path) || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw Error(`Coverage ${kind} file record is invalid.`);
      names.add(record.path);
      const payload = inputFile(tree, `${prefix}/${record.path}`);
      if (payload.length !== record.bytes || hash(payload) !== record.sha256) throw Error(`Coverage ${kind} payload mismatch.`);
    }
    packs[kind] = { choice, manifest, names, root: path.join(tree, prefix) };
  }
  if (packs.data) {
    env.RS3_PUBLIC_SCRUB_DATA_VERSION = packs.data.choice.version;
    if ([...packs.data.names].some(name => name.startsWith('local-game/'))) env.RS3_GAME_DATA_DIR = placedRoot(checkout, '.local/game-data');
    else missing.push('public data pack contains no local-game inputs');
    const guides = 'local-game/skill-guides-2026-10-08-v1/skill-guides.v1.json';
    if (packs.data.names.has(guides)) env.RS3_SKILL_GUIDES_EXPORT = path.join(packs.data.root, path.dirname(guides));
    else missing.push('copied-cache skill guide artifact is absent from public data pack');
  }
  if (packs.rulesText) env.RS3_PUBLIC_SCRUB_RULES_VERSION = packs.rulesText.choice.version;
  if (packs.art) {
    env.RS3_PUBLIC_SCRUB_ART_VERSION = packs.art.choice.version;
    if ([...packs.art.names].some(name => name.startsWith('map-assets/'))) env.RS3_MAP_ASSETS_DIR = placedRoot(checkout, '.local/map-assets');
    else missing.push('public art pack contains no map-assets inputs');
    // Use the selected component's actual nested manifest path, rather than an
    // unrelated local icon export or an assumed root directory.
    const iconRoot = packs.art.manifest.roots?.iconAssets ?? packs.art.manifest.roots?.mapAssets;
    const iconDirectory = 'icons-skills.2026-10-08.v1';
    if (iconRoot && relative(iconRoot) && packs.art.names.has(`${iconRoot}/${iconDirectory}/manifest.json`)) {
      env.SKILL_ICON_ASSET_ROOT = path.join(packs.art.root, iconRoot, iconDirectory);
    } else missing.push('public art pack contains no selected skill icon manifest');
  }
  if (Object.keys(packs).length) env.RS3_PUBLIC_SCRUB_PACKS_DIR = tree;
  return { env, missing };
}

export function githubEnvironment(env) {
  return Object.entries(env).map(([name, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value)) throw Error('Invalid GitHub environment entry.');
    return `${name}=${value}\n`;
  }).join('');
}

/** Provision the public revision-pinned Wiki cache through the repository's
 * serial, throttled Wiki client. Dependency injection keeps setup tests offline.
 */
export async function prepareCoverageInputs(options, { fetchWiki = cacheWikiPages } = {}) {
  const result = buildCoverageInputs(options);
  const checkout = path.resolve(options.checkout);
  const authored = 'app/datasets/open-f2p/authored/batch.json';
  if (!existsSync(path.join(checkout, authored))) {
    result.missing.push('public Wiki revision pins are absent');
    return result;
  }
  const { pages } = JSON.parse(inputFile(checkout, authored));
  if (!Array.isArray(pages) || !pages.length || pages.some(pin => typeof pin.requestedTitle !== 'string'
    || !pin.requestedTitle || !Number.isSafeInteger(pin.revision) || pin.revision < 1)) throw Error('Coverage Wiki revision pins are invalid.');
  const cacheDir = path.join(checkout, '.local/gh-coverage/wiki-open-f2p');
  await fetchWiki(pages, { cacheDir });
  // A configured incomplete cache must fail here, rather than leave an input
  // variable that makes a downstream optional test silently skip.
  for (const pin of pages) {
    const cached = JSON.parse(inputFile(cacheDir, pageFilename(pin.requestedTitle)));
    if (cached.requestedTitle !== pin.requestedTitle || cached.page?.revisions?.[0]?.revid !== pin.revision
      || (pin.title && cached.page.title !== pin.title)) throw Error('Coverage Wiki cached revision mismatch.');
  }
  result.env.OPEN_F2P_WIKI_CACHE = cacheDir;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: coverage-inputs.mjs <checkout> <packs tree>');
    const { env, missing } = await prepareCoverageInputs({ checkout: process.argv[2], tree: process.argv[3] });
    const output = githubEnvironment(env);
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, output);
    console.log(`Coverage inputs configured: ${Object.keys(env).join(', ') || 'none'}.`);
    for (const reason of missing) console.log(`Coverage input unavailable: ${reason}.`);
  } catch {
    console.error('Coverage input setup failed: invalid or unreadable supplied inputs.');
    process.exitCode = 1;
  }
}
