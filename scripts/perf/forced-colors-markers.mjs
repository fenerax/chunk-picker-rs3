// Synthetic end-to-end regression check; no project dependencies or real saves.
// RS3_DATASET=duo-legacy node scripts/perf/forced-colors-markers.mjs \
//   --playwright /scratch/node_modules/playwright-core/index.mjs \
//   --baseline-web /scratch/START-web --output /scratch/marker-results
// Export START's style.css and helper.css into --baseline-web before editing.
// Baseline observations are measurements; only the current styles are gated.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
assert.ok(options.playwright && options.output, 'Supply --playwright and --output');
const repetitions = Number(options.repeat ?? 3);
assert.ok(Number.isInteger(repetitions) && repetitions > 0);
assert.ok(!process.env.RS3_DATASET || process.env.RS3_DATASET === 'duo-legacy', 'Both features require duo-legacy');
assert.ok(!process.env.RS3_PACKS_DIR && !process.env.RS3_GAME_DEFAULTS_FILE, 'Use public synthetic inputs only');
process.env.RS3_DATASET = 'duo-legacy';
const { createServer } = await import('../../app/server.mjs');
const { createGroupState } = await import('../../app/core/state.mjs');
const { chromium } = await import(pathToFileURL(resolve(options.playwright)));
const scratch = await mkdtemp(join(tmpdir(), 'forced-colors-markers-'));
await mkdir(options.output, { recursive: true });
const application = await createServer({ dataDir: join(scratch, 'save'), port: 0, prewarm: false,
  initialState: createGroupState([{ id: 'fixture', name: 'Fixture', unlocked: ['12341'] }]),
  definitions: { chunks: { 12341: {}, 12342: {} }, sections: { 12341: { 0: [] } },
    walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'], challenges: {} }, taskMap: {} });
const results = [], timings = [], normalShots = new Map(), errors = [];
let browser;
const digest = value => createHash('sha256').update(value).digest('hex');

// Composite backgrounds over their actual ancestors. Transparent and opaque
// system white (or black) can paint identically, so raw alpha is not a marker.
async function inspect(locator) {
  return locator.evaluateAll(nodes => nodes.map(node => {
    const rgba = value => value.match(/[\d.]+/g).map(Number);
    let background = [255, 255, 255];
    const ancestors = []; for (let n = node; n; n = n.parentElement) ancestors.unshift(n);
    for (const n of ancestors) {
      const [r, g, b, a = 1] = rgba(getComputedStyle(n).backgroundColor);
      background = [r, g, b].map((v, i) => Math.round(v * a + background[i] * (1 - a)));
    }
    const s = getComputedStyle(node), box = node.getBoundingClientRect();
    const border = ['Top', 'Right', 'Bottom', 'Left'].map(side => {
      if (s[`border${side}Style`] === 'none' || parseFloat(s[`border${side}Width`]) === 0) return null;
      const [r, g, b, a = 1] = rgba(s[`border${side}Color`]);
      return [s[`border${side}Width`], s[`border${side}Style`], [r, g, b].map((v, i) => Math.round(v * a + background[i] * (1 - a)))];
    });
    const range = document.createRange(); range.selectNodeContents(node);
    const textBox = range.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { current: ['true', 'page'].includes(node.getAttribute('aria-selected') ?? node.getAttribute('aria-current')),
      signature: { foreground: s.color, background, border, decoration: s.textDecorationLine, weight: s.fontWeight },
      underline: s.textDecorationLine.includes('underline') && parseFloat(s.textDecorationThickness) >= 2 && parseFloat(s.textUnderlineOffset) > 0,
      focus: node.matches(':focus-visible'), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2,
      textVisible: textBox.width > 0 && textBox.height > 0,
      hit: hit === node || node.contains(hit), box: { x: box.x, y: box.y, width: box.width, height: box.height } };
  }));
}

try {
  await application.listen();
  const stateBefore = JSON.stringify(application.store.getState());
  browser = await chromium.launch({ executablePath: options.chromium ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (let pair = 0; pair < repetitions; pair++) {
    const order = options['baseline-web'] ? (pair % 2 ? ['after', 'before'] : ['before', 'after']) : ['after'];
    for (const version of order) {
      console.log(`Pair ${pair + 1}/${repetitions}: ${version}`);
      const started = performance.now();
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const origin = new URL(application.inviteUrl).origin;
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (version === 'before' && ['/style.css', '/helper.css'].includes(url.pathname)) {
            return route.fulfill({ body: await readFile(join(options['baseline-web'], url.pathname.slice(1))), contentType: 'text/css' });
          }
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        for (const width of [1440, 390]) for (const theme of ['dark', 'light']) for (const palette of ['dark', 'light']) for (const forcedColors of ['none', 'active']) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ forcedColors, colorScheme: palette, reducedMotion: 'reduce' });
          await page.goto(application.inviteUrl);
          await page.locator('#save-status[data-status=saved]').waitFor();
          await page.evaluate(async theme => {
            const { applyTheme } = await import('/map-tools.mjs'); applyTheme(document.documentElement, theme);
            await document.fonts.ready;
          }, theme);
          if (width === 390) await page.locator('#phone-tab-more').click();
          await page.locator('#search-open').click();
          await page.locator('.search-result button').first().click();
          await page.locator('#chunk-content [role=tab]').first().waitFor();
          for (const surface of ['tabs', 'helper']) {
            if (surface === 'helper') {
              await page.locator('#chunk-close').click();
              if (width === 390) await page.locator('#phone-tab-more').click();
              await page.locator('#helper-open').click();
              await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/helper.css')));
              await page.locator('#helper-content[aria-busy=false]').waitFor();
            }
            const selector = surface === 'tabs' ? '#chunk-content [role=tab]' : '.helper-nav button';
            const controls = page.locator(selector);
            for (const state of [0, 1]) {
              if (surface === 'tabs') {
                await controls.first().click(); await page.keyboard.press('Home');
                if (state) await page.keyboard.press('ArrowRight');
              } else {
                await controls.nth(state).click();
                await page.locator('#helper-content[aria-busy=false]').waitFor();
              }
              for (const focus of ['none', 'current', 'inactive']) {
                const focusIndex = focus === 'current' ? state : 1 - state;
                if (focus === 'none') await page.evaluate(() => document.activeElement.blur());
                else { await page.keyboard.press('Tab'); await controls.nth(focusIndex).focus(); }
                await page.mouse.move(0, 0);
                const values = await inspect(controls), current = values[state], inactive = values[1 - state];
                assert.equal(values.filter(value => value.current).length, 1);
                assert.ok(current.current && !inactive.current, 'Wired navigation updates semantic state');
                // Chromium recolors a focused button's border. Exclude that
                // focus-only color from the selection comparison; preserve
                // border geometry, effective fills, text and decoration cues.
                const markerSignature = value => ({ ...value.signature, ...(focus === 'none' ? {} : {
                  border: value.signature.border.map(side => side?.slice(0, 2) ?? null),
                }) });
                const markerDistinct = JSON.stringify(markerSignature(current)) !== JSON.stringify(markerSignature(inactive));
                if (version === 'after') {
                  assert.ok(markerDistinct, `${surface}: visible state distinction in ${forcedColors}/${palette}/${theme}/${width}/${focus}`);
                  assert.ok(current.hit && inactive.hit && current.textVisible && inactive.textVisible, 'Both controls remain visible hit targets');
                  if (forcedColors === 'active') assert.ok(current.underline && !inactive.underline, 'Only current control has the geometric text cue');
                  if (focus !== 'none') assert.ok(values[focusIndex].focus && values[focusIndex].outline, 'Keyboard focus has its own outline');
                }
                const result = { pair, version, width, theme, palette, forcedColors, surface, state, focus, markerDistinct, values };
                results.push(result);
                if (pair === 0 && state === 0 && (focus === 'none' || (width === 1440 && theme === 'dark' && palette === 'light'))) {
                  const key = `${width}-${theme}-${palette}-${forcedColors}-${surface}-${focus}`;
                  const crop = page.locator(surface === 'tabs' ? '.tab-bar' : '.helper-nav');
                  const png = await crop.screenshot({ animations: 'disabled', caret: 'hide' });
                  await writeFile(join(options.output, `${version}-${key}.png`), png);
                  result.screenshotHash = digest(png);
                  if (forcedColors === 'none') {
                    const previous = normalShots.get(key);
                    if (previous) assert.equal(result.screenshotHash, previous, 'Normal-mode pixels remain unchanged');
                    else normalShots.set(key, result.screenshotHash);
                  }
                }
              }
            }
          }
        }
      } finally { await context.close(); }
      timings.push({ pair, version, elapsedMs: Math.round(performance.now() - started) });
    }
  }
  assert.deepEqual(errors, [], 'No browser exceptions');
  assert.equal(JSON.stringify(application.store.getState()), stateBefore, 'Navigation preserves gameplay');
  const summary = { browser: browser.version(), observations: results.length,
    markers: ['before', 'after'].map(version => ({ version, ...Object.fromEntries(['none', 'active'].map(mode => {
      const rows = results.filter(row => row.version === version && row.forcedColors === mode);
      return [mode, { distinct: rows.filter(row => row.markerDistinct).length, total: rows.length }];
    })) })), normalScreenshotPairs: options['baseline-web'] ? normalShots.size : 0, timings, errors: errors.length };
  await writeFile(join(options.output, 'results.json'), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser?.close(); await application.close(); await rm(scratch, { recursive: true, force: true });
}
