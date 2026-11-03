import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { taskRowLayoutFixture } from './helpers/task-row-layout-fixture.mjs';

const intersects = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
const web = new URL('../app/web/', import.meta.url);
function statusRowBoxes() {
  const box = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; };
  return [...document.querySelectorAll('.task-row:has(>.task-completion-status)')].map(row => {
    // Measure the painted text: a fixed grid track can be narrower than its label.
    const text = document.createRange(); text.selectNodeContents(row.querySelector('.task-completion-status'));
    return { id:row.id, status:box(text), icon:box(row.querySelector('.task-icon')), label:box(row.querySelector('.task-label-button')) };
  });
}
const shell = (await readFile(new URL('index.html', web), 'utf8'))
  .replace('</head>', '<link rel="stylesheet" href="/duo-tasks.css"></head>')
  .replace('<script type="module" src="/main.mjs"></script>', '<script type="module" src="/fixture.mjs"></script>');

// No app server or save imports: this host serves only shipped CSS/modules and
// synthetic rows. Let the OS assign ports for both this host and owned Chrome.
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
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await openChrome(await findChrome(), path.join(scratch, 'chrome'), {
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const errors = [];
    browser.listeners.add(({ method, params }) => { if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text); });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
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
    const statusLayouts = [];
    for (const [name, viewport, listWidth] of [['narrow-260', 1280, 260], ['narrow-320', 1280, 320], ['wide', 1440, 600], ['phone-390', 390, 360], ['tablet-1024-coarse', 1024, 320], ['mouse-700', 700, 320]]) {
      await t.test(name, async () => {
        const phone = viewport === 390;
        const touch = phone || name === 'tablet-1024-coarse';
        const largeTargets = touch || viewport <= 720;
        await browser.send('Emulation.setDeviceMetricsOverride', { width: viewport, height: 1000, deviceScaleFactor: 1, mobile: phone });
        await browser.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
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
            statusRows:(${statusRowBoxes})(),
            rows:[...document.querySelectorAll('.task-row')].map(row => ({ id:row.id, body:box(row.querySelector('.task-body')), row:box(row) })) };
        })()`);
        statusLayouts.push({ name, rows:metrics.statusRows });
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
          assert.ok(metrics.body.width > listWidth - (largeTargets ? 60 : 35), 'text body uses the remaining first line');
          assert.ok(metrics.how.y >= metrics.body.bottom, 'How is below the task body');
          assert.equal(metrics.wordWrap, 'break-word', 'normal words wrap at spaces, long identifiers still fit');
          assert.deepEqual(metrics.splitWords, [], 'ordinary words must not break across lines');
          if (!largeTargets) assert.equal(metrics.whyPosition, 'absolute', 'hidden icons do not occupy a track');
          assert.ok(metrics.expanded.y >= metrics.openBody.bottom, 'expanded How follows the body');
          assert.ok(metrics.expanded.width >= metrics.openBody.width - 1, 'expanded How keeps the full body width');
          assert.ok(metrics.form.y >= metrics.backlogBody.bottom, 'backlog form follows the body');
          for (const row of metrics.rows) {
            assert.ok(row.body.width > listWidth - (largeTargets ? 60 : 35), row.id + ' body gets the width');
            assert.equal(row.body.x, metrics.body.x, row.id + ' keeps the task body aligned');
          }
        } else {
          assert.ok(metrics.how.y < metrics.body.bottom, 'wide layout retains inline How');
        }
        if (largeTargets) { assert.ok(metrics.checkbox.width >= 44); assert.ok(metrics.howHeight >= 44); }
        // Every row type keeps its geometry while actions appear. Compare painted
        // controls, ignoring transparent icons and explicitly hidden actions.
        const rowGeometry = async () => browser.evaluate(`(() => {
          const box = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, height:r.height }; };
          return [...document.querySelectorAll('.task-row')].map(row => ({ id:row.id, ...box(row),
            controls:[...row.querySelectorAll(':scope > input[type=checkbox], :scope > .icon-button, .task-icon')]
              .filter(node => { const s = getComputedStyle(node); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0; })
              .map(node => ({ name:node.className || node.tagName, ...box(node) })) }));
        })()`);
        const checkIntersections = rows => {
          for (const row of rows) for (let i = 0; i < row.controls.length; i++) for (let j = i + 1; j < row.controls.length; j++) {
            assert.ok(!intersects(row.controls[i], row.controls[j]), name + ' ' + row.id + ': ' + row.controls[i].name + ' intersects ' + row.controls[j].name);
          }
        };
        const resting = await rowGeometry();
        checkIntersections(resting);
        for (const row of resting) {
          await browser.evaluate('document.activeElement?.blur()');
          await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:1, y:1 });
          const target = await browser.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(row.id)}); r.scrollIntoView({block:'center'}); const b = r.getBoundingClientRect(); return { x:b.x + 2, y:b.y + 2 }; })()`);
          await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...target });
          const hovered = await rowGeometry();
          checkIntersections(hovered);
          assert.deepEqual(hovered.map(r => [r.id, r.height]), resting.map(r => [r.id, r.height]), row.id + ': hover must preserve every row height');
          await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:1, y:1 });
          await browser.evaluate(`document.getElementById(${JSON.stringify(row.id)}).querySelector('.task-why, .task-how, button, a').focus()`);
          const focusedRows = await rowGeometry();
          checkIntersections(focusedRows);
          assert.deepEqual(focusedRows.map(r => [r.id, r.height]), resting.map(r => [r.id, r.height]), row.id + ': focus must preserve every row height');
        }
        await browser.evaluate("document.activeElement?.blur(); document.querySelector('#solo').scrollIntoView()");
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
    await t.test('status text, icon and task name never overlap', async () => {
      // Also cover phone columns above the narrow-container breakpoint.
      for (const [viewport, listWidth] of [[1440, 361], [390, 375], [720, 600]]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width:viewport, height:1000, deviceScaleFactor:1, mobile:viewport <= 720 });
        await browser.evaluate(`(() => { const s = getComputedStyle(document.querySelector('.task-sidebar'));
          const extra = ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + parseFloat(s[key]), 0);
          document.documentElement.style.setProperty('--fixture-panel', (${listWidth} + extra) + 'px'); })()`);
        statusLayouts.push({ name:viewport + '/' + listWidth, rows:await browser.evaluate(`(${statusRowBoxes})()`) });
      }
      const intersects = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      for (const { name, rows } of statusLayouts) {
        assert.equal(rows.length, 2, name + ' covers Done and Not done');
        for (const row of rows) {
          assert.ok(!intersects(row.status, row.icon), name + ' ' + row.id + ': status and icon must not intersect');
          assert.ok(!intersects(row.status, row.label), name + ' ' + row.id + ': status and name must not intersect');
          assert.ok(!intersects(row.icon, row.label), name + ' ' + row.id + ': icon and name must not intersect');
        }
      }
    });
    await browser.evaluate('window.appendLayoutRegressions()');
    const layout = async (ids, listWidth, touch = false, viewport = 1280) => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width:viewport, height:1000, deviceScaleFactor:1, mobile:false });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled:touch, maxTouchPoints:1 });
      await browser.evaluate(`(() => {
        const ids = ${JSON.stringify(ids)};
        for (const row of document.querySelectorAll('.task-row')) row.hidden = !ids.includes(row.id);
        const s = getComputedStyle(document.querySelector('.task-sidebar'));
        const extra = ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + parseFloat(s[key]), 0);
        document.documentElement.style.setProperty('--fixture-panel', (${listWidth} + extra) + 'px');
        document.activeElement?.blur(); window.scrollTo(0, 0);
      })()`);
      await browser.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:1, y:1 });
      assert.equal(await browser.evaluate('matchMedia("(pointer:coarse)").matches'), touch, 'exercise the requested pointer');
      assert.ok(Math.abs(await browser.evaluate('document.querySelector("#active-tasks").getBoundingClientRect().width') - listWidth) < 1, 'exercise the requested list width');
    };
    // Restore only the matching pre-fix declaration in memory, then remove it.
    // The same geometry assertions must reject the old rule and accept shipped CSS.
    const withOldCSS = async (css, measure) => {
      await browser.evaluate(`(() => { const s = document.createElement('style'); s.id = 'old-layout-rule'; s.textContent = ${JSON.stringify(css)}; document.head.append(s); })()`);
      try { return await measure(); }
      finally { await browser.evaluate('document.querySelector("#old-layout-rule").remove()'); }
    };
    const screenshot = async name => {
      if (!process.env.RS3_LAYOUT_SHOTS) return;
      await mkdir(process.env.RS3_LAYOUT_SHOTS, { recursive:true });
      const clip = await browser.evaluate(`(() => { const r = document.querySelector('.task-sidebar').getBoundingClientRect(); return { x:r.x + scrollX, y:r.y + scrollY, width:r.width, height:r.height, scale:1 }; })()`);
      const shot = await browser.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, clip });
      await writeFile(path.join(process.env.RS3_LAYOUT_SHOTS, (process.env.RS3_LAYOUT_SHOT_PREFIX ?? 'after') + '-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    const duoActions = async () => browser.evaluate(`(() => {
      const row = document.querySelector('#duo');
      row.querySelector('.task-how').focus(); row.scrollIntoView({block:'center'});
      const control = selector => {
        const node = row.querySelector(selector), r = node.getBoundingClientRect(), s = getComputedStyle(node);
        return { x:r.x, y:r.y, right:r.right, bottom:r.bottom,
          visible:r.width > 0 && r.height > 0 && s.visibility === 'visible' && Number(s.opacity) > 0 && !node.hidden,
          clickable:!node.disabled && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === node };
      };
      return { why:control('.task-why'), backlog:control('.duo-task-backlog') };
    })()`);
    const assertDuoActions = ({ why, backlog }) => {
      assert.equal(why.visible && backlog.visible, true, 'Why and Backlog are visible');
      assert.ok(!intersects(why, backlog), 'duo Why and Backlog must not overlap');
      assert.equal(why.clickable, true, 'duo Why centre must be clickable');
      assert.equal(backlog.clickable, true, 'duo Backlog centre must be clickable');
    };
    for (const width of [260, 320]) for (const touch of [false, true]) {
      await t.test('duo How, Why and Backlog at ' + width + '/' + (touch ? 'coarse' : 'fine'), async () => {
        await layout(['duo'], width, touch);
        const old = await withOldCSS('@container task-list (max-width:360px){.task-row>.duo-task-backlog{grid-column:3 / -1}}', duoActions);
        assert.throws(() => assertDuoActions(old), { code:'ERR_ASSERTION' }, 'old duo backlog track must fail');
        t.diagnostic('Old CSS: Why/Backlog overlap=' + intersects(old.why, old.backlog) + ', centres clickable=' + old.why.clickable + '/' + old.backlog.clickable);
        assertDuoActions(await duoActions());
        if (width === 260) await screenshot('narrow-260-duo-' + (touch ? 'coarse' : 'fine'));
      });
    }
    const claimBoxes = async () => browser.evaluate(`(() => {
      const row = document.querySelector('.task-row:not([hidden])'), body = row.querySelector('.task-body'), claim = row.querySelector('.task-claim-action');
      const box = node => { const r = node.getBoundingClientRect(); return { x:r.x, right:r.right, y:r.y, bottom:r.bottom }; };
      const text = document.createRange(); text.selectNodeContents(claim);
      return { text:claim.textContent, row:{ scroll:row.scrollWidth, client:row.clientWidth }, body:{ scroll:body.scrollWidth, client:body.clientWidth, ...box(body) }, claim:box(claim), lines:text.getClientRects().length };
    })()`);
    const assertClaimFits = m => {
      assert.ok(m.row.scroll <= m.row.client + 1, 'long claim must not scroll the row: ' + JSON.stringify(m.row));
      assert.ok(m.body.scroll <= m.body.client + 1, 'long claim must not scroll the body: ' + JSON.stringify(m.body));
      assert.ok(m.claim.x >= m.body.x - 1 && m.claim.right <= m.body.right + 1 && m.claim.y >= m.body.y - 1 && m.claim.bottom <= m.body.bottom + 1, 'claim button stays inside the body');
    };
    for (const id of ['long-claim', 'long-takeover']) for (const touch of [false, true]) {
      await t.test(id + ' at 260/' + (touch ? 'coarse' : 'fine'), async () => {
        await layout([id], 260, touch);
        const old = await withOldCSS('@container task-list (max-width:360px){.task-claim-action{white-space:nowrap;overflow-wrap:normal;max-width:none}}', claimBoxes);
        assert.throws(() => assertClaimFits(old), { code:'ERR_ASSERTION' }, 'old nowrap claim must fail');
        t.diagnostic('Old CSS: row ' + old.row.scroll + '/' + old.row.client + ', body ' + old.body.scroll + '/' + old.body.client);
        const current = await claimBoxes();
        assert.equal(current.text, (id === 'long-claim' ? 'Claim for ' : 'Take over for ') + 'Explorer number one with a long partner name');
        assertClaimFits(current);
        assert.ok(current.lines > 1, 'long partner name wraps');
        if (touch) await screenshot('narrow-260-' + id + '-coarse');
      });
    }
    for (const [viewport, touch] of [[1440, false], [1440, true], [720, false]]) {
      await t.test('read-only duo with How at ' + viewport + '/' + (touch ? 'coarse' : 'fine'), async () => {
        await layout(['duo-readonly', 'duo-done'], 600, touch, viewport);
        assert.deepEqual(await browser.evaluate(`['duo-readonly','duo-done'].map(id => {
          const row = document.getElementById(id);
          return { status:row.querySelector('.task-completion-status').textContent, checkbox:!!row.querySelector('input[type=checkbox]'), how:!!row.querySelector('.task-how') };
        })`), [{ status:'Not done', checkbox:false, how:true }, { status:'Done', checkbox:false, how:true }]);
        const measure = () => browser.evaluate(`(${statusRowBoxes})().filter(row => row.id.startsWith('duo-'))`);
        const check = rows => {
          assert.equal(rows.length, 2);
          for (const row of rows) assert.ok(!intersects(row.status, row.icon), row.id + ': read-only duo status must not overlap the task icon');
        };
        const old = await withOldCSS('.duo-task-row:has(>.task-how){grid-template-columns:18px minmax(0,1fr) auto auto auto}@media(max-width:720px),(pointer:coarse){:root .duo-task-row:has(>.task-how){grid-template-columns:44px minmax(0,1fr) auto auto auto}}', measure);
        assert.throws(() => check(old), { code:'ERR_ASSERTION' }, 'old fixed status track must fail');
        t.diagnostic('Old CSS: overlapping status=' + old.filter(row => intersects(row.status, row.icon)).map(row => row.id).join(','));
        check(await measure());
        if (viewport === 1440 && !touch) await screenshot('wide-readonly-duo');
      });
    }
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  }
});
