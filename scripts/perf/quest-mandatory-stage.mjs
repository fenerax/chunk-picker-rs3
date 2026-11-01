// Public readiness reproduction and an optional wired Chromium review.
// node scripts/perf/quest-mandatory-stage.mjs --root /tmp/start --expect false
// node scripts/perf/quest-mandatory-stage.mjs --root . --expect true --browser
// This projects public rows onto synthetic access; it does not claim in-game
// feasibility or read a pack/save. Browser saves and profiles live only in /tmp.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openChrome, until } from './cdp.mjs';

const { values } = parseArgs({ options: { root: { type: 'string', default: '.' },
  expect: { type: 'string' }, browser: { type: 'boolean', default: false } } });
assert.ok(Number(process.versions.node.split('.')[0]) > 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) >= 20, 'Node 24.20+ required.');
assert.ok(['true', 'false'].includes(values.expect), 'Supply --expect true or false.');
const expected = values.expect === 'true', root = path.resolve(values.root);
const load = file => import(pathToFileURL(path.join(root, file)));
const { buildQuestReadiness } = await load('app/tasks/activity-readiness.mjs');
const { buildActivityInfo } = await load('app/tasks/activity.mjs');
const { plainLabel, taskId } = await load('app/tasks/engine.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const source = JSON.parse(await readFile(path.join(root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
const titles = ['Stolen Hearts', "Benedict's World Tour (miniquest)"];
const tasks = Object.entries(source.challenges.Quest).filter(([, r]) => titles.includes(r.BaseQuest))
  .map(([rawLabel, record]) => ({ id: taskId('Quest', rawLabel, record), category: 'Quest', rawLabel,
    label: plainLabel(rawLabel), baseQuest: record.BaseQuest, record, status: 'available', blockers: [] }));
const whole = tasks.find(row => row.baseQuest === titles[0] && row.record.QuestPoints !== undefined);
const stage = tasks.find(row => row.rawLabel === '~|Stolen Hearts|~ 5');
const gate = tasks.find(row => row.rawLabel === "~|Benedict's World Tour (miniquest)|~ 2b");
const state = createGroupState([{ id: 'a', name: 'Fixture', unlocked: ['100'] }]);
state.rules['content.f2p'] = false;
const chunks = [...new Set(tasks.flatMap(row => row.record.Chunks ?? []))];
const result = { tasks, access: { bases: chunks.filter(v => /^\d+$/.test(v)),
  sections: chunks.filter(v => /^\d+-\d+$/.test(v)), areas: chunks.filter(v => !/^\d/.test(v)) } };
const definitions = { codeItems: source.codeItems };
const ready = () => buildQuestReadiness(result, state, 'a', definitions).get(gate.id).canDoNow;
assert.equal(ready(), false);
whole.personalCompleted = true;
assert.equal(ready(), expected);
assert.equal(buildActivityInfo(result, state, 'a', definitions).quests.find(g => g.name === titles[1]).canDoNow, expected);
stage.personalCompleted = true;
assert.equal(ready(), true);
stage.personalCompleted = false;
const before = JSON.stringify({ state, result });
for (let n = 0; n < 20; n++) ready();
const durations = [];
for (let run = 0; run < 5; run++) {
  const start = performance.now();
  for (let n = 0; n < 100; n++) ready();
  durations.push((performance.now() - start) / 100);
}
assert.equal(JSON.stringify({ state, result }), before);
const sorted = durations.toSorted((a, b) => a - b);
const report = { publicRows: tasks.length, publicChecks: 5, wholeOnlyReady: expected, manualStageReady: true,
  readinessMs: { median: sorted[2], min: sorted[0], max: sorted.at(-1) }, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
if (values.browser) report.browser = await browserReview();
console.log(JSON.stringify(report));

async function browserReview() {
  const { createServer } = await load('app/server.mjs');
  const scratch = await mkdtemp(path.join(tmpdir(), 'quest-mandatory-stage-'));
  const label = (name, stage) => `~|${name}|~ ${stage}`;
  const previous = label('Earlier', '5'), previousWhole = label('Earlier', 'Complete the quest');
  const next = label('Later', '2b'), nextWhole = label('Later', 'Complete the miniquest');
  const records = {
    [previous]: { BaseQuest: 'Earlier', Chunks: ['100'], Output: 'Stage-only reward' },
    [previousWhole]: { BaseQuest: 'Earlier', QuestPoints: 1, Tasks: { [previous]: 'Quest' } },
    [next]: { BaseQuest: 'Later', Chunks: ['100'], Tasks: { [previous]: 'Quest' } },
    [nextWhole]: { BaseQuest: 'Later', QuestPoints: 0, Tasks: { [next]: 'Quest' } },
  };
  const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'],
    challenges: { Quest: records }, codeItems: { tasksPlus: {} } };
  const initialState = createGroupState([{ id: 'a', name: 'Fixture', unlocked: ['100'] }]);
  const wholeId = taskId('Quest', previousWhole, records[previousWhole]);
  const stageId = taskId('Quest', previous, records[previous]);
  initialState.tasks = Object.entries(records).map(([rawLabel, record]) => ({ id: taskId('Quest', rawLabel, record), label: plainLabel(rawLabel), category: 'Quest' }));
  initialState.members[0].completedTasks = [wholeId];
  let app, chrome;
  try {
    app = await createServer({ dataDir: path.join(scratch, 'game'), definitions, taskMap: {}, initialState,
      port: 0, predictionPrewarm: false });
    await app.listen();
    chrome = await openChrome(process.env.CHROME_BIN ?? '/usr/bin/chromium', path.join(scratch, 'chrome'), { extraArgs: ['--no-sandbox'] });
    let gameplayWrites = 0, pageErrors = 0;
    chrome.listeners.add(event => {
      if (event.method === 'Runtime.exceptionThrown') pageErrors++;
      if (event.method === 'Network.requestWillBeSent' && event.params.request.method === 'POST'
        && new URL(event.params.request.url).pathname === '/api/command') gameplayWrites++;
    });
    await chrome.send('Page.navigate', { url: app.inviteUrl });
    await until(() => chrome.evaluate("!!document.getElementById('activity-open')"));
    await until(() => chrome.evaluate(`(async()=>{
      const r=await fetch('/api/tasks?memberId=a').then(r=>r.json());
      if(!r.activityInfo)return false;
      globalThis.__questReview=r;return true;
    })()`));
    const facts = await chrome.evaluate(`({
      ready: __questReview.activityInfo.quests.find(g=>g.name==='Later')?.canDoNow,
      stageCompleted: __questReview.tasks.find(r=>r.id===${JSON.stringify(stageId)})?.personalCompleted,
      planningAvailable: __questReview.tasks.find(r=>r.rawLabel===${JSON.stringify(nextWhole)})?.status==='available'
    })`);
    assert.equal(facts.ready, expected); assert.equal(facts.stageCompleted, false); assert.equal(facts.planningAvailable, true);
    const click = async (selector, text) => {
      assert.equal(await chrome.evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!n)return false;n.click();return true})()`), true);
    };
    await until(() => chrome.evaluate("document.getElementById('active-tasks')?.textContent.includes('Later')"));
    await chrome.evaluate("document.getElementById('tool-dialog').close();document.getElementById('activity-open').click()");
    await until(() => chrome.evaluate("document.getElementById('dialog-title').textContent==='Activity Info'"));
    await click('#dialog-content [role="tab"]', 'Quests');
    await click('#dialog-content [aria-label="Quest progress"] button', 'Can do now');
    assert.equal(await chrome.evaluate("[...document.querySelectorAll('#dialog-content summary')].some(n=>n.textContent.startsWith('Later ·'))"), expected);
    await chrome.evaluate("document.getElementById('tool-dialog').close();document.getElementById('search-open').click()");
    await until(() => chrome.evaluate("!!document.querySelector('#dialog-content select')"));
    assert.equal(await chrome.evaluate(`(()=>{const n=[...document.querySelectorAll('#dialog-content select')].find(n=>[...n.options].some(o=>o.value==='Quests'));if(!n)return false;n.value='Quests';n.dispatchEvent(new Event('change'));return true})()`), true);
    await until(() => chrome.evaluate("!!document.querySelector('#dialog-content [aria-label=\"Quest progress\"]')"));
    await click('#dialog-content [aria-label="Quest progress"] button', 'Can do now');
    await until(() => chrome.evaluate("document.querySelector('#dialog-content [aria-label=\"Quest progress\"] button[aria-pressed=\"true\"]')?.textContent==='Can do now'"));
    assert.equal(await chrome.evaluate("[...document.querySelectorAll('#dialog-content .search-result-title')].some(n=>n.textContent.includes('Later'))"), expected);
    assert.equal(gameplayWrites, 0); assert.equal(pageErrors, 0);
    return { checks: 7, failed: 0, gameplayWrites, pageErrors, planningAvailable: facts.planningAvailable };
  } finally {
    await chrome?.close(); await app?.close(); await rm(scratch, { recursive: true, force: true });
  }
}
