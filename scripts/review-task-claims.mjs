// One isolated copied-save server and browser. Never report credentials or save payloads.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openChrome, stopChild, until, sleep } from './perf/cdp.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.local/dibs-save'), output = path.join(root, '.local/dibs-review-final');
const main = 'C:/Users/User/Projects/chunk-picker-rs3';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(await readFile(path.join(source, 'state.json')));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, 'scratch-'));
const report = { sourceStateSha256: sourceHash, personal: {}, screenshots: {}, stage: 'setup', limitations: ['One browser tab navigates sequentially between master, Player 2 and viewer sessions; live partner actions use a Player 2 invite API session.', 'Screenshots use desktop Chrome at a phone viewport.'] };
let child, browser, origin, token, partnerCookie, taskGets = 0, failed = false;
const probe = expression => browser.evaluate(expression);
const rowExpression = id => `[...document.querySelectorAll('#active-tasks .task-row')].find(n=>n.dataset.taskId===${JSON.stringify(id)})`;
async function api(route, body, cookie) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `Scratch API ${route.split('?')[0]} returned ${response.status}`);
  return response.json();
}
const state = async () => (await api('/api/state?view=play-v1')).state;
async function command(value, cookie) {
  const current = await state();
  const applied = await api('/api/command', { command: value, expectedRevision: current.revision }, cookie);
  return applied.state ?? state();
}
async function settle() {
  let prior, stable = 0;
  await until(async () => {
    const current = await probe(`JSON.stringify({rows:[...document.querySelectorAll('#active-tasks .task-row')].map(n=>n.dataset.taskId),count:document.getElementById('task-count').textContent})`);
    stable = current === prior && !/updating/i.test(JSON.parse(current).count) ? stable + 1 : 0; prior = current; return stable >= 3;
  }, 180000, 100);
  for (let pass = 0; pass < 100; pass++) {
    const more = await probe(`[...document.querySelectorAll('#active-tasks button')].filter(n=>!n.disabled&&/^Show more /.test(n.textContent)).length`);
    if (!more) return;
    await probe(`[...document.querySelectorAll('#active-tasks button')].filter(n=>!n.disabled&&/^Show more /.test(n.textContent)).forEach(n=>n.click())`);
    await sleep(150); assert.ok(pass < 99, 'Pagination did not finish');
  }
}
async function currentLists() {
  await until(async () => {
    const revision = (await state()).revision;
    return probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown'&&e.revision===${revision}&&e.memberId===document.getElementById('member').value)`);
  }, 180000, 250);
  await settle();
}
async function change(id, value) {
  const start = await probe('__rs3Perf.events.length');
  await probe(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.${typeof value === 'boolean' ? 'checked' : 'value'}=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if (id === 'member' || id === 'group-view') await until(() => probe(`__rs3Perf.events.slice(${start}).some(e=>e.name=== (document.getElementById('group-view').checked?'duo-tasks-shown':'tasks-shown')&&e.memberId===document.getElementById('member').value)`), 180000);
  await settle();
}
async function rows() { return probe(`[...document.querySelectorAll('#active-tasks .task-row')].map(n=>({id:n.dataset.taskId,label:n.querySelector('.task-label-button')?.textContent,owners:n.dataset.owners??'',claim:n.querySelector('.task-claim-name')?.textContent??'',action:n.querySelector('.task-claim-action')?.textContent??''}))`); }
const masterClaimLabel = memberId => `Mark as ${memberId === 'player2' ? 'Player 2' : 'Player 1'}’s`;
async function navigateSession(url, expected) {
  let loaded = false;
  const onLoad = message => { if (message.method === 'Page.loadEventFired') loaded = true; };
  browser.listeners.add(onLoad);
  try {
    await browser.send('Page.navigate', { url });
    await until(() => loaded, 180000);
    await until(() => probe(`globalThis.__rs3Perf?.events.some(e=>e.name==='duo-tasks-shown'||e.name==='tasks-shown')`), 180000);
    assert.equal(await probe(`fetch('/api/session').then(r=>r.json()).then(s=>s.memberId===${JSON.stringify(expected.memberId)}&&s.readOnly===${expected.readOnly})`), true);
    await settle();
  } finally { browser.listeners.delete(onLoad); }
}
const identities = rows => ({ count: rows.length, identitiesSha256: hash(JSON.stringify(rows.map(row => row.id).sort())) });
async function clickClaim(id) { await probe(`${rowExpression(id)}.querySelector('.task-claim-action').click()`); }
async function badge(id, text) { await until(() => probe(`${rowExpression(id)}?.querySelector('.task-claim-action')?.textContent===${JSON.stringify(text)}`), 180000); await settle(); }
async function screenshot(filename, width, theme) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
  await probe(`import('/map-tools.mjs').then(m=>m.applyTheme(document.documentElement,${JSON.stringify(theme)}))`);
  await probe(width === 390 ? `document.querySelector('.task-sidebar').scrollIntoView({block:'start'})` : 'window.scrollTo(0,0)');
  await sleep(300);
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, filename), Buffer.from(shot.data, 'base64'));
  const sizes = await probe('({viewport:innerWidth,body:document.body.scrollWidth})');
  assert.ok(sizes.body <= sizes.viewport, `Overflow in ${filename}`); report.screenshots[filename] = sizes;
}
try {
  const data = path.join(scratch, 'duo');
  await cp(source, data, { recursive: true, filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
  assert.equal(hash(await readFile(path.join(data, 'state.json'))), sourceHash);
  const env = { ...process.env, RS3_PERF_SCRATCH: data, RS3_PERF_PREWARM: 'off', RS3_PERF_SERVER_ENTRY: path.join(root, 'app/server.mjs'), RS3_DATA_DIR: data,
    RS3_GAME_DATA_DIR: path.join(main, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(main, '.local/map-assets') };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  child = fork(path.join(root, 'scripts/perf/server.mjs'), [], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  child.stderr.on('data', bytes => {
    const text = bytes.toString();
    if (/heap out of memory|Allocation failed/i.test(text)) report.serverFailure = 'JavaScript heap ran out of memory';
    else if (/TypeError|RangeError|Error:/.test(text)) report.serverFailure = text.split('\n').filter(line => /^\s*(?:at .*\/app\/|(?:TypeError|RangeError|Error):)/.test(line)).map(line => line.replace(/Error:.*/, 'Error (details omitted)')).slice(0, 5).join('\n');
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Scratch startup timeout')), 180000);
    child.once('message', value => { clearTimeout(timer); value.type === 'ready' ? resolve(value) : reject(new Error('Scratch startup failed')); });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Scratch process failed')); });
  });
  const url = new URL(ready.inviteUrl); assert.equal(url.hostname, '127.0.0.1'); assert.ok(![8788, 8789, 8790, 8791].includes(Number(url.port)));
  origin = url.origin; token = url.pathname.split('/').at(-1);
  const invitation = await api('/api/invites', { label: 'Player 2', memberId: 'player2', admin: false });
  const joined = await fetch(invitation.link, { redirect: 'manual' });
  assert.equal(joined.status, 303); partnerCookie = joined.headers.get('set-cookie')?.split(';')[0]; assert.ok(partnerCookie);
  browser = await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
  browser.listeners.add(message => { if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname === '/api/tasks') taskGets++; });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__rs3Perf={enabled:true,events:[]};' });
  await browser.send('Page.navigate', { url: ready.inviteUrl });
  await until(() => probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown'&&e.memberId==='player1')`), 180000); await settle();
  report.stage = 'personal baseline'; console.log('Review: ' + report.stage);
  await change('group-view', false);
  for (const memberId of ['player1', 'player2']) { if (await probe(`document.getElementById('member').value`) !== memberId) await change('member', memberId); report.personal[memberId] = { before: identities(await rows()) }; }
  await change('member', 'player1'); await change('group-view', true);
  const example = (await rows()).find(row => row.owners.split(',').includes('player1') && row.owners.split(',').includes('player2') && row.action === masterClaimLabel('player1'));
  assert.ok(example, 'Expected an unclaimed shared task'); report.example = { id: example.id, label: example.label };
  report.stage = 'claim and screenshots'; console.log('Review: ' + report.stage);
  await clickClaim(example.id); await badge(example.id, 'Stop doing this');
  assert.equal((await state()).taskClaims[example.id].memberId, 'player1');
  await screenshot('desktop-claim-gray.png', 1440, 'gray'); await screenshot('phone-claim-390-light.png', 390, 'light');
  await change('member', 'player2'); await badge(example.id, 'Take over for Player 2');
  assert.equal((await rows()).find(row => row.id === example.id).claim, 'Player 1 is doing this');
  const revision = (await state()).revision;
  await clickClaim(example.id);
  await probe(`${rowExpression(example.id)}.querySelector('.task-claim-confirm button:last-child').click()`);
  assert.equal((await state()).revision, revision); report.takeoverCancelSavedNothing = true;
  await clickClaim(example.id);
  await probe(`${rowExpression(example.id)}.querySelector('.task-claim-confirm button').click()`);
  await badge(example.id, 'Stop doing this'); assert.equal((await state()).taskClaims[example.id].memberId, 'player2'); report.takeover = true;
  const takeoverRevision = (await state()).revision;
  const takeoverActivity = await api('/api/coordination');
  const takeoverEvent = takeoverActivity.latestUndo?.event?.revision === takeoverRevision ? takeoverActivity.latestUndo.event
    : takeoverActivity.history.find(event => event.revision === takeoverRevision);
  assert.equal(takeoverEvent?.command?.previousMemberId, 'player1');
  report.takeoverHistoryLine = describeHistoryEvent(takeoverEvent, { memberName: id => id === 'player2' ? 'Player 2' : 'Player 1', taskLabel: () => example.label });
  assert.equal(report.takeoverHistoryLine, `Player 2 took over “${example.label}” from Player 1`);
  report.stage = 'filters and own stop'; console.log('Review: ' + report.stage);
  await change('task-only-my-claims', true); assert.ok((await rows()).some(row => row.id === example.id));
  await change('task-only-my-claims', false); await change('member', 'player1');
  await change('task-hide-partner-claims', true); assert.ok(!(await rows()).some(row => row.id === example.id));
  await probe(`document.getElementById('task-filters-clear').click()`); await settle(); assert.ok((await rows()).some(row => row.id === example.id)); report.filters = true;
  await change('member', 'player2'); await clickClaim(example.id); await badge(example.id, masterClaimLabel('player2')); report.stop = true;
  await command({ type: 'undo' }); await badge(example.id, 'Stop doing this'); assert.equal((await state()).taskClaims[example.id].memberId, 'player2'); report.undoStopRestoresClaim = true;
  await command({ type: 'clear-task-claim', memberId: 'player2', taskId: example.id }); await badge(example.id, masterClaimLabel('player2'));
  await command({ type: 'claim-task', memberId: 'player1', taskId: example.id });
  const claimRevision = (await state()).revision;
  await command({ type: 'undo', undoRevision: claimRevision }); await badge(example.id, masterClaimLabel('player2')); assert.ok(!(await state()).taskClaims?.[example.id]); report.undoClaim = true;
  report.stage = 'session identity and viewer'; console.log('Review: ' + report.stage);
  await navigateSession(invitation.link, { memberId: 'player2', readOnly: false });
  if (await probe(`document.getElementById('member').value`) !== 'player1') await change('member', 'player1');
  if (!await probe(`document.getElementById('group-view').checked`)) await change('group-view', true);
  await currentLists(); await badge(example.id, 'I’m doing this');
  await clickClaim(example.id); await badge(example.id, 'Stop doing this');
  const invitedClaim = await state();
  assert.equal(invitedClaim.taskClaims?.[example.id]?.memberId, 'player2');
  assert.equal((await api('/api/coordination')).history.find(event => event.revision === invitedClaim.revision)?.actor?.memberId, 'player2');
  report.inviteGroupClaimsForSessionMember = true;
  await change('group-view', false); await badge(example.id, 'Stop doing this');
  await clickClaim(example.id); await badge(example.id, 'I’m doing this');
  assert.ok(!(await state()).taskClaims?.[example.id]);
  report.invitePersonalClearsOwnClaimOnOtherMap = true;
  const viewerInvitation = await api('/api/invites', { label: 'Copied-save review viewer', viewer: true });
  await navigateSession(viewerInvitation.link, { memberId: null, readOnly: true });
  if (await probe(`document.getElementById('member').value`) !== 'player1') await change('member', 'player1');
  for (const group of [false, true]) {
    if (await probe(`document.getElementById('group-view').checked`) !== group) await change('group-view', group);
    await settle();
    const beforeViewerClick = (await state()).revision;
    assert.equal(await probe(`(()=>{const actions=[...document.querySelectorAll('#active-tasks .task-claim-action')];return actions.length>0&&actions.every(n=>n.disabled&&!n.hasAttribute('aria-pressed'));})()`), true);
    await clickClaim(example.id);
    assert.equal((await state()).revision, beforeViewerClick);
  }
  report.viewerPersonalAndGroupClaimsDisabled = true;
  await navigateSession(ready.inviteUrl, { memberId: null, readOnly: false });
  if (await probe(`document.getElementById('member').value`) !== 'player1') await change('member', 'player1');
  if (!await probe(`document.getElementById('group-view').checked`)) await change('group-view', true);
  await currentLists(); await badge(example.id, masterClaimLabel('player1'));
  report.stage = 'partner live update'; console.log('Review: ' + report.stage); await change('member', 'player1');
  const liveRevision = (await state()).revision;
  await probe(`globalThis.__claimObserved=null;globalThis.__claimObserver=new MutationObserver(()=>{if(${rowExpression(example.id)}?.querySelector('.task-claim-name')?.textContent==='Player 2 is doing this'){__claimObserved=Date.now();__claimObserver.disconnect();}});__claimObserver.observe(document.getElementById('active-tasks'),{childList:true,subtree:true,characterData:true});`);
  const requestsBefore = taskGets, sentAt = Date.now();
  await api('/api/command?view=play-v1', { command: { type: 'claim-task', memberId: 'player2', taskId: example.id }, expectedRevision: liveRevision }, partnerCookie);
  const observedAt = await until(() => probe('__claimObserved'), 10000, 20);
  report.partnerLive = { milliseconds: observedAt - sentAt, taskGets: taskGets - requestsBefore };
  assert.ok(report.partnerLive.milliseconds < 1000, 'Partner claim took at least one second'); assert.equal(report.partnerLive.taskGets, 0);
  const coordination = await api('/api/coordination');
  const partnerRevision = (await state()).revision;
  const partnerEvent = coordination.history.find(event => event.revision === partnerRevision);
  assert.equal(partnerEvent?.actor?.memberId, 'player2');
  await until(() => probe(`document.getElementById('duo-live')?.textContent.includes(${JSON.stringify('Player 2 started “' + example.label + '”')})`), 10000);
  report.partnerLive.historyActor = 'Player 2';
  report.historyLine = describeHistoryEvent(partnerEvent, { memberName: id => id === 'player2' ? 'Player 2' : 'Player 1', taskLabel: () => example.label });
  assert.equal(report.historyLine, `Player 2 started “${example.label}”`);
  const seenKey = 'picker.last-seen:player1,player2:master';
  await probe(`localStorage.setItem(${JSON.stringify(seenKey)},${JSON.stringify(String(partnerRevision - 1))})`);
  await browser.send('Page.reload');
  await until(() => probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown'&&e.memberId==='player1')`), 180000);
  await until(() => probe(`document.getElementById('duo-catchup')?.textContent.includes(${JSON.stringify('Player 2 started “' + example.label + '”')})`), 10000);
  await settle(); report.catchUpAfterReload = true;
  report.stage = 'completion and backlog cleanup'; console.log('Review: ' + report.stage);
  await command({ type: 'set-task-status', memberId: 'player2', taskId: example.id, challengeCompleted: true });
  assert.ok(!(await state()).taskClaims?.[example.id], 'Shared completion did not clear claim');
  await command({ type: 'undo' }); assert.ok(!(await state()).taskClaims?.[example.id], 'Undoing completion must leave its automatically cleared claim absent');
  report.completionUndoLeavesClaimAbsent = true;
  await command({ type: 'claim-task', memberId: 'player2', taskId: example.id }, partnerCookie);
  await badge(example.id, 'Take over for Player 1');
  const firstOwnerBacklog = await command({ type: 'set-task-status', memberId: 'player1', taskId: example.id, backlogged: true });
  await currentLists();
  assert.equal((await state()).taskClaims?.[example.id]?.memberId, 'player2', 'Partner active task should retain the claim');
  const lastOwnerBacklog = await command({ type: 'set-task-status', memberId: 'player2', taskId: example.id, backlogged: true });
  await currentLists();
  await until(async () => !(await state()).taskClaims?.[example.id], 180000);
  const cleanup = await state();
  assert.equal(cleanup.revision, lastOwnerBacklog.revision + 1, 'Inactive claims need a separate cleanup revision');
  assert.ok(!(await api('/api/coordination')).history.some(event => event.revision === cleanup.revision), 'Background cleanup must not add a player History event');
  await command({ type: 'undo', undoRevision: lastOwnerBacklog.revision }); await currentLists();
  assert.ok(!(await state()).taskClaims?.[example.id], 'Undoing backlog must not restore a pruned claim');
  await command({ type: 'undo', undoRevision: firstOwnerBacklog.revision }); await currentLists();
  assert.ok(!(await state()).taskClaims?.[example.id], 'Undoing the other backlog must not restore a pruned claim');
  report.allOwnersBackloggedClearsClaimWithoutUnrelatedUndoRestoration = true;
  report.backlogCleanupHasSeparateRevisionWithoutHistoryEvent = true;
  await badge(example.id, masterClaimLabel('player1'));
  report.stage = 'personal after'; console.log('Review: ' + report.stage); await change('group-view', false);
  for (const memberId of ['player1', 'player2']) { if (await probe(`document.getElementById('member').value`) !== memberId) await change('member', memberId); report.personal[memberId].after = identities(await rows()); assert.deepEqual(report.personal[memberId].after, report.personal[memberId].before); }
  report.stage = 'complete'; console.log('Review: ' + report.stage);
} catch (error) {
  console.error('Review failed at stage: ' + report.stage);
  const location = /review-task-claims\.mjs:(\d+):(\d+)/.exec(error.stack ?? '');
  if (location) { report.failureLocation = `review-task-claims.mjs:${location[1]}:${location[2]}`; console.error('Review assertion: ' + report.failureLocation); }
  report.serverExit = { code: child?.exitCode, signal: child?.signalCode };
  failed = true; report.failedStage = report.stage; report.failure = 'Copied-save review assertion or browser operation failed; credentials and save details omitted.';
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 10000).catch(() => {}); }
  await stopChild(child);
  const resolved = await realpath(scratch), boundary = await realpath(output);
  assert.ok(resolved.startsWith(boundary + path.sep) && path.basename(resolved).startsWith('scratch-'));
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  report.sourceUnchanged = hash(await readFile(path.join(source, 'state.json'))) === sourceHash; assert.equal(report.sourceUnchanged, true);
  report.scratchRemoved = true;
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ stage: report.stage, failedStage: report.failedStage, personalViews: Object.keys(report.personal).length, partnerLiveMilliseconds: report.partnerLive?.milliseconds, screenshots: Object.keys(report.screenshots).length, sourceUnchanged: report.sourceUnchanged, scratchRemoved: report.scratchRemoved }));
if (failed) process.exitCode = 1;
