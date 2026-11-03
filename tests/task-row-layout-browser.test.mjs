import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { taskRowLayoutFixture } from './helpers/task-row-layout-fixture.mjs';

const web = new URL('../app/web/', import.meta.url);
const shell = (await readFile(new URL('index.html', web), 'utf8'))
  .replace('</head>', '<link rel="stylesheet" href="/duo-tasks.css"></head>')
  .replace('<script type="module" src="/main.mjs"></script>', '<script type="module" src="/fixture.mjs"></script>');

// No app server or save imports: this host serves only shipped CSS/modules and
// synthetic rows. Use the same bounded ports as the gallery/browser helpers.
test('task rows fit their list container and keep actions reachable', { timeout: 60000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'rs3-row-layout-'));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://fixture').pathname;
      const file = new URL('.' + pathname, web);
      if (!file.href.startsWith(web.href)) throw new Error('Outside fixture');
      if (pathname === '/data/dataset-runtime.json') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ dataset:{ id:'synthetic', digest:'fixture' }, values:{ 'app/core/game-progress.mjs#defaultRuneScapeNames':['Player 2', 'Explorer'] } }));
        return;
      }
      const type = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript';
      response.setHeader('Content-Type', pathname === '/' ? 'text/html' : type);
      const bytes = pathname === '/' ? shell : pathname === '/fixture.mjs' ? taskRowLayoutFixture
        : await readFile(file).catch(() => readFile(new URL('.' + pathname, new URL('../app/', import.meta.url))));
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8966, '127.0.0.1', resolve); });
    browser = await openChrome(await findChrome(), path.join(scratch, 'chrome'), { port: 8967 });
    const errors = [];
    browser.listeners.add(({ method, params }) => { if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text); });
    await browser.send('Page.navigate', { url: 'http://127.0.0.1:8966/' });
    await until(async () => { if (errors.length) throw new Error(errors.join('\n')); return browser.evaluate('document.documentElement.dataset.fixtureReady === "true"'); });
    await browser.evaluate(`(() => {
      document.querySelector('.workspace').replaceChildren(document.querySelector('.task-sidebar'));
      const panel = document.querySelector('.task-sidebar');
      panel.replaceChildren(document.querySelector('#active-tasks'));
      document.querySelector('.topbar').hidden = true;
      const style = document.createElement('style');
      style.textContent = '.workspace { display:grid;grid-template-columns:minmax(0,1fr) var(--fixture-panel);height:auto;min-height:100vh;align-items:start } .task-sidebar { grid-column:2;width:100%;height:auto;max-height:none;overflow:visible;box-sizing:border-box } body { overflow:auto } *,*::before,*::after { transition:none!important;animation:none!important }';
      document.head.append(style);
    })()`);
    for (const [name, viewport, listWidth] of [['narrow-260', 1280, 260], ['narrow-320', 1280, 320], ['wide', 1440, 600], ['phone-390', 390, 360]]) {
      await t.test(name, async () => {
        const phone = viewport === 390;
        await browser.send('Emulation.setDeviceMetricsOverride', { width: viewport, height: 1000, deviceScaleFactor: 1, mobile: phone });
        await browser.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 1 });
        await browser.evaluate(`(() => { const s = getComputedStyle(document.querySelector('.task-sidebar'));
          const extra = ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + parseFloat(s[key]), 0);
          document.documentElement.style.setProperty('--fixture-panel', (${listWidth} + extra) + 'px'); })()`);
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        await browser.evaluate('document.activeElement?.blur(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const metrics = await browser.evaluate(`(() => {
          const box = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
          const row = document.querySelector('#solo'), body = row.querySelector('.task-body'), label = row.querySelector('.task-label-button');
          return { panel:box(document.querySelector('.task-sidebar')), list:box(document.querySelector('#active-tasks')), body:box(body), label:box(label),
            how:box(row.querySelector('.task-how')), claim:box(row.querySelector('.task-claim-action')),
            whyPosition:getComputedStyle(row.querySelector('.task-why')).position,
            overflow:[...document.querySelectorAll('.task-row')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.id),
            expanded:box(document.querySelector('#open .task-how-panel')), openBody:box(document.querySelector('#open .task-body')),
            form:box(document.querySelector('.backlog-form')), backlogBody:box(document.querySelector('#backlogged .task-body')),
            checkbox:box(row.querySelector('input')), howHeight:row.querySelector('.task-how').getBoundingClientRect().height,
            wordWrap:getComputedStyle(label).overflowWrap,
            splitWords:[...label.textContent.matchAll(/\\S+/g)].filter(word => { const range = document.createRange(); range.setStart(label.firstChild, word.index); range.setEnd(label.firstChild, word.index + word[0].length); return range.getClientRects().length > 1; }).map(word => word[0]),
            claimLines:(() => { const range = document.createRange(); range.selectNodeContents(row.querySelector('.task-claim-action')); return range.getClientRects().length; })(),
            rows:[...document.querySelectorAll('.task-row')].map(row => ({ id:row.id, body:box(row.querySelector('.task-body')), row:box(row) })) };
        })()`);
        if (process.env.RS3_LAYOUT_SHOTS) {
          await mkdir(process.env.RS3_LAYOUT_SHOTS, { recursive: true });
          const shot = await browser.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, clip:{ x:metrics.panel.x, y:metrics.panel.y, width:metrics.panel.width, height:metrics.panel.height, scale:1 } });
          const prefix = process.env.RS3_LAYOUT_SHOT_PREFIX ?? 'after';
          await writeFile(path.join(process.env.RS3_LAYOUT_SHOTS, prefix + '-' + name + '.png'), Buffer.from(shot.data, 'base64'));
          await writeFile(path.join(process.env.RS3_LAYOUT_SHOTS, prefix + '-' + name + '.json'), JSON.stringify(metrics, null, 2));
        }
        assert.ok(Math.abs(metrics.list.width - listWidth) < 1, 'inline containment must not collapse the list');
        assert.deepEqual(metrics.overflow, [], 'rows, including duo/completed/backlog, must fit');
        assert.equal(metrics.claimLines, 1, 'claim stays on one line');
        if (listWidth <= 360) {
          assert.ok(metrics.body.width > listWidth - (phone ? 60 : 35), 'text body uses the remaining first line');
          assert.ok(metrics.how.y >= metrics.body.bottom, 'How is below the task body');
          assert.equal(metrics.wordWrap, 'break-word', 'normal words wrap at spaces, long identifiers still fit');
          assert.deepEqual(metrics.splitWords, [], 'ordinary words must not break across lines');
          if (!phone) assert.equal(metrics.whyPosition, 'absolute', 'hidden icons do not occupy a track');
          assert.ok(metrics.expanded.y >= metrics.openBody.bottom, 'expanded How follows the body');
          assert.ok(metrics.expanded.width >= metrics.openBody.width - 1, 'expanded How keeps the full body width');
          assert.ok(metrics.form.y >= metrics.backlogBody.bottom, 'backlog form follows the body');
          for (const row of metrics.rows) assert.ok(row.body.width > listWidth - (phone ? 60 : 35), row.id + ' body gets the width');
        } else {
          assert.ok(metrics.how.y < metrics.body.bottom, 'wide layout retains inline How');
        }
        if (phone) { assert.ok(metrics.checkbox.width >= 44); assert.ok(metrics.howHeight >= 44); }
        // Tab into a formerly transparent icon: focus-within must reveal it.
        await browser.evaluate("document.querySelector('#solo .task-how').focus()");
        await browser.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
        await browser.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
        await browser.evaluate('new Promise(resolve => setTimeout(resolve, 150))');
        assert.equal(await browser.evaluate("document.activeElement === document.querySelector('#solo .task-why') && getComputedStyle(document.activeElement).opacity === '1'"), true, 'keyboard reveals actions in DOM order');
        const focused = await browser.evaluate(`(() => { const row = document.querySelector('#solo'), body = row.querySelector('.task-body').getBoundingClientRect(), action = row.querySelector('.task-backlog'), box = action.getBoundingClientRect(); return { width:body.width, height:body.height, position:getComputedStyle(document.activeElement).position, reachable:document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.task-backlog') === action }; })()`);
        assert.equal(focused.width, metrics.body.width, 'revealing actions cannot squeeze the body');
        assert.equal(focused.height, metrics.body.height, 'revealing actions cannot rewrap the name');
        assert.equal(focused.reachable, true, 'backlog remains clickable');
        assert.equal(focused.position, 'static', 'focused actions rejoin the secondary line');
        await browser.evaluate('document.activeElement.blur()');
      });
    }
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }
});
