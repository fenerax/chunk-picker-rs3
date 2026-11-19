// @test full dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';

for (const width of [2560, 390]) test(`final-character deletion confirms both targets and recovers lost response at width ${width}`, { timeout: 120000 }, async t => {
  const f = await groupHttpFixture(t), account = await f.login('501'), doc = await f.document(), c = doc.characters[0];
  const gateway = http.createServer((request, response) => {
    const upstream = http.request({ host: '127.0.0.1', port: f.app().loopbackAddress().port, path: request.url, method: request.method, agent: false,
      headers: { ...request.headers, host: 'picker.example', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https', ...(request.headers.origin ? { origin: 'https://picker.example' } : {}) } }, reply => { response.writeHead(reply.statusCode, reply.headers); reply.pipe(response); });
    upstream.on('error', error => response.destroy(error)); request.pipe(upstream);
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); });
  const browser = await openChrome(await findChrome(), path.join(f.root, 'deletion-browser'), { signal: t.signal, extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 1440, deviceScaleFactor: 1, mobile: width < 600 });
    const base = `http://127.0.0.1:${gateway.address().port}`, [name, value] = account.cookie.split('; ').find(c => c.startsWith('duo_access=')).split('=');
    await browser.send('Network.setCookie', { name, value, url: base });
    await browser.send('Page.navigate', { url: `${base}/pickers/${c.placement.pickerId}/?character=${c.id}` });
    await until(() => browser.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Skip setup')`));
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Skip setup').click()`);
    await until(() => browser.evaluate(`!document.querySelector('dialog[open]')`));
    await until(() => browser.evaluate(`!!document.querySelector('summary[aria-label="Discord account"]')`));
    const open = `(()=>{if(innerWidth<600&&!document.querySelector('summary[aria-label="Discord account"]').getBoundingClientRect().width)[...document.querySelectorAll('button')].find(b=>b.textContent==='More'&&b.getBoundingClientRect().width).click();const summary=document.querySelector('summary[aria-label="Discord account"]');if(!summary.parentElement.open)summary.click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Delete character').click()})()`;
    await browser.evaluate(open);
    await until(() => browser.evaluate(`document.querySelectorAll('dialog[open] input[type=checkbox]').length===2`));
    const review = await browser.evaluate(`({text:document.querySelector('dialog[open]').innerText,overflow:document.documentElement.scrollWidth>innerWidth})`);
    assert.match(review.text, /final groups/); assert.match(review.text, /login remains/); assert.equal(review.overflow, false);
    const posts = []; let fail = true;
    const observe = ({ method, params }) => { if (method === 'Fetch.requestPaused') { posts.push(JSON.parse(params.request.postData)); void (fail ? browser.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' }) : browser.send('Fetch.continueRequest', { requestId: params.requestId })); fail = false; } };
    browser.listeners.add(observe);
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/deletion*', requestStage: 'Response' }] });
    await browser.evaluate(`document.querySelectorAll('dialog[open] input[type=checkbox]').forEach(c=>c.click());[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent==='Confirm deletion').click()`);
    await until(() => browser.evaluate(`document.querySelector('dialog[open] [role=alert]')?.textContent.includes('Retry the same')`));
    assert.equal((await f.document()).characters.find(row => row.id === c.id).lifecycle, 'retired');
    await browser.evaluate(`document.querySelector('dialog[open] button[aria-label="Close dialog"]').click();${open}`);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('dialog[open] input[type=checkbox]')].every(c=>c.checked)`), true);
    await browser.evaluate(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent==='Confirm deletion').click()`);
    await until(() => browser.evaluate(`location.pathname==='/characters'&&document.body.innerText.includes('Your login remains available')`));
    assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); assert.equal((await f.document()).deletions.length, 1);
    await browser.send('Fetch.disable'); browser.listeners.delete(observe);
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth>innerWidth`), false);
    await browser.evaluate(`document.querySelector('#characters details summary').click()`);
    await until(() => browser.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm deletion')`));
    assert.match(await browser.evaluate(`document.body.innerText`), /empty login/);
  } finally { await browser.close(); }
});
