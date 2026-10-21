// Affected-test evidence: the static scanner, trace-verified file plans and the
// runner's trace, cross-file and deadline behaviour. Fixture projects are disposable.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { scanModule } from '../scripts/private-companion/module-scan.mjs';
import { fileProject, filePlan, traceVerdict, contentKey, publishFilePass, readFilePass } from '../scripts/private-companion/file-test-evidence.mjs';
import { runAdaptive, crossFileTrace, GiB } from '../scripts/adaptive-test-runner.mjs';

const put = async (file, text) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
const scratch = async t => { const root = await mkdtemp(path.join(os.tmpdir(), 'affected-tests-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
const execution = { digest: 'e'.repeat(64) };
const kinds = ['read', 'list', 'stat', 'tree', 'write', 'make'];
const trace = (over = {}) => ({ schema: 'rs3-test-trace-v2', processes: 1, hazards: [], ...Object.fromEntries(kinds.map(kind => [kind, []])), scratch: Object.fromEntries(kinds.map(kind => [kind, []])),
  outside: [], outsideCount: 0, connects: [], listens: [], foreign: [], foreignCount: 0, created: [], scratchExisted: [], ...over });

const sample = `import a from './a.mjs';
import { b as c, d } from "./b.mjs";
import * as ns from './c.mjs';
import './d.mjs';
import e, { f } from './e.mjs';
export { g } from './g.mjs';
export * from './h.mjs';
export * as i from './i.mjs';
import data from './data.json' with { type: 'json' };
// import nope from './comment.mjs';
/* import nope from './block.mjs'; */
const text = "import nope from './string.mjs'";
const tpl = \`import nope from './template.mjs' \${a + \`nested \${c}\`}\`;
const re = /import ".\\/regex.mjs"/g;
const ratio = a / 2 / 3;
const later = () => import('./lazy.mjs');
const computed = name => import('./data/' + name);
const asset = new URL('./asset.txt', import.meta.url);
export default { text, tpl, re, ratio, later, computed, asset, ns, d, e, f, data };
`;

test('the scanner finds exactly the static imports V8 finds, ignoring import text in comments, strings, templates and regexps', () => {
  const scan = scanModule(sample);
  assert.equal(scan.lexed, true);
  assert.deepEqual([...scan.imports].sort(), ['./a.mjs', './b.mjs', './c.mjs', './d.mjs', './data.json', './e.mjs', './g.mjs', './h.mjs', './i.mjs']);
  assert.deepEqual(scan.dynamicImports, ['./lazy.mjs']);
  assert.equal(scan.computedImports.length, 1);
  assert.deepEqual(scan.urlLiterals, ['./asset.txt']);
  // Real modules (bound here as file URLs) and the sample, against V8's own module parser.
  const sources = [sample, ...['../scripts/private-companion/module-scan.mjs', '../scripts/private-companion/file-test-evidence.mjs', '../scripts/adaptive-test-runner.mjs', '../scripts/test-trace.mjs']
    .map(name => readFileSync(new URL(name, import.meta.url), 'utf8'))];
  sources.push(readFileSync(new URL('../scripts/private-companion/file-test-lane.mjs', import.meta.url), 'utf8'));
  const v8 = `import vm from 'node:vm'; import { readFileSync } from 'node:fs';
    const out = JSON.parse(readFileSync(0, 'utf8')).map(source => { const m = new vm.SourceTextModule(source); return [...new Set((m.moduleRequests ?? m.dependencySpecifiers.map(specifier => ({ specifier }))).map(r => r.specifier))].sort(); });
    process.stdout.write(JSON.stringify(out));`;
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', v8], { input: JSON.stringify(sources), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(sources.map(source => [...scanModule(source).imports].sort()), JSON.parse(result.stdout));
});

test('the scanner reports capabilities, mocks, nested runners and unlexable source', () => {
  const caps = scanModule("import fs from 'node:fs'; import { spawn } from 'node:child_process'; export const x = () => fetch('http://localhost'); export const y = s => eval(s);");
  assert.deepEqual(caps.capabilities, ['children', 'evaluation', 'files', 'network']);
  assert.deepEqual(caps.builtins, ['child_process', 'fs']);
  assert.deepEqual(scanModule("import { mock } from 'node:test'; mock.module('./x.mjs', {});").hazards, ['test module mock']);
  assert.deepEqual(scanModule("import { run } from 'node:test'; run({ files: [] });").hazards, ['nested test runner']);
  assert.deepEqual(scanModule("import test from 'node:test'; test('pure', () => {});").capabilities, []);
  assert.equal(scanModule("const s = 'unterminated").lexed, false);
});

// A small project: a pure module, an fs reader, a computed loader, a mock and a nested runner.
async function project(root, changes = {}) {
  const files = {
    'package.json': '{"type":"module"}\n',
    'app/pure.mjs': 'export const add = (a, b) => a + b;\n',
    'app/other.mjs': 'export const other = 1;\n',
    'app/reader.mjs': "import { readFileSync } from 'node:fs';\nexport const read = name => readFileSync(new URL('../data/' + name, import.meta.url), 'utf8');\n",
    'app/runtime.mjs': 'export const load = name => import(`./data/${name}.mjs`);\n',
    'app/data/one.mjs': 'export default 1;\n',
    'app/web/screen.mjs': "import { settings } from './data/settings.mjs';\nexport default settings;\n",
    'data/values.json': '{"a":1}\n',
    'tests/pure.test.mjs': "import test from 'node:test';\nimport { add } from '../app/pure.mjs';\ntest('add', () => { if (add(1, 2) !== 3) throw Error('sum'); });\n",
    'tests/reader.test.mjs': "import test from 'node:test';\nimport { read } from '../app/reader.mjs';\ntest('read', () => read('values.json'));\n",
    'tests/runtime.test.mjs': "import test from 'node:test';\nimport { load } from '../app/runtime.mjs';\ntest('load', () => load('one'));\n",
    'tests/screen.test.mjs': "import test from 'node:test';\nconst screen = new URL('../app/web/screen.mjs', import.meta.url);\ntest('screen', () => screen);\n",
    'tests/mock.test.mjs': "import { mock } from 'node:test';\nmock.module('../app/pure.mjs', {});\n",
    'tests/runner.test.mjs': "import { run } from 'node:test';\nexport const nested = () => run({ files: [] });\n",
    ...changes,
  };
  for (const [name, text] of Object.entries(files)) await put(path.join(root, name), text);
  return fileProject({ coreRoot: root });
}
const plansOf = async (root, changes, options = {}) => {
  const plans = await filePlan({ project: await project(root, changes), lane: 'private-full', execution, runnerPins: { runner: 'r'.repeat(64) }, ...options });
  return Object.fromEntries(plans.map(plan => [path.basename(plan.file, '.test.mjs'), plan]));
};
const inputNames = plan => plan.contract.inputs.inputs.map(input => input.path);

test('a file plan binds its static closure; unrelated edits keep its key and closure edits change it', async t => {
  const root = await scratch(t);
  const base = await plansOf(path.join(root, 'base'));
  assert.deepEqual(inputNames(base.pure), ['app/pure.mjs', 'package.json', 'tests/pure.test.mjs']);
  assert.equal(base.pure.alwaysRun, false);
  assert.equal(base.pure.scope.floor, false);
  // A capability opens the plan: it binds every data file and every name.
  assert.deepEqual(inputNames(base.reader), ['app/reader.mjs', 'package.json', 'tests/reader.test.mjs', '<data-floor>', '<tree>']);
  // Browser modules reached as files may name imports the web server maps.
  assert.equal(base.screen.alwaysRun, false); assert.equal(base.screen.scope.floor, true);
  assert.ok(inputNames(base.screen).includes('app/web/screen.mjs'));
  // Mocks and nested runners leave no checkable hypothesis.
  assert.equal(base.mock.alwaysRun, true); assert.match(base.mock.reasons[0], /test module mock/);
  assert.equal(base.runner.alwaysRun, true); assert.match(base.runner.reasons[0], /nested test runner/);

  const other = await plansOf(path.join(root, 'other'), { 'app/other.mjs': 'export const other = 2;\n' });
  assert.equal(other.pure.contract.key, base.pure.contract.key);
  assert.equal(other.reader.contract.key, base.reader.contract.key, 'code outside the closure is not data');
  const pure = await plansOf(path.join(root, 'pure'), { 'app/pure.mjs': 'export const add = (a, b) => b + a;\n' });
  assert.notEqual(pure.pure.contract.key, base.pure.contract.key);
  const data = await plansOf(path.join(root, 'data'), { 'data/values.json': '{"a":2}\n' });
  assert.equal(data.pure.contract.key, base.pure.contract.key);
  assert.notEqual(data.reader.contract.key, base.reader.contract.key);
  const added = await plansOf(path.join(root, 'added'), { 'app/new.mjs': 'export {};\n' });
  assert.equal(added.pure.contract.key, base.pure.contract.key);
  assert.notEqual(added.reader.contract.key, base.reader.contract.key, 'a new name changes <tree>');
});

test('reviewed computed-import models bind exact expressions only; contentKey ignores tooling and host', async t => {
  const root = await scratch(t);
  const expression = scanModule('export const load = name => import(`./data/${name}.mjs`);\n').computedImports[0];
  const declarations = { schema: 'rs3-test-inputs-v2', modules: { 'app/runtime.mjs': { computedImports: { [expression]: ['app/data/one.mjs'] } } } };
  const unmodeled = await plansOf(path.join(root, 'a'));
  const modeled = await plansOf(path.join(root, 'b'), {}, { declarations });
  assert.ok(!inputNames(unmodeled.runtime).includes('app/data/one.mjs'));
  assert.ok(inputNames(modeled.runtime).includes('app/data/one.mjs'));
  assert.deepEqual(modeled.runtime.contract.inputs.declarations, [{ file: 'app/runtime.mjs', ...declarations.modules['app/runtime.mjs'] }]);
  assert.equal(modeled.runtime.scope.floor, true, 'a computed import stays open; the trace checks what loaded');
  const wrong = await plansOf(path.join(root, 'c'), {}, { declarations: { ...declarations, modules: { 'app/runtime.mjs': { computedImports: { 'other(expression)': ['app/data/one.mjs'] } } } } });
  assert.ok(!inputNames(wrong.runtime).includes('app/data/one.mjs'));
  const old = await plansOf(path.join(root, 'd'), {}, { declarations: { ...declarations, schema: 'rs3-test-inputs-v1' } });
  assert.ok(!inputNames(old.runtime).includes('app/data/one.mjs'));
  // Declared reads bind bytes; a module also read as text keeps its own imports.
  const reads = await plansOf(path.join(root, 'r'), {
    'app/reader.mjs': "import { readFileSync } from 'node:fs';\nimport './pure.mjs';\nexport const read = name => readFileSync(new URL('../data/' + name, import.meta.url), 'utf8');\n",
    'app/pure.mjs': "import { base } from '../lib/base.mjs';\nexport const add = (a, b) => a + b + base;\n",
    'lib/base.mjs': 'export const base = 0;\n',
  }, { declarations: { schema: 'rs3-test-inputs-v2', modules: { 'app/reader.mjs': { reads: ['app/'] } } } });
  for (const name of ['app/other.mjs', 'app/data/one.mjs', 'app/pure.mjs', 'lib/base.mjs']) assert.ok(inputNames(reads.reader).includes(name), name);

  const host = await filePlan({ project: await project(path.join(root, 'e')), lane: 'private-full', execution: { digest: 'f'.repeat(64) }, runnerPins: { runner: 's'.repeat(64) }, runtimeOS: { release: 'x', version: 'y' } });
  const hostPure = host.find(plan => plan.file === 'tests/pure.test.mjs');
  assert.notEqual(hostPure.contract.key, unmodeled.pure.contract.key);
  assert.equal(contentKey(hostPure.contract), contentKey(unmodeled.pure.contract));
  assert.notEqual(contentKey(unmodeled.pure.contract), contentKey(unmodeled.reader.contract));
});

test('a trace verifies only observations the plan binds; everything else keeps the file running', async t => {
  const root = await scratch(t);
  const plans = await plansOf(root);
  const own = ['tests/pure.test.mjs', 'app/pure.mjs', 'package.json'];
  const good = trace({ read: own, stat: ['', 'app', 'tests'] });
  assert.deepEqual(traceVerdict(plans.pure, good), { verified: true, reasons: [] });
  // Files the test makes for itself are its own.
  assert.equal(traceVerdict(plans.pure, trace({ read: [...own, 'out/result.json'], stat: ['out'], make: ['out'], write: ['out/result.json'], created: ['out', 'out/result.json'] })).verified, true);
  const refused = (plan, over, options, pattern) => {
    const verdict = traceVerdict(plan, over === null ? undefined : trace({ read: own, ...over }), options);
    assert.equal(verdict.verified, false, JSON.stringify(over));
    assert.match(verdict.reasons.join('\n'), pattern);
  };
  refused(plans.pure, { read: [...own, 'app/other.mjs'] }, {}, /read of unbound input app\/other\.mjs/);
  refused(plans.pure, { read: [...own, 'data/values.json'] }, {}, /unbound input data\/values\.json/);
  refused(plans.pure, { list: ['app'] }, {}, /list of project directory app/);
  refused(plans.pure, { stat: ['data'] }, {}, /stat of project directory data/);
  refused(plans.pure, { read: [...own, 'node_modules/x/index.js'] }, {}, /present at lane start/);
  refused(plans.pure, { stat: ['maybe.json'], created: ['maybe.json'] }, {}, /absent path maybe\.json/);
  refused(plans.pure, { hazards: ['untraced child cmd.exe'] }, {}, /hazard: untraced child/);
  refused(plans.pure, { outside: ['C:/elsewhere'], outsideCount: 1 }, {}, /outside the assembly/);
  refused(plans.pure, { foreign: ['gen/shared.txt'], foreignCount: 1 }, {}, /touched by other files/);
  refused(plans.pure, { scratchExisted: ['/tmp/old.txt'] }, {}, /older than the lane/);
  refused(plans.pure, { connects: ['127.0.0.1|6000'], listens: ['5000'] }, {}, /connection 127\.0\.0\.1\|6000/);
  refused(plans.pure, { connects: ['example.com|80'] }, {}, /connection example\.com/);
  refused(plans.pure, { processes: 0 }, {}, /no traced process/);
  refused(plans.pure, {}, { flaky: true }, /passed only on retry/);
  refused(plans.pure, null, {}, /trace missing/);
  refused(plans.pure, { schema: 'rs3-test-trace-v1' }, {}, /trace missing/);
  refused(plans.pure, { created: undefined }, {}, /not annotated/);
  refused(plans.mock, {}, {}, /always-run plan/);
  refused(JSON.parse(JSON.stringify(plans.pure)), {}, {}, /plan scope missing/);
  assert.equal(traceVerdict(plans.pure, trace({ read: own, connects: ['127.0.0.1|5000', 'localhost|5000'], listens: ['5000'] })).verified, true);
  // An open plan binds data and names: an absent name it checked is part of <tree>.
  const reader = ['tests/reader.test.mjs', 'app/reader.mjs', 'package.json', 'data/values.json'];
  assert.equal(traceVerdict(plans.reader, trace({ read: reader, list: ['data'], stat: ['maybe.json'], created: ['maybe.json'] })).verified, true);
  refused(plans.reader, { read: [...reader, 'app/other.mjs'] }, {}, /unbound input app\/other\.mjs/);
});

test('only a pass with a verified trace takes the reusable slot; anything else is never read back', async t => {
  const root = await scratch(t);
  const plans = await plansOf(path.join(root, 'project'));
  const directory = path.join(root, 'evidence');
  const publish = (plan, verified) => publishFilePass(directory, plan, { kit: 'kit', coreSHA: 'c'.repeat(40), startedAt: new Date(Date.now() - 1000).toISOString(), cleanupVerified: true, metrics: { trace: { verified, reasons: verified ? [] : ['hazard: x'] } } });
  const verified = await publish(plans.pure, true);
  assert.equal(path.basename(verified.filename), plans.pure.contract.lane + '-' + plans.pure.contract.key + '.json');
  assert.equal((await readFilePass(directory, plans.pure))?.record.file, 'tests/pure.test.mjs');
  const unverified = await publish(plans.reader, false);
  assert.notEqual(path.basename(unverified.filename), plans.reader.contract.lane + '-' + plans.reader.contract.key + '.json');
  assert.equal(await readFilePass(directory, plans.reader), null);
  // Flipping the flag in place breaks the receipt digest.
  const forged = JSON.parse(await readFile(unverified.filename, 'utf8'));
  forged.metrics.trace.verified = true;
  await writeFile(path.join(directory, plans.reader.contract.lane + '-' + plans.reader.contract.key + '.json'), JSON.stringify(forged));
  assert.equal(await readFilePass(directory, plans.reader), null);
  const always = await publish(plans.mock, true);
  assert.notEqual(path.basename(always.filename), plans.mock.contract.lane + '-' + plans.mock.contract.key + '.json');
  assert.equal(await readFilePass(directory, plans.mock), null);
});

test('cross-file annotations mark what another file wrote, names absent at lane start and old scratch', () => {
  const results = [
    { file: 'w', trace: trace({ write: ['gen/shared.txt'], make: ['gen'], foreign: undefined, created: undefined, scratchExisted: undefined }) },
    { file: 'r', trace: trace({ stat: ['gen/shared.txt'], read: ['data/values.json', 'gen'], foreign: undefined, created: undefined, scratchExisted: undefined }) },
    { file: 's', trace: trace({ scratch: { ...trace().scratch, read: ['/lane/temp/old.txt', '/opaque/x', '/lane/temp/new.txt'] }, foreign: undefined, created: undefined, scratchExisted: undefined }) },
    { file: 'untraced' },
    // Another file made things beneath the root: a stat of it does not see them, a listing does.
    // mkdir of a directory present at lane start (data) changes nothing.
    { file: 'st', trace: trace({ stat: ['', 'data'], foreign: undefined, created: undefined, scratchExisted: undefined }) },
    { file: 'md', trace: trace({ make: ['data'], foreign: undefined, created: undefined, scratchExisted: undefined }) },
    { file: 'ls', trace: trace({ list: [''], foreign: undefined, created: undefined, scratchExisted: undefined }) },
  ];
  crossFileTrace(results, { names: new Set(['', 'data', 'data/values.json']), scratchFiles: new Set(['/lane/temp/old.txt']), opaqueRoots: ['/opaque'] });
  const [w, r, s, , st, , ls] = results.map(item => item.trace);
  assert.equal(st.foreignCount, 0);
  assert.deepEqual(ls.foreign, ['']);
  assert.equal(w.foreignCount, 0);
  assert.deepEqual(r.foreign.sort(), ['gen', 'gen/shared.txt']);
  assert.deepEqual(r.created, ['gen', 'gen/shared.txt']);
  assert.deepEqual(s.scratchExisted, ['/lane/temp/old.txt', '/opaque/x']);
  assert.equal(results[3].trace, undefined);
});

// The runner itself: traces of test processes and their Node children, hazards for
// what it cannot follow, foreign observations across files, and the file deadline.
test('a traced lane records what each file observed, fails closed on what it cannot follow, and kills files past their deadline', async t => {
  const root = await scratch(t);
  const cwd = path.join(root, 'project'), lane = path.join(root, 'lane');
  const roots = Object.fromEntries(['home', 'temp', 'cache', 'trace'].map(name => [name, path.join(lane, name)]));
  for (const dir of Object.values(roots)) await mkdir(dir, { recursive: true });
  // An outer trace (this file's own lane) must not capture the nested lane.
  const env = { ...process.env, NODE_OPTIONS: '', TEMP: roots.temp, TMP: roots.temp, TMPDIR: roots.temp, HOME: roots.home, USERPROFILE: roots.home, LOCALAPPDATA: roots.home, APPDATA: roots.home, NODE_COMPILE_CACHE: roots.cache };
  delete env.RS3_TEST_TRACE_DIR; delete env.RS3_TEST_TRACER;
  const head = "import test from 'node:test';\n";
  await project(cwd, {
    'data/child.txt': 'child\n',
    'tests/reads.test.mjs': head + "import { readFileSync } from 'node:fs';\ntest('reads', () => readFileSync(new URL('../data/values.json', import.meta.url)));\n",
    'tests/child.test.mjs': head + "import { spawnSync } from 'node:child_process';\ntest('child', () => { const r = spawnSync(process.execPath, ['-e', \"require('node:fs').readFileSync('data/child.txt')\"], { windowsHide: true }); if (r.status !== 0) throw Error('child'); });\n",
    'tests/shell.test.mjs': head + "import { execSync } from 'node:child_process';\ntest('shell', () => execSync('echo hi'));\n",
    'tests/writer.test.mjs': head + "import { mkdirSync, writeFileSync } from 'node:fs';\ntest('writes', () => { mkdirSync(new URL('../gen/', import.meta.url), { recursive: true }); writeFileSync(new URL('../gen/shared.txt', import.meta.url), 'x'); });\n",
    'tests/peer.test.mjs': head + "import { existsSync } from 'node:fs';\ntest('peeks', () => existsSync(new URL('../gen/shared.txt', import.meta.url)));\n",
    'tests/hang.test.mjs': head + "test('hangs', () => new Promise(() => setInterval(() => {}, 1000)));\n",
    // promisify(execFile) resolves { stdout, stderr } and still passes through the trace.
    'tests/promised.test.mjs': head + "import { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';\ntest('promised', async () => { const { stdout } = await promisify(execFile)(process.execPath, ['-e', \"process.stdout.write(require('node:fs').readFileSync('data/child.txt', 'utf8'))\"], { windowsHide: true }); if (stdout !== 'child\\n') throw Error('stdout ' + stdout); });\n",
    'tests/promisedother.test.mjs': head + "import { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';\ntest('promised other', async () => { await promisify(execFile)('rs3-no-such-tool', []).catch(() => {}); });\n",
    // Stat of the project's ancestors is implied; listing one is not.
    'tests/ancestor.test.mjs': head + "import { statSync } from 'node:fs';\nimport path from 'node:path';\ntest('ancestors', () => { for (let dir = path.dirname(process.cwd()); dir !== path.dirname(dir); dir = path.dirname(dir)) statSync(dir); });\n",
    'tests/sibling.test.mjs': head + "import { readdirSync } from 'node:fs';\nimport path from 'node:path';\ntest('lists parent', () => readdirSync(path.dirname(process.cwd())));\n",
    // The reviewed start-time probe is no hazard; any other PowerShell command is.
    'tests/probe.test.mjs': head + "import { execFileSync } from 'node:child_process';\ntest('probe', () => { try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true, stdio: 'ignore' }); } catch {} });\n",
    'tests/script.test.mjs': head + "import { execFileSync } from 'node:child_process';\ntest('script', () => { try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime; Get-Content x`], { windowsHide: true, stdio: 'ignore' }); } catch {} });\n",
  });
  const options = { cwd, env, memory: () => 64 * GiB, minConcurrency: 2, maxConcurrency: 3, policy: () => ({}), traceRoot: roots.trace };
  const run = await runAdaptive({ ...options, files: ['reads', 'child', 'shell', 'writer', 'peer', 'pure', 'ancestor', 'sibling', 'probe', 'script', 'promised', 'promisedother'].map(name => `tests/${name}.test.mjs`) });
  assert.equal(run.passed, true);
  const by = Object.fromEntries(run.files.map(item => [path.basename(item.file, '.test.mjs'), item]));
  assert.ok(by.reads.trace.read.includes('data/values.json'));
  assert.ok(by.child.trace.processes >= 2 && by.child.trace.read.includes('data/child.txt'), 'a Node child inherits the trace');
  assert.ok(by.shell.trace.hazards.includes('untraced shell child'));
  assert.ok(by.peer.trace.foreign.includes('gen/shared.txt'), 'a name another file wrote is foreign');
  assert.ok(by.peer.trace.created.includes('gen/shared.txt'), 'it was absent at lane start');
  assert.equal(by.writer.trace.foreignCount, 0);

  const plans = Object.fromEntries((await filePlan({ project: await fileProject({ coreRoot: cwd }), lane: 'private-full', execution, runnerPins: {} })).map(plan => [path.basename(plan.file, '.test.mjs'), plan]));
  const verdict = name => traceVerdict(plans[name], by[name].trace);
  assert.deepEqual(verdict('pure'), { verified: true, reasons: [] });
  assert.deepEqual(verdict('reads'), { verified: true, reasons: [] });
  assert.equal(verdict('shell').verified, false);
  assert.equal(verdict('peer').verified, false);
  // Spawning children opens the plan, so the child's data read is bound through <data-floor>.
  assert.deepEqual(verdict('child'), { verified: true, reasons: [] });
  assert.ok(by.promised.trace.processes >= 2 && by.promised.trace.read.includes('data/child.txt'), 'a promisified Node child inherits the trace');
  assert.ok(by.promisedother.trace.hazards.includes('untraced child rs3-no-such-tool'));
  assert.equal(by.ancestor.trace.outsideCount, 0);
  assert.deepEqual(verdict('ancestor'), { verified: true, reasons: [] });
  assert.equal(by.sibling.trace.outsideCount, 1);
  assert.equal(verdict('sibling').verified, false);
  assert.deepEqual(by.probe.trace.hazards, []);
  assert.ok(by.script.trace.hazards.includes('untraced child powershell.exe'));
  assert.equal(verdict('script').verified, false);

  const hung = await runAdaptive({ ...options, files: ['tests/hang.test.mjs'], fileDeadlineMs: 2000 });
  assert.equal(hung.passed, false);
  assert.equal(hung.files[0].timedOut, true);
  assert.equal(hung.files[0].summary.counts.failed >= 1, true);
});
