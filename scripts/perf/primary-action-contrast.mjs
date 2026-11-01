// Public open-f2p UI only. No project dependencies or private packs/save.
// node scripts/perf/primary-action-contrast.mjs --playwright /path/to/playwright-core/index.mjs \
//   --baseline-css /tmp/START-style.css --output /tmp/primary-contrast.json
// Export START's stylesheet with git show before running. Alternates before/after
// order across five repetitions; samples settled, opaque, enabled normal text.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
for (const key of ['playwright', 'baseline-css', 'output']) assert.ok(options[key], `Missing --${key}`);
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
assert.ok(nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 20), 'Node 24.20+ required');
process.env.RS3_DATASET = 'open-f2p';
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET_PROFILE', 'RS3_PRIVATE_ADDON']) delete process.env[key];
const { createServer } = await import('../../app/server.mjs');
const { chromium } = await import(pathToFileURL(options.playwright));
const baseline = await readFile(options['baseline-css']);
const dataDir = await mkdtemp('/tmp/primary-contrast-');
let app, browser;
const samples = [], selected = [];
const contrast = (foreground, background) => {
  const luminance = rgb => {
    assert.match(rgb, /^rgb\(\d+, \d+, \d+\)$/);
    return rgb.match(/\d+/g).map(Number).map(v => v / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const paint = node => {
  const s = getComputedStyle(node), ancestors = [];
  for (let n = node; n; n = n.parentElement) {
    const p = getComputedStyle(n);
    ancestors.push({ opacity: p.opacity, filter: p.filter, mixBlendMode: p.mixBlendMode });
  }
  return { foreground: s.color, background: s.backgroundColor, backgroundImage: s.backgroundImage,
    fontSize: s.fontSize, fontWeight: s.fontWeight, outlineStyle: s.outlineStyle,
    outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, outlineOffset: s.outlineOffset,
    focusVisible: node.matches(':focus-visible'), disabled: node.disabled, ancestors };
};
try {
  app = await createServer({ dataDir, host: '127.0.0.1', port: 0 });
  await app.listen(); await app.ready;
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ executablePath: options.chromium ?? '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  for (let repetition = 0; repetition < 5; repetition++) {
    for (const version of repetition % 2 ? ['after', 'before'] : ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { Authorization: `Bearer ${app.store.getAccessToken()}` } });
      try {
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (version === 'before' && url.pathname === '/style.css') return route.fulfill({ body: baseline, contentType: 'text/css' });
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => { throw error; });
        await page.goto(origin);
        await page.locator('#custom-task-open').waitFor();
        // First run offers setup. Dismiss through the real UI, then wait for save.
        const skip = page.locator('.setup-guide-skip');
        if (repetition === 0 && version === 'before') { await skip.waitFor(); await skip.click(); }
        const menu = page.locator('#more-tools');
        for (const theme of ['light', 'dark', 'gray']) {
          if (!(await menu.evaluate(n => n.open))) await menu.locator('summary').first().click();
          const choice = page.locator(`#theme-${theme}`);
          await choice.click();
          await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && document.querySelector('#save-status').dataset.status === 'saved', theme);
          if (!(await menu.evaluate(n => n.open))) await menu.locator('summary').first().click();
          await page.mouse.move(0, 0);
          await page.waitForTimeout(180);
          const selectedRest = await choice.evaluate(paint);
          await choice.hover(); await page.waitForTimeout(180);
          selected.push({ repetition, version, theme, rest: selectedRest, hover: await choice.evaluate(paint) });
          await menu.locator('summary').first().click();
          await page.locator('#custom-task-open').click();
          const description = page.getByLabel('Task description', { exact: true });
          await description.fill('Synthetic contrast check');
          const submit = page.locator('#tool-dialog button.primary-action');
          assert.ok(await submit.isEnabled());
          for (const state of ['rest', 'hover', 'focus', 'focus-hover']) {
            if (state === 'hover' || state === 'focus-hover') await submit.hover();
            else await page.mouse.move(0, 0);
            if (state === 'focus') {
              await description.focus();
              for (let i = 0; i < 10 && !(await submit.evaluate(n => n === document.activeElement)); i++) await page.keyboard.press('Tab');
              assert.ok(await submit.evaluate(n => n === document.activeElement));
            }
            await page.waitForTimeout(180);
            const value = await submit.evaluate(paint);
            assert.equal(value.disabled, false);
            assert.equal(value.backgroundImage, 'none');
            for (const ancestor of value.ancestors) assert.deepEqual(ancestor, { opacity: '1', filter: 'none', mixBlendMode: 'normal' });
            if (state.startsWith('focus')) {
              assert.equal(value.focusVisible, true);
              assert.equal(value.outlineStyle, 'solid');
              assert.ok(parseFloat(value.outlineWidth) >= 2);
            }
            const ratio = contrast(value.foreground, value.background);
            samples.push({ repetition, version, theme, state, ...value, ratio });
            if (version === 'after') assert.ok(ratio >= 4.5, `${theme} ${state}: ${ratio}`);
          }
          await page.keyboard.press('Escape');
        }
      } finally { await context.close(); }
    }
  }
  // Selected controls and all non-hover primary states retain their exact paint.
  for (const before of selected.filter(row => row.version === 'before')) {
    const after = selected.find(row => row.version === 'after' && row.repetition === before.repetition && row.theme === before.theme);
    for (const state of ['rest', 'hover']) for (const key of ['foreground', 'background']) assert.equal(after[state][key], before[state][key]);
  }
  for (const before of samples.filter(row => row.version === 'before')) {
    if (before.theme === 'light' && before.state.includes('hover')) continue;
    const after = samples.find(row => row.version === 'after' && row.repetition === before.repetition && row.theme === before.theme && row.state === before.state);
    for (const key of ['foreground', 'background', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset']) assert.equal(after[key], before[key]);
  }
  for (const version of ['before', 'after']) for (const theme of ['light', 'dark', 'gray']) for (const state of ['rest', 'hover', 'focus', 'focus-hover']) {
    const values = samples.filter(row => row.version === version && row.theme === theme && row.state === state).map(row => row.ratio).sort((a, b) => a - b);
    console.log(`${version} ${theme} ${state}: median ${values[2].toFixed(4)}:1; min ${values[0].toFixed(4)}, max ${values.at(-1).toFixed(4)}`);
  }
  console.log(`${samples.length} enabled primary samples; ${selected.length} selected-control samples; all after checks passed. Disabled controls excluded; focus-edge contrast not evaluated.`);
} finally {
  await browser?.close(); await app?.close(); await rm(dataDir, { recursive: true, force: true });
  await writeFile(options.output, JSON.stringify({ samples, selected }, null, 2) + '\n');
}
