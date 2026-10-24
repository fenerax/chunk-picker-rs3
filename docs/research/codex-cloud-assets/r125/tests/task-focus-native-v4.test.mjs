// Controlled functional race: real ACK and unchanged HTTP bodies are held.
// No mocked cache/generation/focus, dispatchEvent, or checkbox property changes.
import test from 'node:test';
import { captureTabSnapshot, instrumentTabTasks } from './task-focus-native.tab-diagnostic.mjs';
import { operationTracker, projectRecord } from './task-focus-native.diagnostic.mjs';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { instrumentLoading, instrumentTasks, browserInitSource } from './task-focus-native.observers.mjs';
import { deadline, fixtureEnvironment, watchFixture, drainFixture } from './task-focus-native.lifecycle.mjs';
const enabled = process.env.R78_NATIVE === '1';
const sourceHashes = { 'screen-loading.mjs': 'aac839576ef212bd22af38420f08befcc3dc483f4f9db132fa947b6c9534b1cf',
  'screen-tasks.mjs': '572b08f701847bb9ea24d41023a2af972492ff8fe95730b159259995c7ff79e1' };
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; };

for (const group of [false, true]) for (const owner of ['alpha', 'beta']) {
  test(`native later-page focus across held ack: group=${group}, owner=${owner}`, { skip: !enabled, timeout: 150000 }, async t => {
    const tracker = operationTracker(record => console.log('r125-native-diagnostic ' + JSON.stringify(record)));
    try {
    tracker.mark('setup'); const h = await setup(t, group, owner, tracker);
    await h.pending(); await h.tabToB(); h.release.resolve(); await h.settled();
    tracker.mark('focus-check'); assert.equal(await h.page.locator(h.b).evaluate(node => node === document.activeElement), true);
    tracker.mark('space'); await h.page.keyboard.press('Space');
    assert.deepEqual(await h.page.evaluate(() => r68Keys.filter(event => event.key === ' ').at(-1)), { key: ' ', trusted: true, taskId: h.bId });
    tracker.mark('save'); await h.page.waitForFunction(() => document.querySelector('#save-status')?.textContent === 'Saved');
    tracker.mark('readback'); const state = JSON.parse(await readFile(path.join(h.dir, 'state.json'), 'utf8')).state;
    assert.equal(state.members.find(member => member.id === owner).taskStatus?.[h.bId]?.challengeCompleted, true);
    assert.equal(state.members.find(member => member.id !== owner).taskStatus?.[h.bId], undefined);
    assert.deepEqual(h.commands.map(q => [q.command.memberId, q.command.taskId, q.command.challengeCompleted]), [[owner, h.aId, true], [owner, h.bId, true]]);
    assert.equal(new Set(h.commands.map(q => q.requestId)).size, 2);
    tracker.mark('history'); const history = state.history.filter(event => event.type === 'set-task-status');
    assert.equal(history.length, 2);
    assert.equal(history.filter(event => event.command.taskId === h.bId).length, 1);
    assert.equal(h.browserErrors.length, 0, h.browserErrors.join('\n'));
    console.log('r109-command-proof ' + JSON.stringify({ group, owner, commands: h.commands,
      history: history.map(event => ({ type: event.type, revision: event.revision, command: event.command })),
      persistedB: state.members.find(member => member.id === owner).taskStatus[h.bId] }));
    } catch (error) { tracker.fail(error); throw error; } finally { tracker.end(); }
  });
}
for (const destination of ['filter', 'dialog', 'window']) {
  test(`native newer ${destination} intent cancels held-ack restoration`, { skip: !enabled, timeout: 150000 }, async t => {
    const tracker = operationTracker(record => console.log('r125-native-diagnostic ' + JSON.stringify(record)));
    try {
    tracker.mark('setup'); const h = await setup(t, false, 'alpha', tracker); await h.pending(); await h.tabToB();
    tracker.mark('cancellation-intent'); if (destination === 'filter') { await h.page.locator('#task-filter').click(); await h.page.keyboard.type('Alpha'); }
    else if (destination === 'window') { const other = await h.page.context().newPage(); await other.goto('about:blank'); await other.bringToFront(); }
    else await h.page.locator(h.b).locator('..').getByRole('button', { name: 'Alpha task 071', exact: true }).click();
    h.release.resolve(); await h.settled();
    assert.equal(await h.page.evaluate(destination => destination === 'filter' ? document.activeElement?.id === 'task-filter'
      : destination === 'window' ? !document.hasFocus() && r109.windowBlur.some(event => event.trusted)
      : !!document.activeElement?.closest('dialog[open]'), destination), true);
    assert.equal(h.commands.length, 1);
    } catch (error) { tracker.fail(error); throw error; } finally { tracker.end(); }
  });
}

async function setup(t, group, owner, tracker) {
  tracker.mark('environment'); const env = fixtureEnvironment(process.env, process.execArgv);
  assert.equal(process.version, 'v24.19.0', 'cloud native probe requires pinned runtime; pure controls use a separate file');
  assert.ok(process.env.R78_SCRATCH && path.isAbsolute(process.env.R78_SCRATCH), 'explicit absolute scratch prefix required');
  tracker.mark('playwright-import'); const { chromium } = await import(pathToFileURL(process.env.R78_PLAYWRIGHT));
  tracker.mark('scratch-create'); const dir = await realpath(await mkdtemp(process.env.R78_SCRATCH + 'run-'));
  const release = deferred(), taskRelease = deferred(), held = deferred();
  let browser, watch, receipt, responseSequence = 0, holdTasks = false, first = true;
  const commands = [], responses = [], releasedResponseIds = [], moduleGates = [], browserErrors = [], routeErrors = [];
  t.after(async () => {
    tracker.mark('cleanup');
    release.resolve(); taskRelease.resolve(); const errors = []; let drain;
    try { tracker.mark('browser-close'); if (browser) await deadline(browser.close(), 4000, 'browser close'); } catch (error) { tracker.fail(error); errors.push(error); }
    finally {
      try {
        if (watch) {
          tracker.mark('fixture-drain'); drain = await drainFixture(watch);
          console.log('r109-fixture-drain ' + JSON.stringify({ pid: drain.pid, drained: drain.drained, graceful: drain.graceful,
            forced: drain.forced, exit: drain.exit, close: drain.close, stopped: drain.stopped,
            error: drain.error?.message ?? null, stderrBytes: drain.stderrBytes, stderr: drain.stderr }));
          assert.equal(drain.graceful, true, 'fixture must stop, exit zero and close; IPC disconnection alone is insufficient');
        }
      } catch (error) { tracker.fail(error); errors.push(error); }
      // Failed/undrained state remains available to the outer guard and diagnosis.
      if ((!watch || drain?.drained) && errors.length === 0) {
        try { tracker.mark('scratch-remove'); await deadline(rm(dir, { recursive: true, force: true }), 1000, 'scratch removal after drain'); } catch (error) { tracker.fail(error); errors.push(error); }
      }
    }
    if (errors.length) throw new AggregateError(errors, 'bounded native fixture cleanup failed');
  });
  tracker.mark('fixture-fork'); const child = fork(new URL('./task-focus-native-v4.fixture.mjs', import.meta.url), [dir], {
    env, execArgv: ['--max-old-space-size=768'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.on('message', message => {
    if (message?.type === 'r125-fixture-diagnostic') {
      const record = projectRecord(message.record);
      if (record?.kind === 'fixture-failure') console.log('r125-native-diagnostic ' + JSON.stringify(record));
    }
  });
  watch = watchFixture(child);
  tracker.mark('fixture-ready'); const ready = await deadline(watch.ready, 45000, 'fixture ready');
  assert.match(ready.dataset.digest, /^[a-f0-9]{64}$/);
  tracker.mark('browser-launch'); browser = await chromium.launch({ executablePath: process.env.R78_CHROMIUM || '/usr/bin/chromium', headless: true,
    timeout: 30000, args: ['--no-sandbox'] });
  tracker.mark('browser-context'); const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
  await context.addInitScript(() => localStorage.setItem('rs3:task-view', '{"showBlocked":false,"showAll":false,"groupView":false}'));
  const aId = `custom:r68-${owner}-001`, bId = `custom:r68-${owner}-071`;
  await context.addInitScript({ content: browserInitSource(bId) });
  const routeGuard = handler => async route => {
    try { await handler(route); } catch (error) { tracker.fail(error); routeErrors.push(error.message); try { await route.abort(); } catch {} }
  };
  const entityHeaders = (response, extra = {}) => { const headers = { ...response.headers(), ...extra };
    delete headers['content-encoding']; delete headers['content-length']; return headers; };
  tracker.mark('browser-routes'); await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const checkModule = (response, name) => {
    assert.equal(response.status(), 200, `${name} GET`);
    assert.match(response.headers()['content-type'] || '', /javascript/, `${name} MIME`);
    assert.match(response.headers()['content-security-policy'] || '', /script-src 'self'/, `${name} CSP`);
    moduleGates.push({ path: name, status: response.status(), type: response.headers()['content-type'], csp: response.headers()['content-security-policy'] });
  };
  for (const [name, instrument] of [['screen-loading.mjs', instrumentLoading], ['screen-tasks.mjs', source => instrumentTabTasks(source, instrumentTasks)]]) {
    await context.route(`**/${name}`, routeGuard(async route => {
      const response = await route.fetch(); checkModule(response, '/' + name);
      const raw = await response.text(), body = instrument(raw);
      moduleGates.at(-1).sourceSHA256 = createHash('sha256').update(raw).digest('hex');
      assert.equal(moduleGates.at(-1).sourceSHA256, sourceHashes[name], `${name} exact current source`);
      moduleGates.at(-1).observedSHA256 = createHash('sha256').update(body).digest('hex');
      await route.fulfill({ response, headers: entityHeaders(response), body });
    }));
  }
  await context.route('**/api/tasks?*', routeGuard(async route => {
    const requestedAtNode = performance.now(), response = await route.fetch(), raw = await response.body();
    const value = JSON.parse(raw.toString('utf8')), url = new URL(route.request().url());
    const marker = Object.freeze({ id: ++responseSequence, requestedMember: url.searchParams.get('memberId'), query: url.search,
      status: response.status(), memberId: value.memberId, stateRevision: value.stateRevision,
      rawSHA256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length, requestedAtNode, fetchedAtNode: performance.now() });
    responses.push(marker); const heldBody = holdTasks; if (heldBody) await taskRelease.promise;
    // Observation headers carry provenance; application body bytes stay exact.
    await route.fulfill({ response, headers: entityHeaders(response, { 'x-r109-observation': JSON.stringify(marker) }), body: raw });
    if (heldBody) releasedResponseIds.push(marker.id);
  }));
  await context.route('**/api/command**', routeGuard(async route => {
    const q = route.request().postDataJSON(), response = await route.fetch();
    if (q.command.type === 'set-task-status') {
      commands.push(q); assert.equal(response.status(), 200);
      if (first) {
        first = false; const body = await response.json();
        receipt = { revision: body.state?.revision, requestId: q.requestId, receivedAtNode: performance.now() };
        assert.equal(body.receipt?.revision, receipt.revision);
        if (body.receipt?.requestId !== undefined) assert.equal(body.receipt.requestId, q.requestId);
        held.resolve(); await release.promise;
      }
    }
    await route.fulfill({ response });
  }));
  const page = await context.newPage();
  page.on('pageerror', error => { tracker.fail(error); browserErrors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  tracker.mark('navigation'); await page.goto(ready.invite);
  tracker.mark('helper-gate'); const helperGate = await context.request.get(new URL('/screen-task-focus.mjs', ready.invite).href);
  checkModule(helperGate, '/screen-task-focus.mjs');
  assert.equal(createHash('sha256').update(await helperGate.body()).digest('hex'), '48f2dcc35a6812ee478d4655dc9c69c2e0c8c1b00d2b4e1242229279012b96ad');
  tracker.mark('member-select'); if (owner === 'beta') await page.locator('#member-switch').getByRole('button', { name: 'Beta', exact: true }).click();
  tracker.mark('group-select'); if (group) { await page.locator('#group-view').click(); await page.locator('.duo-task-chip').filter({ hasText: owner === 'alpha' ? /^Alpha$/ : /^Beta$/ }).click(); }
  const selector = id => `#active-tasks [data-task-id="${id}"] > input[type=checkbox]`;
  tracker.mark('initial-render'); const a = selector(aId), b = selector(bId); await page.waitForSelector(a);
  if (await page.locator('#hide-completed').isChecked()) await page.locator('#hide-completed').click();
  await page.waitForFunction(() => !document.querySelector('#calculation-status')?.textContent.trim());
  tracker.mark('show-more'); await page.getByRole('button', { name: /^Show more Custom tasks/ }).click(); await page.waitForSelector(b);
  tracker.mark('key-observer'); await page.evaluate(() => { window.r68Keys = []; document.addEventListener('keydown', event => r68Keys.push({
    key: event.key, trusted: event.isTrusted, taskId: event.target.closest('[data-task-id]')?.dataset.taskId || '' }), true); });
  let tabAction = 'pending', tabIndex = 0;
  const tabEmit = record => console.log('r125-tab-diagnostic ' + JSON.stringify(record));
  const tabSnapshot = phase => captureTabSnapshot(page, { a, b, owner, phase, action: tabAction, index: tabIndex }, tabEmit);
  return { page, dir, commands, release, aId, bId, a, b, responses, moduleGates, browserErrors,
    async pending() { tracker.mark('pending'); tabAction = 'pending';
      await tabSnapshot('before-command');
      try { holdTasks = true; await page.locator(a).click(); await deadline(held.promise, 15000, 'committed held ACK');
        await tabSnapshot('after-pending');
      } catch (error) { await tabSnapshot('failure'); throw error; }
    },
    async tabToB() {
      tracker.mark('tab');
      try {
      for (let i = 0; i < 1000; i++) {
        tabIndex = i + 1; tabAction = 'press';
        await page.keyboard.press('Tab');
        tabAction = 'locate-b'; await tabSnapshot('after-tab');
        if (await page.locator(b).evaluate(node => node === document.activeElement)) {
          tabAction = 'check-enabled'; assert.equal(await page.locator(b).isEnabled(), true); tabAction = 'check-save'; assert.equal(await page.locator('#save-status').textContent(), 'Saving…'); return;
        }
      }
      tabAction = 'exhausted'; assert.fail('native Tab never reached later-page B');
      } catch (error) { await tabSnapshot('failure'); throw error; }
    },
    async settled() {
      assert.ok(receipt && Number.isSafeInteger(receipt.revision), 'actual committed command receipt required');
      tracker.mark('cached-render'); const cachedHandle = await page.waitForFunction(criteria => r109.pickCachedRender(r109, criteria), { owner, revision: receipt.revision, responses: [...responses] });
      const cached = await cachedHandle.jsonValue(); await cachedHandle.dispose(); taskRelease.resolve();
      tracker.mark('body-delivery'); const deliveryDeadline = performance.now() + 15000;
      while (!responses.some(response => response.requestedMember === owner
        && response.stateRevision === receipt.revision && releasedResponseIds.includes(response.id))) {
        assert.ok(performance.now() < deliveryDeadline, 'actual owner held task delivery deadline');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const criteria = { owner, revision: receipt.revision, receiptAtNode: receipt.receivedAtNode,
        cachedGeneration: cached.generation, responses: [...responses], releasedResponseIds: [...releasedResponseIds] };
      tracker.mark('fresh-witness'); const witnessHandle = await page.waitForFunction(criteria => r109.pickWitness(r109, criteria), criteria);
      const witness = await witnessHandle.jsonValue(); await witnessHandle.dispose();
      assert.equal(witness.cached.generation, cached.generation, 'one qualified cached witness retained');
      assert.equal(witness.accepted.response.id, witness.render.responseId, 'one fully qualified response/render witness retained');
      assert.equal(browserErrors.length, 0, browserErrors.join('\n')); assert.equal(routeErrors.length, 0, routeErrors.join('\n'));
      for (const name of ['/screen-loading.mjs', '/screen-tasks.mjs', '/screen-task-focus.mjs']) assert.ok(moduleGates.some(gate => gate.path === name && gate.status === 200));
      console.log('r109-native-witness ' + JSON.stringify({ group, owner, receipt,
        fixture: { pid: ready.pid, mode: ready.mode, dataset: ready.dataset }, transport: [...responses], releasedResponseIds: [...releasedResponseIds], moduleGates, witness }));
      holdTasks = false;
    },
  };
}
