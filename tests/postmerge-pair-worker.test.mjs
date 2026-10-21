import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { queuePrivate, dispatch, pairStatus, privateConfig, executionFor, parsePrivateArguments } from '../scripts/private-companion/post-merge-private.mjs';
import { copyTools, toolDigest, buildText, textPins, pairProgress } from '../scripts/private-companion/postmerge-pair.mjs';
import { laneEnvironment, stableExecution } from '../scripts/private-companion/release-evidence.mjs';

const scratch = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local');
const sha = char => char.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'postmerge-pair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { coreRepo: path.join(root, 'core'), privateSource: path.join(root, 'private'),
    packsDir: path.join(root, 'packs'), toolsSource: path.join(root, 'tools'), heavyLock: path.join(root, 'heavy.ps1'),
    nodePath: process.execPath, browserPath: path.join(root, 'chrome.exe'), logsRoot: path.join(root, 'logs'),
    workRoot: path.join(root, 'work'), evidenceDir: path.join(root, 'evidence') };
  for (const name of ['core', 'private', 'packs', 'tools']) await mkdir(path.join(root, name));
  const git = (...args) => {
    if (args[0] === 'merge-base' && args[2] > args[3]) throw Object.assign(Error('fixture nonancestor'), { status: 1 });
    return args[0] === 'rev-parse' ? args[2].includes('^{tree}') ? sha('d') : args[2].startsWith('refs/') ? sha('c') : args[2].slice(0, 40) : '';
  };
  const deps = { git, capturePins: async (config, source) => ({ coreSHA: source.sha, text: { available: false } }),
    readComplete: async () => null, processIdentity: async pid => ({ pid, created: 'fixture' }),
    spawnDetached: async () => ({ pid: process.pid }) };
  return { root, config, deps };
}

test('single dispatcher coalesces intermediate main notifications, finishes active pair', async t => {
  const { config, deps } = await fixture(t);
  const first = await queuePrivate(sha('a'), config, deps);
  assert.equal(first.status, 'queued');
  const started = JSON.parse(await readFile(path.join(config.logsRoot, sha('a'), 'state.json')));
  const commands = [];
  await dispatch(await privateConfig(config), sha('a'), started.token, started.config, { command: async (command, args, options) => {
    commands.push(args[args.indexOf('--worker') + 1]);
    assert.equal(options.env.RS3_HEAVY_IGNORE_ACTIVITY, '1');
    if (commands.length === 1) {
      const notifications = await Promise.all([queuePrivate(sha('b'), config, deps), queuePrivate(sha('c'), config, deps)]);
      assert.ok(['queued', 'superseded'].includes(notifications[0].status));
      assert.equal(notifications[1].status, 'queued');
    }
  } });
  assert.deepEqual(commands, [sha('a'), sha('c')]);
  assert.equal(JSON.parse(await readFile(path.join(config.logsRoot, 'dispatcher.json'))).phase, 'complete');
});

test('worker failure drains newest pair and terminates once without promotion', async t => {
  const { config, deps } = await fixture(t);
  await queuePrivate(sha('a'), config, deps);
  const state = JSON.parse(await readFile(path.join(config.logsRoot, sha('a'), 'state.json')));
  let calls = 0;
  await dispatch(await privateConfig(config), sha('a'), state.token, state.config, { processIdentity: async pid => pid === 900001 ? null : deps.processIdentity(pid), command: async () => {
    calls++;
    if (calls === 1) {
      await queuePrivate(sha('b'), config, deps);
      await writeFile(path.join(config.logsRoot, 'queue-claim.json'), JSON.stringify({ token: 'dead-dispatch-claim', owner: { pid: 900001, created: 'dead' } }));
      throw Error('fixture failed');
    }
  } });
  assert.equal(calls, 2);
  assert.equal(JSON.parse(await readFile(path.join(config.logsRoot, sha('a'), 'state.json'))).phase, 'failed');
  const finished = await pairStatus(sha('a'), config, deps);
  assert.equal(finished.running, null); assert.equal(finished.queued, null);
});

test('concurrent stale reclaimers preserve a new live claim and durable newest request', { timeout: 3000 }, async t => {
  const { config, deps } = await fixture(t);
  await mkdir(config.logsRoot, { recursive: true });
  const claim = path.join(config.logsRoot, 'queue-claim.json'), guard = claim + '.reclaimer';
  await writeFile(claim, JSON.stringify({ token: 'stale-primary', owner: { pid: 900001, created: 'dead' } }));
  let releaseDead, enteredDead, releaseLive, enteredLive, sawLive;
  const deadHeld = new Promise(resolve => { releaseDead = resolve; });
  const deadEntered = new Promise(resolve => { enteredDead = resolve; });
  const liveHeld = new Promise(resolve => { releaseLive = resolve; });
  const liveEntered = new Promise(resolve => { enteredLive = resolve; });
  const liveObserved = new Promise(resolve => { sawLive = resolve; });
  let deadChecks = 0, spawning = false, spawns = 0;
  const concurrent = { ...deps, processIdentity: async pid => {
    if (pid === 900001) { deadChecks++; enteredDead(); await deadHeld; return null; }
    if (spawning) sawLive();
    return deps.processIdentity(pid);
  }, spawnDetached: async () => { spawns++; spawning = true; enteredLive(); await liveHeld; spawning = false; return { pid: process.pid }; } };
  const jobs = [queuePrivate(sha('b'), config, concurrent), queuePrivate(sha('c'), config, concurrent)];
  try {
    await deadEntered;
    await delay(70); // Both notifications can reach recovery while its owner waits.
    assert.equal(deadChecks, 1);
    assert.ok(JSON.parse(await readFile(guard)).token);
    releaseDead(); await liveEntered;
    const liveToken = JSON.parse(await readFile(claim)).token;
    await liveObserved;
    assert.equal(JSON.parse(await readFile(claim)).token, liveToken);
    assert.equal(deadChecks, 1);
  } finally { releaseDead(); releaseLive(); }
  await Promise.all(jobs);
  assert.equal(spawns, 1);
  assert.equal(JSON.parse(await readFile(path.join(config.logsRoot, 'latest.json'))).sha, sha('c'));
  await assert.rejects(readFile(guard), { code: 'ENOENT' });
});

test('status refuses release readiness when next request is unavailable or only one lane checked', async t => {
  const { config, deps } = await fixture(t);
  const complete = { readComplete: async () => ({ passed: true }) };
  const status = await pairStatus(sha('a'), config, { ...deps, ...complete });
  assert.equal(status.checked, true);
  assert.equal(status.ready, false);
  assert.match(status.reason, /request unavailable/);
  assert.equal(status.etaSeconds, null);
  const partial = await pairStatus(sha('a'), { ...config, lanes: ['private-full'] }, { ...deps, ...complete,
    capturePins: async () => ({ text: { available: true } }) });
  assert.equal(partial.ready, false);
  assert.equal(partial.reason, 'partial lane selection');
});

test('postmerge execution matches release lane environment after relocation', async t => {
  const { root, config } = await fixture(t);
  for (const lane of ['public-full', 'private-full']) {
    const kit = path.join(root, 'kit-a'), release = path.join(kit, 'releases/a');
    const actual = await executionFor({ ...config, concurrency: 2 }, kit, release, lane);
    const otherKit = path.join(root, 'kit-b'), otherRelease = path.join(otherKit, 'releases/b');
    const overrides = lane === 'public-full' ? { RS3_DATASET: 'open-f2p' } : {
      RS3_GAME_DATA_DIR: path.join(otherRelease, '.local/assembly/.local/game-data'),
      RS3_MAP_ASSETS_DIR: path.join(otherRelease, '.local/assembly/.local/map-assets'),
      RS3_PUBLIC_BROWSER_SCREEN_HARNESS: path.join(otherRelease, 'core/tests/browser-screen-harness.mjs') };
    const env = await laneEnvironment(otherRelease, process.execPath, { RS3_TEST_CONCURRENCY: '2', RS3_TEST_RETRY_ONCE_IN_ISOLATION: '1', ...overrides });
    const expected = await stableExecution({ lane, command: process.execPath, node: process.execPath, args: ['scripts/test.mjs', 'full'], env, kit: otherKit, release: otherRelease });
    assert.equal(actual.execution.digest, expected.digest);
    assert.equal(actual.env.RS3_TEST_RETRY_ONCE_IN_ISOLATION, '1');
  }
});

test('test-context tool files match stager selection and accepted browser override', async t => {
  const { root, config } = await fixture(t);
  config.acceptedKit = path.join(root, 'accepted'); await mkdir(path.join(config.acceptedKit, 'tools'), { recursive: true });
  await writeFile(path.join(config.toolsSource, 'runner.mjs'), 'runner');
  await writeFile(path.join(config.toolsSource, 'gallery-browser-check.mjs'), 'source browser');
  await writeFile(path.join(config.toolsSource, 'operator.ps1'), 'excluded');
  await writeFile(path.join(config.acceptedKit, 'tools/gallery-browser-check.mjs'), 'accepted browser');
  const before = await toolDigest(config), target = path.join(root, 'copied-tools');
  await copyTools(config, target);
  assert.equal(await readFile(path.join(target, 'gallery-browser-check.mjs'), 'utf8'), 'accepted browser');
  await assert.rejects(readFile(path.join(target, 'operator.ps1')));
  await writeFile(path.join(config.acceptedKit, 'tools/gallery-browser-check.mjs'), 'changed');
  assert.notEqual(await toolDigest(config), before);
});

test('exact next release prose is built from pinned previous addon and explicit request', async t => {
  const { root, config } = await fixture(t);
  const addonRoot = path.join(root, 'addon'), dataRoot = path.join(addonRoot, 'app/data');
  await mkdir(dataRoot, { recursive: true });
  const payloads = { 'changelog.json': { schemaVersion: 1, entries: [] }, 'roadmap.json': { schemaVersion: 1, updated: '2026-10-18', themes: [{ items: [{ id: 'next', note: 'Before' }] }] } };
  const files = [];
  for (const [name, value] of Object.entries(payloads)) { const bytes = JSON.stringify(value); await writeFile(path.join(dataRoot, name), bytes); files.push({ path: 'app/data/' + name, sha256: hash(bytes) }); }
  const addonPath = path.join(addonRoot, 'addon.json'), addon = JSON.stringify({ files }); await writeFile(addonPath, addon);
  const previous = JSON.stringify({ addons: { path: addonPath, sha256: hash(addon) } }), previousPath = path.join(root, 'previous.json'); await writeFile(previousPath, previous);
  config.current = path.join(root, 'current.json'); await writeFile(config.current, JSON.stringify({ schemaVersion: 2, config: { path: previousPath, sha256: hash(previous) } }));
  config.request = path.join(root, 'request.json'); await writeFile(config.request, JSON.stringify({ changelog: { date: '2026-10-19', title: 'A change', items: ['Improved behavior'] }, roadmap: { id: 'next', note: 'After' } }));
  const pins = await textPins(config), release = path.join(root, 'release'); await mkdir(path.join(release, '.local'), { recursive: true });
  const text = await buildText(config, release);
  assert.equal(pins.available, true); assert.equal(text.length, 2);
  for (const item of text) assert.equal(hash(await readFile(item.source)), item.sha256);
  assert.equal(JSON.parse(await readFile(text[0].source)).entries[0].title, 'A change');
  await writeFile(path.join(dataRoot, 'roadmap.json'), '{}');
  await assert.rejects(textPins(config), /previous text changed/);
});

test('configuration and CLI support explicit private demo without idle admission', async t => {
  const { root, config } = await fixture(t);
  const configPath = path.join(root, 'config.json');
  assert.deepEqual((await privateConfig(config)).lanes, ['public-full', 'private-full']);
  assert.equal((await privateConfig({ ...config, logsRoot: path.join(config.coreRepo, '.local/logs') })).logsRoot, path.join(config.coreRepo, '.local/logs'));
  await assert.rejects(privateConfig({ ...config, logsRoot: path.join(config.coreRepo, 'app/logs') }), /placement refused/);
  assert.equal(parsePrivateArguments(['--status', sha('a'), '--config', configPath]).mode, '--status');
  assert.equal(parsePrivateArguments([sha('a'), '--config', configPath, '--lane', 'private-full']).lane, 'private-full');
  assert.throws(() => parsePrivateArguments(['--status', sha('a'), '--config', configPath, '--token', 'bad']), /refused/);
  assert.throws(() => parsePrivateArguments([sha('a'), '--config', configPath, '--current', path.join(root, 'pointer.json')]), /refused/);
  await assert.rejects(privateConfig({ ...config, request: path.join(scratch, 'request.json') }), /together/);
  const worker = await readFile(new URL('../scripts/private-companion/release-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /adapters\.(?:stage|prepare|gates|promote)|import\(['"]\.\/release-v2/);
});

test('ETA uses measured current-lane progress and stays unknown while blocked', () => {
  assert.equal(pairProgress({ completed: 4, total: 20, elapsedMs: 4000 }).etaSeconds, null);
  const rough = pairProgress({ completed: 5, total: 20, elapsedMs: 10000 });
  assert.equal(rough.etaSeconds, 30); assert.match(rough.etaBasis, /excludes later lanes/);
  assert.equal(pairProgress({ completed: 5, total: 20, elapsedMs: 10000, waitingFor: 'memory' }).etaSeconds, null);
});

test('default accepted pointer follows current kit and packs, rejecting changed config pins', async t => {
  const { root, config } = await fixture(t);
  const nextPacks = path.join(root, 'next-packs'), acceptedKit = path.join(root, 'accepted');
  await mkdir(nextPacks);
  const selected = path.join(acceptedKit, 'releases/next/config.json'); await mkdir(path.dirname(selected), { recursive: true });
  const bytes = JSON.stringify({ packsDir: nextPacks }); await writeFile(selected, bytes);
  const pointer = path.join(root, 'current.json'); await writeFile(pointer, JSON.stringify({ schemaVersion: 2, config: { path: selected, sha256: hash(bytes) } }));
  const dynamic = { ...config, acceptedCurrent: pointer }; delete dynamic.packsDir;
  const resolved = await privateConfig(dynamic);
  assert.equal(resolved.acceptedKit, acceptedKit); assert.equal(resolved.packsDir, nextPacks);
  assert.ok(resolved.acceptedCurrentPin.pointer);
  assert.equal((await privateConfig({ ...dynamic, packsDir: config.packsDir })).packsDir, config.packsDir);
  await writeFile(selected, '{}');
  await assert.rejects(privateConfig(dynamic), /pin changed/);
});
