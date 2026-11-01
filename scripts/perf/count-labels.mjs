// Full startup/navigation on public synthetic fixtures, alternating START UI and
// candidate UI. Requires an external playwright-core installation, no repo deps.
// node scripts/perf/count-labels.mjs --playwright /path/to/playwright-core/index.mjs --baseline SHA --runs 3 --output /tmp/count-labels.json
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const options = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
assert.ok(options.playwright && options.baseline && options.output, 'Require --playwright, --baseline and --output');
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || major === 24 && minor >= 20, 'Use Node 24.20+');
const runs = Number(options.runs ?? 3); assert.ok(Number.isInteger(runs) && runs > 0);
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_GAME_DEFAULTS_FILE', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
process.env.RS3_DATASET = 'duo-legacy';
const { chromium } = await import(pathToFileURL(path.resolve(options.playwright)));
const { createServer } = await import('../../app/server.mjs');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
const { countLabelFixture } = await import('../../tests/fixtures/count-labels.mjs');
const changed = ['index.html', 'screen-tasks.mjs', 'screen-backlog.mjs', 'duo-backlog-view.mjs', 'screen-map.mjs', 'screen-roll.mjs', 'settings-panel.mjs'];
const old = new Map(changed.map(file => [file, execFileSync('git', ['show', `${options.baseline}:app/web/${file}`], { encoding: 'utf8' })]));
const browser = await chromium.launch({ executablePath: options.chrome ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const results = []; let passed = 0, failed = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); passed++; };
const waitText = async (locator, expected) => { await locator.page().waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent === expected, { selector: await locator.evaluate(n => '#' + n.id), expected }); check(await locator.textContent(), expected); };
try {
  for (let run = 0; run < runs; run++) for (const phone of [false, true]) for (const kind of options.kinds?.split(',') ?? ['progress', 'backlog', 'paging']) {
    const pair = [];
    for (const version of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const scratch = await mkdtemp(path.join(tmpdir(), 'count-labels-'));
      const fixture = countLabelFixture(kind), errors = [], observations = [];
      let app, context; const started = performance.now();
      try {
        app = await createServer({ dataset: selectedDataset, dataDir: path.join(scratch, 'save'), definitions: fixture.definitions, initialState: fixture.state, taskMap: {}, host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => 0.25 });
        await app.listen();
        context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
        await context.route('**/*', async route => {
          const url = new URL(route.request().url()), file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          if (url.origin !== new URL(app.inviteUrl).origin) return route.abort();
          if (version === 'before' && old.has(file)) return route.fulfill({ body: old.get(file), contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript' });
          return route.continue();
        });
        const p = await context.newPage(); p.setDefaultTimeout(15000); p.on('pageerror', e => errors.push(e.message));
        const $ = selector => p.locator(selector);
        const settle = async () => { await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
        const click = async target => { const node = typeof target === 'string' ? $(target) : target; if (phone) await node.tap(); else await node.click(); await settle(); };
        const tab = async name => { if (phone) await click('#phone-tab-' + name); };
        const tools = async id => { await tab('more'); if (!await $('#more-tools').evaluate(n => n.open)) await click('#more-tools > summary'); await click('#' + id); };
        const close = async () => { await p.keyboard.press('Escape'); await $('#tool-dialog').waitFor({ state: 'hidden' }); };
        const observe = async label => { await settle(); observations.push({ label, ...await p.evaluate(() => ({ taskNumbers: document.querySelector('#task-count').textContent.match(/\d+/g)?.slice(0, 1), backlog: Number(document.querySelector('#backlog-count').textContent.match(/\d+/)?.[0]), completed: Number(document.querySelector('#completed-count').textContent.match(/\d+/)?.[0]), activeRows: document.querySelectorAll('#active-tasks .task-row').length, backlogRows: document.querySelectorAll('#backlog-tasks .task-row').length, mapNumbers: [...document.querySelectorAll('#map-counts strong')].slice(0, 3).map(n => n.textContent), activeIds: [...document.querySelectorAll('#active-tasks .task-row')].map(n => n.dataset.taskId), backlogIds: [...document.querySelectorAll('#backlog-tasks .task-row')].map(n => n.dataset.taskId), pending: document.querySelectorAll('#pending-panel .pending-choice').length })) });
          const response = await p.request.get(new URL('/api/state', app.inviteUrl).href);
          const { state } = await response.json();
          observations.at(-1).maps = state.members.map(({ id, unlocked, selected, pendingRoll }) => ({ id, unlocked, selected, pendingRoll }));
          if (options.shots && run === 0 && version === 'after' && /:(progress|all-reasons|pending)$/.test(label)) {
            await mkdir(options.shots, { recursive: true });
            await p.screenshot({ path: path.join(options.shots, `${phone ? 'phone' : 'desktop'}-${kind}-${label.replace(':', '-')}.png`) });
          }
        };
        await p.goto(app.inviteUrl, { waitUntil: 'domcontentloaded' });
        await $('#save-status').filter({ hasText: 'Saved' }).waitFor();
        await p.waitForFunction(() => /^Duo tasks \d+/.test(document.querySelector('#task-count').textContent) && !/updating/.test(document.querySelector('#task-count').textContent));
        await tab('tasks');
        for (const member of fixture.state.members) {
          await click($('#member-switch button').filter({ hasText: member.name }));
          await p.waitForFunction(() => !/Loading|updating/.test(document.querySelector('#task-count').textContent));
          if (kind === 'progress') {
            if (await $('#group-view').isChecked()) await click('#group-view');
            await waitText($('#task-count'), version === 'after' ? '25% complete · 1 of 4 included goals' : '25% complete');
            if (version === 'after') { check(await $('#task-progress-help').isVisible(), true); check((await $('#task-progress-help').textContent()).includes('Hide completed, search'), true); }
            await observe(member.id + ':progress');
            await click('#hide-completed');
            await waitText($('#task-count'), version === 'after' ? '0% complete · 0 of 3 included goals' : '0% complete');
            if (!await $('#completed-details').evaluate(n => n.open)) await click('#completed-details > summary');
            await $('#completed-tasks .task-row').first().waitFor(); check(await $('#completed-tasks .task-row').count(), 1);
            await observe(member.id + ':hidden-completed');
            await click('#hide-completed'); await waitText($('#task-count'), version === 'after' ? '25% complete · 1 of 4 included goals' : '25% complete');
            await $('#task-filter').fill('Count goal 00');
            await waitText($('#task-count'), version === 'after' ? '100% complete · 1 of 1 included goal' : '100% complete');
            await observe(member.id + ':search-completed');
            await $('#task-filter').fill('no matches');
            await waitText($('#task-count'), version === 'after' ? '0% complete · 0 of 0 included goals' : '0% complete');
            await $('#task-filter').fill(''); await waitText($('#task-count'), version === 'after' ? '25% complete · 1 of 4 included goals' : '25% complete');
            await tools('settings-open'); await click($('.settings-section-link').filter({ hasText: /^Tasks$/ }));
            if (version === 'after') check((await $(`[id="setting-help-${member.id}-numTasksPercent"]`).textContent()).includes('denominator'), true);
            await close(); await tab('map');
            if (phone && await $('#phone-controls-toggle').getAttribute('aria-expanded') !== 'true') await click('#phone-controls-toggle');
            await click('#pick');
            check((await $('#dialog-content').textContent()).includes(version === 'after' ? '1 chunks in their ordinary roll pool' : '1 chunks in the roll pool'), true);
            await close(); await tools('settings-open'); await click($('.settings-section-link').filter({ hasText: /^Rolling$/ }));
            const anywhere = p.getByRole('checkbox', { name: 'Roll anywhere on walkable terrain', exact: true });
            await click(anywhere); await p.waitForFunction(() => document.querySelector('#save-status').dataset.status === 'saved');
            await close(); await tab('map');
            if (phone && await $('#phone-controls-toggle').getAttribute('aria-expanded') !== 'true') await click('#phone-controls-toggle');
            if (phone) { await tab('more'); await $('#map-counts').scrollIntoViewIfNeeded(); }
            check(await $('#map-counts').isVisible(), true, 'Pool counts are reachable in the map summary (More on phones)');
            if (version === 'after') { check((await $('#map-counts').textContent()).includes('ordinary roll pool'), true); check((await $('#map-counts').textContent()).includes('2 roll-anywhere candidate chunks'), true); }
            if (phone) {
              if (options.shots && run === 0 && version === 'after') {
                await mkdir(options.shots, { recursive: true });
                await p.screenshot({ path: path.join(options.shots, `phone-${member.id}-map-counts.png`) });
              }
              await tab('map');
              if (await $('#phone-controls-toggle').getAttribute('aria-expanded') !== 'true') await click('#phone-controls-toggle');
            }
            await click('#roll-two');
            check((await $('#dialog-content').textContent()).includes(version === 'after' ? '2 roll-anywhere candidate chunks' : '2 chunks in the roll pool'), true);
            await click(p.getByRole('button', { name: 'Roll now', exact: true }));
            await $('#pending-panel .pending-choice').first().waitFor();
            check(await $('#pending-panel .pending-choice').count(), 2); check(await $('#pick').isDisabled(), true); check(await $('#roll-two').isDisabled(), true);
            await observe(member.id + ':pending');
            await click(p.getByRole('button', { name: 'Cancel roll', exact: true }));
            await $('#pending-panel').waitFor({ state: 'hidden' });
            await tab('tasks');
          } else {
            if (!await $('#group-view').isChecked()) await click('#group-view');
            const total = fixture.tasks.length;
            await p.waitForFunction(total => document.querySelector('#backlog-count').textContent.startsWith('(' + total) && !/updating/.test(document.querySelector('#backlog-count').textContent), total);
            if (!await $('#backlog-details').evaluate(n => n.open)) await click('#backlog-details > summary');
            const summary = $('#backlog-actions [role=status]');
            if (version === 'after') check((await summary.textContent()).includes(`${total} unique task${total === 1 ? '' : 's'} · ${total * 2} reason rows`), true);
            for (const details of await $('#backlog-tasks details').all()) {
              if (!await details.evaluate(n => n.open)) await click(details.locator('.backlog-group-title'));
              await p.waitForFunction(() => document.querySelectorAll('#backlog-tasks .task-row').length > 0); await settle();
              if (version === 'after') check((await details.locator('.backlog-group-title').textContent()).includes('reason row'), true);
            }
            if (kind === 'paging') {
              await p.waitForFunction(() => document.querySelectorAll('#backlog-tasks .task-row').length === 140);
              check(await $('#backlog-tasks .task-row').count(), 140);
              while (await $('#backlog-tasks button.wide-button').count()) await click($('#backlog-tasks button.wide-button').first());
            }
            await p.waitForFunction(total => document.querySelectorAll('#backlog-tasks .task-row').length === total * 2, total);
            await observe(member.id + ':all-reasons');
            await click($('#backlog-tasks details').first().locator('.backlog-group-title')); await settle();
            await click($('#backlog-tasks details').first().locator('.backlog-group-title')); await settle();
            const ownerChip = $('.duo-task-chip').filter({ hasText: member.name }); await click(ownerChip);
            await p.waitForFunction(total => document.querySelectorAll('#backlog-tasks details').length === 1 && document.querySelectorAll('#backlog-tasks .task-row').length === Math.min(70, total), total);
            while (await $('#backlog-tasks button.wide-button').count()) await click($('#backlog-tasks button.wide-button').first());
            check(await $('#backlog-tasks .task-row').count(), total);
            if (version === 'after') check((await summary.textContent()).includes(`${total} reason row`), true);
            await observe(member.id + ':owner');
            await click($('.duo-task-chip').filter({ hasText: 'All', exact: true }));
            const search = $('#backlog-actions input'); await search.fill('Count goal 00');
            await p.waitForFunction(() => document.querySelector('#backlog-actions [role=status]').textContent.startsWith('1 of '));
            await observe(member.id + ':backlog-search');
            await search.fill(''); await settle();
            await click($('.duo-task-chip').filter({ hasText: 'Both' }));
            await p.waitForFunction(total => document.querySelector('#backlog-count').textContent.startsWith('(' + total), total);
            await observe(member.id + ':both-owners');
            await click($('.duo-task-chip').filter({ hasText: 'All' }));
            await click('#group-view');
            await p.waitForFunction(() => !document.querySelector('#task-count').textContent.includes('Duo'));
            if (version === 'after') check((await summary.textContent()).includes(`${total} unique task`), true);
            for (const details of await $('#backlog-tasks details').all()) if (!await details.evaluate(n => n.open)) await click(details.locator('.backlog-group-title'));
            await p.waitForFunction(total => document.querySelectorAll('#backlog-tasks .task-row').length === Math.min(70, total), total);
            while (await $('#backlog-tasks button.wide-button').count()) await click($('#backlog-tasks button.wide-button').first());
            check(await $('#backlog-tasks .task-row').count(), total);
            await observe(member.id + ':personal-backlog');
            await click('#group-view');
          }
          await tab('tasks');
        }
        check(errors, [], 'No browser exceptions');
        const overflow = await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)); check(overflow, 0, 'No page overflow');
        const result = { run: run + 1, phone, kind, version, durationMs: performance.now() - started, observations }; results.push(result); pair.push(result);
        console.log(JSON.stringify({ run: run + 1, phone, kind, version, passed }));
      } finally { await context?.close(); await app?.close(); await rm(scratch, { recursive: true, force: true }); }
    }
    check(pair[0].observations, pair[1].observations, 'Before/after numerical observations');
  }
} catch (error) { failed++; throw error; } finally { await browser.close(); await writeFile(options.output, JSON.stringify({ baseline: options.baseline, passed, failed, processPeakRssKiB: process.resourceUsage().maxRSS, results }, null, 2)); }
