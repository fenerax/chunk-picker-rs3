import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipelineTests } from '../../scripts/private-companion/release-early.mjs';
import { bindingBytes } from '../../scripts/private-companion/release-pack-check.mjs';

export const scripts = fileURLToPath(new URL('../../scripts/private-companion/', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/release-pipeline/', import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function put(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
export function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: 'pipe' }).toString().trim();
}
export async function invoke(file, args = [], env = process.env) {
  const child = spawn(process.execPath, [file, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stderr = '', error;
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; stderr = (stderr + bytes).slice(-4096); });
  child.once('error', value => { error = { name: value.name, message: value.message, code: value.code }; });
  // Register close immediately; error/exit never releases ownership or scratch.
  const [code, signal] = await new Promise(resolve => child.once('close', (...values) => resolve(values)));
  return { code, signal, error, stderr, output };
}

// Each case owns this listener. Producers announce a completed synthetic stage
// and cannot return until the test has acknowledged its exact file/owner set.
async function stageController() {
  const observations = [], pending = new Set();
  let holdNext, held;
  const server = http.createServer(async (request, response) => {
    pending.add(response); response.once('close', () => pending.delete(response));
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const row = JSON.parse(Buffer.concat(chunks));
      assert.equal(row.owner.pid > 0, true);
      const owner = await json(path.join(row.owner.path, 'owner.json'));
      assert.deepEqual(owner, { pid: row.owner.pid, token: row.owner.token });
      observations.push(row);
      if (holdNext) { const resolve = holdNext; holdNext = null; held = response; resolve(row); }
      else response.end(JSON.stringify({ passed: true, files: row.files }));
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const close = async () => {
    for (const response of pending) response.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  return { url: `http://127.0.0.1:${server.address().port}`, observations, close,
    hold: () => new Promise(resolve => { assert.equal(holdNext, undefined); holdNext = resolve; }),
    complete: files => { assert(held); held.end(JSON.stringify({ passed: true, files })); held = undefined; },
  };
}

export async function fixture(t, { version = '1.0.0', digit = '1' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pipeline-owned-'));
  const control = await stageController();
  t.after(async () => { await control.close(); await rm(root, { recursive: true, force: true }); });
  const kit = path.join(root, 'kit'), repo = path.join(root, 'repo'), release = path.join(kit, 'releases/fixture');
  for (const directory of ['tools', 'operator', 'releases', 'release-gate/corpus', 'checks/private-source/scripts/secret-scan'])
    await mkdir(path.join(kit, directory), { recursive: true });
  await mkdir(repo);
  const tools = ['release-v2.mjs', 'frozen-release.mjs', 'release-pack-check.mjs', 'release-identity.mjs', 'release-text.mjs', 'release-legacy-rollback.mjs', 'public-core-gate.mjs', 'release-idle.mjs', 'release-evidence.mjs', 'retry-policy.mjs', 'file-test-evidence.mjs', 'module-scan.mjs', 'file-test-lane.mjs', 'lane-test-evidence.mjs', 'release-lane-status.mjs', 'retry-failed-files.mjs', 'release-early.mjs'];
  for (const name of tools) await cp(path.join(scripts, name), path.join(kit, 'tools', name));
  for (const [name, source] of [
    ['release-preflight.mjs', 'export const releasePreflight=async()=>({passed:true,synthetic:true});'],
    ['check-private-drift.mjs', 'export const assertPrivateDriftForStaging=async()=>{};'],
    ['release-practice.mjs', 'export const assertPracticeAcceptance=async()=>{};'],
    ['verify-install.mjs', 'console.log(JSON.stringify({passed:true}));'],
    ['gallery-browser-check.mjs', 'console.log(JSON.stringify({passed:true}));'],
    ['gallery-check.mjs', "import {access} from 'node:fs/promises';import path from 'node:path';if(process.platform==='win32')for(const name of ['Local','Roaming'])await access(path.join(process.env.USERPROFILE,'AppData',name));console.log(JSON.stringify({passed:true}));"],
  ]) await put(path.join(kit, 'tools', name), source);
  await cp(path.join(fixtures, 'assemble.mjs'), path.join(kit, 'tools/companion-check.mjs'));
  await cp(path.join(fixtures, 'with-heavy.ps1'), path.join(kit, 'operator/with-heavy.ps1'));
  await put(path.join(kit, 'operator/with-light.ps1'), 'param([Parameter(Position=0)][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)\n& $Command @Rest\nexit $LASTEXITCODE');
  await put(path.join(kit, 'operator/Managed-ReleaseV2.ps1'), "param([string]$CurrentRelease,[string]$CandidatePointer,[string]$CompanionRoot,[string]$Receipt,[string]$ReleaseRoot,[switch]$DryRun,[switch]$Rollback)\nif(-not $DryRun){throw 'Only synthetic dry runs allowed'}\nAdd-Content -LiteralPath (Join-Path $CompanionRoot '.local/dry-runs.txt') -Value ([bool]$Rollback)\n");
  await put(path.join(kit, 'kit.json'), { schemaVersion: 2, concurrency: 1, browser: { path: process.execPath } });
  const privateSource = path.join(kit, 'checks/private-source');
  await put(path.join(privateSource, 'scripts/adaptive-test-runner.mjs'), `export async function runAdaptive({files,env,onFile}) {
    const response=await fetch(${JSON.stringify(control.url)},{method:'POST',body:JSON.stringify({files,owner:{path:env.RS3_HEAVY_LOCK_PATH,pid:Number(env.RS3_HEAVY_LOCK_PID),token:env.RS3_HEAVY_LOCK_TOKEN}})});
    if(!response.ok)throw Error(await response.text());
    const ack=await response.json();
    const results=ack.files.map(file=>({file,passed:ack.passed,processWallMs:10,fileWallMs:9,bodyMs:2,summary:{}}));
    for(const row of results)await onFile?.(row);
    return {passed:ack.passed,files:results};
  }`);
  await put(path.join(privateSource, 'scripts/secret-scan/scan.mjs'), `import {execFileSync} from 'node:child_process';export const scanEntries=entries=>({status:'clean',files:entries.length,findings:[]});export const loadReviewed=()=>({hosts:[],placeholders:new Set(),lines:new Set()});export const treeEntries=(repo,ref)=>execFileSync('git',['-C',repo,'ls-tree','-r','--name-only',ref]).toString().split('\\n').filter(Boolean).map(path=>({path,bytes:Buffer.alloc(0)}));`);
  await put(path.join(privateSource, 'scripts/secret-scan/fingerprints.mjs'), 'export const loadCorpus=async()=>({});');
  await put(path.join(privateSource, 'scripts/secret-scan/reviewed.json'), {});
  await put(path.join(privateSource, 'scripts/perf/cdp.mjs'), 'export const syntheticBrowserTransport=true;');
  await put(path.join(privateSource, 'tests/fixtures/original-sync/capture.json'), { synthetic: true });
  const descriptor = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: digit.repeat(64) };
  const selection = { schemaVersion: 1 }, packs = {};
  for (const [kind, id] of [['data', 'duo-data'], ['rulesText', 'duo-rules-text'], ['art', 'duo-art']]) {
    const file = path.join(kit, 'packs', id, version, 'pack.json');
    await put(file, { schemaVersion: 1, requires: { datasetId: descriptor.datasetId, datasetContractVersion: 1 }, datasetDigest: descriptor.digest, ruleContractHash: 'a'.repeat(64), files: [] });
    packs[kind] = { path: file, sha256: hash(await readFile(file)) };
    selection[kind] = { id, version, sha256: packs[kind].sha256 };
  }
  await put(path.join(kit, 'packs/selection.json'), selection);
  const addon = path.join(root, 'old-addon/addon.json'), files = [];
  for (const [name, value] of [
    ['changelog.json', { schemaVersion: 1, entries: [{ date: '2026-01-01', title: 'Earlier', items: ['Earlier item'] }] }],
    ['roadmap.json', { schemaVersion: 1, updated: '2026-01-01', themes: [{ id: 'a', items: [{ id: 'A1', title: 'Task', note: 'Earlier' }] }] }],
  ]) {
    const bytes = JSON.stringify(value), file = path.join(path.dirname(addon), 'app/data', name);
    await put(file, bytes); files.push({ path: 'app/data/' + name, sha256: hash(bytes) });
  }
  await put(addon, { schemaVersion: 1, features: { projectUpdates: true }, files });
  const dataDir = path.join(root, 'save');
  await put(path.join(dataDir, 'state.json'), { revision: 9, members: [{ id: 'one', completedTasks: [], taskStatus: {} }], tasks: [{ id: 'rs3:task:1' }] });
  await put(dataDir + '.dataset.json', bindingBytes(descriptor));
  const origin = path.join(root, 'origin'); await put(origin, 'synthetic origin');
  const previous = path.join(root, 'previous.json');
  await put(previous, { schemaVersion: 1, coreRoot: repo, dataDir, nodePath: process.execPath, publicOriginFile: origin, packsDir: path.join(kit, 'packs'), selection: { path: path.join(kit, 'packs/selection.json'), sha256: hash(await readFile(path.join(kit, 'packs/selection.json'))) }, packs, addons: { path: addon, sha256: hash(await readFile(addon)) } });
  await put(path.join(repo, 'scripts/test.mjs'), '// Synthetic suites use the owned stage controller.');
  await put(path.join(repo, 'scripts/test-selection.mjs'), "import {readdir} from 'node:fs/promises';export const discoverTests=async directory=>(await readdir(directory)).filter(name=>name.endsWith('.test.mjs')).sort();");
  for (const name of [...pipelineTests, 'state.test.mjs']) await put(path.join(repo, 'tests', name), "import test from 'node:test';test('synthetic file',()=>{});");
  await put(path.join(repo, 'tests/browser-screen-harness.mjs'), '// Synthetic public fixture');
  await mkdir(path.join(repo, 'app'));
  await cp(path.join(fixtures, 'server.mjs'), path.join(repo, 'app/server.mjs'));
  await put(path.join(repo, 'app/dataset-bootstrap.mjs'), 'export const loadDatasetInputs=async()=>({definitionBytes:Buffer.from(JSON.stringify({challenges:{}}))});');
  await put(path.join(repo, 'app/dataset-pipeline.mjs'), 'export const prepareTaskDefinitions=x=>x;');
  await put(path.join(repo, 'app/tasks/identity.mjs'), "export const authoredIdentityRegistry=()=>({entries:{'rs3:task:1':{}},aliases:{}});export const resolveIdentity=id=>({status:'resolved',id});");
  git(repo, 'init'); git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fenerax@users.noreply.github.com');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Synthetic pipeline core');
  const revision = git(repo, 'rev-parse', 'HEAD');
  await put(path.join(repo, 'app/server.mjs'), 'throw Error("uncommitted core must never be exported");');
  await put(path.join(repo, 'untracked-private.txt'), 'Synthetic untracked sentinel');
  const input = path.join(root, 'request.json');
  await put(input, { releaseId: 'fixture', changelog: { date: '2026-01-02', title: 'New entry', items: ['New item'] }, roadmap: { id: 'A1', note: 'New note' } });
  const cli = path.join(kit, 'tools/release-v2.mjs'), api = await import(pathToFileURL(cli));
  const prepare = extra => {
    const options = { kit, repo, ref: revision, 'previous-config': previous, input, ...extra };
    // A current pointer supplies its own accepted base, including across kits.
    if (!options.current && !options.base) options.base = revision;
    return api.prepare(options);
  };
  const gates = async (target = release, extra = {}) => {
    try {
      return await api.releaseCandidate(await api.parseArgs(['--kit', kit, '--release', target, '--gates-only', '--no-retry-once-in-isolation', ...Object.entries(extra).flatMap(([key, value]) => ['--' + key, value])]));
    } catch (error) {
      const logs = {};
      for (const name of await readdir(path.join(target, '.local'))) if (name.endsWith('.log')) logs[name] = (await readFile(path.join(target, '.local', name), 'utf8')).slice(-4096);
      throw new Error(error.message + '\nClosed stage diagnostics: ' + JSON.stringify(logs), { cause: error });
    }
  };
  return { root, kit, repo, release, previous, input, dataDir, descriptor: { ...descriptor, bindingSha256: hash(bindingBytes(descriptor)) }, cli, api, revision, prepare, gates, control };
}
