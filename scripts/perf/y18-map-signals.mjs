// Synthetic application-shell check. No private inputs or npm dependencies.
// PLAYWRIGHT_MODULE=/path/to/playwright-core CHROME_PATH=/usr/bin/chromium \
// RS3_DATASET=open-f2p node scripts/perf/y18-map-signals.mjs [--baseline SHA] [--scenario NAME]
// Canvas probes record calls while preserving painting. Pointer input is an
// emulated mouse at desktop/phone widths, not native touch or a pixel audit.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../../app/server.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { SURFACE_GRID } from '../../app/data/surface-grid.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';

assert.equal(selectedDataset.id, 'open-f2p', 'Run this public synthetic probe with RS3_DATASET=open-f2p');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? null : process.argv[baselineIndex + 1];
if (baselineIndex >= 0) assert.match(baseline ?? '', /^[a-f0-9]{7,40}$/);
const changed = ['map.mjs', 'screen-map.mjs', 'screen-chunks.mjs', 'map-task-count-obstacles.mjs'];
const oldFiles = baseline ? new Map(changed.map(file => [file, execFileSync('git', ['show', `${baseline}:app/web/${file}`], { encoding: 'utf8' })])) : null;
const home = String(SURFACE_GRID.startId + SURFACE_GRID.stride * 3 - 3);
const target = String(Number(home) + SURFACE_GRID.stride), second = String(Number(home) - 1);
const ids = [home, target, second];
const definitions = { chunks: Object.fromEntries(ids.map((id, index) => [id, { Name: `Synthetic place ${index}` }])), walkableChunks: ids, walkableChunksF2P: ids };
const geometric = createRuleRegistry().get('roll.neighborMode').options.find(value => ['geometric', 'frontier'].includes(value));
const scenarios = [
  { name: 'disabled-hand', selected: [target], disabled: true },
  { name: 'partner-hand', partnerSelected: [target] },
  { name: 'eligible-partner-owned', adjacent: true },
  { name: 'eligible-hand-order', selected: [second, target] },
  { name: 'pending-current', pending: [target] },
  { name: 'pending-partner', selected: [target], partnerPending: [target] },
  { name: 'excluded-selected', selected: [target], blacklist: [target] },
  { name: 'disabled-with-automatic', selected: [target], disabled: true, adjacent: true },
];
const scenarioIndex = process.argv.indexOf('--scenario');
const scenarioName = scenarioIndex < 0 ? null : process.argv[scenarioIndex + 1];
if (scenarioIndex >= 0) assert.ok(scenarios.some(row => row.name === scenarioName), 'Unknown synthetic scenario');
const selectedScenarios = scenarios.filter(row => !scenarioName || row.name === scenarioName);
const summary = { states: selectedScenarios.length, views: 0, cellChecks: 0, before: { missing: 0, extra: 0 }, after: { missing: 0, extra: 0 }, rollDisagreements: 0, poolDifferences: 0, pointerClicks: 0, permissionChecks: 0, warmModelMs: { before: [], after: [] } };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  for (const scenario of selectedScenarios) {
    const directory = await mkdtemp(path.join(tmpdir(), 'y18-map-signals-'));
    let app;
    try {
      const initialState = createGroupState([
        { id: 'qa-one', name: 'Explorer One', unlocked: [home], selected: scenario.selected ?? [], pendingRoll: scenario.pending ?? [], blacklisted: scenario.blacklist ?? [] },
        { id: 'qa-two', name: 'Explorer Two', unlocked: scenario.partnerSelected || scenario.partnerPending ? [home] : [target], selected: scenario.partnerSelected ?? [], pendingRoll: scenario.partnerPending ?? [] },
      ]);
      initialState.rules = { 'roll.selected': !scenario.disabled, 'roll.adjacent': !!scenario.adjacent, 'roll.neighborMode': scenario.adjacent ? geometric : 'manual' };
      for (const member of initialState.members) Object.assign(member.preferences ??= {}, { info: true, ids: false });
      app = await createServer({ dataset: selectedDataset, dataDir: directory, initialState, definitions, taskMap: {}, gameDataDir: path.join(directory, 'absent-game'), mapAssetsDir: path.join(directory, 'absent-art'), terrainAssetsDir: path.join(directory, 'absent-art'), iconAssetsDir: path.join(directory, 'absent-art'), host: '127.0.0.1', port: 0, predictionPrewarm: false });
      await app.listen();
      const origin = new URL(app.inviteUrl).origin;
      const admin = await browser.newContext();
      await admin.request.get(app.inviteUrl);
      const envelope = await (await admin.request.get(origin + '/api/state?view=play-v1')).json();
      const invited = await admin.request.post(origin + '/api/invites', { headers: { Origin: origin }, data: { label: 'Synthetic spectator', viewer: true } });
      assert.equal(invited.status(), 201);
      const viewerUrl = new URL((await invited.json()).link).pathname;
      await admin.close();
      let canonicalPools;
      for (const variant of oldFiles ? ['before', 'after'] : ['after']) for (const phone of [false, true]) for (const viewer of [false, true]) {
        const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
        try {
          const page = await context.newPage(); page.setDefaultTimeout(15000);
          await page.route('**/*.mjs', async route => {
            const filename = new URL(route.request().url()).pathname.slice(1);
            if (filename === 'main.mjs') {
              const response = await route.fetch();
              return route.fulfill({ response, body: (await response.text()) + '\nglobalThis.__mapSignalScreen = screen;\n' });
            }
            if (variant === 'before' && oldFiles.has(filename)) return route.fulfill({ contentType: 'text/javascript', body: oldFiles.get(filename) });
            return route.continue();
          });
          await page.addInitScript(() => {
            globalThis.__mapSignalPaint = [];
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
              if (this.canvas.id === 'map-state') globalThis.__mapSignalPaint.push({ text: String(text), x, y });
              return original.call(this, text, x, y, ...rest);
            };
          });
          await page.goto(viewer ? origin + viewerUrl : app.inviteUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => globalThis.__mapSignalScreen?.state && globalThis.__mapSignalScreen?.map?.initialized);
          await settle(page);
          const adopted = await page.evaluate(() => JSON.stringify(globalThis.__mapSignalScreen.statePools));
          canonicalPools ??= adopted;
          summary.poolDifferences += Number(adopted !== canonicalPools);
          for (const groupView of [false, true]) {
            if (phone && !(await page.locator('#phone-controls').isVisible().catch(() => false))) {
              const toggle = page.locator('#phone-controls-toggle');
              if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            }
            await page.locator('#group-view').setChecked(groupView);
            if (phone && await page.locator('#phone-controls-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#phone-controls-toggle').click();
            await settle(page);
            await page.evaluate(id => {
              const c = globalThis.__mapSignalScreen;
              c.map.zoom = .6; c.map.centerOnChunk(id);
              // Pending panels can cover the center on a phone. Position the
              // inspected cell on exposed canvas, without hiding any UI.
              const map = c.map, box = map.stage.getBoundingClientRect(), cell = map.cells.get(id), size = 128 * map.zoom;
              let anchor;
              for (let y = box.top + size; y < Math.min(box.bottom, innerHeight) - size / 2 && !anchor; y += size / 2) {
                for (const fraction of [.5, .75, .25]) {
                  const x = box.left + box.width * fraction;
                  if (document.elementFromPoint(x, y) === map.hoverCanvas) { anchor = { x, y }; break; }
                }
              }
              if (!anchor) throw Error('No exposed map canvas for pointer interaction');
              map.offset.x += anchor.x - (box.left + map.offset.x + cell.x * size + size / 2);
              map.offset.y += anchor.y - (box.top + map.offset.y + cell.y * size + size / 2);
              globalThis.__mapSignalPaint.length = 0;
              c.map.invalidate(false, true, false);
            }, target);
            await settle(page);
            const observed = await page.evaluate(ids => {
              const c = globalThis.__mapSignalScreen, size = 128 * c.map.zoom;
              return { eligible: c.pool.eligible.map(row => row.id), ranks: ids.filter(id => {
                const point = c.map.cells.get(id), x = c.map.offset.x + point.x * size, y = c.map.offset.y + point.y * size;
                return globalThis.__mapSignalPaint.some(call => /^\d+$/.test(call.text) && call.x > x && call.x < x + size && call.y > y && call.y < y + size);
              }), count: c.rollCandidateCount(), pending: c.member().pendingRoll.length > 0,
              pickDisabled: c.$('pick').disabled, twoDisabled: c.$('roll-two').disabled,
              legend: c.$('map-legend').textContent,
              revision: c.state.revision, poolRevision: c.map.model.state.revision };
            }, ids);
            assert.equal(observed.revision, observed.poolRevision);
            for (const id of ids) {
              summary.cellChecks++;
              const eligible = observed.eligible.includes(id), numbered = observed.ranks.includes(id);
              summary[variant].missing += Number(eligible && !numbered);
              summary[variant].extra += Number(!eligible && numbered);
            }
            const rollOK = observed.count === observed.eligible.length && observed.pickDisabled === (viewer || observed.pending || !observed.count) && observed.twoDisabled === (viewer || observed.pending || observed.count < 2);
            summary.rollDisagreements += Number(!rollOK); assert.ok(rollOK);
            const point = await page.evaluate(id => {
              const map = globalThis.__mapSignalScreen.map, cell = map.cells.get(id), box = map.stage.getBoundingClientRect(), size = map.zoom * 128;
              return { x: box.left + map.offset.x + cell.x * size + size / 2, y: box.top + map.offset.y + cell.y * size + size / 2 };
            }, target);
            await page.mouse.move(point.x, point.y); await settle(page);
            const tooltip = await page.locator('#map-tooltip').textContent();
            if (variant === 'after') {
              assert.equal(/(?:Hand-added|Automatic|Lodestone) roll option/.test(tooltip), observed.eligible.includes(target));
              if (scenario.disabled) assert.match(tooltip, /Hand selections are disabled for Explorer One/);
              if (scenario.partnerSelected?.length && groupView) assert.match(tooltip, /Saved hand selection 1: Explorer Two/);
              if (scenario.partnerSelected?.length && !groupView) assert.doesNotMatch(tooltip, /Saved hand selection.*Explorer Two/);
              assert.match(observed.legend, /Numbers show Explorer One’s current roll options/);
            }
            await page.mouse.click(point.x, point.y); await settle(page);
            await page.locator('#chunk-info').waitFor({ state: 'visible' }).catch(async error => {
              console.error(JSON.stringify({ scenario: scenario.name, variant, phone, viewer, groupView, point, ui: await page.evaluate(point => ({ info: globalThis.__mapSignalScreen.preferences().info, hover: globalThis.__mapSignalScreen.map.hoverId, hit: document.elementFromPoint(point.x, point.y)?.id }), point) }));
              throw error;
            });
            const detail = await page.locator('#chunk-content').textContent();
            assert.ok(detail.includes(observed.pending ? 'pending roll' : observed.eligible.includes(target) ? 'Eligible for Explorer One’s next roll.' : 'Outside Explorer One’s current roll pool.'));
            if (variant === 'after' && scenario.disabled) assert.match(detail, /Hand selections are disabled for Explorer One/);
            if (viewer) assert.equal(await page.locator('#chunk-info button').filter({ hasText: /^(Unlock|Add to roll pool|Never roll)$/ }).count(), 0);
            summary.permissionChecks++; summary.pointerClicks++;
            await page.locator('#chunk-close').click(); await settle(page);
            summary.views++;
          }
          // Warm actual model construction, without terrain frames or task work.
          if (scenario.name === 'eligible-hand-order' && !phone && !viewer) {
            for (let pair = 0; pair < 5; pair++) summary.warmModelMs[variant].push(await page.evaluate(() => {
              const map = globalThis.__mapSignalScreen.map, model = map.model;
              for (let i = 0; i < 20; i++) map.setModel(model);
              const start = performance.now();
              for (let i = 0; i < 1000; i++) map.setModel(model);
              return performance.now() - start;
            }));
          }
        } finally { await context.close(); }
      }
      assert.equal(JSON.stringify(envelope.pools), canonicalPools, 'Browser adopts the actual response pools unchanged');
      console.error(JSON.stringify({ completedScenario: scenario.name, views: summary.views }));
    } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); await rm(directory + '.dataset.json', { force: true }); }
  }
} finally { await browser.close(); }
const distribution = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return { median: sorted[Math.floor(sorted.length/2)], min: sorted[0], max: sorted.at(-1), samples: values.length };
};
summary.warmModelMs = Object.fromEntries(Object.entries(summary.warmModelMs).map(([key, values]) => [key, distribution(values)]));
console.log(JSON.stringify(summary, null, 2));
assert.equal(summary.after.missing + summary.after.extra + summary.rollDisagreements + summary.poolDifferences, 0);
