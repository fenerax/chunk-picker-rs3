#!/usr/bin/env node
// Dependency-free, isolated Chrome/CDP benchmark. Never connects to the live picker.
import { fork, execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, realpath, lstat, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openChrome, stopChild, sleep, until } from './cdp.mjs';
import { probeSource, snapshotExpression, initialViewSource } from './probe.mjs';
import { ASSET_CLASSES, assetClass, category, networkCollector } from './network-collector.mjs';
import { resolvePerfApplication, fingerprintPerfApplication, rejectPathLinks } from './inputs.mjs';
import { measureBrowserInteractions, interactionScenarios } from './browser-interactions.mjs';
import { safeDiagnostic, safeStderrTail, sanitizeMemoryTelemetry, DIAGNOSTIC_PREFIX } from './diagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim());
const PERF = path.join(ROOT, '.local/perf');
// Match the existing hosted gallery lane. Linux runner sandbox namespaces and
// /dev/shm are constrained; local desktop launches retain their normal flags.
const chromeExtraArgs = process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true'
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
let diagnosticContext = {};
const options = { runs: 3, label: 'baseline', timeout: 180000, prewarm: 'on', groupView: 'off', unlockMember: 'player1', unlockPick: 'any', unlockPreview: 'off', unlockDwellMs: 0, noteDwellMs: 0, settlement: 'idle', cpuProfile: 'off', screenshots: 'off', cancellationCheck: 'off', idleSampleMs: 0, scenarios: ['cold', 'reload', 'switch-player2', 'switch-player1', 'unlock', 'cold-30mbps'] };
// Even, so the alternating save/clear burst ends with the copied save's notes.
const SAVE_BURST_COMMANDS = 20;
const usage = `Usage: npm run perf -- [options]
  --runs N               Independent repetitions (default 3); medians reported
  --label NAME           Output label (default baseline; letters/numbers/-/_)
  --scenarios LIST       Comma-separated scenarios: cold,reload,switch-player2,switch-player1,unlock,cold-30mbps,panels,search,note-save,personal-filter,save-burst
  --timeout MS           Deadline for each measurement (default 180000)
  --prewarm on|off        Prediction prewarming (default on); controlled experiment
  --group-view on|off     Group task view (default off); on waits for the complete duo
  --unlock-preview on|off Wait for the chunk's Preview before Unlock (default off; separate workflow)
  --unlock-dwell-ms MS   Wait in the locked panel before timing Unlock (0 off; max 60000; any only)
  --note-dwell-ms MS     Pause before note-clear, save-burst and the after-suite sample (0 off; max 60000)
  --unlock-member player1|player2  Player whose scratch chunk is unlocked (default player1)
  --unlock-pick any|prepared|unprepared  Existing choice, Preview, or outside the warm pool (default any)
  --unlock-chunk ID       Explicit locked surface chunk; unprepared must be outside the warm pool
  --task-milestone tasks|duo  Override task event (default follows group view); legacy comparisons
  --settlement idle|tasks End at network idle (default), or refreshed tasks and tiles
  --cpu-profile off|on    Renderer CPU profiles for selected scenarios (default off)
  --screenshots off|on|responsive  Capture full zoom suite or desktop/390px only (default off)
  --cancellation-check off|on  Post-measurement rapid pan/zoom probe (default off)
  --idle-sample-ms MS     Post-suite RSS/residency and task-settled reload probe (0 off; max 60000)
  --server-entry PATH     Server module inside this worktree (default app/server.mjs)
  --app-dir PATH          Measured app checkout (or its app directory); no links
  --server-revision REV   Source revision label; verify the selected code before use
  --packs-dir PATH        Selected read-only packs (or RS3_PACKS_DIR)
  --pack-selection PATH   Pack selection JSON (or RS3_PACK_SELECTION)
  --port N               Owned loopback port, 8960 through 8969 (default ephemeral)
  --server-heap-mib N    Explicit server/worker old-generation heap limit (512–4096; default Node policy)
  --output PATH          JSON report inside this worktree .local/perf; Markdown beside it
  --chrome PATH          Chrome executable (or CHROME_PATH)
  --source PATH          Read-only duo directory (default main repo .local/duo)
  --map-assets PATH      Read-only map asset directory (default main .local/map-assets)
  --terrain-assets PATH  Read-only terrain bundle directory (default map-assets)
  --game-data PATH       Read-only game data directory (default main .local/game-data)
  --help                 Show this help without copying data or starting processes

Node 24+. Outputs ignored JSON and Markdown under .local/perf.
Every iteration copies the duo into a disposable worktree directory, strips access
credentials/locks, and launches its own localhost server and headless Chrome profile.
Cold first visits authenticate without navigating the app, then clear browser cache.
Reload retains HTTP cache; 30 Mbps uses 40 ms CDP latency, 30 Mbps in both directions.
Unlock changes only the scratch save through the existing Search and Unlock UI.
Note save writes, then clears, a fixed synthetic note on an unlocked scratch chunk.
Save burst commits ${SAVE_BURST_COMMANDS} alternating note saves/clears from a second scratch session.
`;
function parse(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { console.log(usage); return false; }
    const key = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    if (key === '--runs') options.runs = Number(value);
    else if (key === '--timeout') options.timeout = Number(value);
    else if (key === '--label') options.label = value;
    else if (key === '--prewarm') options.prewarm = value;
    else if (key === '--group-view') options.groupView = value;
    else if (key === '--unlock-preview') options.unlockPreview = value;
    else if (key === '--unlock-dwell-ms') options.unlockDwellMs = Number(value);
    else if (key === '--note-dwell-ms') options.noteDwellMs = Number(value);
    else if (key === '--unlock-member') options.unlockMember = value;
    else if (key === '--unlock-pick') options.unlockPick = value;
    else if (key === '--unlock-chunk') options.unlockChunk = value;
    else if (key === '--task-milestone') options.taskMilestone = value;
    else if (key === '--settlement') options.settlement = value;
    else if (key === '--cpu-profile') options.cpuProfile = value;
    else if (key === '--screenshots') options.screenshots = value;
    else if (key === '--cancellation-check') options.cancellationCheck = value;
    else if (key === '--idle-sample-ms') options.idleSampleMs = Number(value);
    else if (key === '--server-entry') options.serverEntry = path.resolve(value);
    else if (key === '--app-dir') options.appDir = path.resolve(value);
    else if (key === '--packs-dir') options.packsDir = path.resolve(value);
    else if (key === '--pack-selection') options.packSelection = path.resolve(value);
    else if (key === '--port') options.port = Number(value);
    else if (key === '--server-heap-mib') options.serverHeapMiB = Number(value);
    else if (key === '--output') options.output = path.resolve(value);
    else if (key === '--server-revision') options.serverRevision = value;
    else if (key === '--scenarios') options.scenarios = value.split(',');
    else if (key === '--chrome') options.chrome = path.resolve(value);
    else if (key === '--source') options.source = path.resolve(value);
    else if (key === '--map-assets') options.mapAssets = path.resolve(value);
    else if (key === '--terrain-assets') options.terrainAssets = path.resolve(value);
    else if (key === '--game-data') options.gameData = path.resolve(value);
    else throw new Error(`Unknown option ${key}.`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) throw new Error('--runs must be an integer from 1 to 100.');
  if (!Number.isInteger(options.timeout) || options.timeout < 1000 || options.timeout > 600000) throw new Error('--timeout must be 1000 through 600000 milliseconds.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(options.label)) throw new Error('--label must contain 1–80 letters, numbers, underscores or hyphens.');
  if (!['on', 'off'].includes(options.prewarm)) throw new Error('--prewarm must be on or off.');
  if (!['on', 'off'].includes(options.groupView)) throw new Error('--group-view must be on or off.');
  if (!['on', 'off'].includes(options.unlockPreview)) throw new Error('--unlock-preview must be on or off.');
  if (!['player1', 'player2'].includes(options.unlockMember)) throw new Error('--unlock-member must be player1 or player2.');
  if (!['any', 'prepared', 'unprepared'].includes(options.unlockPick)) throw new Error('--unlock-pick must be any, prepared or unprepared.');
  if (options.unlockChunk !== undefined && !/^[1-9]\d*$/.test(options.unlockChunk)) throw new Error('--unlock-chunk must be a numeric surface chunk ID.');
  if (options.unlockPick === 'unprepared' && options.unlockPreview === 'on') throw new Error('--unlock-pick unprepared requires --unlock-preview off.');
  if (!Number.isInteger(options.unlockDwellMs) || options.unlockDwellMs < 0 || options.unlockDwellMs > 60000) throw new Error('--unlock-dwell-ms must be an integer from 0 through 60000.');
  if (!Number.isInteger(options.noteDwellMs) || options.noteDwellMs < 0 || options.noteDwellMs > 60000) throw new Error('--note-dwell-ms must be an integer from 0 through 60000.');
  if (options.unlockDwellMs && (options.unlockPick !== 'any' || options.unlockPreview !== 'off')) throw new Error('--unlock-dwell-ms requires --unlock-pick any and --unlock-preview off.');
  options.taskMilestone ??= options.groupView === 'on' ? 'duo' : 'tasks';
  if (!['tasks', 'duo'].includes(options.taskMilestone)) throw new Error('--task-milestone must be tasks or duo.');
  if (options.taskMilestone === 'duo' && options.groupView !== 'on') throw new Error('--task-milestone duo requires --group-view on.');
  if (!['idle', 'tasks'].includes(options.settlement)) throw new Error('--settlement must be idle or tasks.');
  if (!['off', 'on'].includes(options.cpuProfile)) throw new Error('--cpu-profile must be off or on.');
  if (!['on', 'off', 'responsive'].includes(options.screenshots)) throw new Error('--screenshots must be on, off or responsive.');
  if (!['on', 'off'].includes(options.cancellationCheck)) throw new Error('--cancellation-check must be on or off.');
  if (!Number.isInteger(options.idleSampleMs) || options.idleSampleMs < 0 || options.idleSampleMs > 60000) throw new Error('--idle-sample-ms must be an integer from 0 through 60000.');
  if (options.serverRevision && !/^[a-f0-9]{7,40}$/i.test(options.serverRevision)) throw new Error('--server-revision must be a Git revision hash.');
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 8960 || options.port > 8969)) throw new Error('--port must be an integer from 8960 through 8969.');
  if (options.serverHeapMiB !== undefined && (!Number.isInteger(options.serverHeapMiB) || options.serverHeapMiB < 512 || options.serverHeapMiB > 4096)) throw new Error('--server-heap-mib must be an integer from 512 through 4096.');
  if (!options.scenarios.length || options.scenarios.some(s => !['cold', 'reload', 'switch-player2', 'switch-player1', 'unlock', 'cold-30mbps', 'panels', 'search', 'note-save', 'personal-filter', 'save-burst'].includes(s))) throw new Error('Unknown scenario.');
  return true;
}
function inside(base, target) {
  const relative = path.relative(base, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function noLinks(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Symlink or junction not allowed in benchmark source.');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlink or junction not allowed in benchmark source.');
    if (entry.isDirectory()) await noLinks(path.join(directory, entry.name));
  }
}
async function safeRemove(target) {
  const resolved = await realpath(target).catch(() => null);
  const base = await realpath(PERF);
  if (!resolved) return;
  if (!inside(base, resolved) || !path.basename(resolved).startsWith('scratch-')) throw new Error('Refusing deletion outside benchmark scratch root.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function scratchCopy(source) {
  const target = await mkdtemp(path.join(PERF, 'scratch-'));
  try {
    const base = await realpath(PERF), resolved = await realpath(target);
    if (!inside(base, resolved) || inside(source, resolved) || inside(resolved, source)) throw new Error('Unsafe scratch copy target.');
    const stateBefore = await readFile(path.join(source, 'state.json'));
    const dataDir = path.join(target, 'duo');
    await cp(source, dataDir, { recursive: true, dereference: false, filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
    // Validate the copy before reading it. Source state changing during copy invalidates this run.
    if (hash(await readFile(path.join(source, 'state.json'))) !== hash(stateBefore)
      || hash(await readFile(path.join(dataDir, 'state.json'))) !== hash(stateBefore)) throw new Error('Source state changed during copy. Retry with a stable snapshot.');
    return { target, dataDir, fingerprint: hash(stateBefore) };
  } catch (error) { await safeRemove(target); throw error; }
}
async function chromeExecutable() {
  const candidates = [options.chrome, process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  for (const candidate of candidates) try { await access(candidate); return path.resolve(candidate); } catch {}
  throw new Error('Chrome executable not found; use --chrome PATH.');
}
async function startServer(dataDir) {
  const start = performance.now();
  const env = { ...process.env, RS3_PERF: '1', RS3_PERF_SCRATCH: dataDir,
    RS3_PERF_PREWARM: options.prewarm, RS3_PERF_SERVER_ENTRY: options.serverEntry, RS3_PERF_APP_ROOT: options.applicationRoot,
    RS3_PERF_PORT: String(options.port ?? 0), RS3_DATA_DIR: dataDir };
  for (const [key, value] of Object.entries({ RS3_MAP_ASSETS_DIR: options.mapAssets, RS3_TERRAIN_ASSETS_DIR: options.terrainAssets,
    RS3_GAME_DATA_DIR: options.gameData, RS3_PACKS_DIR: options.packsDir, RS3_PACK_SELECTION: options.packSelection })) {
    if (value) env[key] = value;
  }
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  const child = fork(path.join(ROOT, 'scripts/perf/server.mjs'), [], { cwd: ROOT, env,
    execArgv: [...process.execArgv, ...(options.serverHeapMiB ? [`--max-old-space-size=${options.serverHeapMiB}`] : []), '--import', new URL('./worker-timeline.mjs', import.meta.url).href],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let stderr = '', stopping = false, memoryTelemetry = null;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
  const exitError = () => new Error(`Scratch server exited unexpectedly (${child.signalCode ?? child.exitCode}).`);
  const assertAlive = () => { if (child.exitCode != null || child.signalCode != null) throw exitError(); };
  child.on('exit', () => {
    if (stopping) return;
    for (const line of safeStderrTail(stderr)) console.error(line);
    console.error(DIAGNOSTIC_PREFIX + JSON.stringify(safeDiagnostic(exitError(), diagnosticContext)));
  });
  child.on('error', () => {});
  const calculations = [];
  child.on('message', message => {
    if (message.type === 'calculation' && message.perfTimeline) calculations.push(message.perfTimeline);
    const sample = sanitizeMemoryTelemetry(message.memoryTelemetry);
    if (sample) memoryTelemetry = sample;
  });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Scratch server startup timed out.')), options.timeout);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Scratch server could not start.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Scratch server exited during startup.')); });
      const onStartup = message => {
        if (message.type === 'calculation' || message.type === 'memory') return;
        clearTimeout(timer); child.off('message', onStartup);
        if (message.type === 'ready') resolve(message);
        else {
          if (message.diagnostic) console.error(DIAGNOSTIC_PREFIX + JSON.stringify(message.diagnostic));
          reject(new Error('Scratch server startup failed.'));
        }
      };
      child.on('message', onStartup);
    });
    const origin = new URL(ready.inviteUrl).origin;
    if (new URL(origin).hostname !== '127.0.0.1' || [8788, 8789, 8790, 8791].includes(Number(new URL(origin).port))) throw new Error('Refusing protected picker address.');
    if (options.port !== undefined && Number(new URL(origin).port) !== options.port) throw new Error('Scratch server did not bind the requested owned port.');
    let requestId = 0, latestMemory = null;
    return { child, assertAlive, origin, inviteUrl: ready.inviteUrl, calculations, dataset: ready.dataset, readyMs: performance.now() - start, initializationMs: ready.readyMs,
      rssReadyBytes: ready.rssBytes, startupTimingMs: ready.startupTimingMs,
      get latestMemory() { return latestMemory; },
      get memoryTelemetry() { return memoryTelemetry; },
      rss: () => new Promise((resolve, reject) => {
        assertAlive();
        const id = ++requestId, timer = setTimeout(() => { child.off('message', onMessage); reject(new Error('RSS probe timed out.')); }, 25000);
        const onMessage = message => { if (message.type === 'rss' && message.id === id) {
          clearTimeout(timer); child.off('message', onMessage);
          latestMemory = Object.fromEntries(['rssBytes', 'workersRssBytes', 'totalRssBytes', 'workerRssSamples', 'workerRssFailures'].map(key => [key, message[key] ?? null]));
          resolve(message.rssBytes);
        } };
        child.on('message', onMessage); child.send({ type: 'rss', id });
      }),
      async close() {
        stopping = true;
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise(resolve => child.once('exit', resolve)); child.send({ type: 'stop' });
          await Promise.race([exited, sleep(15000)]);
        }
        await stopChild(child);
      } };
  } catch (error) {
    stopping = true;
    await stopChild(child);
    error.serverMemoryTelemetry = memoryTelemetry;
    error.serverExit = { code: child.exitCode, signal: child.signalCode };
    throw error;
  }
}
// Follow no redirect: this obtains a scratch session without loading/warming the app.
// Each call joins a separate session through the scratch server's reusable link.
async function scratchSession(server) {
  const response = await fetch(server.inviteUrl, { redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  await response.body?.cancel();
  if (![302, 303].includes(response.status) || !setCookie) throw new Error('Scratch authentication failed.');
  return setCookie.split(';')[0];
}
async function authenticate(browser, server) {
  const pair = await scratchSession(server), split = pair.indexOf('=');
  await browser.send('Network.setCookie', { name: pair.slice(0, split), value: pair.slice(split + 1), url: server.origin,
    path: '/', httpOnly: true, sameSite: 'Lax' });
  await browser.send('Network.clearBrowserCache');
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource });
  // Set the initial checkbox as the parser creates it, before deferred app modules
  // run. Toggling after startup would already have admitted a partner calculation.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: initialViewSource(options.groupView) });
}
const taskMilestoneEvent = () => options.taskMilestone === 'duo' ? 'duo-tasks-shown' : 'tasks-shown';
function longTaskSummary(tasks, from, to) {
  const all = tasks.filter(task => task.startMs >= from && task.startMs < to);
  return { count: all.length, totalMs: all.reduce((sum, task) => sum + task.durationMs, 0), worstMs: Math.max(0, ...all.map(task => task.durationMs)) };
}
const TASK_TIMING_FIELDS = ['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'currentBiSMs', 'activityMs', 'predictionMs', 'deathMs', 'totalMs'];
function taskCalculation(cache) {
  if (!cache || typeof cache !== 'object') return null;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return { hit: typeof cache.hit === 'boolean' ? cache.hit : null,
    unlockPredictionHit: typeof cache.unlockPredictionHit === 'boolean' ? cache.unlockPredictionHit : cache.evaluationMs > 0 ? false : cache.hit === true && cache.evaluationMs === 0 ? true : null,
    evaluationMs: number(cache.evaluationMs), requestMs: number(cache.requestMs),
    timingMs: Object.fromEntries(TASK_TIMING_FIELDS.map(key => [key, number(cache.timingMs?.[key])])) };
}
function metrics(snapshot, from, requests, networkIdleMs, navigation, { member, revision } = {}) {
  const events = snapshot.events.filter(event => event.time >= from);
  const first = name => events.find(event => event.name === name);
  const time = event => event ? Math.max(0, event.time - from) : null;
  const saved = snapshot.probe.saved.find(event => event.time >= from && event.text === 'Saved');
  const eligible = event => (!member || event.memberId === member) && (!revision || event.revision >= revision);
  const tasks = events.find(event => event.name === taskMilestoneEvent() && eligible(event));
  const personalTasks = events.find(event => event.name === 'tasks-shown' && (!tasks || event.memberId === tasks.memberId && event.revision === tasks.revision));
  const taskResponses = (snapshot.probe.taskResponses ?? []).filter(response => response.endMs >= from)
    .map(response => ({ ...response, requestStartMs: Number.isFinite(response.requestStartMs) ? response.requestStartMs - from : null, startMs: response.startMs - from, endMs: response.endMs - from,
      jsonReadParseMs: response.endMs - response.startMs, cache: taskCalculation(response.cache) }));
  const selectedResponse = taskResponses.find(response => response.memberId === (personalTasks?.memberId ?? tasks?.memberId)
    && response.revision === (personalTasks?.revision ?? tasks?.revision));
  const matchingPaint = (name, task) => events.find(event => event.name === name && task
    && event.memberId === task.memberId && event.revision === task.revision && event.time >= task.time);
  const duoTasks = events.find(event => event.name === 'duo-tasks-shown' && eligible(event)
    && (!tasks || event.revision === tasks.revision));
  const terrain = first('terrain-drawn');
  const tiles = events.find(event => event.name === 'visible-tiles-loaded' && event.visible > 0 && !event.failed);
  const measures = { firstPaintMs: navigation ? snapshot.paint.find(p => p.name === 'first-paint')?.time ?? null : null,
    savedMs: time(saved), stateAdoptedMs: time(first('state-adopted')), terrainDrawnMs: time(terrain),
    tasksShownMs: time(tasks), selectedTasksShownMs: time(personalTasks), duoTasksShownMs: time(duoTasks),
    tasksPaintedMs: time(matchingPaint(options.taskMilestone === 'duo' ? 'duo-tasks-painted' : 'tasks-painted', tasks)),
    selectedTasksPaintedMs: time(matchingPaint('tasks-painted', personalTasks)), duoTasksPaintedMs: time(matchingPaint('duo-tasks-painted', duoTasks)),
    visibleTilesLoadedMs: time(tiles), networkIdleMs: networkIdleMs ?? null,
    visibleTiles: tiles?.visible ?? null, failedVisibleTiles: Math.max(0, ...events.filter(e => e.name === 'visible-tiles-loaded').map(e => e.failed ?? 0)) };
  const groups = Object.fromEntries(['appCode', 'dataJson', 'api', 'mapTiles', 'otherAssets'].map(name => [name, { count: 0, transferBytes: 0, decodedBodyBytes: 0, cachedCount: 0, cachedBodyBytes: 0, failedCount: 0 }]));
  const assetClasses = Object.fromEntries(ASSET_CLASSES.map(name => [name, { count: 0, transferBytes: 0, decodedBodyBytes: 0, cachedCount: 0, cachedBodyBytes: 0, failedCount: 0, lastCompletionMs: null }]));
  const endpoints = { state: [], definitions: [], rules: [], tasks: [], mapInfo: [], manifest: [], pins: [] };
  const safeRequests = requests.filter(item => !item.excluded).map(item => {
    const group = groups[item.category]; group.count++; group.transferBytes += item.transferBytes ?? 0;
    item.decodedBodyBytes ??= snapshot.resources.filter(r => r.path === item.route && r.startMs >= from).at(-1)?.decodedBodySize ?? 0;
    group.decodedBodyBytes += item.decodedBodyBytes;
    if (item.cached) { group.cachedCount++; group.cachedBodyBytes += item.encodedBodyBytes ?? 0; }
    if (item.failed || item.status >= 400) group.failedCount++;
    const classified = assetClasses[item.assetClass ?? assetClass(item.route)];
    classified.count++; classified.transferBytes += item.transferBytes ?? 0;
    classified.decodedBodyBytes += item.decodedBodyBytes;
    if (item.cached) { classified.cachedCount++; classified.cachedBodyBytes += item.encodedBodyBytes ?? 0; }
    if (item.failed || item.status >= 400) classified.failedCount++;
    const endpoint = ({ '/api/state': 'state', '/api/definitions': 'definitions', '/api/rules': 'rules', '/api/tasks': 'tasks', '/api/map-info': 'mapInfo', '/assets/map/manifest.json': 'manifest' })[item.route] ?? (/\/pins[^/]*\.json$/.test(item.route) ? 'pins' : null);
    if (endpoint && !item.cancelled && Number.isFinite(item.ttfbMs)) endpoints[endpoint].push(item.ttfbMs);
    const offset = timestamp => Number.isFinite(item.wallStart) && Number.isFinite(snapshot.timeOrigin) && Number.isFinite(timestamp)
      ? item.wallStart * 1000 - snapshot.timeOrigin - from + (timestamp - item.start) * 1000 : null;
    return { path: item.route, category: item.category, assetClass: item.assetClass ?? assetClass(item.route), status: item.status ?? null, ttfbMs: item.ttfbMs ?? null,
      startMs: offset(item.start), responseMs: offset(item.response), endMs: offset(item.end),
      durationMs: item.end ? (item.end - item.start) * 1000 : null, transferBytes: item.transferBytes ?? 0, decodedBodyBytes: item.decodedBodyBytes,
      cached: item.cached, revalidated: !!item.revalidated, failed: !!item.failed, cancelled: !!item.cancelled };
  });
  // PerformanceResourceTiming supplies body size for memory cache entries without Content-Length.
  for (const route of new Set(requests.filter(r => r.cached && !r.encodedBodyBytes).map(r => r.route))) {
    const bodySize = Math.max(0, ...snapshot.resources.filter(r => r.path === route).map(r => r.encodedBodySize));
    groups[category(route)].cachedBodyBytes += bodySize * requests.filter(r => r.route === route && r.cached && !r.encodedBodyBytes).length;
    assetClasses[assetClass(route)].cachedBodyBytes += bodySize * requests.filter(r => r.route === route && r.cached && !r.encodedBodyBytes).length;
  }
  const phases = [from, saved?.time, terrain?.time, tasks?.time, tiles?.time, snapshot.now].filter(Number.isFinite).sort((a, b) => a - b);
  const longTasks = longTaskSummary(snapshot.probe.longTasks, from, snapshot.now);
  longTasks.entries = snapshot.probe.longTasks.filter(task => task.startMs >= from && task.startMs < snapshot.now)
    .map(task => ({ startMs: task.startMs - from, durationMs: task.durationMs }));
  longTasks.phases = phases.slice(1).map((end, index) => ({ fromMs: phases[index] - from, toMs: end - from,
    endsAt: end === saved?.time ? 'saved' : end === terrain?.time ? 'terrain-drawn' : end === tasks?.time ? taskMilestoneEvent() : end === tiles?.time ? 'visible-tiles-loaded' : 'settled',
    ...longTaskSummary(snapshot.probe.longTasks, phases[index], end) }));
  const terrainRequests = safeRequests.filter(r => r.assetClass === 'terrain');
  for (const name of ASSET_CLASSES) {
    const completionTimes = safeRequests.filter(r => r.assetClass === name && !r.cancelled && !r.failed).map(r => r.endMs).filter(Number.isFinite);
    assetClasses[name].lastCompletionMs = completionTimes.length ? Math.max(...completionTimes) : null;
  }
  const nativeRequests = terrainRequests.filter(r => /\/0_\d+_\d+\.(?:png|webp)$/.test(r.path));
  const viewport = snapshot.terrainViewport;
  const visiblePaths = viewport ? new Set([...viewport.nativePaths, ...viewport.overviewPaths].map(p => `/assets/map/${p}`)) : null;
  const requestedVisible = visiblePaths ? terrainRequests.filter(r => visiblePaths.has(r.path)) : null;
  const selectedNativePaths = viewport ? new Set(viewport.selectedNativePaths.map(p => `/assets/map/${p}`)) : null;
  return { milestones: measures, taskMilestoneEvent: taskMilestoneEvent(), taskIdentity: tasks ? { memberId: personalTasks?.memberId ?? tasks.memberId, revision: tasks.revision } : null, taskResponses,
    taskCalculation: selectedResponse?.cache ?? taskCalculation(tasks?.cache ?? personalTasks?.cache), terrainDiagnostics: {
    requestCount: terrainRequests.length, nativeRequestCount: nativeRequests.length,
    committedVisibleCount: measures.visibleTiles,
    viewport: viewport ?? null,
    requestedVisibleCount: requestedVisible?.length ?? null,
    requestedOutsideFinalViewportCount: requestedVisible ? terrainRequests.length - requestedVisible.length : null,
    requestedSelectedNativeCount: selectedNativePaths ? nativeRequests.filter(r => selectedNativePaths.has(r.path)).length : null,
    requestedNativeOutsideFinalDemandCount: selectedNativePaths ? nativeRequests.filter(r => !selectedNativePaths.has(r.path)).length : null,
    requestMinusCommittedVisible: Number.isFinite(measures.visibleTiles) ? nativeRequests.length - measures.visibleTiles : null,
    firstRequestMs: terrainRequests.length ? Math.min(...terrainRequests.map(r => r.startMs).filter(Number.isFinite)) : null,
    lastResponseMs: terrainRequests.length ? Math.max(...terrainRequests.map(r => r.endMs).filter(Number.isFinite)) : null,
    note: 'Native request-minus-visible is a coverage diagnostic, not an exact offscreen count: fallback retries and viewport movement can request multiple sources.'
  }, network: { groups, assetClasses, endpointTtfbMs: endpoints, requests: safeRequests,
    totals: Object.values(groups).reduce((sum, g) => ({ count: sum.count + g.count, transferBytes: sum.transferBytes + g.transferBytes, decodedBodyBytes: sum.decodedBodyBytes + g.decodedBodyBytes, cachedCount: sum.cachedCount + g.cachedCount, cachedBodyBytes: sum.cachedBodyBytes + g.cachedBodyBytes }), { count: 0, transferBytes: 0, decodedBodyBytes: 0, cachedCount: 0, cachedBodyBytes: 0 }) }, longTasks };
}
function loadedViewport(snapshot) {
  const lastTerrain = snapshot.events.findLast(event => event.name === 'terrain-drawn');
  const lastTiles = snapshot.events.findLast(event => event.name === 'visible-tiles-loaded');
  return lastTiles?.visible > 0 && !lastTiles.failed && (!lastTerrain || lastTiles.time >= lastTerrain.time) ? lastTiles : null;
}
async function measure(browser, name, action, { navigation = false, revision, member, reuseTerrain = false, settlement = options.settlement, calculations = [], settle } = {}) {
  diagnosticContext = { stage: 'measure', scenario: name };
  console.log(`  Measuring ${name}...`);
  const network = networkCollector(browser), wallStart = performance.now();
  let from = navigation ? 0 : await browser.evaluate('performance.now()');
  let snapshot, idleAt, previousTimeOrigin;
  let profileActive = false;
  const selectedProfile = options.cpuProfile === 'on' && options.scenarios.includes(name);
  const finishProfile = async () => {
    if (!profileActive) return null;
    profileActive = false;
    const { profile } = await browser.send('Profiler.stop');
    const safeURL = url => {
      if (!url) return '';
      try { return new URL(url).pathname; } catch { return ''; }
    };
    const sanitized = { ...profile, nodes: profile.nodes.map(node => ({ ...node,
      callFrame: { ...node.callFrame, url: safeURL(node.callFrame.url) } })) };
    options.cpuProfileSequence = (options.cpuProfileSequence ?? 0) + 1;
    const filename = path.join(PERF, `${options.label}-${options.captureStamp}-cpu-${options.cpuProfileSequence}-${name}.json`);
    await writeFile(filename, JSON.stringify(sanitized) + '\n');
    return filename;
  };
  try {
    previousTimeOrigin = await browser.evaluate('performance.timeOrigin');
    if (selectedProfile) {
      await browser.send('Profiler.enable'); await browser.send('Profiler.start'); profileActive = true;
    }
    const clickedAt = await action();
    if (!navigation && Number.isFinite(clickedAt)) from = clickedAt;
    await until(async () => {
      try { snapshot = await browser.evaluate(snapshotExpression); }
      catch (error) {
        // CDP can acknowledge reload before replacing the execution context.
        if (navigation && error.message === 'CDP Runtime.evaluate failed.') return false;
        throw error;
      }
      if (navigation && (!Number.isFinite(snapshot.timeOrigin) || snapshot.timeOrigin === previousTimeOrigin)) return false;
      if (!navigation && snapshot.timeOrigin !== previousTimeOrigin) throw new Error('Scratch document changed during interaction.');
      if (snapshot.taskError) throw new Error(`Task status failed in ${name}.`);
      if (settle) {
        // Remote catch-up need not repaint tasks or move the map; the scenario says when it is done.
        const ready = settle(snapshot, from, network), idle = network.idle();
        if (idle && ready) idleAt ??= snapshot.now - from;
        return ready && (idle || settlement === 'tasks');
      }
      const freshTask = snapshot.events.some(event => event.name === taskMilestoneEvent() && event.time >= from && (!member || event.memberId === member) && (!revision || event.revision >= revision));
      const painted = snapshot.events.some(event => event.name === (options.taskMilestone === 'duo' ? 'duo-tasks-painted' : 'tasks-painted') && event.time >= from && (!member || event.memberId === member) && (!revision || event.revision >= revision));
      const ready = snapshot.tasksReady && freshTask && painted && (!revision || snapshot.savedRevision >= revision) && (!member || snapshot.member === member);
      const idle = network.idle({ navigation });
      if (idle && ready) idleAt ??= snapshot.now - from;
      if (ready && (idle || settlement === 'tasks')) {
        // Settled frames include composition/decode after the final request.
        return snapshot.events.some(event => event.name === 'visible-tiles-loaded' && event.time >= from && event.visible > 0) || reuseTerrain && loadedViewport(snapshot);
      }
      return false;
    }, options.timeout, 60);
    const groupView = await browser.evaluate("document.getElementById('group-view')?.checked");
    if (groupView !== (options.groupView === 'on')) throw new Error(`Unexpected group view in ${name}; refusing a mismatched benchmark.`);
    const measured = metrics(snapshot, from, navigation ? network.navigationRequests() : [...network.requests.values()], idleAt, navigation, { member, revision });
    measured.serverCalculations = calculations.filter(row => row.startedEpochMs >= snapshot.timeOrigin + from && row.doneEpochMs <= snapshot.timeOrigin + snapshot.now)
      .map(row => ({ memberId: row.memberId, revision: row.revision,
        startedMs: row.startedEpochMs - snapshot.timeOrigin - from, doneMs: row.doneEpochMs - snapshot.timeOrigin - from }));
    measured.groupView = groupView;
    measured.settlement = settlement;
    measured.pendingRequestsAtSettlement = [...network.requests.values()].filter(request => !request.excluded && request.end === undefined).length;
    if (selectedProfile) measured.cpuProfile = await finishProfile();
    if (reuseTerrain && measured.milestones.visibleTilesLoadedMs === null && loadedViewport(snapshot)) {
      measured.milestones.visibleTilesLoadedMs = 0;
      measured.milestones.visibleTiles = loadedViewport(snapshot).visible;
      measured.terrainAlreadyLoaded = true;
    }
    measured.name = name; measured.wallMs = performance.now() - wallStart;
    measured.advisoryRequests = measured.network.requests.filter(r => ['/api/death-estimates', '/api/predict'].includes(r.path))
      .map(r => ({ path: r.path, durationMs: r.durationMs, cancelled: r.cancelled }));
    measured.advisoryMaxMs = Math.max(0, ...measured.advisoryRequests.map(r => r.durationMs ?? 0));
    // A save that lands while an advisory (or, in a burst, a task read) is
    // computing answers it 409 "saved map changed" by design; the client asks
    // again. Count those rather than refuse the run, so a candidate that
    // supersedes more work still shows it.
    const superseded = r => r.status === 409 && (['/api/death-estimates', '/api/predict', '/api/chunk-planning'].includes(r.path)
      || name === 'save-burst' && r.path === '/api/tasks');
    measured.supersededRequests = measured.network.requests.filter(superseded).length;
    const failures = measured.network.requests.filter(r => (r.failed || r.status >= 400) && !superseded(r))
      .map(r => ({ path: r.path, status: r.status, failed: !!r.failed }));
    if (measured.milestones.failedVisibleTiles || failures.length) {
      await writeFile(path.join(PERF, `${options.label}-failed.json`), JSON.stringify({ scenario: name,
        milestones: measured.milestones, failures }, null, 2) + '\n');
      throw new Error(`Asset/API failure in ${name}: ${failures.map(r => `${r.path} (${r.status ?? 'no status'})`).join(', ') || 'visible tiles'}; refusing a misleading benchmark.`);
    }
    console.log(`  ${name}: tasks ${number(measured.milestones.tasksShownMs)} ms, visible tiles ${number(measured.milestones.visibleTilesLoadedMs)} ms, idle ${number(measured.milestones.networkIdleMs)} ms, advisory ${number(measured.advisoryMaxMs)} ms, ${measured.network.totals.count} requests`);
    return measured;
  } catch (error) {
    // Retain scalar evidence even when the renderer stops answering snapshots.
    // No browser error text, response bodies, headers or query strings are saved.
    error.partialMeasurement = { name, groupView: options.groupView, taskMilestoneEvent: taskMilestoneEvent(),
      settlement, wallMs: performance.now() - wallStart,
      lastSnapshot: snapshot ? { nowMs: snapshot.now - from, member: snapshot.member, savedRevision: snapshot.savedRevision,
        tasksReady: snapshot.tasksReady, taskError: snapshot.taskError,
        milestones: snapshot.events.filter(event => event.time >= from && ['state-adopted', 'tasks-shown', 'duo-tasks-shown', 'visible-tiles-loaded'].includes(event.name))
          .map(event => ({ name: event.name, timeMs: event.time - from, memberId: event.memberId ?? null,
            revision: event.revision ?? null, visible: event.visible ?? null, failed: event.failed ?? null })) } : null,
      requests: [...network.requests.values()].filter(request => !request.excluded).map(request => ({
        path: request.route, status: request.status ?? null, pending: request.end === undefined,
        ttfbMs: request.ttfbMs ?? null, durationMs: request.end === undefined ? null : (request.end - request.start) * 1000,
        transferBytes: request.transferBytes ?? 0, decodedBodyBytes: request.decodedBodyBytes ?? 0,
        failed: !!request.failed, cancelled: !!request.cancelled })) };
    if (profileActive) error.partialMeasurement.cpuProfile = await finishProfile().catch(() => null);
    throw error;
  } finally { network.close(); }
}
async function switchMember(browser, member) {
  await browser.evaluate(`(() => {const s=document.getElementById('member');s.value=${JSON.stringify(member)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function prepareUnlockUI(browser, chunk) {
  const network = networkCollector(browser), started = await browser.evaluate('performance.now()');
  try {
  await browser.evaluate(`(() => {const b=document.getElementById('search-open');if(!b)throw Error('Search missing');b.click();})()`);
  await until(() => browser.evaluate(`!!document.querySelector('#tool-dialog input[type="search"]')`));
  await browser.evaluate(`(() => {const s=document.querySelector('#tool-dialog input[type="search"]');s.value=${JSON.stringify(chunk)};s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(() => browser.evaluate(`(() => {const r=[...document.querySelectorAll('#tool-dialog .search-result')].find(r=>r.querySelector('span')?.textContent.startsWith(${JSON.stringify(chunk + ' ·')}));if(!r)return false;r.querySelector('button').click();return true;})()`));
  await until(() => browser.evaluate(`!![...document.querySelectorAll('#chunk-info button')].find(b=>b.textContent==='Unlock')`));
  const dwellStarted = performance.now();
  if (options.unlockDwellMs) await sleep(options.unlockDwellMs);
  const dwellElapsedMs = options.unlockDwellMs ? performance.now() - dwellStarted : 0;
  if (options.unlockPreview === 'on' || options.unlockPick === 'prepared') {
    await browser.evaluate(`(() => {const b=[...document.querySelectorAll('#chunk-info button')].find(b=>b.textContent==='Preview');if(!b)throw Error('Preview missing');b.click();})()`);
    await until(() => browser.evaluate(`!!document.querySelector('#chunk-info .unlock-count')`), options.timeout, 60);
  }
  await until(async () => {
    const snapshot = await browser.evaluate(snapshotExpression);
    const viewport = loadedViewport(snapshot);
    return (options.settlement === 'tasks' || network.idle()) && viewport && viewport.time >= started;
  }, options.timeout, 60);
  return { dwellRequestedMs: options.unlockDwellMs, dwellElapsedMs, pendingRequestPaths: [...network.requests.values()].filter(request => !request.excluded && request.end === undefined).map(request => request.route) };
  } finally { network.close(); }
}
// Fixed synthetic text. The scratch save's own notes are never read back,
// printed or recorded; the chosen chunk ID stays in this process only.
const SYNTHETIC_NOTE = 'Benchmark synthetic note';
const noteEditorReady = value => `(() => {const e=document.querySelector('#chunk-content .chunk-own-note'),t=e?.querySelector('textarea');
  return !document.getElementById('chunk-info').hidden&&!!t&&!t.readOnly&&t.value===${JSON.stringify(value)}&&[...e.querySelectorAll('button')].some(b=>b.textContent==='Save chunk note'&&!b.disabled);})()`;
async function settleNoteUI(browser, started, value) {
  const network = networkCollector(browser);
  try {
    await until(async () => {
      if (!await browser.evaluate(noteEditorReady(value))) return false;
      const viewport = loadedViewport(await browser.evaluate(snapshotExpression));
      return (options.settlement === 'tasks' || network.idle()) && viewport && viewport.time >= started;
    }, options.timeout, 60);
  } finally { network.close(); }
}
async function prepareNoteUI(browser, chunk) {
  const started = await browser.evaluate('performance.now()');
  // Close earlier panels first so a stale chunk's Note tab cannot be used.
  await browser.evaluate(`(() => {if(document.getElementById('tool-dialog')?.open)document.querySelector('#tool-dialog .dialog-header button')?.click();
    if(!document.getElementById('chunk-info').hidden)document.getElementById('chunk-close')?.click();
    const b=document.getElementById('search-open');if(!b)throw Error('Search missing');b.click();})()`);
  await until(() => browser.evaluate(`!!document.querySelector('#tool-dialog input[type="search"]')&&document.getElementById('chunk-info').hidden`));
  await browser.evaluate(`(() => {const s=document.querySelector('#tool-dialog input[type="search"]');s.value=${JSON.stringify(chunk)};s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(() => browser.evaluate(`(() => {const r=[...document.querySelectorAll('#tool-dialog .search-result')].find(r=>r.querySelector('span')?.textContent.startsWith(${JSON.stringify(chunk + ' ·')}));if(!r)return false;r.querySelector('button').click();return true;})()`));
  await until(() => browser.evaluate(`(() => {const t=document.querySelector('#chunk-content [data-tab="note"]');if(document.getElementById('chunk-info').hidden||!t)return false;t.click();return true;})()`));
  await settleNoteUI(browser, started, '');
}
// Chunk Info calculator reads seen since the panel opened, by count and status only.
const panelReads = network => Object.fromEntries(['/api/chunk-planning', '/api/death-estimates'].map(route => {
  const rows = [...network.requests.values()].filter(row => row.route === route);
  return [route.slice(5), { pending: rows.filter(row => row.end === undefined).length, ok: rows.filter(row => row.status === 200).length,
    superseded: rows.filter(row => row.status === 409).length }];
}));
async function measureNoteEdit(browser, server, name, text, member) {
  const before = await browser.evaluate(snapshotExpression);
  // Edit and click in one synchronous evaluation: a task-driven chunk panel
  // re-render cannot replace the editor between typing and Save.
  const result = await measure(browser, name, () => browser.evaluate(`(() => {const e=document.querySelector('#chunk-content .chunk-own-note'),t=e?.querySelector('textarea'),b=e&&[...e.querySelectorAll('button')].find(b=>b.textContent==='Save chunk note');
    if(!t||!b||b.disabled)throw Error('Note editor missing');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));const at=performance.now();b.click();return at;})()`),
  { revision: before.savedRevision + 1, member, reuseTerrain: true, calculations: server.calculations, settle: (snapshot, from, network) => {
    const revision = before.savedRevision + 1;
    if (!snapshot.tasksReady || snapshot.savedRevision < revision || snapshot.member !== member || !loadedViewport(snapshot)) return false;
    if ([...network.requests.values()].some(row => !row.excluded && row.route === '/api/tasks')) {
      return snapshot.events.some(event => event.name === (options.taskMilestone === 'duo' ? 'duo-tasks-painted' : 'tasks-painted')
        && event.time >= from && event.memberId === member && event.revision >= revision);
    }
    // A page that keeps its unchanged list fetches no tasks: done once adoption stays quiet.
    const adopted = snapshot.events.find(event => event.name === 'state-adopted' && event.time >= from && event.revision >= revision);
    return !!adopted && snapshot.now - adopted.time >= 750;
  } });
  // When the list is current: its repaint, or adoption when the page kept the unchanged list.
  const fetchedTasks = result.network.requests.some(row => row.path === '/api/tasks');
  result.milestones.tasksCurrentMs = result.milestones.tasksPaintedMs ?? (fetchedTasks ? null : result.milestones.stateAdoptedMs ?? null);
  result.note = { edit: text ? 'save' : 'clear', syntheticLength: text.length };
  return result;
}
// A duo partner's quick edits, sent from a second scratch session outside Chrome:
// the measured page hears of them only through its own live channel. Sequential
// and each on the revision the last one produced, as one hurried client would.
async function saveBurst(server, cookie, { member, chunk, revision }) {
  for (let index = 0; index < SAVE_BURST_COMMANDS; index++) {
    const response = await fetch(`${server.origin}/api/command?view=play-v1`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: server.origin },
      body: JSON.stringify({ expectedRevision: revision + index,
        command: { type: 'set-note', memberId: member, chunkId: chunk, note: index % 2 ? '' : SYNTHETIC_NOTE } }) });
    const value = await response.json().catch(() => null);
    // Command number and status only: a refusal body can quote the save.
    if (!response.ok || value?.state?.revision !== revision + index + 1) throw new Error(`Save burst command ${index + 1} failed (${response.status}).`);
  }
}
async function measureSaveBurst(browser, server, target, member) {
  const final = target.revision + SAVE_BURST_COMMANDS, cookie = await scratchSession(server);
  const sync = request => !request.excluded && ['/api/state', '/api/tasks'].includes(request.route);
  let lastCommittedMs, caughtUpMs = null;
  const result = await measure(browser, 'save-burst', async () => {
    // Page clock read just before the first send; the CDP round trip bounds the offset.
    const at = await browser.evaluate('performance.now()'), started = performance.now();
    await saveBurst(server, cookie, target);
    lastCommittedMs = performance.now() - started;
    return at;
  }, { member, revision: final, reuseTerrain: true, calculations: server.calculations, settle: (snapshot, from, network) => {
    // First badge confirmation at the final revision; an old client may confirm
    // each step, a draining one may skip straight there.
    const caughtUp = snapshot.probe.saved.find(event => event.time >= from && event.revision >= final);
    if (caughtUp) caughtUpMs ??= caughtUp.time - from;
    const rows = [...network.requests.values()].filter(sync);
    // Catch-up reads quiet for 750 ms, so a trailing task fetch and paint at the
    // final revision lands in the window. Notes move no map: no tile mark is required.
    return caughtUpMs !== null && snapshot.savedRevision >= final && snapshot.tasksReady && rows.every(row => row.end !== undefined)
      && performance.now() - Math.max(0, ...rows.map(row => row.changedAt)) >= 750 && snapshot.now - from - caughtUpMs >= 750;
  } });
  Object.assign(result.milestones, { lastCommittedMs, caughtUpMs });
  return result;
}
async function captureViews(browser, run, throttled) {
  if (options.screenshots === 'off') return [];
  const directory = path.join(PERF, `${options.label}-screenshots-${options.captureStamp}`);
  await mkdir(directory, { recursive: true });
  const captures = [];
  // Obtain the live map through its cached class, only after measured scenarios.
  // A zero wheel event reveals the receiver without changing the viewport.
  await browser.evaluate(`import('/map.mjs').then(({ChunkMap})=>{window.__perfCaptureZoomAt=ChunkMap.prototype.zoomAt;ChunkMap.prototype.zoomAt=function(...args){window.__perfCaptureMap=this;return window.__perfCaptureZoomAt.apply(this,args);};})`);
  const position = await browser.evaluate(`(() => {const r=document.getElementById('map-hover').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await browser.evaluate(`document.getElementById('map-hover').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:0,clientX:${position.x},clientY:${position.y}}))`);
  const defaultZoom = await browser.evaluate(`import('/map.mjs').then(({ChunkMap})=>{ChunkMap.prototype.zoomAt=window.__perfCaptureZoomAt;delete window.__perfCaptureZoomAt;return window.__perfCaptureMap.zoom;})`);
  const capture = async zoom => {
    const filename = path.join(directory, `run-${run}-${throttled ? 'cold-30mbps' : 'normal'}-${zoom}.png`);
    const result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(filename, Buffer.from(result.data, 'base64'));
    const viewport = await browser.evaluate(`(()=>{const m=window.__perfCaptureMap;return {width:innerWidth,height:innerHeight,zoom:m.zoom,dpr:m.dpr,deviceDpr:devicePixelRatio,bounds:m.visibleBounds()};})()`);
    captures.push({ zoom, viewport, path: path.relative(ROOT, filename).split(path.sep).join('/') });
  };
  const originalTheme = await browser.evaluate("document.documentElement.dataset.theme ?? 'dark'");
  if (options.screenshots === 'responsive') {
    await browser.evaluate("import('/map-tools.mjs').then(({applyTheme})=>applyTheme(document.documentElement,'gray'))");
  }
  await capture(options.screenshots === 'responsive' ? 'desktop-gray' : 'default');
  const network = networkCollector(browser), started = await browser.evaluate('performance.now()');
  try {
    if (options.screenshots === 'responsive') {
      await browser.evaluate("import('/map-tools.mjs').then(({applyTheme})=>applyTheme(document.documentElement,'light'))");
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate('window.__perfCaptureMap.resize()');
      await until(async () => {
        const viewport = loadedViewport(await browser.evaluate(snapshotExpression));
        return network.idle() && viewport && viewport.time >= started;
      }, options.timeout, 60);
      await capture('mobile-390px-light');
      return captures;
    }
    for (let step = 0; step < 10; step++) {
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...position, deltaX: 0, deltaY: -500 });
      await sleep(30);
    }
    await until(async () => {
      const snapshot = await browser.evaluate(snapshotExpression), viewport = loadedViewport(snapshot);
      return network.idle() && viewport && viewport.time >= started;
    }, options.timeout, 60);
    await capture('max-zoom');
    const settle = async action => {
      const started = await browser.evaluate('performance.now()');
      await action();
      await until(async () => {
        const viewport = loadedViewport(await browser.evaluate(snapshotExpression));
        return network.idle() && viewport && viewport.time >= started;
      }, options.timeout, 60);
    };
    await settle(() => browser.evaluate(`window.__perfCaptureMap.zoomBy(.65/window.__perfCaptureMap.zoom)`));
    await capture('intermediate-0_65');
    await settle(() => browser.evaluate(`window.__perfCaptureMap.zoomBy(${defaultZoom}/window.__perfCaptureMap.zoom)`));
    await settle(async () => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      await browser.evaluate('window.__perfCaptureMap.resize()');
    });
    await capture('default-dpr2');
    await settle(async () => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate('window.__perfCaptureMap.resize()');
    });
    await capture('mobile-390px');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('window.__perfCaptureMap.resize()');
  } finally {
    network.close();
    if (options.screenshots === 'responsive') {
      await browser.evaluate(`import('/map-tools.mjs').then(({applyTheme})=>applyTheme(document.documentElement,${JSON.stringify(originalTheme)}))`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate('window.__perfCaptureMap.resize();delete window.__perfCaptureMap');
  }
  return captures;
}

async function workerResidency(browser) {
  // Read-only diagnostics do not dispatch calculations or wake a suspended lane.
  // Copy individual scalars rather than retaining arbitrary diagnostic payloads.
  return browser.evaluate(`fetch('/api/diagnostics',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Diagnostics unavailable');return r.json();}).then(d=>{
    const numeric=(object,keys)=>Object.fromEntries(keys.map(key=>[key,typeof object?.[key]==='number'&&Number.isFinite(object[key])&&object[key]>=0?object[key]:null]));
    const lane=value=>({worker:{status:typeof value?.worker?.status==='string'?value.worker.status:null,
      ready:typeof value?.worker?.ready==='boolean'?value.worker.ready:null,
      resident:typeof value?.worker?.resident==='boolean'?value.worker.resident:null,
      ...numeric(value?.worker,['idleMs','idleStops','restarts','failures','compileMs'])},
      queue:numeric(value?.queue,['depth','active','limit','deadlineMs']),
      cache:numeric(value?.cache,['entries','bytes','limit','byteLimit']),
      prewarm:numeric(value?.prewarm,['pending','active','queued','completed','cancelled','skipped'])});
    const lanes={foreground:lane(d),death:lane(d.deathLane),prediction:lane(d.predictionLane),duo:lane(d.duoLane)};
    const observedQuiescent=Object.values(lanes).every(l=>(l.queue.depth??0)===0&&(l.queue.active??0)===0&&(l.prewarm.pending??0)===0&&(l.prewarm.active??0)===0);
    return {lanes,observedQuiescent,unlockReuse:d.unlockReuse?numeric(d.unlockReuse,['entries','bytes','rawBytes','compressedBytes','limit','byteLimit','hits','admitted','skipped']):null};
  })`);
}

async function sampleIdle(browser, server, normal) {
  if (!options.idleSampleMs) return null;
  const started = performance.now();
  console.log(`  Sampling worker residency after ${options.idleSampleMs} ms without interaction...`);
  await sleep(options.idleSampleMs);
  const idle = { elapsedMs: performance.now() - started, rssBytes: await server.rss(), diagnostics: await workerResidency(browser) };
  // This diagnostic ends at tasks/tiles rather than extending through advisory
  // requests; its result never enters ordinary scenario medians or network totals.
  const member = await browser.evaluate("document.getElementById('member').value");
  const wake = await measure(browser, 'reload-after-idle', () => browser.send('Page.reload', { ignoreCache: false }),
    { navigation: true, member, settlement: 'tasks' });
  const afterWake = { rssBytes: await server.rss(), diagnostics: await workerResidency(browser) };
  return { requestedMs: options.idleSampleMs, normal, idle, wake, afterWake,
    note: 'Fixed observation interval without forced GC or cancellation. observedQuiescent records queue/prewarm state, not continuous inactivity. Reload retains HTTP cache; server result caches follow observed worker residency. It settles at tasks/tiles and is not a cold first visit.' };
}
async function checkCancellation(browser) {
  if (options.cancellationCheck !== 'on') return null;
  await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 30 * 125000, uploadThroughput: 30 * 125000 });
  const rect = await browser.evaluate(`(() => {const r=document.getElementById('map-hover').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()`);
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  for (let step = 0; step < 10; step++) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: -500 });
    await sleep(30);
  }
  // Start from a fully committed native viewport, then demand adjacent regions.
  const settle = networkCollector(browser);
  try { await until(async () => settle.idle() && !!loadedViewport(await browser.evaluate(snapshotExpression)), options.timeout, 20); }
  finally { settle.close(); }
  const network = networkCollector(browser);
  const drag = async (from, to) => {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
  };
  let pendingNativeBeforeReturn = 0;
  try {
    const from = { x: rect.left + rect.width * .18, y: center.y }, to = { x: rect.left + rect.width * .88, y: center.y };
    await drag(from, to);
    await until(() => {
      pendingNativeBeforeReturn = [...network.requests.values()].filter(r => r.assetClass === 'terrain' && /\/0_\d+_\d+\.(?:png|webp)$/.test(r.route) && r.end === undefined).length;
      return pendingNativeBeforeReturn > 0;
    }, 2000, 5).catch(() => {});
    await sleep(20);
    await drag(to, from);
    for (let step = 0; step < 10; step++) {
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: 500 });
      await sleep(20);
    }
    await until(async () => network.idle() && !!loadedViewport(await browser.evaluate(snapshotExpression)), options.timeout, 20);
    const native = [...network.requests.values()].filter(r => r.assetClass === 'terrain' && /\/0_\d+_\d+\.(?:png|webp)$/.test(r.route));
    const result = { throttle: { mbps: 30, latencyMs: 40 }, returnDelayMs: 20, pendingNativeBeforeReturn,
      nativeRequests: native.length, cancelledNativeRequests: native.filter(r => r.cancelled).length,
      failedNativeRequests: native.filter(r => r.failed).length,
      note: 'Runs after measured scenarios and screenshots; canceled=true is observed from Chrome Network.loadingFailed.' };
    console.log(`  Post-measurement cancellation: ${result.cancelledNativeRequests}/${result.nativeRequests} native requests canceled, ${result.pendingNativeBeforeReturn} pending before return.`);
    return result;
  } finally { network.close(); }
}
async function suite(executable, run, throttled) {
  diagnosticContext = { stage: 'copy' };
  const scratch = await scratchCopy(options.source);
  let server, browser, version, prerequisiteCold;
  const results = [];
  const oomCount = async () => {
    if (process.platform !== 'linux') return null;
    try { const match = (await readFile('/proc/vmstat', 'utf8')).match(/^oom_kill (\d+)$/m); return match ? Number(match[1]) : null; } catch { return null; }
  };
  const oomBefore = await oomCount();
  try {
    diagnosticContext = { stage: 'server-start' };
    server = await startServer(scratch.dataDir);
    diagnosticContext = { stage: 'chrome-start' };
    browser = await openChrome(executable, path.join(scratch.target, 'chrome'), { extraArgs: chromeExtraArgs });
    const evaluate = browser.evaluate.bind(browser);
    browser.evaluate = (...args) => { server.assertAlive(); return evaluate(...args); };
    diagnosticContext = { stage: 'authenticate' };
    await authenticate(browser, server);
    if (throttled) await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 30 * 125000, uploadThroughput: 30 * 125000 });
    version = await browser.send('Browser.getVersion');
    const coldName = throttled ? 'cold-30mbps' : 'cold';
    // Necessary initial load runs even when only an interaction was selected.
    const cold = await measure(browser, coldName, () => browser.send('Page.navigate', { url: `${server.origin}/` }), { navigation: true, member: 'player1' });
    prerequisiteCold = cold;
    if (options.scenarios.includes(coldName)) results.push(cold);
    if (!throttled) {
      if (options.scenarios.includes('reload')) results.push(await measure(browser, 'reload', () => browser.send('Page.reload', { ignoreCache: false }), { navigation: true, member: 'player1' }));
      for (const [name, member] of [['switch-player2', 'player2'], ['switch-player1', 'player1']]) {
        if (options.scenarios.includes(name)) results.push(await measure(browser, name, () => switchMember(browser, member), { member }));
        else if (name === 'switch-player1' && await browser.evaluate(`document.getElementById('member').value`) !== 'player1') await measure(browser, name, () => switchMember(browser, member), { member });
      }
      if (options.scenarios.includes('unlock')) {
        diagnosticContext = { stage: 'prepare-unlock', scenario: 'unlock' };
        const member = options.unlockMember;
        if (await browser.evaluate(`document.getElementById('member').value`) !== member) {
          await measure(browser, `prepare-${member}`, () => switchMember(browser, member), { member });
        }
        // Request only the scalar candidate from the hydrated scratch API state.
        // Diagnostics expose counts, not completed chunk IDs. An unprepared pick
        // stays outside ALL candidates this member's prewarmer can enqueue.
        const chunk = await browser.evaluate(`fetch('/api/state',{cache:'no-store'}).then(r=>r.json()).then(async({state,pools})=>{
          const owner=state.members.find(m=>m.id===${JSON.stringify(member)});
          const locked=id=>/^\\d+$/.test(id)&&!owner.unlocked.includes(id)&&!owner.pendingRoll.includes(id);
          const explicit=${JSON.stringify(options.unlockChunk ?? null)};
          if(explicit){
            const world=await fetch('/api/display-world').then(r=>r.json());
            if(!locked(explicit)||!world.surface.map(String).includes(explicit))throw Error('Explicit unlock chunk is not a locked surface chunk');
            const warm=new Set([...owner.selected,...owner.pendingRoll,...(pools[owner.id]?.eligible??[]).map(c=>c.id)]);
            if(${JSON.stringify(options.unlockPick)}==='unprepared'&&warm.has(explicit))throw Error('Explicit unprepared chunk is in the warm pool');
            return explicit;
          }
          if(${JSON.stringify(options.unlockPick)}!=='unprepared')return owner.selected.find(locked)??pools[owner.id]?.eligible?.find(c=>locked(c.id))?.id??null;
          const warm=new Set([...owner.selected,...owner.pendingRoll,...(pools[owner.id]?.eligible??[]).map(c=>c.id)]);
          const world=await fetch('/api/display-world').then(r=>r.json());
          return world.surface.map(String).filter(id=>locked(id)&&!warm.has(id)).sort((a,b)=>Number(a)-Number(b))[0]??null;
        })`);
        if (!chunk) throw new Error(`No locked ${member} chunk available for scratch unlock (${options.unlockPick}).`);
        const preparation = await prepareUnlockUI(browser, chunk);
        const before = await browser.evaluate(snapshotExpression);
        const beforeDiagnostics = await workerResidency(browser);
        const unlocked = await measure(browser, 'unlock', () => browser.evaluate(`(() => {const at=performance.now();[...document.querySelectorAll('#chunk-info button')].find(b=>b.textContent==='Unlock').click();return at;})()`), { revision: before.savedRevision + 1, member, reuseTerrain: true, calculations: server.calculations });
        unlocked.unlock = { member, chunkId: chunk, pick: options.unlockPick,
          dwellMs: options.unlockDwellMs, preview: options.unlockPreview === 'on' || options.unlockPick === 'prepared', preparation, beforeDiagnostics,
          afterDiagnostics: await workerResidency(browser) };
        results.push(unlocked);
        if (options.unlockPick === 'unprepared' && unlocked.taskCalculation?.unlockPredictionHit !== false) throw new Error('Unprepared unlock did not record a prediction miss; retained as partial evidence.');
        if (options.unlockPick === 'prepared' && unlocked.taskCalculation?.unlockPredictionHit !== true) throw new Error('Prepared unlock did not record a prediction hit; retained as partial evidence.');
      }
      results.push(...await measureBrowserInteractions(browser, { timeout: options.timeout, scenarios: options.scenarios.filter(name => ['panels', 'search'].includes(name)),
        onScenario: scenario => { diagnosticContext = { stage: 'interactions', scenario }; } }));
      if (options.scenarios.includes('note-save')) {
        diagnosticContext = { stage: 'prepare-note', scenario: 'note-save' };
        const member = await browser.evaluate(`document.getElementById('member').value`);
        // A note-free unlocked surface chunk, so clearing restores the copied save.
        // Only the ID returns from the renderer; no note text leaves it.
        const chunk = await browser.evaluate(`Promise.all([fetch('/api/state',{cache:'no-store'}).then(r=>r.json()),fetch('/api/display-world').then(r=>r.json())]).then(([{state},world])=>{
          const owner=state.members.find(m=>m.id===${JSON.stringify(member)}),surface=new Set(world.surface.map(String));
          return owner.unlocked.map(String).filter(id=>/^\\d+$/.test(id)&&surface.has(id)&&state.members.every(m=>!m.notes?.[id])).sort((a,b)=>Number(a)-Number(b))[0]??null;
        })`);
        if (!chunk) throw new Error('No note-free unlocked chunk available for the scratch note save.');
        // Opened before the panel: its own reads can outlast the settle checks below.
        const planning = networkCollector(browser);
        try {
          await prepareNoteUI(browser, chunk);
          // Calculator lanes just before each click: what the server was busy with.
          const beforeSave = await workerResidency(browser).catch(() => null);
          const plannedBeforeSave = panelReads(planning);
          const saved = await measureNoteEdit(browser, server, 'note-save', SYNTHETIC_NOTE, member);
          saved.residencyBefore = beforeSave; saved.planningBefore = plannedBeforeSave;
          results.push(saved);
          diagnosticContext = { stage: 'prepare-note', scenario: 'note-clear' };
          // A note save moves no map, so no fresh tile mark follows it; the
          // viewport loaded before the save still counts.
          await settleNoteUI(browser, 0, SYNTHETIC_NOTE);
          // Someone pausing between edits: late page-load work lands outside both timings.
          if (options.noteDwellMs) await sleep(options.noteDwellMs);
          const beforeClear = await workerResidency(browser).catch(() => null);
          const plannedBeforeClear = panelReads(planning);
          const cleared = await measureNoteEdit(browser, server, 'note-clear', '', member);
          cleared.residencyBefore = beforeClear; cleared.planningBefore = plannedBeforeClear;
          const restored = await browser.evaluate(`fetch('/api/state',{cache:'no-store'}).then(r=>r.json()).then(({state})=>state.members.every(m=>!m.notes?.[${JSON.stringify(chunk)}]))`);
          if (restored !== true) throw new Error('Scratch note clear did not restore the copied save.');
          cleared.note.restored = true;
          results.push(cleared);
        } finally { planning.close(); }
        await browser.evaluate(`(() => {document.querySelector('#chunk-content [data-tab="contents"]')?.click();document.getElementById('chunk-close')?.click();})()`);
      }
      if (options.scenarios.includes('personal-filter')) {
        // Duo-only, like Group metrics: Group off keeps the rows as null observations.
        if (options.groupView !== 'on') results.push(...interactionScenarios(['personal-filter']).map(name => ({ name, durationMs: null, completion: 'inapplicable-group-view-off' })));
        else results.push(...await measureBrowserInteractions(browser, { timeout: options.timeout, scenarios: ['personal-filter'],
          onScenario: scenario => { diagnosticContext = { stage: 'interactions', scenario }; } }));
      }
      if (options.scenarios.includes('save-burst')) {
        diagnosticContext = { stage: 'prepare-burst', scenario: 'save-burst' };
        if (options.noteDwellMs) await sleep(options.noteDwellMs);
        const member = await browser.evaluate(`document.getElementById('member').value`);
        // The other member's note-free unlocked surface chunk (the selected one if solo),
        // so an even burst restores the copied save. Only IDs and the revision leave the renderer.
        const target = await browser.evaluate(`Promise.all([fetch('/api/state',{cache:'no-store'}).then(r=>r.json()),fetch('/api/display-world').then(r=>r.json())]).then(([{state},world])=>{
          const owner=state.members.find(m=>m.id!==${JSON.stringify(member)})??state.members.find(m=>m.id===${JSON.stringify(member)}),surface=new Set(world.surface.map(String));
          const chunk=owner.unlocked.map(String).filter(id=>/^\\d+$/.test(id)&&surface.has(id)&&state.members.every(m=>!m.notes?.[id])).sort((a,b)=>Number(a)-Number(b))[0]??null;
          return {member:owner.id,partner:owner.id!==${JSON.stringify(member)},chunk,revision:state.revision};
        })`);
        if (!target.chunk) throw new Error('No note-free unlocked chunk available for the scratch save burst.');
        // Start from a page that already shows the server's revision.
        await until(() => browser.evaluate(`Number(document.getElementById('save-status')?.title.match(/revision (\\d+)/)?.[1])===${target.revision}&&/[0-9,]+ possible tasks/.test(document.getElementById('task-engine-status')?.textContent??'')`), options.timeout, 60);
        const burst = await measureSaveBurst(browser, server, target, member);
        const restored = await browser.evaluate(`fetch('/api/state',{cache:'no-store'}).then(r=>r.json()).then(({state})=>state.revision===${target.revision + SAVE_BURST_COMMANDS}&&state.members.every(m=>!m.notes?.[${JSON.stringify(target.chunk)}]))`);
        if (restored !== true) throw new Error('Scratch save burst did not restore the copied save.');
        // Fixed labels only: no chunk, member or note text.
        burst.burst = { commands: SAVE_BURST_COMMANDS, target: target.partner ? 'partner' : 'selected', restored: true };
        results.push(burst);
      }
    }
    // The same pause before the after-suite sample: lanes a save stopped may restart.
    if (options.noteDwellMs && options.scenarios.some(name => ['note-save', 'save-burst'].includes(name))) await sleep(options.noteDwellMs);
    diagnosticContext = { stage: 'diagnostics' };
    const diagnostics = await browser.evaluate(`fetch('/api/diagnostics',{cache:'no-store'}).then(r=>r.json()).then(d=>({workerCompileMs:d.worker?.compileMs??null,startupTimingMs:{variantMs:Number.isFinite(d.startupTimingMs?.variantMs)?d.startupTimingMs.variantMs:null,stateResponseMs:Number.isFinite(d.startupTimingMs?.stateResponseMs)?d.startupTimingMs.stateResponseMs:null},taskTimings:d.timingMs,cache:d.cache,counts:d.counts,unlockReuse:d.unlockReuse?Object.fromEntries(['entries','bytes','rawBytes','compressedBytes','limit','byteLimit','hits','admitted','skipped'].map(k=>[k,d.unlockReuse[k]])):undefined,prediction:d.predictionLane?{worker:d.predictionLane.worker,cache:d.predictionLane.cache,prewarm:d.predictionLane.prewarm}:undefined}))`);
    diagnosticContext = { stage: 'rss' };
    const rssAfterBytes = await server.rss();
    const memoryAfter = server.latestMemory;
    // Which lanes still hold a process at the RSS sample, by name only.
    const residencyAfter = await workerResidency(browser).catch(() => null);
    const idleSample = await sampleIdle(browser, server, options.idleSampleMs
      ? { rssBytes: rssAfterBytes, diagnostics: await workerResidency(browser) } : null);
    const screenshots = await captureViews(browser, run, throttled);
    const cancellationCheck = await checkCancellation(browser);
    return { run, fixtureSha256: scratch.fingerprint, chrome: version.product, mode: throttled ? 'throttled' : 'normal', screenshots, cancellationCheck,
      server: { dataset: server.dataset, coldReadyMs: server.readyMs, initializationMs: server.initializationMs, workerWarmupMs: diagnostics.workerCompileMs,
        startupVariantMs: server.startupTimingMs?.variantMs ?? diagnostics.startupTimingMs?.variantMs ?? null,
        startupStateResponseMs: server.startupTimingMs?.stateResponseMs ?? diagnostics.startupTimingMs?.stateResponseMs ?? null,
        rssReadyBytes: server.rssReadyBytes, rssAfterBytes, rssAfterTotalBytes: memoryAfter?.totalRssBytes ?? null,
        workersRssAfterBytes: memoryAfter?.workersRssBytes ?? null, workerRssSamples: memoryAfter?.workerRssSamples ?? null,
        workerRssFailures: memoryAfter?.workerRssFailures ?? null, memoryTelemetry: server.memoryTelemetry, diagnostics, residencyAfter }, idleSample, results };
  } catch (error) {
    console.error(DIAGNOSTIC_PREFIX + JSON.stringify(safeDiagnostic(error, diagnosticContext)));
    const oomAfter = await oomCount();
    const rssAtFailureBytes = server ? await server.rss().catch(() => null) : null;
    error.partialSuite = { run, fixtureSha256: scratch.fingerprint, chrome: version?.product,
      mode: throttled ? 'throttled' : 'normal', complete: false, prerequisiteCold,
      hostOomKillDelta: oomBefore !== null && oomAfter !== null ? Math.max(0, oomAfter - oomBefore) : null,
      serverExit: server ? { code: server.child.exitCode, signal: server.child.signalCode } : error.serverExit ?? null,
      serverMemoryTelemetry: server?.memoryTelemetry ?? error.serverMemoryTelemetry ?? null,
      server: server ? { rssReadyBytes: server.rssReadyBytes, rssAtFailureBytes,
        coldReadyMs: server.readyMs, initializationMs: server.initializationMs } : null,
      failedMeasurement: error.partialMeasurement ?? null, results };
    throw error;
  } finally {
    // Never delete a profile/store while either owned process still runs.
    const cleanup = await Promise.allSettled([browser?.close(), server?.close()]);
    if (cleanup.some(r => r.status === 'rejected')) throw new Error('Shutdown failed; benchmark scratch retained for recovery.');
    await safeRemove(scratch.target);
  }
}
function median(values) {
  const all = values.filter(Number.isFinite).sort((a, b) => a - b);
  return !all.length ? null : all.length % 2 ? all[Math.floor(all.length / 2)] : (all[all.length / 2 - 1] + all[all.length / 2]) / 2;
}
function aggregates(suites) {
  const scenarios = [...new Set(options.scenarios.flatMap(name => ['panels', 'personal-filter'].includes(name) ? interactionScenarios([name])
    : name === 'note-save' ? ['note-save', 'note-clear'] : [name]))];
  return scenarios.map(name => {
    const runs = suites.flatMap(s => s.results).filter(r => r.name === name);
    if (interactionScenarios([name]).length) return { scenario: name, runs: runs.length, durationMs: median(runs.map(row => row.durationMs)) };
    return { scenario: name, runs: runs.length,
      milestones: Object.fromEntries(Object.keys(runs[0]?.milestones ?? {}).map(key => [key, median(runs.map(r => r.milestones[key]))])),
      networkTotals: Object.fromEntries(['count', 'transferBytes', 'decodedBodyBytes', 'cachedCount', 'cachedBodyBytes'].map(key => [key, median(runs.map(r => r.network.totals[key]))])),
      networkGroups: Object.fromEntries(['appCode', 'dataJson', 'api', 'mapTiles', 'otherAssets'].map(group => [group, Object.fromEntries(['count', 'transferBytes', 'decodedBodyBytes', 'cachedCount', 'cachedBodyBytes'].map(key => [key, median(runs.map(r => r.network.groups[group][key]))]))])),
      assetClasses: Object.fromEntries(ASSET_CLASSES.map(group => [group, Object.fromEntries(['count', 'transferBytes', 'decodedBodyBytes', 'cachedCount', 'cachedBodyBytes', 'failedCount', 'lastCompletionMs'].map(key => [key, median(runs.map(r => r.network.assetClasses[group][key]))]))])),
      endpointTtfbMs: Object.fromEntries(['state', 'definitions', 'rules', 'tasks', 'mapInfo', 'manifest', 'pins'].map(key => [key, median(runs.flatMap(r => r.network.endpointTtfbMs[key]))])),
      advisoryMaxMs: median(runs.map(r => r.advisoryMaxMs)),
      longTasks: Object.fromEntries(['count', 'totalMs', 'worstMs'].map(key => [key, median(runs.map(r => r.longTasks[key]))])),
      // Catch-up reads: one per event on the old client, fewer when a drain coalesces.
      ...(name === 'save-burst' ? { stateFetches: median(runs.map(r => r.network.requests.filter(q => q.path === '/api/state').length)) } : {}) };
  });
}
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
function reportMarkdown(result) {
  const measurements = result.medians.filter(row => !interactionScenarios([row.scenario]).length);
  const interactions = result.medians.filter(row => interactionScenarios([row.scenario]).length);
  const lines = [`# Picker performance: ${result.label}`, '', `Captured ${result.capturedAt}; Node ${result.environment.node}; ${result.environment.chrome}.`, '',
    `Group view ${result.options.groupView}; task milestone ${taskMilestoneEvent()}; settlement ${result.options.settlement}.`, '',
    `Unlock player ${result.options.unlockMember}; pick ${result.options.unlockPick}; panel dwell ${result.options.unlockDwellMs} ms; Preview ${result.options.unlockPreview === 'on' || result.options.unlockPick === 'prepared' ? 'on' : 'off'}.`, '',
    'Medians across independent repetitions. Times are milliseconds; transfer/cache sizes are KiB.', '',
    '| Scenario | N | Paint | Saved | Adopted | Terrain | Tasks | Visible tiles | Idle | Requests | KiB | Cached N | Cached KiB | Long N | Long total | Long worst |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const r of measurements) {
    const m = r.milestones, n = r.networkTotals, l = r.longTasks;
    lines.push(`| ${r.scenario} | ${r.runs} | ${[m.firstPaintMs,m.savedMs,m.stateAdoptedMs,m.terrainDrawnMs,m.tasksShownMs,m.visibleTilesLoadedMs,m.networkIdleMs,n.count,n.transferBytes/1024,n.cachedCount,n.cachedBodyBytes/1024,l.count,l.totalMs,l.worstMs].map(number).join(' | ')} |`);
  }
  lines.push('', '| Scenario | State TTFB | Definitions | Rules | Tasks | Map info | Manifest | Pins |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of measurements) lines.push(`| ${r.scenario} | ${Object.values(r.endpointTtfbMs).map(number).join(' | ')} |`);
  lines.push('', 'Advisory request duration (included in network idle): ' + measurements.map(r => `${r.scenario} ${number(r.advisoryMaxMs)} ms`).join('; ') + '.');
  lines.push('', '| Scenario | Category | Requests | Transfer KiB | Decoded KiB | Cached N | Cached body KiB |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const r of measurements) for (const [group, n] of Object.entries(r.networkGroups)) lines.push(`| ${r.scenario} | ${group} | ${number(n.count)} | ${number(n.transferBytes/1024)} | ${number(n.decodedBodyBytes/1024)} | ${number(n.cachedCount)} | ${number(n.cachedBodyBytes/1024)} |`);
  lines.push('', 'Asset classes are an additive breakdown; historical categories above are unchanged. Last completion is the final successful request end relative to scenario start; it can precede visible composition.', '', '| Scenario | Asset class | Requests | Transfer KiB | Decoded KiB | Cached N | Failed N | Last complete ms |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of measurements) for (const [group, n] of Object.entries(r.assetClasses)) lines.push(`| ${r.scenario} | ${group} | ${number(n.count)} | ${number(n.transferBytes/1024)} | ${number(n.decodedBodyBytes/1024)} | ${number(n.cachedCount)} | ${number(n.failedCount)} | ${number(n.lastCompletionMs)} |`);
  for (const r of measurements.filter(row => row.scenario === 'save-burst')) {
    lines.push('', `Save burst (partner commands from a second session): last committed ${number(r.milestones.lastCommittedMs)} ms, page caught up ${number(r.milestones.caughtUpMs)} ms, tasks painted ${number(r.milestones.tasksPaintedMs)} ms, ${number(r.stateFetches)} state reads, worst long task ${number(r.longTasks.worstMs)} ms.`);
  }
  if (interactions.length) {
    lines.push('', '| Interaction | N | Content painted ms |', '| --- | ---: | ---: |');
    for (const row of interactions) lines.push(`| ${row.scenario} | ${row.runs} | ${number(row.durationMs)} |`);
  }
  lines.push('', `Server process spawn → localhost ready: ${number(median(result.suites.map(s=>s.server.coldReadyMs)))} ms; foreground worker compilation: ${number(median(result.suites.map(s=>s.server.workerWarmupMs)))} ms.`,
    '', '| Server preparation | Median ms |', '| --- | ---: |',
    `| Saved-rule variant | ${number(median(result.suites.map(s=>s.server.startupVariantMs)))} |`,
    `| Initial play-state response | ${number(median(result.suites.map(s=>s.server.startupStateResponseMs)))} |`, '',
    `Server RSS ready / after: ${number(median(result.suites.map(s=>s.server.rssReadyBytes))/1048576)} / ${number(median(result.suites.map(s=>s.server.rssAfterBytes))/1048576)} MiB.`, '',
    'See JSON for per-run waterfalls, long-task phase boundaries, endpoint samples, and scheduler diagnostics.', '', ...result.notes.map(note => `- ${note}`), '');
  const idleSamples = result.suites.filter(suite => suite.idleSample);
  if (idleSamples.length) {
    lines.push('Separate post-suite idle/reload diagnostics (excluded from scenario medians).', '',
      '| Run / mode | Normal RSS MiB | Idle RSS MiB | Queues quiet at sample | Reload tasks ms | Reload worst long task ms | After reload RSS MiB |',
      '| --- | ---: | ---: | --- | ---: | ---: | ---: |');
    for (const suite of idleSamples) {
      const sample = suite.idleSample;
      lines.push(`| ${suite.run} / ${suite.mode} | ${number(sample.normal.rssBytes / 1048576)} | ${number(sample.idle.rssBytes / 1048576)} | ${sample.idle.diagnostics.observedQuiescent} | ${number(sample.wake.milestones.tasksShownMs)} | ${number(sample.wake.longTasks.worstMs)} | ${number(sample.afterWake.rssBytes / 1048576)} |`);
    }
    lines.push('', 'Lane residency, queue depths, exact wait and reload waterfalls are retained in JSON. Reload retains browser HTTP cache; server result caches follow the observed worker state. A queue-active idle sample does not establish memory after background work finishes.', '');
  }
  return lines.join('\n');
}

async function sourceProvenance(serverEntry) {
  return fingerprintPerfApplication(options.applicationRoot ?? ROOT, serverEntry);
}
async function main() {
  if (!parse(process.argv.slice(2))) return;
  options.captureStamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required.');
  options.packsDir = options.packsDir ?? process.env.RS3_PACKS_DIR;
  options.packSelection = options.packSelection ?? process.env.RS3_PACK_SELECTION;
  if (options.packsDir) options.packsDir = await rejectPathLinks(options.packsDir);
  if (options.packSelection) options.packSelection = await rejectPathLinks(options.packSelection);
  else if (options.packsDir) options.packSelection = await rejectPathLinks(path.join(options.packsDir, 'selection.json'));
  const packsMode = !!(options.packsDir || options.packSelection);
  options.source = await rejectPathLinks(options.source ?? path.join(MAIN, '.local/duo'));
  options.mapAssets = options.mapAssets ?? process.env.RS3_MAP_ASSETS_DIR ?? (packsMode ? undefined : path.join(MAIN, '.local/map-assets'));
  options.terrainAssets = options.terrainAssets ?? process.env.RS3_TERRAIN_ASSETS_DIR ?? options.mapAssets;
  options.gameData = options.gameData ?? process.env.RS3_GAME_DATA_DIR ?? (packsMode ? undefined : path.join(MAIN, '.local/game-data'));
  for (const key of ['mapAssets', 'terrainAssets', 'gameData']) if (options[key]) options[key] = await rejectPathLinks(options[key]);
  await noLinks(options.source);
  await mkdir(PERF, { recursive: true });
  const root = await realpath(ROOT), perfRoot = await realpath(PERF);
  Object.assign(options, await resolvePerfApplication(root, options));
  options.serverRevision ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: options.applicationRoot, encoding: 'utf8', windowsHide: true }).trim();
  const serverEntrySha256 = hash(await readFile(options.serverEntry));
  const applicationSource = await sourceProvenance(options.serverEntry);
  if (!inside(root, perfRoot)) throw new Error('Performance output must resolve inside this worktree.');
  await rejectPathLinks(PERF);
  if (options.output) {
    if (!inside(PERF, options.output) || !options.output.endsWith('.json')) throw new Error('--output must be a .json file inside this worktree .local/perf.');
    // Validate each existing ancestor before creating any missing output directory.
    let parent = path.dirname(options.output);
    while (true) {
      try { await rejectPathLinks(parent); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; parent = path.dirname(parent); }
    }
    await mkdir(path.dirname(options.output), { recursive: true });
    for (const target of [options.output, options.output.replace(/\.json$/, '.md'), options.output.replace(/\.json$/, '-partial.json')]) {
      try { await rejectPathLinks(target); if (!(await lstat(target)).isFile()) throw new Error('Report output must be a regular file.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (inside(options.source, perfRoot) || inside(perfRoot, options.source)) throw new Error('Source and scratch directories must not overlap.');
  const executable = await chromeExecutable(), suites = [];
  try {
    for (let run = 1; run <= options.runs; run++) {
      if (options.scenarios.some(s => s !== 'cold-30mbps')) { console.log(`Run ${run}/${options.runs}: first visit, reload and scratch interactions`); suites.push(await suite(executable, run, false)); }
      if (options.scenarios.includes('cold-30mbps')) { console.log(`Run ${run}/${options.runs}: cold 30 Mbps / 40 ms`); suites.push(await suite(executable, run, true)); }
    }
  } catch (error) {
    const partial = options.output?.replace(/\.json$/, '-partial.json') ?? path.join(PERF, `${options.label}-${options.captureStamp}-partial.json`);
    await writeFile(partial, JSON.stringify({ schemaVersion: 1, complete: false, label: options.label,
      capturedAt: new Date().toISOString(), options: { ...options, scenarios: [...options.scenarios] },
      fixture: { sha256: suites[0]?.fixtureSha256 ?? error.partialSuite?.fixtureSha256 ?? null, source: options.source },
      applicationSource, medians: aggregates(suites), suites, failedSuite: error.partialSuite ?? null }, null, 2) + '\n');
    console.log(`Completed measurements retained in partial report: ${partial}`);
    throw error;
  }
  if (new Set(suites.map(s=>s.fixtureSha256)).size !== 1) throw new Error('Fixture changed across repetitions; no comparable report written.');
  if (new Set(suites.map(s=>s.server.dataset?.digest ?? null)).size !== 1) throw new Error('Selected dataset changed across repetitions; no comparable report written.');
  if ((await sourceProvenance(options.serverEntry)).sha256 !== applicationSource.sha256) throw new Error('Measured application source changed during the run; no comparable report written.');
  const result = { schemaVersion: 1, label: options.label, capturedAt: new Date().toISOString(),
    options: { runs: options.runs, label: options.label, scenarios: [...options.scenarios], prewarm: options.prewarm, groupView: options.groupView, unlockMember: options.unlockMember, unlockPick: options.unlockPick, unlockChunk: options.unlockChunk ?? null, unlockPreview: options.unlockPreview, unlockDwellMs: options.unlockDwellMs, noteDwellMs: options.noteDwellMs, taskMilestone: options.taskMilestone, settlement: options.settlement, cpuProfile: options.cpuProfile,
      timeoutMs: options.timeout, idleSampleMs: options.idleSampleMs, workerIdleMs: process.env.RS3_WORKER_IDLE_MS ?? null, source: options.source, mapAssets: options.mapAssets, terrainAssets: options.terrainAssets, screenshots: options.screenshots, cancellationCheck: options.cancellationCheck, gameData: options.gameData, chromeExecutable: executable,
      serverEntry: options.serverEntry, serverRevision: options.serverRevision, serverEntrySha256, appDir: options.applicationRoot,
      packsDir: options.packsDir ?? null, packSelection: options.packSelection ?? null, port: options.port ?? null, output: options.output ?? null },
    environment: { node: process.version, chrome: suites[0]?.chrome, chromeExtraArgs, serverHeapMiB: options.serverHeapMiB ?? null,
      calculatorHeapMiB: /^\d+$/.test(process.env.RS3_PERF_CALCULATOR_HEAP_MIB ?? '') && Number(process.env.RS3_PERF_CALCULATOR_HEAP_MIB) >= 512 && Number(process.env.RS3_PERF_CALCULATOR_HEAP_MIB) <= 4096 ? Number(process.env.RS3_PERF_CALCULATOR_HEAP_MIB) : null,
      workerMode: ['process', 'thread'].includes(process.env.RS3_TASK_WORKER_MODE) ? process.env.RS3_TASK_WORKER_MODE : 'platform-default',
      platform: process.platform, viewport: { width:1440,height:900,dpr:1 }, throttle: { mbps:30,latencyMs:40 },
      gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      serverRevision: options.serverRevision, serverEntry: options.serverEntry, serverEntrySha256,
      gitDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
      cpuModel: cpus()[0]?.model ?? null, logicalCores: cpus().length, hostRamBytes: totalmem(),
      applicationRoot: options.applicationRoot, assetsRoot: options.mapAssets, gameDataRoot: options.gameData },
    applicationSource, fixture: { sha256: suites[0]?.fixtureSha256, source: options.source, dataset: suites[0]?.server.dataset ?? null }, medians: aggregates(suites), suites,
    notes: [ `Renderer CPU profiling is ${options.cpuProfile}; opt-in profiles cover selected scenarios only and add diagnostic overhead. Keep profiled runs separate from performance medians. Profile frame URLs retain pathname only.`,
      `Unlock player is ${options.unlockMember}; pick is ${options.unlockPick}; locked-panel dwell is ${options.unlockDwellMs} ms outside the measured Unlock. Positive dwell uses any/Preview off and does not assert a prediction hit or miss. Unlock Preview is ${options.unlockPreview === 'on' || options.unlockPick === 'prepared' ? 'on' : 'off'}. When on, preparation waits for the actual Preview UI to finish before the measured Unlock click. Compare only matching workflows; this does not measure an unchecked unlock.`,
      `Settlement policy is ${options.settlement}. Tasks policy ends at refreshed task and visible tile readiness while background advisories remain enabled; network totals are observed only through that boundary, and unobserved network idle remains null. Compare only matching settlement policies.`,
      'Browser cache is cold after authentication; OS file cache and server definition cache are not cleared. Each suite restarts the server and restores the copied baseline.',
      'Reload retains HTTP cache and foreground task result caches. Interactions run in sequence after the cold visit/reload.',
      'First paint applies to navigation only. Missing interaction milestones are null; switching members does not adopt or save state.',
      'Network idle requires 750 ms with no unfinished non-SSE request. Visible tile completion follows decoded/composed visible terrain, not just response completion.',
      'Death-estimate and prediction advisories remain in network idle and have separate duration summaries; foreground task/terrain milestones can finish earlier.',
      'Network transfer is CDP encodedDataLength (including response headers). Cached body bytes are encoded response/resource sizes; 304 counts as revalidation cache use.',
      'Long tasks use the browser PerformanceObserver threshold (50 ms); phase boundaries follow observed milestone ordering.',
      'Headless localhost measurements do not establish real-device, public-network or second-player experience.' ] };
  const stamp = result.capturedAt.replace(/[:.]/g, '-'), stem = options.output?.slice(0, -'.json'.length) ?? path.join(PERF, `${options.label}-${stamp}`);
  const markdown = reportMarkdown(result);
  await writeFile(`${stem}.json`, JSON.stringify(result, null, 2) + '\n'); await writeFile(`${stem}.md`, markdown);
  console.log(markdown); console.log(`JSON: ${stem}.json\nTable: ${stem}.md`);
}
main().catch(error => { console.error(DIAGNOSTIC_PREFIX + JSON.stringify(safeDiagnostic(error, diagnosticContext))); process.exitCode = 1; });
