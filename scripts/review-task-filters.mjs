// Isolated browser review. Only task identities, scalar checks and screenshots escape the scratch session.
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openChrome, stopChild, until, sleep } from './perf/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local/taskfilters-review');
const source = path.join(root, '.local/duo');
const main = 'C:/Users/User/Projects/chunk-picker-rs3';
const key = 'rs3:active-task-filters:v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(await readFile(path.join(source, 'state.json')));
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, 'scratch-'));
const report = { stateSha256: sourceHash, personal: {}, group: {}, screenshots: {}, scratchPin: null, stage: 'scratch setup' };
let child, browser, reviewError;
const ids = rows => rows.map(row => row.id).sort();
const evidence = rows => ({ count: rows.length, identitiesSha256: hash(JSON.stringify(ids(rows))) });
async function probe(expression) { return browser.evaluate(expression); }
async function change(id, value) {
  const eventStart = ['member', 'group-view'].includes(id) ? await probe(`__rs3Perf.events.length`) : null;
  await probe(`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw Error('Missing control');n.${typeof value === 'boolean' ? 'checked' : 'value'}=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if (id === 'member') await until(() => probe(`__rs3Perf.events.slice(${eventStart}).some(e=>e.name==='tasks-shown'&&e.memberId===${JSON.stringify(value)})`), 180000);
  if ((id === 'group-view' && value === true) || (id === 'member' && await probe(`document.getElementById('group-view').checked`))) {
    await until(() => probe(`__rs3Perf.events.slice(${eventStart}).some(e=>e.name==='duo-tasks-shown'&&e.memberId===document.getElementById('member').value)`), 180000);
  }
  await settle();
}
async function settle() {
  // Filters paint incrementally. Require stable rows across several frames, then expand pagination.
  let last, stable = 0;
  await until(async () => {
    const value = await probe(`JSON.stringify({rows:[...document.querySelectorAll('#active-tasks .task-row')].map(n=>n.dataset.taskId),count:document.getElementById('task-count')?.textContent,summary:document.getElementById('task-filter-summary')?.textContent,busy:document.getElementById('task-count')?.textContent.includes('updating')})`);
    if (value === last && !JSON.parse(value).busy) stable++; else stable = 0;
    last = value; return stable >= 3;
  }, 180000, 100);
  for (let pass = 0; pass < 100; pass++) {
    const more = await probe(`[...document.querySelectorAll('#active-tasks button')].filter(n=>!n.disabled&&/^Show more /.test(n.textContent)).map(n=>n.textContent)`);
    if (!more.length) break;
    await probe(`[...document.querySelectorAll('#active-tasks button')].filter(n=>!n.disabled&&/^Show more /.test(n.textContent)).forEach(n=>n.click())`);
    await sleep(150);
    assert.ok(pass < 99, 'Active task pagination did not finish.');
  }
  await sleep(100);
}
async function rows() {
  return probe(`[...document.querySelectorAll('#active-tasks .task-row')].map(n=>({id:n.dataset.taskId,label:n.querySelector('.task-label-button')?.textContent,owners:n.dataset.owners??null,pinned:!!n.querySelector('.task-pin-star')}))`);
}
async function expectRows(expected, label) {
  await settle(); const actual = await rows();
  assert.ok(actual.every(row => typeof row.id === 'string' && row.id), `${label}: every row needs an identity.`);
  assert.deepEqual(ids(actual), ids(expected), `${label}: task identity set changed.`);
  return { ...evidence(actual), example: actual[0] ? { id: actual[0].id, label: actual[0].label } : null };
}
async function clear() {
  await probe(`document.getElementById('task-filters-clear').click()`);
  await probe(`(()=>{const n=document.getElementById('task-filter');n.value='';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(150); await settle();
}
async function owner(name) {
  await probe(`(()=>{const n=[...document.querySelectorAll('.duo-task-chip')].find(n=>n.textContent===${JSON.stringify(name)});if(!n)throw Error('Missing owner chip');n.click();})()`);
  await settle();
}
async function skill(category) {
  await probe(`(()=>{const n=[...document.querySelectorAll('[data-task-skill]')].find(n=>n.value===${JSON.stringify(category)});if(!n)throw Error('Missing skill category');n.checked=true;n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await settle();
}
async function screenshot(filename, width, theme, phoneOpen = true) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
  await probe(`import('/map-tools.mjs').then(m=>m.applyTheme(document.documentElement,${JSON.stringify(theme)}))`);
  if (width === 390) {
    await probe(`document.querySelector('.task-sidebar').scrollIntoView({block:'start'})`);
    await probe(`(()=>{const n=document.getElementById('task-filters-toggle');if(n.getAttribute('aria-expanded')!==${JSON.stringify(String(phoneOpen))})n.click()})()`);
    if (!phoneOpen) assert.equal(await probe(`getComputedStyle(document.getElementById('task-filters-panel')).display`), 'none');
  } else await probe(`window.scrollTo(0,0)`);
  await probe(`document.querySelectorAll('#task-filters-panel details').forEach(n=>{n.open=false})`);
  await sleep(250);
  const sizes = await probe(`({viewport:innerWidth,body:document.body.scrollWidth,panel:document.getElementById('task-filters-panel').getBoundingClientRect().width,filterLabel:document.getElementById('task-filters-toggle').textContent.trim()})`);
  assert.ok(sizes.body <= sizes.viewport, `Horizontal overflow in ${filename}`);
  assert.ok(sizes.panel <= width, `Filter panel overflow in ${filename}`);
  if (width === 390) assert.ok(sizes.filterLabel.includes('Filter'), 'Phone filter button needs its label.');
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, filename), Buffer.from(shot.data, 'base64'));
  report.screenshots[filename] = sizes;
}

try {
  const data = path.join(scratch, 'duo');
  await cp(source, data, { recursive: true, filter: filename => !['store.lock', 'invites.json', 'feedback.json', 'access-token'].includes(path.basename(filename)) });
  assert.equal(hash(await readFile(path.join(data, 'state.json'))), sourceHash);
  const env = { ...process.env, RS3_PERF_SCRATCH: data, RS3_PERF_PREWARM: 'off', RS3_PERF_SERVER_ENTRY: path.join(root, 'app/server.mjs'),
    RS3_DATA_DIR: data, RS3_GAME_DATA_DIR: path.join(main, '.local/game-data'), RS3_MAP_ASSETS_DIR: path.join(main, '.local/map-assets') };
  delete env.RS3_PUBLIC_ORIGIN; delete env.RS3_LOOPBACK_PORT;
  child = fork(path.join(root, 'scripts/perf/server.mjs'), [], { cwd: root, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Review server timed out.')), 180000);
    child.once('message', value => { clearTimeout(timer); value.type === 'ready' ? resolve(value) : reject(new Error('Review server failed.')); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Review server exited before readiness.')); });
  });
  const url = new URL(ready.inviteUrl);
  assert.equal(url.hostname, '127.0.0.1'); assert.ok(![8788, 8789, 8790, 8791].includes(Number(url.port)));
  browser = await openChrome('C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(scratch, 'chrome'));
  const chromePort = Number((await readFile(path.join(scratch, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]);
  assert.ok(![8788, 8789, 8790, 8791].includes(chromePort));
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__rs3Perf={enabled:true,events:[]};` });
  await browser.send('Page.navigate', { url: ready.inviteUrl });
  report.stage = 'initial copied-save load';
  await until(() => probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown')`), 180000);
  assert.equal(await probe(`!!document.querySelector('.active-task-filters')&&!!document.getElementById('task-filters-panel')`), true);
  await clear();
  // Private state stays only in this browser. Derive the old personal presentation independently of the new filter model.
  await probe(`(async()=>{
    const [{createTaskFactsIndex},{createRuleRegistryFromDefinitions},rules,envelope]=await Promise.all([import('/core/progress-index.mjs'),import('/core/rule-registry.mjs'),fetch('/api/rules').then(r=>r.json()),fetch('/api/state?view=play-v1').then(r=>r.json())]);
    globalThis.__taskReview={state:envelope.state,registry:createRuleRegistryFromDefinitions(rules.definitions),results:{},personal:{}};
    globalThis.__taskReview.baseline=(id,controls)=>{
      const {state,registry,results}=__taskReview,value=results[id],member=state.members.find(n=>n.id===id),status=member.taskStatus??{};
      const known=new Set(value.tasks.map(n=>n.id)),completed=new Set(member.completedTasks),extras=state.tasks.filter(n=>!known.has(n.id)&&(n.id.startsWith('custom:')||Object.hasOwn(status,n.id)||completed.has(n.id))).map(n=>({...n,status:n.id.startsWith('custom:')?'available':'unsupported',blockers:n.id.startsWith('custom:')?[]:[{kind:'unsupported'}]}));
      const candidates=[...value.tasks,...extras].filter(n=>n.obligation!==false&&!n.hidden),presented=new Set(value.presentation?.tasks.map(n=>n.id)??candidates.map(n=>n.id));
      const facts=createTaskFactsIndex(state,id,registry,{tasks:candidates,completionGroups:value.collectionPlanning?.completionGroups??{}});
      return candidates.filter(n=>!status[n.id]?.backlogged&&(n.status==='available'||controls.blocked)&&(presented.has(n.id)||n.id.startsWith('custom:')||controls.all||controls.blocked)&&(!controls.hide||!facts.get(n.id,n.completionIds).group));
    };
  })()`);
  for (const id of ['player1', 'player2']) {
    report.stage = `${id} personal filters`;
    await change('group-view', false); await change('member', id);
    await until(() => probe(`__rs3Perf.events.some(e=>e.name==='tasks-shown'&&e.memberId===${JSON.stringify(id)})`), 180000);
    await clear();
    await probe(`fetch('/api/tasks?memberId=${id}&view=play-v1').then(r=>r.json()).then(n=>{__taskReview.results[${JSON.stringify(id)}]=n})`);
    const expected = await probe(`(()=>{const controls={hide:document.getElementById('hide-completed').checked,blocked:document.getElementById('show-blocked').checked,all:document.getElementById('show-all').checked};const n=__taskReview.baseline(${JSON.stringify(id)},controls);__taskReview.personal[${JSON.stringify(id)}]=n;return n.map(t=>({id:t.id,label:t.label,category:t.category,level:t.level,status:t.status,blockers:t.blockers?.length??0}));})()`);
    assert.ok(expected.length > 0, `Expected ${id}'s real copied tasks.`);
    report.personal[id] = { before: evidence(expected), unfiltered: await expectRows(expected, `${id} unfiltered API comparison`) };
    const category = ['Smithing', 'Woodcutting', 'Mining'].find(name => expected.some(row => row.category === name)) ?? expected[0].category;
    await skill(category);
    report.personal[id].skill = { category, ...await expectRows(expected.filter(row => row.category === category), `${id} skill`) };
    await change('task-doable', true);
    const doable = expected.filter(row => row.category === category && row.status === 'available' && row.blockers === 0);
    report.personal[id].doable = await expectRows(doable, `${id} skill + doable`);
    await clear();
    await change('show-blocked', true);
    const blockedBase = await probe(`__taskReview.baseline(${JSON.stringify(id)},{hide:document.getElementById('hide-completed').checked,blocked:true,all:document.getElementById('show-all').checked}).map(t=>({id:t.id,label:t.label,status:t.status,blockers:t.blockers?.length??0}))`);
    await change('task-doable', true);
    report.personal[id].blockedRemoval = { before: blockedBase.length, ...await expectRows(blockedBase.filter(row => row.status === 'available' && row.blockers === 0), `${id} doable with blocked tasks exposed`), blockedExample: blockedBase.find(row => row.status !== 'available' || row.blockers > 0)?.label ?? null };
    await clear(); await change('show-blocked', false);
    report.personal[id].after = await expectRows(expected, `${id} after clear`);
  }
  await change('member', 'player1'); await change('group-view', true);
  report.stage = 'group filters';
  await until(() => probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown'&&e.memberId==='player1')&&!!document.querySelector('.duo-task-chip')`), 180000);
  await clear(); await owner('All');
  const group = await probe(`(async()=>{const {selectDuoTasks}=await import('/duo-tasks.mjs');const r=selectDuoTasks({state:__taskReview.state,results:Object.values(__taskReview.results),registry:__taskReview.registry,selectedMemberId:'player1',showCompleted:!document.getElementById('hide-completed').checked});__taskReview.group=r.rows;return r.rows.map(n=>({id:n.task.id,label:n.task.label,category:n.task.category,level:n.task.level,owners:n.memberIds,doableOwners:n.memberIds.filter(id=>n.tasksByMember[id].status==='available'&&!(n.tasksByMember[id].blockers?.length))}));})()`);
  report.group.unfiltered = await expectRows(group, 'Group unfiltered');
  assert.ok(group.some(row => row.owners.length > 1), 'Copied save needs an actual shared task.');
  const groupCategory = ['Smithing', 'Woodcutting', 'Mining'].find(name => group.some(row => row.category === name && row.owners.length > 1)) ?? group.find(row => row.owners.length > 1).category;
  for (const [name, ownerId] of [['All', 'all'], ['Player 1', 'player1'], ['Player 2', 'player2'], ['Both', 'both']]) {
    await clear(); await owner(name); await skill(groupCategory); await change('task-doable', true);
    const expected = group.filter(row => row.category === groupCategory && (ownerId === 'both' ? row.owners.length > 1 : ownerId === 'all' || row.owners.includes(ownerId)) && (ownerId === 'all' || ownerId === 'both' ? row.doableOwners.length > 0 : row.doableOwners.includes(ownerId)));
    report.group[name] = { category: groupCategory, skillAndDoable: await expectRows(expected, `Group ${name} + skill + doable`) };
  }
  await clear(); await owner('All');
  const pinsBefore = await probe(`Object.fromEntries(__taskReview.state.members.map(n=>[n.id,Object.values(n.taskStatus??{}).filter(v=>v.favorite===true).length]))`);
  report.stage = 'scratch-only pin';
  const candidate = group.find(row => row.category === groupCategory && row.owners.includes('player1') && row.doableOwners.includes('player1')) ?? group.find(row => row.owners.includes('player1') && row.doableOwners.includes('player1'));
  assert.ok(candidate, 'Need an actual doable Player 1 task for pin review.');
  const wasPinned = await probe(`__taskReview.state.members.find(n=>n.id==='player1').taskStatus?.[${JSON.stringify(candidate.id)}]?.favorite===true`);
  if (!wasPinned) {
    const changed = await probe(`fetch('/api/command?view=play-v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:__taskReview.state.revision,command:{type:'set-task-status',memberId:'player1',taskId:${JSON.stringify(candidate.id)},favorite:true}})}).then(async r=>{if(!r.ok)throw Error('Scratch pin failed');const n=await r.json();__taskReview.state=n.state;return {revision:n.state.revision,pins:Object.fromEntries(n.state.members.map(m=>[m.id,Object.values(m.taskStatus??{}).filter(v=>v.favorite===true).length]))}})`);
    report.scratchPin = { scratchOnly: true, taskId: candidate.id, label: candidate.label, owner: 'player1', before: pinsBefore, after: changed.pins, revision: changed.revision };
    await browser.send('Page.reload');
    await until(() => probe(`__rs3Perf.events.some(e=>e.name==='duo-tasks-shown')`), 180000);
  } else report.scratchPin = { scratchOnly: false, existing: true, taskId: candidate.id, label: candidate.label, before: pinsBefore, after: pinsBefore };
  // The scratch mutation is deliberately minimal. Build fresh private pin facts following reload.
  await probe(`fetch('/api/state?view=play-v1').then(r=>r.json()).then(n=>{globalThis.__pinState=n.state})`);
  for (const [name, ownerId] of [['All', 'all'], ['Player 1', 'player1'], ['Player 2', 'player2'], ['Both', 'both']]) {
    await clear(); await owner(name); await skill(candidate.category); await change('task-doable', true); await change('task-pinned', true);
    const pinIds = await probe(`(()=>{const owners=${JSON.stringify(ownerId)};return __pinState.members.filter(n=>owners==='all'||owners==='both'||n.id===owners).flatMap(n=>Object.entries(n.taskStatus??{}).filter(([,v])=>v.favorite===true).map(([id])=>({id,owner:n.id})))})()`);
    const expected = group.filter(row => row.category === candidate.category && (ownerId === 'both' ? row.owners.length > 1 : ownerId === 'all' || row.owners.includes(ownerId)) && pinIds.some(pin => pin.id === row.id && row.doableOwners.includes(pin.owner)));
    report.group[name].withPinned = await expectRows(expected, `Group ${name} + skill + doable + pinned`);
    assert.ok((await rows()).every(row => row.pinned), `Group ${name}: every pinned-only row needs its star.`);
  }
  await clear(); await owner('All');
  report.sort = {};
  report.stage = 'sorting and folds';
  for (const mode of ['level', 'skill', 'name', 'default']) {
    await change('task-sort', mode);
    const actual = await rows();
    assert.deepEqual(ids(actual), ids(group), `${mode} sorting changed identities.`);
    const byId = new Map(group.map(row => [row.id, row])), categories = new Map();
    for (const rendered of actual) { const row = byId.get(rendered.id); if (!categories.has(row.category)) categories.set(row.category, []); categories.get(row.category).push(row); }
    if (mode === 'skill') assert.deepEqual([...categories.keys()], [...categories.keys()].sort((a, b) => a.localeCompare(b)), 'Skill heading order.');
    if (mode !== 'default') for (const values of categories.values()) for (let index = 1; index < values.length; index++) {
      const left = values[index - 1], right = values[index];
      if (mode === 'level') assert.ok((left.level ?? Infinity) <= (right.level ?? Infinity), 'Ascending level order inside a category.');
      else assert.ok(left.label.localeCompare(right.label) <= 0, 'Alphabetic task order inside a category.');
    }
    report.sort[mode] = { ...evidence(actual), first: actual[0]?.label ?? null };
  }
  const folded = await probe(`(()=>{const n=document.querySelector('#active-tasks .task-category-toggle');n.click();return {category:n.dataset.category,expanded:n.getAttribute('aria-expanded'),target:n.getAttribute('aria-controls')}})()`);
  assert.equal(folded.expanded, 'false');
  assert.equal(await probe(`document.getElementById(${JSON.stringify(folded.target)})?.hidden`), true);
  report.fold = folded;
  await skill(candidate.category); await change('task-doable', true); await change('task-pinned', true); await change('task-sort', 'name');
  const persisted = await probe(`localStorage.getItem(${JSON.stringify(key)})`);
  report.stage = 'persistence';
  assert.ok(JSON.parse(persisted).folded.includes(folded.category));
  await change('group-view', false); await change('member', 'player2');
  assert.equal(await probe(`localStorage.getItem(${JSON.stringify(key)})`), persisted);
  await browser.send('Page.reload');
  await until(() => probe(`!!document.querySelector('.active-task-filters')&&__rs3Perf.events.some(e=>e.name==='tasks-shown'||e.name==='duo-tasks-shown')`), 180000);
  assert.equal(await probe(`localStorage.getItem(${JSON.stringify(key)})`), persisted);
  const restored = await probe(`({doable:document.getElementById('task-doable').checked,pinned:document.getElementById('task-pinned').checked,sort:document.getElementById('task-sort').value,skills:[...document.querySelectorAll('[data-task-skill]:checked')].map(n=>n.value)})`);
  assert.equal(restored.doable, true); assert.equal(restored.pinned, true); assert.equal(restored.sort, 'name'); assert.ok(restored.skills.includes(candidate.category));
  report.persistence = { reload: true, personalGroupAndMemberSwitch: true, restored };
  await clear(); await change('member', 'player1'); await change('group-view', true); await owner('All');
  await probe(`(()=>{const n=[...document.querySelectorAll('#active-tasks .task-category-toggle')].find(n=>n.dataset.category===${JSON.stringify(folded.category)});if(n.getAttribute('aria-expanded')==='false')n.click();})()`);
  await settle();
  report.unfold = await probe(`(()=>{const n=[...document.querySelectorAll('#active-tasks .task-category-toggle')].find(n=>n.dataset.category===${JSON.stringify(folded.category)});return {expanded:n.getAttribute('aria-expanded'),hidden:document.getElementById(n.getAttribute('aria-controls')).hidden}})()`);
  assert.equal(report.unfold.expanded, 'true'); assert.equal(report.unfold.hidden, false);
  const searchExample = group.find(row => row.label.length > 5) ?? group[0];
  report.stage = 'search debounce';
  await probe(`(()=>{const n=document.getElementById('task-filter');for(const q of ['this cannot match any real task 748273',${JSON.stringify(searchExample.label)}]){n.value=q;n.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await sleep(200); await settle();
  const query = searchExample.label.toLowerCase().trim();
  report.search = { query: searchExample.label, rapidInputDebounce: true, ...await expectRows(group.filter(row => `${row.label} ${row.category}`.toLowerCase().includes(query)), 'Debounced search latest value') };
  await clear(); await skill(candidate.category); await change('task-doable', true);
  report.summary = await probe(`document.getElementById('task-filter-summary').textContent`);
  assert.match(report.summary, /hidden by filters/); assert.match(report.summary, /Clear/);
  report.stage = 'screenshots';
  for (const width of [1440, 390]) for (const theme of ['light', 'gray']) await screenshot(`${width === 390 ? 'phone-390' : 'desktop'}-${theme}.png`, width, theme);
  await screenshot('phone-390-gray-collapsed.png', 390, 'gray', false);
  await clear(); await owner('All');
  report.group.afterClear = await expectRows(group, 'Group clear restores original identities');
  report.stage = 'complete';
  report.passed = true;
} catch (error) {
  reviewError = error; report.passed = false;
  // Error strings from browser/API code may contain private details. Report a fixed failure marker only.
  report.failure = 'A review assertion or browser operation failed; see the local process error.';
} finally {
  const cleanup = [];
  try { await browser?.close(); } catch (error) { cleanup.push(error); }
  try {
    if (child?.connected && child.exitCode === null) { child.send({ type: 'stop' }); await until(() => child.exitCode !== null, 10000).catch(() => {}); }
    await stopChild(child);
  } catch (error) { cleanup.push(error); }
  if (!cleanup.length) {
    const resolved = await realpath(scratch), boundary = await realpath(output);
    assert.ok(resolved.startsWith(boundary + path.sep) && path.basename(resolved).startsWith('scratch-'));
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    report.scratchRemoved = true;
  } else { report.scratchRemoved = false; report.passed = false; }
  report.sourceUnchanged = hash(await readFile(path.join(source, 'state.json'))) === sourceHash;
  assert.equal(report.sourceUnchanged, true, 'Frozen source save changed.');
  await writeFile(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  if (!reviewError && cleanup.length) reviewError = new Error('Review process cleanup failed; scratch retained.');
}
if (reviewError) throw reviewError;
console.log(JSON.stringify({ passed: report.passed, sourceUnchanged: report.sourceUnchanged, personal: Object.fromEntries(Object.entries(report.personal).map(([id, value]) => [id, value.unfiltered.count])), group: report.group.unfiltered.count, screenshots: Object.keys(report.screenshots), scratchRemoved: report.scratchRemoved }));
