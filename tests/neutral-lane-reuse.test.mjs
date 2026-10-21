// Phase B neutral lane: the content-only key, the closure classifier, the reviewed
// ledger with its witness rule, and the allowlist's shape. Fixture trees only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { normalizeContent, contentHash, openSources, classifyTest, validateAllowlist, eligibleFiles, selectRemote, unwitnessed,
  neutralKey, windowsBoundTests, allowlistPath } from '../scripts/private-companion/neutral-lane.mjs';

async function tree(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'neutral-lane-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return root;
}
async function view(coreFiles, privateFiles = {}) {
  const core = await tree(coreFiles), privateSource = await tree(privateFiles);
  test.after(() => Promise.all([rm(core, { recursive: true, force: true }), rm(privateSource, { recursive: true, force: true })]));
  return openSources({ core, privateSource });
}
const pin = text => contentHash(Buffer.from(text));

test('content is normalized for CRLF, binary is hashed raw', () => {
  assert.equal(normalizeContent(Buffer.from('a\r\nb\r\n')).toString(), 'a\nb\n');
  const binary = Buffer.from([0, 13, 10, 65]);
  assert.deepEqual(normalizeContent(binary), binary);
  assert.equal(contentHash(Buffer.from('x\r\n')), contentHash(Buffer.from('x\n')));
});

test('the key ignores line endings and release text, and binds content, Node, packs and files', async () => {
  const base = { 'app/a.mjs': 'export const a = 1;\n', 'app/data/changelog.json': '[]\n', 'tests/a.test.mjs': "import '../app/a.mjs';\n" };
  const key = async (files, options = {}) => (await neutralKey({ view: await view(files, { 'tests/p.test.mjs': 'p\n' }),
    node: 'v24.20.0', packs: null, files: ['a.test.mjs'], ...options })).key;
  const reference = await key(base);
  assert.equal(await key({ ...base, 'app/a.mjs': 'export const a = 1;\r\n' }), reference);
  assert.equal(await key({ ...base, 'app/data/changelog.json': '[{"live":true}]\n' }), reference);
  assert.notEqual(await key({ ...base, 'app/a.mjs': 'export const a = 2;\n' }), reference);
  assert.notEqual(await key(base, { node: 'v24.21.0' }), reference);
  assert.notEqual(await key(base, { packs: { selection: {}, payloads: 'x', files: 1 } }), reference);
  assert.notEqual(await key(base, { files: ['b.test.mjs'] }), reference);
  await assert.rejects(key(base, { node: '24' }), /Node version required/);
});

test('the private overlay may not replace shared core code', async () => {
  await assert.rejects(view({ 'app/a.mjs': 'a\n' }, { 'app/a.mjs': 'b\n' }), /would replace shared code/);
  const ok = await view({ 'tests/a.test.mjs': 'core\n' }, { 'tests/a.test.mjs': 'private\n' });
  assert.equal((await ok.read('tests/a.test.mjs')).toString(), 'private\n');
});

test('the classifier follows imports and keeps platform, script and text readers off the lane', async () => {
  const v = await view({
    'app/plain.mjs': 'export const x = 1;\n// On win32 this is never called differently.\n',
    'app/platform.mjs': "export const w = process.platform === 'win32';\n",
    'app/trailing.mjs': 'export const y = 1; // process.platform\n',
    'app/pack.mjs': "export const p = 'pack.json';\n",
    'app/text.mjs': "export const t = 'app/data/changelog.json';\n",
    'app/runs.mjs': "export const s = 'scripts/stop.ps1';\n",
    'scripts/stop.ps1': 'Stop-Process\n',
    'tests/plain.test.mjs': "import '../app/plain.mjs';\n",
    'tests/deep.test.mjs': "import '../app/plain.mjs'; await import('../app/platform.mjs');\n",
    'tests/trailing.test.mjs': "import '../app/trailing.mjs';\n",
    'tests/pack.test.mjs': "import '../app/pack.mjs';\n",
    'tests/text.test.mjs': "import '../app/text.mjs';\n",
    'tests/script.test.mjs': "import '../app/runs.mjs';\n",
    'tests/operations.test.mjs': "import '../app/plain.mjs';\n",
  });
  const verdict = async file => classifyTest(v, file);
  assert.equal((await verdict('plain.test.mjs')).neutral, true);
  assert.deepEqual((await verdict('deep.test.mjs')).reasons.platform.map(hit => hit.file), ['app/platform.mjs', 'app/platform.mjs']);
  assert.equal((await verdict('trailing.test.mjs')).neutral, false, 'a trailing comment still counts');
  const pack = await verdict('pack.test.mjs');
  assert.equal(pack.neutral, true); assert.equal(pack.needsPacks, true);
  assert.equal((await verdict('text.test.mjs')).reasons.text.length, 1);
  assert.deepEqual((await verdict('script.test.mjs')).reasons.script.map(hit => hit.file), ['scripts/stop.ps1']);
  assert.equal((await verdict('operations.test.mjs')).reasons.platform[0].term, 'windows-slice');
});

test('a reviewed ledger entry waives only its terms on its lines in its exact bytes', async () => {
  const hub = "export const fold = name => process.platform === 'win32' ? name.toLowerCase() : name;\nexport const p = 'pack.json';\n";
  const v = await view({ 'app/hub.mjs': hub, 'tests/a.test.mjs': "import '../app/hub.mjs';\n" });
  const entry = { path: 'app/hub.mjs', sha256: pin(hub), terms: ['platform', 'windows'], lines: [[1, 1]], note: 'Case-folding only; reviewed 2026-10-20.' };
  const waived = await classifyTest(v, 'a.test.mjs', [entry]);
  assert.equal(waived.neutral, true);
  assert.equal(waived.needsPacks, true, 'pack terms are never waived');
  assert.deepEqual(waived.waived.map(hit => [hit.term, hit.line]).sort(), [['platform', 1], ['windows', 1]]);
  const lapsed = await classifyTest(v, 'a.test.mjs', [{ ...entry, sha256: pin(hub + ' ') }]);
  assert.equal(lapsed.neutral, false, 'a lapsed hash: changed bytes void the waiver');
  assert.deepEqual(lapsed.waived, []);
  assert.equal((await classifyTest(v, 'a.test.mjs', [{ ...entry, terms: ['platform'] }])).neutral, false, 'only the listed terms');
  assert.equal((await classifyTest(v, 'a.test.mjs', [{ ...entry, lines: [[2, 2]] }])).neutral, false, 'only the reviewed lines');
  // CRLF bytes pin and count lines the same way.
  const crlf = await view({ 'app/hub.mjs': hub.replace(/\n/g, '\r\n'), 'tests/a.test.mjs': "import '../app/hub.mjs';\n" });
  assert.equal((await classifyTest(crlf, 'a.test.mjs', [entry])).neutral, true);
});

test('an unknown term in a ledger module, or a reviewed term on a new line, keeps it off the lane', async () => {
  const hub = "export const fold = name => process.platform === 'win32' ? name.toLowerCase() : name;\n";
  const entry = body => ({ path: 'app/hub.mjs', sha256: pin(body), terms: ['platform', 'windows'], lines: [[1, 1]], note: 'Case-folding only; reviewed 2026-10-20.' });
  const unknown = hub + "export const busy = error => error.code === 'EBUSY';\n";
  const v1 = await view({ 'app/hub.mjs': unknown, 'tests/a.test.mjs': "import '../app/hub.mjs';\n" });
  const one = await classifyTest(v1, 'a.test.mjs', [entry(unknown)]);
  assert.equal(one.neutral, false);
  assert.deepEqual(one.reasons.platform, [{ term: 'error-codes', file: 'app/hub.mjs', line: 2 }]);
  const moved = hub + "export const again = process.platform;\n";
  const v2 = await view({ 'app/hub.mjs': moved, 'tests/a.test.mjs': "import '../app/hub.mjs';\n" });
  const two = await classifyTest(v2, 'a.test.mjs', [entry(moved)]);
  assert.equal(two.neutral, false);
  assert.deepEqual(two.reasons.platform, [{ term: 'platform', file: 'app/hub.mjs', line: 2 }]);
});

test('eligibility: pinned test bytes and a clean closure; the witness rule picks per release', async () => {
  const hub = "export const w = process.platform;\n";
  const files = { 'app/hub.mjs': hub, 'app/plain.mjs': 'export {};\n', 'app/win.mjs': "export const w = 'win32';\n", 'app/reads.mjs': "export const p = 'pack.json';\n",
    'tests/e.test.mjs': "import '../app/reads.mjs';\n", 'tests/f.test.mjs': "import '../app/reads.mjs'; // packs\n",
    'tests/a.test.mjs': "import '../app/plain.mjs';\n", 'tests/b.test.mjs': "import '../app/hub.mjs';\n",
    'tests/c.test.mjs': "import '../app/win.mjs';\n", 'tests/d.test.mjs': "import '../app/plain.mjs'; // changed\n",
    'tests/pc.test.mjs': "import '../app/hub.mjs'; import '../app/win.mjs';\n" };
  const v = await view(files);
  const ledger = [{ path: 'app/hub.mjs', sha256: pin(hub), terms: ['platform'], lines: [[1, 1]], note: 'Reads the platform for a label only.' }];
  const allow = names => ({ schema: 'rs3-neutral-allowlist-v1', reviewed: { by: 'test' }, reviewedModules: ledger,
    files: names.map(file => ({ file, sha256: pin(file === 'd.test.mjs' ? "import '../app/plain.mjs';\n" : files['tests/' + file] ?? 'gone\n'), qualifiedWith: file === 'f.test.mjs' ? 'packs' : 'no-packs' })) });
  const inventory = ['a.test.mjs', 'b.test.mjs', 'c.test.mjs', 'd.test.mjs', 'e.test.mjs', 'f.test.mjs', 'pc.test.mjs'];
  const plan = await eligibleFiles(v, allow(['a.test.mjs', 'b.test.mjs', 'c.test.mjs', 'd.test.mjs', 'e.test.mjs', 'f.test.mjs', 'gone.test.mjs']), inventory);
  assert.deepEqual(plan.files, ['a.test.mjs', 'b.test.mjs', 'f.test.mjs']);
  assert.deepEqual(Object.fromEntries(plan.refused.map(item => [item.file, item.reason])),
    { 'c.test.mjs': 'closure-not-neutral', 'd.test.mjs': 'test-bytes-changed', 'e.test.mjs': 'needs-packs-qualification', 'gone.test.mjs': 'not-in-inventory' });
  const { verdicts } = plan, eligible = plan.files.filter(file => file !== 'f.test.mjs');
  // pc.test.mjs runs fresh on the PC and reaches hub.mjs: b may go remote.
  assert.deepEqual(selectRemote({ eligible, verdicts, fresh: inventory }), { files: ['a.test.mjs', 'b.test.mjs'], back: [], lapsed: [] });
  // A missing witness: pc.test.mjs was reused, not run, so the entry does not apply this release.
  const missing = selectRemote({ eligible, verdicts, fresh: ['a.test.mjs', 'b.test.mjs', 'c.test.mjs'] });
  assert.deepEqual(missing, { files: ['a.test.mjs'], back: ['b.test.mjs'], lapsed: ['app/hub.mjs'] });
  // Earlier in the same round counts as running here; a reused file never goes remote.
  assert.deepEqual(selectRemote({ eligible, verdicts, fresh: ['b.test.mjs'], ranHere: ['pc.test.mjs'] }).files, ['b.test.mjs']);
  assert.deepEqual(selectRemote({ eligible, verdicts, fresh: ['pc.test.mjs'] }).files, []);
  assert.deepEqual(unwitnessed({ remote: ['a.test.mjs', 'b.test.mjs'], verdicts, pc: ['c.test.mjs'] }), ['app/hub.mjs']);
  assert.deepEqual(unwitnessed({ remote: ['a.test.mjs'], verdicts, pc: [] }), []);
});

test('allowlist validation refuses unsorted, Windows-bound and unreviewed entries', () => {
  const entry = file => ({ file, sha256: 'a'.repeat(64), qualifiedWith: 'no-packs' });
  const base = { schema: 'rs3-neutral-allowlist-v1', reviewed: { by: 'test' }, files: [entry('a.test.mjs'), entry('b.test.mjs')], reviewedModules: [] };
  assert.equal(validateAllowlist(base), base);
  assert.throws(() => validateAllowlist({ ...base, files: [entry('b.test.mjs'), entry('a.test.mjs')] }), /sorted/);
  assert.throws(() => validateAllowlist({ ...base, files: [entry('a.test.mjs'), entry('a.test.mjs')] }), /entry invalid/);
  assert.throws(() => validateAllowlist({ ...base, files: [entry('operations.test.mjs')] }), /entry invalid/);
  assert.throws(() => validateAllowlist({ ...base, files: [{ ...entry('a.test.mjs'), qualifiedWith: 'linux' }] }), /entry invalid/);
  assert.throws(() => validateAllowlist({ ...base, files: [{ ...entry('a.test.mjs'), sha256: 'short' }] }), /entry invalid/);
  const module = { path: 'app/hub.mjs', sha256: 'b'.repeat(64), terms: ['platform'], lines: [[3, 4], [9, 9]], note: 'Reviewed: label only, never a branch.' };
  assert.equal(validateAllowlist({ ...base, reviewedModules: [module] }).reviewedModules.length, 1);
  for (const bad of [{ path: 'tests/a.test.mjs' }, { terms: ['pack'] }, { terms: [] }, { terms: ['platform', 'platform'] }, { note: 'too short' },
    { path: 'app/hub.json' }, { lines: undefined }, { lines: [] }, { lines: [[0, 2]] }, { lines: [[5, 4]] }, { lines: [[3, 6], [6, 8]] },
    { lines: [[9, 9], [3, 4]] }, { lines: [[1.5, 2]] }, { lines: [[1]] }])
    assert.throws(() => validateAllowlist({ ...base, reviewedModules: [{ ...module, ...bad }] }), /reviewed module invalid/, JSON.stringify(bad));
  assert.throws(() => validateAllowlist({ ...base, schema: 'v0' }), /allowlist invalid/);
});

test('the Windows-bound list matches Phase A and the committed allowlist is valid', async () => {
  const slice = await readFile(new URL('../.github/windows-slice/run.mjs', import.meta.url), 'utf8');
  const listed = [.../export const windowsFiles = \[([\s\S]*?)\]/.exec(slice)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...windowsBoundTests], listed);
  const committed = JSON.parse(await readFile(new URL('../' + allowlistPath, import.meta.url), 'utf8'));
  validateAllowlist(committed);
  for (const { file } of committed.files) assert.equal(windowsBoundTests.includes(file), false);
});
