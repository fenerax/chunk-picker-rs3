// End-to-end synthetic producer/consumer; no real gate or heavy wrapper runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { queuePrivate, runPrivateMerge } from '../scripts/private-companion/post-merge-private.mjs';
import { inspectFullLaneReuse } from '../scripts/private-companion/release-v2.mjs';
import { hashTree } from '../scripts/private-companion/release-identity.mjs';
import { resolveRetryPolicy } from '../scripts/private-companion/retry-policy.mjs';

const scratch = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local');
const source = fileURLToPath(new URL('../scripts/private-companion/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const json = async file => JSON.parse(await readFile(file, 'utf8'));

test('postmerge full receipts are consumed by release with zero fresh files after kit relocation', { timeout: 45000 }, async t => {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'postmerge-pair-lane-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const coreRepo = path.join(root, 'core'), privateSource = path.join(root, 'private');
  const toolsSource = path.join(privateSource, 'scripts/private-companion');
  const coreGit = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + path.join(root, 'empty-hooks'), '-C', coreRepo, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await mkdir(coreRepo); await mkdir(path.join(root, 'empty-hooks'));
  coreGit('init', '--initial-branch=main'); coreGit('config', 'core.autocrlf', 'false');
  coreGit('config', 'user.name', 'Synthetic fixture'); coreGit('config', 'user.email', 'fixture@example.invalid');
  for (const name of ['a', 'b']) await put(path.join(coreRepo, 'tests', name + '.test.mjs'), "import test from 'node:test';test('opaque fixture',()=>{Date.now();});\n");
  await put(path.join(coreRepo, 'scripts/test-selection.mjs'), '// synthetic selector');
  await put(path.join(coreRepo, 'scripts/test.mjs'), '// synthetic runner');
  coreGit('add', '.'); coreGit('-c', 'commit.gpgSign=false', 'commit', '-m', 'synthetic pair');
  const sha = coreGit('rev-parse', 'HEAD');
  await put(path.join(privateSource, 'scripts/adaptive-test-runner.mjs'), '// fixture executor injected instead of scheduler');
  await put(path.join(privateSource, 'tests/c.test.mjs'), "import test from 'node:test';test('private opaque',()=>{Date.now();});\n");
  await put(path.join(privateSource, 'tests/core-overlays.json'), {});
  await mkdir(toolsSource, { recursive: true });
  for (const name of ['file-test-evidence.mjs', 'module-scan.mjs', 'file-test-lane.mjs', 'lane-test-evidence.mjs', 'release-identity.mjs', 'release-evidence.mjs', 'retry-policy.mjs', 'companion-check.mjs', 'postmerge-pair.mjs']) await cp(path.join(source, name), path.join(toolsSource, name));
  await put(path.join(toolsSource, 'with-heavy.ps1'), '# synthetic operator wrapper');
  await put(path.join(toolsSource, 'RELEASING.md'), 'Synthetic operator text');
  const acceptedKit = path.join(root, 'accepted');
  await put(path.join(acceptedKit, 'tools/gallery-browser-check.mjs'), '// accepted browser override');
  const heavyLock = path.join(root, 'heavy.ps1'), browserPath = path.join(root, 'chrome.exe');
  await put(heavyLock, '# synthetic external wrapper'); await put(browserPath, 'synthetic browser bytes');
  const packsDir = path.join(root, 'packs'), payload = 'synthetic pack data';
  await put(path.join(packsDir, 'fixture/1/payload.txt'), payload);
  const pack = JSON.stringify({ files: [{ path: 'payload.txt', bytes: Buffer.byteLength(payload), sha256: hash(payload) }] });
  await put(path.join(packsDir, 'fixture/1/pack.json'), pack);
  const pin = { id: 'fixture', version: '1', sha256: hash(pack) };
  await put(path.join(packsDir, 'selection.json'), { data: pin, rulesText: pin, art: pin });
  const config = { coreRepo, privateSource, toolsSource, acceptedKit, packsDir, heavyLock, browserPath,
    nodePath: process.execPath, concurrency: 1, logsRoot: path.join(root, 'logs'), workRoot: path.join(root, 'work'), evidenceDir: path.join(root, 'evidence') };
  const queued = await queuePrivate(sha, config, { spawnDetached: async () => ({ pid: process.pid }), processIdentity: async pid => ({ pid, created: 'synthetic-launch' }) });
  assert.equal(queued.status, 'queued');
  const state = await json(path.join(config.logsRoot, sha, 'state.json')), calls = [];
  await runPrivateMerge(config, sha, { token: state.token, requireOwner: async () => {}, memory: () => 16 * 1024 ** 3,
    executeLane: async ({ lane, files }) => { calls.push({ lane, files }); return { passed: true, aborted: false, files: files.map(file => ({ file, passed: true, bodyMs: 1 })) }; } });
  assert.deepEqual(calls.map(call => call.files.length), [2, 3]);
  const complete = await json(path.join(config.logsRoot, sha, 'complete.json'));
  assert.equal((await hashTree(path.join(complete.kit, 'operator'))).files.length, 2);
  assert.equal(await readFile(path.join(complete.kit, 'tools/gallery-browser-check.mjs'), 'utf8'), '// accepted browser override');
  const movedKit = path.join(root, 'relocated-kit'); await cp(complete.kit, movedKit, { recursive: true });
  const movedRelease = path.join(movedKit, 'releases/pair'), companion = await json(path.join(movedRelease, 'companion.json'));
  companion.coreRoot = path.join(movedRelease, 'core'); companion.packsDir = path.join(movedKit, 'packs');
  await put(path.join(movedRelease, 'companion.json'), companion);
  const moved = await inspectFullLaneReuse({ kit: movedKit, release: movedRelease, directory: config.evidenceDir, retryOnceInIsolation: resolveRetryPolicy(config) });
  for (const lane of ['public-full', 'private-full']) {
    assert.equal(moved.lanes[lane].accepted, true); assert.equal(moved.lanes[lane].fresh, 0);
    assert.deepEqual(moved.lanes[lane].sourceRunIds, [state.token]);
    assert.equal(moved.lanes[lane].key, complete.items[lane].laneEvidence.record.contract.key);
  }
  assert.equal(complete.summaries.length, 2);
  const disabled = await inspectFullLaneReuse({ kit: movedKit, release: movedRelease, directory: config.evidenceDir, retryOnceInIsolation: false });
  for (const lane of ['public-full', 'private-full']) {
    assert.equal(disabled.lanes[lane].accepted, false);
    assert.equal(disabled.lanes[lane].reused, 0);
    assert.notEqual(disabled.lanes[lane].key, moved.lanes[lane].key);
  }
});
