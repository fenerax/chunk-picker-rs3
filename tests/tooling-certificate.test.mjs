import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';
import { literalModuleReferences } from '../scripts/private-companion/tooling-module-graph.mjs';
import { executableToolingBytes } from '../scripts/private-companion/tooling-executable-input.mjs';
import { toolingSmokeChecks, toolingSmokeScope } from '../scripts/private-companion/tooling-smoke.mjs';
import { executableToolingClosure, toolingIdentity, classifyToolingChanges, issueToolingCertificate,
  assertToolingCertificate, revokeToolingCertificate, recoverDeadToolingCertificateAttempt } from '../scripts/private-companion/tooling-certificate.mjs';

const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'object' ? JSON.stringify(value) : value); };
async function fixture(t) {
  const root = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'tooling-certificate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit'), evidenceDir = path.join(root, 'evidence');
  for (const [name, value] of Object.entries({ 'tools/release-v2.mjs': "import './helper.mjs'; import '../tests/runtime-helper.test.mjs';",
    'tools/helper.mjs': 'export const value=1;', 'tests/runtime-helper.test.mjs': 'export const helper=1;',
    'operator/Managed.ps1': '# fixture', 'operator/with-heavy.ps1': '# heavy', 'operator/with-light.ps1': '# light',
    'release-gate/corpus/input.json': '{}', 'checks/private-source/app/feature.mjs': '// feature', 'kit.json': { browser: { path: process.execPath }, concurrency: 1 } })) await put(path.join(kit, name), value);
  const identityOptions = { entries: ['tools/release-v2.mjs'], platformIdentity: { node: process.version, os: 'fixture' } };
  const options = { kit, evidenceDir, identityOptions };
  const validate = async identity => ({ passed: true, cleanupVerified: true, inputDigest: identity.digest, scope: toolingSmokeScope,
    checks: ['focused-tooling-contracts', ...toolingSmokeChecks].map(name => ({ name, passed: true, evidenceDigest: digestValue({ fixture: true, name }) })) });
  return { root, kit, options, identityOptions, validate, identity: () => toolingIdentity(kit, identityOptions) };
}

test('feature, docs and test assertion changes need no certificate; executable imported test helper does', async t => {
  const f = await fixture(t), before = await f.identity();
  for (const name of ['checks/private-source/app/feature.mjs', 'tools/README.md', 'tests/assertion.test.mjs']) {
    await put(path.join(f.kit, name), '// changed feature or documentation');
    const classification = classifyToolingChanges(before, await f.identity(), [name]);
    assert.equal(classification.needsCertificate, false, name);
    assert.equal(classification.practiceRuns, 0);
    if (name.includes('assertion')) assert.deepEqual(classification.focusedContractTests, [name]);
    if (name.endsWith('README.md')) assert.ok(classification.focusedContractTests.length > 0);
  }
  await put(path.join(f.kit, 'tests/runtime-helper.test.mjs'), 'export const helper=2;');
  assert.equal(classifyToolingChanges(before, await f.identity()).practiceRuns, 1);
  assert.ok((await executableToolingClosure(f.kit, f.identityOptions)).some(row => row.path === 'tests/runtime-helper.test.mjs'));
});

test('tooling change requires exactly one certificate; feature release and later live base reuse it beyond seven days', async t => {
  const f = await fixture(t); let validations = 0;
  const issue = () => issueToolingCertificate({ ...f.options, validate: async identity => { validations++; return f.validate(identity); } });
  const first = await issue(); assert.equal(first.reused, false);
  await put(path.join(f.kit, 'checks/private-source/app/feature.mjs'), '// next release');
  assert.equal((await issue()).reused, true);
  assert.equal((await assertToolingCertificate({ ...f.options, now: Date.now() + 90 * 86400000 })).toolingDigest, first.toolingDigest);
  assert.equal(validations, 1);
  await put(path.join(f.kit, 'tools/helper.mjs'), 'export const value=2;');
  await assert.rejects(assertToolingCertificate(f.options), /ENOENT/);
  assert.equal((await issue()).reused, false);
  assert.equal((await issue()).reused, true);
  assert.equal(validations, 2, 'one validation per executable closure, no feature-release practice');
  const relocated = path.join(f.root, 'relocated'); await cp(f.kit, relocated, { recursive: true });
  assert.equal((await assertToolingCertificate({ ...f.options, kit: relocated })).toolingDigest, (await f.identity()).digest);
});

test('wrapper, policy, browser and platform changes invalidate; explicit revocation is always honoured', async t => {
  const f = await fixture(t), original = await f.identity();
  const browser = path.join(f.root, 'browser.exe'); await put(browser, 'fixture browser');
  await put(path.join(f.kit, 'kit.json'), { browser: { path: browser }, retryOnceInIsolation: true });
  const before = await f.identity();
  await put(browser, 'updated fixture browser'); assert.notEqual((await f.identity()).digest, before.digest);
  await put(path.join(f.kit, 'operator/with-heavy.ps1'), '# changed wrapper'); assert.notEqual((await f.identity()).digest, original.digest);
  const enabled = await f.identity();
  await put(path.join(f.kit, 'kit.json'), { browser: { path: browser }, retryOnceInIsolation: false });
  assert.notEqual((await f.identity()).digest, enabled.digest);
  assert.notEqual((await toolingIdentity(f.kit, { ...f.identityOptions, platformIdentity: { node: 'updated', os: 'fixture' } })).digest, (await f.identity()).digest);
  const result = await issueToolingCertificate({ ...f.options, validate: f.validate });
  await revokeToolingCertificate({ evidenceDir: f.options.evidenceDir, toolingDigest: result.toolingDigest, reason: 'Discovered defect' });
  await assert.rejects(assertToolingCertificate(f.options), /revoked/);
  await assert.rejects(issueToolingCertificate({ ...f.options, validate: f.validate }), /revoked/);
});

test('failed, pending, tampered and changed-during-validation evidence cannot issue a certificate', async t => {
  const f = await fixture(t);
  await assert.rejects(issueToolingCertificate({ ...f.options, validate: async () => ({ passed: false }) }), /unsupported|incomplete|corrupt/);
  // The failed attempt keeps its marker as evidence without blocking the next issuer.
  const certificates = path.join(f.options.evidenceDir, 'tooling-certificates');
  assert.equal((await readdir(certificates)).filter(name => /\.json\.pending\.failed-/.test(name)).length, 1);
  assert.equal((await readdir(certificates)).some(name => name.endsWith('.pending')), false);
  await assert.rejects(assertToolingCertificate(f.options), /ENOENT/);
  assert.equal((await issueToolingCertificate({ ...f.options, validate: f.validate })).reused, false);
  const g = await fixture(t);
  await assert.rejects(issueToolingCertificate({ ...g.options, validate: async identity => { await put(path.join(g.kit, 'tools/helper.mjs'), '// changed'); return g.validate(identity); } }), /changed during/);
  const h = await fixture(t), result = await issueToolingCertificate({ ...h.options, validate: h.validate });
  const body = JSON.parse(await readFile(result.filename, 'utf8')); body.validation.checks = [];
  await writeFile(result.filename, JSON.stringify(body));
  await assert.rejects(assertToolingCertificate(h.options), /incomplete|corrupt/);
});

test('new transitive dependencies invalidate and missing/unmodeled imports refuse classification', async t => {
  const f = await fixture(t), before = await f.identity();
  await put(path.join(f.kit, 'tools/leaf.mjs'), '// leaf');
  await put(path.join(f.kit, 'tools/helper.mjs'), "export * from './leaf.mjs';");
  assert.notEqual((await f.identity()).digest, before.digest);
  await put(path.join(f.kit, 'tools/helper.mjs'), "import 'unapproved-package';");
  await assert.rejects(f.identity(), /Unmodeled/);
  await put(path.join(f.kit, 'tools/helper.mjs'), "import './missing.mjs';");
  await assert.rejects(f.identity(), /ENOENT/);
  await put(path.join(f.kit, 'tools/helper.mjs'), "const spec='./leaf.mjs'; await import(spec);");
  await assert.rejects(f.identity(), /Unmodeled computed/);
});

test('module graph reads real imports while ignoring generated source, comments and regular expressions', () => {
  const parsed = literalModuleReferences(`import './real.mjs';\nexport * from './reexport.mjs';\nconst value="import('../capture-maps.mjs')";\n// import './comment.mjs';\nconst re=/import('fake')/;\nawait import('./dynamic.mjs');`);
  assert.deepEqual(parsed.references, ['./real.mjs', './reexport.mjs', './dynamic.mjs']);
  const concatenated = literalModuleReferences("await import('./computed-' + suffix + '.mjs');");
  assert.deepEqual(concatenated.references, [], 'a literal prefix cannot hide a computed loader');
  assert.deepEqual(concatenated.computed, ["'./computed-'+suffix+'.mjs'"], 'unknown computed expressions must reach the fail-closed declaration check');
  const interpolated = literalModuleReferences("const text = `${await import('./helper.mjs')}`;");
  assert.deepEqual(interpolated.references, ['./helper.mjs']);
  const nested = literalModuleReferences("const text = `outer${({ value: `inner${await import('./nested.mjs')}` }).value}`;");
  assert.deepEqual(nested.references, ['./nested.mjs']);
  assert.deepEqual(literalModuleReferences("const text = `${await import(prefix + suffix)}`;").computed, ['prefix+suffix']);
  const generated = literalModuleReferences("const text = `await import('./ignored.mjs'); require('./also-ignored'); ${JSON.stringify('suffix')}`;");
  assert.deepEqual(generated.references, []); assert.deepEqual(generated.computed, []);
  assert.deepEqual(literalModuleReferences('const text="`${await import(\'./ignored.mjs\')}`";').references, []);
  for (const unsupported of ["require('./helper.cjs');", 'require(spec);', "import { createRequire as make } from 'node:module';",
    "import * as mod from 'node:module'; mod[key](spec);", "import mod from 'node:module'; mod[key](spec);",
    "import { Module as M } from 'node:module'; M[key](spec);", "await import('node:module');",
    'process.getBuiltinModule(name);', "module['require'](spec);", "const text = `${require(spec)}`;",
    "process['get\\u0042uiltinModule']('module');", "alias['create\\u0052equire'](spec);", 'process[key](name);',
    "process.get\\u0042uiltinModule('module');"]) {
    assert.throws(() => literalModuleReferences(unsupported), /Unsupported/, unsupported);
  }
});

test('interpolated loader dependencies bind helpers and unknown computed expressions refuse capability identity', async t => {
  const f = await fixture(t);
  await put(path.join(f.kit, 'tools/release-v2.mjs'), "const text = `${await import('./helper.mjs')}`;");
  const before = await f.identity();
  await put(path.join(f.kit, 'tools/helper.mjs'), 'export const helper=2;');
  assert.notEqual((await f.identity()).digest, before.digest);
  await put(path.join(f.kit, 'checks/private-source/scripts/test-selection.mjs'), 'export const selector=1;');
  await put(path.join(f.kit, 'tools/release-v2.mjs'), "const text = `${await import(pathToFileURL(path.join(assembly,'scripts/test-selection.mjs')))}`;");
  const declared = await f.identity();
  await put(path.join(f.kit, 'checks/private-source/scripts/test-selection.mjs'), 'export const selector=2;');
  assert.notEqual((await f.identity()).digest, declared.digest, 'declared computed interpolation follows its reviewed target');
  await put(path.join(f.kit, 'tools/release-v2.mjs'), 'const text = `${await import(prefix + suffix)}`;');
  await assert.rejects(f.identity(), /Unmodeled computed/);
});

test('core-provided runner helpers bind executable bytes across feature commits without binding payload SHA', async t => {
  const f = await fixture(t), repo = path.join(f.root, 'core'); await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'fenerax'); git('config', 'user.email', 'fenerax@users.noreply.github.com'); git('config', 'core.autocrlf', 'false');
  await put(path.join(repo, 'scripts/test-port-check.mjs'), 'export const checker=1;');
  await put(path.join(repo, 'scripts/test-selection.mjs'), 'export const selector=1;');
  await put(path.join(repo, 'app/feature.mjs'), '// first feature'); git('add', '.'); git('commit', '-m', 'fixture one');
  const manifest = { browser: { path: process.execPath }, concurrency: 1, coreRevision: git('rev-parse', 'HEAD'), toolingCoreRepo: repo };
  await put(path.join(f.kit, 'kit.json'), manifest);
  await put(path.join(f.kit, 'tools/release-v2.mjs'), "import '../checks/private-source/scripts/test-port-check.mjs'; import '../committed-core-tooling/scripts/test-selection.mjs';");
  const before = await f.identity();
  await put(path.join(repo, 'app/feature.mjs'), '// next feature'); git('add', '.'); git('commit', '-m', 'fixture feature');
  manifest.coreRevision = git('rev-parse', 'HEAD'); await put(path.join(f.kit, 'kit.json'), manifest);
  assert.equal((await f.identity()).digest, before.digest);
  await put(path.join(repo, 'scripts/test-selection.mjs'), 'export const selector=2;'); git('add', '.'); git('commit', '-m', 'fixture public selector');
  manifest.coreRevision = git('rev-parse', 'HEAD'); await put(path.join(f.kit, 'kit.json'), manifest);
  assert.notEqual((await f.identity()).digest, before.digest);
  const selectorChanged = await f.identity();
  await put(path.join(repo, 'scripts/test-port-check.mjs'), 'export const checker=2;'); git('add', '.'); git('commit', '-m', 'fixture tooling');
  manifest.coreRevision = git('rev-parse', 'HEAD'); await put(path.join(f.kit, 'kit.json'), manifest);
  assert.notEqual((await f.identity()).digest, selectorChanged.digest);
});

test('literal private/public selector and additional assertion registrations reuse capability but change raw focused dependencies', async t => {
  const f = await fixture(t), repo = path.join(f.root, 'registry-core'); await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'fenerax'); git('config', 'user.email', 'fenerax@users.noreply.github.com'); git('config', 'core.autocrlf', 'false');
  const selector = "export const quickTests = new Set(['quick.test.mjs']);\nconst fullOnlyTests = new Set(['heavy.test.mjs']);\nexport const classify = name => quickTests.has(name) ? 'quick' : 'full';\n";
  const certificate = "import './tooling-executable-input.mjs';\nimport { additionalToolingContractTests } from './tooling-contract-catalog.mjs';\nexport const mandatoryToolingContractTests = Object.freeze(['mandatory.test.mjs']);\nexport const toolingContractTests = Object.freeze([...mandatoryToolingContractTests, ...additionalToolingContractTests]);\n";
  const catalog = 'export const additionalToolingContractTests = Object.freeze([]);\n';
  const privateSelector = 'checks/private-source/scripts/test-selection.mjs', publicSelector = 'committed-core-tooling/scripts/test-selection.mjs';
  const registryCertificate = 'tools/tooling-certificate.mjs';
  await put(path.join(f.kit, privateSelector), selector); await put(path.join(repo, 'scripts/test-selection.mjs'), selector);
  await put(path.join(f.kit, registryCertificate), certificate);
  const catalogPath = 'tools/tooling-contract-catalog.mjs'; await put(path.join(f.kit, catalogPath), catalog);
  for (const name of ['tooling-executable-input.mjs', 'tooling-module-graph.mjs']) await cp(fileURLToPath(new URL('../scripts/private-companion/' + name, import.meta.url)), path.join(f.kit, 'tools', name));
  const normalizerFile = path.join(f.kit, 'tools/tooling-executable-input.mjs'), normalizer = await readFile(normalizerFile);
  await put(path.join(f.kit, 'tools/release-v2.mjs'), "import '../checks/private-source/scripts/test-selection.mjs'; import '../committed-core-tooling/scripts/test-selection.mjs'; import './tooling-certificate.mjs';");
  git('add', '.'); git('commit', '-m', 'fixture selector registries');
  const manifest = { browser: { path: process.execPath }, concurrency: 1, coreRevision: git('rev-parse', 'HEAD'), toolingCoreRepo: repo };
  await put(path.join(f.kit, 'kit.json'), manifest);
  const focusedAssertions = [];
  const rawFocused = async () => digestValue(await executableToolingClosure(f.kit, { entries: [privateSelector, publicSelector, registryCertificate, ...focusedAssertions], payloadBoundary: false }));
  const before = await f.identity(); let raw = await rawFocused(), validations = 0;
  const issue = () => issueToolingCertificate({ ...f.options, validate: async identity => { validations++; return f.validate(identity); } });
  await issue();
  const added = selector.replace("'quick.test.mjs'", "'quick.test.mjs', 'feature.test.mjs'");
  await put(path.join(f.kit, privateSelector), added);
  await put(path.join(f.kit, 'checks/private-source/tests/feature.test.mjs'), '// feature assertions');
  assert.equal((await f.identity()).digest, before.digest, 'private registration is a current-run input');
  assert.notEqual(await rawFocused(), raw); raw = await rawFocused();
  assert.equal((await issue()).reused, true);
  await put(path.join(repo, 'scripts/test-selection.mjs'), added); git('add', '.'); git('commit', '-m', 'fixture public feature registration');
  manifest.coreRevision = git('rev-parse', 'HEAD'); await put(path.join(f.kit, 'kit.json'), manifest);
  assert.equal((await f.identity()).digest, before.digest, 'public committed registration is a current-run input');
  assert.notEqual(await rawFocused(), raw); raw = await rawFocused();
  const additional = catalog.replace('Object.freeze([])', "Object.freeze(['additional.test.mjs'])");
  await put(path.join(f.kit, catalogPath), additional);
  await put(path.join(f.kit, 'checks/private-source/tests/additional.test.mjs'), '// added focused assertions');
  focusedAssertions.push('checks/private-source/tests/additional.test.mjs');
  assert.equal((await f.identity()).digest, before.digest, 'additional focused registration is a current-run input');
  assert.notEqual(await rawFocused(), raw);
  assert.equal((await issue()).reused, true); assert.equal(validations, 1);
  raw = await rawFocused();
  await put(path.join(f.kit, 'checks/private-source/tests/additional.test.mjs'), '// changed focused assertion bytes');
  assert.equal((await f.identity()).digest, before.digest);
  assert.notEqual(await rawFocused(), raw, 'focused dependency identity retains raw test assertion bytes');
  await put(path.join(f.kit, privateSelector), added.replace('quickTests.has(name)', 'fullOnlyTests.has(name)'));
  assert.notEqual((await f.identity()).digest, before.digest, 'selector algorithm remains executable');
  await put(path.join(f.kit, privateSelector), added);
  await put(path.join(f.kit, registryCertificate), certificate.replace('mandatory.test.mjs', 'changed-mandatory.test.mjs'));
  assert.notEqual((await f.identity()).digest, before.digest, 'mandatory contract floor remains executable policy');
  await put(path.join(f.kit, registryCertificate), certificate);
  await writeFile(normalizerFile, Buffer.concat([normalizer, Buffer.from('\n// changed normalizer implementation\n')]));
  assert.notEqual((await f.identity()).digest, before.digest, 'normalizer itself remains a raw imported dependency');
});

test('registry recognition is exact, literal, unique and top-level, with uncertain input retained raw', async () => {
  const owner = 'checks/private-source/scripts/test-selection.mjs';
  const selector = "export const quickTests = new Set(['quick.test.mjs']);\nconst fullOnlyTests = new Set([]);\n";
  const change = selector.replace("'quick.test.mjs'", "/* registration */ 'quick.test.mjs', 'extra.test.mjs',");
  assert.deepEqual(executableToolingBytes(owner, Buffer.from(selector)), executableToolingBytes(owner, Buffer.from(change)));
  const badBodies = ["...other", "'quick.test.mjs', 'quick.test.mjs'", "`quick.test.mjs`", "'qu\\ick.test.mjs'", "'../quick.test.mjs'", "['quick.test.mjs']", ", 'quick.test.mjs'", "'quick.test.mjs' + suffix"];
  for (const body of badBodies) {
    const raw = Buffer.from(selector.replace("'quick.test.mjs'", body));
    assert.deepEqual(executableToolingBytes(owner, raw), raw, body);
  }
  for (const source of [selector.replace('new Set([', 'other(['), selector.replace('const fullOnlyTests = new Set([]);', ''),
    selector + "const quickTests = new Set(['duplicate.test.mjs']);\n",
    "function nested() { " + selector + ' }', selector.replace("'quick.test.mjs'", "'quick.test.mjs').values("),
    '/* unclosed ' + selector]) {
    const raw = Buffer.from(source); assert.deepEqual(executableToolingBytes(owner, raw), raw);
  }
  const unknown = Buffer.from(selector);
  assert.deepEqual(executableToolingBytes('tools/unrecognized-selector.mjs', unknown), unknown);
  const mandatory = "export const mandatoryToolingContractTests = Object.freeze(['required.test.mjs']);\nexport const additionalToolingContractTests = Object.freeze([]);\n";
  const extra = mandatory.replace('additionalToolingContractTests = Object.freeze([])', "additionalToolingContractTests = Object.freeze(['extra.test.mjs'])");
  for (const path of ['tools/tooling-contract-catalog.mjs', 'checks/private-source/scripts/private-companion/tooling-contract-catalog.mjs']) {
    assert.deepEqual(executableToolingBytes(path, Buffer.from(mandatory)), executableToolingBytes(path, Buffer.from(extra)));
    const computed = Buffer.from(mandatory.replace('Object.freeze([])', 'Object.freeze([...other])'));
    assert.deepEqual(executableToolingBytes(path, computed), computed);
    assert.notDeepEqual(executableToolingBytes(path, Buffer.from(mandatory)), executableToolingBytes(path, Buffer.from(mandatory.replace('required.test.mjs', 'changed.test.mjs'))));
  }
  const actual = await readFile(new URL('../scripts/test-selection.mjs', import.meta.url));
  assert.notDeepEqual(executableToolingBytes(owner, actual), actual, 'actual private selector must qualify');
  const actualExtended = Buffer.from(actual.toString('utf8').replace('new Set([', "new Set(['certificate-registry-extension.test.mjs',"));
  assert.deepEqual(executableToolingBytes(owner, actualExtended), executableToolingBytes(owner, actual), 'an actual private registration addition preserves capability bytes');
  const publicOwner = 'committed-core-tooling/scripts/test-selection.mjs';
  assert.notDeepEqual(executableToolingBytes(publicOwner, actual), actual, 'same executable selector grammar qualifies for committed core');
  const actualCatalog = await readFile(new URL('../scripts/private-companion/tooling-contract-catalog.mjs', import.meta.url));
  assert.notDeepEqual(executableToolingBytes('tools/tooling-contract-catalog.mjs', actualCatalog), actualCatalog, 'actual optional catalog must qualify');
  const catalogExtended = Buffer.from(actualCatalog.toString('utf8').replace('Object.freeze([])', "Object.freeze(['certificate-registry-extension.test.mjs'])"));
  assert.deepEqual(executableToolingBytes('tools/tooling-contract-catalog.mjs', catalogExtended), executableToolingBytes('tools/tooling-contract-catalog.mjs', actualCatalog), 'an actual catalog extension preserves capability bytes');
  const actualCertificate = await readFile(new URL('../scripts/private-companion/tooling-certificate.mjs', import.meta.url));
  assert.deepEqual(executableToolingBytes('tools/tooling-certificate.mjs', actualCertificate), actualCertificate, 'certificate including mandatory floor stays wholly raw');
});

test('a dead issuer pending marker is moved aside as failed evidence and the next practice issues', async t => {
  const f = await fixture(t), identity = await f.identity();
  const certificate = path.join(f.options.evidenceDir, 'tooling-certificates', identity.digest + '.json'), pending = certificate + '.pending';
  const deadPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { windowsHide: true, encoding: 'utf8' }));
  // rel8 shape: the issuer was killed mid-practice and its marker predates the attempt schema.
  const legacy = JSON.stringify({ startedAt: '2026-10-20T10:00:00.000Z', pid: deadPid });
  await put(pending, legacy);
  await assert.rejects(assertToolingCertificate(f.options), /pending/);
  const result = await issueToolingCertificate({ ...f.options, validate: f.validate });
  assert.equal(result.reused, false);
  const retained = (await readdir(path.dirname(certificate))).filter(name => name.startsWith(path.basename(pending) + '.failed-'));
  assert.equal(retained.length, 1, 'the dead marker is never deleted');
  assert.equal(await readFile(path.join(path.dirname(certificate), retained[0]), 'utf8'), legacy);
  await assert.rejects(readFile(pending), /ENOENT/);
  await assert.rejects(readFile(pending + '.recovery'), /ENOENT/);
  assert.equal((await assertToolingCertificate(f.options)).toolingDigest, identity.digest);
});

test('a live, unknown or concurrently recovered pending owner is never displaced', async t => {
  const f = await fixture(t), identity = await f.identity();
  const pending = path.join(f.options.evidenceDir, 'tooling-certificates', identity.digest + '.json.pending');
  const live = JSON.stringify({ schema: 'rs3-tooling-certificate-attempt-v1', ownerPid: process.pid, token: 'live', startedAt: new Date().toISOString() });
  await put(pending, live);
  await assert.rejects(issueToolingCertificate({ ...f.options, validate: () => assert.fail('a live owner keeps its claim') }), /still alive/);
  assert.equal(await readFile(pending, 'utf8'), live);
  await put(pending, 'not json');
  await assert.rejects(recoverDeadToolingCertificateAttempt(pending), /cannot be established/);
  assert.equal(await readFile(pending, 'utf8'), 'not json');
  await put(pending + '.recovery', '{}');
  await assert.rejects(recoverDeadToolingCertificateAttempt(pending), /recovery is active or was interrupted/);
  await assert.rejects(recoverDeadToolingCertificateAttempt(path.join(f.root, 'other.pending')), /Explicit tooling certificate pending path/);
  assert.deepEqual((await readdir(path.dirname(pending))).filter(name => name.includes('.failed-')), []);
});
