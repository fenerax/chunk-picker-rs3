// Browser-only audit on a disposable public/synthetic local save; no project deps.
// Example (install playwright-core and axe-core in a scratch directory first):
// node scripts/perf/accessibility-browser.mjs --playwright /scratch/node_modules/playwright-core/index.mjs \
//   --axe /scratch/node_modules/axe-core/axe.min.js --session /scratch/session.json \
//   --url http://127.0.0.1:8957 --baseline-web /scratch/START-web --output /scratch/results.json --shots /scratch/shots
// --baseline-web is a copy of START's app/web. Results alternate before/after,
// after/before, before/after in fresh browser contexts; no speed claims are made.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
for (const key of ['playwright', 'axe', 'session', 'url', 'output']) if (!options[key]) throw Error(`Missing --${key}`);
const origin = new URL(options.url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw Error('Use a disposable loopback server.');
const { chromium } = await import(pathToFileURL(resolve(options.playwright)));
const browser = await chromium.launch({ executablePath: options.chromium ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const changed = new Set(['index.html', 'screen-dialogs.mjs', 'screen-search.mjs', 'screen-ui.mjs', 'style.css']);
const results = [];
let captured = false;
try {
  for (const [pair, order] of (options['baseline-web'] ? [['before', 'after'], ['after', 'before'], ['before', 'after']] : [['after']]).entries()) {
    for (const version of order) {
      const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, storageState: options.session });
      const result = { pair: pair + 1, version, checks: {}, axe: [], contrast: {}, errors: [] }; results.push(result);
      try {
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin.origin) return route.abort();
          const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          if (version === 'before' && changed.has(file)) return route.fulfill({ body: await readFile(join(options['baseline-web'], file)), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', error => result.errors.push(error.message));
        const check = (name, passed) => { result.checks[name] = !!passed; };
        const activeId = () => page.evaluate(() => document.activeElement.id);
        const key = async name => { await page.keyboard.press(name); await page.waitForTimeout(40); };
        const tabTo = async selector => {
          for (let i = 0; i < 400; i++) {
            if (await page.locator(selector).evaluateAll(nodes => nodes.includes(document.activeElement))) return;
            await key('Tab');
          }
          throw Error(`Keyboard cannot reach ${selector}`);
        };
        const activate = async selector => { await tabTo(selector); await key('Enter'); };
        const audit = async surface => {
          await page.waitForTimeout(180); // Exclude the native dialog entrance animation.
          const value = await page.evaluate(async () => {
            const report = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
            return report.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }));
          });
          result.axe.push({ surface, violations: value });
        };
        const shot = async name => {
          if (!options.shots || captured || version !== 'after') return;
          await mkdir(options.shots, { recursive: true }); await page.screenshot({ path: join(options.shots, name) });
        };
        const appearance = async theme => {
          if (await page.locator('html').getAttribute('data-theme') !== theme) {
            await activate('#more-tools summary'); await activate(`#theme-${theme}`);
            await page.waitForFunction(() => document.getElementById('save-status').dataset.status === 'saved');
            await page.waitForTimeout(250);
          }
          if (await page.locator('#more-tools').evaluate(n => n.open)) await key('Escape');
          await page.waitForTimeout(180); // Let theme colour transitions settle before contrast checks.
          result.contrast[theme] = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            const rgb = key => {
              const node = document.createElement('span'); node.style.color = style.getPropertyValue(key); document.body.append(node);
              const channels = getComputedStyle(node).color.match(/[\d.]+/g).slice(0, 3).map(Number); node.remove(); return channels;
            };
            const luminance = key => rgb(key).map(channel => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return +((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(2); };
            return { textPanel: ratio('--text', '--panel'), mutedPanel: ratio('--muted', '--panel'), focusMinimum: Math.min(...['--bg', '--panel', '--surface'].map(key => ratio('--focus', key))) };
          });
        };
        await page.goto(origin.origin); await page.locator('#task-engine-status').filter({ hasText: /possible tasks/ }).waitFor();
        await page.addScriptTag({ path: options.axe });
        await appearance('dark');
        await activate('#more-tools summary'); check('More opens by keyboard', await page.locator('#more-tools').evaluate(n => n.open));
        check('Focus ring visible', await page.locator('#more-tools summary').evaluate(n => getComputedStyle(n).outlineStyle === 'solid' && parseFloat(getComputedStyle(n).outlineWidth) >= 2));
        await audit('More dark');
        await activate('#settings-open'); check('Settings modal', await page.locator('#tool-dialog').evaluate(n => n.matches(':modal')));
        let trapped = true;
        for (let i = 0; i < 35; i++) {
          await key('Tab');
          if (await page.evaluate(() => document.activeElement === document.body)) await key('Tab'); // Chromium's native wrap stop.
          trapped &&= await page.locator('#tool-dialog').evaluate(n => n.contains(document.activeElement));
        }
        check('Settings Tab stays in modal scope', trapped); await audit('Settings dark'); await key('Escape');
        check('Settings focus returns', await page.locator('#more-tools summary').evaluate(n => n === document.activeElement));
        await activate('#search-open'); await page.locator('.search-result button').first().waitFor();
        check('Search input focused and labeled', await page.getByLabel('Search across your map', { exact: true }).evaluate(n => n === document.activeElement));
        check('Result action named', (await page.locator('.search-result button').first().getAttribute('aria-label'))?.startsWith('View '));
        await audit('Search dark');
        await activate('.search-result button'); await page.waitForTimeout(80);
        check('Result focus reaches Chunk Info', await activeId() === 'chunk-close'); await shot('08-after-chunk-focus-dark.png');
        await tabTo('#chunk-content [role=tab]'); await key('End');
        check('Chunk End selects last tab', await page.locator('#chunk-content [role=tab]').last().evaluate(n => n === document.activeElement && n.getAttribute('aria-selected') === 'true'));
        await key('Home'); await key('ArrowRight');
        check('Chunk arrows select adjacent tab', await page.locator('#chunk-content [role=tab]').nth(1).evaluate(n => n === document.activeElement && n.getAttribute('aria-selected') === 'true'));
        await audit('Chunk Info dark'); await key('Escape'); check('Chunk Escape focuses map', await activeId() === 'map-hover');
        await tabTo('#task-filter'); await page.keyboard.type('journey'); check('Task search reachable', await activeId() === 'task-filter'); await key('ControlOrMeta+A'); await key('Backspace');
        await tabTo('#show-all'); const previous = await page.locator('#show-all').isChecked(); await key('Space');
        check('Possible tasks toggles', (await page.locator('#show-all').isChecked()) !== previous);
        await activate('#task-filters-toggle'); await key('Escape'); check('Filters Escape restores toggle', await activeId() === 'task-filters-toggle');
        check('Saved live status', await page.locator('#save-status').getAttribute('role') === 'status');
        check('Saved atomic status', await page.locator('#save-status').getAttribute('aria-atomic') === 'true');
        await appearance('light'); await audit('Tasks light');
        await activate('#more-tools summary'); await activate('#settings-open'); await audit('Settings light'); await key('Escape');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        result.reducedTransitionMs = await page.locator('#legend-details > summary').evaluate(n => parseFloat(getComputedStyle(n, '::before').transitionDuration) * 1000);
        check('Reduced motion stops disclosure transition', result.reducedTransitionMs === 0);
        await activate('#more-tools summary'); await activate('#settings-open');
        check('Reduced motion stops dialog animation', await page.locator('#tool-dialog').evaluate(n => getComputedStyle(n).animationName === 'none')); await key('Escape');
        await page.setViewportSize({ width: 390, height: 844 }); await tabTo('#phone-tab-map'); await key('ArrowRight');
        check('Phone Tasks arrow navigation', await activeId() === 'phone-tab-tasks' && await page.locator('#phone-task-panel').isVisible());
        await audit('Phone Tasks light'); await key('ArrowRight');
        check('Phone More arrow navigation', await activeId() === 'phone-tab-more' && await page.locator('#phone-more').isVisible());
        await audit('Phone More light');
        await activate('#more-tools summary'); await activate('#settings-open'); await audit('Phone Settings light'); await key('Escape');
        check('Phone Settings returns to More summary', await page.locator('#more-tools summary').evaluate(n => n === document.activeElement));
        await activate('#search-open'); await page.locator('.search-result button').first().waitFor(); await activate('.search-result button'); await page.waitForTimeout(80);
        check('Phone result focus reaches visible Chunk Info', await activeId() === 'chunk-close' && await page.locator('#chunk-info').isVisible());
        await shot('09-after-phone-chunk-focus-light.png');
        if (version === 'after') captured = true;
      } finally { await context.close(); }
      for (const surface of result.axe) for (const violation of surface.violations) {
        const known = violation.id === 'nested-interactive' && violation.targets.every(target => target.length === 1 && target[0] === '#completed-details > summary');
        if (!known) result.errors.push(`Unexpected axe violation: ${surface.surface}: ${violation.id}`);
      }
      result.pass = Object.values(result.checks).filter(Boolean).length; result.fail = Object.values(result.checks).filter(value => !value).length;
      await writeFile(options.output, JSON.stringify(results, null, 2) + '\n');
      console.log(`${result.version} pair ${result.pair}: ${result.pass} pass / ${result.fail} fail; reduced transition ${result.reducedTransitionMs} ms`);
    }
  }
} finally { await browser.close(); await writeFile(options.output, JSON.stringify(results, null, 2) + '\n'); }
if (results.some(result => result.version === 'after' && (result.fail || result.errors.length))) process.exitCode = 1;
