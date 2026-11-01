// Wired application regression, using only public synthetic inputs and Chromium.
// node scripts/perf/how-paths-browser.mjs [--chromium /usr/bin/chromium]
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../../app/server.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { createTaskEngine, taskId } from '../../app/tasks/engine.mjs';
import { ProcessWorker } from '../../app/tasks/process-worker.mjs';
import { pathDefinitions, pathState } from '../../tests/task-how-fixture.mjs';
import { openChrome, until, sleep } from './cdp.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'how-paths-browser-'));
let app, browser;
const jobs = [], responses = [], errors = [], durations = [];
let captures = 0;
try {
  const definitions = pathDefinitions();
  // Keep the consumer on the selected owner's task list while its historical
  // producer remains outside the current map.
  definitions.challenges.Extra['Use historical supply'].Chunks = ['100'];
  const state = createGroupState([{ id: 'one', name: 'Explorer', unlocked: ['100', '200', '300'] }, { id: 'two', name: 'Observer', unlocked: ['100', '200', '300'] }]);
  Object.assign(state.rules, pathState().rules);
  state.tasks = createTaskEngine(definitions).catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.members[0].completedTasks = pathState().members[0].completedTasks;
  state.members[1].preferences = { showTaskHow: false };
  const workerFactory = data => {
    const worker = new ProcessWorker(data), post = worker.postMessage.bind(worker);
    worker.postMessage = message => { if (message.type === 'how-task') jobs.push(message); return post(message); };
    return worker;
  };
  app = await createServer({ dataDir: path.join(root, 'game'), dataset: selectedDataset, definitions, initialState: state,
    port: 0, host: '127.0.0.1', predictionPrewarm: false, taskWorkerOptions: { workerFactory, serializedStateInput: true } });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const arg = process.argv.indexOf('--chromium');
  browser = await openChrome(arg < 0 ? '/usr/bin/chromium' : process.argv[arg + 1], path.join(root, 'chrome'), { extraArgs: ['--no-sandbox'] });
  browser.listeners.add(message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.responseReceived' && new URL(message.params.response.url).pathname === '/api/task-how') responses.push(message.params.response.status);
  });
  const evaluate = expression => browser.evaluate(expression);
  const ready = expression => until(() => evaluate(expression), 30000);
  const click = async selector => {
    const point = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) throw Error('Missing control'); n.scrollIntoView({block:'center',behavior:'instant'}); const r=n.getBoundingClientRect(); if (!r.width || !r.height) throw Error('Hidden control'); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await sleep(80); // Let scroll/layout settle before sending physical input.
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const escape = async () => {
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  };
  const chooseOwner = async id => {
    await evaluate(`(() => { const n=document.getElementById('task-filter'); n.value=''; n.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(180);
    await evaluate(`(() => { const n=document.getElementById('member'); n.value=${JSON.stringify(id)}; n.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await ready(`document.getElementById('member').value===${JSON.stringify(id)} && document.querySelectorAll('#active-tasks .task-row').length>0 && /possible tasks/.test(document.getElementById('task-engine-status').innerText)`);
  };
  const settings = async (preference, value) => {
    if (await evaluate(`innerWidth < 700`)) await click('#phone-tab-more');
    if (!await evaluate(`document.getElementById('more-tools').open`)) await click('#more-tools summary');
    await click('#settings-open'); await ready(`document.getElementById('tool-dialog').open`);
    if (preference === 'showTaskHow') {
      await evaluate(`(() => { const n=document.querySelector('[aria-label="Find a setting"]'); n.value='Show How?'; n.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }
    const selector = `#setting-one-${preference}`;
    if (await evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`) !== value) await click(selector);
    await ready(`!document.querySelector(${JSON.stringify(selector)}).disabled && document.querySelector(${JSON.stringify(selector)}).checked===${value} && document.getElementById('save-status').dataset.status==='saved'`);
    await escape();
    if (await evaluate(`innerWidth < 700`)) await click('#phone-tab-tasks');
  };
  await browser.send('Page.navigate', { url: origin + '/join/' + app.store.getAccessToken() });
  await ready(`document.querySelectorAll('#active-tasks .task-row').length>0 && /possible tasks/.test(document.getElementById('task-engine-status').innerText)`);
  if (await evaluate(`document.getElementById('group-view').checked`)) await click('#group-view');
  await chooseOwner('one');
  const goals = [
    ['Use both stations', 'Use both stations — in West and East.'],
    ['Use any station', 'Use any station — in West.'],
    ['Use two stations', 'Use two stations — in West and East.'],
    ['Use shared preparation', 'Use shared preparation — in West and East.'],
    ['Use historical supply', 'Use historical supply.'],
  ];
  for (const width of [1440, 390]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    if (width < 700) await click('#phone-tab-tasks');
    await settings('advanced', false);
    for (const advanced of [false, true]) {
      if (advanced) await settings('advanced', true);
      for (const [goal, expected] of goals) {
        await evaluate(`(() => { const n=document.getElementById('task-filter'); n.value=${JSON.stringify(goal)}; n.dispatchEvent(new Event('input',{bubbles:true})); })()`);
        await sleep(180); // Wait for the shipped 100 ms search debounce.
        const row = `#active-tasks .task-row[data-task-id="${taskId('Extra', goal)}"]`;
        await ready(`document.querySelector(${JSON.stringify(row + ' .task-how')})`);
        const before = JSON.stringify(app.store.getState()), start = performance.now();
        await click(row + ' .task-how');
        await ready(`document.querySelector(${JSON.stringify(row + ' .task-how-panel')})?.getAttribute('aria-busy')==='false' && document.querySelector(${JSON.stringify(row + ' .task-how-steps')})`);
        durations.push(performance.now() - start);
        const visible = await evaluate(`(() => { const p=document.querySelector(${JSON.stringify(row + ' .task-how-panel')}); return {text:p.innerText, labels:[...p.querySelectorAll('li')].map(n=>n.firstChild.textContent),advanced:!!p.querySelector('small'), visible:!p.hidden && p.getBoundingClientRect().width>0}; })()`);
        assert.ok(visible.visible, JSON.stringify({width, advanced, goal, visible})); assert.equal(visible.labels.at(-1), expected); assert.equal(visible.advanced, advanced);
        assert.doesNotMatch(visible.text, /West or East|in North|This supply uses partner access/);
        if (goal === 'Use historical supply') {
          assert.ok(visible.labels.includes('This supply comes from a recorded completion; its current production access is not established.'));
          assert.ok(visible.labels.includes('You recorded completing Producer.'));
          assert.match(visible.text, /This is a partial explanation/);
        }
        assert.equal(JSON.stringify(app.store.getState()), before);
        const job = jobs.at(-1); assert.equal(job.memberId, 'one'); assert.equal(job.stateTransport, 'json-shared-v1');
        captures++;
        await click(row + ' .task-how');
      }
    }
    // A second owner's saved opt-out must apply when switching maps.
    const count = responses.length;
    await chooseOwner('two');
    await ready(`!document.querySelector('#active-tasks .task-how')`);
    assert.equal(responses.length, count);
    await chooseOwner('one');
    await settings('showTaskHow', false);
    assert.equal(await evaluate(`document.querySelectorAll('#active-tasks .task-how').length`), 0);
    await settings('showTaskHow', true);
    await ready(`document.querySelector('#active-tasks .task-how')`);
  }
  assert.equal(captures, 20); assert.equal(responses.length, 20); assert.ok(responses.every(status => status === 200)); assert.deepEqual(errors, []);
  const sorted = durations.toSorted((a, b) => a - b);
  console.log(JSON.stringify({ captures, httpResponses: responses.length, processJobs: jobs.length, failures: 0,
    medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1) }));
} finally { await browser?.close(); await app?.close(); await rm(root, { recursive: true, force: true }); }
