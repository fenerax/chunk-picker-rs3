// Disposable real-save API/UI checks. Only a frozen source inside this worktree is accepted.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openChrome, until } from '../perf/cdp.mjs';
import { probeSource } from '../perf/probe.mjs';
import { createRuleRegistry } from '../../app/core/rules.mjs';
import { createTaskFactsIndex } from '../../app/core/progress-index.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceArg = process.argv[process.argv.indexOf('--source') + 1];
if (!process.argv.includes('--source') || !sourceArg) throw new Error('Use --source with a frozen save inside this worktree.');
const source = await realpath(path.resolve(sourceArg));
const browserOnly = process.argv.includes('--browser-only');
const candidateArg = process.argv.includes('--candidates') ? process.argv[process.argv.indexOf('--candidates') + 1] : undefined;
const candidateIds = candidateArg?.split(',');
if (candidateIds) assert.ok(candidateIds.length === 2 && new Set(candidateIds).size === 2 && candidateIds.every(id => /^[1-9]\d*$/.test(id)),
  '--candidates needs two distinct positive chunk IDs separated by a comma');
const within = target => target.startsWith(root + path.sep);
assert.ok(within(source), 'Frozen source must stay inside the worktree.');
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const sourceHash = digest(await readFile(path.join(source, 'state.json')));
const local = path.join(root, '.local'); await mkdir(local, { recursive: true });
const scratch = await mkdtemp(path.join(local, 'sandbox-smoke-'));
assert.ok(within(await realpath(scratch)));
const storeDir = path.join(scratch, 'duo');
await cp(source, storeDir, { recursive: true,
  filter: item => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(item)) });
const output = path.join(local, 'screenshots'); await mkdir(output, { recursive: true });
let application, browser, report;
try {
  delete process.env.RS3_PUBLIC_ORIGIN; delete process.env.RS3_LOOPBACK_PORT;
  const { createServer } = await import('../../app/server.mjs');
  application = await createServer({ dataDir: storeDir, host: '127.0.0.1', port: 0, predictionPrewarm: false,
    publicOrigin: undefined, loopbackPort: undefined });
  await application.listen();
  const invitation = new URL(application.inviteUrl), origin = invitation.origin;
  assert.ok(![8788, 8789, 8790].includes(application.address().port));
  const headers = { Authorization: `Bearer ${invitation.pathname.slice('/join/'.length)}` };
  const api = async (route, body) => {
    const response = await fetch(origin + route, { headers: { ...headers, ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, `Scratch route ${route} must succeed`);
    return response.json();
  };
  const base = await api('/api/state?view=play-v1'), fullState = application.store.getState();
  const diskBefore = digest(await readFile(path.join(storeDir, 'state.json')));
  const historyBefore = JSON.stringify(fullState.history), registry = createRuleRegistry();
  const activeCount = (result, state, memberId) => {
    const facts = createTaskFactsIndex(state, memberId, registry, { tasks: result.tasks,
      completionGroups: result.collectionPlanning?.completionGroups ?? {} });
    const presented = new Set(result.presentation.tasks.map(row => row.id));
    const status = state.members.find(row => row.id === memberId).taskStatus ?? {};
    return result.tasks.filter(row => presented.has(row.id) && row.status === 'available' && !row.hidden && row.obligation !== false
      && !status[row.id]?.backlogged && !facts.get(row.id, row.completionIds).group).length;
  };
  report = browserOnly ? JSON.parse(await readFile(path.join(local, 'sandbox-smoke-report.json'), 'utf8'))
    : { revision: base.state.revision, members: [] };
  assert.equal(report.revision, base.state.revision, 'Reused native report must match the frozen save revision');
  Object.assign(report, { sourceUnchanged: false, noWrite: false, noHistory: false, screenshots: [], browserChecks: {},
    nativeSequenceReused: browserOnly });
  for (const member of browserOnly ? [] : base.state.members) {
    const before = await api(`/api/tasks?memberId=${encodeURIComponent(member.id)}&view=play-v1`);
    const candidates = candidateIds ?? base.pools[member.id].eligible.slice(0, 2).map(row => String(row.id));
    assert.equal(candidates.length, 2, 'Real-save member needs two candidates for this check');
    const changes = { unlockChunks: [], lockChunks: [], doneTasks: [] };
    const body = () => ({ memberId: member.id, baseRevision: base.state.revision, changes: structuredClone(changes) });
    let started = performance.now(); const opening = await api('/api/sandbox/evaluate', body());
    const openingMs = Math.round(performance.now() - started), steps = [];
    for (const id of candidates) {
      changes.unlockChunks.push(id); started = performance.now();
      const value = await api('/api/sandbox/evaluate', body());
      const elapsedMs = Math.round(performance.now() - started);
      steps.push({ chunks: [...changes.unlockChunks], elapsedMs, possibleCount: value.possibleCount,
        added: value.delta.tasksAdded.length, removed: value.delta.tasksRemoved.length,
        rollPool: value.rollPool.eligible.length,
        examples: value.delta.tasksAdded.slice(0, 5).map(row => row.label),
        engineMs: Math.round(value.cache.timingMs.engineMs ?? 0), timingMs: value.cache.timingMs,
        requestMs: value.cache.requestMs, cacheHit: value.cache.hit });
    }
    started = performance.now(); const cached = await api('/api/sandbox/evaluate', body());
    report.members.push({ memberId: member.id, name: member.name, beforeActive: activeCount(before, fullState, member.id),
      afterActive: activeCount(before, fullState, member.id) + cached.delta.tasksAdded.length - cached.delta.tasksRemoved.length,
      beforePossible: before.metrics.availableCount, beforeRollPool: base.pools[member.id].eligible.length,
      candidates, openingMs, openingTimingMs: opening.cache.timingMs, openingRequestMs: opening.cache.requestMs,
      steps, repeatMs: Math.round(performance.now() - started), repeatHit: cached.cache.hit,
      repeatTimingMs: cached.cache.timingMs, repeatRequestMs: cached.cache.requestMs });
  }
  await writeFile(path.join(local, 'sandbox-smoke-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(browserOnly ? 'Reusing native report; checking the browser only.' : 'Native sandbox sequences complete; checking the browser.');

  browser = await openChrome(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
  const posts = [], exceptions = [];
  browser.listeners.add(message => {
    if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST') posts.push(new URL(message.params.request.url).pathname);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    // Death estimates are irrelevant to this hypothetical UI check and have their own perf scenario.
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params, url = new URL(request.request.url);
      const value = { memberId: url.searchParams.get('memberId'), stateRevision: base.state.revision, candidateIds: [], estimates: [] };
      void browser.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(value)).toString('base64') });
    }
  });
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*api/death-estimates*', requestStage: 'Request' }] });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource });
  await browser.send('Page.navigate', { url: invitation.href });
  await until(() => browser.evaluate("document.getElementById('save-status')?.textContent === 'Saved' && document.getElementById('task-count')?.textContent !== ''"), 60000);
  const first = report.members[0];
  const browserCandidates = candidateIds ?? first.candidates;
  assert.ok(first && base.state.members.some(member => member.id === first.memberId), 'Browser member must be in the frozen save');
  assert.ok(browserCandidates.length >= 2 && browserCandidates.every(id => base.pools[first.memberId].eligible.some(row => String(row.id) === id)),
    'Browser candidate IDs must belong to this saved roll pool');
  report.browserChecks.candidates = browserCandidates;
  await browser.evaluate(`document.getElementById('member').value=${JSON.stringify(first.memberId)};document.getElementById('member').dispatchEvent(new Event('change'));`);
  await until(() => browser.evaluate("document.getElementById('task-engine-status').textContent.includes('possible tasks')"), 60000);
  const viewExpression = "({count:document.getElementById('task-count').textContent,counts:document.getElementById('map-counts').textContent,labels:Array.from(document.querySelectorAll('#active-tasks .task-label-button')).map(n=>n.textContent)})";
  const settledView = async () => {
    let previous;
    return until(async () => {
      const current = await browser.evaluate(viewExpression), key = JSON.stringify(current);
      if (key === previous && current.labels.length > 0) return current;
      previous = key; return false;
    }, 30000, 200);
  };
  const beforeView = await settledView();
  const assertNoNoticeError = async () => {
    const noticeError = await browser.evaluate("(()=>{const notice=document.getElementById('notice');return !notice.hidden&&notice.classList.contains('error')?notice.textContent:null;})()");
    assert.equal(noticeError, null, 'Browser app must not show an operation error');
  };
  await browser.evaluate("document.getElementById('sandbox-toggle').click()");
  await until(() => browser.evaluate("!document.getElementById('sandbox-banner').hidden"), 60000);
  const openChunk = async id => {
    await browser.evaluate("document.getElementById('search-open').click()");
    await until(() => browser.evaluate("document.getElementById('tool-dialog').open&&!!document.querySelector('#dialog-content input[type=search]')"), 30000);
    await browser.evaluate(`(()=>{const search=document.querySelector('#dialog-content input[type=search]');search.value=${JSON.stringify(id)};search.dispatchEvent(new Event('input'));})()`);
    const matchingRow = `Array.from(document.querySelectorAll('#dialog-content .search-result')).find(node=>node.querySelector('span')?.textContent.startsWith(${JSON.stringify(id + ' ·')}))`;
    await until(() => browser.evaluate(`!!(${matchingRow})?.querySelector('button')`), 30000);
    await browser.evaluate(`(${matchingRow}).querySelector('button').click()`);
    await until(() => browser.evaluate("Array.from(document.querySelectorAll('#chunk-content button')).some(node=>node.textContent==='Unlock in Sandbox')"), 30000);
  };
  for (const id of browserCandidates) {
    await openChunk(id);
    await browser.evaluate("Array.from(document.querySelectorAll('#chunk-content button')).find(node=>node.textContent==='Unlock in Sandbox').click()");
    await until(() => browser.evaluate("document.getElementById('sandbox-banner').getAttribute('aria-busy')==='false'"), 30000);
    await assertNoNoticeError();
    assert.ok(await browser.evaluate(`Array.from(document.querySelectorAll('.sandbox-step')).some(node=>node.textContent===${JSON.stringify('Unlock ' + id)})`), `Chunk ${id} must remain in the accumulated draft`);
  }
  await browser.evaluate("document.getElementById('chunk-close').click()");
  report.browserChecks.saveButtonsDisabled = await browser.evaluate("['pick','roll-two','undo','backup-open','original-sync-open'].every(id=>document.getElementById(id).disabled)");
  assert.ok(report.browserChecks.saveButtonsDisabled);
  await settledView();
  report.browserChecks.newBadges = await browser.evaluate("document.querySelectorAll('#active-tasks .sandbox-new').length");
  if (candidateIds) assert.ok(report.browserChecks.newBadges > 0, 'Selected task-adding chunks must show new task badges');
  const screenshot = async (name, width, height, theme, fullPage = false) => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    await browser.evaluate(`(async()=>{const {applyTheme}=await import('/map-tools.mjs');applyTheme(document.documentElement,${JSON.stringify(theme)});await document.fonts.ready;})()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    await until(() => browser.evaluate("(()=>{const events=window.__rs3Perf.events;const terrain=events.findLast(e=>e.name==='terrain-drawn');const tiles=events.findLast(e=>e.name==='visible-tiles-loaded');return tiles?.visible>0&&!tiles.failed&&(!terrain||tiles.time>=terrain.time);})()"), 60000);
    const layout = await browser.evaluate("({viewport:innerWidth,body:document.documentElement.scrollWidth,banner:document.getElementById('sandbox-banner').getBoundingClientRect().width})");
    assert.ok(layout.body <= width, `${theme} ${width}px must not overflow horizontally`);
    const metrics = await browser.send('Page.getLayoutMetrics');
    const options = fullPage ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(2000, metrics.cssContentSize.height), scale: 1 } } : {};
    const capture = await browser.send('Page.captureScreenshot', { format: 'png', ...options });
    const target = path.join(output, name); await writeFile(target, Buffer.from(capture.data, 'base64'));
    report.screenshots.push({ path: path.relative(root, target), width, height, theme, layout });
  };
  await screenshot('sandbox-desktop.png', 1440, 900, 'dark');
  await screenshot('sandbox-phone.png', 390, 844, 'light', true);
  await screenshot('sandbox-phone-gray.png', 390, 844, 'gray', true);
  const challengeLabel = await browser.evaluate("(()=>{const checkbox=Array.from(document.querySelectorAll('#active-tasks .task-row input[type=checkbox]')).find(node=>!node.checked);if(!checkbox)throw new Error('No available challenge checkbox');const label=checkbox.getAttribute('aria-label');checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));return label;})()");
  await until(() => browser.evaluate("document.getElementById('sandbox-banner').getAttribute('aria-busy')==='false'"), 30000);
  report.browserChecks.challengeStep = await browser.evaluate("document.querySelector('.sandbox-steps').textContent.includes('challenge checks')");
  await assertNoNoticeError();
  assert.ok(report.browserChecks.challengeStep);
  await browser.evaluate("Array.from(document.querySelectorAll('#sandbox-banner button')).find(node=>node.textContent==='Undo last step').click()");
  await until(() => browser.evaluate("document.getElementById('sandbox-banner').getAttribute('aria-busy')==='false'"), 30000);
  await until(() => browser.evaluate(`!document.querySelector('.sandbox-steps').textContent.includes('challenge checks')&&Array.from(document.querySelectorAll('#active-tasks .task-row input[type=checkbox]')).some(node=>node.getAttribute('aria-label')===${JSON.stringify(challengeLabel)}&&!node.checked)`), 30000);
  report.browserChecks.challengeUndoRestored = true;
  await browser.evaluate("document.getElementById('sandbox-toggle').click()");
  await until(() => browser.evaluate("document.getElementById('sandbox-banner').hidden"), 30000);
  const afterView = await settledView();
  assert.deepEqual(afterView, beforeView); report.browserChecks.exitRestoredView = true;
  assert.ok(posts.every(route => route === '/api/sandbox/evaluate')); assert.equal(exceptions.length, 0);
  report.browserChecks.onlyEvaluationPosts = true; report.browserChecks.noBrowserExceptions = true;
  assert.equal(digest(await readFile(path.join(storeDir, 'state.json'))), diskBefore); report.noWrite = true;
  assert.equal(JSON.stringify(application.store.getState().history), historyBefore); report.noHistory = true;
  assert.equal(digest(await readFile(path.join(source, 'state.json'))), sourceHash); report.sourceUnchanged = true;
  await writeFile(path.join(local, 'sandbox-smoke-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (browser) {
    try {
      const diagnostics = await browser.evaluate("({title:document.title,dialog:document.getElementById('dialog-title')?.textContent,dialogText:document.getElementById('dialog-content')?.innerText,chunkText:document.getElementById('chunk-content')?.innerText,banner:document.getElementById('sandbox-banner')?.innerText,save:document.getElementById('save-status')?.textContent,tasks:document.getElementById('task-engine-status')?.textContent,events:window.__rs3Perf?.events?.slice(-8)})");
      const capture = await browser.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(output, 'sandbox-smoke-failure.png'), Buffer.from(capture.data, 'base64'));
      await writeFile(path.join(local, 'sandbox-smoke-failure.json'), JSON.stringify({ message: error.message, diagnostics }, null, 2) + '\n');
    } catch {}
  }
  throw error;
} finally {
  await browser?.close(); await application?.close();
  assert.ok(within(await realpath(scratch))); await rm(scratch, { recursive: true, force: true });
}
