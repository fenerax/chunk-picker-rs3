import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { addFingerprints, fingerprint, fingerprintLines, hasFingerprint, loadCorpus, normalize, normalizationVersion, validateCorpus } from '../scripts/public-export/fingerprints.mjs';
import { createHmac, randomBytes } from 'node:crypto';
import { reportScan, scanDirectory, scanEntries } from '../scripts/public-export/scan.mjs';
import { sha256 } from '../scripts/public-export/common.mjs';

const sentinel = 'Invented-Zeloria-Sentinel';
const provenance = { schemaVersion: 1, files: [] };
const toolDirectory = fileURLToPath(new URL('../scripts/public-export/', import.meta.url));

async function scratch(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'export-scanner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corpusDir = path.join(root, 'corpus');
  await addFingerprints([sentinel], corpusDir);
  return { root, corpusDir };
}

test('scratch exports fail each private or retained artifact category without disclosing values', async t => {
  const { root, corpusDir } = await scratch(t);
  const cases = [
    ['private-fingerprint', sentinel],
    ['machine-path', String.raw`C:\Users\Invented-Host\secret`],
    ['machine-path', '.local/private-state'],
    ['token', '"accessToken": "invented-secret-token-value"'],
    ['token', "'master_token' = 'invented-secret-token-value'"],
    ['token', '"clientSecret": "invented-secret-value"'],
    ['token', '"password": "invented-password-value"'],
    ['token', 'https://example.invalid/join/invented-invite'],
    ['token', 'https://example.invalid/invite/invented-invite'],
    ['network-identifier', '100.101.102.103'],
    ['network-identifier', 'https://invented-deployment.test/private'],
    ['legacy-task-id', 'rs3:task:invented:123'],
    ['cache-catalogue', 'app/data/cache-resources.2026-10-08.v1.json'],
    ['copied-source', 'reference/original-picker/index.html'],
  ];
  for (const [index, [category, value]] of cases.entries()) {
    const candidate = path.join(root, `candidate-${index}`);
    await mkdir(candidate);
    await writeFile(path.join(candidate, 'value.txt'), `Synthetic prefix\n${value}`);
    await writeFile(path.join(candidate, `${encodeURIComponent(value)}.txt`), 'Synthetic content');
    const result = await scanDirectory(candidate, { corpusDir, provenance });
    assert.equal(result.status, 'blocked, not clean');
    assert.ok(result.findings.some(finding => finding.category === category && finding.path === 'value.txt'), `content category ${index}`);
    assert.ok(result.findings.some(finding => finding.category === category && finding.path === '[redacted-path]'), `filename category ${index}`);
    const output = []; reportScan(result, line => output.push(line));
    assert.equal(output.join('\n').includes(value), false);
    assert.equal(output.join('\n').includes(encodeURIComponent(value)), false);
  }
});

test('raster provenance cannot authorize binary media and reviewed SVG stays text-scanned', async t => {
  const { root, corpusDir } = await scratch(t);
  const candidate = path.join(root, 'candidate');
  await mkdir(path.join(candidate, 'app/web/placeholder-art'), { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const rasterPath = 'app/web/placeholder-art/invented.png';
  const svgPath = 'app/web/placeholder-art/invented.svg';
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>');
  const invalidRasterProvenance = { schemaVersion: 1, files: [
    { path: rasterPath, bytes: png.length, sha256: sha256(png), authoring: 'Synthetic bytes.' },
  ] };
  const approved = { schemaVersion: 1, files: [
    { path: svgPath, bytes: svg.length, sha256: sha256(svg), authoring: 'Synthetic geometric SVG.' },
  ] };
  await writeFile(path.join(candidate, rasterPath), png);
  await writeFile(path.join(candidate, svgPath), svg);
  const result = await scanDirectory(candidate, { corpusDir, provenance: approved });
  assert.ok(result.findings.some(finding => finding.path === rasterPath && finding.category === 'unapproved-binary'));
  // SVG namespace URIs identify a format and do not bind a deployment host.
  const corpus = await loadCorpus(corpusDir);
  assert.throws(() => scanEntries([{ path: rasterPath, bytes: png }], { corpus, provenance: invalidRasterProvenance }), { category: 'invalid-provenance' });
  const safe = scanEntries([{ path: svgPath, bytes: svg }], { corpus, provenance: approved });
  assert.equal(safe.status, 'clean');
  const poisoned = Buffer.from(`<svg>${sentinel}</svg>`);
  const poisonedProvenance = { schemaVersion: 1, files: [{ path: svgPath, bytes: poisoned.length, sha256: sha256(poisoned), authoring: 'Synthetic negative.' }] };
  assert.ok(scanEntries([{ path: svgPath, bytes: poisoned }], { corpus, provenance: poisonedProvenance }).categories['private-fingerprint']);
  for (const extension of ['jpg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'avif', 'bin']) {
    assert.ok(scanEntries([{ path: `invented.${extension}`, bytes: png }], { corpus, provenance }).categories['unapproved-binary']);
  }
});

test('reviewed exceptions require exact path/category/line bytes and never suppress fingerprints or filenames', async t => {
  const { corpusDir } = await scratch(t);
  const corpus = await loadCorpus(corpusDir);
  const text = "const storage = path.join(root, '.local', 'open-starter');";
  const reviewedExceptions = { schemaVersion: 1, lines: [{ path: 'app/runtime.mjs', category: 'machine-path', sha256: sha256(Buffer.from(text)), reason: 'Synthetic inert runtime default.' }] };
  const scan = (entry, exceptions = reviewedExceptions) => scanEntries([entry], { corpus, provenance, reviewedExceptions: exceptions });
  assert.equal(scan({ path: 'app/runtime.mjs', text }).status, 'clean');
  assert.ok(scan({ path: 'app/runtime.mjs', text: `${text} extra` }).categories['machine-path']);
  assert.ok(scan({ path: 'other.mjs', text }).categories['machine-path']);
  assert.ok(scan({ path: '.local/example.mjs', text }).categories['machine-path']);
  assert.ok(scan({ path: 'app/runtime.mjs', text: `${text}\n${sentinel}` }).categories['private-fingerprint']);
  assert.ok(scan({ path: 'app/runtime.mjs', text: String.raw`\u000a.local/private` + `\n${text}` }).categories['machine-path']);
  assert.throws(() => scan({ path: 'app/runtime.mjs', text }, { schemaVersion: 1, lines: [{ ...reviewedExceptions.lines[0], category: 'private-fingerprint' }] }), { category: 'invalid-reviewed-exceptions' });
});

test('rolling prefilter matches legacy HMAC windows across Unicode, lengths and every offset', async t => {
  const { root } = await scratch(t);
  const corpusDir = path.join(root, 'rolling-corpus');
  const values = [sentinel, 'Invented Straße', 'ＡＢＣ\\folder', 'Ångström', 'duo\nfragment', '😀Alias', 'x'];
  await addFingerprints(values, corpusDir);
  const fast = await loadCorpus(corpusDir), legacy = { key: fast.key, byLength: fast.byLength };
  assert.ok(fast.byLength instanceof Map);
  for (const digests of fast.byLength.values()) assert.ok(digests instanceof Set);
  for (const filter of fast.rollingByLength.values()) assert.ok(filter instanceof Set);
  for (const value of values) {
    for (const variant of [value, value.toUpperCase(), value.normalize('NFD'), value.replaceAll('\\', '/')]) {
      for (const prefix of ['', 'prefix ', 'prefix\n', '😀 prefix\n']) {
        const text = `${prefix}${variant}\nother invented content`;
        assert.deepEqual(fingerprintLines(text, fast), fingerprintLines(text, legacy));
        assert.ok(fingerprintLines(text, fast).length > 0);
      }
    }
  }
  const text = `${'Safe synthetic punctuation and digits 0123456789.\n'.repeat(8)}${values.join('\n')}\n`;
  assert.deepEqual(fingerprintLines(text, fast), fingerprintLines(text, legacy));
  // Normalized UTF-16 lengths, including expanded folds and surrogate pairs,
  // are the same units used by both the digest and the rolling window.
  assert.equal(fingerprint('😀Straße', fast.key).length, normalize('😀Straße').length);
  const longest = 'z'.repeat(4096), longestDir = path.join(root, 'longest');
  await addFingerprints([longest], longestDir);
  const boundary = await loadCorpus(longestDir);
  assert.deepEqual(fingerprintLines(`prefix\n${longest}\nsuffix`, boundary),
    fingerprintLines(`prefix\n${longest}\nsuffix`, { key: boundary.key, byLength: boundary.byLength }));
});

test('rolling collisions still require HMAC and legacy rows upgrade when re-seeded', async t => {
  const { root } = await scratch(t);
  const key = randomBytes(32), wanted = 'invented-alpha', other = 'invented-bravo';
  assert.equal(wanted.length, other.length);
  const row = fingerprint(wanted, key);
  const header = { schemaVersion: 1, normalization: normalizationVersion, keyCheck: createHmac('sha256', key).update(normalizationVersion).digest('hex') };
  // Force the other string through the rolling prefilter. A 32-bit collision
  // must never become an authoritative match without the HMAC digest.
  const collision = validateCorpus({ ...header, fingerprints: [{ ...row, rolling: fingerprint(other, key).rolling }] }, key);
  assert.deepEqual(fingerprintLines(other, collision), []);
  const { rolling, ...oldRow } = row;
  const mixed = validateCorpus({ ...header, fingerprints: [oldRow, fingerprint(other, key)] }, key);
  assert.equal(mixed.rollingByLength.get(wanted.length), null);
  assert.ok(hasFingerprint(wanted, mixed));
  assert.ok(hasFingerprint(other, mixed));
  const corpusDir = path.join(root, 'old-corpus');
  await mkdir(corpusDir);
  await writeFile(path.join(corpusDir, 'key'), key);
  await writeFile(path.join(corpusDir, 'corpus.json'), JSON.stringify({ ...header, fingerprints: [oldRow] }));
  assert.equal((await loadCorpus(corpusDir)).rollingByLength.get(wanted.length), null);
  assert.equal(await addFingerprints([wanted], corpusDir), 1);
  assert.ok((await loadCorpus(corpusDir)).rollingByLength.get(wanted.length) instanceof Set);
  for (const invalid of [-1, 0x100000000, 0.5, null, '0']) {
    assert.throws(() => validateCorpus({ ...header, fingerprints: [{ ...row, rolling: invalid }] }, key), { category: 'missing-or-invalid-corpus' });
  }
});

test('public source URLs and authored task labels remain eligible while identity and account bindings fail', async t => {
  const { corpusDir } = await scratch(t);
  const corpus = await loadCorpus(corpusDir);
  const scan = text => scanEntries([{ path: 'source.txt', text }], { corpus, provenance });
  for (const text of [
    "const task = { name: 'Invented task', label: 'Invented label' };",
    'https://runescape.wiki/w/Invented_page?oldid=123',
    'https://en.runescape.wiki/w/Invented_page',
    'https://runescape.wiki/api.php?action=query&titles=Invented_page&format=json',
    'https://creativecommons.org/licenses/by-nc-sa/3.0/',
  ]) assert.equal(scan(text).status, 'clean');
  for (const text of [
    "const person = { name: 'Invented identity' };",
    "const task = { label: 'Invented-Zeloria-Sentinel' };",
    'https://runescape.wiki/w/Invented_page?user=Invented',
    'https://runescape.wiki/w/Invented_page?account=Invented',
    'https://runescape.wiki/w/Invented_page?token=InventedSecret',
    'https://runescape.wiki/w/User:Invented',
    'https://runescape.wiki/api.php?action=login',
    'https://runescape.wiki/api.php?action=query&titles=User:Invented',
    'https://runescape.wiki/private',
    'https://runescape.wiki.evil.test/w/Invented',
    'https://user:pass@runescape.wiki/w/Invented',
    'https://creativecommons.org/private',
  ]) assert.equal(scan(text).status, 'blocked, not clean');
});
