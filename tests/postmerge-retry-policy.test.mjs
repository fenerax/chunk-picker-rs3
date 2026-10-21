// Real worker assembly/scratch boundaries with an opaque synthetic scheduler.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, writeFile, readFile, cp, rm, access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { queuePrivate, runPrivateMerge } from '../scripts/private-companion/post-merge-private.mjs';
import { releaseLaneReport } from '../scripts/private-companion/release-lane-status.mjs';

const source = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const json = async file => JSON.parse(await readFile(file, 'utf8'));

for (const scenario of ['recovers', 'fails-twice', 'diagnostic-off']) {
  test('postmerge retry ' + scenario + ' preserves isolated scratch and lane outcome', { timeout: 60000 }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'postmerge-retry-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const coreRepo = path.join(root, 'core'), privateSource = path.join(root, 'private');
    const toolsSource = path.join(privateSource, 'scripts/private-companion');
    await mkdir(coreRepo); await mkdir(path.join(root, 'empty-hooks'));
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + path.join(root, 'empty-hooks'), '-C', coreRepo, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--initial-branch=main'); git('config', 'core.autocrlf', 'false');
    git('config', 'user.name', 'Synthetic fixture'); git('config', 'user.email', 'fixture@example.invalid');
    await put(path.join(coreRepo, 'tests/opaque.test.mjs'), "import test from 'node:test';test('opaque',()=>{Date.now();});\n");
    await put(path.join(coreRepo, 'scripts/test-selection.mjs'), "export const discoverTests=async()=>['opaque.test.mjs'];\n");
    await put(path.join(coreRepo, 'scripts/test.mjs'), '// synthetic runner');
    git('add', '.'); git('-c', 'commit.gpgSign=false', 'commit', '-m', 'synthetic retry');
    const sha = git('rev-parse', 'HEAD');
    await put(path.join(privateSource, 'tests/core-overlays.json'), {});
    await put(path.join(privateSource, 'scripts/adaptive-test-runner.mjs'), `
import path from 'node:path';
import { access, readFile, writeFile, appendFile } from 'node:fs/promises';
export async function runAdaptive({files,cwd,env,minConcurrency,maxConcurrency}) {
  const log=path.join(path.dirname(cwd),'attempts.jsonl');
  const prior=await readFile(log,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '';});
  const probe=path.join(env.HOME,'scratch-probe');
  await access(probe).then(()=>{throw Error('Retry retained prior HOME scratch');},error=>{if(error.code!=='ENOENT')throw error;});
  await writeFile(probe,'attempt');
  await appendFile(log,JSON.stringify({files,minConcurrency,maxConcurrency,retry:env.RS3_TEST_RETRY_ONCE_IN_ISOLATION})+'\\n');
  const passed=${scenario === 'recovers'}&&!!prior;
  return {passed,exitCode:passed?0:1,aborted:false,wallMs:1,files:files.map(file=>({file,passed,bodyMs:1}))};
}
`);
    await mkdir(toolsSource, { recursive: true });
    for (const name of ['file-test-evidence.mjs', 'module-scan.mjs', 'file-test-lane.mjs', 'lane-test-evidence.mjs', 'release-identity.mjs', 'release-evidence.mjs', 'retry-policy.mjs', 'companion-check.mjs']) await cp(path.join(source, name), path.join(toolsSource, name));
    await put(path.join(toolsSource, 'with-heavy.ps1'), '# synthetic wrapper');
    const browserPath = path.join(root, 'chrome.exe'); await put(browserPath, 'synthetic browser');
    const packsDir = path.join(root, 'packs'), payload = 'synthetic pack';
    await put(path.join(packsDir, 'fixture/1/payload.txt'), payload);
    const pack = JSON.stringify({ files: [{ path: 'payload.txt', bytes: Buffer.byteLength(payload), sha256: hash(payload) }] });
    await put(path.join(packsDir, 'fixture/1/pack.json'), pack);
    const pin = { id: 'fixture', version: '1', sha256: hash(pack) };
    await put(path.join(packsDir, 'selection.json'), { data: pin, rulesText: pin, art: pin });
    const config = { coreRepo, privateSource, toolsSource, packsDir, browserPath, heavyLock: path.join(toolsSource, 'with-heavy.ps1'),
      nodePath: process.execPath, concurrency: 2, lanes: ['public-full'], logsRoot: path.join(root, 'logs'), workRoot: path.join(root, 'work'), evidenceDir: path.join(root, 'evidence'),
      ...(scenario === 'diagnostic-off' ? { retryOnceInIsolation: false } : {}) };
    await queuePrivate(sha, config, { spawnDetached: async () => ({ pid: process.pid }), processIdentity: async pid => ({ pid, created: 'synthetic' }) });
    const stateFile = path.join(config.logsRoot, sha, 'state.json'), queued = await json(stateFile);
    const run = () => runPrivateMerge(config, sha, { token: queued.token, requireOwner: async () => {}, memory: () => 16 * 1024 ** 3 });
    if (scenario === 'recovers') await run();
    else await assert.rejects(run(), /failed/i);
    const state = await json(stateFile), release = path.join(state.workspace, 'k/releases/pair');
    const attempts = (await readFile(path.join(release, '.local/attempts.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(attempts.length, scenario === 'diagnostic-off' ? 1 : 2);
    assert.deepEqual(attempts[0], { files: ['tests/opaque.test.mjs'], minConcurrency: 2, maxConcurrency: 2, retry: scenario === 'diagnostic-off' ? '0' : '1' });
    if (attempts[1]) assert.deepEqual(attempts[1], { files: ['tests/opaque.test.mjs'], minConcurrency: 1, maxConcurrency: 1, retry: '0' });
    for (const name of ['public-assembly', 'lane-home', 'lane-temp', 'compile-cache']) await assert.rejects(access(path.join(release, '.local', name)), { code: 'ENOENT' });
    if (scenario === 'recovers') {
      const complete = await json(path.join(config.logsRoot, sha, 'complete.json'));
      assert.equal(state.phase, 'complete');
      assert.match(await readFile(path.join(release, '.local/flaky-files.jsonl'), 'utf8'), /FLAKY/);
      assert.match(releaseLaneReport({ passed: true, flakeRetryEnabled: true, timings: complete.summaries }), /\*\*FLAKY FILES: tests\/opaque.test.mjs\*\*/);
      const observed = complete.items['public-full'].laneEvidence.record.files[0].proof.record.metrics;
      assert.equal(observed.flaky, true); assert.equal(observed.attempts.length, 2);
    } else {
      assert.equal(state.phase, 'failed');
      assert.equal(state.summaries[0].passed, false);
      const laneDirectory = path.join(release, 'release-gate/lanes');
      const [filename] = (await readdir(laneDirectory)).filter(name => name.endsWith('.json'));
      const failedLane = await json(path.join(laneDirectory, filename));
      assert.equal(failedLane.status, 'failed');
      assert.equal(failedLane.files[0].metrics.attempts?.length, scenario === 'fails-twice' ? 2 : undefined);
      await assert.rejects(access(path.join(config.logsRoot, sha, 'complete.json')), { code: 'ENOENT' });
    }
  });
}
