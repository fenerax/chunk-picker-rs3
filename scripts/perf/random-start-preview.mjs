// Bounded START/candidate comparison. Run each root separately, sequentially.
// Public: --root CHECKOUT --out /tmp/report.json [--browser]
// Private mode (--data-dir) is disabled and fails before any save is read.
import assert from 'node:assert/strict';
import { mkdtemp, cp, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { randomStartFixture, randomStartDefinitions } from '../../tests/fixtures/random-start.mjs';

const { values } = parseArgs({ options: { root: { type: 'string' }, out: { type: 'string' },
  'data-dir': { type: 'string' }, browser: { type: 'boolean' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
if (!values.root || !values.out) throw Error('--root and --out required.');
const root = path.resolve(values.root), privateMode = Boolean(values['data-dir']);
if (privateMode) throw Error('Private mode is disabled: it copied a save and started the server on it, which can copy or create credentials. Compare private saves with a pure filesystem reader instead.');
const load = file => import(pathToFileURL(path.join(root, file)));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value,
  (key, row) => ['elapsedMs', 'timingMs'].includes(key) ? undefined : row && typeof row === 'object' && !Array.isArray(row)
    ? Object.fromEntries(Object.keys(row).sort().map(k => [k, row[k]])) : row)).digest('hex');
const spread = rows => ({ median: rows.toSorted((a, b) => a - b)[Math.floor(rows.length / 2)], min: Math.min(...rows), max: Math.max(...rows) });
const { createServer } = await load('app/server.mjs');
const { applyCommand } = await load('app/core/state.mjs');
const scratch = await mkdtemp(path.join(tmpdir(), 'random-start-preview-'));
let app, scheduler, browser;
const started = performance.now(), report = { stateCount: 0, evaluations: [], previewMs: [], browserChecks: 0 };
const sampleRSS = () => {
  const rows = new Map();
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      rows.set(Number(pid), { parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
        rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024 });
    } catch { /* Process exited during sampling. */ }
  }
  const visit = pid => (rows.get(pid)?.rss ?? 0) + [...rows].filter(([, row]) => row.parent === pid).reduce((sum, [child]) => sum + visit(child), 0);
  return visit(process.pid);
};
let peakRSSBytes = 0;
const rssTimer = setInterval(() => { peakRSSBytes = Math.max(peakRSSBytes, sampleRSS()); }, 50);
try {
  if (privateMode) {
    const source = path.resolve(values['data-dir']);
    for (const directory of [root, path.resolve(new URL('../../', import.meta.url).pathname)]) {
      assert.ok(path.relative(directory, source).startsWith('..'), 'Private copy must be outside checkouts');
      assert.ok(path.relative(directory, path.resolve(values.out)).startsWith('..'), 'Private report must be outside checkouts');
    }
    const sourceHash = hash(await readFile(path.join(source, 'state.json'), 'utf8'));
    const dataDir = path.join(scratch, 'game');
    await cp(source, dataDir, { recursive: true });
    await copyFile(source + '.dataset.json', dataDir + '.dataset.json');
    app = await createServer({ dataDir, port: 0, predictionPrewarm: false, retention: false });
    const states = [app.store.getState()];
    const backups = (await app.store.listBackups()).filter(row => row.revision < states[0].revision).sort((a, b) => a.revision - b.revision);
    assert.ok(backups.length >= 7);
    for (let index = 0; index < 7; index++) states.push((await app.store.readBackup(backups[Math.floor(index * (backups.length - 1) / 6)].id)).state);
    const { world, dataset } = app;
    await app.close(); app = undefined;
    const { createTaskScheduler } = await load('app/tasks/scheduler.mjs');
    const { createTaskReuseFingerprint } = await load('app/tasks/unlock-reuse.mjs');
    const { preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
    scheduler = await createTaskScheduler({ maxCalculators: 1, requestDeadlineMs: 600000, predictionDeadlineMs: 600000,
      workerData: { definitions: world.definitions, world: { chunks: world.chunks, areas: world.areas, surface: world.surface },
        datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions: { reviewedOverlays: true },
        preparedDatasetStages: preparedDefinitionStages(world.definitions) } });
    const fingerprint = createTaskReuseFingerprint();
    // Visit retained revisions in order so the production supersession guards
    // remain enabled. Requests run sequentially, with one calculator at a time.
    for (const state of states.toSorted((a, b) => a.revision - b.revision)) {
      const input = fingerprint(state);
      for (const member of state.members) {
        const result = await scheduler.evaluate(state, member.id, 'evaluate', undefined, undefined, input);
        const pool = (await scheduler.evaluate(state, member.id, 'roll-pool', undefined, undefined, input)).result.pool;
        const chunkId = member.pendingRoll[0] ?? pool.eligible[0]?.id
          ?? [...world.surface].filter(id => !member.unlocked.includes(id)).sort()[0];
        const prediction = chunkId ? (await scheduler.evaluate(state, member.id, 'predict', chunkId, undefined, input)).result.delta : null;
        report.evaluations.push({ resultHash: hash(result.result), poolHash: hash(pool), predictionHash: hash(prediction),
          taskCount: result.result.tasks.length, predictionCount: Number(Boolean(chunkId)) });
      }
      report.stateCount++;
      console.log(JSON.stringify({ stateCount: report.stateCount, evaluationCount: report.evaluations.length }));
    }
    report.sourceHash = sourceHash;
    assert.equal(hash(await readFile(path.join(source, 'state.json'), 'utf8')), sourceHash);
  } else {
    const { state, world } = randomStartFixture();
    app = await createServer({ dataDir: path.join(scratch, 'game'), port: 0, predictionPrewarm: false,
      definitions: randomStartDefinitions, taskMap: {}, initialState: state, random: () => 0 });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    const request = async (route, command) => {
      const response = await fetch(origin + route, { method: command ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${app.store.getAccessToken()}`, Origin: origin, 'Content-Type': 'application/json' },
        ...(command ? { body: JSON.stringify({ expectedRevision: app.store.getInfo().revision, command }) } : {}) });
      assert.equal(response.status, 200); return response.json();
    };
    await request('/api/predict?memberId=synthetic&chunkId=12850');
    await request('/api/command', { type: 'random-start', memberId: 'synthetic', count: 2 });
    const start = performance.now();
    const preview = await request('/api/predict?memberId=synthetic&chunkId=12850');
    report.previewMs.push(performance.now() - start);
    report.previewTasksAdded = preview.delta.tasksAdded.length;
    report.previewSectionsAddedCount = preview.delta.sectionsAdded?.length ?? 0;
    report.previewObjectsAddedCount = preview.delta.objectsAdded?.length ?? 0;
    report.previewTasksChangedCount = preview.delta.tasksChanged?.length ?? 0;
    report.cachedPreviewMs = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now(); await request('/api/predict?memberId=synthetic&chunkId=12850');
      report.cachedPreviewMs.push(performance.now() - start);
    }
    report.cachedPreviewSummaryMs = spread(report.cachedPreviewMs);
    const offer = app.store.getState();
    const options = { world, random: () => 0, now: () => '2026-11-01T00:00:00.000Z' };
    for (const command of [{ type: 'random-start', count: 1 }, { type: 'unlock-selection', chunkId: '12850' },
      { type: 'pick-for-me' }, { type: 'unlock-both' }]) {
      const result = applyCommand(command.type === 'random-start' ? state : offer, { ...command, memberId: 'synthetic' }, options);
      report.evaluations.push({ resultHash: hash(result.members) });
    }
    report.stateCount = report.evaluations.length;
    if (values.browser) {
      const require = createRequire(import.meta.url);
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');
      browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
        const page = await context.newPage();
        const click = locator => width === 390 ? locator.tap() : locator.click();
        await page.goto(app.inviteUrl);
        await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
        await click(page.locator('#pending-panel .choice-view').first());
        await click(page.getByRole('tab', { name: 'Preview', exact: true }));
        await page.locator('.unlock-count').waitFor();
        const text = await page.locator('.unlock-count').innerText();
        assert.equal(text, '1 new possible task'); report.browserChecks++;
        await click(page.locator('#pending-panel .pending-choice button.primary-action').first());
        await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
        const accepted = app.store.getState();
        assert.equal(accepted.members[0].sectionOverrides['12850-1'], true); report.browserChecks++;
        await page.reload(); await page.locator('#save-status').filter({ hasText: 'Saved' }).waitFor();
        const tasks = await request('/api/tasks?memberId=synthetic');
        assert.equal(tasks.tasks.filter(row => row.status === 'available' && !row.hidden && row.obligation !== false).length, 1); report.browserChecks++;
        if (width === 390) await click(page.locator('#phone-tab-tasks'));
        await page.getByText('Synthetic tree task', { exact: true }).first().waitFor();
        assert.ok(await page.getByText('Synthetic tree task', { exact: true }).first().isVisible()); report.browserChecks++;
        await context.close();
        // Restore the same offer through the public undo command between widths.
        await request('/api/command', { type: 'undo' });
      }
    }
  }
  report.durationMs = performance.now() - started;
  report.mainPeakRSSBytes = process.resourceUsage().maxRSS * 1024;
  report.sampledProcessTreePeakRSSBytes = Math.max(peakRSSBytes, sampleRSS());
  await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ stateCount: report.stateCount, evaluationCount: report.evaluations.length,
    previewTasksAdded: report.previewTasksAdded, previewMs: report.previewMs, browserChecks: report.browserChecks,
    durationMs: report.durationMs, mainPeakRSSBytes: report.mainPeakRSSBytes }));
} catch (error) {
  if (!privateMode) throw error;
  console.error(JSON.stringify({ errorCount: 1, completedStateCount: report.stateCount, errorHash: hash(String(error)) }));
  process.exitCode = 1;
} finally {
  clearInterval(rssTimer);
  await browser?.close(); await scheduler?.close(); await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
