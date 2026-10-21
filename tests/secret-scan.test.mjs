import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { addFingerprints, fingerprint, fingerprintLines, hasFingerprint, loadCorpus, normalize, normalizationVersion, validateCorpus } from '../scripts/secret-scan/fingerprints.mjs';
import { loadReviewed, scanEntries, textOf } from '../scripts/secret-scan/scan.mjs';
import { attributionRefusals, noreplyAddress } from '../scripts/secret-scan/noreply.mjs';

const sentinel = 'Invented-Zeloria-Sentinel';
const scanner = fileURLToPath(new URL('../scripts/secret-scan/scan.mjs', import.meta.url));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const noReview = { hosts: ['runescape.wiki', 'creativecommons.org'], placeholders: new Set(), lines: new Set() };
// Random-looking values: test values with a marker word ("invented", "fixture") are placeholders.
const secretLike = 'Rk4vQ9zLm2Xw7Np3';

async function scratch(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'secret-scan-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corpusDir = path.join(root, 'corpus');
  await addFingerprints([sentinel], corpusDir);
  return { root, corpusDir, corpus: await loadCorpus(corpusDir) };
}

const scan = (corpus, text, { name = 'value.txt', reviewed = noReview } = {}) => scanEntries([{ path: name, bytes: Buffer.from(text) }], { corpus, reviewed });

test('every personal-value and credential category blocks in content and in file names, without printing the value', async t => {
  const { corpus } = await scratch(t);
  const cases = [
    ['private-fingerprint', sentinel],
    ['private-fingerprint', sentinel.split('').map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')],
    ['machine-path', String.raw`C:\Users\Zeloria\notes`],
    ['machine-path', '/home/invented-host/secret'],
    ['machine-path', String.raw`\\invented-host\share`],
    ['token', `"accessToken": "${secretLike}"`],
    ['token', `'master_token' = '${secretLike}'`],
    ['token', `"clientSecret": "${secretLike}"`],
    ['token', '"password": "correct-horse-battery"'],
    ['token', `"token": "${secretLike}"`],
    ['token', `https://example.invalid/join/${secretLike}`],
    ['token', `https://example.invalid/invite/${secretLike}`],
    ['token', `https://example.invalid/#key=${secretLike}`],
    ['token', 'ghp_' + 'a'.repeat(24)],
    ['token', secretLike.repeat(3).slice(0, 43)],
    // Long word runs with a digit stay linear (no regex backtracking).
    ['token', 'Q' + 'x'.repeat(41) + '7'],
    ['account-map-binding', '"rsn": "Zeloria Handle"'],
    ['account-map-binding', '"mapId": "zqr"'],
    ['account-map-binding', 'https://apps.runescape.com/runemetrics/profile?user=Zeloria'],
    ['personal-default', "const person = { name: 'Zeloria Vance' };"],
    ['personal-default', '"masterLabel": "Zeloria"'],
    ['service-binding', 'https://invented.firebaseio.com/'],
    ['network-identifier', '100.101.102.103'],
    ['network-identifier', 'invented-host.invented-tailnet.ts.net'],
    ['network-identifier', 'printer.lan'],
    ['network-identifier', 'Open printer.local. Then sign in'],
    ['network-identifier', 'aa:bb:cc:dd:ee:ff'],
    ['network-identifier', 'invented.person@mail.invented'],
    ['network-identifier', 'DESKTOP-AB12CD3'],
    ['network-identifier', 'https://desktop-ab12cd3.<tailnet>.ts.net'],
    ['network-identifier', 'https://invented-deployment.dev/private'],
    ['network-identifier', 'http://invented-machine:8788/'],
  ];
  for (const [index, [category, value]] of cases.entries()) {
    const content = scan(corpus, `Synthetic prefix\n${value}\nSynthetic suffix`);
    assert.ok(content.findings.some(finding => finding.category === category && finding.path === 'value.txt' && finding.line === 2), `content case ${index}`);
    const named = scanEntries([{ path: `${encodeURIComponent(value)}.txt`, bytes: Buffer.from('Synthetic content') }], { corpus, reviewed: noReview });
    assert.ok(named.findings.some(finding => finding.category === category && finding.path === '[redacted-path]'), `file name case ${index}`);
    assert.equal(JSON.stringify([content, named]).includes(value), false);
  }
});

test('public references, placeholders and generic account folders stay clean', async t => {
  const { corpus } = await scratch(t);
  for (const text of [
    "const task = { name: 'Invented task', label: 'Invented label' };",
    'https://runescape.wiki/w/Invented_page?oldid=123',
    'https://en.runescape.wiki/w/Invented_page',
    'https://runescape.wiki/api.php?action=query&titles=Invented_page&format=json',
    'https://creativecommons.org/licenses/by-nc-sa/3.0/',
    'http://localhost:8788/ and http://127.0.0.1:8788/ and https://picker.example/ and https://fixture.invalid/x',
    String.raw`C:\Users\User\Projects\chunk-picker-rs3 and C:/Users/<you>/x and /home/runner/work`,
    '.local/game-data and ~/notes',
    'fenerax@users.noreply.github.com noreply@anthropic.com someone@example.com',
    'version 1.2.3 and 127.0.0.1 and 203.0.113.7 and 2001:db8::1',
    // Test values carry a marker word or are templates.
    '"accessToken": "fixture-access-token" and "password": "synthetic-password"',
    'https://picker.invalid/join/${token} and /join/invented-invite and #key=${key}',
    '"token": "skill_123" and "token": "Quest[+]"',
    // Slugs, coordinate keys and camelCase names of 43 characters are not secrets.
    'cache-interior-3200x3200-lumbridge-castle-1',
    'retainedUnsupportedEquipmentCorrectionAudit',
    'Lumbridge-castle-cellar-north-wing-door-way',
    // File names and property reads, not computers or LAN hosts.
    "screenshot('desktop-current-task.png') and rejectLinks(name, paths.local) and data.local = 1",
    String.raw`\\.\pipe\picker-swap and \\?\C:\long`,
    'https://runescape.wiki/w/Special:PermanentLink/${row.revid} and https://runescape.wiki/w/Special:Search?search=Oak',
    // Comparisons on a field named local; numbered and timestamped slugs.
    "if (!row.local || other !== row.local && row.local) return;",
    'Dragon_battleaxe_detail_animation_variant_1',
    'run-folder-2026-10-13T10-20-30-123Z-reviews',
    '"accessToken": "FIXTURE-ACCESS-TOKEN"',
  ]) assert.equal(scan(corpus, text).status, 'clean', text);
  // JSON and JavaScript escape a backslash: there \\\\host is a UNC path and C:\\Users\\User is not.
  assert.equal(scan(corpus, String.raw`"C:\\Users\\User\\Projects\\x"`, { name: 'a.json' }).status, 'clean');
  assert.equal(scan(corpus, String.raw`"\\\\fileserver\\share"`, { name: 'a.json' }).categories['machine-path'], 1);
  // Placeholder values listed in reviewed.json pass; others still block.
  const committed = loadReviewed();
  for (const text of ['"mapId": "qxa"', 'https://apps.runescape.com/runemetrics/profile/profile?user=examplegimab', "accessToken: 'DO-NOT-RETAIN'"])
    assert.equal(scan(corpus, text, { reviewed: committed }).status, 'clean', text);
  assert.equal(scan(corpus, '"mapId": "zqr"', { reviewed: committed }).status, 'blocked, not clean');
  for (const text of [
    'https://runescape.wiki/w/Invented_page?user=Zeloria',
    'https://runescape.wiki/w/Invented_page?token=Rk4vQ9zLm2Xw',
    'https://runescape.wiki/w/User:Invented',
    'https://runescape.wiki/w/Special:Contributions/Invented',
    'https://runescape.wiki/api.php?action=login',
    'https://runescape.wiki.evil.invented/w/Invented',
    'https://user:pass@runescape.wiki/w/Invented',
    'https://runescape.wiki:8443/w/Invented',
  ]) assert.equal(scan(corpus, text).status, 'blocked, not clean', text);
});

test('reviewed lines need the exact path, category and line bytes, and reviewed hosts are named in the file', async t => {
  const { corpus } = await scratch(t);
  const line = `const origin = 'https://invented-reference.org/page';`;
  const reviewed = { hosts: [], placeholders: new Set(), lines: new Set([`docs/a.md\0network-identifier\0${sha256(line)}`]) };
  assert.equal(scan(corpus, `${line}\n`, { name: 'docs/a.md', reviewed }).status, 'clean');
  assert.equal(scan(corpus, `${line} \n`, { name: 'docs/a.md', reviewed }).status, 'blocked, not clean');
  assert.equal(scan(corpus, `${line}\n`, { name: 'docs/b.md', reviewed }).status, 'blocked, not clean');
  // A different category on the same line still blocks.
  assert.ok(scan(corpus, `${line} ${sentinel}\n`, { name: 'docs/a.md', reviewed }).categories['private-fingerprint']);
  const committed = loadReviewed();
  assert.ok(committed.hosts.includes('runescape.wiki'));
  assert.equal(scanEntries([{ path: 'x.md', bytes: Buffer.from('https://runescape.wiki/w/A') }], { corpus, reviewed: committed }).status, 'clean');
});

test('an escaped line break only unsettles its own line', async t => {
  const { corpus } = await scratch(t);
  const line = `const origin = 'https://invented-reference.org/page';`;
  // Built at run time so this file's own line stays stable for its exception.
  const escape = ['\\', 'u000a'].join('');
  const broken = `const split = 'https://invented-reference.org/a${escape}b';`;
  const key = text => `x.mjs\0network-identifier\0${sha256(text)}`;
  const text = `${broken}\n${line}\n`;
  // Without exceptions both findings are reported at their source lines.
  assert.deepEqual(scan(corpus, text, { name: 'x.mjs' }).findings.map(f => f.line), [1, 2]);
  // The line after the escape keeps its exception; the escaped line cannot use one.
  const reviewed = { hosts: [], placeholders: new Set(), lines: new Set([key(broken), key(line)]) };
  assert.deepEqual(scan(corpus, text, { name: 'x.mjs', reviewed }).findings.map(f => f.line), [1]);
});

test('large files and binary files are scanned whole, with no size limit', async t => {
  const { corpus } = await scratch(t);
  const filler = 'Synthetic filler line with ordinary words.\n'.repeat(60000);
  const result = scan(corpus, `${filler}${sentinel}\n${filler}`);
  assert.deepEqual(result.findings.map(row => [row.category, row.line]), [['private-fingerprint', 60001]]);
  // A value that spans a piece boundary still matches.
  const spanning = 'x'.repeat((1 << 18) - 5) + sentinel;
  assert.ok(fingerprintLines(spanning, corpus).length);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 0, 0]), Buffer.from(`tEXtAuthor\0${sentinel}`), Buffer.from([0, 1, 2])]);
  assert.match(textOf(png), /Sentinel/);
  assert.ok(scanEntries([{ path: 'art.png', bytes: png }], { corpus, reviewed: noReview }).categories['private-fingerprint']);
});

test('the rolling prefilter matches every HMAC window across Unicode, lengths and offsets', async t => {
  const { root } = await scratch(t);
  const corpusDir = path.join(root, 'rolling-corpus');
  const values = [sentinel, 'Invented Straße', 'ＡＢＣ\\folder', 'Ångström', 'duo\nfragment', '😀Alias', 'x'];
  await addFingerprints(values, corpusDir);
  const fast = await loadCorpus(corpusDir);
  const legacy = { ...fast, rollingByLength: new Map([...fast.rollingByLength.keys()].map(length => [length, null])) };
  for (const value of values) {
    for (const variant of [value, value.toUpperCase(), value.normalize('NFD'), value.replaceAll('\\', '/')]) {
      for (const prefix of ['', 'prefix ', 'prefix\n', '😀 prefix\n']) {
        const text = `${prefix}${variant}\nother invented content`;
        assert.deepEqual(fingerprintLines(text, fast), fingerprintLines(text, legacy));
        assert.ok(fingerprintLines(text, fast).length > 0);
      }
    }
  }
  assert.equal(fingerprint('😀Straße', fast.key).length, normalize('😀Straße').length);
  assert.deepEqual(await readdir(corpusDir).then(names => names.sort()), ['corpus.json', 'key']);
  for (const value of values) assert.equal((await readFile(path.join(corpusDir, 'corpus.json'), 'utf8')).includes(value), false);
});

test('rolling collisions still need the HMAC, and a corpus is required unless explicitly skipped', async t => {
  const { root } = await scratch(t);
  const key = randomBytes(32), wanted = 'invented-alpha', other = 'invented-bravo';
  const header = { schemaVersion: 1, normalization: normalizationVersion, keyCheck: createHmac('sha256', key).update(normalizationVersion).digest('hex') };
  const collision = validateCorpus({ ...header, fingerprints: [{ ...fingerprint(wanted, key), rolling: fingerprint(other, key).rolling }] }, key);
  assert.deepEqual(fingerprintLines(other, collision), []);
  const { rolling, ...oldRow } = fingerprint(wanted, key);
  assert.ok(hasFingerprint(wanted, validateCorpus({ ...header, fingerprints: [oldRow] }, key)));
  await assert.rejects(loadCorpus(path.join(root, 'absent')), { category: 'missing-or-invalid-corpus' });
  assert.throws(() => scanEntries([], { corpus: undefined, reviewed: noReview }), { category: 'missing-or-invalid-corpus' });
  assert.equal(scanEntries([{ path: 'a.txt', bytes: Buffer.from(sentinel) }], { corpus: null, reviewed: noReview }).status, 'clean');
});

test('the command scans Git objects, checks attribution and never prints a value', async t => {
  const { root, corpusDir } = await scratch(t);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  const git = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const as = email => ({ GIT_AUTHOR_NAME: 'Invented', GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: 'Invented', GIT_COMMITTER_EMAIL: email });
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(repo, 'a.txt'), 'clean text\n');
  git(['add', '.']); git(['commit', '-qm', 'clean'], as('fenerax@users.noreply.github.com'));
  const base = git(['rev-parse', 'HEAD']).trim();
  const run = (...args) => spawnSync(process.execPath, [scanner, '--repo', repo, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(run('--tree', 'HEAD', '--corpus-dir', corpusDir).status, 0);
  assert.equal(run('--tree', 'HEAD').status, 2, 'a missing corpus refuses');
  await writeFile(path.join(repo, 'b.txt'), `prefix\n${sentinel}\n`);
  git(['add', '.']); git(['commit', '-qm', 'add b'], as('invented.person@mail.invented'));
  const refused = run('--commits', `${base}..HEAD`, '--corpus-dir', corpusDir);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /private-fingerprint b\.txt:2/);
  assert.match(refused.stdout, /attribution [a-f0-9]{12}: author and committer not a GitHub noreply address/);
  assert.equal((refused.stdout + refused.stderr).includes(sentinel) || (refused.stdout + refused.stderr).includes('invented.person'), false);
  const patternsOnly = run('--commits', 'HEAD', '--without-corpus');
  assert.match(patternsOnly.stdout, /No private-value corpus/);
  assert.match(patternsOnly.stdout, /2 commits checked/);
  // A message is scanned like a file.
  git(['commit', '-q', '--allow-empty', '-m', `note ${sentinel}`], as('fenerax@users.noreply.github.com'));
  assert.match(run('--commits', 'HEAD~1..HEAD', '--corpus-dir', corpusDir).stdout, /private-fingerprint commit [a-f0-9]{12} message:1/);
});

test('noreply addresses are GitHub noreply only', () => {
  for (const email of ['fenerax@users.noreply.github.com', '12345+fenerax@users.noreply.github.com', 'noreply@github.com']) assert.ok(noreplyAddress(email), email);
  for (const email of ['person@gmail.com', 'fenerax@users.noreply.github.com.invented', 'noreply@anthropic.com', '']) assert.equal(noreplyAddress(email), false, email);
  assert.deepEqual(attributionRefusals(process.cwd(), []), []);
});

test('the pre-push hook scans what a push sends and refuses findings, attribution or a missing corpus', async t => {
  const { root, corpusDir } = await scratch(t);
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Invented', GIT_AUTHOR_EMAIL: 'fenerax@users.noreply.github.com', GIT_COMMITTER_NAME: 'Invented', GIT_COMMITTER_EMAIL: 'fenerax@users.noreply.github.com' } }).trim();
  git(['init', '-q']); git(['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(repo, 'a.txt'), 'clean text\n');
  git(['add', '.']); git(['commit', '-qm', 'clean']);
  const clean = git(['rev-parse', 'HEAD']), zero = '0'.repeat(40);
  const hook = fileURLToPath(new URL('../scripts/secret-scan/pre-push.mjs', import.meta.url));
  const push = (local, remote, env = { SECRET_SCAN_CORPUS: corpusDir }) => spawnSync(process.execPath, [hook, 'origin'],
    { cwd: repo, input: `refs/heads/main ${local} refs/heads/main ${remote}\n`, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } });
  assert.equal(push(clean, zero).status, 0, 'a new branch with clean history passes');
  assert.equal(push(zero, clean).status, 0, 'deleting a remote branch sends nothing');
  assert.equal(push(clean, zero, { SECRET_SCAN_CORPUS: path.join(root, 'absent') }).status, 1, 'a missing corpus refuses');
  await writeFile(path.join(repo, 'b.txt'), `prefix\n${sentinel}\n`);
  git(['add', '.']); git(['commit', '-qm', 'add b']);
  const refused = push(git(['rev-parse', 'HEAD']), clean);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /private-fingerprint b\.txt:2/);
  assert.match(refused.stderr, /Push refused/);
  assert.equal(refused.stderr.includes(sentinel), false);
});

test('corpus-add seeds values from a list or a save copy, checks each blocks, and never prints them', async t => {
  const { root } = await scratch(t);
  const tool = fileURLToPath(new URL('../scripts/secret-scan/corpus-add.mjs', import.meta.url));
  const { addValues } = await import('../scripts/secret-scan/corpus-add.mjs');
  const defaults = path.join(root, 'defaults.mjs'), save = path.join(root, 'synthetic-save.json'), corpusDir = path.join(root, 'seeded');
  await writeFile(defaults, "export const legacyGameDefaults = Object.freeze({members: [{id: 'zeloria', name: 'Zéloria', mapId: 'invented-map'}], masterLabel: 'Zéloria'});");
  await writeFile(save, JSON.stringify({ state: { members: [{ id: 'invented-member', name: 'Invented Ariadne', runescapeName: 'InventedHandle', sourceMapId: 'invented-source', journal: 'DO-NOT-SEED-JOURNAL' }] } }));
  const result = await addValues({ save, defaults, corpusDir });
  const corpus = await loadCorpus(corpusDir);
  for (const value of ['zeloria', 'Zéloria', 'invented-map', 'invented-member', 'Invented Ariadne', 'InventedHandle', 'invented-source']) {
    assert.equal(hasFingerprint(value, corpus), true, value);
    assert.equal(JSON.stringify(result).includes(value), false);
    assert.equal((await readFile(path.join(corpusDir, 'corpus.json'), 'utf8')).includes(value), false);
  }
  assert.equal(hasFingerprint('DO-NOT-SEED-JOURNAL', corpus), false);
  assert.deepEqual((await readdir(corpusDir)).sort(), ['corpus.json', 'key']);
  await writeFile(save, JSON.stringify({ members: [{ id: 'invented' }] }));
  await assert.rejects(addValues({ save, defaults, corpusDir }), { category: 'members-invalid' });
  const listed = spawnSync(process.execPath, [tool, '--corpus-dir', corpusDir], { input: 'Qx7 Invented Value\n', encoding: 'utf8', windowsHide: true });
  assert.equal(listed.status, 0);
  assert.equal(listed.stdout.includes('Qx7'), false);
  assert.equal(hasFingerprint('Qx7 Invented Value', await loadCorpus(corpusDir)), true);
  const missing = spawnSync(process.execPath, [tool, '--save', path.join(root, sentinel)], { encoding: 'utf8', windowsHide: true });
  assert.equal(missing.status, 2);
  assert.equal((missing.stdout + missing.stderr).includes(sentinel), false);
});
