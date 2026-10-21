import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Explicit copied-save input only. No invitation, gameplay values or task rows
// are logged. Source instrumentation exists only in the disposable app copy.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const redactBenchmarkText = value => String(value).replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--save-dir') || !args.includes('--playwright')) throw new Error('Use --save-dir <source save directory> --playwright <module path> [--output <timings.json>]');
const sandbox = await mkdtemp(path.join(tmpdir(), 'rs3-task-perf-'));
let application, browser;
try {
  await cp(path.join(root, 'app'), path.join(sandbox, 'app'), { recursive: true });
  if (args.includes('--revision')) {
    execFileSync('git', ['archive', '--format=tar', `--output=${path.join(sandbox, 'source.tar')}`, option('--revision'), 'app'], { cwd: root, windowsHide: true });
    execFileSync('tar', ['-xf', 'source.tar'], { cwd: sandbox, windowsHide: true });
  }
  const dataDir = path.join(sandbox, 'data');
  await cp(path.join(option('--save-dir'), 'state.json'), path.join(dataDir, 'state.json'));
  await cp(path.join(option('--save-dir'), 'static'), path.join(dataDir, 'static'), { recursive: true });
  const storeFile = path.join(sandbox, 'app/storage/store.mjs');
  let storeSource = await readFile(storeFile, 'utf8');
  storeSource = storeSource.replace('const validated = await compactHistory(next, archived);', 'const perfStart = performance.now(); const validated = await compactHistory(next, archived);');
  storeSource = storeSource.replace('current = validated;', "globalThis.__saveTiming = { saveMs: performance.now() - perfStart }; current = validated;");
  await writeFile(storeFile, storeSource);
  const mainFile = path.join(sandbox, 'app/web/main.mjs');
  const mainSource = await readFile(mainFile, 'utf8');
  // Archived baselines retain lexical globals; the split screen owns these
  // values and callbacks on its context. Instrument only the disposable copy.
  const instrumentation = mainSource.includes('const screen = createScreenContext();') ? `\n
globalThis.__perf = { showChunk: (...args) => screen.showChunk(...args), get state() { return screen.state; }, get result() { return screen.result; }, get map() { return screen.map; }, get memberId() { return screen.memberId; }, get queue() { return screen.queue; } };
const perfAccept = screen.acceptTaskResult;
screen.acceptTaskResult = value => { const start = performance.now(); perfAccept(value); globalThis.__perf.taskRenderMs = performance.now() - start; globalThis.__perf.taskRenderedAt = performance.now(); };
` : `\n
globalThis.__perf = { showChunk, get state() { return state; }, get result() { return result; }, get map() { return map; }, get memberId() { return memberId; }, get queue() { return queue; } };
const perfAccept = acceptTaskResult;
acceptTaskResult = value => { const start = performance.now(); perfAccept(value); globalThis.__perf.taskRenderMs = performance.now() - start; globalThis.__perf.taskRenderedAt = performance.now(); };
`;
  await writeFile(mainFile, mainSource + instrumentation);
  const { createServer } = await import(pathToFileURL(path.join(sandbox, 'app/server.mjs')));
  application = await createServer({ dataDir, port: 0, predictionPrewarm: !args.includes('--no-prewarm'),
    definitions: JSON.parse(await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'))),
    taskMap: JSON.parse(await readFile(path.join(root, 'reference/original-picker/tasksMap.json'))),
    resourcesRoot: path.join(root, 'resources'), mapAssetsDir: path.join(sandbox, 'no-map-assets') });
  await application.listen();
  const serializedCommand = application.store.commandSerialized.bind(application.store);
  application.store.commandSerialized = async (...args) => { const started = performance.now(); try { return await serializedCommand(...args); } finally { globalThis.__commandMs = performance.now() - started; } };
  const base = new URL(application.inviteUrl).origin;
  const token = new URL(application.inviteUrl).pathname.slice('/join/'.length);
  const request = async route => {
    const start = performance.now();
    const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
    const value = await response.json();
    if (!response.ok) throw new Error(`Benchmark HTTP ${response.status}`);
    return { value, elapsedMs: performance.now() - start };
  };
  let initial = application.store.getState();
  const { createRuleRegistry, evaluateRollPool } = await import('../app/core/rules.mjs');
  const pools = Object.fromEntries(initial.members.map(member => [member.id, evaluateRollPool(application.world, initial, member.id, createRuleRegistry())]));
  let member = initial.members[0]; const memberId = member.id;
  const poolIds = pools[memberId].eligible.map(row => row.id);
  const existingSelected = member.selected.find(id => id !== poolIds[0] && !member.unlocked.includes(id));
  const selected = existingSelected ?? poolIds[1];
  if (!existingSelected) {
    // Give the real-sized copy a distinct selected candidate for this workflow.
    await application.store.commandSerialized({ type: 'set-chunk', memberId, chunkId: selected, status: 'selected' }, initial.revision);
    initial = application.store.getState(); member = initial.members[0];
  }
  const { selectedDataset } = await import('../app/dataset-runtime.mjs');
  const { buildWorld } = await import('../app/data/world.mjs');
  const world = buildWorld(JSON.parse(await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'))), { dataset: selectedDataset });
  const arbitrary = [...world.chunks.keys()].find(id => !poolIds.includes(id) && !member.selected.includes(id) && !member.unlocked.includes(id) && (!world.surface || world.surface.has(id)));
  const measured = { node: process.version, sourceRevision: args.includes('--revision') ? option('--revision') : execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), workingTree: !args.includes('--revision'), prewarmEnabled: !args.includes('--no-prewarm'), predictions: [], possibleTasks: [], shifts: [] };
  const checkpoint = async () => { if (args.includes('--output')) await writeFile(option('--output'), JSON.stringify(measured, null, 2)); };
  if (args.includes('--wait-prewarm')) {
    const deadline = Date.now() + 300000;
    let diagnostics;
    do {
      await new Promise(resolve => setTimeout(resolve, 100));
      ({ value: diagnostics } = await request('/api/diagnostics'));
      if (Date.now() > deadline) throw new Error('Prewarm did not finish within five minutes');
    } while (!diagnostics.predictionLane?.prewarm?.queued
      || diagnostics.predictionLane.prewarm.pending || diagnostics.predictionLane.prewarm.active);
    measured.prewarm = diagnostics.predictionLane.prewarm;
  }
  for (const [kind, chunkId] of [['roll-pool', poolIds[0]], ['candidate', selected], ['arbitrary', arbitrary]]) {
    if (!chunkId) throw new Error(`Missing ${kind} benchmark chunk`);
    for (const temperature of ['cold', 'warm']) {
      const { value, elapsedMs } = await request(`/api/predict?memberId=${encodeURIComponent(memberId)}&chunkId=${encodeURIComponent(chunkId)}`);
      const { value: diagnostics } = await request('/api/diagnostics');
      measured.predictions.push({ kind, temperature, elapsedMs, serverMs: value.cache.requestMs, evaluationMs: value.cache.evaluationMs, cacheHit: value.cache.hit, stages: value.cache.timingMs ?? diagnostics.timingMs?.last });
      await checkpoint();
    }
  }
  const { chromium } = await import(pathToFileURL(path.resolve(option('--playwright'))));
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(redactBenchmarkText(error.message)));
  await page.goto(application.inviteUrl);
  await page.waitForFunction(() => !!globalThis.__perf?.map && !!globalThis.__perf?.result && __perf.result.stateRevision === __perf.state.revision, null, { timeout: 120000 });
  await page.evaluate(() => { const map = __perf.map, draw = map.drawState.bind(map); map.drawState = (...args) => { const value = draw(...args); if (__perf.clickAt && __perf.mapDrawAt === undefined) __perf.mapDrawAt = performance.now(); return value; }; });
  for (const temperature of ['first-index', 'reopen']) {
    await page.evaluate(id => __perf.showChunk(id), poolIds[0]);
    const summary = page.locator('#chunk-content summary').filter({ hasText: /^Possible Tasks$/ });
    await summary.evaluate(node => { globalThis.__panelStart = performance.now(); node.click(); });
    await page.waitForFunction(() => [...document.querySelectorAll('#chunk-content details')].find(node => node.querySelector('summary')?.textContent === 'Possible Tasks')?.textContent.includes('total tasks'));
    measured.possibleTasks.push({ temperature, renderedMs: await page.evaluate(() => performance.now() - __panelStart) });
  }
  await page.evaluate(id => { document.getElementById('chunk-info').hidden = true; __perf.map.centerOnChunk(id); }, poolIds[0]);
  await page.waitForTimeout(300);
  for (const action of ['unlock', 'lock']) {
    const targetId = poolIds[0];
    const priorRevision = await page.evaluate(() => __perf.state.revision);
    const commandResponse = page.waitForResponse(response => response.url().endsWith('/api/command') && response.request().method() === 'POST');
    await page.evaluate(() => { __perf.clickAt = undefined; __perf.mapDrawAt = undefined; __perf.taskRenderedAt = undefined; const canvas = __perf.map.hoverCanvas; canvas.addEventListener('pointerup', () => { __perf.clickAt = performance.now(); }, { once: true, capture: true }); });
    const point = await page.evaluate(() => { const bounds = __perf.map.stage.getBoundingClientRect(); return { x: bounds.left + __perf.map.width / 2, y: bounds.top + __perf.map.height / 2 }; });
    await page.keyboard.down('Shift'); await page.mouse.click(point.x, point.y); await page.keyboard.up('Shift');
    const response = await commandResponse;
    const commandDone = await page.evaluate(() => performance.now() - __perf.clickAt);
    await response.finished();
    await page.waitForFunction(({ targetId, priorRevision, action }) => __perf.state.revision > priorRevision && __perf.result?.stateRevision === __perf.state.revision && (__perf.state.members[0].unlocked.includes(targetId) === (action === 'unlock')), { targetId, priorRevision, action }, { timeout: 120000 });
    const timing = await page.evaluate(() => ({ mapMs: __perf.mapDrawAt - __perf.clickAt, taskListMs: __perf.taskRenderedAt - __perf.clickAt, taskRenderMs: __perf.taskRenderMs }));
    const { value: diagnostics } = await request('/api/diagnostics');
    measured.shifts.push({ action, ...timing, commandResponseMs: commandDone, serverCommandMs: globalThis.__commandMs, saveMs: globalThis.__saveTiming?.saveMs, taskRecomputeMs: diagnostics.timingMs?.last?.totalMs, taskStages: diagnostics.timingMs?.last });
  }
  measured.pageErrors = errors;
  if (args.includes('--output')) await writeFile(option('--output'), JSON.stringify(measured, null, 2));
  process.stdout.write(JSON.stringify(measured, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`${redactBenchmarkText(error.message)}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close(); await application?.close();
  // sandbox is an mkdtemp-owned absolute directory, never the source save.
  if (path.dirname(sandbox) !== path.resolve(tmpdir()) || !path.basename(sandbox).startsWith('rs3-task-perf-')) throw new Error('Refusing unexpected benchmark cleanup path');
  await rm(sandbox, { recursive: true, force: true });
}
