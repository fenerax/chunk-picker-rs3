// Off-PC Phase B (2026-10-20): the platform-neutral slice of the private-full
// lane. The Linux runner and the PC compute the same key from content alone, so
// a verified Actions run can stand in for these files at release. Anything that
// reads the platform, the browser, the packs or the release text stays on the PC.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { digestValue } from './release-identity.mjs';
import { retryPolicyIdentity } from './retry-policy.mjs';

export const neutralPolicy = Object.freeze({
  schema: 'rs3-neutral-lane-policy-v1', runner: 'ubuntu-latest', minConcurrency: 1, maxConcurrency: 2,
  retry: retryPolicyIdentity, retryOnceInIsolation: true, skips: 'zero-skipped-zero-todo', text: 'excluded-by-term',
  packs: 'required-for-import', closure: 'neutral-closure-v1',
});
// Release text is previous live text plus request entries: it never equals the
// committed copy, so it stays out of the key and its readers stay on the PC.
export const textPaths = Object.freeze(['app/data/changelog.json', 'app/data/roadmap.json']);
export const allowlistPath = 'scripts/private-companion/neutral-allowlist.json';
// Phase A's Windows slice (.github/windows-slice/run.mjs); a test keeps both equal.
export const windowsBoundTests = Object.freeze([
  'backup-status.private.test.mjs', 'cutover-live.test.mjs', 'operations-degraded.test.mjs', 'operations-forced.test.mjs',
  'operations-graceful.test.mjs', 'operations-owner.test.mjs', 'operations.test.mjs', 'operator-cutover.test.mjs',
  'private-live-swap.test.mjs', 'release-admission-v2.test.mjs', 'release-pack-upgrade-v2.test.mjs', 'release-pipeline-v2.test.mjs',
  'release-runtime-v2.test.mjs', 'restore-picker.private.test.mjs', 'watchdog-core.test.mjs', 'watchdog-script.test.mjs',
]);
// The private overlay may replace only these core paths (companion-check.mjs).
const replaceable = name => name.startsWith('tests/') || ['scripts/test-selection.mjs', 'scripts/test.mjs', 'scripts/adaptive-test-runner.mjs'].includes(name);
const coreSkipped = name => name.split('/').some(part => ['.git', '.local', 'node_modules', 'var'].includes(part));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Text loses CR before LF; binary (any NUL byte) is hashed raw. Modes never count. */
export function normalizeContent(bytes) {
  return bytes.includes(0) ? bytes : Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}
export const contentHash = bytes => sha(normalizeContent(bytes));

async function walk(root, skip) {
  const files = new Map();
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Neutral lane root must be an ordinary directory.');
  async function visit(directory, prefix) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (skip(name)) continue;
      if (entry.isSymbolicLink()) throw Error('Neutral lane link refused.');
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name);
      else if (entry.isFile()) files.set(name, path.join(directory, entry.name));
      else throw Error('Neutral lane file type refused.');
    }
  }
  await visit(root, '');
  return files;
}

/** Core and private source as the assembly would see them, without copying. */
export async function openSources({ core, privateSource }) {
  const coreFiles = await walk(path.resolve(core), coreSkipped);
  const privateFiles = await walk(path.resolve(privateSource), () => false);
  for (const name of privateFiles.keys())
    if (coreFiles.has(name) && !replaceable(name)) throw Error('Private overlay would replace shared code: ' + name);
  const cache = new Map();
  const resolve = name => privateFiles.get(name) ?? coreFiles.get(name) ?? null;
  const read = async name => {
    if (!cache.has(name)) { const file = resolve(name); cache.set(name, file ? await readFile(file) : null); }
    return cache.get(name);
  };
  const names = [...new Set([...coreFiles.keys(), ...privateFiles.keys()])].sort();
  return { coreFiles, privateFiles, resolve, read, names, has: name => resolve(name) !== null };
}

async function treeDigest(files, exclude = []) {
  const rows = [];
  for (const [name, file] of files) if (!exclude.includes(name)) rows.push([name, contentHash(await readFile(file))]);
  rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return digestValue({ schema: 'rs3-content-tree-v1', files: rows });
}

// ---- Closure: a deliberately over-inclusive walk of what a test can load. ----
const codeFile = /\.(?:mjs|cjs|js)$/i;
const scriptFile = /\.(?:ps1|psm1|psd1|cmd|bat|sh|exe|vbs)$/i;
const importSpecifiers = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*)(['"`])([^'"`\n]+?)\1/g)]
  .map(match => match[2]).filter(value => !value.includes('${'));
const fileLiterals = text => [...text.matchAll(/(['"`])([^'"`\n]{1,240}?\.(?:mjs|cjs|js|ps1|psm1|psd1|cmd|bat|sh|exe|vbs))\1/gi)]
  .map(match => match[2]).filter(value => !value.includes('${'));
const posix = value => value.replaceAll('\\', '/');

function candidates(view, from, value) {
  value = posix(value).replace(/^file:\/\//, '');
  if (/^(?:node:|[a-z]+:)/i.test(value)) return [];
  const found = new Set();
  const add = name => { const normal = path.posix.normalize(name); if (!normal.startsWith('..') && view.has(normal)) found.add(normal); };
  if (value.startsWith('./') || value.startsWith('../')) add(path.posix.join(path.posix.dirname(from), value));
  else if (value.startsWith('/')) add(value.slice(1));
  else {
    add(path.posix.join(path.posix.dirname(from), value)); add(value);
    // A bare name built with path.join(root, 'dir', name): include every match.
    const base = path.posix.basename(value);
    if (!found.size) for (const name of view.names) if (name === value || name.endsWith('/' + value) || path.posix.basename(name) === base && !value.includes('/')) found.add(name);
  }
  return [...found];
}

export async function closureOf(view, entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (!codeFile.test(name)) continue;
    const bytes = await view.read(name);
    if (!bytes) continue;
    const text = stripComments(bytes.toString('utf8'));
    for (const value of [...importSpecifiers(text), ...fileLiterals(text)])
      for (const next of candidates(view, name, value)) if (!seen.has(next)) queue.push(next);
  }
  return [...seen].filter(name => view.has(name)).sort();
}

// ---- Terms. Over-broad on purpose: a false hit only keeps a file on the PC. ----
export const platformTerms = Object.freeze([
  ['platform', /process\.platform|\bplatform\s*\(|\bos\.(?:type|release|version|EOL|arch)\b|\bEOL\b/],
  ['windows', /win32|windows|powershell|pwsh|cmd\.exe|\.exe\b|icacls|Get-Acl|Set-Acl|takeown|taskkill|tasklist|wmic|Win32_|schtasks|\\\\\?\\|\\\\\.\\pipe|named.?pipe/i],
  ['windows-env', /\b(?:APPDATA|LOCALAPPDATA|USERPROFILE|SystemRoot|SYSTEMROOT|ComSpec|COMSPEC|ProgramFiles|PATHEXT|WINDIR)\b/],
  ['drive-path', /(?<![A-Za-z0-9])[A-Z]:[\\/]/],
  ['path-flavour', /path\.(?:win32|posix|sep|delimiter)\b/],
  ['identity', /\bget(?:e?uid|e?gid)\s*\(|\bumask\b|\bchmod|\bchown|\bsymlink|\blink\s*\(/],
  ['signals', /\bSIG(?:TERM|INT|KILL|HUP|BREAK|QUIT|USR[12])\b|\.kill\s*\(|process\.kill/],
  ['shell', /\bshell\s*:\s*true|\bexecSync?\s*\(|\bspawn\s*\(\s*['"`](?:sh|bash|cmd|pwsh|powershell)\b/],
  ['browser', /chrome|chromium|headless|remote-debugging|screenshot|\bcdp\b|puppeteer|playwright/i],
  ['socket', /\.sock\b|socketPath|\bunix:/],
  ['error-codes', /\b(?:EPERM|EBUSY|EACCES|ENOTEMPTY|EXDEV)\b/],
  // Normalizing CRLF is not a platform branch: both sides run the same blob bytes.
  ['line-endings', /autocrlf|os\.EOL/i],
]);
export const packTerms = Object.freeze([
  ['pack', /\bpacks?\b|pack\.json|selection\.json|packsDir|RS3_PACK/],
  ['pack-content', /resources\/|original-picker|map-assets|game-data|task-item-artwork|RS3_GAME_DATA_DIR|RS3_MAP_ASSETS_DIR/],
]);
export const textTerms = Object.freeze([['release-text', /changelog|roadmap|textOverrides|release-text/i]]);

// Comments explain platforms without branching on them. Only whole comment lines
// are dropped: a trailing comment still counts, so nothing real can hide.
export const stripComments = text => text.split('\n').filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n');
// Each hit keeps its 1-based line so a review can name exactly what it read.
const lineHits = (terms, text) => {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return;
    for (const [term, pattern] of terms) if (pattern.test(line)) found.push({ term, line: index + 1 });
  });
  return found;
};
const reviewedLine = (entry, line) => entry.lines.some(([start, end]) => line >= start && line <= end);

/** Why a test file cannot be neutral; empty reasons mean "candidate". A ledger
 * entry (reviewed module, pinned bytes, named terms, reviewed line ranges) waives
 * only those terms on only those lines of only that module. Any other hit in the
 * module still counts, and the waiver lapses the moment the module's bytes change.
 * Line numbers count every line of the CRLF-normalised text, comments included. */
export async function classifyTest(view, file, ledger = []) {
  const name = 'tests/' + file, reasons = { platform: [], pack: [], text: [], script: [] }, waived = [];
  if (windowsBoundTests.includes(file)) reasons.platform.push({ term: 'windows-slice', file: name });
  const closure = await closureOf(view, name);
  for (const member of closure) {
    if (scriptFile.test(member)) { reasons.script.push({ term: 'script', file: member }); continue; }
    if (!codeFile.test(member)) continue;
    const bytes = await view.read(member), text = normalizeContent(bytes).toString('utf8');
    const review = ledger.find(entry => entry.path === member && entry.sha256 === contentHash(bytes));
    for (const [kind, terms] of [['platform', platformTerms], ['pack', packTerms], ['text', textTerms]])
      for (const { term, line } of lineHits(terms, text)) {
        if (kind !== 'pack' && review?.terms.includes(term) && reviewedLine(review, line)) waived.push({ term, file: member, line });
        else reasons[kind].push({ term, file: member, line });
      }
  }
  const neutral = !reasons.platform.length && !reasons.script.length && !reasons.text.length;
  return { file, closure, neutral, needsPacks: neutral && reasons.pack.length > 0, reasons, waived };
}

// ---- Allowlist: reviewed, byte-pinned like test-inputs.json. ----
const waivable = new Set([...platformTerms, ...textTerms].map(([term]) => term));
// Sorted, non-overlapping, 1-based inclusive [start, end] pairs.
const validRanges = lines => Array.isArray(lines) && lines.length > 0 && lines.every((range, index) => Array.isArray(range) && range.length === 2
  && range.every(value => Number.isSafeInteger(value) && value > 0) && range[0] <= range[1] && (index === 0 || range[0] > lines[index - 1][1]));
export function validateAllowlist(value) {
  if (value?.schema !== 'rs3-neutral-allowlist-v1' || !Array.isArray(value.files) || typeof value.reviewed !== 'object' || !value.reviewed
    || !Array.isArray(value.reviewedModules ?? [])) throw Error('Neutral allowlist invalid.');
  const seen = new Set();
  for (const entry of value.files) {
    if (typeof entry?.file !== 'string' || !/^[A-Za-z0-9._-]+\.test\.mjs$/.test(entry.file) || seen.has(entry.file)
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !['no-packs', 'packs'].includes(entry.qualifiedWith)
      || windowsBoundTests.includes(entry.file)) throw Error('Neutral allowlist entry invalid.');
    seen.add(entry.file);
  }
  if ([...seen].join('\n') !== [...seen].sort().join('\n')) throw Error('Neutral allowlist must be sorted.');
  const modules = new Set();
  for (const entry of value.reviewedModules ?? []) {
    if (typeof entry?.path !== 'string' || !codeFile.test(entry.path) || /\.test\.mjs$/.test(entry.path) || modules.has(entry.path)
      || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !Array.isArray(entry.terms) || !entry.terms.length
      || entry.terms.some(term => !waivable.has(term)) || new Set(entry.terms).size !== entry.terms.length || !validRanges(entry.lines)
      || typeof entry.note !== 'string' || entry.note.length < 20) throw Error('Neutral reviewed module invalid.');
    modules.add(entry.path);
  }
  return value;
}
export async function readAllowlist(view) {
  const bytes = await view.read(allowlistPath);
  if (!bytes) return { allowlist: null, sha256: null };
  return { allowlist: validateAllowlist(JSON.parse(bytes.toString('utf8'))), sha256: contentHash(bytes) };
}

/** Files the run may stand in for: allowlisted, test bytes unchanged, closure
 * still clean, and qualified with packs when the closure can read them. The
 * witness rule is applied per release by selectRemote. */
export async function eligibleFiles(view, allowlist, inventory) {
  const ledger = allowlist?.reviewedModules ?? [], listed = new Map((allowlist?.files ?? []).map(entry => [entry.file, entry]));
  const verdicts = new Map();
  for (const file of inventory) verdicts.set(file, await classifyTest(view, file, ledger));
  const refused = [], chosen = [];
  for (const [file, entry] of listed) {
    const bytes = await view.read('tests/' + file);
    if (!inventory.includes(file) || !bytes) refused.push({ file, reason: 'not-in-inventory' });
    else if (contentHash(bytes) !== entry.sha256) refused.push({ file, reason: 'test-bytes-changed' });
    else if (!verdicts.get(file).neutral) refused.push({ file, reason: 'closure-not-neutral' });
    // The PC runs with the real packs; a pass without them proves nothing for a file that can read them.
    else if (verdicts.get(file).needsPacks && entry.qualifiedWith !== 'packs') refused.push({ file, reason: 'needs-packs-qualification' });
    else chosen.push(file);
  }
  return { files: chosen.sort(), refused, verdicts };
}

/** Ledger modules the remote files rely on that no PC file of this release
 * reaches. pc: files that ran (or will run) on the PC in this same release. */
export function unwitnessed({ remote, verdicts, pc }) {
  const modules = new Set(remote.flatMap(file => verdicts.get(file).waived.map(hit => hit.file)));
  return [...modules].filter(module => !pc.some(file => verdicts.get(file)?.closure.includes(module))).sort();
}

/** The witness rule, for one release. Only files due to run fresh on the PC this
 * round may go remote. Every ledger module a remote file relies on must sit in the
 * closure of a file that runs on the PC in this release (fresh now, or earlier in
 * the same round); otherwise that entry does not apply this release, and every
 * remote file relying on it returns to the PC. Returning files only add PC
 * witnesses, so one pass settles it. */
export function selectRemote({ eligible, verdicts, fresh, ranHere = [] }) {
  const candidates = eligible.filter(file => fresh.includes(file));
  const pc = [...fresh.filter(file => !candidates.includes(file)), ...ranHere];
  const lapsed = unwitnessed({ remote: candidates, verdicts, pc });
  const back = candidates.filter(file => verdicts.get(file).waived.some(hit => lapsed.includes(hit.file)));
  return { files: candidates.filter(file => !back.includes(file)).sort(), back: back.sort(), lapsed };
}
/** Pack payloads pinned by the selection; raw bytes verified, binary hashes. */
export async function packIdentity(packsRoot) {
  const relative = name => { if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || /[:\x00-\x1f]/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Pack path refused.'); return name; };
  const selection = JSON.parse(await readFile(path.join(packsRoot, 'selection.json'), 'utf8'));
  const choices = {}, payloads = [];
  for (const kind of ['data', 'rulesText', 'art']) {
    const choice = selection[kind];
    if (!choice || !/^[a-f0-9]{64}$/.test(choice.sha256 ?? '')) throw Error('Pack selection invalid.');
    choices[kind] = { id: relative(choice.id), version: relative(choice.version), sha256: choice.sha256 };
    const root = path.join(packsRoot, choice.id, choice.version), manifest = await readFile(path.join(root, 'pack.json'));
    if (sha(manifest) !== choice.sha256) throw Error('Pack manifest changed.');
    for (const record of JSON.parse(manifest).files) {
      const bytes = await readFile(path.join(root, relative(record.path)));
      if (bytes.length !== record.bytes || sha(bytes) !== record.sha256) throw Error('Pack payload changed.');
      payloads.push([kind, record.path, record.bytes, record.sha256]);
    }
  }
  return { selection: choices, payloads: digestValue(payloads), files: payloads.length };
}

const runnerEntries = ['scripts/adaptive-test-runner.mjs', 'scripts/test-selection.mjs', 'scripts/test.mjs',
  'scripts/private-companion/retry-failed-files.mjs', 'scripts/private-companion/retry-policy.mjs', 'scripts/private-companion/neutral-lane.mjs'];

/** The key both sides compute. Kept: content, Node version, runner and selector
 * bytes, retry policy, concurrency, packs. Dropped: OS, Chrome, the heavy
 * wrapper, PATH, cwd and file modes. */
export async function neutralKey({ view, node, packs, files }) {
  if (!/^v\d+\.\d+\.\d+$/.test(node ?? '')) throw Error('Node version required.');
  const runner = {};
  for (const entry of runnerEntries) {
    const closure = await closureOf(view, entry);
    runner[entry] = digestValue(await Promise.all(closure.map(async member => [member, contentHash(await view.read(member))])));
  }
  const inputs = {
    schema: 'rs3-neutral-lane-key-v1', policy: neutralPolicy, node, packs: packs ?? null, files: [...files].sort(), runner,
    core: await treeDigest(view.coreFiles, textPaths), privateSource: await treeDigest(view.privateFiles, textPaths),
  };
  return { key: digestValue(inputs), inputs: { ...inputs, policy: digestValue(neutralPolicy) } };
}
