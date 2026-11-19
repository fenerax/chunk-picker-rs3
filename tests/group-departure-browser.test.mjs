// @test full dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { openChrome, until } from '../scripts/perf/cdp.mjs';
import { findChrome } from '../scripts/ci/gallery-support.mjs';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';

for (const failure of ['stale-review refusal', 'failed request', 'lost success response']) test(`departure keeps the live confirmation after ${failure}`, { timeout: 120000 }, async t => {
  const networkFailure = failure !== 'stale-review refusal', lostResponse = failure === 'lost success response';
  const f = await groupHttpFixture(t), owner = await f.login('101'), player = await f.login('102');
  const invite = (await f.send('/api/group-invites', owner.cookie, {})).json(), opened = await f.send(new URL(invite.link).pathname, player.cookie);
  player.cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', player.cookie)).json(), characterId = review.characters[0].id;
  assert.equal((await f.send('/auth/group-invite/accept', player.cookie, { confirmed: true, reviewToken: review.reviewToken, characterId })).status, 200);
  const original = await f.document(), pickerId = invite.pickerId, ownerId = original.pickers.find(p => p.id === pickerId).ownerCharacterId;
  // Match the public HTTPS ingress through an isolated local proxy, including
  // Origin translation for browser POSTs; private ingress omits account UI.
  const gateway = http.createServer((request, response) => {
    const upstream = http.request({ host: '127.0.0.1', port: f.app().loopbackAddress().port, path: request.url, method: request.method, agent: false,
      headers: { ...request.headers, host: 'picker.example', 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https', ...(request.headers.origin ? { origin: 'https://picker.example' } : {}) } }, reply => { response.writeHead(reply.statusCode, reply.headers); reply.pipe(response); });
    upstream.on('error', error => response.destroy(error)); request.pipe(upstream);
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); });
  const browser = await openChrome(await findChrome(), path.join(f.root, 'departure-browser'), { signal: t.signal, extraArgs: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: networkFailure ? 390 : 2560, height: networkFailure ? 844 : 1440, deviceScaleFactor: 1, mobile: networkFailure });
    const base = `http://127.0.0.1:${gateway.address().port}`, [name, value] = player.cookie.split('; ').find(c => c.startsWith('duo_access=')).split('=');
    await browser.send('Network.setCookie', { name, value, url: base });
    await browser.send('Page.navigate', { url: `${base}/pickers/${pickerId}/?character=${characterId}` });
    await until(() => browser.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Skip setup')`));
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Skip setup').click()`);
    // The guide closes only after its own preference save settles. A badge
    // can still say Saved before that queued command starts.
    await until(() => browser.evaluate(`!document.querySelector('dialog[open]')`));
    await until(() => browser.evaluate(`!!document.querySelector('summary[aria-label="Discord account"]')`));
    await browser.evaluate(`if(innerWidth<600)[...document.querySelectorAll('button')].find(b=>b.textContent==='More'&&b.getBoundingClientRect().width).click(); document.querySelector('summary[aria-label="Discord account"]').click(); [...document.querySelectorAll('button')].find(b=>b.textContent==='Leave or remove member').click()`);
    await until(() => browser.evaluate(`!!document.querySelector('dialog[open] input[type=checkbox]')`));
    if (!networkFailure) {
      const headers = { 'X-Picker-Id': pickerId, 'X-Character-Id': ownerId }, state = (await f.send('/api/state', owner.cookie, undefined, headers)).json().state;
      assert.equal((await f.send('/api/command', owner.cookie, { expectedRevision: state.revision, command: { type: 'set-journal', memberId: 'owner', note: 'Makes departure review stale' } }, headers)).status, 200);
    }
    const posts = [], intercepted = Promise.withResolvers(); let fail = networkFailure;
    const observe = ({ method, params }) => {
      if (method !== 'Fetch.requestPaused') return;
      posts.push(JSON.parse(params.request.postData));
      const action = fail ? browser.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' }) : browser.send('Fetch.continueRequest', { requestId: params.requestId });
      fail = false; action.then(intercepted.resolve, intercepted.reject);
    };
    browser.listeners.add(observe);
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/group-departure', requestStage: lostResponse ? 'Response' : 'Request' }] });
    await browser.evaluate(`document.querySelector('dialog[open] input[type=checkbox]').click(); [...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent==='Confirm leave').click()`);
    await intercepted.promise;
    const screen = await until(() => browser.evaluate(`(()=>{const d=document.querySelector('dialog[open]');if(!d)return {open:false}; const error=d.querySelector('[role=alert]').textContent;return error?{open:true,error,checked:d.querySelector('input[type=checkbox]').checked,live:document.querySelector('.workspace').childElementCount>0}:false})()`));
    assert.equal(screen.open, true, 'the departure confirmation must survive a failed POST');
    assert.equal(screen.checked, true); assert.equal(screen.live, true);
    assert.match(screen.error, networkFailure ? /fetch|network|connection/i : /changed/i);
    assert.equal(posts.length, 1);
    assert.equal((await f.document()).characters.find(c => c.id === characterId).placement.pickerId === pickerId, !lostResponse);
    if (networkFailure) {
      // Dismissing and reopening must retain the uncertain receipt and its
      // paused polling gate, including when the server already committed it.
      await browser.evaluate(`document.querySelector('dialog[open] button[aria-label="Close dialog"]').click(); if(innerWidth<600&&!document.querySelector('summary[aria-label="Discord account"]').getBoundingClientRect().width)[...document.querySelectorAll('button')].find(b=>b.textContent==='More'&&b.getBoundingClientRect().width).click(); const summary=document.querySelector('summary[aria-label="Discord account"]');if(!summary.parentElement.open)summary.click(); [...document.querySelectorAll('button')].find(b=>b.textContent==='Leave or remove member').click()`);
      assert.equal(await browser.evaluate(`document.querySelector('dialog[open] input[type=checkbox]').checked`), true);
      await browser.evaluate(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent==='Confirm leave').click()`);
      await until(() => posts.length === 2); assert.deepEqual(posts[1], posts[0]);
      await until(async () => (await f.document()).characters.find(c => c.id === characterId).placement.pickerId !== pickerId);
      const after = await f.document(); assert.equal(after.departures.length, 1); assert.equal(after.pastMaps.length, 1);
      const destination = after.characters.find(c => c.id === characterId).placement.pickerId;
      await until(() => browser.evaluate(`location.pathname==='/pickers/${destination}/' && document.readyState==='complete'`));
    }
    browser.listeners.delete(observe);
  } catch (error) { console.error(await browser.evaluate(`document.body.innerText.slice(-4000)`)); throw error; }
  finally { await browser.close(); }
});
