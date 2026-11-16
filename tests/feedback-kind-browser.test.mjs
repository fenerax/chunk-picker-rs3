// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { openChrome, until } from '../scripts/perf/cdp.mjs';

test('feedback kinds expose a named radio group and submit the keyboard selection', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'feedback-kind-browser-'));
  let app, browser;
  try {
    const { createServer } = await import('../app/server.mjs');
    app = await createServer({ dataDir: path.join(directory, 'save'), host: '127.0.0.1', port: 0, predictionPrewarm: false });
    await app.listen();
    browser = await openChrome(await findChrome(), path.join(directory, 'chrome'), {
      extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    await browser.send('Page.navigate', { url: app.inviteUrl });
    await until(() => browser.evaluate("document.querySelector('#save-status')?.textContent === 'Saved'"));
    await browser.evaluate("document.querySelector('#feedback-open').click()");
    await until(() => browser.evaluate("Boolean(document.querySelector('.feedback-form'))"));

    const selection = async expected => {
      const { nodes } = await browser.send('Accessibility.getFullAXTree');
      const groups = nodes.filter(node => node.role?.value === 'radiogroup' && node.name?.value === 'Kind of feedback');
      assert.equal(groups.length, 1, 'one named selection group');
      const radios = nodes.filter(node => node.role?.value === 'radio');
      assert.deepEqual(radios.map(node => node.name.value), ['Bug', 'Idea', 'Other']);
      const byId = new Map(nodes.map(node => [node.nodeId, node]));
      const inGroup = node => node?.parentId === groups[0].nodeId || Boolean(node?.parentId && inGroup(byId.get(node.parentId)));
      assert.ok(radios.every(inGroup), 'all options belong to the group');
      assert.deepEqual(radios.filter(node => node.properties.some(property => property.name === 'checked' && property.value.value === 'true'))
        .map(node => node.name.value), [expected], 'exactly one checked option');
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    await browser.send('Input.insertText', { text: 'Synthetic navigation draft' });
    await browser.evaluate(`document.querySelector('.feedback-kind input[value="idea"]').click();
      document.querySelector('.feedback-form input[type="checkbox"]').click();
      document.querySelector('#tool-dialog .close-button').click();`);
    await browser.evaluate("document.querySelector('#history-open').click()");
    await until(() => browser.evaluate("document.querySelector('#dialog-title')?.textContent === 'History'"));
    await browser.evaluate("document.querySelector('#feedback-open').click()");
    await selection('Idea');
    assert.equal(await browser.evaluate("document.querySelector('.feedback-text').value"), 'Synthetic navigation draft');
    assert.equal(await browser.evaluate("document.querySelector('.feedback-form input[type=checkbox]').checked"), false);
    await browser.evaluate("[...document.querySelectorAll('.feedback-form button')].find(node => node.textContent === 'Discard draft').click()");
    assert.equal(await browser.evaluate("document.querySelector('.feedback-text').value"), '');
    assert.equal(await browser.evaluate("document.querySelector('.feedback-form input[type=checkbox]').checked"), true);
    await selection('Bug');
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const [value, label] of [['idea', 'Idea'], ['bug', 'Bug']]) {
        const point = await browser.evaluate(`(() => {
          const chip = document.querySelector('.feedback-kind input[value="${value}"]').nextElementSibling;
          const rect = chip.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
        await selection(label);
      }
    }
    await browser.evaluate("document.querySelector('.feedback-text').focus()");
    // Opening focuses the textarea; Shift+Tab enters the group's checked option.
    await key('Tab', 'Tab', 9, 8);
    assert.equal(await browser.evaluate('document.activeElement.value'), 'bug');
    await key('ArrowRight', 'ArrowRight', 39); await selection('Idea');
    assert.equal(await browser.evaluate('document.activeElement.value'), 'idea');
    await key('ArrowRight', 'ArrowRight', 39); await selection('Other');
    await key('ArrowRight', 'ArrowRight', 39); await selection('Bug');
    await key('ArrowLeft', 'ArrowLeft', 37); await selection('Other');
    assert.equal(await browser.evaluate('getComputedStyle(document.activeElement.nextElementSibling).outlineStyle'), 'solid', 'keyboard focus is visible on the chip');
    await key('Tab', 'Tab', 9);
    assert.equal(await browser.evaluate('document.activeElement.tagName'), 'TEXTAREA', 'Tab leaves the radio group');
    await browser.send('Input.insertText', { text: 'Synthetic keyboard feedback' });
    await key('Tab', 'Tab', 9); // Include context checkbox.
    await key('Tab', 'Tab', 9); // Send feedback.
    assert.equal(await browser.evaluate('document.activeElement.textContent'), 'Send feedback');
    await key('Enter', 'Enter', 13);
    await until(() => browser.evaluate("document.querySelector('.feedback-form [role=status]')?.textContent === 'Thanks, it’s been sent.'"));
    const items = await browser.evaluate("fetch('/api/feedback').then(response => response.json()).then(value => value.items)");
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'other');
    assert.equal(items[0].text, 'Synthetic keyboard feedback');
    assert.equal(items[0].context.dialog, 'History');
    await browser.evaluate("document.querySelector('#tool-dialog .close-button').click(); document.querySelector('#feedback-open').click()");
    assert.equal(await browser.evaluate("document.querySelector('.feedback-text').value"), '');
    await selection('Bug');
    // Explore the reviewer handoff on this isolated synthetic server. Inspect
    // the external URL without navigating to GitHub or creating an issue.
    const click = label => browser.evaluate(`[...document.querySelectorAll('#tool-dialog button')].find(node => node.textContent === ${JSON.stringify(label)}).click()`);
    await until(() => browser.evaluate("Boolean(document.querySelector('.feedback-item'))"));
    await click('Prepare GitHub issue');
    for (const [width, height] of [[2560, 1440], [1920, 1080], [390, 844]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await browser.evaluate(`(() => {
        const input = document.querySelector('.feedback-issue-title'), rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
      })()`), true, `review controls fit at ${width}px`);
    }
    await browser.evaluate(`for (const [selector, value] of [['.feedback-issue-title', 'Reviewed synthetic title'], ['.feedback-issue-body', 'Reviewed synthetic body']]) {
      const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('input', { bubbles: true }));
    }`);
    await click('Preview public draft');
    const href = await browser.evaluate("[...document.querySelectorAll('#tool-dialog a')].find(node => node.textContent === 'Open GitHub issue form').href");
    assert.equal(new URL(href).searchParams.get('body'), 'Reviewed synthetic body');
    assert.equal(new URL(href).searchParams.get('title'), 'Reviewed synthetic title');
    await browser.evaluate("document.querySelector('.feedback-issue-url').value = 'https://github.com/fenerax/chunk-picker-rs3/issues/123'");
    await click('Record issue link');
    await until(() => browser.evaluate("[...document.querySelectorAll('.feedback-item a')].some(node => node.textContent === 'GitHub issue')"));
    const recorded = await browser.evaluate("fetch('/api/feedback').then(response => response.json()).then(value => value.items[0])");
    assert.equal(recorded.issueUrl, 'https://github.com/fenerax/chunk-picker-rs3/issues/123'); assert.equal(recorded.status, 'new');
  } finally {
    await browser?.close();
    await app?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
