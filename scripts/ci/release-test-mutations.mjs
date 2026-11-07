// Hosted-only negative proof: every product edit is restored, never committed.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Run release mutation proof on GitHub, never on the shared PC.');
const pack = 'tests/release-pack-upgrade-v2.test.mjs', pipeline = 'tests/release-pipeline-v2.test.mjs';
const product = name => 'scripts/private-companion/' + name;
const mutations = [
  ['stage commits', 'release-transition.mjs', "if (pair.binding !== pair.targetBinding) await stage('binding-commit');", '', pack, 'upgrade interruption after-binding'],
  ['ownership', 'release-transition.mjs', "'identity-before-stop', 'owned-stop',", "'identity-before-stop',", pack, 'uncertain-owner'],
  ['native pending Start refusal', 'Operator-Common.ps1', "if ($journal.state -ne 'ready') {", 'if ($false) {', pack, '^native scripts', 'win32'],
  ['pair admission', 'release-transition.mjs', "if (![sourceBinding, targetBinding].includes(binding) || ![sourcePointer, targetPointer].includes(pointer)) throw Error('Unknown binding/pointer pair; recovery paused.');", '', pack, 'pair policy'],
  ['journal and inverse intent', 'release-transition.mjs', "await stage('journal-intent');", '', pack, 'pending-after-binding'],
  ['identity additions', 'release-pack-check.mjs', 'export function assertStableIdentities(a, b, additions) {', 'export function assertStableIdentities(a, b, additions) { return;', pack, 'declared saved identity'],
  ['history and progress', 'release-pack-check.mjs', 'export function assertPreserved(a, b) {', 'export function assertPreserved(a, b) { return;', pack, 'saved progress preservation|daily progress'],
  ['compatibility descriptors', 'release-pack-check.mjs', 'function assertDescriptor(actual, declared) {', 'function assertDescriptor(actual, declared) { return;', pack, 'compatibility uses separate'],
  ['compatibility binding refusal', 'release-pack-check.mjs', "if (![plan.old.bindingSha256, plan.new.bindingSha256].includes(actual)) throw new Error('Current binding differs.');", '', pack, 'compatibility uses separate'],
  ['current save preservation', 'release-pack-check.mjs', 'const before = await saveIdentity(from.config.dataDir);', "const before = await saveIdentity(from.config.dataDir); await writeFile(path.join(from.config.dataDir,'state.json'),'{}');", pack, 'compatibility uses separate'],
  ['entrypoint import safety', 'release-pack-check.mjs', "import path from 'node:path';", "import path from 'node:path'; console.log('synthetic mutation side effect');", pipeline, 'import safely'],
  ['early ordering', 'release-early.mjs', "[['chrome-gallery',gallery],['copied-synthetic-startup',startup]", "[['copied-synthetic-startup',startup],['chrome-gallery',gallery]", pipeline, 'early checks run'],
  ['kit staging', 'stage-release-v2.mjs', 'const packsIdentity = await hashTree(packs);', "const packsIdentity = {digest:'synthetic wrong digest'};", pipeline, 'staging accepts'],
  ['committed export', 'release-v2.mjs', "await timed(timings, 'export-core', () => exportCore(git, revision, path.join(release, 'core')));", "await timed(timings, 'export-core', () => exportCore(git, revision, path.join(release, 'core'))); await writeFile(path.join(release,'core/untracked-private.txt'),'synthetic wrongly exported');", pipeline, 'prepare exports exact'],
  ['failed preparation', 'release-v2.mjs', "} catch (error) { await writeFile(path.join(release, '.local/prepare-failure.json')", "} catch (error) { await writeFile(path.join(release,'release.json'),'{}'); await writeFile(path.join(release, '.local/prepare-failure.json')", pipeline, 'failed preparation'],
  ['freeze dry run', 'release-v2.mjs', "await timed(timings,'rollback-dry-run',()=>dry(rollbackRoot,path.join(release,'pointer.json'),true));", '', pipeline, 'checked freeze'],
  ['freeze byte seal', 'frozen-release.mjs', 'export async function readFrozenSeal({filename,kit,release,current,identityDigest,now=Date.now(),verifyBytes=false}) {', 'export async function readFrozenSeal({filename,kit,release,current,identityDigest,now=Date.now(),verifyBytes=false}) { return {};', pipeline, 'checked freeze'],
  ['exact text assembly', 'companion-check.mjs', 'await writeFile(path.join(scratch, record.path), record.bytes);', "await writeFile(path.join(scratch, record.path), 'synthetic changed text');", pipeline, 'bounded text assembly'],
  ['changed pack keys', 'release-v2.mjs', "result.gallery=await spec('gallery'", "result.private=result.public; result.gallery=await spec('gallery'", pipeline, 'a new kit prepares'],
  ['retention endpoints', 'release-v2.mjs', 'keep.add(root); keep.add(path.dirname(transition.oldConfig.path)); keep.add(path.dirname(transition.newConfig.path));', 'keep.add(root); keep.add(path.dirname(transition.newConfig.path));', pipeline, 'pruning retains'],
  ['sanitized lane environment', 'release-evidence.mjs', "NODE_OPTIONS:'--max-old-space-size=1536'", "NODE_OPTIONS:'--max-old-space-size=999'", pipeline, 'release lanes pin'],
];
const directory = path.resolve('release-mutation-results'); await mkdir(directory);
const receipts = [], sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = [];
const temporary = path.resolve('.local/release-mutation-temp'); await mkdir(temporary, { recursive: true });
const canonicalTemp = await realpath(temporary);
const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', TEMP: canonicalTemp, TMP: canonicalTemp, TMPDIR: canonicalTemp };
const run = (file, pattern) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...(pattern ? ['--test-name-pattern=' + pattern] : []), file], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  // Exit can precede the final TAP data. Each selected file owns its children.
  child.once('error', reject); child.once('close', code => resolve({ code, output }));
});
const save = () => writeFile(path.join(directory, 'receipt.json'), JSON.stringify({ sha: process.env.GITHUB_SHA, os: process.platform, baseline, receipts }, null, 2));
// A broken environment or positive test must never earn mutation credit.
for (const file of [pack, pipeline]) {
  const result = await run(file);
  baseline.push({ file, attempt: 1, passed: result.code === 0 && /# fail 0/.test(result.output), code: result.code });
  await writeFile(path.join(directory, 'baseline-' + path.basename(file) + '.log'), result.output);
  await save();
  if (!baseline.at(-1).passed) throw Error('Unmodified positive control failed: ' + file);
}
for (const [group, name, before, after, file, pattern, platform] of mutations) {
  if (platform && platform !== process.platform) {
    receipts.push({ group, file, pattern, attempt: 0, detected: null, skipped: 'requires native Windows adapter' });
    continue;
  }
  const target = product(name), original = await readFile(target), source = original.toString('utf8');
  if (!source.includes(before)) throw Error('Mutation anchor absent: ' + group);
  let receipt;
  try {
    await writeFile(target, source.replace(before, after));
    const started = performance.now();
    const result = await run(file, pattern);
    const detected = result.code !== 0 && /# fail [1-9]/.test(result.output) && !/SyntaxError|ERR_MODULE_NOT_FOUND/.test(result.output);
    receipt = { group, file, pattern, attempt: 1, detected, code: result.code, wallMs: performance.now() - started };
    await writeFile(path.join(directory, String(receipts.length + 1).padStart(2, '0') + '.log'), result.output);
  } finally {
    await writeFile(target, original);
    if (sha(await readFile(target)) !== sha(original)) throw Error('Mutation restoration differs: ' + group);
  }
  receipts.push(receipt); console.log(JSON.stringify(receipt));
  await save();
}
if (receipts.some(row => row.detected === false)) process.exitCode = 1;
