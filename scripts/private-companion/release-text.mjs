// Bounded prose lane. Callers freeze/copy source first; this module never installs it.
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { lstat, readFile, writeFile, mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hashTree, digestValue, stableStringify, sanitizeExecutionEnvironment } from './release-identity.mjs';

const textPaths = ['app/data/changelog.json', 'app/data/roadmap.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (rule = 'text-contract') => {
  const error = new Error(`Text release contract refused (rule: ${rule}); use the full release lane.`);
  error.releaseTextRule = rule;
  throw error;
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = (a, b) => stableStringify(a) === stableStringify(b);
function keys(value, required, optional = []) {
  if (!plain(value) || required.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => ![...required, ...optional].includes(key))) fail('input-shape');
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail('invalid-date');
  return value;
}
function prose(value, limit) {
  // Plain text only: reject markup, URLs (including scheme-less), escapes and bidi/control characters.
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > limit
    || /[<>\\\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value)
    || /(?:\/\/\S|(?:https?|ftp|javascript|data|mailto|file|tel|ssh):|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\]\s*\(|&#?\w+;)/iu.test(value)) fail('plain-prose');
  return value;
}

/** Exactly one new changelog entry and one existing roadmap item's note. */
export function validateReleaseTextInput(input) {
  keys(input, ['changelog', 'roadmap']);
  keys(input.changelog, ['date', 'title', 'items']);
  keys(input.roadmap, ['id', 'note'], ['date']);
  const { changelog, roadmap } = input;
  if (!Array.isArray(changelog.items) || changelog.items.length < 1 || changelog.items.length > 12
    || typeof roadmap.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(roadmap.id)) fail('input-shape');
  const value = { changelog: { date: date(changelog.date), title: prose(changelog.title, 160), items: Array.from(changelog.items, item => prose(item, 500)) },
    roadmap: { id: roadmap.id, note: prose(roadmap.note, 1000), date: date(roadmap.date ?? changelog.date) } };
  if (value.roadmap.date !== value.changelog.date) fail('request-date-mismatch');
  return value;
}

async function readData(root) {
  const values = [];
  for (const relative of textPaths) {
    const filename = path.join(root, relative);
    let current = filename;
    while (true) {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (current === filename && (!stat.isFile() || stat.nlink !== 1 || stat.size > 4 * 1024 ** 2))) fail();
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
    values.push(JSON.parse(await readFile(filename, 'utf8')));
  }
  return values;
}
function existingData(log, map) {
  if (!plain(log) || log.schemaVersion !== 1 || !Array.isArray(log.entries) || !plain(map)
    || map.schemaVersion !== 1 || !Array.isArray(map.themes)) fail();
  date(map.updated);
  const ids = new Set();
  for (const theme of map.themes) {
    if (!plain(theme) || !Array.isArray(theme.items)) fail();
    for (const item of theme.items) {
      if (!plain(item) || typeof item.id !== 'string' || ids.has(item.id)) fail();
      ids.add(item.id);
    }
  }
  for (const entry of log.entries) date(entry.date);
  if (log.entries.some((entry, index) => index > 0 && entry.date > log.entries[index - 1].date)) fail();
}
function updatedData(previousLog, previousMap, input) {
  existingData(previousLog, previousMap);
  const { changelog, roadmap } = validateReleaseTextInput(input);
  if (changelog.date < (previousLog.entries[0]?.date ?? '') || changelog.date < previousMap.updated) fail('release-date-before-previous-text');
  if (previousLog.entries.some(entry => entry.date === changelog.date && entry.title === changelog.title)) fail('duplicate-changelog-entry');
  const log = structuredClone(previousLog), map = structuredClone(previousMap);
  const matches = map.themes.flatMap(theme => theme.items).filter(item => item.id === roadmap.id);
  if (matches.length !== 1) fail('roadmap-item-missing');
  if (matches[0].note === roadmap.note) fail('roadmap-note-unchanged');
  log.entries.unshift(changelog); matches[0].note = roadmap.note;
  map.updated = roadmap.date ?? changelog.date;
  return [log, map];
}

/** sourceRoot MUST be a disposable candidate copy. Both changes validate before either write. */
export async function applyTextEntries(sourceRoot, input) {
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot)) fail();
  const previous = await readData(sourceRoot), next = updatedData(...previous, input);
  for (let index = 0; index < textPaths.length; index++) await writeFile(path.join(sourceRoot, textPaths[index]), JSON.stringify(next[index], null, 2) + '\n');
  return { paths: [...textPaths], inputDigest: digestValue(validateReleaseTextInput(input)) };
}

/** Shared by prepare and request inspection. Only writes to a disposable root. */
export async function copyPreviousTextSource(sourceRoot, previousConfig) {
  try {
    const addonPath = previousConfig.addons.path;
    if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(addonPath)) fail('previous-text-source');
    const regular = async file => {
      for (let current = file; ; current = path.dirname(current)) {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (current === file && (!stat.isFile() || stat.nlink !== 1))) fail('previous-text-source');
        if (path.dirname(current) === current) break;
      }
      return readFile(file);
    };
    const addonBytes = await regular(addonPath);
    if (sha(addonBytes) !== previousConfig.addons.sha256) fail('previous-addon-pin');
    const addon = JSON.parse(addonBytes);
    // Validate both pins before writing either file.
    const payloads = [];
    for (const relative of textPaths) {
      const bytes = await regular(path.join(path.dirname(addonPath), relative));
      if (sha(bytes) !== addon.files.find(record => record.path === relative)?.sha256) fail('previous-prose-pin');
      payloads.push(bytes);
    }
    await mkdir(path.join(sourceRoot, 'app/data'), { recursive: true });
    for (let i = 0; i < textPaths.length; i++) await writeFile(path.join(sourceRoot, textPaths[i]), payloads[i], { flag: 'wx' });
  } catch (error) {
    if (error.releaseTextRule) throw error;
    fail('previous-text-source');
  }
}

async function addonSnapshot(selection) {
  const filename = typeof selection === 'string' ? selection : selection?.path ?? selection?.addonPath;
  const pin = typeof selection === 'string' ? undefined : selection?.sha256 ?? selection?.addonSha256;
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.basename(filename) !== 'addon.json'
    || (pin !== undefined && !hex(pin))) fail();
  const root = path.dirname(filename), tree = await hashTree(root);
  const bytes = await readFile(filename), manifest = JSON.parse(bytes);
  if (pin !== undefined && sha(bytes) !== pin) fail();
  keys(manifest, ['schemaVersion', 'features', 'files']);
  if (manifest.schemaVersion !== 1 || !plain(manifest.features) || manifest.features.projectUpdates !== true || !Array.isArray(manifest.files)) fail();
  keys(manifest.features, ['projectUpdates'], ['originalSync', 'gallery', 'bankingInteriors']);
  const required = new Set(textPaths);
  if (manifest.features.originalSync !== undefined) {
    keys(manifest.features.originalSync, ['server', 'browser']);
    if (manifest.features.originalSync.server !== 'server/original-sync.mjs' || manifest.features.originalSync.browser !== 'app/web/original-sync.mjs') fail();
    required.add('server/original-sync.mjs'); required.add('app/web/original-sync.mjs');
  }
  if (manifest.features.gallery !== undefined) {
    if (manifest.features.gallery !== true) fail();
    for (const file of ['gallery.html', 'gallery.mjs', 'gallery.css', 'gallery-catalogue.mjs', 'gallery-preview.mjs', 'gallery-capture.mjs',
      'gallery-fixtures.mjs', 'gallery-fixture-data.json', 'gallery-safety.mjs', 'gallery-usage.mjs', 'gallery-usage-fixture.mjs']) required.add('app/web/' + file);
  }
  if (manifest.features.bankingInteriors !== undefined) {
    if (manifest.features.bankingInteriors !== true) fail();
    required.add('app/data/banking-interiors.json');
  }
  const files = new Map(tree.files.map(record => [record.path, record]));
  const seen = new Set();
  for (const record of manifest.files) {
    keys(record, ['path', 'sha256']);
    if (typeof record.path !== 'string' || !record.path || /[\\:\u0000-\u001f]/.test(record.path)
      || record.path.startsWith('/') || record.path.split('/').some(part => !part || part === '.' || part === '..')
      || !required.has(record.path) || seen.has(record.path) || !hex(record.sha256) || files.get(record.path)?.sha256 !== record.sha256) fail();
    seen.add(record.path);
  }
  if (files.size !== seen.size + 1 || required.size !== seen.size) fail();
  if (files.get('addon.json')?.sha256 !== sha(bytes)) fail();
  const data = await readData(root);
  if (!same(tree, await hashTree(root))) fail();
  return { tree, manifest, data, pin: sha(bytes) };
}

/** Capture digests from actual frozen components; missing or changed components force full. */
export async function verifyTextDelta(options) {
  const fixed = {};
  for (const name of ['Core', 'Infrastructure', 'Packs']) {
    const previous = options['previous' + name + 'Digest'], candidate = options['candidate' + name + 'Digest'];
    if (!hex(previous) || !hex(candidate) || previous !== candidate) fail();
    fixed[name.toLowerCase() + 'Digest'] = candidate;
  }
  const profile = value => hex(value) || (plain(value) && hex(value.digest));
  if (!profile(options.previousProfile) || !profile(options.candidateProfile) || !same(options.previousProfile, options.candidateProfile)) fail();
  fixed.profileDigest = digestValue(options.candidateProfile);
  const previous = await addonSnapshot(options.previousAddon), candidate = await addonSnapshot(options.candidateAddon);
  if (!same(previous.manifest.features, candidate.manifest.features) || !same(previous.tree.directories, candidate.tree.directories)) fail();
  const fixedFiles = snapshot => snapshot.tree.files.filter(record => ![...textPaths, 'addon.json'].includes(record.path));
  if (!same(fixedFiles(previous), fixedFiles(candidate))) fail();
  const modes = snapshot => snapshot.tree.files.map(({ path: filename, mode }) => ({ path: filename, mode }));
  if (!same(modes(previous), modes(candidate))) fail();
  const previousPaths = previous.manifest.files.map(record => record.path).sort(), candidatePaths = candidate.manifest.files.map(record => record.path).sort();
  if (!same(previousPaths, candidatePaths)) fail();
  const [beforeLog, beforeMap] = previous.data, [afterLog, afterMap] = candidate.data;
  existingData(beforeLog, beforeMap); existingData(afterLog, afterMap);
  if (afterLog.entries.length !== beforeLog.entries.length + 1 || !same(afterLog.entries.slice(1), beforeLog.entries)) fail();
  const beforeItems = beforeMap.themes.flatMap(theme => theme.items), afterItems = afterMap.themes.flatMap(theme => theme.items);
  const changed = afterItems.filter((item, index) => !same(item, beforeItems[index]));
  if (beforeItems.length !== afterItems.length || changed.length !== 1) fail();
  const input = validateReleaseTextInput({ changelog: afterLog.entries[0], roadmap: { id: changed[0].id, note: changed[0].note, date: afterMap.updated } });
  const expected = updatedData(beforeLog, beforeMap, input);
  if (!same(expected, candidate.data)) fail();
  return { schema: 'rs3-text-proof-v2', ...fixed, previousAddonDigest: previous.tree.digest, candidateAddonDigest: candidate.tree.digest,
    previousManifestDigest: previous.pin, candidateManifestDigest: candidate.pin, inputDigest: digestValue(input), changedPaths: [...textPaths] };
}

/** Call under the light admission wrapper. Child output contains digests only. */
export async function runTextEndpointCheck({ core, companion, receipt = path.join(companion, 'companion.json') }) {
  if (![core, companion].every(value => typeof value === 'string' && path.isAbsolute(value))) fail();
  const value = typeof receipt === 'string' ? JSON.parse(await readFile(receipt, 'utf8')) : receipt;
  if (!plain(value) || value.schemaVersion !== 1 || path.resolve(value.coreRoot ?? '') !== path.resolve(core)) fail();
  for (const record of [value.profile, value.addons]) {
    const relative = path.relative(companion, record?.path ?? '');
    if (!hex(record?.sha256) || !path.isAbsolute(record?.path ?? '') || !relative || relative.startsWith('..') || path.isAbsolute(relative)) fail();
    if (sha(await readFile(record.path)) !== record.sha256) fail();
  }
  // The full companion receipt includes its source inventory and can exceed
  // Windows' command-line limit. Pass only the fields this isolated check uses.
  const endpointReceipt = { schemaVersion: value.schemaVersion, coreRoot: value.coreRoot, packs: value.packs,
    profile: value.profile, addons: value.addons };
  try {
    // Use a real module entrypoint: calculator forks inherit execArgv and cannot
    // start from a parent carrying --input-type=module / --eval arguments.
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), '--text-endpoint-child',
      Buffer.from(JSON.stringify({ core, companion, receipt: endpointReceipt })).toString('base64url')],
    { cwd: core, env: sanitizeExecutionEnvironment(), windowsHide: true, timeout: 180000, maxBuffer: 65536 });
    const result = JSON.parse(stdout);
    if (result?.schema !== 'rs3-text-endpoint-v2' || result.passed !== true || result.cleanupVerified !== true
      || result.addonSha256 !== value.addons.sha256 || result.profileSha256 !== value.profile.sha256) fail();
    return result;
  } catch { fail(); }
}

/** Internal child entry; imports application code only after every storage override is set. */
export async function runTextEndpointChild({ core, companion, receipt }) {
  // Never allow startup diagnostics or credential-bearing exception objects into gate output.
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = () => {};
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'rs3-text-endpoint-v2-'));
  let app, result;
  try {
    const packsDir = (receipt.packsDir ?? path.join(companion, 'packs')), selectionPath = path.join(packsDir, 'selection.json');
    Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_PACKS_DIR: packsDir,
      RS3_PACK_SELECTION: selectionPath, RS3_DATASET_PROFILE: receipt.profile.path,
      RS3_DATASET_PROFILE_SHA256: receipt.profile.sha256, RS3_PRIVATE_ADDON: receipt.addons.path, RS3_PRIVATE_ADDON_SHA256: receipt.addons.sha256,
      RS3_GAME_DATA_DIR: path.join(scratch, 'game-data'), RS3_MAP_ASSETS_DIR: path.join(scratch, 'map-assets'), RS3_WORKER_IDLE_MS: '20000' });
    const snapshot = await addonSnapshot(receipt.addons);
    const { safeArtFile } = await import(pathToFileURL(path.join(core, 'app/packs.mjs')));
    await safeArtFile(path.dirname(selectionPath), path.basename(selectionPath));
    if (!same(JSON.parse(await readFile(selectionPath, 'utf8')), receipt.packs)) fail();
    await safeArtFile(path.dirname(receipt.profile.path), path.basename(receipt.profile.path));
    if (sha(await readFile(receipt.profile.path)) !== receipt.profile.sha256) fail();
    const { loadPrivateAddon } = await import(pathToFileURL(path.join(core, 'app/private-addon.mjs')));
    const tamperRoot = path.join(scratch, 'tamper-addon');
    await cp(path.dirname(receipt.addons.path), tamperRoot, { recursive: true });
    const tamperSelection = { addonPath: path.join(tamperRoot, 'addon.json'), addonSha256: receipt.addons.sha256 };
    const tamperAddon = await loadPrivateAddon(tamperSelection);
    await writeFile(path.join(tamperRoot, textPaths[0]), '{}');
    let tamperRejected = false;
    try { await tamperAddon.json(textPaths[0]); } catch { tamperRejected = true; }
    if (!tamperRejected) fail();
    let pinRejected = false;
    try { await loadPrivateAddon({ addonPath: receipt.addons.path, addonSha256: (receipt.addons.sha256[0] === '0' ? '1' : '0') + receipt.addons.sha256.slice(1) }); }
    catch { pinRejected = true; }
    if (!pinRejected) fail();
    const { createServer } = await import(pathToFileURL(path.join(core, 'app/server.mjs')));
    let port;
    for (let candidate = 8900; candidate <= 8999; candidate++) {
      const available = await new Promise(resolve => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.listen({ host: '127.0.0.1', port: candidate, exclusive: true }, () => probe.close(() => resolve(true)));
      });
      if (available) { port = candidate; break; }
    }
    if (port === undefined) fail();
    await mkdir(path.join(scratch, 'save'));
    app = await createServer({ dataDir: path.join(scratch, 'save'), host: '127.0.0.1', port, loopbackPort: undefined,
      predictionPrewarm: false, shutdownDeadlineMs: 1000, publicOrigin: undefined,
      privateAddonOptions: { addonPath: receipt.addons.path, addonSha256: receipt.addons.sha256 },
      definitions: { chunks: { 12341: {}, 12342: {} }, challenges: {}, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] }, taskMap: {} });
    await app.listen();
    const origin = new URL(app.inviteUrl).origin;
    const joined = await fetch(app.inviteUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const cookie = joined.headers.get('set-cookie')?.split(';')[0];
    if (joined.status !== 303 || !cookie) fail();
    const before = await readFile(path.join(scratch, 'save/state.json'));
    const values = [];
    for (let index = 0; index < 2; index++) {
      const route = ['/api/changelog', '/api/roadmap'][index];
      const denied = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (denied.status !== 401) fail();
      const response = await fetch(origin + route, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) });
      if (response.status !== 200) fail();
      const value = await response.json();
      if (!same(value, snapshot.data[index])) fail();
      values.push(value);
    }
    const healthResponse = await fetch(origin + '/api/health', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) });
    const health = await healthResponse.json();
    if (healthResponse.status !== 200 || !/^[a-f0-9]{12}$/.test(health.version ?? '')) fail();
    // Exercise the shipped renderer with the authenticated candidate payloads.
    class Node {
      constructor(tag, text = '') { this.tagName = tag; this.textContent = text; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = true; }
      setAttribute(name, value) { this.attributes[name] = value; }
      append(...nodes) { this.children.push(...nodes); }
      replaceChildren(...nodes) { this.children = nodes; }
      addEventListener() {}
    }
    const { createUpdates } = await import(pathToFileURL(path.join(core, 'app/web/updates.mjs')));
    const dialogs = [];
    const el = (tag, text, cls) => Object.assign(new Node(tag, text), { className: cls });
    const banner = new Node('div');
    const updates = createUpdates({ el, button: text => el('button', text), openDialog: (title, node) => dialogs.push({ title, node }),
      api: async route => values[route === '/api/changelog' ? 0 : 1], banner, storage: null });
    await updates.openList(); await updates.openRoadmap();
    const texts = node => [node.textContent, ...node.children.flatMap(texts)].filter(value => typeof value === 'string');
    if (dialogs[0]?.title !== 'What’s new' || !texts(dialogs[0].node).includes(values[0].entries[0].title)
      || dialogs[1]?.title !== 'Roadmap' || texts(dialogs[1].node).some(value => /Invalid Date/.test(value))) fail();
    for (const item of values[1].themes.flatMap(theme => theme.items)) {
      if (item.note && !texts(dialogs[1].node).some(text => text.includes(item.note))) fail();
    }
    updates.seen('before-text-release'); updates.seen(health.version);
    await new Promise(resolve => setImmediate(resolve));
    if (banner.hidden || !texts(banner).some(text => text.includes(values[0].entries[0].title))) fail();
    if (!before.equals(await readFile(path.join(scratch, 'save/state.json')))) fail();
    if ((await addonSnapshot(receipt.addons)).tree.digest !== snapshot.tree.digest) fail();
    result = { schema: 'rs3-text-endpoint-v2', passed: true, addonSha256: receipt.addons.sha256, profileSha256: receipt.profile.sha256,
      changelogDigest: digestValue(values[0]), roadmapDigest: digestValue(values[1]), authenticated: true, anonymousDenied: true,
      rendered: true, refreshBanner: true, pinRejected: true, tamperRejected: true, syntheticStateUnchanged: true };
  } finally {
    try { if (app) await app.close(); }
    finally { await rm(scratch, { recursive: true, force: true }); }
  }
  return { ...result, cleanupVerified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--text-endpoint-child') {
  try {
    const result = await runTextEndpointChild(JSON.parse(Buffer.from(process.argv[3], 'base64url')));
    process.stdout.write(JSON.stringify(result));
  } catch { process.stderr.write('Text endpoint gate failed.'); process.exitCode = 1; }
}
