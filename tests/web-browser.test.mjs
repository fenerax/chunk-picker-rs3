import { appendTaskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';
import { observeScreenBars } from '../app/web/phone-layout.mjs';
import { readScreenGraph, runScreenGraph } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { buildWorld } from '../app/data/world.mjs';
import { applyCommand, createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { futureSlayerUnlocksRule } from '../app/data/slayer-unlock-gates.mjs';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress.mjs';
import { resolveTaskAlternatives } from '../app/core/task-alternatives.mjs';
import { originalSettings, settingDefinitions, taskHowPreference } from '../app/data/settings.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { createInfoPanels, createNoteEditor, reviewedNoteRevision } from '../app/web/info-panels.mjs';
import { createChunkQuestList } from '../app/web/chunk-quest-filters.mjs';
import { createMapTools, applyTheme } from '../app/web/map-tools.mjs';
import { createDeathChunks } from '../app/web/death-chunks.mjs';
import { appendTaskHow } from '../app/web/task-how.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';
import { createMiningSettings } from '../app/web/mining-settings.mjs';
import { createWoodcuttingSettings } from '../app/web/woodcutting-settings.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';
import { mergeCommandState, projectChunkState, projectTaskState } from '../app/web/command-state.mjs';
import { createOriginalSync } from '../app/web/dataset-panels.mjs';
import { projectDisplayWorld, hydrateDisplayWorld } from '../app/display-world.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { createMapTaskCounts } from '../app/web/map-task-counts.mjs';
import { createChunkPlanning } from '../app/web/chunk-planning.mjs';
import { createRulesPanel } from '../app/web/rules-panel.mjs';
import { createTaskHover } from '../app/web/task-hover.mjs';
import { createTaskMethods } from '../app/web/task-methods.mjs';
import { renderTaskEquipment } from '../app/web/task-equipment.mjs';
import { taskItemIcon, taskIcon, taskCategoryIcon } from '../app/tasks/task-icons.mjs';
import { createSandbox } from '../app/web/sandbox.mjs';
import { openSandboxRules } from '../app/web/sandbox-rules.mjs';
import { openTeleportsDialog, travelIntoChunk } from '../app/web/teleports.mjs';
import { createTaskIconPainter } from '../app/web/task-icon-painter.mjs';
import { createDuoResultCache, selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';
import { createDuoBacklogView } from '../app/web/duo-backlog-view.mjs';
import { createTaskFilters, appendTaskPin } from '../app/web/task-filters.mjs';
import { appendTaskWhy, catalogued, createRuleDescriber, savedTaskWhyResult } from '../app/web/task-why.mjs';
import { isTaskPinned, createTaskPinChecker } from '../app/web/task-filters-model.mjs';
import { createActivityFilterControls, selectActivityRows } from '../app/web/activity-filters.mjs';
import { createCompletedView } from '../app/web/completed-view.mjs';
import { createDuoCoordination } from '../app/web/duo-coordination.mjs';
import { createFeedback } from '../app/web/feedback.mjs';
import { historyChangeTypes, historyChangeType } from '../app/web/history-text.mjs';
import { backupSaveLabel } from '../app/web/backup-status.mjs';
import { artStatusText } from '../app/web/art-status.mjs';
import { datasetStatusText } from '../app/web/dataset-status.mjs';
import { readBackupRequest, BACKUP_UPLOAD_TYPE } from '../app/backup-transfer.mjs';
import { Readable } from 'node:stream';

// Execute complete shipped UI modules with browser collaborators and controlled
// responses. Only module imports and automatic startup are replaced; no function
// bodies are extracted. These fixtures never contact a server or write gameplay.
const screenGraph = await readScreenGraph();
const settingsSource = (await readFile(new URL('../app/web/settings-panel.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const task = { id: 'custom:note', label: 'Test task', category: 'Custom', status: 'available' };
const taskResult = revision => ({ stateRevision: revision, memberId: 'actor1', tasks: [], presentation: { tasks: [], alternatives: {} }, metrics: { availableCount: 0, elapsedMs: 1 }, access: { areas: [] } });
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
// Registration and recovery add promise hops before a command reaches the wire.
// Drain the current turn without guessing their count or resolving deferred IO.
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const compact of [true, false]) test(`uifix: Hide completed off restores completion-only presentation rows (${compact ? 'compact' : 'full'})`, async () => {
  const h = harness();
  const done = { id: 'builtin:purchase', label: 'Buy a bronze tool', category: 'Shopping', status: 'available' };
  const excluded = { ...done, id: 'builtin:excluded', label: 'Excluded purchase' };
  h.context.completedFixture = { ...taskResult(7), ...(compact ? { format: 'play-v1' } : {}), tasks: [done, excluded],
    presentation: { tasks: [], ...(compact ? { completedTasks: [{ id: done.id }] } : {
      suppressed: { [done.id]: ['Challenge already satisfied.'], [excluded.id]: ['Challenge already satisfied.', 'Hidden by rule.'] },
    }) } };
  h.run("member().taskStatus = { 'builtin:purchase': { challengeCompleted:true }, 'builtin:excluded': { challengeCompleted:true } }; result = completedFixture; $('hide-completed').checked = false; renderTasks()");
  await h.run('taskRenderDone');
  const rows = h.nodes.get('active-tasks');
  assert.ok(h.find('button', done.label) && rows.contains(h.find('button', done.label)));
  assert.ok(!h.all().some(node => node.textContent === excluded.label && rows.contains(node)), 'Other presentation gates remain authoritative');
  const checkbox = h.find('button', done.label).parentElement.parentElement.parentElement.querySelector('input');
  assert.equal(checkbox.checked, true);
  h.run("$('hide-completed').checked = true; renderTasks()"); await h.run('taskRenderDone');
  assert.ok(!rows.contains(h.find('button', done.label)));
});

test('uifix: starting guidance follows the selected unstarted member', () => {
  const h = harness(); h.run("state.members[0].unlocked = ['12341']; state.members[1].unlocked = []; memberId = state.members[1].id; renderState()");
  assert.equal(h.nodes.get('empty-map').hidden, false);
  h.run("memberId = state.members[0].id; renderState()"); assert.equal(h.nodes.get('empty-map').hidden, true);
  h.run("memberId = state.members[1].id; member().selected = ['12342']; renderState()"); assert.equal(h.nodes.get('empty-map').hidden, false);
});

for (const choices of [1, 2]) test(`first-start guidance yields to ${choices} pending choice(s) for the selected member`, () => {
  const h = harness();
  h.run(`member().pendingRoll = ['12341', '12342'].slice(0, ${choices}); renderState()`);
  assert.equal(h.nodes.get('empty-map').hidden, true, 'The incompatible first-start card is hidden');
  assert.equal(h.nodes.get('pending-panel').hidden, false);
  assert.ok(h.find('button', 'Unlock Chunk 12341'));
  assert.ok(h.find('button', 'Cancel roll'));
  h.run("memberId = state.members[1].id; member().selected = ['12342']; renderState()");
  assert.equal(h.nodes.get('empty-map').hidden, false, 'Another unstarted member retains guidance with manual selections');
  assert.equal(h.nodes.get('pending-panel').hidden, true);
  h.run('memberId = state.members[0].id; renderState()');
  assert.equal(h.nodes.get('empty-map').hidden, true, 'Switching back restores pending guidance');
});

for (const action of ['Unlock Chunk 12341', 'Unlock Chunk 12342', 'Pick for me', 'Unlock both', 'Cancel roll'])
test(`first-start guidance follows ${action}, undo and cancellation`, async () => {
  const h = harness();
  h.run("state.tasks = state.tasks.map(({ status, ...task }) => task); member().pendingRoll = ['12341', '12342']; renderState()");
  h.route((path, body) => path.startsWith('/api/tasks') ? taskResult(h.run('state.revision')) : {
    state: applyCommand(h.snapshot(), body.command, { world: h.context.initialWorld, random: () => 0 }), pools: {},
  });
  assert.equal(h.nodes.get('empty-map').hidden, true);
  await h.click(action);
  assert.equal(h.run('member().pendingRoll.length'), 0);
  assert.equal(h.nodes.get('pending-panel').hidden, true);
  assert.equal(h.run('member().unlocked.length'), action === 'Cancel roll' ? 0 : action === 'Unlock both' ? 2 : 1);
  assert.equal(h.nodes.get('empty-map').hidden, action !== 'Cancel roll');
  await h.run("command({ type: 'undo' })");
  assert.equal(h.nodes.get('empty-map').hidden, true, 'Undo restores pending choices without first-start guidance');
  assert.equal(h.nodes.get('pending-panel').hidden, false);
  await h.click('Cancel roll');
  assert.equal(h.nodes.get('empty-map').hidden, false, 'Cancellation restores ordinary first-start guidance');
  assert.equal(h.nodes.get('pending-panel').hidden, true);
});

for (const clipped of [false, true]) test(`uifix: note search ${clipped ? 'expands a clipped note' : 'keeps a short note compact'}`, async () => {
  const h=harness(); h.run("chunkNoteReveal={chunkId:'12341',memberIds:[memberId],query:member().notes['12341'].slice(0,6).toLowerCase()}; chunkTab='note'; showChunk('12341')");
  const editor=h.all().find(node=>node.className==='chunk-own-note'), text=editor.querySelector('textarea');
  text.clientHeight=60;text.scrollHeight=clipped?300:60;await flush();
  assert.equal(editor.dataset.expanded,String(clipped));assert.equal(h.context.document.activeElement,text);
});

for (const status of [403, 409, 422]) test(`uifix: HTTP ${status} stays refused across live revisions until a later save`, async () => {
  const h = harness();
  h.route(() => ({ ok:false, status, value:{message:'Synthetic refusal'} }));
  await assert.rejects(h.run("command({type:'set-note',memberId,chunkId:'12341',note:'Rejected'})")); await h.run('queue');
  h.run('connectEvents()'); await flush();
  const remote = h.snapshot(); remote.revision++;
  h.route(path => path === '/api/state' ? {state:remote,pools:{}} : {state:{...remote,revision:remote.revision+1},pools:{}});
  await h.eventSources[0].emit('revision',{data:JSON.stringify({revision:remote.revision})});
  assert.equal(h.nodes.get('save-status').textContent, 'Change refused · review');
  assert.equal(h.nodes.get('save-status').dataset.status, 'failed');
  await h.run("command({type:'set-note',memberId,chunkId:'12341',note:'Accepted'})");
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

for (const action of ['Retry save', 'Discard pending save']) test(`uifix: real pending transport shares ${action} beside the failed dialog control`, async () => {
  const h = harness(), original = h.context.createLiveSwapCommandClient;
  h.context.createLiveSwapCommandClient = options => original({ ...options, maxAttempts:2, sleep:async()=>{} });
  h.nodes.get('test-task-header').append(h.nodes.get('save-status'));
  h.run("showTask(state.tasks[0])");
  const save = h.find('button','Save note'); save.focus();
  let blocked = true;
  h.route((path, body) => { if(blocked) throw Error('Synthetic connection loss'); const state=h.snapshot(); if(path==='/api/command') { state.revision++; state.members[0].taskStatus[task.id].note=body.command.note; } return {state,pools:{}}; });
  await save.emit('click'); await h.run('queue');
  const dialog = h.nodes.get('dialog-content'), recoveries = h.all().filter(node=>node.textContent==='Retry save' && dialog.contains(node));
  assert.ok(recoveries.length);
  assert.equal(h.run('hasPendingCommand()'),true);
  h.run("saved('Saved',false,state.revision)"); assert.notEqual(h.nodes.get('save-status').textContent,'Saved');
  await h.click('Dismiss');assert.equal(h.run('hasPendingCommand()'),true);assert.notEqual(h.nodes.get('save-status').textContent,'Saved');
  h.context.confirm=()=>true;
  blocked=false; await h.all().find(node=>node.textContent===action && dialog.contains(node)).emit('click');
  assert.equal(h.run('hasPendingCommand()'),false);
  assert.equal(h.nodes.get('save-status').textContent,action==='Retry save'?'Saved':'Pending save discarded');
  assert.ok(!h.all().some(node=>node.textContent==='Retry save'));
  assert.equal(h.calls.filter(call=>call.path==='/api/command').length,action==='Retry save'?2:1);
  if(action==='Retry save') assert.deepEqual(h.calls[0].body,h.calls[1].body,'Both controls replay the single frozen command');
});

test('uifix: dismissing a refusal acknowledges it without hiding an insecure or pending save', async () => {
  const h=harness();h.route(()=>({ok:false,status:422,value:{message:'Synthetic refusal'}}));
  await assert.rejects(h.run("command({type:'set-note',memberId,chunkId:'12341',note:'Refused'})"));await h.run('queue');
  assert.equal(h.nodes.get('save-status').textContent,'Change refused · review');await h.click('Dismiss');
  assert.equal(h.nodes.get('save-status').textContent,'Saved');
  h.context.isSecureContext=false;h.run("saved('Change refused · review',true,undefined,{refused:true}); notice('Cannot save',true)");await h.click('Dismiss');
  assert.equal(h.nodes.get('save-status').textContent,'This address cannot save');
});

test('uifix: insecure origin outranks startup, live sync and a refused attempt', () => {
  const h=harness(); h.context.isSecureContext=false;
  h.run("saved('Saved',false,state.revision)");
  assert.equal(h.nodes.get('save-status').textContent,'This address cannot save');
  h.run("saved('Saving…'); saved('Save failed',true); saved('Saved',false,state.revision)");
  assert.equal(h.nodes.get('save-status').textContent,'This address cannot save');
  assert.equal(h.nodes.get('save-status').dataset.status,'failed');
});

test('uifix: group filters show the inclusion explanation without a tooltip', () => {
  const h=harness(); h.run("$('group-view').checked=true; $('show-blocked').checked=true; renderTasks()");
  const hint=h.nodes.get('task-inclusion-hint');
  assert.equal(hint.textContent,'Show blocked already includes all possible tasks.'); assert.equal(hint.hidden,false);
  h.run("$('show-blocked').checked=false; renderTasks()"); assert.equal(hint.hidden,true);
});

test('uifix: group calculation count names its member after reuse and a fresh load', async () => {
  const h=harness(); h.context.countFixture=taskResult(7);
  const expected=h.run("'0 possible tasks for '+member().name");
  h.run("result=countFixture; adopt(state,{},countFixture,false); $('group-view').checked=true; renderTasks()");
  assert.equal(h.nodes.get('task-engine-status').children[0].textContent,expected);
  h.run("$('group-view').checked=false; renderTasks()");assert.equal(h.nodes.get('task-engine-status').children[0].textContent,'0 possible tasks');
  h.run("$('group-view').checked=true; renderTasks()");
  h.route(()=>taskResult(7)); await h.run('loadTasks()');
  assert.equal(h.nodes.get('task-engine-status').children[0].textContent,expected);
});

test('roll pool actions use plain labels and preserve command statuses', async () => {
  const h = harness(), sent = []; h.context.sent = sent;
  h.run("command = async value => { sent.push(value); }; member().unlocked = []; member().selected = []; member().blacklisted = []; member().pendingRoll = []");
  assert.deepEqual(Array.from(h.run("chunkStatusActions('12341').map(action => action.label)")), ['Unlock', 'Add to roll pool', 'Never roll']);
  await h.run("chunkStatusActions('12341').find(action => action.label === 'Add to roll pool').run()");
  assert.equal(sent.at(-1).status, 'selected');
  h.run("member().selected = ['12341']");
  await h.run("chunkStatusActions('12341').find(action => action.label === 'Remove from roll pool').run()");
  assert.equal(sent.at(-1).status, 'locked');
  h.run("member().selected = []; member().blacklisted = ['12341']");
  assert.ok(h.run("chunkStatusActions('12341').some(action => action.label === 'Allow in roll pool')"));
});

test('saved chunk actions refresh while focused and keep an independent note draft intact', () => {
  const h = harness();
  h.run("member().unlocked = []; member().selected = []; chunkTab = 'note'; showChunk('12341')");
  const textarea = h.all().find(node => node.tagName === 'TEXTAREA');
  textarea.value = 'Keep this unsaved draft'; textarea.emit('input'); textarea.focus();
  const next = h.snapshot(); next.revision++; next.members[0].selected = ['12341'];
  h.adopt(next);
  assert.equal(h.context.document.activeElement, textarea);
  assert.equal(textarea.value, 'Keep this unsaved draft');
  assert.ok(h.find('p', 'In roll pool (added by hand)'));
  assert.ok(h.find('button', 'Remove from roll pool'));
  assert.ok(!h.find('button', 'Add to roll pool'));
  const remove = h.find('button', 'Remove from roll pool'); remove.focus();
  const locked = h.snapshot(); locked.revision++; locked.members[0].selected = [];
  h.adopt(locked);
  assert.ok(h.find('p', 'Locked'));
  assert.equal(h.context.document.activeElement.textContent, 'Add to roll pool');
});

test('hidden task search offers an undoable preference change beside the field', async () => {
  const h = harness(), sent = [];
  h.nodes.get('test-task-header').append(h.nodes.get('task-filter'));
  const lookup = h.context.document.getElementById;
  h.context.document.getElementById = id => id === 'show-task-search' ? h.all().find(node => node.id === id) ?? null : lookup(id);
  h.context.sent = sent;
  h.run("member().preferences.taskSearchbar = false; applyPreferences(); command = async value => { sent.push(value); member().preferences.taskSearchbar = true; preferenceSignature = undefined; applyPreferences(); }");
  const restore = h.find('button', 'Show task search'); assert.ok(restore); assert.equal(restore.hidden, false);
  await restore.emit('click');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { type: 'set-preference', memberId: 'actor1', preferenceId: 'taskSearchbar', value: true });
  assert.equal(h.nodes.get('task-filter').hidden, false);
});

test('a blocking-rule link leaves a remembered guided review and opens the requested player’s editor', async () => {
  const h = harness(); h.run('rulesPanel.open()');
  await h.click('Review rules'); assert.ok(h.find('button', 'Back to all rules'));
  h.run("rulesPanel.open({ruleId:'content.f2p',memberId:'reed'})");
  assert.ok(h.find('button', 'Review rules'));
  assert.ok(h.all().some(node => node.textContent === 'Task rules belong to Reed. Shared map rules always affect both players.'));
});

test('Ctrl and Cmd click toggle the roll pool without unlocking, including with Shift held', async () => {
  const h = harness(), sent = []; h.context.sent = sent;
  h.run("command = async value => { sent.push(value); }; member().unlocked = []; member().selected = []; member().pendingRoll = []");
  await h.run("mapChunkClick('12341', { ctrlKey: true, shiftKey: true })");
  assert.equal(sent.at(-1).status, 'selected');
  h.run("member().selected = ['12341']");
  await h.run("mapChunkClick('12341', { metaKey: true })");
  assert.equal(sent.at(-1).status, 'locked');
  assert.deepEqual(Array.from(h.run('member().unlocked')), []);
});

for (const [setup, reason] of [
  ["member().unlocked = ['12341']", /already unlocked/],
  ["member().unlocked = []; member().pendingRoll = ['12341']", /pending roll choice/],
  ["world.surface.delete('12341')", /Only surface chunks/],
  ["applySession({readOnly:true, capabilities:{canWrite:false}, admin:false})", /View-only link/],
  ["sandbox = { active: true }", /Leave Sandbox/],
]) test(`Ctrl click explains blocked roll pool changes: ${reason.source}`, async () => {
  const h = harness(); let writes = 0; h.context.recordWrite = () => { writes++; };
  h.run('command = async () => recordWrite()'); h.run(setup);
  await h.run("mapChunkClick('12341', {ctrlKey:true})");
  assert.equal(writes, 0); assert.match(h.nodes.get('notice').children[0].textContent, reason);
});

test('desktop menu hints are omitted on touch and viewer menus have no writes', () => {
  const h = harness();
  h.context.bindStickerFlyout = () => ({ destroy() {} });
  h.nodes.get('map-panel').getBoundingClientRect = () => ({left:0,top:0,width:800,height:600});
  h.run("member().unlocked = []; chunkMenu('12341',100,100)");
  assert.ok(h.find('small', 'Ctrl/Cmd-click'));
  h.run("chunkMenu('12341',100,100,'touch')");
  assert.ok(!h.find('small', 'Ctrl/Cmd-click'));
  h.context.matchMedia = () => ({ matches: true });
  h.run("chunkMenu('12341',100,100)");
  assert.ok(!h.find('small', 'Ctrl/Cmd-click'), 'touch devices omit the desktop hint even without a pointer type');
  const viewer = viewerHarness();
  viewer.nodes.get('map-panel').getBoundingClientRect = () => ({left:0,top:0,width:800,height:600});
  viewer.run("chunkMenu('12341',100,100,'touch')");
  assert.ok(viewer.find('button', 'Chunk details'));
  assert.ok(!viewer.find('button', 'Add to roll pool'));
  assert.ok(!viewer.find('button', 'Unlock'));
});

test('touch Ctrl taps open info; shared Help and legend controls explain shortcuts', () => {
  const h = harness(); let opened; h.context.recordOpen = id => { opened = id; };
  h.run("showChunk = id => recordOpen(id); mapChunkClick('12341', {pointerType:'touch',ctrlKey:true})");
  assert.equal(opened, '12341');
  h.run("openDialog('Help', mapControls())");
  assert.equal(h.nodes.get('dialog-title').textContent, 'Help');
  for (const text of ['Ctrl/Cmd-click', 'Shift-click', 'Right-click or long-press', 'keeps the chunk locked']) {
    assert.ok(h.all().some(node => node.textContent.includes(text)), text);
  }
});

function viewerHarness(options) {
  const h = harness(options);
  h.run('applySession({readOnly:true, capabilities:{canWrite:false},admin:false}); renderState()');
  return h;
}

test('Advanced hides calculation details by default and follows the selected player', async () => {
  const h = harness(); h.route(() => taskResult(7));
  await h.run('loadTasks()');
  assert.equal(h.nodes.get('task-engine-status').children[0].textContent, '0 possible tasks');
  assert.ok(!h.find('button', 'Details'));
  const before = h.calls.length; await h.run('engineDetails()'); assert.equal(h.calls.length, before);
  h.run('state.members[0].preferences.advanced = true; engineDetails()');
  assert.equal(h.nodes.get('dialog-title').textContent, 'Task calculation');
  assert.ok(h.find('summary', 'Data issues'));
  h.run("closeDialog(); memberId = 'reed'");
  assert.equal(h.run('advanced()'), false);
  await h.run('engineDetails()'); assert.equal(h.nodes.get('tool-dialog').open, false);
  h.run("memberId = 'actor1'; applySession({ readOnly: true })");
  assert.equal(h.run('advanced()'), false); assert.equal(h.run('preferences().advanced'), false);
});

test('Advanced gates History commands and backup reports without removing the ordinary actions', () => {
  const h = harness(); h.run("state.history = [{ revision: 7, type: 'set-note', at: '2026-10-12T12:00:00Z', command: { type: 'set-note' } }]; renderHistory(state.history)");
  assert.ok(h.find('strong', 'set-note')); assert.ok(!h.find('summary', 'Change details'));
  h.run('backupDialog()'); assert.ok(h.find('button', 'Download full backup')); assert.ok(!h.find('button', 'View migration report'));
  h.run('state.members[0].preferences.advanced = true; renderHistory(state.history)');
  assert.ok(h.find('summary', 'Change details'));
  h.run('backupDialog()'); assert.ok(h.find('button', 'View migration report'));
});

test('Advanced keeps task and item raw data optional while preserving sources and equip requirements', () => {
  const h = harness(); h.context.rawTask = { ...task, record: { Description: 'A plain task description.' } };
  h.run('showTask(rawTask, true)'); assert.ok(!h.find('summary', 'Full requirements'));
  h.context.rawItem = { name: 'Sword', slot: 'mainhand', class: 'melee', tier: 10 };
  h.run('showItem(rawItem)'); assert.ok(h.find('p', 'mainhand · melee · Tier 10')); assert.ok(!h.find('summary', 'Full item details'));
  h.run('state.members[0].preferences.advanced = true; showTask(rawTask, true)'); assert.ok(h.find('summary', 'Full requirements'));
  h.run('showItem(rawItem)'); assert.ok(h.find('summary', 'Full item details'));
});

test('Quest task details include the local map action for viewers and ordinary tasks do not', () => {
  const h = viewerHarness();
  h.context.questTask = { ...task, category: 'Quest', rawLabel: '~|Example|~ Complete the quest', record: { BaseQuest: 'Example', QuestPoints: 1 } };
  h.run('showTask(questTask, true)'); assert.ok(h.find('button', 'Show on map'));
  assert.ok(!h.find('button', 'Save note')); assert.equal(h.calls.length, 0);
  h.run('showTask(rawOrdinary = { ...questTask, category: "Crafting" }, true)');
  assert.ok(!h.find('button', 'Show on map'));
});

test('received feedback keeps text and actions visible while Advanced controls technical context', async () => {
  const h = harness(); h.route(() => ({ items: [{ id: 'feedback-1', kind: 'bug', text: 'A readable bug report.', status: 'new', at: '2026-10-12T12:00:00Z', context: { revision: 7, chunk: '12341 Chunk 12341' } }] }));
  const panel = createFeedback({ api: h.context.api, el: h.context.el, button: h.context.button, input: h.context.input, field: h.context.field, openDialog: h.context.openDialog, dialogCurrent: h.context.dialogCurrent, isAdmin: () => true, advanced: h.context.advanced });
  panel.open(); await flush();
  assert.ok(h.find('p', 'A readable bug report.')); assert.ok(h.find('button', 'Mark handled'));
  assert.ok(!h.all().some(node => node.className === 'feedback-context'));
  h.run('state.members[0].preferences.advanced = true'); panel.open(); await flush();
  assert.ok(h.all().some(node => node.className === 'feedback-context' && node.textContent.includes('revision: 7')));
  h.run('applySession({ readOnly:true })'); panel.open(); await flush();
  assert.ok(!h.all().some(node => node.className === 'feedback-context'));
});

for (const loader of ['loadTasks', 'ensureResult']) test(`viewer ${loader} reports a plain count without diagnostics or detail requests`, async () => {
  const h = viewerHarness(); h.route(() => ({...taskResult(7),format:'play-v1'}));
  await h.run(`${loader}()`);
  const status=h.nodes.get('task-engine-status'); assert.equal(status.children.length,1); assert.equal(status.children[0].textContent,'0 possible tasks');
  assert.ok(!h.find('button','Details')); const before=h.calls.length;
  await h.run('engineDetails()'); assert.equal(h.calls.length,before); assert.equal(!!h.nodes.get('tool-dialog')?.open,false);
  const reused=h.snapshot(); reused.revision++; h.context.reused=reused;
  h.run('adopt(reused,{},result,false)'); assert.equal(status.children.length,1); assert.equal(status.children[0].textContent,'0 possible tasks');
  assert.ok(!h.find('button','Details')); assert.equal(h.calls.length,before);
});

for (const loader of ['loadTasks','ensureResult']) test(`viewer ${loader} accepts retained task bytes with the current revision header`, async () => {
  const h=viewerHarness(),cached={...taskResult(7),format:'play-v1',metrics:{availableCount:42,elapsedMs:1000}};
  h.route(()=>structuredClone(cached)); const fetch=h.context.fetch;
  h.context.fetch=async (...args)=>({...await fetch(...args),headers:{get:name=>name==='X-RS3-State-Revision'?'8':null}});
  h.run('state.revision=8'); await h.run(`${loader}()`);
  assert.equal(h.run('result.stateRevision'),8); assert.equal(h.run('result.metrics.availableCount'),42);
  assert.equal(h.nodes.get('task-engine-status').children[0].textContent,'42 possible tasks');
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].path,'/api/tasks?memberId=actor1');
  assert.equal(cached.stateRevision,7); assert.ok(!h.find('button','Details'));
});

test('viewer capability hides every saved editor entry while player and admin sessions retain editing', async () => {
  const editorIds = ['settings-open', 'runemetrics-open', 'feedback-open', 'teleports-open', 'invites-open', 'backup-open', 'original-sync-open', 'pick', 'roll-two', 'unpick', 'undo', 'sandbox-toggle', 'custom-task-open', 'empty-import', 'random-start'];
  for (const session of [{readOnly:true}, {capabilities:{canWrite:false}}, {canWrite:false,admin:true}]) {
    const h = harness(); h.context.sessionFixture = session;
    h.run('applySession(sessionFixture); renderState()');
    assert.equal(h.run('canWrite()'), false); assert.equal(h.run('sessionAdmin'), false);
    assert.equal(h.nodes.get('view-only-badge').hidden, false);
    for (const id of editorIds) assert.equal(h.nodes.get(id).hidden, true, id);
    assert.equal(h.nodes.get('bis-open').hidden, false); assert.equal(h.nodes.get('activity-open').hidden, false); assert.equal(h.nodes.get('history-open').hidden, false);
    assert.equal(h.calls.length, 0);
  }
  for (const admin of [false, true]) {
    const h = harness(); h.context.sessionFixture = {admin,readOnly:false,capabilities:{canWrite:true}};
    h.run('applySession(sessionFixture); renderState()');
    assert.equal(h.run('canWrite()'), true); assert.equal(h.run('sessionAdmin'), admin);
    assert.equal(h.nodes.get('view-only-badge').hidden, true);
    await h.run("command({type:'set-note',memberId:'actor1',chunkId:'12341',note:'Editor note'})");
    assert.equal(h.snapshot().members[0].notes['12341'], 'Editor note');
  }
});

test('viewer rejects writes and advisory calculations before fetch or optimistic chunk changes', async () => {
  const h = viewerHarness(), before = h.snapshot();
  for (const call of ["command({type:'set-preference',memberId:'actor1',preferenceId:'theme',value:'light'})", "toggleChunk('12341')", "api('/api/feedback', {message:'change'})", "api('/api/sandbox/evaluate', {})", "api('/api/runemetrics/preview', {})", "api('/api/invites', {})", "predictUnlock('12342')", ...['predict', 'death-estimates', 'chunk-planning', 'training-plan', 'teleports'].map(path => `api('/api/${path}?memberId=actor1')`)]) await assert.rejects(h.run(call), /view only/);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.run('pendingChunkChanges.length'), 0); assert.equal(h.calls.length, 0);
  h.run("settingsPanels.settings(); rulesPanel.open(); unlockPreview('12342'); workerStatus({ready:true}); workerStatus({ready:false,status:'waking'})");
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
});

test('viewer chunk details and context menu expose contents and saved notes without previews or editors', async () => {
  const h = viewerHarness({realPlanning:true});
  h.run("chunkTab='contents'; showChunk('12341')");
  assert.equal(h.run("chunkStatusActions('12341').length"), 0);
  assert.ok(!h.find('button', 'Preview')); assert.ok(!h.find('button', 'Tasks')); assert.ok(!h.find('button', 'Sticker'));
  await h.click('Note ●');
  const note = h.find('textarea'); assert.equal(note.value, 'Original chunk note'); assert.equal(note.readOnly, true);
  assert.ok(!h.find('button', 'Save chunk note')); assert.equal(h.calls.length, 0);
  h.map.centerOnChunk = () => {}; h.nodes.get('map-panel').getBoundingClientRect = () => ({left:0,top:0,width:800,height:600});
  h.run("chunkMenu('12341',100,100)");
  assert.ok(h.find('button', 'Chunk details')); assert.ok(!h.find('button', 'Preview unlock'));
  assert.equal(h.calls.length, 0); assert.equal(h.planningRenders.length, 0);
});

test('viewer personal task popup retains notes and evidence with disabled ticks and no backlog, pin or note saves', async () => {
  const h = viewerHarness(); h.context.viewerTask = task;
  h.run('showTask(viewerTask)');
  const content = dialogNodes(h), controls = content.filter(node => node.type === 'checkbox');
  assert.equal(controls.length, 2); assert.ok(controls.every(node => node.disabled));
  assert.equal(content.find(node => node.tagName === 'TEXTAREA').readOnly, true);
  assert.ok(!h.find('button', 'Save note')); assert.ok(!h.find('button', 'Backlog…'));
  controls[0].checked = true; await controls[0].emit('change');
  assert.equal(h.calls.length, 0); assert.equal(h.snapshot().members[0].taskStatus[task.id].challengeCompleted, undefined);
});

test('viewer task popup displays the imported note when its saved identity is a legacy alias', () => {
  const h=viewerHarness(),alias={...task,id:'custom:legacy-note'};
  h.context.aliasTask=alias; h.context.aliasEntry={id:'custom:canonical-note',label:'Reed',memberIds:['reed'],tasksByMember:{reed:alias}};
  h.run("state.members[1].taskStatus={'custom:legacy-note':{note:'Imported Reed note'}}"); const before=h.snapshot();
  h.run("showTask(aliasTask,false,{memberId:'reed',duoEntry:aliasEntry})");
  const note=dialogNodes(h).find(node=>node.tagName==='TEXTAREA');
  assert.equal(note.value,'Imported Reed note'); assert.equal(note.readOnly,true);
  assert.ok(!h.find('button','Save note')); assert.equal(h.calls.length,0); assert.deepEqual(h.snapshot(),before);
});

test('viewer group rows remain inspectable and completion review has no saved actions for either owner', async () => {
  const h = viewerHarness(), f = duoFixture(h);
  h.run("state.members[0].taskStatus={'rs3:task:own':{challengeCompleted:true}}; state.members[1].taskStatus={'rs3:task:partner':{challengeCompleted:true}}; document.getElementById('hide-completed').checked=false");
  h.route(path => f.reed); await enableDuo(h);
  const row = h.all().find(node => node.className === 'task-row duo-task-row');
  assert.ok(row); assert.equal(row.children[0].textContent, 'Done');
  assert.ok(!row.querySelector('input'));
  const label = row.querySelector('.task-label-button'); assert.equal(label.disabled, false);
  assert.equal(row.querySelector('.duo-task-backlog').hidden, true);
  await label.emit('click'); await flush();
  assert.equal(dialogNodes(h).find(node => node.tagName === 'TEXTAREA').readOnly, true);
  await h.run('completedView.open()'); await reviewPlayer(h, 'Both');
  assert.deepEqual(completedIds(h), [f.own.id, f.partner.id].sort());
  assert.ok(!dialogNodes(h).some(node => ['completed-untick', 'completed-actions'].includes(node.className)));
  assert.ok(!h.find('button', 'Undo last change'));
});

test('viewer current selected tasks remain inspectable while peer tasks are missing, with stale views disabled', async () => {
  const h=viewerHarness(),f=duoFixture(h);
  h.route(path=>path.includes('reed')?{ok:false,status:409,value:{message:'Waiting for Reed tasks',code:'TASK_RESULTS_UNAVAILABLE'}}:f.actor1);
  await enableDuo(h); await flush(); assert.equal(h.run('duoRowsReady'),false);
  const own=h.all().find(node=>node.className==='task-row duo-task-row'&&node.dataset.taskId===f.own.id);
  assert.ok(own); assert.equal(own.querySelector('.task-label-button').disabled,false); assert.equal(own.children[0].textContent,'Not done');
  await own.querySelector('.task-label-button').emit('click'); await flush();
  assert.equal(h.nodes.get('dialog-title').textContent,f.own.label); assert.ok(h.calls.every(call=>call.body===undefined));
  h.run('result=undefined; shownResult=undefined; lastDuoResults=[actor1Result,reedResult]; state.revision=8; renderTasks()');
  const stale=h.all().find(node=>node.className==='task-row duo-task-row'&&node.dataset.taskId===f.own.id&&node.isConnected);
  assert.ok(stale); assert.equal(stale.querySelector('.task-label-button').disabled,true);
  h.run("state.revision=7; memberId='reed'; result=actor1Result; renderTasks()");
  assert.ok(h.all().filter(node=>node.className==='task-row duo-task-row'&&node.isConnected).every(node=>node.querySelector('.task-label-button').disabled));
});

test('viewer appearance and chunk IDs persist locally across player switches and live saves without commands', async () => {
  const entries = new Map(), localStorage = {getItem:key => entries.get(key) ?? null,setItem:(key,value) => entries.set(key,value)};
  const h = viewerHarness({localStorage}), before = h.snapshot();
  h.run("setViewerPreference('theme','light'); setViewerPreference('ids',true); memberId='reed'; renderState()");
  assert.equal(h.run('preferences().theme'), 'light'); assert.equal(h.run('preferences().ids'), true);
  assert.equal(h.context.document.documentElement.dataset.theme, 'light');
  const remote = structuredClone(before); remote.revision++; remote.members[1].preferences = {theme:'gray',ids:false}; h.context.remote = remote;
  h.run('adopt(remote,{},undefined,false)');
  assert.equal(h.run('preferences().theme'), 'light'); assert.equal(h.run('preferences().ids'), true);
  assert.equal(h.calls.length, 0); assert.deepEqual(before.members[0].preferences, {});
  const reload = viewerHarness({localStorage}); assert.equal(reload.run('preferences().theme'), 'light'); assert.equal(reload.run('preferences().ids'), true);
  assert.equal(reload.calls.length, 0);
  const blocked = viewerHarness({localStorage:{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}}});
  blocked.run("setViewerPreference('theme','gray')"); assert.equal(blocked.run('preferences().theme'), 'gray'); assert.equal(blocked.calls.length, 0);
});

test('viewer History and SSE adoption retain live notes without showing undo or starting calculators', async () => {
  const h = viewerHarness(), remote = h.snapshot(); remote.revision++;
  remote.members[0].notes['12341'] = 'Live edited note'; remote.history = [{revision:8,type:'set-note',at:'2026-10-12T12:00:00Z',actor:{label:'Player'}}];
  h.run("connectEvents(); showChunk('12341')"); await h.click('Note ●');
  h.route(path => { assert.equal(path,'/api/state'); return {state:remote,pools:{}}; });
  await h.eventSources[0].emit('revision', {data:JSON.stringify({revision:8})});
  assert.equal(h.snapshot().revision, 8); assert.equal(h.find('textarea').value,'Live edited note');
  h.run('renderHistory(state.history)'); assert.ok(h.find('strong','set-note')); assert.ok(!h.find('button','Undo most recent change'));
  assert.equal(h.nodes.get('save-status').textContent,'Live'); assert.deepEqual(h.calls.map(call => call.path),['/api/state']);
});

test('viewer task-ready retries unavailable saved tasks once, ignores stale events and does not wake workers', async () => {
  const h = viewerHarness(); let available = false;
  h.route(path => { if (path === '/api/health') return {worker:{ready:true}}; if (path.startsWith('/api/tasks?')) return available ? {...taskResult(7),format:'play-v1'} : {ok:false,status:409,value:{message:'Tasks unavailable until a player calculates.',code:'TASK_RESULTS_UNAVAILABLE'}}; throw new Error(path); });
  h.run('connectEvents()'); await h.run('loadTasks()'); assert.equal(h.run('result'),undefined);
  const before = h.calls.length; available = true;
  await h.eventSources[0].emit('task-ready',{data:JSON.stringify({revision:6,memberId:'actor1'})}); assert.equal(h.calls.length,before);
  await h.eventSources[0].emit('task-ready',{data:JSON.stringify({revision:7,memberId:'actor1'})}); await flush(); await h.run('foregroundTaskLoad?.promise');
  assert.equal(h.run('result.stateRevision'),7); const after=h.calls.length;
  await h.eventSources[0].emit('task-ready',{data:JSON.stringify({revision:7,memberId:'actor1'})}); assert.equal(h.calls.length,after);
  assert.ok(h.calls.every(call => call.path.startsWith('/api/tasks?') || call.path === '/api/health')); assert.equal(h.timers.size,0);
});

test('viewer display routes remain open when either player saved hidden sidebar, History and info preferences', () => {
  const h = viewerHarness();
  h.run("for (const owner of state.members) owner.preferences={info:false,recent:false,topButtons:false,chunkTasks:false,taskSidebar:false,taskSearchbar:false}; preferenceSignature=undefined; renderState()");
  for (const id of ['history-open','bis-open','activity-open','task-filter']) assert.equal(h.nodes.get(id).hidden,false,id);
  assert.equal(h.context.document.querySelector('.task-sidebar').hidden,false);
  assert.equal(h.context.document.querySelector('.workspace').dataset.sidebar,'expanded');
  h.run("showChunk('12341')"); assert.equal(h.nodes.get('chunk-info').hidden,false);
  assert.ok(!h.calls.length);
});

test('viewer appearance toolbar, chunk IDs and map selection save only local preferences', async () => {
  const entries=new Map(),localStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  const h=viewerHarness({localStorage}); h.context.document.addEventListener=()=>{}; h.context.document.querySelectorAll=()=>[];
  const observedBars = [];
  h.context.ResizeObserver=class {observe(node){observedBars.push(node);}}; h.map.setOverlay=()=>{};
  h.run('bindControls()');
  assert.ok(observedBars.includes(h.context.document.querySelector('.topbar')));
  assert.ok(observedBars.includes(h.nodes.get('update-banner')), 'startup observes the update banner as well as the topbar');
  await h.nodes.get('theme-switch').emit('click',{target:{closest:()=>({dataset:{themeChoice:'gray'}})}});
  h.run("setViewerPreference('ids',true)");
  h.nodes.get('member').value='reed'; await h.nodes.get('member').emit('change');
  assert.equal(h.run('memberId'),'reed'); assert.equal(entries.get('duo-member'),'reed');
  assert.deepEqual(JSON.parse(entries.get('picker.viewer-preferences')),{theme:'gray',ids:true});
  assert.equal(h.run('preferences().theme'),'gray'); assert.equal(h.run('preferences().ids'),true);
  assert.equal(h.calls.length,0); assert.equal(h.snapshot().revision,7);
});

test('account shares top-menu exclusivity, outside dismissal and Escape focus return', async () => {
  const h = viewerHarness(), listeners = {};
  h.context.document.addEventListener = (type, action) => (listeners[type] ??= []).push(action);
  h.context.document.querySelectorAll = () => [];
  h.context.ResizeObserver = class { observe() {} }; h.map.setOverlay = () => {};
  const account = h.context.document.getElementById('account-tools'), summary = h.context.document.createElement('summary');
  account.append(summary);
  h.run("$('tool-dialog').open=false; bindControls()");
  h.nodes.get('more-tools').open = true; account.open = true; await account.emit('toggle');
  assert.equal(h.nodes.get('more-tools').open, false);
  let prevented = false;
  for (const action of listeners.keydown) await action({ key: 'Escape', target: summary, preventDefault() { prevented = true; } });
  assert.equal(account.open, false); assert.equal(h.context.document.activeElement, summary); assert.equal(prevented, true);
  account.open = true; h.run('closeTopMenus()'); assert.equal(account.open, false);
  account.open = true;
  for (const action of listeners.click) await action({ target: h.context.document.body });
  assert.equal(account.open, false);
});

test('Escape closes Map display while its slider is focused before closing chunk details', async () => {
  const h = viewerHarness(), listeners = [], closed = [];
  h.context.document.addEventListener = (type, action) => { if (type === 'keydown') listeners.push(action); };
  h.context.document.querySelectorAll = () => [];
  h.context.ResizeObserver = class { observe() {} }; h.map.setOverlay = () => {};
  h.context.mapDisplay = { sizes: {}, isOpen: () => true, close: () => closed.push('display') };
  h.run("$('tool-dialog').open=false; $('chunk-info').hidden=false");
  h.run('bindControls()');
  let prevented = false;
  for (const action of listeners) await action({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault() { prevented = true; } });
  assert.deepEqual(closed, ['display']); assert.equal(prevented, true); assert.equal(h.nodes.get('chunk-info').hidden, false);
});

test('viewer task-ready recovers a missing partner list and ignores duplicate peer events', async () => {
  const h=viewerHarness(),f=duoFixture(h); let available=false;
  h.route(path=>{if(path.includes('reed')) return available?f.reed:{ok:false,status:409,value:{message:'Waiting for saved Reed tasks',code:'TASK_RESULTS_UNAVAILABLE'}}; return f.actor1;});
  h.run('connectEvents()'); await enableDuo(h); await flush();
  assert.equal(h.run('duoLoadError'),'waiting'); available=true;
  await h.eventSources[0].emit('task-ready',{data:JSON.stringify({revision:7,memberId:'reed'})}); await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('duoRowsReady'),true); assert.equal(h.run('duoLoadError'),undefined);
  assert.deepEqual(activeLabels(h).sort(),['Player goal','Reed goal','Shared goal']); const calls=h.calls.length;
  await h.eventSources[0].emit('task-ready',{data:JSON.stringify({revision:7,memberId:'reed'})}); assert.equal(h.calls.length,calls);
});

function duoFixture(h) {
  const make = (id, label) => ({ id: `rs3:task:${id}`, label, category: 'Mining', status: 'available', obligation: true });
  const own = make('own', 'Player goal'), shared = make('shared', 'Shared goal'), partner = make('partner', 'Reed goal'), suppressed = make('suppressed', 'Unpresented goal'), resource = { ...make('resource', 'Partner resource'), obligation: false };
  const resultFor = (memberId, tasks, revision = 7) => ({ ...taskResult(revision), memberId, format: 'play-v1', tasks,
    presentation: { tasks: tasks.filter(row => row !== suppressed).map(({ id }) => ({ id })) } });
  const actor1 = resultFor('actor1', [own, shared, suppressed, resource]), reed = resultFor('reed', [shared, partner, resource]);
  h.context.actor1Result = actor1; h.context.reedResult = reed;
  h.run('state.tasks = []; result = actor1Result; document.getElementById("hide-completed").checked = true; renderTasks()');
  return { own, shared, partner, actor1, reed, resultFor };
}
const activeLabels = h => {
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  return walk(h.nodes.get('active-tasks')).filter(node => node.className === 'task-label-button').map(node => node.textContent);
};

test('Group inspection chips fetch both catalogues on demand once and retain personal mode', async () => {
  const h = harness(), f = duoFixture(h);
  const blocked = { ...f.own, id: 'rs3:task:blocked', label: 'Blocked goal', status: 'blocked', blockers: [{ detail: 'Needs Mining 40' }] };
  const thin = value => ({ ...value, projection: 'duo-sidebar-v1', tasks: value.tasks.filter(task => value.presentation.tasks.some(row => row.id === task.id)) });
  const actor1 = { ...f.actor1, tasks: [...f.actor1.tasks, blocked], projection: 'duo-inspection-v1' };
  const reed = { ...f.reed, tasks: [...f.reed.tasks, { ...blocked, blockers: [{ detail: 'Needs a pickaxe' }] }], projection: 'duo-inspection-v1' };
  h.context.thinPlayer = thin(f.actor1);
  h.run('result = thinPlayer');
  h.route(path => h.calls.at(-1).requestPath.includes('projection=duo-inspection-v1') ? path.includes('memberId=reed') ? reed : actor1 : path.includes('memberId=reed') ? thin(f.reed) : f.actor1);
  await enableDuo(h);
  assert.equal(h.calls.filter(call => call.requestPath.includes('duo-inspection-v1')).length, 0);
  h.run("document.getElementById('show-all').checked = true; renderTasks()"); await h.run('duoInspectionLoading.promise'); await flush();
  assert.ok(activeLabels(h).includes('Unpresented goal')); assert.ok(!activeLabels(h).includes('Blocked goal'));
  assert.equal(h.calls.filter(call => call.requestPath.includes('duo-inspection-v1')).length, 2);
  h.run("document.getElementById('show-all').checked = false; document.getElementById('show-blocked').checked = true; renderTasks()");
  assert.ok(activeLabels(h).includes('Blocked goal'));
  assert.equal(h.nodes.get('show-all').disabled, true); assert.match(h.nodes.get('show-all').title, /Show blocked already includes/);
  assert.ok(h.all().some(node => node.textContent === 'Player: Needs Mining 40'));
  assert.ok(h.all().some(node => node.textContent === 'Reed: Needs a pickaxe'));
  await h.click('Reed'); assert.ok(h.all().some(node => node.textContent === 'Reed: Needs a pickaxe'));
  assert.ok(!h.all().some(node => node.textContent === 'Player: Needs Mining 40'));
  h.run("document.getElementById('task-filter').value = 'blocked'; renderTasks()"); assert.deepEqual(activeLabels(h), ['Blocked goal']);
  assert.match(h.nodes.get('task-count').textContent, /^Duo tasks 1 /);
  h.run("document.getElementById('show-blocked').checked = false; document.getElementById('task-filter').value = ''; renderTasks()");
  assert.equal(h.nodes.get('show-all').disabled, false);
  await h.click('All');
  const secondary = h.all().find(node => node.id === 'duo-personal-filter'); secondary.value = 'not-done'; await secondary.emit('change'); await flush();
  assert.equal(h.nodes.get('show-blocked').disabled, true); assert.match(h.nodes.get('show-blocked').title, /can do now/);
  assert.equal(h.calls.filter(call => call.requestPath.includes('duo-inspection-v1')).length, 2);
  h.run("document.getElementById('group-view').checked = false; renderTasks()"); await flush();
  assert.equal(h.nodes.get('show-blocked').disabled, false); assert.equal(h.nodes.get('show-all').disabled, false);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal']);
});

test('Group never displays expanded thin rows while inspection is pending or after its revision expires', async () => {
  const h = harness(), f = duoFixture(h), pending = deferred();
  h.context.thinPlayer = { ...f.actor1, projection: 'duo-sidebar-v1' };
  h.run('result = thinPlayer');
  h.route(() => h.calls.at(-1).requestPath.includes('duo-inspection-v1') ? pending.promise : { ...f.reed, projection: 'duo-sidebar-v1' });
  await enableDuo(h);
  h.run("document.getElementById('show-all').checked = true; renderTasks()"); await flush();
  assert.ok(!activeLabels(h).includes('Unpresented goal'));
  assert.equal(h.run('duoRowsReady'), false);
  const loading = h.run('duoInspectionLoading.promise');
  h.run('state.revision = 8; duoInspectionResults().results()');
  pending.resolve({ ...f.actor1, projection: 'duo-inspection-v1' }); await loading; await flush();
  assert.equal(h.run('duoInspectionResults().results().size'), 0);
});

test('inspection resumes after a Sandbox round trip discards an in-flight pair', async () => {
  const h = harness(), f = duoFixture(h), pending = deferred(); let inspections = 0;
  h.context.thinPlayer = { ...f.actor1, projection: 'duo-sidebar-v1' }; h.run('result = thinPlayer');
  h.route(path => h.calls.at(-1).requestPath.includes('duo-inspection-v1')
    ? ++inspections <= 2 ? pending.promise : { ...(path.includes('reed') ? f.reed : f.actor1), projection: 'duo-inspection-v1' }
    : { ...f.reed, projection: 'duo-sidebar-v1' });
  await enableDuo(h);
  h.run("document.getElementById('show-all').checked = true; renderTasks()"); await flush();
  const old = h.run('duoInspectionLoading.promise');
  h.run("const savedSandbox = sandbox; sandbox = { active: true, signature: () => 'draft' }; duoInspectionResults().results(); sandbox = savedSandbox; renderTasks()");
  pending.resolve({ ...f.actor1, projection: 'duo-inspection-v1' }); await old; await flush();
  await h.run('duoInspectionLoading?.promise'); await flush();
  assert.equal(inspections, 4); assert.equal(h.run('duoRowsReady'), true);
  assert.ok(activeLabels(h).includes('Unpresented goal'));
});

test('viewer task-ready recovers unavailable inspection even after that member notification was seen', async () => {
  const h = viewerHarness(), f = duoFixture(h); let available = false;
  h.context.thinPlayer = { ...f.actor1, projection: 'duo-sidebar-v1' }; h.run('result = thinPlayer');
  h.route(path => h.calls.at(-1).requestPath.includes('duo-inspection-v1')
    ? available ? { ...(path.includes('reed') ? f.reed : f.actor1), projection: 'duo-inspection-v1' }
      : { ok: false, status: 409, value: { code: 'TASK_RESULTS_UNAVAILABLE', message: 'Waiting for saved tasks' } }
    : { ...f.reed, projection: 'duo-sidebar-v1' });
  await enableDuo(h); h.run('connectEvents()');
  const notification = { data: JSON.stringify({ revision: 7, memberId: 'actor1' }) };
  await h.eventSources[0].emit('task-ready', notification);
  h.run("document.getElementById('show-all').checked = true; renderTasks()"); await flush();
  await h.run('duoInspectionLoading?.promise.catch(()=>{})'); await flush();
  assert.equal(h.run('duoInspectionError'), 'waiting');
  available = true; await h.eventSources[0].emit('task-ready', notification); await flush();
  await h.run('duoInspectionLoading?.promise'); await flush();
  assert.equal(h.run('duoRowsReady'), true); assert.equal(h.run('duoInspectionError'), undefined);
  assert.ok(activeLabels(h).includes('Unpresented goal'));
  assert.ok(!h.calls.some(call => call.path === '/api/command'));
});

test('Group view paints the selected player new tasks before a delayed partner result', async () => {
  const h = harness(), f = duoFixture(h), partner = deferred();
  h.route(async () => f.reed); await enableDuo(h);
  const next = { ...f.own, id: 'rs3:task:new-own', label: 'New Player goal' };
  h.context.updated = f.resultFor('actor1', [next], 8);
  h.route(() => partner.promise);
  h.run('state.revision = 8; result = updated; renderTasks()'); await flush();
  assert.deepEqual(activeLabels(h).sort(), ['New Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.run('duoRowsReady'), false);
  partner.resolve(f.resultFor('reed', [f.partner], 8)); await h.run('duoLoading'); await flush();
  assert.deepEqual(activeLabels(h).sort(), ['New Player goal', 'Reed goal']);
  assert.equal(h.run('duoRowsReady'), true);
});
const dialogNodes = h => {
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  return walk(h.nodes.get('dialog-content'));
};
const completedIds = h => dialogNodes(h).filter(node => node.className === 'completed-row').map(node => node.dataset.taskId).sort();
async function reviewPlayer(h, name) {
  const choice = dialogNodes(h).find(node => node.className === 'completed-player' && node.textContent === name);
  assert.ok(choice, `Missing Completed review player ${name}`); await choice.emit('click'); await flush(); await flush();
}
async function enableDuo(h) { h.run("document.getElementById('group-view').checked = true; renderTasks()"); await h.run('duoLoading'); await flush(); }

test('Group queues several optimistic checks while refreshing, without repaint flicker or premature Saved', async () => {
  const h = harness(), f = duoFixture(h);
  h.route(() => f.reed); await enableDuo(h);
  const acks = [deferred(), deferred()], refresh = deferred();
  let sent = 0;
  h.route((path) => path === '/api/command' ? acks[sent++].promise : refresh.promise);
  h.run("document.getElementById('hide-completed').checked=false; renderTasks()");
  const row = id => h.all().find(node => node.isConnected && node.className === 'task-row duo-task-row' && node.dataset.taskId === id);
  const tick = id => { const box = row(id).children[0]; assert.equal(box.disabled, false); box.checked = true; return box.emit('change'); };
  const first = tick(f.own.id); await flush();
  assert.equal(row(f.own.id).children[0].checked, true);
  assert.equal(h.run('duoRowsReady'), false);
  assert.equal(row(f.partner.id).querySelector('.duo-task-backlog').disabled, true);
  const next = h.snapshot(); next.revision = 8;
  next.members[0].taskStatus[f.own.id] = { challengeCompleted: true }; next.tasks.push(f.own);
  acks[0].resolve({ state: next, pools: {} }); await first; await flush();
  assert.equal(h.run('duoRowsReady'), false);
  const second = tick(f.partner.id); await flush();
  assert.equal(row(f.partner.id).children[0].checked, true);
  h.run('renderTasks()');
  assert.equal(row(f.partner.id).children[0].checked, true);
  assert.equal(row(f.own.id).children[0].checked, true);
  assert.equal(h.nodes.get('save-status').textContent, 'Saving…');
  assert.equal(row(f.partner.id).querySelector('.duo-task-backlog').disabled, true);
  const final = structuredClone(next); final.revision = 9;
  final.members[1].taskStatus = { [f.partner.id]: { challengeCompleted: true } }; final.tasks.push(f.partner);
  acks[1].resolve({ state: final, pools: {} }); await second; await flush();
  assert.deepEqual(h.calls.filter(call => call.body?.command).map(call => call.body.expectedRevision), [7, 8]);
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
  assert.equal(row(f.partner.id).children[0].checked, true);
  h.context.fresh = f.resultFor('actor1', [f.shared], 9);
  h.run('result=fresh; renderTasks()');
  assert.equal(row(f.partner.id).children[0].checked, true, 'fresh selected result cannot undo a partner check');
});

test('Group can untick from Completed during refresh even when a replacement result removes the task', async () => {
  const h = harness(), f = duoFixture(h);
  h.route(() => f.reed); await enableDuo(h);
  const ack = deferred(), refresh = deferred();
  h.route(path => path === '/api/command' ? ack.promise : refresh.promise);
  h.run("document.getElementById('completed-details').open=true");
  const row = () => h.all().find(node => node.isConnected && node.className === 'task-row duo-task-row' && node.dataset.taskId === f.own.id);
  const box = row().children[0]; box.checked = true; const saving = box.emit('change'); await flush();
  assert.ok(!activeLabels(h).includes(f.own.label));
  assert.equal(row().children[0].checked, true);
  const next = h.snapshot(); next.revision = 8; next.tasks.push(f.own);
  next.members[0].taskStatus[f.own.id] = { challengeCompleted: true };
  ack.resolve({ state: next, pools: {} }); await saving; await flush();
  h.context.removed = f.resultFor('actor1', [f.shared], 8);
  h.run('result=removed; renderTasks()');
  assert.equal(row().children[0].checked, true);
  assert.equal(row().children[0].disabled, false);
  const untickAck = deferred(); h.route(path => path === '/api/command' ? untickAck.promise : refresh.promise);
  const check = row().children[0]; check.checked = false; const clearing = check.emit('change'); await flush();
  assert.equal(h.run(`taskDisplayState().members[0].taskStatus[${JSON.stringify(f.own.id)}].challengeCompleted`), false);
  const cleared = structuredClone(next); cleared.revision = 9; cleared.members[0].taskStatus[f.own.id].challengeCompleted = false;
  untickAck.resolve({ state: cleared, pools: {} }); await clearing;
  assert.equal(h.snapshot().members[0].taskStatus[f.own.id].challengeCompleted, false);
  assert.deepEqual(h.calls.filter(call => call.body?.command).map(call => call.body.command.challengeCompleted), [true, false]);
});

test('Group retains previously inspected rows with current checks while detailed rows refresh', async () => {
  const h = harness(), f = duoFixture(h), refresh = deferred();
  h.route(path => path.includes('reed') ? f.reed : f.actor1); await enableDuo(h);
  h.run("document.getElementById('show-all').checked=true; renderTasks()"); await flush();
  assert.ok(activeLabels(h).includes('Unpresented goal'));
  h.route(() => refresh.promise);
  const next = h.snapshot(); next.revision = 8; next.tasks.push(f.own); next.members[0].taskStatus[f.own.id] = { challengeCompleted: true };
  h.context.next = next; h.run('adopt(next,{})'); await flush();
  assert.equal(h.run('duoRowsReady'), false);
  assert.ok(activeLabels(h).includes('Unpresented goal'));
  assert.ok(!activeLabels(h).includes(f.own.label));
  const other = h.all().find(node => node.isConnected && node.className === 'task-row duo-task-row' && node.dataset.taskId === f.partner.id);
  assert.equal(other.children[0].disabled, false);
  assert.equal(other.querySelector('.task-label-button').disabled, true);
});

test('Group checkbox focus cannot start full-detail work while rows refresh', async () => {
  const h = harness(), f = duoFixture(h), hovers = [];
  h.context.createTaskHover = options => { hovers.push(options); return { attach() {}, hide() {} }; };
  h.route(() => f.reed); await enableDuo(h);
  h.run('duoRowsReady=false');
  const requests = h.calls.length;
  assert.strictEqual(await hovers[0].getDetails(f.own), f.own);
  assert.equal(h.calls.length, requests);
  h.context.detailed = { ...f.own, record: { detail: 'Loaded' } };
  h.run('duoRowsReady=true; ensureDuoDetails=async()=>({tasks:[detailed]})');
  assert.equal((await hovers[0].getDetails(f.own)).record.detail, 'Loaded');
});

// Issue 2: keyboard focus stays on the task the player Tabbed to while saves redraw the list.
async function focusFixture(h, { count = 8, group = false, memberId = 'actor1' } = {}) {
  const pad = index => String(index).padStart(3, '0');
  const tasks = Object.fromEntries(['actor1', 'reed'].map(owner => [owner, Array.from({ length: count }, (_, i) =>
    ({ id: `rs3:task:${owner}-${pad(i + 1)}`, label: `${owner} goal ${pad(i + 1)}`, category: 'Mining', status: 'available', obligation: true }))]));
  const resultFor = (owner, revision = 7, omit = []) => {
    const rows = tasks[owner].filter(task => !omit.includes(task.id));
    return { ...taskResult(revision), memberId: owner, format: 'play-v1', tasks: rows, presentation: { tasks: rows.map(({ id }) => ({ id })) } };
  };
  h.context.focusResult = resultFor(memberId);
  h.route(path => resultFor(path.includes('memberId=reed') ? 'reed' : 'actor1'));
  h.run(`state.tasks = []; memberId = '${memberId}'; result = focusResult; renderTasks()`);
  if (group) { await enableDuo(h); assert.equal(h.run('duoRowsReady'), true); }
  return { tasks, resultFor, partner: memberId === 'actor1' ? 'reed' : 'actor1' };
}
const nodesIn = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(nodesIn)];
const focusRow = (h, id, list = 'active-tasks') => nodesIn(h.nodes.get(list)).find(node => node.dataset.taskId === id && node.dataset.focusTask);
const focusControl = (h, id, role = 'complete', list) => { const row = focusRow(h, id, list); return row && nodesIn(row).find(node => node.dataset.taskControl === role); };
const focused = h => h.context.document.activeElement;
const taskCommands = h => h.calls.filter(call => call.body?.command).map(({ body: { command } }) => [command.memberId, command.taskId, command.challengeCompleted]);
const checkedState = (h, owner, id, revision) => { const state = h.snapshot(); state.revision = revision; (state.members.find(member => member.id === owner).taskStatus ??= {})[id] = { challengeCompleted: true }; return { state, pools: {} }; };
// Answers each later save as the server would, so the final check is the stored one.
const storeCommands = h => (path, body) => {
  if (path !== '/api/command') return deferred().promise;
  const state = h.snapshot(), { memberId, taskId, challengeCompleted } = body.command; state.revision++;
  const owner = state.members.find(member => member.id === memberId); owner.taskStatus ??= {}; owner.taskStatus[taskId] = { ...owner.taskStatus[taskId], challengeCompleted };
  return { state, pools: {} };
};
// Returns the save boxed: awaiting a returned promise would wait for the save itself.
async function tickFocused(h) { const box = focused(h); box.checked = !box.checked; const saving = box.emit('change'); await flush(); return { saving }; }
async function pressSpace(h) { h.user('keydown', { key: ' ' }); await (await tickFocused(h)).saving; await flush(); }
// Row painting yields after each 8 ms slice; frames run only when the test pumps them.
function slowPaint(h) {
  const frames = []; let clock = 0;
  h.context.performance = { now: () => clock += 5, mark() {} };
  h.context.requestAnimationFrame = action => { frames.push(action); return frames.length; };
  return async () => { while (frames.length) { frames.shift()(); await flush(); } };
}
// Check A, Tab to B, then release A's acknowledgement.
async function tabDuringSave(h, a, b, ackRevision = 8, owner = h.run('memberId'), role = 'complete') {
  const ack = deferred(); h.route(path => path === '/api/command' ? ack.promise : deferred().promise);
  focusControl(h, a).focus(); const { saving } = await tickFocused(h);
  h.user('keydown', { key: 'Tab' }); const tabbed = focusControl(h, b, role); assert.equal(tabbed.disabled, false); tabbed.focus();
  ack.resolve(checkedState(h, owner, a, ackRevision)); await saving; await flush();
  return tabbed;
}

for (const group of [false, true]) for (const memberId of ['actor1', 'reed']) test(`issue 2: ${group ? 'Group' : 'personal'} view for ${memberId} keeps the Tabbed task focused through another task's save`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group, memberId });
  // In Group the Tabbed task belongs to the partner, so the next Space must keep that owner.
  const owner = group ? f.partner : memberId, a = f.tasks[memberId][0].id, b = f.tasks[owner][1].id;
  const tabbed = await tabDuringSave(h, a, b);
  const box = focused(h);
  assert.notEqual(box, tabbed, 'the acknowledgement replaced the row');
  assert.equal(box, focusControl(h, b)); assert.equal(box.isConnected, true); assert.equal(box.checked, false);
  h.route(storeCommands(h)); await pressSpace(h);
  assert.deepEqual(taskCommands(h), [[memberId, a, true], [owner, b, true]]);
  assert.equal(h.snapshot().members.find(member => member.id === owner).taskStatus[b].challengeCompleted, true);
  assert.equal(h.snapshot().members.find(member => member.id !== owner).taskStatus?.[b], undefined);
});

for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} focus follows the same task through cached and fresh redraws`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group });
  const a = f.tasks.actor1[0].id, b = f.tasks[group ? 'reed' : 'actor1'][2].id;
  await tabDuringSave(h, a, b);
  if (group) assert.equal(h.run('duoRowsReady'), false, 'the acknowledgement shows the previous rows');
  let previous = focused(h); assert.equal(previous, focusControl(h, b));
  h.route(path => path === '/api/command' ? deferred().promise : f.resultFor(path.includes('memberId=reed') ? 'reed' : 'actor1', 8));
  h.context.fresh = f.resultFor('actor1', 8); h.run('result = fresh; renderTasks()');
  assert.notEqual(focused(h), previous); assert.equal(focused(h), focusControl(h, b)); previous = focused(h);
  if (group) {
    await h.run('duoLoading?.promise'); await flush();
    assert.equal(h.run('duoRowsReady'), true, 'the partner result redraws the list again');
    assert.notEqual(focused(h), previous); assert.equal(focused(h), focusControl(h, b));
  }
  await h.run('taskRenderDone'); h.run('renderTasks()');
  assert.equal(focused(h), focusControl(h, b), 'a restored control is captured again by the next redraw');
});

for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} focus waits for a row painted after the first 8 ms slice`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group }), pump = slowPaint(h);
  h.run('renderTasks()'); await pump();
  const a = f.tasks.actor1[0].id, b = f.tasks[group ? 'reed' : 'actor1'][6].id;
  const ack = deferred(); h.route(path => path === '/api/command' ? ack.promise : deferred().promise);
  focusControl(h, a).focus(); const { saving } = await tickFocused(h); await pump();
  h.user('keydown', { key: 'Tab' }); focusControl(h, b).focus();
  ack.resolve(checkedState(h, 'actor1', a, 8)); await saving; await flush();
  assert.equal(focusControl(h, b), undefined, 'the row is not painted yet');
  assert.equal(focused(h).isConnected, false);
  await pump();
  assert.equal(focused(h), focusControl(h, b));
});

for (const [move, act] of [
  ['a Tab to the task search', h => { h.user('keydown', { key: 'Tab' }); h.nodes.get('task-filter').focus(); }],
  ['a click on the map', h => h.user('pointerdown', { target: h.context.document.getElementById('map-hover') })],
  ['an opened dialog', h => h.run("openDialog('Elsewhere')")],
]) for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} focus is not returned after ${move} during the slice gap`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group }), pump = slowPaint(h);
  h.run('renderTasks()'); await pump();
  const a = f.tasks.actor1[0].id, b = f.tasks[group ? 'reed' : 'actor1'][6].id;
  const ack = deferred(); h.route(path => path === '/api/command' ? ack.promise : deferred().promise);
  focusControl(h, a).focus(); const { saving } = await tickFocused(h); await pump();
  h.user('keydown', { key: 'Tab' }); focusControl(h, b).focus();
  ack.resolve(checkedState(h, 'actor1', a, 8)); await saving; await flush();
  const before = focused(h); act(h); const chosen = focused(h);
  await pump();
  assert.ok(focusControl(h, b), 'the row was painted'); assert.equal(focused(h), chosen);
  if (chosen === before) assert.equal(chosen.isConnected, false, 'nothing in the list took focus');
  h.run('renderTasks()'); await pump();
  assert.notEqual(focused(h), focusControl(h, b), 'a later redraw does not revive the cancelled restore');
});

for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} keeps a focused row after Show more when the list is redrawn`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { count: 75, group });
  // Personal: the 73rd Mining task. Group sorts both players' tasks together, so Reed's third is the 78th.
  const owner = group ? 'reed' : 'actor1', a = f.tasks.actor1[0].id, b = f.tasks[owner][group ? 2 : 72].id;
  assert.equal(focusRow(h, b), undefined, 'only the first 70 rows are painted');
  const more = h.all().find(node => node.isConnected && node.tagName === 'BUTTON' && /^Show more Mining tasks/.test(node.textContent));
  await more.emit('click'); await flush(); assert.ok(focusRow(h, b));
  const tabbed = await tabDuringSave(h, a, b);
  assert.notEqual(focused(h), tabbed); assert.equal(focused(h), focusControl(h, b));
  h.route(storeCommands(h)); await pressSpace(h);
  assert.deepEqual(taskCommands(h), [['actor1', a, true], [owner, b, true]]);
  assert.equal(h.snapshot().members.find(member => member.id === owner).taskStatus[b].challengeCompleted, true);
  // B is done and hidden now; the next task is still beyond the first 70 rows.
  const later = f.tasks[owner][group ? 3 : 73].id, elsewhere = h.context.document.getElementById('map-hover');
  h.user('pointerdown', { target: elsewhere }); elsewhere.focus(); h.run('renderTasks()'); await h.run('taskRenderDone');
  assert.ok(focusRow(h, later), 'Show more stays open across redraws as view state');
  h.run(`document.getElementById('group-view').checked = ${!group}; renderTasks()`);
  h.run(`document.getElementById('group-view').checked = ${group}; renderTasks()`); await h.run('taskRenderDone');
  assert.equal(focusRow(h, later), undefined, 'switching views starts each category at its first 70 rows');
});

test('issue 2: personal focus reaches a row that new tasks pushed past the opened Show more depth', async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { count: 75 });
  const a = f.tasks.actor1[0].id, b = f.tasks.actor1[72].id, last = f.tasks.actor1[74].id;
  const more = h.all().find(node => node.isConnected && node.tagName === 'BUTTON' && /^Show more Mining tasks/.test(node.textContent));
  await more.emit('click'); await flush(); assert.ok(focusRow(h, last), 'all 75 rows are open');
  await tabDuringSave(h, a, b); assert.equal(focused(h), focusControl(h, b));
  // Five new tasks sort above B, so B is now past the 75 rows the player opened.
  const added = [...'abcde'].map(letter => ({ id: `rs3:task:actor1-000${letter}`, label: `actor1 goal 000${letter}`, category: 'Mining', status: 'available', obligation: true }));
  const grown = f.resultFor('actor1', 8); grown.tasks = [...added, ...grown.tasks]; grown.presentation = { tasks: grown.tasks.map(({ id }) => ({ id })) };
  h.context.grown = grown; h.run('result = grown; renderTasks()'); await h.run('taskRenderDone');
  assert.equal(focused(h), focusControl(h, b));
  assert.equal(focusRow(h, last), undefined, 'the list opens only as far as the focused row');
});

for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} focus never moves to another task when the target is removed`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group });
  const a = f.tasks.actor1[0].id, b = f.tasks.actor1[2].id;
  await tabDuringSave(h, a, b); assert.equal(focused(h), focusControl(h, b));
  h.context.removed = f.resultFor('actor1', 8, [b]); h.run('result = removed; renderTasks()'); await h.run('taskRenderDone');
  assert.equal(focusRow(h, b), undefined); assert.equal(focused(h).isConnected, false, 'no other task control is focused');
  h.context.restored = f.resultFor('actor1', 8); h.run('result = restored; renderTasks()'); await h.run('taskRenderDone');
  assert.ok(focusRow(h, b)); assert.equal(focused(h).isConnected, false, 'a target that left the list is not refocused later');
  assert.deepEqual(taskCommands(h), [['actor1', a, true]]);
});

for (const group of [false, true]) test(`issue 2: ${group ? 'Group' : 'personal'} focus is not restored to a filtered target or its row in another list`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group });
  h.run("document.getElementById('completed-details').open = true; document.getElementById('hide-completed').checked = true");
  const a = f.tasks.actor1[0].id, b = f.tasks.actor1[2].id;
  const ack = deferred(); h.route(path => path === '/api/command' ? ack.promise : deferred().promise);
  focusControl(h, a).focus(); const { saving } = await tickFocused(h);
  h.user('keydown', { key: 'Tab' }); focusControl(h, b).focus();
  // Another device checked B in the same save, so Hide completed filters it out.
  const next = checkedState(h, 'actor1', a, 8); next.state.members[0].taskStatus[b] = { challengeCompleted: true };
  ack.resolve(next); await saving; await flush(); await h.run('taskRenderDone');
  assert.equal(focusRow(h, b), undefined);
  assert.ok(focusControl(h, b, 'complete', 'completed-tasks'), 'the task now shows under Completed');
  assert.equal(focused(h).isConnected, false, 'neither the Completed row nor another task takes focus');
});

for (const interrupted of [false, true]) test(`issue 2: Group ${interrupted ? 'drops' : 'keeps'} a disabled target ${interrupted ? 'after a key press' : 'until a redraw enables it'}`, async () => {
  const h = harness({ documentEvents: true }), f = await focusFixture(h, { group: true });
  const a = f.tasks.actor1[0].id, b = f.tasks.reed[1].id, ack = deferred();
  h.route(path => path === '/api/command' ? ack.promise : deferred().promise);
  focusControl(h, b, 'open').focus();
  // A save that started elsewhere redraws the list while B's details button is focused.
  const saving = h.run(`command({type:'set-task-status',memberId:'actor1',taskId:${JSON.stringify(a)},challengeCompleted:true})`); await flush();
  assert.equal(focusControl(h, b, 'open').disabled, true, 'task details wait for both players’ rows');
  assert.equal(focused(h).isConnected, false, 'a disabled control is not focused or enabled');
  ack.resolve(checkedState(h, 'actor1', a, 8)); await saving; await flush();
  assert.equal(focusControl(h, b, 'open').disabled, true); assert.equal(focused(h).isConnected, false);
  if (interrupted) h.user('keydown', { key: 'ArrowDown' });
  h.route(path => path === '/api/command' ? deferred().promise : f.resultFor(path.includes('memberId=reed') ? 'reed' : 'actor1', 8));
  h.context.fresh = f.resultFor('actor1', 8); h.run('result = fresh; renderTasks()');
  await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('duoRowsReady'), true); assert.equal(focusControl(h, b, 'open').disabled, false);
  if (interrupted) assert.equal(focused(h).isConnected, false);
  else assert.equal(focused(h), focusControl(h, b, 'open'));
  assert.deepEqual(taskCommands(h), [['actor1', a, true]], 'focus never activates the control');
});

for (const group of [false, true]) test(`${group ? 'Group' : 'solo'} keeps a rapid tick then untick optimistic until both acknowledgements`, async () => {
  const h = harness(), f = duoFixture(h);
  if (group) { h.route(() => f.reed); await enableDuo(h); }
  const acks = [deferred(), deferred()]; let sends = 0;
  h.route(path => path === '/api/command' ? acks[sends++].promise : deferred().promise);
  h.run("document.getElementById('hide-completed').checked=false; renderTasks()");
  const row = () => h.all().find(node => node.isConnected && node.dataset.taskId === f.own.id && node.className.includes('task-row'));
  const firstBox = row().children[0]; firstBox.checked = true;
  const first = firstBox.emit('change'); await flush();
  assert.equal(row().children[0].checked, true);
  const secondBox = row().children[0]; assert.equal(secondBox.disabled, false); secondBox.checked = false;
  const second = secondBox.emit('change'); await flush();
  assert.equal(row().children[0].checked, false);
  const next = h.snapshot(); next.revision = 8; next.tasks.push(f.own); next.members[0].taskStatus[f.own.id] = { challengeCompleted: true };
  acks[0].resolve({ state: next, pools: {} }); await first; await flush();
  assert.equal(row().children[0].checked, false);
  assert.equal(h.nodes.get('save-status').textContent, 'Saving…');
  const final = structuredClone(next); final.revision = 9; final.members[0].taskStatus[f.own.id].challengeCompleted = false;
  acks[1].resolve({ state: final, pools: {} }); await second;
  assert.equal(row().children[0].checked, false);
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

test('an unsaved Group check rolls back on a gameplay conflict while queued checks retain their previews', async () => {
  const h = harness(), f = duoFixture(h);
  h.route(() => f.reed); await enableDuo(h);
  const ack = deferred(), later = deferred(); let sends = 0;
  h.route(path => path === '/api/command' ? (sends++ ? later.promise : ack.promise) : deferred().promise);
  const first = h.run(`command({type:'set-task-status',memberId:'actor1',taskId:${JSON.stringify(f.own.id)},challengeCompleted:true})`);
  const rejected = assert.rejects(first, /Another save arrived first/);
  const second = h.run(`command({type:'set-task-status',memberId:'reed',taskId:${JSON.stringify(f.partner.id)},challengeCompleted:true})`);
  const remote = h.snapshot(); remote.revision = 8;
  ack.resolve({ ok: false, status: 409, value: { state: remote, pools: {} } }); await rejected; await flush();
  assert.equal(h.run(`taskDisplayState().members[0].taskStatus[${JSON.stringify(f.own.id)}]?.challengeCompleted`), undefined);
  assert.equal(h.run(`taskDisplayState().members[1].taskStatus[${JSON.stringify(f.partner.id)}].challengeCompleted`), true);
  const saved = structuredClone(remote); saved.revision = 9; saved.members[1].taskStatus = { [f.partner.id]: { challengeCompleted: true } };
  later.resolve({ state: saved, pools: {} }); await second;
  assert.deepEqual(h.calls.filter(call => call.body?.command).map(call => call.body.expectedRevision), [7, 8]);
});

test('Group Backlog and Completed share the owner chips, counts and disclosure renderer; off stays personal', async () => {
  const h = harness(), f = duoFixture(h); h.context.f = f;
  h.run("state.members[0].taskStatus = { [f.own.id]: {challengeCompleted:true,backlogged:true,backlogReason:'Later'}, [f.shared.id]: {challengeCompleted:true,backlogged:true,backlogReason:'Later'} }; state.members[1].taskStatus = { [f.partner.id]: {challengeCompleted:true,backlogged:true,backlogReason:'Later'}, [f.shared.id]: {challengeCompleted:true,backlogged:true,backlogReason:'Later'} }");
  h.route(() => f.reed); await enableDuo(h);
  for (const [name, count] of [['All', 3], ['Player', 2], ['Reed', 2], ['Both', 1]]) {
    await h.click(name); await flush();
    assert.equal(h.nodes.get('completed-count').textContent, `(${count})`);
    assert.equal(h.nodes.get('backlog-count').textContent, `(${count} unique task${count === 1 ? '' : 's'})`);
  }
  h.run("$('completed-details').open=true; renderTasks()");
  await flush();
  const row = h.nodes.get('completed-tasks').querySelector('.duo-task-row');
  assert.equal(row.dataset.owners, 'actor1,reed'); assert.equal(row.querySelector('.duo-task-owner').textContent, 'Both');
  h.run("$('group-view').checked=false; reconcileForegroundMode(); result=f.actor1; taskFactsCache=undefined; renderTasks()");
  assert.equal(h.nodes.get('completed-count').textContent, '(2)'); assert.equal(h.nodes.get('backlog-count').textContent, '(2 unique tasks)');
  assert.ok(!h.nodes.get('completed-tasks').querySelector('.duo-task-row'));
});

test('Review all opens combined or named owner scope from Group view without changing the map', async () => {
  const h = harness(), f = duoFixture(h); h.route(() => f.reed); await enableDuo(h);
  const scopes = []; h.context.completedView = { open: async owner => scopes.push(owner) };
  for (const [name, expected] of [['All', 'both'], ['Reed', 'reed'], ['Both', 'both']]) {
    await h.click(name); await h.nodes.get('completed-review').emit('click', { preventDefault() {}, stopPropagation() {} });
    assert.equal(scopes.at(-1), expected); assert.equal(h.run('memberId'), 'actor1');
  }
  h.run("$('group-view').checked=false; renderTasks()");
  await h.nodes.get('completed-review').emit('click', { preventDefault() {}, stopPropagation() {} }); assert.equal(scopes.at(-1), 'actor1');
});

test('Completed review switches Player, Reed and Both independently of the group map and active filter', async () => {
  const h = harness(), f = duoFixture(h);
  h.context.completionFixture = f;
  h.run("state.members[0].taskStatus = { [completionFixture.own.id]: { challengeCompleted:true }, [completionFixture.shared.id]: { challengeCompleted:true } }; state.members[1].taskStatus = { [completionFixture.partner.id]: { challengeCompleted:true }, [completionFixture.shared.id]: { challengeCompleted:true } }");
  h.route(async path => { assert.equal(path, '/api/tasks?memberId=reed'); return f.reed; });
  await enableDuo(h); await h.click('Reed');
  await h.run('completedView.open()'); await flush();
  assert.deepEqual(completedIds(h), [f.own.id, f.shared.id].sort());
  assert.equal(h.run('duoView().filter()'), 'reed');
  await reviewPlayer(h, 'Reed'); assert.deepEqual(completedIds(h), [f.partner.id, f.shared.id].sort());
  await reviewPlayer(h, 'Both'); assert.deepEqual(completedIds(h), [f.own.id, f.partner.id, f.shared.id].sort());
  assert.equal(dialogNodes(h).filter(node => node.className === 'completed-row' && node.dataset.taskId === f.shared.id).length, 1, 'shared completion appears once');
  assert.ok(dialogNodes(h).some(node => node.attributes['aria-label'] === 'Backlog Reed goal for Player…'), 'Both backlog uses the selected map player');
  assert.ok(dialogNodes(h).some(node => node.attributes['aria-label'] === 'Untick Reed goal for Reed'), 'untick retains the saved check owner');
  await reviewPlayer(h, 'Player'); await reviewPlayer(h, 'Reed');
  assert.equal(h.calls.length, 2, 'duo loading and one reviewed partner catalogue serve later scope switches');
  assert.equal(h.run('memberId'), 'actor1'); assert.equal(h.run('duoView().filter()'), 'reed');
  assert.equal(h.nodes.get('group-view').checked, true);
});

test('Completed partner details hydrate in group view and keep Back through inspected alternatives', async () => {
  const h = harness(), f = duoFixture(h), loading = deferred();
  const alternative = { ...f.partner, id: 'rs3:task:partner-alternative', label: 'Reed alternate method', record: { Description: 'Reed alternative evidence' } };
  const full = { ...f.reed, format: undefined, tasks: [...f.reed.tasks.map(row => row.id === f.partner.id ? { ...row, record: { Description: 'Reed hydrated evidence' } } : row), alternative],
    presentation: { tasks: f.reed.tasks.map(({ id }) => ({ id })), alternatives: { [f.partner.id]: [alternative.id] } } };
  h.context.completedPartner = f.partner;
  h.run("state.members[1].taskStatus = { [completedPartner.id]: { challengeCompleted:true } }; definitionsAreFull = true");
  h.route(async path => { assert.equal(path, '/api/tasks?memberId=reed'); return f.reed; });
  await enableDuo(h); await h.run('completedView.open()'); await reviewPlayer(h, 'Reed');
  const search = dialogNodes(h).find(node => node.attributes['aria-label'] === 'Filter completed tasks');
  search.value = 'Reed goal'; await search.emit('input');
  const layout = dialogNodes(h).find(node => node.attributes['aria-label'] === 'Completed task layout');
  layout.value = 'recent'; await layout.emit('change');
  const beforeDetails = h.calls.length;
  h.route(path => { assert.equal(path, '/api/tasks?memberId=reed'); return loading.promise; });
  await h.click(f.partner.label); await flush();
  assert.equal(h.nodes.get('dialog-title').textContent, f.partner.label); assert.ok(h.find('p', 'Loading sources and details…'));
  assert.ok(h.find('button', 'Back to Completed Tasks')); assert.equal(h.calls.length, beforeDetails + 1);
  loading.resolve(full); await flush(); await flush();
  assert.ok(h.find('p', 'Reed hydrated evidence'));
  const inspect = dialogNodes(h).find(node => node.className === 'task-method-choice' && node.children.some(child => child.textContent === alternative.label));
  assert.ok(inspect); await inspect.emit('click'); await flush();
  assert.equal(h.nodes.get('dialog-title').textContent, alternative.label); assert.ok(h.find('p', 'Reed alternative evidence'));
  assert.ok(!h.find('button', 'View for Player'), 'inspected methods do not carry a different task’s duo identity');
  assert.equal(h.calls.length, beforeDetails + 1, 'the alternative reuses reviewed full evidence');
  await h.click('Back to Completed Tasks'); await flush(); await flush();
  assert.equal(h.nodes.get('dialog-title').textContent, 'Completed Tasks');
  assert.equal(dialogNodes(h).find(node => node.className === 'completed-player' && node.textContent === 'Reed').attributes['aria-pressed'], 'true');
  assert.equal(dialogNodes(h).find(node => node.attributes['aria-label'] === 'Filter completed tasks').value, 'Reed goal');
  assert.equal(dialogNodes(h).find(node => node.attributes['aria-label'] === 'Completed task layout').value, 'recent');
  assert.deepEqual(completedIds(h), [f.partner.id]); assert.equal(h.run('memberId'), 'actor1');
});

test('Completed review loads the normal personal catalogue from a thin group foreground without replacing it', async () => {
  const h = harness(), f = duoFixture(h), saved = f.actor1.tasks.find(row => row.label === 'Unpresented goal');
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared] };
  h.context.thinCompleted = thin; h.context.ownCompleted = f.own; h.context.savedCompleted = saved;
  h.run("state.members[0].taskStatus = { [ownCompleted.id]: { challengeCompleted:true }, [savedCompleted.id]: { challengeCompleted:true } }; result = shownResult = undefined; document.getElementById('group-view').checked = true");
  h.route(path => path.includes('reed') ? f.reed : thin);
  await h.run('loadTasks()'); await flush();
  assert.equal(h.run('result'), thin); assert.equal(h.run('normalPlayResults.has("actor1")'), false);
  const active = activeLabels(h), before = h.calls.length;
  h.route(async path => { assert.equal(path, '/api/tasks?memberId=actor1'); return f.actor1; });
  await h.run('completedView.open()'); await flush();
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1', 'Completed asks for every personal obligation, without the thin group projection');
  assert.deepEqual(completedIds(h), [f.own.id, saved.id].sort());
  const progress = dialogNodes(h).find(node => node.tagName === 'PROGRESS'); assert.equal(progress.value, 2); assert.equal(progress.max, 3);
  assert.equal(h.run('result'), thin); assert.deepEqual(activeLabels(h), active); assert.equal(h.run('fullResult'), undefined);
  await reviewPlayer(h, 'Player'); assert.equal(h.calls.length, before + 1, 'the selected scope reuses the normal review catalogue');
});

test('duo integration loads only the partner lazily and preserves the personal active list when disabled', async () => {
  const h = harness(), fixture = duoFixture(h), before = activeLabels(h);
  assert.deepEqual(before.sort(), ['Player goal', 'Shared goal']); assert.equal(h.calls.length, 0);
  h.route(async path => { assert.equal(path, '/api/tasks?memberId=reed'); return fixture.reed; });
  await enableDuo(h);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=7');
  assert.equal(h.nodes.get('task-count').textContent, 'Duo tasks 3 · Player 2 · Reed 2 · shared 1');
  for (const label of ['Player', 'Reed', 'Both']) assert.ok(h.all().some(node => node.className === 'duo-task-owner' && node.textContent === label));
  await h.click('Both'); assert.deepEqual(activeLabels(h), ['Shared goal']);
  await h.click('Reed'); assert.deepEqual(activeLabels(h).sort(), ['Reed goal', 'Shared goal']);
  await h.click('All');
  h.run("document.getElementById('group-view').checked = false; renderTasks()");
  assert.deepEqual(activeLabels(h).sort(), before); assert.equal(h.nodes.get('task-count').textContent, '2');
  await enableDuo(h); h.run("memberId = 'reed'; result = reedResult; renderTasks()");
  h.run("memberId = 'actor1'; result = actor1Result; renderTasks()");
  assert.equal(h.calls.length, 1, 'toggle and member changes reuse this saved revision');
});

test('duo integration waits for the selected foreground result before asking for a partner', async () => {
  const h = harness(), fixture = duoFixture(h); h.run('result = undefined; shownResult = undefined');
  h.route(async () => fixture.reed);
  await enableDuo(h); assert.equal(h.calls.length, 0);
  h.run('result = actor1Result; renderTasks()'); await h.run('duoLoading'); await flush();
  assert.equal(h.calls.length, 1);
});

for (const loader of ['loadTasks', 'ensureResult']) test(`${loader} admits a partner after starting foreground and before it resolves`, async () => {
  const h = harness(), fixture = duoFixture(h), foreground = deferred(), partner = deferred();
  h.run("result = undefined; shownResult = undefined; document.getElementById('group-view').checked = true");
  h.context.__rs3Perf = { enabled: true, events: [] };
  h.context.performance = { now: () => 0, mark() {} };
  const cache = h.run('duoResults()'), ensure = cache.ensure; let peerEnsures = 0;
  cache.ensure = options => { peerEnsures++; if (peerEnsures > 3) throw new Error('Repeated empty peer admission'); return ensure(options); };
  h.route(path => path === '/api/tasks?memberId=actor1' ? foreground.promise : partner.promise);
  const loading = h.run(`${loader}()`); await flush();
  assert.deepEqual(h.calls.map(call => call.requestPath), ['/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=7', '/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=7']);
  assert.equal(h.run('result'), undefined); assert.equal(h.run('duoResults().results().size'), 0);
  partner.resolve(fixture.reed); await h.run('duoLoading.promise'); await flush();
  assert.equal(h.run('duoResults().results().has("reed")'), true);
  assert.equal(h.run('duoLoading'), undefined, 'finished peer loading stays cleared while foreground is pending');
  h.run('renderTasks(); renderTasks()'); await flush();
  assert.equal(peerEnsures, 1, 'cached partners do not start empty ensure/finally/render loops');
  assert.equal(h.context.__rs3Perf.events.some(event => event.name === 'duo-tasks-shown'), false);
  assert.equal(h.calls.length, 2, 'rerenders do not duplicate either calculation');
  foreground.resolve(fixture.actor1); await loading; await flush();
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.calls.length, 2);
  assert.equal(h.context.__rs3Perf.events.some(event => event.name === 'duo-tasks-shown'), true, 'selected publication completes the actual duo paint');
});

test('a group toggle admits the partner while the selected foreground request is pending', async () => {
  const h = harness(), fixture = duoFixture(h), foreground = deferred();
  h.run('result = undefined; shownResult = undefined');
  h.route(path => path === '/api/tasks?memberId=actor1' ? foreground.promise : fixture.reed);
  const loading = h.run('loadTasks()'); await flush(); assert.equal(h.calls.length, 1);
  await enableDuo(h); await flush(); assert.equal(h.calls.length, 2);
  foreground.resolve(fixture.actor1); await loading; await flush(); assert.equal(h.calls.length, 2);
});

for (const loader of ['loadTasks', 'ensureResult']) test(`${loader} keeps normal group-off loading on its single foreground path`, async () => {
  const h = harness(), response = deferred(); h.route(() => response.promise);
  const loading = h.run(`${loader}()`); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.run('duoResultCache'), undefined);
  response.resolve(taskResult(7)); await loading; assert.equal(h.calls.length, 1);
});

for (const transition of ['group-off', 'revision', 'sandbox']) test(`early partner admission discards late errors after ${transition}`, async () => {
  const h = harness(), fixture = duoFixture(h), foreground = deferred(), partner = deferred();
  h.run("result = undefined; shownResult = undefined; document.getElementById('group-view').checked = true");
  h.route(path => path === '/api/tasks?memberId=actor1' ? foreground.promise : partner.promise);
  const loading = h.run('loadTasks()'); await flush(); const peerLoading = h.run('duoLoading.promise');
  foreground.resolve(fixture.actor1); await loading;
  if (transition === 'group-off') h.run("document.getElementById('group-view').checked = false; renderTasks()");
  if (transition === 'revision') h.run('state.revision = 8; result = undefined; renderTasks()');
  if (transition === 'sandbox') h.run("Object.defineProperty(sandbox, 'active', { get: () => true }); renderTasks()");
  partner.reject(new Error('Old partner connection failed')); await peerLoading; await flush();
  assert.equal(h.run('duoResults().results().has("reed")'), false); assert.equal(h.run('duoLoadError'), undefined);
  assert.ok(!activeLabels(h).includes('Reed goal'));
});

test('failed partner loading does not preserve an error after switching to a ready foreground member', async () => {
  const h = harness(), fixture = duoFixture(h);
  h.route(async () => { throw new Error('Partner temporarily unavailable'); });
  h.run("document.getElementById('group-view').checked = true; renderTasks()");
  await h.run('duoLoading?.promise').catch(() => {}); await flush();
  assert.equal(h.run('duoLoadError'), 'Could not reach the picker. Check your internet connection, then try again.');
  assert.ok(h.find('button', 'Retry duo tasks'));
  h.run("memberId = 'reed'; result = reedResult; renderTasks()"); await flush();
  assert.equal(h.run('duoLoadError'), undefined);
  assert.equal(h.find('button', 'Retry duo tasks'), undefined);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.calls.length, 1, 'the switched foreground result completes the cached pair');
});

test('partner popup loads its own full evidence and keeps note commands bound to Reed', async () => {
  const h = harness(), fixture = duoFixture(h); h.route(async () => fixture.reed); await enableDuo(h);
  const method = { id: 'rs3:task:reed-method', label: 'Reed source method', category: 'Mining', status: 'available', record: {} };
  const full = { ...fixture.reed, format: undefined, tasks: [...fixture.reed.tasks.map(row => row.id === fixture.partner.id ? { ...row, record: { Description: 'Reed full task evidence' }, explanation: 'Reed personal requirements', sources: [{ kind: 'spawn', name: 'Reed rock', location: '12342', taskId: method.id }] } : row), method] };
  h.run("state.members[1].taskStatus = { 'rs3:task:partner': { note: 'Reed task note' }, 'rs3:task:reed-method': { note: 'Reed method note' } }; definitionsAreFull = true");
  h.context.fullPartnerResult = full;
  h.context.evidenceOwner = undefined;
  h.run('const originalSourceView = sourceView; sourceView = (sources, sourceResult) => { evidenceOwner = sourceResult?.memberId; return originalSourceView(sources, sourceResult); }');
  h.route(async (path, body) => {
    if (path === '/api/tasks?memberId=reed') return full;
    assert.equal(path, '/api/command'); const next = h.snapshot(); next.revision++; return { state: next, pools: {} };
  });
  await h.click('Reed goal'); await flush(); await h.run('duoDetailRequests.get("7:reed")'); await flush();
  assert.ok(h.find('p', 'Reed full task evidence')); assert.ok(h.find('p', 'Reed personal requirements'));
  assert.equal(h.context.evidenceOwner, 'reed', 'sources use the obligation owner’s calculation');
  assert.ok(h.find('label', 'Counts for our chunk challenge · Reed') || h.all().some(node => node.textContent === 'Counts for our chunk challenge · Reed'));
  assert.ok(h.all().some(node => node.tagName === 'TEXTAREA' && node.value === 'Reed task note'));
  await h.click('View source method: Reed source method'); await flush();
  assert.equal(h.nodes.get('dialog-title').textContent, 'Reed source method');
  const note = h.all().find(node => node.tagName === 'TEXTAREA' && node.value === 'Reed method note'); assert.ok(note); note.value = 'Reviewed Reed note';
  await h.click('Save note');
  const saved = h.calls.find(call => call.body?.command.note === 'Reviewed Reed note'); assert.equal(saved.body.command.memberId, 'reed');
  assert.equal(saved.body.command.taskId, method.id);
  assert.equal(h.run('memberId'), 'actor1'); assert.equal(h.calls.filter(call => call.path === '/api/tasks?memberId=actor1').length, 0);
});

for (const transition of ['group-off', 'revision']) test(`late partner calculation is discarded after ${transition}`, async () => {
  const h = harness(), fixture = duoFixture(h), response = deferred(); h.route(() => response.promise);
  h.run("document.getElementById('group-view').checked = true; renderTasks()"); await flush();
  const loading = h.run('duoLoading'); assert.equal(h.calls.length, 1);
  if (transition === 'group-off') h.run("document.getElementById('group-view').checked = false; renderTasks()");
  else h.run('state.revision = 8; result = undefined; renderTasks()');
  response.resolve(fixture.reed); await loading; await flush();
  assert.equal(h.run('duoResults().results().has("reed")'), false);
  assert.ok(!activeLabels(h).includes('Reed goal'));
});

test('personal random-start count includes partner-owned chunks', () => {
  const h = harness(), doc = h.snapshot();
  doc.members[0].unlocked = ['12341']; doc.members[1].unlocked = ['12342']; doc.members[0].preferences.randomStartAlways = true;
  h.adopt(doc); assert.equal(h.run('rollCandidateCount()'), 1);
});

test('history identifies the trusted actor while keeping older anonymous records readable', () => {
  const h = harness(), state = h.snapshot();
  state.history = [
    { revision: 1, type: 'set-note', at: '2026-10-08T12:00:00Z', actor: { inviteId: 'reed-invite', label: 'Reed' } },
    { revision: 2, type: 'set-chunk', at: '2026-10-08T13:00:00Z', actor: { kind: 'master', label: 'Player' } },
    { revision: 3, type: 'set-preference', at: '2026-10-08T14:00:00Z' },
  ];
  h.adopt(state); h.run('renderHistory(state.history)');
  // Headline is the plain-English change (the harness stubs it as the type); attribution sits in the meta line.
  assert.ok(h.find('strong', 'set-note')); assert.ok(h.all().some(node => /^by Reed · /.test(node.textContent)));
  assert.ok(h.find('strong', 'set-chunk')); assert.ok(h.all().some(node => /^by Player · /.test(node.textContent)));
  assert.ok(h.find('strong', 'set-preference')); assert.ok(h.all().some(node => node.className === 'history-meta' && !String(node.textContent).startsWith('by ')), 'anonymous records have no "by"');
});

test('pending panel offers Pick for me and sends the current member command', async () => {
  const h = harness(), doc = h.snapshot(); doc.members[0].pendingRoll = ['12341', '12342']; h.adopt(doc);
  await h.click('Pick for me');
  const submitted = h.calls.find(call => call.body?.command?.type === 'pick-for-me');
  assert.equal(submitted.body.command.type, 'pick-for-me'); assert.equal(submitted.body.command.memberId, 'actor1');
  assert.ok(h.find('span', 'Dim partner tab: no round trip') || h.run("document.getElementById('group-view').checked") !== true);
});

test('active, completed and backlog views exclude preserved partner-only goals', () => {
  const h = harness(), doc = h.snapshot(), own = { ...task, id: 'rs3:BiS:own', label: 'Own goal', obligation: true }, partner = { ...own, id: 'rs3:BiS:partner', label: 'Partner goal', obligation: false };
  doc.tasks = [own, partner].map(({ id, label, category }) => ({ id, label, category }));
  h.run("document.getElementById('completed-details').open = true; document.getElementById('backlog-details').open = true");
  doc.members[0].taskStatus = Object.fromEntries([own, partner].map(row => [row.id, { challengeCompleted: true, backlogged: true }])); h.adopt(doc);
  h.context.scopedResult = { ...taskResult(7), tasks: [own, partner], presentation: { tasks: [own, partner], alternatives: {} } }; h.run('result = scopedResult; renderTasks()');
  assert.ok(h.find('button', 'Own goal')); assert.ok(!h.find('button', 'Partner goal'));
  assert.equal(h.nodes.get('completed-count').textContent, '(1)'); assert.equal(h.nodes.get('backlog-count').textContent, '(1 unique task)');
  h.run("delete state.members[0].taskStatus['rs3:BiS:own'].backlogged; delete state.members[0].taskStatus['rs3:BiS:partner'].backlogged; document.getElementById('hide-completed').checked = false; renderTasks()");
  assert.ok(!h.find('button', 'Partner goal')); assert.equal(h.nodes.get('task-count').textContent, '1');
});

test('task details and info sources display the raw unknown label', () => {
  const h = harness(); h.context.opaqueTask = { ...task, sources: [{ kind: 'drop', source: 'Rat', probability: null, unknownRate: true, rawRate: 'Very rare', rate: 'Very rare' }] };
  h.run('showTask(opaqueTask)');
  assert(h.find('p', 'Monster drop · Rate unknown (Very rare)'));
});

test('a partner task popup uses the reviewed player status and saves without switching the map', async () => {
  const h = harness(), state = h.snapshot();
  state.members[0].taskStatus[task.id] = { note: 'Player note', challengeCompleted: false };
  state.members[1].taskStatus = { [task.id]: { note: 'Reed note', challengeCompleted: true, favorite: true, backlogged: true, backlogReason: 'Reed backlog reason' } };
  state.members[1].completedTasks = [task.id]; h.adopt(state);
  h.context.partnerResult = { ...taskResult(7), memberId: 'reed', tasks: [task], presentation: { tasks: [task], alternatives: {} } };
  h.run("showTask(partnerResult.tasks[0], true, {memberId:'reed', result:partnerResult})");
  const checkbox = text => h.all().find(node => node.tagName === 'LABEL' && node.children.some(child => child.tagName === 'TEXT' && child.textContent === text))?.children[0];
  const done = checkbox('Counts for our chunk challenge · Reed'), personal = checkbox('Reed did this in-game personally');
  assert.equal(done.checked, true); assert.equal(personal.checked, true);
  assert.ok(h.find('p', 'Backlogged: Reed backlog reason')); assert.ok(!checkbox('Counts for our chunk challenge · Player'));
  done.checked = false; await done.emit('change');
  assert.deepEqual(h.calls.at(-1).body.command, { type: 'set-task-status', memberId: 'reed', taskId: task.id, challengeCompleted: false });
  personal.checked = false; await personal.emit('change');
  assert.deepEqual(h.calls.at(-1).body.command, { type: 'complete-task', memberId: 'reed', taskId: task.id, completed: false });
  await h.click('Restore from backlog');
  assert.deepEqual(h.calls.at(-1).body.command, { type: 'set-task-status', memberId: 'reed', taskId: task.id, backlogged: false });
  h.run("showTask(partnerResult.tasks[0], true, {memberId:'reed', result:partnerResult})"); await h.click('Backlog…');
  const reason = h.all().find(node => node.attributes['aria-label'] === 'Why backlog Test task?'); reason.value = 'Partner-specific reason';
  const form = h.all().find(node => node.className === 'backlog-form'); await form.emit('submit', { preventDefault() {} });
  assert.deepEqual(h.calls.at(-1).body.command, { type: 'set-task-status', memberId: 'reed', taskId: task.id, backlogged: true, backlogReason: 'Partner-specific reason' });
  assert.equal(h.run('memberId'), 'actor1'); assert.equal(h.snapshot().members[0].taskStatus[task.id].challengeCompleted, false);
});

test('neutral alternative access gates omit a false display level while genuine levels remain', () => {
  for (const [level, detail] of [[1, 'Combat · available'], [60, 'Combat · Level 60 · available']]) {
    const h = harness();
    h.context.accessTask = { ...task, category: 'Combat', level, record: { RequirementAlternatives: [{ TotalLevelNeeded: 1000 }], Description: 'Combat 60 or total level 1,000.' } };
    h.run('showTask(accessTask)');
    assert.ok(h.find('p', detail));
    assert.ok(h.find('p', 'Combat 60 or total level 1,000.'));
  }
});

test('worker status line keeps recovery visible with cached tasks and retries when ready', async () => {
  const h = harness();
  h.run("workerStatus({ ready: false, status: 'restarting', restartRequired: false })");
  assert.match(h.nodes.get('task-engine-status').textContent, /recovering.*Saves remain available/);
  h.run("workerStatus({ ready: false, status: 'restart-required', restartRequired: true })");
  assert.match(h.nodes.get('task-engine-status').textContent, /server restart.*Saves remain available/);
  h.route(async () => taskResult(7));
  await h.run('loadTasks()');
  assert.match(h.nodes.get('task-engine-status').textContent, /server restart.*Saves remain available/);
  const display = h.snapshot(); display.revision++;
  h.context.display = display;
  h.run('adopt(display, {}, result)');
  assert.match(h.nodes.get('task-engine-status').textContent, /server restart.*Saves remain available/);
  h.run('workerStatus({ ready: true })');
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 1);
});

test('sleeping task calculator retains the list and waking shows a normal loading message', () => {
  const h = harness();
  h.run("$('task-engine-status').textContent = 'Your tasks are ready'");
  h.run("workerStatus({ ready: false, status: 'sleeping' })");
  assert.equal(h.nodes.get('task-engine-status').textContent, 'Your tasks are ready');
  assert.equal(h.timers.size, 0);
  h.run("workerStatus({ ready: false, status: 'waking' })");
  assert.equal(h.nodes.get('task-engine-status').textContent, 'Waking up the task calculator…');
});

test('revision events avoid fetching our pending save and still synchronize remote changes after a failed save', async () => {
  const h = harness(), acknowledgement = deferred(), failure = deferred();
  const baselineTasks = h.run('state.tasks');
  let submitted = 0;
  h.route(path => {
    if (path === '/api/command') return ++submitted === 1 ? acknowledgement.promise : failure.promise;
    if (path.startsWith('/api/tasks?')) return taskResult(h.run('pendingGameplayAttempt.revision'));
    assert.equal(path, '/api/state');
    const state = h.snapshot(); state.revision = 9;
    state.members[1].notes['12342'] = 'Remote update after failure';
    return { state, pools: {} };
  });
  h.run('connectEvents()');
  const events = h.eventSources[0];
  assert.equal(events.url, '/api/events');
  const saving = h.run("command({ type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'Saved locally' })");
  await flush();
  const ownNotification = events.emit('revision', { data: JSON.stringify({ revision: 8 }) });
  await flush();
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0, 'An early commit event must not start a full state fetch');
  const changed = h.snapshot(); changed.revision = 8; changed.members[0].notes['12341'] = 'Saved locally'; delete changed.tasks;
  acknowledgement.resolve({ state: changed, pools: {}, baseRevision: 7, unchangedFields: ['tasks'] });
  await saving; await ownNotification;
  assert.deepEqual(h.calls.filter(call => !call.path.startsWith('/api/tasks?')).map(call => call.path), ['/api/command']);
  assert.equal(h.run('state.revision'), 8);
  assert.equal(h.run('state.tasks'), baselineTasks, 'The command acknowledgement must merge its captured static baseline');
  assert.equal(h.snapshot().members[0].notes['12341'], 'Saved locally');

  const rejected = assert.rejects(h.run("command({ type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'Will fail' })"), /Injected save failure/);
  await flush();
  const remoteNotification = events.emit('revision', { data: JSON.stringify({ revision: 9 }) });
  await flush();
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0, 'Remote synchronization must wait for the in-flight save');
  failure.resolve({ ok: false, status: 422, value: { message: 'Injected save failure' } });
  await rejected; await remoteNotification;
  assert.deepEqual(h.calls.filter(call => !call.path.startsWith('/api/tasks?')).map(call => call.path), ['/api/command', '/api/command', '/api/state']);
  assert.equal(h.run('state.revision'), 9);
  assert.equal(h.snapshot().members[1].notes['12342'], 'Remote update after failure');
});

test('claim saves reuse both current duo lists and personal cached results', async () => {
  const h = harness();
  h.context.compact = taskResult(7);
  h.route(async (path, body) => {
    assert.equal(path, '/api/command');
    const state = h.snapshot(); state.revision++;
    state.taskClaims = { [body.command.taskId]: { memberId: body.command.memberId, at: '2026-10-11T12:00:00Z' } };
    return { state, pools: {} };
  });
  h.run("$('group-view').checked = true; result = { ...compact, memberId: 'actor1', stateRevision: 7 }; duoResults().remember(result); duoResults().remember({ ...compact, memberId: 'reed', stateRevision: 7 }); normalPlayResults.set('actor1', result)");
  await h.run(`command({ type: 'claim-task', memberId: 'actor1', taskId: ${JSON.stringify(task.id)} })`);
  assert.deepEqual(h.calls.map(call => call.path), ['/api/command']);
  assert.equal(h.run('result.stateRevision'), 8);
  assert.equal(h.run("duoResults().results().get('reed').stateRevision"), 8);
  assert.equal(h.run("normalPlayResults.get('actor1').stateRevision"), 8);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 100), false);
});

test('rule review notes retain current tasks without starting gameplay calculation', async () => {
  const h = harness(); h.context.compact = taskResult(7);
  h.run("result = { ...compact, memberId: 'actor1', stateRevision: 7 }; normalPlayResults.set('actor1', result)");
  h.route(async (path, body) => {
    assert.equal(path, '/api/command');
    const state = h.snapshot(); state.revision++;
    state.ruleReviews = { [body.command.ruleId]: { reviewed: body.command.reviewed, note: body.command.note } };
    return { state, pools: {} };
  });
  await h.run("command({ type: 'set-rule-review', ruleId: 'roll.adjacent', reviewed: true, note: 'Agreed' }, 7)");
  assert.deepEqual(h.calls.map(call => call.path), ['/api/command']);
  assert.equal(h.run('result.stateRevision'), 8);
  assert.equal(h.run("normalPlayResults.get('actor1').stateRevision"), 8);
  assert.equal(h.run('pendingGameplayAttempt'), undefined);
});

test('remote claim-only events repaint current rows without scheduling a task request', async () => {
  const h = harness();
  h.context.compact = taskResult(7);
  h.run("result = { ...compact, memberId: 'actor1', stateRevision: 7 }");
  h.route(async path => {
    assert.equal(path, '/api/state');
    const state = h.snapshot(); state.revision++;
    state.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-11T12:00:00Z' } };
    return { state, pools: {} };
  });
  h.run('connectEvents()');
  await h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8, taskResultsUnchanged: true }) });
  assert.equal(h.run('result.stateRevision'), 8);
  assert.ok(h.find('span', 'Reed is doing this'));
  assert.deepEqual(h.calls.map(call => call.path), ['/api/state']);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 100), false);
});

async function sseWriteFixture(group = true) {
  const h = harness(), f = duoFixture(h), acknowledgement = deferred(), selected = deferred(), peer = deferred();
  const selectedResult = { ...f.resultFor('actor1', [f.own], 8), ...(group ? { projection: 'duo-sidebar-v1' } : {}) };
  const peerResult = f.resultFor('reed', [f.partner], 8), next = h.snapshot(); next.revision = 8; next.members[0].unlocked = ['12341'];
  h.route(path => path === '/api/command' ? acknowledgement.promise : path.includes('reed') ? peer.promise : selected.promise);
  h.run(`document.getElementById('group-view').checked = ${group}; connectEvents()`);
  const saving = h.run("command({type:'set-chunk',memberId:'actor1',chunkId:'12341',status:'unlocked'})"); await flush();
  return { h, f, acknowledgement, selected, peer, selectedResult, peerResult, next, saving,
    notify: revision => h.eventSources[0].emit('revision', { data: JSON.stringify({ revision }) }),
    load: () => h.run('clearTimeout(syncTimer); syncTimer = null; loadTasks()') };
}

test('durable SSE starts selected and Group peer reads before delayed acknowledgement without publication or state fetching', async () => {
  const f = await sseWriteFixture(), { h } = f, notification = f.notify(8);
  await flush(); assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 2);
  assert.ok(h.calls.some(call => call.requestPath === '/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=8'));
  assert.ok(h.calls.some(call => call.requestPath === '/api/tasks?memberId=reed&view=play-v1&lane=duo-v1&peerFor=actor1&revision=8'));
  assert.equal(h.run('earlyTaskLoad.requests.size'), 2); assert.equal(h.run('state.revision'), 7); assert.equal(h.run('result.stateRevision'), 7);
  assert.equal(h.run('foregroundSettled()'), false);
  h.run("workerStatus({ready:false,status:'waking'}); workerStatus({ready:true})"); assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 0);
  f.selected.resolve(f.selectedResult); f.peer.resolve(f.peerResult); await flush(); await flush();
  assert.equal(h.run('state.revision'), 7); assert.equal(h.run('result.stateRevision'), 7); assert.equal(h.run('foregroundSettled()'), false);
  const duplicate = f.notify(8); await flush(); assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 2);
  f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await Promise.all([notification, duplicate]);
  await f.load(); await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('foregroundSettled()'), true); assert.equal(h.run('result.stateRevision'), 8);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 2, 'normal loaders reuse both parsed provisional responses');
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0); assert.equal(h.run('earlyTaskLoad'), undefined);
});

test('matching acknowledgement preserves pending selected and peer reads for handoff and keeps advisories behind settlement', async () => {
  const f = await sseWriteFixture(), { h } = f, notification = f.notify(8); await flush();
  const requests = h.calls.filter(call => call.path.startsWith('/api/tasks?'));
  f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification;
  const loading = f.load(); await flush();
  assert.ok(requests.every(call => !call.options.signal.aborted)); assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 2);
  f.selected.resolve(f.selectedResult); await flush(); await flush(); assert.equal(h.run('foregroundSettled()'), false); assert.equal(h.deathTimers.size, 0);
  f.peer.resolve(f.peerResult); await loading; await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('foregroundSettled()'), true); assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
});

test('claim-only retry replaces provisional baseline reads and retains both prepared Unlock results after acknowledgement', async () => {
  const f = await sseWriteFixture(), { h } = f, retryAck = deferred(), selected = deferred(), peer = deferred();
  const claimed = h.snapshot(); claimed.revision = 8;
  claimed.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
  const saved = structuredClone(claimed); saved.revision = 9; saved.members[0].unlocked.push('12341');
  const ownResult = { ...f.selectedResult, stateRevision: 9 }, peerResult = { ...f.peerResult, stateRevision: 9 };
  h.route((path, body) => path === '/api/command' ? body.expectedRevision === 7 ? f.acknowledgement.promise : retryAck.promise
    : h.calls.filter(call => call.path === '/api/command').length === 1 ? path.includes('reed') ? f.peer.promise : f.selected.promise
      : path.includes('reed') ? peer.promise : selected.promise);
  const firstNotification = f.notify(8); await flush();
  const oldReads = h.calls.filter(call => call.path.startsWith('/api/tasks?'));
  f.selected.resolve(f.selectedResult); f.peer.resolve(f.peerResult); await flush();
  f.acknowledgement.resolve({ ok: false, status: 409, value: { state: claimed, pools: {}, claimOnlyChanges: true } }); await flush();
  assert.deepEqual(h.calls.filter(call => call.path === '/api/command').map(call => call.body.expectedRevision), [7, 8]);
  assert.ok(oldReads.every(call => call.options.signal.aborted));
  assert.equal(h.run('state.revision'), 8); assert.equal(h.run('earlyTaskLoad'), undefined);
  const notification = f.notify(9); await flush();
  const currentReads = h.calls.filter(call => call.path.startsWith('/api/tasks?') && call.requestPath.includes('revision=9'));
  assert.equal(currentReads.length, 2);
  selected.resolve(ownResult); await flush();
  retryAck.resolve({ state: saved, pools: {} }); await f.saving; await Promise.all([firstNotification, notification]);
  const loading = f.load(); await flush();
  assert.ok(currentReads.every(call => !call.options.signal.aborted));
  peer.resolve(peerResult); await loading; await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('state.revision'), 9); assert.equal(h.run('result.stateRevision'), 9);
  assert.equal(h.run('foregroundSettled()'), true); assert.equal(h.run('earlyTaskLoad'), undefined);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 4, 'the retried Unlock hands off both prepared reads without fallback');
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
});

test('changed member, mode or newer SSE discards provisional reads while acknowledgement publication stays exact', async () => {
  for (const change of ["memberId = 'reed'; renderTasks()", "document.getElementById('group-view').checked = false; renderTasks()", 'newer']) {
    const f = await sseWriteFixture(), { h } = f, notification = f.notify(8); await flush();
    const requests = h.calls.filter(call => call.path.startsWith('/api/tasks?'));
    let newer; if (change === 'newer') newer = f.notify(9); else h.run(change);
    await flush(); assert.ok(requests.every(call => call.options.signal.aborted)); assert.equal(h.run('earlyTaskLoad'), undefined);
    assert.equal(h.run('foregroundSettled()'), false);
    f.selected.resolve(f.selectedResult); f.peer.resolve(f.peerResult); await flush(); assert.equal(h.run('state.revision'), 7);
    h.route(path => { if (path === '/api/state') return { state: { ...f.next, revision: 9 }, pools: {} }; return { ...f.selectedResult, projection: undefined, memberId: h.run('memberId'), stateRevision: h.run('state.revision') }; });
    f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification; if (newer) await newer;
    assert.equal(h.run('state.revision'), change === 'newer' ? 9 : 8);
    assert.ok(h.run('result?.stateRevision') !== 8 || h.run('result?.projection') !== 'duo-sidebar-v1');
  }
});

test('provisional revision mismatch and network failures fall back to ordinary tasks after matching acknowledgement', async () => {
  for (const fail of ['wrong-revision', 'network', 'conflict-state']) {
    const f = await sseWriteFixture(false), { h } = f;
    const newer = { ...f.next, revision: 9 };
    h.route(path => path === '/api/command' ? f.acknowledgement.promise : fail === 'network' ? Promise.reject(new Error('Network failed'))
      : fail === 'conflict-state' ? { ok: false, status: 409, value: { state: newer, pools: {} } } : { ...f.selectedResult, stateRevision: 9 });
    const notification = f.notify(8); await flush(); await flush(); assert.equal(h.run('state.revision'), 7);
    h.route(() => ({ ...f.selectedResult, projection: undefined }));
    f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification; await f.load();
    assert.equal(h.run('state.revision'), 8); assert.equal(h.run('result.stateRevision'), 8);
    assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 2, 'one failed provisional read and one normal fallback');
    assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
  }
});

test('failed or conflicting commands clear provisional reads and preserve ordinary remote synchronization', async () => {
  for (const status of [409, 422]) {
    const f = await sseWriteFixture(false), { h } = f, rejected = assert.rejects(f.saving), notification = f.notify(8); await flush();
    const request = h.calls.find(call => call.path.startsWith('/api/tasks?'));
    h.route(path => path === '/api/state' ? { state: f.next, pools: {} } : f.selectedResult);
    f.acknowledgement.resolve({ ok: false, status, value: { message: 'Save failed', ...(status === 409 ? { state: f.next, pools: {} } : {}) } });
    await rejected; await notification; assert.equal(h.run('earlyTaskLoad'), undefined); assert.equal(request.options.signal.aborted, true);
    assert.equal(h.run('state.revision'), 8); assert.equal(h.calls.filter(call => call.path === '/api/state').length, status === 422 ? 1 : 0);
    f.selected.resolve(f.selectedResult); await flush(); assert.notEqual(h.run('result'), f.selectedResult);
  }
});

test('SSE task speculation requires an on-wire gameplay attempt and excludes display-only writes', async () => {
  const h = harness(), ack = deferred(); h.run('connectEvents()');
  const state = h.snapshot(); state.revision = 8;
  h.route(path => path === '/api/command' ? ack.promise : { state, pools: {} });
  const saving = h.run("command({type:'set-preference',memberId:'actor1',preferenceId:'theme',value:'dark'})"); await flush();
  const notification = h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8 }) }); await flush();
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 0);
  ack.resolve({ state, pools: {} }); await saving; await notification;
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
});

test('an older peer conflict during provisional reads cannot adopt state or restart stale peer work before acknowledgement', async () => {
  const h = harness(), f = duoFixture(h), oldPeer = deferred(), own = deferred(), peer = deferred(), ack = deferred();
  const baselineTasks = h.run('state.tasks'), next = h.snapshot(); next.revision = 8;
  const selected = { ...f.resultFor('actor1', [f.own], 8), projection: 'duo-sidebar-v1' }, partner = f.resultFor('reed', [f.partner], 8);
  h.route(path => path.includes('reed') ? oldPeer.promise : f.actor1);
  h.run("document.getElementById('group-view').checked = true; renderTasks(); connectEvents()"); await flush();
  assert.equal(h.calls.filter(call => call.requestPath.includes('revision=7')).length, 1);
  h.route(path => path === '/api/command' ? ack.promise : path.includes('reed') ? peer.promise : own.promise);
  // A gameplay save: note saves keep the list and so skip this attempt guard.
  const saving = h.run(`command({type:'set-task-status',memberId:'actor1',taskId:${JSON.stringify(f.own.id)},challengeCompleted:true})`); await flush();
  const notification = h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8 }) }); await flush();
  oldPeer.resolve({ ok: false, status: 409, value: { state: next, pools: {}, format: 'play-v1', message: 'Your saved map changed.' } }); await flush(); await flush();
  assert.equal(h.run('state.revision'), 7); assert.equal(h.run('state.tasks'), baselineTasks); assert.equal(h.run('stateIsPlayView'), false);
  assert.equal(h.calls.filter(call => call.requestPath.includes('revision=7')).length, 1, 'failed old peer is not restarted');
  assert.equal(h.run('duoLoadError'), undefined, 'the superseded peer error stays quiet while acknowledgement is pending');
  assert.equal(h.run('foregroundSettled()'), false); assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
  own.resolve(selected); peer.resolve(partner); const acknowledgement = { ...next }; delete acknowledgement.tasks;
  ack.resolve({ state: acknowledgement, pools: {}, baseRevision: 7, unchangedFields: ['tasks'] }); await saving; await notification;
  await h.run('clearTimeout(syncTimer); syncTimer = null; loadTasks()'); await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('state.tasks'), baselineTasks); assert.equal(h.run('result.stateRevision'), 8); assert.equal(h.run('foregroundSettled()'), true);
  assert.equal(h.calls.filter(call => call.path === '/api/state').length, 0);
});

test('after acknowledgement a cached Personal or member switch drops an unclaimed Group peer result', async () => {
  for (const change of ['personal', 'member']) {
    const f = await sseWriteFixture(), { h } = f, notification = f.notify(8); await flush();
    const requests = h.calls.filter(call => call.path.startsWith('/api/tasks?'));
    f.selected.resolve(f.selectedResult); if (change === 'member') f.peer.resolve(f.peerResult);
    f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification;
    await h.run("fetchSavedTasks('actor1',8,'duo-sidebar-v1')");
    assert.equal(h.run('earlyTaskLoad.requests.get("actor1").claimed'), true);
    assert.equal(h.run('earlyTaskLoad.requests.get("reed").claimed'), false);
    const fresh = { ...f.f.resultFor(change === 'personal' ? 'actor1' : 'reed', [], 8), ...(change === 'member' ? { projection: 'duo-sidebar-v1' } : {}) };
    h.context.cachedPersonal = fresh; h.context.acceptedThin = f.selectedResult; h.route(() => fresh);
    if (change === 'personal') h.run("normalPlayResults.set('actor1',cachedPersonal); result = shownResult = acceptedThin; document.getElementById('group-view').checked = false; renderTasks()");
    else h.run("memberId = 'reed'; result = shownResult = undefined; renderTasks()");
    assert.equal(h.run('earlyTaskLoad'), undefined); assert.ok(requests.every(call => call.options.signal.aborted));
    const current = await h.run(change === 'personal' ? "fetchSavedTasks('actor1',8)" : "fetchSavedTasks('reed',8,'duo-sidebar-v1')");
    assert.equal(current, fresh); assert.notEqual(current, f.peerResult);
    if (change === 'personal') f.peer.resolve(f.peerResult); await flush();
    assert.equal(h.run('state.revision'), 8); assert.notEqual(h.run('result'), f.peerResult);
  }
});

test('a newer remote SSE without a pending write aborts an unclaimed acknowledged pair before state synchronization', async () => {
  const f = await sseWriteFixture(), { h } = f, notification = f.notify(8), remote = deferred(); await flush();
  const requests = h.calls.filter(call => call.path.startsWith('/api/tasks?'));
  f.selected.resolve(f.selectedResult); f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification;
  await h.run("fetchSavedTasks('actor1',8,'duo-sidebar-v1')"); assert.equal(h.run('pendingGameplayAttempt'), undefined);
  h.route(() => remote.promise); const newer = f.notify(9);
  assert.equal(h.run('earlyTaskLoad'), undefined); assert.ok(requests.every(call => call.options.signal.aborted));
  f.peer.resolve(f.peerResult); await flush(); assert.equal(h.run('state.revision'), 8); assert.notEqual(h.run('result'), f.peerResult);
  remote.resolve({ state: { ...f.next, revision: 9 }, pools: {} }); await newer;
  assert.equal(h.run('state.revision'), 9); assert.equal(h.calls.filter(call => call.path === '/api/state').length, 1);
});

test('a newer SSE invalidates a fulfilled handoff before its continuation can return the older saved tasks', async () => {
  const f = await sseWriteFixture(), { h } = f, notification = f.notify(8), remote = deferred(); await flush();
  f.selected.resolve(f.selectedResult); f.peer.resolve(f.peerResult); await flush(); await flush();
  f.acknowledgement.resolve({ state: f.next, pools: {} }); await f.saving; await notification;
  const handed = h.run("fetchSavedTasks('actor1',8,'duo-sidebar-v1')"), rejected = assert.rejects(handed, { name: 'AbortError' });
  h.route(() => remote.promise); const newer = f.notify(9);
  assert.equal(h.run('state.revision'), 8); assert.equal(h.run('earlyTaskLoad'), undefined);
  await rejected; assert.notEqual(h.run('result'), f.selectedResult);
  remote.resolve({ state: { ...f.next, revision: 9 }, pools: {} }); await newer; assert.equal(h.run('state.revision'), 9);
});

function harness({ realPlanning = false, localStorage, documentEvents = false } = {}) {
  class Node {
    constructor(tag = 'div', text = '') { Object.assign(this, { tagName: tag.toUpperCase(), textContent: text, children: [], events: {}, attributes: {}, dataset: {}, value: '', style: { setProperty() {} } }); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') { node.remove?.(); node.parent = this; } this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) if (typeof node === 'object') node.parent = undefined; this.children = []; this.append(...nodes); }
    prepend(...nodes) { for (const node of nodes) { node.remove?.(); node.parent = this; } this.children.unshift(...nodes); }
    get firstChild() { return this.children[0] ?? null; }
    insertBefore(node, before) { node.remove?.(); node.parent = this; const index = this.children.indexOf(before); if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
    get parentElement() { return this.parent; }
    replaceWith(node) { this.after(node); this.remove(); }
    querySelectorAll(selector) { const found = []; const visit = node => { for (const child of node.children.filter(item => typeof item === 'object')) { if (selector === 'button' && child.tagName === 'BUTTON') found.push(child); visit(child); } }; visit(this); return found; }
    after(...nodes) { if (this.parent) { const parent = this.parent, index = parent.children.indexOf(this); for (const node of nodes) { node.remove?.(); node.parent = parent; } parent.children.splice(index + 1, 0, ...nodes); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    querySelector(selector) { const match = node => selector.startsWith('.') ? (node.className ?? '').split(' ').includes(selector.slice(1)) : selector.startsWith('[data-role=') ? node.dataset.role === selector.match(/"([^"]+)"/)[1] : node.tagName.toLowerCase() === selector; const walk = node => { for (const child of node.children.filter(item => typeof item === 'object')) { if (match(child)) return child; const found = walk(child); if (found) return found; } }; return walk(this); }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    emit(key, event = {}) { return Promise.all((this.events[key] ?? []).map(action => action(event))); }
    contains(node) { return this === node || this.children.some(child => typeof child === 'object' && child.contains?.(node)); }
    get isConnected() { return !!this.connected || !!this.parent?.isConnected; }
    focus() { document.activeElement = this; for (const action of documentListeners.focusin ?? []) action({ target: this }); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  // Opt-in: most fixtures predate document listeners and must not gain them.
  const documentListeners = {};
  const nodes = new Map(), timers = new Map(), deathTimers = new Map(), calls = [], intentCalls = [], deathCalls = [], renders = [], eventSources = [], planningPrimes = [], planningRenders = [];
  const document = { getElementById: id => { if (!nodes.has(id)) { const node = new Node(); node.connected = true; nodes.set(id, node); } return nodes.get(id); }, createElement: tag => new Node(tag), createTextNode: value => new Node('text', value), querySelector: selector => document.getElementById(selector), documentElement: new Node(), activeElement: undefined };
  document.head = document.getElementById('test-head'); document.body = document.getElementById('test-body');
  if (documentEvents) document.addEventListener = (key, action) => (documentListeners[key] ??= []).push(action);
  document.getElementById('pool-ranking-panel').hidden = true;
  document.getElementById('test-task-header').append(document.getElementById('task-count'));
  document.body.append(document.getElementById('test-task-header'));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]); initialState.revision = 7; initialState.tasks = [task];
  initialState.members[0].notes = { '12341': 'Original chunk note' }; initialState.members[0].taskStatus = { [task.id]: { note: 'Original task note' } };
  initialState.members[1].notes = {};
  initialState.members[0].preferences = {};
  const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] }, world = buildWorld(definitions);
  const map = { members: initialState.members, setModel(value) { this.members = value.state.members; }, centerOnChunk() {}, centerOnUnlocked() {} };
  let route = async (path, body) => {
    if (path !== '/api/command') throw new Error(`Unexpected request: ${path}`);
    const state = structuredClone(run('state')); state.revision++;
    const payload = body.command, owner = state.members.find(member => member.id === payload.memberId);
    if (payload.type === 'set-note') owner.notes[payload.chunkId] = payload.note;
    if (payload.type === 'set-journal') owner.journal = payload.note;
    if (payload.type === 'set-task-status') owner.taskStatus[payload.taskId] = { ...owner.taskStatus[payload.taskId], ...payload };
    if (payload.type === 'set-chunk') {
      for (const field of ['unlocked', 'selected', 'blacklisted']) owner[field] = owner[field].filter(id => id !== payload.chunkId);
      if (payload.status !== 'locked') owner[payload.status].push(payload.chunkId);
    }
    return { state, pools: {} };
  };
  const context = createContext({ createMapTaskCounts, historyChangeTypes, historyChangeType, backupSaveLabel, appendTaskClaim, createTaskClaimClock, document, localStorage, initialState, initialDefinitions: definitions, initialWorld: world, initialMap: map, renders,
    observeScreenBars: doc => observeScreenBars(doc, context.ResizeObserver),
    artStatusText, datasetStatusText, loadArtStatus: async () => null, installPictureFallbacks() {}, observeArtStatus: listener => listener(null),
    createActivityFilterControls: (collaborators, options) => createActivityFilterControls({ ...collaborators, storage: localStorage }, options), selectActivityRows,
    travelIntoChunk, createChunkQuestList: (collaborators, entries) => { collaborators.storage = localStorage; return createChunkQuestList(collaborators, entries); },
    createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), createSandbox, openSandboxRules, createTaskHover, createTaskMethods, renderTaskEquipment, resolveTaskAlternatives, createDuoResultCache, selectDuoTasks, createDuoTaskView, createTaskFilters, appendTaskPin, appendTaskWhy, catalogued, createRuleDescriber, savedTaskWhyResult, isTaskPinned, createTaskPinChecker, createCompletedView, createDuoCoordination, openTeleportsDialog,
    selectDuoTaskLists, createDuoBacklogView, buildWorld, createRuleRegistry, originalSettings, settingDefinitions, datasetSettings: settingDefinitions, taskHowPreference, appendTaskHow, createRulesPanel,
    taskItemIcon, taskIcon, taskCategoryIcon, createTaskIconPainter, skillIcon: () => null, itemIcon: () => null, loadIcons: async () => false, interiorCandidates: () => [], interiorPanel: () => ({}), describeHistoryEvent: event => event.type, createFeedback: () => ({ open() {}, setSession() {}, start() {}, stop() {} }), createUpdates: () => ({ seen() {}, openList() {} }), createRuneMetricsControls: () => ({}), createGamePlugin: () => ({ refresh: async () => {}, render() {}, open() {}, controls: () => ({}) }), createStickerPicker: () => ({ open() {}, close() {}, isOpen: () => false, element: { contains: () => false } }), createInfoPanels, createNoteEditor, reviewedNoteRevision, createMapTools, applyTheme, createTaskFactsIndex, goalProgress, createDeathSettings, createMiningSettings, createWoodcuttingSettings, createBankingSettings, mergeCommandState, projectChunkState, projectTaskState, createOriginalSync,
    EventSource: class extends Node { constructor(url) { super(); this.url = url; eventSources.push(this); } },
    createDeathChunks: ctx => createDeathChunks({ ...ctx, setTimeout: action => { const id = Symbol(); deathTimers.set(id, action); return id; }, clearTimeout: id => deathTimers.delete(id) }),
    createChunkPlanning: ctx => realPlanning ? createChunkPlanning(ctx) : ({ render: id => { planningRenders.push(id); const node = new Node(); node.append(new Node('details'), new Node('details')); return node; }, prime: value => planningPrimes.push(value) }), AbortController, Uint8Array, crypto: { randomUUID: () => 'test-id', getRandomValues: values => values.fill(1) },
    addEventListener() {},
    setTimeout: (action, delay) => { const id = Symbol(); timers.set(id, { action, delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: action => { Promise.resolve().then(action); return 1; }, performance: { now: () => 0, mark() {} },
    fetch: async (requestPath, options) => { const url = new URL(requestPath, 'http://fixture.invalid'); url.searchParams.delete('view'); for (const parameter of ['lane', 'peerFor', 'revision', 'projection']) url.searchParams.delete(parameter); const path = url.pathname + url.search; let body; if (options?.headers?.['Content-Type'] === BACKUP_UPLOAD_TYPE) { const stream = Readable.fromWeb(options.body.stream()); stream.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])); body = (await readBackupRequest(stream)).body; } else body = options?.body ? JSON.parse(options.body) : undefined; if (path === '/api/prediction-intent') { intentCalls.push({ body, options }); return { ok: true, json: async () => ({ ...body, stateRevision: body.revision, prepared: true }) }; } if (path.startsWith('/api/death-estimates?')) { deathCalls.push({ path, options }); const ownerId = new URL(path, 'http://fixture.invalid').searchParams.get('memberId'); return { ok: true, json: async () => ({ memberId: ownerId, stateRevision: run('state.revision'), candidateIds: [], estimates: [] }) }; } calls.push({ path, requestPath, body, options }); const value = await route(path, body); return value?.ok === false ? { ...value, json: async () => value.value } : { ok: true, json: async () => value }; },
  });
  const run = code => runInContext(code, context);
  run(settingsSource); runScreenGraph(context, screenGraph);
  run("sessionAdmin = true; registry = createRuleRegistry(); state = initialState; definitions = initialDefinitions; world = initialWorld; map = initialMap; memberId = 'actor1'; pool = { eligible: [], excluded: [] }; const shippedRenderTasks = renderTasks; renderTasks = () => { renders.push({ state: state.revision, tasks: result?.stateRevision }); shippedRenderTasks(); }; renderState();");
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  const all = () => [...nodes.values()].flatMap(walk);
  const find = (tag, text) => all().find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
  const click = text => { const node = find('button', text); assert.ok(node, text); return node.emit('click'); };
  const adopt = next => { context.next = next; run('adopt(next, {});'); };
  const snapshot = () => structuredClone(run('state'));
  // A trusted user event as the document's capture listeners see it.
  const user = (key, event = {}) => { for (const action of documentListeners[key] ?? []) action({ target: document.activeElement, ...event }); };
  return { run, context, nodes, calls, intentCalls, deathCalls, deathTimers, renders, timers, eventSources, planningPrimes, planningRenders, map, find, all, click, adopt, snapshot, user, route: action => { route = action; } };
}

test('chunk contents defer full planning sections until a planning tab is selected', async () => {
  const h = harness();
  h.run("member().preferences.defaultChunkinfo = 'challenges'; chunkTab = 'contents'; showChunk('12341')");
  assert.deepEqual(h.planningRenders, [], 'An unselected preferred Tasks section must not start loading evidence');
  await h.click('Tasks'); assert.deepEqual(h.planningRenders, ['12341']);
  await h.click('Clues'); assert.deepEqual(h.planningRenders, ['12341'], 'Both planning tabs reuse their view after explicit selection');
  h.run("chunkTab = 'contents'; showChunk('12342')"); assert.deepEqual(h.planningRenders, ['12341']);
});

test('a chunk a travel line lands in explains its routes only when that section is opened', async () => {
  const h = harness();
  h.run("map.connectionsForChunk = id => id === '12341' ? [{ kind: 'carpet' }] : []");
  h.route(path => {
    if (!path.startsWith('/api/teleports')) return taskResult(h.run('state.revision'));
    assert.equal(path, '/api/teleports?member=actor1');
    return { memberId: 'actor1', stateRevision: h.run('state.revision'), rows: [
      { id: 'a', name: 'Nardah to Uzer (magic carpet)', group: 'transport', destination: '12341', available: false, reason: 'Needs quest The Golem; personal completion unknown.' },
      { id: 'b', name: 'Shantay Pass to Uzer (magic carpet)', group: 'transport', destination: '12341', available: false, reason: 'Needs quest The Golem; personal completion unknown.' },
      { id: 'c', name: 'Elsewhere', group: 'transport', destination: '99999', available: false, reason: 'x' }] };
  });
  h.run("showChunk('12342')");
  assert.equal(h.find('summary', 'Travel into this chunk'), undefined, 'no travel line, no section');
  h.run("showChunk('12341')"); await flush();
  const summary = h.find('summary', 'Travel into this chunk'), section = h.all().find(node => node.children.includes(summary));
  const checks = () => h.calls.filter(call => (call.path ?? call.requestPath).startsWith('/api/teleports')).length;
  assert.ok(section); assert.equal(checks(), 0, 'opening the chunk does not check routes');
  section.open = true; await section.emit('toggle'); await flush();
  assert.equal(checks(), 1);
  assert.ok(h.find('p', 'Not usable: Needs quest The Golem; personal completion unknown.'));
  assert.ok(h.find('p', 'Nardah to Uzer (magic carpet) · Shantay Pass to Uzer (magic carpet)'));
  assert.equal(h.all().some(node => node.textContent === 'Elsewhere'), false);
  section.open = false; await section.emit('toggle'); section.open = true; await section.emit('toggle'); await flush();
  assert.equal(checks(), 1, 'reopening keeps the loaded answer');
});

const planningResult = (revision = 7, chunkId = '12341', memberId = 'actor1') => ({ format: 'chunk-planning-v1', stateRevision: revision, memberId, chunkId,
  rows: [{ task: { id: 'rs3:task:planning', label: 'Planning goal', category: 'Extra', status: 'available' }, evidence: [{ location: chunkId, reason: 'Declared location requirement' }] }],
  clueLocations: [], access: { bases: [chunkId], areas: [], sections: [] } });

test('locked Chunk Info quietly prepares one exact intent and aborts on close, change and revision', async () => {
  const h = harness();
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.route(() => ({ ...taskResult(h.run('state.revision')), memberId: h.run('memberId') }));
  h.run("showChunk('12341'); showChunk('12341')");
  await flush();
  assert.equal(h.intentCalls.length, 1);
  assert.deepEqual(h.intentCalls[0].body, { memberId: 'actor1', chunkId: '12341', revision: 7 });
  assert.equal(h.calls.length, 0, 'preparation does not request full predictions or saved state');
  h.run("showChunk('12342')");
  await flush();
  assert.equal(h.intentCalls[0].options.signal.aborted, true);
  assert.equal(h.intentCalls[1].options.signal.aborted, false);
  h.run("document.getElementById('chunk-info').hidden = true; syncPredictionIntents()");
  assert.equal(h.intentCalls[1].options.signal.aborted, true);
  h.run("showChunk('12341')"); await flush();
  h.run('state.revision++; renderState()'); await flush(); await flush();
  assert.equal(h.intentCalls[2].options.signal.aborted, true);
  assert.equal(h.intentCalls.at(-1).body.revision, 8);
  h.run("memberId = 'reed'; renderState()");
  await flush(); await flush();
  assert.equal(h.intentCalls.at(-2).options.signal.aborted, true);
  assert.equal(h.intentCalls.at(-1).body.memberId, 'reed');
  assert.equal(h.run('result.memberId'), 'reed'); assert.equal(h.run('result.stateRevision'), 8);
});

test('fresh pending roll choices prepare both exact destinations and retain partner-owned offers', async () => {
  const h = harness(), state = h.snapshot();
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  state.members[0].pendingRoll = ['12341', '12342']; state.members[1].unlocked = ['12341'];
  h.adopt(state);
  await flush();
  assert.deepEqual(h.intentCalls.map(call => call.body.chunkId).sort(), ['12341', '12342']);
  h.run('renderState()'); assert.equal(h.intentCalls.length, 2);
  const next = h.snapshot(); next.revision++; next.members[0].pendingRoll = []; next.members[0].unlocked = ['12342'];
  h.adopt(next);
  assert.ok(h.intentCalls.every(call => call.options.signal.aborted));
  assert.equal(h.run('predictionIntents.size'), 0);
});

for (const save of ['local claim', 'local preference', 'remote claim']) test(`automatic panel preparation retains its in-flight request across a ${save} save`, async () => {
  const h = harness(), pending = deferred(), requests = [], fetch = h.context.fetch;
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.context.fetch = async (path, options) => {
    if (path !== '/api/prediction-intent') return fetch(path, options);
    requests.push({ body: JSON.parse(options.body), options });
    return { ok: true, json: () => pending.promise };
  };
  h.run("showChunk('12341')"); await flush();
  const original = h.run("predictionIntents.get('12341')");
  assert.equal(requests.length, 1);
  h.route(path => {
    assert.equal(path, save === 'remote claim' ? '/api/state' : '/api/command');
    const state = h.snapshot(); state.revision++;
    if (save === 'local preference') state.members[0].preferences.theme = 'dark';
    else state.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
    return { state, pools: {} };
  });
  try {
    if (save === 'remote claim') {
      h.run('connectEvents()');
      await h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8, taskResultsUnchanged: true }) });
    } else await h.run(save === 'local claim'
      ? `command({ type:'claim-task', memberId:'reed', taskId:${JSON.stringify(task.id)} })`
      : "command({ type:'set-preference', memberId:'actor1', preferenceId:'theme', value:'dark' })");
    await flush();
    assert.equal(original.controller.signal.aborted, false, 'display-only adoption must not cancel the scheduler intent waiter');
    assert.equal(h.run("predictionIntents.get('12341')"), original);
    assert.equal(requests.length, 1, 'unchanged gameplay does not issue a replacement preparation request');
  } finally { pending.resolve({ memberId: 'actor1', chunkId: '12341', stateRevision: 8, prepared: true }); }
  await original.promise;
  assert.equal(h.run("predictionIntents.get('12341')"), original);
});

test('automatic panel preparation waiting for foreground rebinds its dispatch revision across a display save', async () => {
  const h = harness(), gate = deferred();
  h.context.intentReady = taskResult(7); h.context.intentGate = gate.promise;
  h.run('result = intentReady; ensureForegroundSettled = () => intentGate');
  h.run("showChunk('12341')");
  const original = h.run("predictionIntents.get('12341')");
  h.route(path => {
    assert.equal(path, '/api/command'); const state = h.snapshot(); state.revision++;
    state.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
    return { state, pools: {} };
  });
  await h.run(`command({ type:'claim-task', memberId:'reed', taskId:${JSON.stringify(task.id)} })`);
  gate.resolve(); await original.promise; await flush();
  assert.equal(original.controller.signal.aborted, false);
  assert.equal(h.run("predictionIntents.get('12341')"), original);
  assert.equal(h.intentCalls.length, 1);
  assert.equal(h.intentCalls[0].body.revision, 8, 'an undispatched request uses the current compatible revision');
});

test('automatic panel preparation survives a trusted claim-only conflict but cancels after the retried gameplay save', async () => {
  const h = harness(), pending = deferred(), acknowledgement = deferred(), fetch = h.context.fetch;
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.context.fetch = async (path, options) => path === '/api/prediction-intent'
    ? { ok: true, json: () => pending.promise } : fetch(path, options);
  h.run("showChunk('12341')"); await flush();
  const original = h.run("predictionIntents.get('12341')"), claimed = h.snapshot(); claimed.revision = 8;
  claimed.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
  h.route(path => {
    assert.equal(path, '/api/command');
    return h.calls.filter(call => call.path === '/api/command').length === 1
      ? { ok: false, status: 409, value: { state: claimed, pools: {}, claimOnlyChanges: true } } : acknowledgement.promise;
  });
  const saving = h.run("command({ type:'set-chunk', memberId:'actor1', chunkId:'12341', status:'unlocked' })"); await flush();
  try {
    assert.equal(h.run('state.revision'), 8);
    assert.equal(original.controller.signal.aborted, false, 'the trusted conflict proves only claims changed');
    assert.equal(h.run("predictionIntents.get('12341')"), original);
  } finally {
    const saved = structuredClone(claimed); saved.revision = 9; saved.members[0].unlocked.push('12341');
    acknowledgement.resolve({ state: saved, pools: {} });
    pending.resolve({ memberId: 'actor1', chunkId: '12341', stateRevision: 8, prepared: true });
    await saving; await original.promise;
  }
  assert.equal(original.controller.signal.aborted, true, 'the subsequent gameplay save removes the now-unlocked intent');
  assert.equal(h.run('predictionIntents.size'), 0);
});

for (const change of ['gameplay', 'unknown revision', 'member', 'actor', 'panel']) test(`automatic panel preparation cancels after ${change} follows a proven display save`, async () => {
  const h = harness(), pending = deferred(), fetch = h.context.fetch;
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.context.fetch = async (path, options) => path === '/api/prediction-intent'
    ? { ok: true, json: () => pending.promise } : fetch(path, options);
  h.run("showChunk('12341')"); await flush();
  const original = h.run("predictionIntents.get('12341')");
  h.route(path => {
    if (path.startsWith('/api/tasks?')) return { ...taskResult(h.run('state.revision')), memberId: h.run('memberId') };
    assert.equal(path, '/api/command'); const state = h.snapshot(); state.revision++;
    state.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
    return { state, pools: {} };
  });
  try {
    await h.run(`command({ type:'claim-task', memberId:'reed', taskId:${JSON.stringify(task.id)} })`);
    assert.equal(original.controller.signal.aborted, false);
    if (change === 'gameplay') h.run("state.revision++; state.members[1].unlocked.push('12342'); syncPredictionIntents()");
    else if (change === 'unknown revision') h.run('state.revision++; syncPredictionIntents()');
    else h.run(change === 'member' ? "memberId = 'reed'; syncPredictionIntents()"
      : change === 'actor' ? "sessionMember = 'reed'; syncPredictionIntents()" : "document.getElementById('chunk-info').hidden = true; syncPredictionIntents()");
    assert.equal(original.controller.signal.aborted, true);
    assert.notEqual(h.run("predictionIntents.get('12341')"), original);
  } finally { pending.resolve({ memberId: 'actor1', chunkId: '12341', stateRevision: 8, prepared: true }); await original.promise; }
});

test('one gameplay epoch preserves preparation and explicit Preview across more than 64 unchanged saves', async () => {
  const h = harness(), pending = deferred(), fetch = h.context.fetch, intentCalls = [];
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.context.fetch = async (path, options) => {
    if (path !== '/api/prediction-intent') return fetch(path, options);
    intentCalls.push(options); return { ok: true, json: () => pending.promise };
  };
  h.route(path => {
    if (path.startsWith('/api/predict?')) return pending.promise;
    assert.equal(path, '/api/command'); const state = h.snapshot(); state.revision++;
    state.members[0].preferences.theme = state.revision % 2 ? 'dark' : 'light';
    return { state, pools: {} };
  });
  h.run("chunkTab = 'unlock'; showChunk('12341')"); await flush();
  const original = h.run("predictionIntents.get('12341')");
  try {
    for (let i = 0; i < 70; i++) await h.run(`command({type:'set-preference',memberId:'actor1',preferenceId:'theme',value:'${i % 2 ? 'dark' : 'light'}'})`);
    assert.equal(h.run('state.revision'), 77);
    assert.equal(original.controller.signal.aborted, false);
    assert.equal(h.run("predictionIntents.get('12341')"), original);
    assert.equal(intentCalls.length, 1);
    assert.equal(h.calls.filter(call => call.path.startsWith('/api/predict?')).length, 1);
    assert.equal(h.run('canonicalTaskRevision()'), 7);
  } finally {
    pending.resolve({ memberId:'actor1', stateRevision:7, prepared:true, delta:{tasksAdded:[],itemsAdded:[],areasAdded:[]} });
    await original.promise; await flush();
  }
  assert.ok(h.find('p', 'No new possible tasks'));
});

for (const save of ['local', 'remote']) test(`pre-dispatch preparation keeps a proven ${save} display edge without a ready task result`, async () => {
  const h = harness(), gate = deferred();
  h.context.intentGate = gate.promise; h.run('ensureForegroundSettled = () => intentGate');
  h.run("showChunk('12341')"); const original = h.run("predictionIntents.get('12341')");
  h.route(path => {
    assert.equal(path, save === 'local' ? '/api/command' : '/api/state'); const state = h.snapshot(); state.revision++;
    state.taskClaims = { [task.id]:{memberId:'reed',at:'2026-10-12T12:00:00Z'} }; return {state,pools:{}};
  });
  if (save === 'local') await h.run(`command({type:'claim-task',memberId:'reed',taskId:${JSON.stringify(task.id)}})`);
  else { h.run('connectEvents()'); await h.eventSources[0].emit('revision',{data:JSON.stringify({revision:8,taskResultsUnchanged:true})}); }
  gate.resolve(); await original.promise; await flush();
  assert.equal(original.controller.signal.aborted,false);
  assert.equal(h.run("predictionIntents.get('12341')"),original);
  assert.equal(h.intentCalls.length,1); assert.equal(h.intentCalls[0].body.revision,8);
});

for (const phase of ['in-flight', 'completed']) for (const save of ['claim', 'preference']) test(`explicit Preview retains its ${phase} prediction across a ${save} save`, async () => {
  const h = harness(), pending = deferred();
  const prediction = { memberId: 'actor1', stateRevision: 7, delta: { tasksAdded: [{ label: 'Preserved prediction', category: 'Skill' }], itemsAdded: [], areasAdded: [] } };
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.route(path => {
    if (path.startsWith('/api/predict?')) return pending.promise;
    assert.equal(path, '/api/command'); const state = h.snapshot(); state.revision++;
    if (save === 'claim') state.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
    else state.members[0].preferences.theme = 'dark';
    return { state, pools: {} };
  });
  h.run("chunkTab = 'unlock'; showChunk('12341')"); await flush();
  if (phase === 'completed') { pending.resolve(prediction); await flush(); }
  try {
    await h.run(save === 'claim'
      ? `command({ type:'claim-task', memberId:'reed', taskId:${JSON.stringify(task.id)} })`
      : "command({ type:'set-preference', memberId:'actor1', preferenceId:'theme', value:'dark' })");
    assert.equal(h.calls.filter(call => call.path.startsWith('/api/predict?')).length, 1, 'display-only adoption reuses the exact prediction promise');
  } finally { pending.resolve(prediction); await flush(); }
  assert.ok(h.find('p', '1 new possible task'));
  assert.ok(!h.find('p', 'The map changed while this was calculating.'));
});

test('stale speculative preparation remains quiet and cannot adopt response state', async () => {
  const h = harness(), saved = h.snapshot(), newer = h.snapshot(); newer.revision++;
  h.context.intentReady = taskResult(7); h.run('result = intentReady');
  h.context.fetch = async () => ({ ok: false, status: 409, json: async () => ({ state: newer, pools: {}, format: 'play-v1' }) });
  h.run("showChunk('12341')"); await h.run("predictionIntents.get('12341').promise");
  assert.deepEqual(h.snapshot(), saved);
  assert.equal(h.run('stateIsPlayView'), false); assert.equal(h.timers.size, 0);
  assert.equal(h.nodes.has('notice'), false);
});

test('startup pending intents wait for selected and peer task paint before any preparation request', async () => {
  const h = harness(), selected = deferred(), peer = deferred(), state = h.snapshot();
  state.members[0].pendingRoll = ['12341', '12342'];
  h.route(path => path.includes('reed') ? peer.promise : selected.promise);
  h.run("document.getElementById('group-view').checked = true"); h.adopt(state);
  await flush(); assert.equal(h.intentCalls.length, 0);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks')).length, 2);
  selected.resolve(taskResult(7)); await flush(); await flush();
  assert.equal(h.run('result.stateRevision'), 7); assert.equal(h.intentCalls.length, 0);
  peer.resolve({ ...taskResult(7), memberId: 'reed' });
  await h.run('Promise.all([...predictionIntents.values()].map(request => request.promise))');
  assert.equal(h.run('foregroundSettled()'), true);
  assert.deepEqual(h.intentCalls.map(call => call.body.chunkId).sort(), ['12341', '12342']);
});

for (const failedPlayer of ['actor1', 'reed']) test(`pending intent retries once after ${failedPlayer} task loading recovers without reopening a panel`, async () => {
  const h = harness(), state = h.snapshot(); state.members[0].pendingRoll = ['12341'];
  h.run(`document.getElementById('group-view').checked = ${failedPlayer === 'reed'}`);
  h.route(path => path === '/api/health' ? { worker: { ready: true } }
    : path.includes(failedPlayer) ? Promise.reject(new Error('Temporary task failure')) : taskResult(7));
  h.adopt(state);
  const failed = h.run("predictionIntents.get('12341').promise");
  await failed; await flush(); await flush();
  assert.equal(h.run('predictionIntents.size'), 0);
  assert.equal(h.intentCalls.length, 0);
  h.route(path => ({ ...taskResult(7), memberId: path.includes('reed') ? 'reed' : 'actor1' }));
  if (failedPlayer === 'reed') { await h.click('Retry duo tasks'); await h.run('duoLoading?.promise'); }
  else await h.run('loadTasks()');
  await flush(); await h.run("predictionIntents.get('12341')?.promise");
  assert.equal(h.intentCalls.length, 1, 'the successful task paint retries the pending choice');
  h.run("document.getElementById('chunk-info').hidden = true; syncPredictionIntents(); renderState(); renderTasks()");
  await flush(); await flush();
  assert.equal(h.intentCalls.length, 1, 'successful preparation stays deduplicated with the panel closed');
  assert.equal(h.run('predictionIntents.size'), 1);
});

test('failed intent API waits for a later sync rather than retrying itself', async () => {
  const h = harness(); h.context.intentReady = taskResult(7); h.run('result = intentReady');
  let requests = 0; const fetch = h.context.fetch;
  h.context.fetch = async (path, options) => path === '/api/prediction-intent' && ++requests === 1
    ? { ok: false, status: 503, json: async () => ({ message: 'Temporary preparation failure' }) } : fetch(path, options);
  h.run("showChunk('12341')"); await h.run("predictionIntents.get('12341').promise");
  await flush(); await flush();
  assert.equal(requests, 1); assert.equal(h.run('predictionIntents.size'), 0);
  assert.equal(h.timers.size, 0, 'failure does not schedule an automatic retry loop');
  h.run('syncPredictionIntents()'); await h.run("predictionIntents.get('12341').promise");
  assert.equal(requests, 2); assert.equal(h.intentCalls.length, 1);
  h.run('syncPredictionIntents(); renderTasks()'); await flush(); await flush();
  assert.equal(requests, 2, 'a successful retry remains deduplicated');
});

test('intent abandoned before its API clears its record and can be offered again', async () => {
  const h = harness(), gate = deferred(); h.context.intentGate = gate.promise;
  h.run('ensureForegroundSettled = () => intentGate');
  h.run("showChunk('12341')"); const abandoned = h.run("predictionIntents.get('12341').promise");
  h.run("document.getElementById('chunk-info').hidden = true");
  gate.resolve(); await abandoned;
  assert.equal(h.run('predictionIntents.size'), 0); assert.equal(h.intentCalls.length, 0);
  h.run("showChunk('12341')"); await h.run("predictionIntents.get('12341').promise");
  assert.equal(h.intentCalls.length, 1);
});

test('an old failed intent cannot remove its successful replacement', async () => {
  const h = harness(), gate = deferred(); h.context.intentGate = gate.promise;
  h.run('ensureForegroundSettled = () => intentGate');
  h.run("showChunk('12341')"); const old = h.run("predictionIntents.get('12341').promise");
  h.run("document.getElementById('chunk-info').hidden = true; syncPredictionIntents(); ensureForegroundSettled = async () => {}; showChunk('12341')");
  const replacement = h.run("predictionIntents.get('12341')"); await replacement.promise;
  gate.reject(new Error('Old foreground request failed')); await old;
  assert.equal(h.run("predictionIntents.get('12341')"), replacement);
  h.run('syncPredictionIntents()'); await flush();
  assert.equal(h.intentCalls.length, 1);
});

test('intent abandoned while foreground loads stays quiet after close, chunk, member or revision changes', async () => {
  for (const change of ["document.getElementById('chunk-info').hidden = true; syncPredictionIntents()",
    "chunkId = '12342'", "memberId = 'reed'", 'state.revision++']) {
    const h = harness(), selected = deferred(); h.route(() => selected.promise);
    h.run("showChunk('12341')"); const request = h.run("predictionIntents.get('12341')");
    await flush(); assert.equal(h.intentCalls.length, 0);
    h.run(change); selected.resolve(taskResult(7)); await request.promise; await flush();
    assert.ok(!h.intentCalls.some(call => call.body.memberId === 'actor1' && call.body.chunkId === '12341' && call.body.revision === 7));
    assert.ok(!h.nodes.has('notice'));
  }
});


test('personal foreground releases planning immediately and save refresh coalesces without a 100ms delay', async () => {
  const h = harness();
  h.route(path => path.startsWith('/api/chunk-planning?') ? planningResult() : taskResult(7));
  h.run("chunkTab = 'contents'; showChunk('12341')");
  await h.run("ensurePlanningResult('12341')");
  assert.equal(h.calls.length, 2);
  assert.ok(!h.calls.some(call => call.path === '/api/state'));
  h.run('scheduleTasks(); scheduleTasks()');
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 0);
});

test('aborted death work waiting for Group foreground never reaches its API', async () => {
  const h = harness(), peer = deferred(), controller = new AbortController(); h.context.advisorySignal = controller.signal;
  h.run("document.getElementById('group-view').checked = true");
  h.route(path => path.includes('reed') ? peer.promise : taskResult(7));
  const waiting = h.run("advisoryApi('/api/death-estimates?memberId=actor1', undefined, advisorySignal)");
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  await flush(); controller.abort(); peer.resolve({ ...taskResult(7), memberId: 'reed' });
  await rejected; assert.equal(h.deathCalls.length, 0);
});

function sandboxHarness() {
  const h = harness();
  const baseline = { ...taskResult(7), format: 'play-v1', tasks: [task], presentation: { tasks: [{ id: task.id }] } };
  h.context.baseline = baseline;
  h.run("result = baseline; shownResult = baseline; statePools = { actor1: { eligible: [{ id: '12341' }, { id: '12342' }], excluded: [], accessible: [] } }; pool = statePools.actor1; sandbox.mount(); renderState();");
  h.route(async (path, body) => {
    assert.equal(path, '/api/sandbox/evaluate');
    const added = body.changes.unlockChunks.map(id => ({ id: `custom:chunk:${id}`, label: `New goal ${id}`, category: 'Custom', status: 'available' }));
    const tasks = [task, ...added];
    return { format: 'sandbox-v1', memberId: body.memberId, stateRevision: body.baseRevision, changes: body.changes,
      result: { ...taskResult(body.baseRevision), tasks, presentation: { tasks: tasks.map(row => ({ id: row.id })) } },
      possibleCount: tasks.length, rollPool: { eligible: [], excluded: [], accessible: [] },
      delta: { tasksAdded: added, tasksRemoved: [] } };
  });
  return h;
}

test('shipped sandbox command and POST guards route only hypothetical changes and restore the saved view', async () => {
  const h = sandboxHarness(), savedState = h.run('state'), savedResult = h.run('result'), savedPools = h.run('statePools');
  await h.run('sandbox.enter()');
  assert.equal(h.nodes.get('pick').disabled, true);
  assert.equal(h.nodes.get('backup-open').disabled, true);
  await h.run("toggleChunk('12341')");
  await h.run("toggleChunk('12342')");
  await h.run("command({ type: 'set-task-status', memberId, taskId: 'custom:chunk:12341', challengeCompleted: true })");
  assert.deepEqual(h.calls.at(-1).body.changes.unlockChunks, ['12341', '12342']);
  assert.deepEqual(h.calls.at(-1).body.changes.doneTasks, ['custom:chunk:12341']);
  await assert.rejects(h.run("command({ type: 'set-note', memberId, chunkId: '12341', note: 'Cannot save' })"), /Exit sandbox/i);
  await assert.rejects(h.run("api('/api/runemetrics/apply', { previewId: 'cannot-save' })"), /Exit Sandbox/);
  assert.ok(h.calls.every(call => call.path === '/api/sandbox/evaluate'));
  assert.equal(h.run('state.revision'), 7);
  assert.ok(h.all().some(node => node.className === 'sandbox-new' && node.textContent === 'new'));
  h.run('sandbox.exit()');
  assert.equal(h.run('state'), savedState); assert.equal(h.run('result'), savedResult); assert.equal(h.run('statePools'), savedPools);
  assert.equal(h.nodes.get('sandbox-banner').hidden, true); assert.equal(h.nodes.get('backup-open').disabled, false);
  assert.ok(!h.find('button', 'New goal 12341'));
});

test('an outstanding saved task detail request cannot overwrite a hypothetical task view', async () => {
  const h = sandboxHarness(), full = deferred();
  h.route((path, body) => {
    if (path === '/api/sandbox/evaluate') return { format: 'sandbox-v1', memberId: body.memberId, stateRevision: body.baseRevision };
    assert.equal(path, '/api/tasks?memberId=actor1'); return full.promise;
  });
  const pending = assert.rejects(h.run('ensureFullResult(false)'), /selected map or saved state changed/i);
  await flush(); await h.run('sandbox.enter()');
  full.resolve(h.context.baseline); await pending;
  assert.equal(h.run('fullResult'), undefined);
});

test('sandbox stale responses preserve the draft and a remote save restores and adopts the real view', async () => {
  const h = sandboxHarness(); await h.run('sandbox.enter()');
  const real = h.snapshot(); real.revision++;
  h.route(async () => ({ ok: false, status: 409, value: { message: 'Saved revision changed', state: real, pools: {} } }));
  await assert.rejects(h.run("toggleChunk('12341')"), /The saved map changed/);
  assert.equal(h.run('sandbox.stale'), true); assert.equal(h.run('state.revision'), 7);
  assert.ok(h.snapshot().members[0].unlocked.includes('12341'));
  h.adopt(real);
  assert.equal(h.run('sandbox.active'), false); assert.equal(h.run('state.revision'), 8);
  assert.deepEqual(h.snapshot().members[0].unlocked, real.members[0].unlocked);
});

test('sandbox Preview refreshes its hypothetical base after another chunk changes despite focused controls', async () => {
  const h = sandboxHarness(); await h.run('sandbox.enter()');
  h.route(async (path, body) => {
    assert.equal(path, '/api/sandbox/evaluate');
    const label = body.changes.unlockChunks.includes('12342') ? 'After unlocking the other chunk' : 'Before the other chunk';
    return { format: 'sandbox-v1', memberId: body.memberId, stateRevision: body.baseRevision, changes: body.changes,
      result: taskResult(7), possibleCount: 0, rollPool: { eligible: [{ id: '12341', reasons: [] }], excluded: [], accessible: [] }, delta: { tasksAdded: [], tasksRemoved: [] },
      ...(body.previewChunkId ? { prediction: { delta: { tasksAdded: [{ id: `preview:${label}`, label, category: 'Custom' }], itemsAdded: [], areasAdded: [] } } } : {}) };
  });
  h.run("pool.eligible.forEach(row => row.reasons = []); chunkTab = 'unlock'; showChunk('12341')"); await flush();
  assert.ok(h.find('li', 'Before the other chunk'));
  const signature = h.run("chunkSignature('12341')");
  h.find('button', 'Unlock in Sandbox').focus();
  assert.equal(h.run("$('chunk-content').contains(document.activeElement)"), true);
  await h.run("sandbox.toggleChunk('12342')"); await flush();
  assert.equal(h.run('state.revision'), 7);
  assert.notEqual(h.run("chunkSignature('12341')"), signature);
  assert.ok(h.find('li', 'After unlocking the other chunk'));
  assert.ok(h.calls.some(call => call.body.previewChunkId === '12341' && call.body.changes.unlockChunks.includes('12342')));
  h.run("chunkTab = 'note'; showChunk('12341')");
  const note = h.find('textarea'); note.value = 'Keep this focused note draft'; note.focus();
  await h.run("sandbox.command({ type: 'set-task-rule', memberId, ruleId: 'Skills', value: false })");
  assert.equal(h.find('textarea'), note); assert.equal(note.value, 'Keep this focused note draft');
});


test('focused chunk planning waits for compact paint and coalesces repeated views', async () => {
  const h = harness(), compact = deferred(), focused = deferred();
  h.route(path => path.startsWith('/api/chunk-planning?') ? focused.promise : compact.promise);
  h.run("chunkId = '12341'; document.getElementById('chunk-info').hidden = false");
  const foreground = h.run('loadTasks()'), first = h.run("ensurePlanningResult('12341')"), second = h.run("ensurePlanningResult('12341')");
  await flush(); assert.deepEqual(h.calls.map(call => call.path), ['/api/tasks?memberId=actor1']);
  compact.resolve({ ...taskResult(7), format: 'play-v1' }); await foreground; await flush();
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/chunk-planning?')).length, 1);
  assert.equal(h.run('result.format'), 'play-v1');
  focused.resolve(planningResult()); assert.equal(await first, await second);
  const cached = await h.run("ensurePlanningResult('12341')"); assert.equal(cached.chunkId, '12341');
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => !call.path.startsWith('/api/tasks?') || call.requestPath.includes('view=play-v1')));
});

test('focused planning rejects changed scope and refreshes a new revision', async () => {
  for (const change of ["memberId = 'reed'", 'state.revision++', "chunkId = '12342'", "document.getElementById('chunk-info').hidden = true"]) {
    const h = harness(), focused = deferred();
    h.context.compact = { ...taskResult(7), format: 'play-v1' };
    h.run("result = compact; chunkId = '12341'; document.getElementById('chunk-info').hidden = false");
    h.route(() => focused.promise);
    const loading = h.run("ensurePlanningResult('12341')"), rejected = assert.rejects(loading, /viewed chunk or saved state changed/);
    await flush(); h.run(change); focused.resolve(planningResult()); await rejected;
    assert.equal(h.run('planningResults.size'), 0);
  }
  const h = harness(); h.context.compact = { ...taskResult(7), format: 'play-v1' };
  h.run("result = compact; chunkId = '12341'; document.getElementById('chunk-info').hidden = false");
  h.route(async path => path.startsWith('/api/chunk-planning?') ? planningResult(h.run('state.revision')) : { ...taskResult(h.run('state.revision')), format: 'play-v1' });
  await h.run("ensurePlanningResult('12341')");
  const changed = h.snapshot(); changed.revision++; h.adopt(changed);
  const refreshed = await h.run("ensurePlanningResult('12341')");
  assert.equal(refreshed.stateRevision, 8); assert.equal(h.calls.filter(call => call.path.startsWith('/api/chunk-planning?')).length, 2);
  assert.ok(h.calls.find(call => call.requestPath === '/api/tasks?memberId=actor1&view=play-v1'));
  assert.ok(h.find('span', '0 possible tasks'), 'The foreground load won by the planning view still reports current completed tasks');
});

test('focused planning loading across a note save keeps its answer', async () => {
  const h = harness(), focused = deferred(); h.context.compact = { ...taskResult(7), format: 'play-v1' };
  h.run("result = compact; chunkId = '12341'; document.getElementById('chunk-info').hidden = false");
  h.route(() => focused.promise);
  const loading = h.run("ensurePlanningResult('12341')"); await flush();
  // A note save: the server says tasks are unchanged, then the page adopts revision 8.
  const noted = h.snapshot(); noted.revision++; h.run('rememberUnchangedTaskRevisions(7, 8)'); h.context.noted = noted; h.run('adopt(noted,{},result,false)');
  focused.resolve(planningResult(7)); assert.equal((await loading).stateRevision, 7);
  assert.equal((await h.run("ensurePlanningResult('12341')")).stateRevision, 7);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/chunk-planning?')).length, 1, 'the kept answer is reused, not fetched again');
  const played = h.snapshot(); played.revision++; h.adopt(played);
  assert.equal(h.run('planningResults.size'), 0, 'a gameplay save still drops it');
});

test('default Tasks tab refreshes through focused planning and task details stay explicit', async () => {
  const h = harness({ realPlanning: true });
  h.context.compact = { ...taskResult(7), format: 'play-v1', tasks: planningResult().rows.map(row => row.task) };
  h.run("result = compact; member().preferences.defaultChunkinfo = 'challenges'; showChunk('12341')");
  h.route(async path => path.startsWith('/api/chunk-planning?') ? planningResult(h.run('state.revision'))
    : { ...taskResult(h.run('state.revision')), format: 'play-v1', tasks: planningResult().rows.map(row => row.task) });
  const tasksSection = () => h.all().find(node => node.tagName === 'DETAILS' && node.children.some(child => child.textContent === 'Possible Tasks'));
  assert.equal(tasksSection().open, true); await tasksSection().emit('toggle'); await h.run('Promise.all(planningRequests.values())'); await flush();
  assert.ok(h.find('span', 'Planning goal')); assert.equal(h.calls.length, 1); assert.ok(h.calls[0].path.startsWith('/api/chunk-planning?'));
  const next = h.snapshot(); next.revision++; h.adopt(next); await h.run('ensureForegroundSettled()'); await tasksSection().emit('toggle'); await flush(); await flush();
  await tasksSection().emit('toggle'); await flush();
  assert.ok(h.calls.every(call => !call.path.startsWith('/api/tasks?') || call.requestPath.includes('view=play-v1')));
  assert.ok(h.calls.some(call => call.path.startsWith('/api/chunk-planning?') && h.run('result.stateRevision') === 8));
  h.route(async () => ({ ...taskResult(8), tasks: [{ ...planningResult().rows[0].task, explanation: 'Full task evidence', sources: [] }] }));
  const linked = h.all().find(node => node.tagName === 'BUTTON' && node.className?.includes('linked-task'));
  assert.ok(linked); await linked.emit('click'); await flush();
  assert.equal(h.calls.filter(call => call.requestPath === '/api/tasks?memberId=actor1').length, 1);
  assert.ok(h.find('p', 'Full task evidence'));
});

test('Map journal keeps named personal journals separate from chunk notes and saves the selected player', async () => {
  const h = harness(); h.run("state.members[0].journal = 'Player’s map plans'; state.members[1].journal = 'Reed’s map plans'; journal.open()");
  assert.equal(h.nodes.get('dialog-title').textContent, 'Map journal');
  assert.ok(h.find('label', 'Player’s journal')); assert.ok(h.find('h3', 'Reed’s journal'));
  assert.ok(h.find('p', 'Reed’s map plans'));
  const draft = h.find('textarea'); assert.equal(draft.maxLength, 10000);
  draft.value = 'Whole map plan\nBring supplies'; await draft.emit('input'); await h.click('Save journal');
  const saved = h.calls.find(call => call.body?.command).body;
  assert.equal(saved.command.type, 'set-journal'); assert.equal(saved.command.memberId, 'actor1');
  assert.equal(saved.expectedRevision, 7); assert.equal(h.snapshot().members[0].journal, draft.value);
  assert.equal(h.snapshot().members[1].journal, 'Reed’s map plans');
  assert.equal(h.snapshot().members[0].notes['12341'], 'Original chunk note');
  h.run("memberId = 'reed'; journal.open()");
  assert.equal(h.find('textarea').value, 'Reed’s map plans'); assert.ok(h.find('h3', 'Player’s journal'));
});

test('view-only journals read both players, update live and expose no editor actions', async () => {
  const h = viewerHarness(); h.run("state.members[0].journal = 'Saved journal'; state.members[1].journal = 'Partner journal'; journal.open()");
  assert.equal(h.find('textarea').value, 'Saved journal'); assert.equal(h.find('textarea').readOnly, true);
  assert.ok(h.find('p', 'Partner journal')); assert.equal(h.find('button', 'Save journal'), undefined);
  const next = h.snapshot(); next.revision++; next.members[0].journal = 'Live journal'; next.members[1].journal = 'Live partner'; h.adopt(next);
  assert.equal(h.find('textarea').value, 'Live journal'); assert.ok(h.find('p', 'Live partner'));
  assert.equal(h.calls.length, 0);
});

test('journal drafts survive reopening and require reviewing a same-field remote edit', async () => {
  const h = harness(); h.run("state.members[0].journal = 'Before'; journal.open()");
  h.find('textarea').value = 'My draft'; await h.find('textarea').emit('input');
  h.run('closeDialog()');
  const next = h.snapshot(); next.revision++; next.members[0].journal = 'Remote journal'; h.adopt(next); h.run('journal.open()');
  assert.equal(h.find('textarea').value, 'My draft'); await h.click('Save journal');
  assert.equal(h.calls.length, 0); assert.equal(h.all().find(node => node.attributes['aria-label'] === 'Remote note').value, 'Remote journal');
  await h.click('Save my draft instead');
  assert.equal(h.calls[0].body.expectedRevision, 8); assert.equal(h.snapshot().members[0].journal, 'My draft');
});

test('journal remote-review choice keeps the saved version and drops the draft', async () => {
  const h = harness(); h.run('journal.open()'); h.find('textarea').value = 'My draft'; await h.find('textarea').emit('input');
  const next = h.snapshot(); next.revision++; next.members[0].journal = 'Keep remote'; h.adopt(next);
  await h.click('Save journal'); await h.click('Use remote note');
  assert.equal(h.find('textarea').value, 'Keep remote'); assert.equal(h.calls.length, 0);
  h.run('closeDialog(); journal.open()'); assert.equal(h.find('textarea').value, 'Keep remote');
});

test('partner journals update through SSE without replacing the focused own draft', async () => {
  const h = harness(); h.run('journal.open(); connectEvents()'); const draft = h.find('textarea');
  draft.value = 'Unfinished map plans'; await draft.emit('input'); draft.focus();
  const next = h.snapshot(); next.revision++; next.members[1].journal = 'Partner live plans\nSecond line';
  h.route(() => ({ state: next, pools: {} }));
  await h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8, taskResultsUnchanged: true }) });
  assert.strictEqual(h.find('textarea'), draft); assert.equal(draft.value, 'Unfinished map plans');
  assert.ok(h.find('p', 'Partner live plans\nSecond line')); assert.equal(h.calls.filter(call => call.body?.command).length, 0);
});

test('journal saves retry unrelated changes against the latest revision', async () => {
  const h = harness(); h.run('journal.open()'); h.find('textarea').value = 'My plan'; await h.find('textarea').emit('input');
  const next = h.snapshot(); next.revision++; next.members[1].journal = 'Unrelated partner plan'; h.adopt(next);
  h.route(() => {
    const state = h.snapshot(); state.revision++;
    if (h.calls.filter(call => call.body?.command).length === 1) { state.members[1].notes['12342'] = 'Unrelated chunk note'; return { ok: false, status: 409, value: { state, pools: {} } }; }
    state.members[0].journal = 'My plan'; return { state, pools: {} };
  });
  await h.click('Save journal');
  assert.deepEqual(h.calls.filter(call => call.body?.command).map(call => call.body.expectedRevision), [8, 9]);
  assert.equal(h.snapshot().members[0].journal, 'My plan'); assert.equal(h.snapshot().members[1].journal, 'Unrelated partner plan');
});

test('a journal edit arriving during save shows a conflict without a silent retry', async () => {
  const h = harness(); h.run('journal.open()'); h.find('textarea').value = 'Local draft'; await h.find('textarea').emit('input');
  h.route(() => { const state = h.snapshot(); state.revision++; state.members[0].journal = 'Concurrent draft'; return { ok: false, status: 409, value: { state, pools: {} } }; });
  await h.click('Save journal');
  assert.equal(h.calls.length, 1); assert.equal(h.find('textarea').value, 'Local draft');
  assert.equal(h.all().find(node => node.attributes['aria-label'] === 'Remote note').value, 'Concurrent draft');
  assert.equal(h.snapshot().members[0].journal, 'Concurrent draft');
});

test('journal drafts stay with their player and old dialog buttons cannot save after switching', async () => {
  const h = harness(); h.run('journal.open()'); const oldSave = h.find('button', 'Save journal');
  h.find('textarea').value = 'Player draft'; await h.find('textarea').emit('input');
  h.run("memberId = 'reed'; journal.open()"); assert.equal(h.find('textarea').value, '');
  await oldSave.emit('click'); assert.equal(h.calls.length, 0);
  h.run("memberId = 'actor1'; journal.open()"); assert.equal(h.find('textarea').value, 'Player draft');
});

test('a queued journal save stops if its editor closes before the command starts', async () => {
  const h = harness(), pending = deferred(); h.route(() => pending.promise);
  const first = h.run("command({ type: 'set-note', memberId: 'reed', chunkId: '12341', note: 'Earlier save' })"); await flush();
  h.run('journal.open()'); h.find('textarea').value = 'Waiting draft'; await h.find('textarea').emit('input');
  const saving = h.find('button', 'Save journal').emit('click'); await flush(); h.run('closeDialog()');
  const next = h.snapshot(); next.revision++; pending.resolve({ state: next, pools: {} }); await first; await saving; await flush();
  assert.equal(h.calls.filter(call => call.body?.command.type === 'set-journal').length, 0);
  h.run('journal.open()'); assert.equal(h.find('textarea').value, 'Waiting draft');
});

test('detached journal conflict choices cannot replace a reopened draft or its review', async () => {
  const h = harness(); h.run('journal.open()'); h.find('textarea').value = 'Keep my draft'; await h.find('textarea').emit('input');
  const next = h.snapshot(); next.revision++; next.members[0].journal = 'Remote version'; h.adopt(next); await h.click('Save journal');
  const remote = h.find('button', 'Use remote note'), overwrite = h.find('button', 'Save my draft instead');
  h.run('closeDialog(); journal.open()'); await remote.emit('click'); await overwrite.emit('click');
  assert.equal(h.find('textarea').value, 'Keep my draft'); assert.equal(h.calls.length, 0);
  await h.click('Save journal'); assert.ok(h.find('button', 'Use remote note')); assert.equal(h.calls.length, 0);
});

test('a read-only journal visit keeps the saved text separate from a retained editable draft', async () => {
  const h = harness(); h.run("state.members[0].journal = 'Saved journal'; journal.open()");
  h.find('textarea').value = 'Keep unfinished draft'; await h.find('textarea').emit('input');
  h.run('sessionReadOnly = true; journal.open()');
  assert.equal(h.find('textarea').value, 'Saved journal'); assert.equal(h.find('button', 'Save journal'), undefined);
  h.run('sessionReadOnly = false; journal.open()'); assert.equal(h.find('textarea').value, 'Keep unfinished draft');
});

test('task notes keep the stale draft, show remote edits, and require an explicit overwrite', async () => {
  const h = harness(); h.context.task = task; h.run('showTask(task)');
  const draft = h.find('textarea'); draft.value = 'My task draft'; await draft.emit('input');
  const remote = h.snapshot(); remote.revision = 8; remote.members[0].taskStatus[task.id].note = 'Reed’s newer task note'; h.adopt(remote);
  await h.click('Save note'); assert.equal(h.calls.length, 0); assert.equal(draft.value, 'My task draft');
  assert.equal(h.all().find(node => node.attributes['aria-label'] === 'Remote note').value, 'Reed’s newer task note');
  await h.click('Save my draft instead'); assert.equal(h.calls[0].body.expectedRevision, 8); assert.equal(h.calls[0].body.command.note, 'My task draft');
});

test('chunk draft review survives re-opening and remote rendering; choosing the remote note preserves it', async () => {
  const h = harness(); h.run("showChunk('12341')");
  // The chunk panel is tabbed; a saved note is flagged on its tab rather than expanded by default.
  for (const tab of ['Contents', 'Tasks', 'Clues', 'Preview', 'Note ●']) assert.ok(h.find('button', tab), `${tab} tab`);
  assert.equal(h.find('button', 'Contents').attributes['aria-selected'], 'true', 'contents open first');
  await h.click('Note ●');
  const draft = h.find('textarea'); draft.value = 'My chunk draft'; await draft.emit('input');
  const remote = h.snapshot(); remote.revision = 8; remote.members[0].notes['12341'] = 'Remote chunk note'; h.adopt(remote); h.run("showChunk('12341')");
  assert.equal(h.find('textarea').value, 'My chunk draft'); await h.click('Save chunk note'); assert.equal(h.calls.filter(call => call.body?.command).length, 0);
  await h.click('Use remote note'); assert.equal(h.find('textarea').value, 'Remote chunk note');
  await h.click('Save chunk note'); const saved = h.calls.find(call => call.body?.command); assert.equal(saved.body.expectedRevision, 8); assert.equal(saved.body.command.note, 'Remote chunk note');
});

test('partner chunk notes update through SSE while the own draft stays focused', async () => {
  const h = harness(); h.run("chunkTab = 'note'; showChunk('12341'); connectEvents()");
  const draft = h.find('textarea'); draft.value = 'My unfinished draft'; await draft.emit('input'); draft.focus();
  const next = h.snapshot(); next.revision = 8; next.members[1].notes['12341'] = 'Reed’s live note\nSecond line';
  h.route(() => ({ state: next, pools: {} }));
  await h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8, taskResultsUnchanged: true }) });
  assert.strictEqual(h.find('textarea'), draft); assert.equal(draft.value, 'My unfinished draft');
  assert.ok(h.find('h3', 'Reed’s note')); assert.ok(h.find('p', 'Reed’s live note\nSecond line'));
  assert.equal(h.find('textarea').readOnly, undefined);
  assert.equal(h.calls.filter(call => call.body?.command).length, 0);
  const cleared = h.snapshot(); cleared.revision = 9; cleared.members[1].notes['12341'] = ' \n ';
  h.adopt(cleared); assert.equal(h.find('h3', 'Reed’s note'), undefined); assert.strictEqual(h.find('textarea'), draft);
});

test('personal and Group chunk notes show both named owners and save only the selected player', async () => {
  for (const group of [false, true]) {
    const h = harness(); h.run(`$('group-view').checked = ${group}; state.members[1].notes['12341'] = 'Partner note'; chunkTab = 'note'; showChunk('12341')`);
    assert.ok(h.find('label', 'Player’s note')); assert.ok(h.find('h3', 'Reed’s note')); assert.ok(h.find('p', 'Partner note'));
    h.find('textarea').value = 'My edited note'; await h.find('textarea').emit('input'); await h.click('Save chunk note');
    const payload = h.calls.find(call => call.body?.command).body.command;
    assert.equal(payload.memberId, 'actor1'); assert.equal(payload.note, 'My edited note');
    assert.equal(h.snapshot().members[1].notes['12341'], 'Partner note');
    h.run("memberId = 'reed'; showChunk('12341')");
    assert.equal(h.find('textarea').value, 'Partner note'); assert.ok(h.find('h3', 'Player’s note'));
  }
});

test('viewer chunk notes attribute both players without write controls and flag partner-only notes', async () => {
  const h = viewerHarness(); h.run("state.members[0].notes = {}; state.members[1].notes['12341'] = 'Read-only partner note'; chunkTab = 'note'; showChunk('12341')");
  assert.ok(h.find('button', 'Note ●')); assert.ok(h.find('label', 'Player’s note'));
  assert.equal(h.find('textarea').readOnly, true); assert.ok(h.find('h3', 'Reed’s note')); assert.ok(h.find('p', 'Read-only partner note'));
  assert.equal(h.find('button', 'Save chunk note'), undefined); assert.equal(h.calls.length, 0);
});

test('unrelated local and in-flight remote changes allow note saves against the latest revision', async () => {
  for (const kind of ['task', 'chunk']) {
    const h = harness(); h.context.task = task; h.run(kind === 'task' ? 'showTask(task)' : "showChunk('12341')"); if (kind === 'chunk') await h.click('Note ●'); const draft = h.find('textarea'); draft.value = 'My draft'; await draft.emit('input'); draft.focus();
    const unrelated = h.snapshot(); unrelated.revision = 8; unrelated.members[1].notes['12342'] = 'Another field'; h.adopt(unrelated);
    h.route(async path => { if (path.startsWith('/api/tasks?')) return taskResult(h.run('state.revision')); const state = h.snapshot(); state.revision++; if (h.calls.filter(call => call.body?.command).length === 1) return { ok: false, status: 409, value: { state, pools: {} } }; return { state, pools: {} }; });
    await h.click(kind === 'task' ? 'Save note' : 'Save chunk note');
    assert.deepEqual(h.calls.filter(call => call.body?.command).map(call => call.body.expectedRevision), [8, 9], kind); assert.equal(h.run('state.revision'), 10);
  }
});

test('a same-field edit arriving during the note request becomes a conflict without retrying', async () => {
  const h = harness(); h.context.task = task; h.run('showTask(task)'); h.find('textarea').value = 'My unsaved note';
  h.route(async () => { const state = h.snapshot(); state.revision = 8; state.members[0].taskStatus[task.id].note = 'Remote in-flight note'; return { ok: false, status: 409, value: { state, pools: {} } }; });
  await h.click('Save note'); assert.equal(h.calls.length, 1); assert.equal(h.find('textarea').value, 'My unsaved note');
  assert.equal(h.all().find(node => node.attributes['aria-label'] === 'Remote note').value, 'Remote in-flight note');
});

test('newer task results wait for matching state and are retained without another calculation', async () => {
  const h = harness(), stateResponse = deferred(); h.route(path => path.startsWith('/api/tasks') ? taskResult(8) : stateResponse.promise);
  const loading = h.run('loadTasks()'); await flush(); assert.equal(h.run('result'), undefined); assert.equal(h.run('state.revision'), 7);
  const next = h.snapshot(); next.revision = 8; stateResponse.resolve({ state: next, pools: {} }); await loading;
  assert.equal(h.run('result.stateRevision'), 8); assert.equal(h.run('state.revision'), 8); assert.ok(h.renders.every(row => row.tasks === undefined || row.tasks === row.state));
  assert.equal((await h.run('ensureResult()')).stateRevision, 8); assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 0);
});

test('loaded task results are returned by identity without requests or repeated planning work', async () => {
  const h = harness(); h.route(async () => taskResult(7));
  const loaded = await h.run('ensureResult()');
  assert.equal(h.planningPrimes.length, 0);
  for (let i = 0; i < 5; i++) assert.equal(await h.run('ensureResult()'), loaded);
  assert.equal(h.calls.length, 1); assert.equal(h.planningPrimes.length, 0);
  const updated = h.snapshot(); updated.revision = 8; updated.members[0].preferences.theme = 'light';
  h.context.updated = updated; h.run('adopt(updated, {}, result)');
  const reused = await h.run('ensureResult()');
  assert.equal(reused.tasks, loaded.tasks); assert.equal(reused.stateRevision, 8);
  assert.equal(h.calls.length, 1); assert.equal(h.planningPrimes.length, 0);
});

test('foreground APIs use play views and detail requests coalesce without replacing sidebar results', async () => {
  const h = harness(), response = deferred();
  const slim = { ...taskResult(7), format: 'play-v1', tasks: [{ ...task, id: 'rs3:task:detail', label: 'Compact row' }] };
  h.context.slim = slim; h.run('result = slim');
  h.route(() => response.promise);
  const first = h.run('ensureFullResult()'), second = h.run('ensureFullResult()');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=actor1');
  response.resolve({ ...taskResult(7), tasks: [{ ...slim.tasks[0], record: { Skill: 10 }, explanation: 'Full evidence' }] });
  assert.equal(await first, await second); assert.equal(h.run('result'), slim);
  h.route(() => taskResult(7)); await h.run('loadTasks()');
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  h.route(() => ({ state: { ...h.snapshot(), revision: 8 }, pools: {} }));
  await h.run("command({type:'set-note',memberId:'actor1',chunkId:'12341',note:'view'})");
  assert.equal(h.calls.at(-1).requestPath, '/api/command?view=play-v1');
  assert.equal(h.calls[0].options.cache, undefined);
});

test('startup fetches display definitions and leaves chunk search and full evidence deferred', async () => {
  const h = harness(), loaded = h.snapshot(); let indexedChunks = 0;
  const display = { chunks: { '12341': { toJSON() { indexedChunks++; return { Object: { 'Unique ore': 1 } }; } }, '12342': {} } };
  Object.assign(h.context, { createInvites: () => ({ loadSession: async () => ({}), open: async () => {} }),
    createAccountPanel: () => ({ setSession() {}, open() {} }),
    createAccountsPanel: () => ({ setSession() {}, open: async () => {} }),
    createOverlayPanel: () => ({ open: async () => {} }),
    loadTerrainManifest: async () => null, loadMapInformation: async () => null,
    hydrateDisplayWorld, createRuleRegistryFromDefinitions: () => createRuleRegistry(),
    ChunkMap: class { constructor(options) { h.context.mapOptions = options; return h.map; } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ResizeObserver: class { observe() {} } });
  h.map.setOverlay = () => {}; h.context.document.addEventListener = () => {};
  const worldPayload = projectDisplayWorld(h.context.initialWorld);
  h.route(async path => {
    if (path === '/api/state') return { format: 'play-v1', state: loaded, pools: {} };
    if (path === '/api/definitions') return display;
    if (path === '/api/rules') return { definitions: [] };
    if (path === '/api/display-world') return worldPayload;
    if (path.startsWith('/api/tasks?')) return { ...taskResult(7), format: 'play-v1' };
    throw new Error(`Unexpected startup request ${path}`);
  });
  h.run('state=undefined;definitions=undefined;world=undefined;map=undefined;result=undefined;chunkSearch=undefined');
  await h.run('start()'); await flush();
  const held = []; h.context.recordMenu = (...args) => held.push(args);
  h.run('chunkMenu = (...args) => recordMenu(...args)');
  h.context.mapOptions.onChunkHold('12341', { clientX: 120, clientY: 180 });
  assert.deepEqual(held, [['12341', 120, 180, 'touch']]);
  h.run('applySession({readOnly:true, capabilities:{canWrite:false}, admin:false})');
  h.context.document.documentElement.classList = { contains: () => false };
  assert.equal(h.context.mapOptions.canChunkHold(), true, 'viewers can open a read-only menu by holding');
  h.run('applySession({admin:true, readOnly:false, capabilities:{canWrite:true}})');
  assert.equal(h.run('state.revision'), 7); assert.equal(h.run('result.stateRevision'), 7);
  assert.equal(indexedChunks, 0); assert.equal(h.run('chunkSearch'), undefined); assert.equal(h.run('chunkSearchRequest'), undefined);
  assert.equal(h.run('definitionsAreFull'), false);
  assert.ok(h.calls.some(call => call.requestPath === '/api/definitions?view=display-v1'));
  assert.ok(!h.calls.some(call => call.requestPath === '/api/definitions' || call.requestPath === '/api/tasks?memberId=actor1'));
  await h.run('ensureChunkSearch()'); assert.equal(indexedChunks, 1);
  assert.ok(h.run("chunkSearch.find(row=>row.id==='12341').search.includes('unique ore')"));
});

test('full equipment evidence waits for parallel coalesced definitions before publishing', async () => {
  const h = harness(), taskResponse = deferred(), definitionResponse = deferred();
  h.context.slim = { ...taskResult(7), format: 'play-v1' };
  h.run('result=slim;definitions={chunks:initialDefinitions.chunks};definitionsAreFull=false;chunkSearch=[];searchDialog()');
  h.route(path => path === '/api/definitions' ? definitionResponse.promise : taskResponse.promise);
  const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Equipment')); mode.value = 'Equipment'; const searching = mode.emit('change');
  const joined = h.run('ensureFullResult()');
  assert.deepEqual(h.calls.map(call => call.requestPath), ['/api/tasks?memberId=actor1', '/api/definitions']);
  const full = { ...taskResult(7), equipment: [{ name: 'Full helmet', slot: 'Head', class: 'Melee', tier: 10, sources: [{ kind: 'spawn', name: 'Full helmet', location: '12341' }] }] };
  taskResponse.resolve(full); await flush();
  assert.equal(h.run('fullResult'), undefined); assert.ok(!h.find('span', 'Full helmet'));
  const lateJoin = h.run('ensureFullResult()'); assert.equal(h.calls.length, 2, 'A query joining after tasks finish still shares their result while definitions load');
  definitionResponse.resolve({ chunks: h.context.initialDefinitions.chunks, equipment: { 'Full helmet': { requirements: { Defence: 10 } } } });
  await searching; assert.equal(await joined, full); assert.equal(await lateJoin, full); assert.equal(h.calls.length, 2);
  await h.click('View'); assert.ok(h.find('summary', 'Equip requirements')); assert.ok(h.find('li', 'Defence: 10'));
  assert.ok(h.find('p', 'Item spawn')); assert.ok(h.find('button', 'View location Chunk 12341')); assert.equal(h.run('definitionsAreFull'), true);
  assert.equal(await h.run('ensureFullDefinitions()'), h.run('definitions')); assert.equal(h.calls.length, 2);
});

test('definitions hydration cannot publish full task evidence into a newer dialog or state', async () => {
  for (const change of ["openDialog('Newer dialog')", "memberId='reed'", 'state.revision++']) {
    const h = harness(), definitions = deferred();
    h.context.slim = { ...taskResult(7), format: 'play-v1' };
    h.run('result=slim;definitions={chunks:initialDefinitions.chunks};definitionsAreFull=false');
    h.route(path => path === '/api/definitions' ? definitions.promise : taskResult(7));
    const loading = h.run('ensureFullResult()'), rejected = assert.rejects(loading, /changed while loading/);
    await flush(); h.run(change); definitions.resolve({ chunks: h.context.initialDefinitions.chunks, equipment: {} }); await rejected;
    assert.equal(h.run('fullResult'), undefined); assert.equal(h.run('definitionsAreFull'), true);
  }
});

test('lazy chunk search preserves serialized content matches and yields without stale UI publication', async () => {
  const h = harness(), frames = []; let clock = 0;
  h.context.performance = { now: () => clock += 5 };
  h.context.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  h.run("definitions.chunks['12341']={Object:{'Unique ore':1}};chunkSearch=undefined;searchDialog()");
  assert.equal(h.run('chunkSearch'), undefined); assert.ok(frames.length > 0);
  const first = h.run('ensureChunkSearch()'), second = h.run('ensureChunkSearch()');
  const query = h.all().find(node => node.type === 'search'); query.value = 'unique ore';
  const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Equipment')); const rendering = mode.emit('change');
  for (let i = 0; i < 20 && frames.length; i++) { frames.shift()(); await flush(); }
  assert.equal(await first, await second); await rendering; await flush();
  assert.ok(h.find('span', 'Chunk 12341')); assert.ok(!h.find('span', '12342 · Chunk 12342'));
  const expected = [...h.context.initialWorld.chunks, ...h.context.initialWorld.areas].map(([id, record]) => ({ id, name: String(record.name), search: `${id} ${record.name} ${JSON.stringify(h.run('definitions').chunks[id])}`.toLowerCase() }));
  assert.deepEqual(JSON.parse(JSON.stringify(h.run('chunkSearch'))), expected);
  const cancelling = harness(), laterFrames = []; let laterClock = 0;
  cancelling.context.performance = { now: () => laterClock += 5 }; cancelling.context.requestAnimationFrame = callback => laterFrames.push(callback);
  cancelling.run('chunkSearch=undefined;searchDialog()'); cancelling.run("openDialog('Newer dialog')");
  for (let i = 0; i < 20 && laterFrames.length; i++) { laterFrames.shift()(); await flush(); }
  assert.equal(cancelling.nodes.get('dialog-title').textContent, 'Newer dialog'); assert.ok(!cancelling.all().some(node => node.className === 'search-result'));
});

test('full evidence cannot publish after a member, revision or dialog changes', async () => {
  for (const change of ["memberId = 'reed'", 'state.revision++', 'dialogGeneration++']) {
    const h = harness(), response = deferred(); h.route(() => response.promise);
    const loading = h.run('ensureFullResult()'); h.run(change);
    response.resolve(taskResult(7));
    await assert.rejects(loading, /changed while loading/); assert.equal(h.run('fullResult'), undefined);
  }
});

function hydratedMapHarness() {
  const h = harness();
  h.context.hydratedWorld = hydrateDisplayWorld(projectDisplayWorld(h.context.initialWorld));
  h.run('world = hydratedWorld');
  Object.assign(h.map, { cells: new Map(), deathMarkers: new Map(), dirty: {}, initialized: true, schedule() {}, setSectionHighlight() {} });
  h.map.setModel = function (model) { return ChunkMap.prototype.setModel.call(this, model); };
  const envelope = revision => {
    const state = h.snapshot(); state.revision = revision;
    const pools = Object.fromEntries(state.members.map(owner => [owner.id, { eligible: [], excluded: [], accessible: [], partnerConnections: { byChunk: {} } }]));
    return { format: 'play-v1', schemaVersion: 1, state, pools };
  };
  return { ...h, envelope };
}

test('state-bearing mutations retain hydrated-map pool facts after successful saves', async () => {
  for (const path of ['/api/runemetrics/apply', '/api/restore', '/api/import', '/api/command']) {
    const h = hydratedMapHarness(); h.route(() => h.envelope(8));
    if (path === '/api/runemetrics/apply') {
      h.run("openDialog('Reviewed sync')"); await h.run("applyRuneMetrics('reviewed-preview',7)");
    } else if (path === '/api/command') {
      await h.run("command({type:'sync-original',previewId:'reviewed-preview',members:[]},7)");
    } else {
      h.context.mutationPath = path;
      await h.run("api(mutationPath,{expectedRevision:7}).then(response=>{adopt(response.state,response.pools);saved('Saved',false,state.revision)})");
    }
    assert.equal(h.calls[0].requestPath, `${path}?view=play-v1`);
    assert.equal(h.run('state.revision'), 8); assert.equal(h.map.model.world, h.context.hydratedWorld);
    assert.equal(h.map.connections, h.map.model.pool.partnerConnections);
    assert.equal(h.nodes.get('save-status').textContent, 'Saved');
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 1);
  }
});

test('review and save conflicts adopt hydrated-map state with authoritative connections', async () => {
  for (const path of ['/api/runemetrics/preview', '/api/original-sync/preview', '/api/runemetrics/apply', '/api/restore', '/api/import', '/api/import/preview', '/api/restore/preview']) {
    const h = hydratedMapHarness(); h.route(() => ({ ok: false, status: 409, value: h.envelope(8) }));
    h.context.conflictPath = path;
    await assert.rejects(h.run("api(conflictPath,{expectedRevision:7})"), /Another save arrived first/);
    assert.equal(h.calls[0].requestPath, `${path}?view=play-v1`);
    assert.equal(h.run('state.revision'), 8); assert.equal(h.map.connections, h.map.model.pool.partnerConnections);
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 1);
  }
});

test('repeated ready advisory events do not abort foreground calculations', async () => {
  const h = harness(), response = deferred(); h.route(() => response.promise);
  const loading = h.run('loadTasks()');
  h.run('workerStatus({ready:true});workerStatus({ready:true})');
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 0); assert.equal(h.run('taskController.signal.aborted'), false);
  response.resolve(taskResult(7)); await loading;
  h.run('workerStatus({ready:true})'); assert.equal(h.timers.size, 0);
});

test('task lists yield, cancel obsolete rows and mark completion after the latest render paints', async () => {
  const h = harness(), frames = []; let clock = 0;
  h.context.performance = { now: () => ++clock };
  h.context.requestAnimationFrame = action => { frames.push(action); return frames.length; };
  h.context.__rs3Perf = { enabled: true, events: [] };
  h.run('state.tasks = []');
  const rows = prefix => Array.from({ length: 90 }, (_, i) => ({ ...task, id: `custom:${prefix}:${i}`, label: `${prefix} ${i}` }));
  h.context.state.tasks = rows('Old');
  h.context.bulk = { ...taskResult(7), tasks: rows('Old') };
  const accepting = h.run('acceptTaskResult(bulk)');
  assert.ok(h.all().filter(node => node.className === 'task-row').length < 70);
  h.context.bulk = { ...taskResult(7), tasks: rows('Current') };
  h.context.state.tasks = rows('Current');
  const latest = h.run('acceptTaskResult(bulk)');
  h.run('renderTasks()'); assert.equal(h.context.__rs3Perf.events.length, 0);
  for (let i = 0; i < 100 && frames.length; i++) { frames.shift()(); await flush(); }
  await Promise.all([accepting, latest]);
  assert.equal(h.context.__rs3Perf.events.filter(event => event.name === 'tasks-shown').length, 1);
  assert.equal(h.all().filter(node => node.className === 'task-row').length, 70);
  assert.ok(!h.all().some(node => node.tagName === 'BUTTON' && /^Old /.test(node.textContent)));
  assert.equal(h.nodes.get('task-count').textContent, '90');
});

test('Backlog toggles reason groups independently of Active search and restores matching tasks in one command', async () => {
  const h = harness(), rows = [
    { ...task, id: 'custom:backlog-copper', label: 'Copper ore', category: 'Mining' },
    { ...task, id: 'custom:backlog-tin', label: 'Tin ore', category: 'Mining' },
    { ...task, id: 'custom:backlog-tree', label: 'Chop a tree', category: 'Woodcutting' },
  ];
  h.context.backlogFixture = { ...taskResult(7), tasks: rows };
  h.context.backlogRows = rows;
  h.context.document.addEventListener = () => {}; h.context.document.querySelectorAll = () => [];
  h.context.ResizeObserver = class { observe() {} }; h.map.setOverlay = () => {};
  h.run('sandbox.mount = () => {}; poolRanking.mount = () => {}');
  h.run("state.tasks = backlogRows; state.members[0].taskStatus = Object.fromEntries(backlogRows.map(row => [row.id, {backlogged:true,backlogReason:'Later'}])); result = backlogFixture; document.getElementById('task-filter').value = 'No active matches'; renderTasks(); bindControls()");
  assert.equal(h.nodes.get('backlog-count').textContent, '(3 unique tasks)');
  h.nodes.get('backlog-details').open = true; await h.nodes.get('backlog-details').emit('toggle');
  assert.ok(h.find('span', 'Later (3 unique tasks)')); assert.ok(!h.find('summary', 'Mining (2)'));
  const search = h.all().find(node => node.attributes['aria-label'] === 'Search backlog by name, skill or chunk');
  search.value = 'copper'; await search.emit('input');
  assert.ok(h.find('span', 'Later (1 unique task)')); await h.click('Restore these');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body, { requestId: 'v2.0.1.1', requestAck: 0, expectedRevision: 7, command: { type: 'clear-backlog', memberId: 'actor1', taskIds: ['custom:backlog-copper'] } });
});

test('closed completed and backlog lists retain exact counts without constructing hidden rows', () => {
  const h = harness(); const checked = { ...task, id: 'custom:checked', label: 'Closed checked row' };
  h.context.closed = { ...taskResult(7), tasks: [checked] };
  h.context.state.tasks.push(checked);
  h.run("state.members[0].taskStatus['custom:checked'] = {challengeCompleted:true,backlogged:true}; result=closed;renderTasks()");
  assert.equal(h.nodes.get('completed-count').textContent, '(1)'); assert.equal(h.nodes.get('backlog-count').textContent, '(1 unique task)');
  assert.equal(h.nodes.get('completed-tasks').children.length, 0); assert.equal(h.nodes.get('backlog-tasks').children.length, 0);
  h.run("document.getElementById('completed-details').open=true;renderTasks()");
  assert.ok(h.find('button', 'Closed checked row'));
});

test('preserved imported extras still open their review dialog with a compact engine result', () => {
  const h = harness(); h.context.slim = { ...taskResult(7), format: 'play-v1' };
  h.context.extra = { ...task, id: 't_unresolved', status: 'unsupported', explanation: 'Preserved imported task' };
  h.run('result=slim;showTask(extra)');
  assert.ok(h.find('p', 'Preserved imported task')); assert.equal(h.calls.length, 0);
});

test('item and equipment search modes load full evidence once and render only the current mode', async () => {
  const h = harness(), response = deferred(); h.run('state.members[0].preferences.advanced = true'); h.route(() => response.promise);
  h.context.slim = { ...taskResult(7), format: 'play-v1' }; h.run('result=slim;chunkSearch=[];searchDialog()');
  assert.equal(h.calls.length, 0);
  const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Equipment')); mode.value = 'Equipment'; const equipmentSearch = mode.emit('change');
  mode.value = 'Items & drops'; const itemSearch = mode.emit('change');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=actor1');
  const full = { ...taskResult(7), items: [{ name: 'Full item', sources: [{ kind: 'spawn', location: '12341', name: 'Full item' }] }], equipment: [{ name: 'Full equipment', slot: 'Head', class: 'Melee', tier: 1 }], training: {} };
  response.resolve(full); await Promise.all([equipmentSearch, itemSearch]);
  assert.ok(h.find('span', 'Full item')); assert.ok(!h.find('span', 'Full equipment'));
  await h.click('View'); assert.equal(h.nodes.get('dialog-title').textContent, 'Full item');
  assert.equal(h.run('result'), h.context.slim); assert.equal(h.run('fullResult'), full);
});

test('late search evidence cannot replace a changed query, mode, dialog, member or revision', async () => {
  for (const change of ['query', 'mode', 'dialog', 'member', 'revision']) {
    const h = harness(), response = deferred(); h.route(() => response.promise);
    h.context.slim = { ...taskResult(7), format: 'play-v1' }; h.run('result=slim;chunkSearch=[];searchDialog()');
    const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Equipment')); mode.value = 'Equipment'; const loading = mode.emit('change');
    if (change === 'query') h.nodes.get('dialog-content').querySelector('input').value = 'Different query';
    else if (change === 'mode') mode.value = 'Tasks';
    else h.run(change === 'dialog' ? "openDialog('Newer dialog')" : change === 'member' ? "memberId='reed'" : 'state.revision++');
    response.resolve({ ...taskResult(7), equipment: [{ name: 'Stale equipment', slot: 'Head', class: 'Melee', tier: 1 }] }); await loading;
    assert.ok(!h.find('span', 'Stale equipment'), change);
    if (change === 'dialog') assert.equal(h.nodes.get('dialog-title').textContent, 'Newer dialog');
  }
});

function questSearchResult() {
  const quests = [
    ...Array.from({ length: 130 }, (_, index) => ({ id: `quest:done-${index}`, label: `Finished quest ${index}`, category: 'Quest', status: 'available', blockers: [], questStatus: 'done', canDoNow: false })),
    { id: 'quest:new', label: 'New ready quest', category: 'Quest', status: 'available', blockers: [], questStatus: 'not-started', canDoNow: true, level: 5 },
    { id: 'quest:started', label: 'Started ready quest', category: 'Quest', status: 'available', blockers: [], questStatus: 'in-progress', canDoNow: true, level: 1 },
    { id: 'quest:blocked', label: 'Started blocked quest', category: 'Quest', status: 'blocked', blockers: ['locked chunk'], questStatus: 'in-progress', canDoNow: false, level: 10 },
  ];
  return { ...taskResult(7), tasks: [...quests.map(({ questStatus, canDoNow, ...row }) => row), { id: 'mining:test', label: 'Mining task', category: 'Mining', status: 'available', blockers: [] }], activityInfo: { quests: [{ name: 'Quests', tasks: quests }] } };
}
const searchRows = h => dialogNodes(h).filter(node => node.className === 'search-result');
const searchLabels = h => searchRows(h).map(row => row.querySelector('.search-result-title').querySelector('span').textContent);
const questSearchChip = (h, label) => {
  const group = dialogNodes(h).find(node => node.attributes['aria-label'] === 'Quest progress');
  assert.ok(group); const chip = group.children.find(node => node.textContent === label); assert.ok(chip); return chip;
};
async function openQuestSearch(h, full = questSearchResult()) {
  h.route(() => full); h.context.questSearchSlim = { ...taskResult(7), format: 'play-v1' };
  h.run('result=questSearchSlim;chunkSearch=[];searchDialog()');
  const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Quests'));
  assert.ok(mode); mode.value = 'Quests'; await mode.emit('change'); return mode;
}

test('Quests search loads full activity progress, filters before the cap, and composes progress, readiness and text', async () => {
  const h = harness(), mode = await openQuestSearch(h);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=actor1');
  assert.equal(searchRows(h).length, 120); assert.ok(h.find('span', 'Page 1 of 2'));
  await questSearchChip(h, 'Not started').emit('click'); await flush();
  await questSearchChip(h, 'In progress').emit('click'); await flush();
  assert.deepEqual(searchLabels(h), ['New ready quest', 'Started ready quest', 'Started blocked quest']);
  await questSearchChip(h, 'Can do now').emit('click'); await flush();
  assert.deepEqual(searchLabels(h), ['New ready quest', 'Started ready quest']);
  const query = dialogNodes(h).find(node => node.type === 'search'); query.value = 'started'; await query.emit('input');
  const debounce = [...h.timers.values()].find(timer => timer.delay === 120); assert.ok(debounce); await debounce.action(); await flush();
  assert.deepEqual(searchLabels(h), ['Started ready quest']);
  h.context.questSearchSlim.tasks = [{ id: 'quest:blocked', label: 'Started blocked quest', category: 'Quest', status: 'blocked' }, { id: 'mining:test', label: 'Mining task', category: 'Mining', status: 'available' }];
  query.value = ''; mode.value = 'Tasks'; await mode.emit('change');
  // Quest filters belong to Quests mode; Tasks lists the compact task result unfiltered.
  assert.deepEqual(searchLabels(h), ['Started blocked quest', 'Mining task']);
  assert.equal(h.calls.length, 1, 'Filter and text changes reuse full evidence');
  assert.strictEqual(h.run('result'), h.context.questSearchSlim);
});

test('viewer quest search preferences persist through reload without gameplay commands', async () => {
  const entries = new Map(), localStorage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const h = viewerHarness({ localStorage }), before = h.snapshot(); await openQuestSearch(h);
  await questSearchChip(h, 'In progress').emit('click'); await flush();
  await questSearchChip(h, 'Can do now').emit('click'); await flush();
  const sort = dialogNodes(h).find(node => node.attributes['aria-label'] === 'Sort activities'); sort.value = 'level'; await sort.emit('change'); await flush();
  assert.deepEqual(searchLabels(h), ['Started ready quest']);
  assert.deepEqual(h.snapshot(), before); assert.ok(h.calls.every(call => !call.body && call.path.startsWith('/api/tasks?')));
  assert.deepEqual(JSON.parse(entries.get('rs3:activity-info-filters:v1'))['Quest search'].questStatuses, ['in-progress', 'can-do-now']);
  const fresh = viewerHarness({ localStorage }); await openQuestSearch(fresh);
  assert.deepEqual(searchLabels(fresh), ['Started ready quest']);
  assert.equal(questSearchChip(fresh, 'In progress').attributes['aria-pressed'], 'true');
  assert.equal(questSearchChip(fresh, 'Can do now').attributes['aria-pressed'], 'true');
  assert.equal(dialogNodes(fresh).find(node => node.attributes['aria-label'] === 'Sort activities').value, 'level');
  assert.ok(fresh.calls.every(call => !call.body));
});

test('quest search applies personal progress facts to source-only quest rows outside Activity Info groups', async () => {
  const h = harness(), full = questSearchResult();
  full.tasks.push({ id: 'quest:source-only', label: 'Quest in reachable partner chunks', category: 'Quest', status: 'available', obligation: false });
  full.activityInfo.questStates = { 'quest:source-only': { questStatus: 'not-started', canDoNow: true, level: 15 } };
  await openQuestSearch(h, full);
  await questSearchChip(h, 'Not started').emit('click'); await flush();
  await questSearchChip(h, 'Can do now').emit('click'); await flush();
  assert.deepEqual(searchLabels(h), ['New ready quest', 'Quest in reachable partner chunks']);
  assert.ok(h.calls.every(call => !call.body));
});

test('viewer Chunk Info quest contents use local progress chips without write controls', async () => {
  const h = viewerHarness(), full = questSearchResult();
  full.activityInfo.questStates = { 'quest:new': { questStatus: 'not-started', canDoNow: true, level: 5 },
    'quest:started': { questStatus: 'in-progress', canDoNow: false, level: 1 } };
  h.context.chunkQuestFull = full;
  h.run("chunkId='12850';fullResult=chunkQuestFull;document.getElementById('chunk-content').replaceChildren(chunkContents({Quest:{'New ready quest':1,'Started ready quest':2}},undefined,true))");
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nodes = () => walk(h.nodes.get('chunk-content'));
  const chip = text => nodes().find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const labels = () => nodes().filter(node => node.className === 'content-row').map(node => node.children[0].textContent);
  assert.deepEqual(labels(), ['New ready quest × 1', 'Started ready quest × 2']);
  await chip('Can do now').emit('click'); await flush();
  assert.deepEqual(labels(), ['New ready quest × 1']);
  assert.ok(nodes().some(node => node.textContent === '1 of 2 quests'));
  assert.ok(!nodes().some(node => /Backlog source|Use source|Save/.test(node.textContent)));
  assert.equal(h.calls.length, 0, 'the contents use current full evidence');
});

test('late quest progress evidence is rejected after changing member or revision', async () => {
  for (const change of ['member', 'revision']) {
    const h = harness(), response = deferred(); h.route(() => response.promise);
    h.context.questSearchSlim = { ...taskResult(7), format: 'play-v1' }; h.run('result=questSearchSlim;chunkSearch=[];searchDialog()');
    const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Quests'));
    mode.value = 'Quests'; const loading = mode.emit('change');
    h.run(change === 'member' ? "memberId='reed'" : 'state.revision++');
    response.resolve(questSearchResult()); await loading;
    assert.deepEqual(searchLabels(h), [], change);
    assert.strictEqual(h.run('result'), h.context.questSearchSlim);
    assert.equal(h.calls.length, 1);
  }
});

test('calculation details fetch full coverage and keep large diagnostic JSON lazy', async () => {
  const h = harness(), response = deferred(); h.run('state.members[0].preferences.advanced = true'); h.route(() => response.promise);
  h.context.slim = { ...taskResult(7), format: 'play-v1' }; h.run('result=slim');
  const opening = h.run('engineDetails()');
  assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=actor1');
  response.resolve({ ...taskResult(7), diagnostics: { retained: 'Full audit data' }, training: { Mining: { level: 10 } } }); await opening;
  const disclosure = h.all().find(node => node.tagName === 'DETAILS' && node.children.some(child => child.tagName === 'SUMMARY' && child.textContent === 'Data issues'));
  assert.ok(disclosure); assert.ok(!h.all().some(node => String(node.textContent).includes('Full audit data')));
  disclosure.open = true; await disclosure.emit('toggle');
  assert.ok(h.all().some(node => String(node.textContent).includes('Full audit data')));
});

test('calculation details show available stage timings and omit missing measurements', () => {
  const h = harness(); h.run('state.members[0].preferences.advanced = true'); h.context.timedResult = { ...taskResult(7), cache: { hit: true, requestMs: 1.7, timingMs: { engineMs: 101.2, collectionMs: 202.8, equipmentMs: 0, presentationMs: 9.3, totalMs: 350.6 } } };
  h.run('result = timedResult; engineDetails()');
  assert.ok(h.find('p', 'Request: 2 ms · Engine: 101 ms · Collections: 203 ms · Equipment: 0 ms · Presentation: 9 ms · Calculation total: 351 ms · Cached result'));
  h.context.timedResult = taskResult(7); h.run('result = timedResult; engineDetails()');
  assert.equal(h.nodes.get('dialog-title').textContent, 'Task calculation');
  assert.ok(!h.all().some(node => node.tagName === 'P' && /Request:|Calculation total:|NaN/.test(node.textContent)));
});

test('shift-click previews immediately and save acknowledgement retains server revision and undo', async () => {
  const h = harness(), acknowledgement = deferred(), baseline = h.snapshot();
  h.route(() => acknowledgement.promise);
  const saving = h.run("toggleChunk('12341')");
  assert.ok(h.map.members[0].unlocked.includes('12341'), 'Feedback precedes even the request microtask');
  assert.deepEqual(h.snapshot(), baseline); assert.equal(h.calls.length, 0);
  assert.equal(h.run('pendingChunkChanges.length'), 1);
  await flush(); assert.equal(h.calls[0].body.expectedRevision, 7);
  const next = structuredClone(baseline); next.revision = 8; next.members[0].unlocked.push('12341');
  next.history.push({ type: 'set-chunk', revision: 8, undo: { saved: true } });
  acknowledgement.resolve({ state: next, pools: {} }); await saving;
  assert.equal(h.run('state.revision'), 8); assert.equal(h.run('pendingChunkChanges.length'), 0);
  assert.ok(h.map.members[0].unlocked.includes('12341')); assert.equal(h.nodes.get('undo').disabled, false);
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

test('failed shift-click reverts only its preview and reports the unsaved chunk', async () => {
  const h = harness(), acknowledgement = deferred(), baseline = h.snapshot();
  h.route(() => acknowledgement.promise);
  const failed = assert.rejects(h.run("toggleChunk('12341')"), /Chunk 12341 was not saved.*preview was reverted.*Injected failure/);
  assert.ok(h.map.members[0].unlocked.includes('12341')); await flush();
  acknowledgement.resolve({ ok: false, status: 422, value: { message: 'Injected failure' } }); await failed;
  assert.deepEqual(h.snapshot(), baseline); assert.ok(!h.map.members[0].unlocked.includes('12341'));
  assert.equal(h.run('pendingChunkChanges.length'), 0); assert.equal(h.nodes.get('save-status').textContent, 'Change refused · review');
  assert.match(h.nodes.get('notice').children[0].textContent, /Chunk 12341 was not saved.*reverted/);
});

test('an ambiguous HTTP 500 retries the same optimistic action until one acknowledgement arrives', async () => {
  const h = harness(), acknowledgement = deferred(), retried = deferred(), baseline = h.snapshot();
  let attempts = 0;
  h.route(path => {
    assert.equal(path, '/api/command');
    if (++attempts === 1) return { ok: false, status: 500, value: { message: 'The save answer is uncertain.' } };
    retried.resolve();
    return acknowledgement.promise;
  });
  const saving = h.run("toggleChunk('12341')");
  await retried.promise;
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].options.body, h.calls[1].options.body, 'A transient failure cannot assign a fresh action identity');
  assert.equal(h.calls[1].body.requestId, 'v2.0.1.1');
  assert.equal(h.calls[1].body.requestAck, 0);
  assert.equal(h.calls[1].body.expectedRevision, 7);
  assert.deepEqual(h.snapshot(), baseline);
  assert.ok(h.map.members[0].unlocked.includes('12341'), 'The optimistic preview remains while confirmation is retried');
  assert.equal(h.run('pendingChunkChanges.length'), 1);
  assert.equal(h.run('hasPendingCommand()'), true);
  const next = structuredClone(baseline); next.revision = 8; next.members[0].unlocked.push('12341');
  next.history.push({ type: 'set-chunk', revision: 8, undo: { saved: true } });
  acknowledgement.resolve({ state: next, pools: {} }); await saving;
  assert.equal(h.run('state.revision'), 8);
  assert.equal(h.snapshot().history.filter(event => event.type === 'set-chunk').length, 1);
  assert.equal(h.run('pendingChunkChanges.length'), 0);
  assert.equal(h.run('hasPendingCommand()'), false);
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

test('conflicting shift-click preserves the remote map and undo history without retry', async () => {
  const h = harness(), acknowledgement = deferred(), next = h.snapshot();
  next.revision = 8; next.members[0].selected = ['12341']; next.members[1].unlocked = ['12342'];
  next.history.push({ type: 'set-chunk', revision: 8, undo: { remote: true } });
  h.route(() => acknowledgement.promise);
  const failed = assert.rejects(h.run("toggleChunk('12341')"), /not saved because another save arrived first.*shared state is loaded/);
  await flush(); acknowledgement.resolve({ ok: false, status: 409, value: { state: next, pools: {} } }); await failed;
  assert.deepEqual(h.snapshot(), next); assert.deepEqual(h.map.members, next.members);
  assert.equal(h.calls.length, 1); assert.equal(h.run('pendingChunkChanges.length'), 0);
  assert.equal(h.nodes.get('undo').disabled, false);
});

test('rapid repeated shift-clicks preview in order and use acknowledged revisions in the save queue', async () => {
  const h = harness(), first = deferred(), second = deferred(), baseline = h.snapshot();
  let requests = 0; h.route(() => ++requests === 1 ? first.promise : second.promise);
  const unlocking = h.run("toggleChunk('12341')"), locking = h.run("toggleChunk('12341')");
  assert.ok(!h.map.members[0].unlocked.includes('12341')); assert.deepEqual(h.snapshot(), baseline);
  await flush(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.command.status, 'unlocked');
  const unlocked = structuredClone(baseline); unlocked.revision = 8; unlocked.members[0].unlocked = ['12341'];
  first.resolve({ state: unlocked, pools: {} }); await unlocking; await flush();
  assert.ok(!h.map.members[0].unlocked.includes('12341'), 'Later preview survives the earlier acknowledgement');
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.command.status, 'locked'); assert.equal(h.calls[1].body.expectedRevision, 8);
  const locked = structuredClone(unlocked); locked.revision = 9; locked.members[0].unlocked = [];
  second.resolve({ state: locked, pools: {} }); await locking;
  assert.equal(h.run('state.revision'), 9); assert.equal(h.run('pendingChunkChanges.length'), 0); assert.deepEqual(h.map.members, locked.members);
});

test('a rejected preview preserves a later chunk edit and the queue continues from saved state', async () => {
  const h = harness(), first = deferred(), second = deferred(), baseline = h.snapshot();
  let requests = 0; h.route(() => ++requests === 1 ? first.promise : second.promise);
  const failed = assert.rejects(h.run("toggleChunk('12341')"), /preview was reverted/), saving = h.run("toggleChunk('12342')");
  assert.deepEqual([...h.map.members[0].unlocked], ['12341', '12342']); await flush();
  first.resolve({ ok: false, status: 422, value: { message: 'First save failed' } }); await failed; await flush();
  assert.deepEqual([...h.map.members[0].unlocked], ['12342']); assert.equal(h.calls[1].body.expectedRevision, 7);
  const next = structuredClone(baseline); next.revision = 8; next.members[0].unlocked = ['12342'];
  second.resolve({ state: next, pools: {} }); await saving;
  assert.deepEqual(h.snapshot(), next); assert.equal(h.run('pendingChunkChanges.length'), 0);
});

test('a save acknowledgement overtaken by remote state removes the preview without restoring old ownership', async () => {
  const h = harness(), acknowledgement = deferred(), baseline = h.snapshot(); h.route(() => acknowledgement.promise);
  const saving = h.run("toggleChunk('12341')"); await flush();
  const remote = structuredClone(baseline); remote.revision = 9; remote.members[0].blacklisted = ['12341']; h.adopt(remote);
  assert.ok(h.map.members[0].unlocked.includes('12341'));
  const saved = structuredClone(baseline); saved.revision = 8; saved.members[0].unlocked = ['12341'];
  acknowledgement.resolve({ state: saved, pools: {} }); await saving;
  assert.deepEqual(h.snapshot(), remote); assert.deepEqual(h.map.members, remote.members); assert.equal(h.run('pendingChunkChanges.length'), 0);
});

test('remote conflict and member switch preserve a later queued edit for its original player', async () => {
  const h = harness(), first = deferred(), second = deferred(), baseline = h.snapshot();
  let requests = 0; h.route(() => ++requests === 1 ? first.promise : second.promise);
  const failed = assert.rejects(h.run("toggleChunk('12341')"), /another save arrived first/), saving = h.run("toggleChunk('12342')");
  await flush(); h.run("memberId = 'reed'; renderState()");
  const remote = structuredClone(baseline); remote.revision = 8; remote.members[1].unlocked = ['12341'];
  first.resolve({ ok: false, status: 409, value: { state: remote, pools: {} } }); await failed; await flush();
  assert.equal(h.calls[1].body.expectedRevision, 8); assert.equal(h.calls[1].body.command.memberId, 'actor1');
  assert.deepEqual([...h.map.members[0].unlocked], ['12342']); assert.deepEqual([...h.map.members[1].unlocked], ['12341']);
  const next = structuredClone(remote); next.revision = 9; next.members[0].unlocked = ['12342'];
  second.resolve({ state: next, pools: {} }); await saving;
  assert.deepEqual(h.snapshot(), next); assert.equal(h.run('memberId'), 'reed'); assert.equal(h.run('pendingChunkChanges.length'), 0);
});

test('on-demand task loading aligns newer state before rendering and adoption clears outdated results', async () => {
  const h = harness(); h.route(path => { if (path.startsWith('/api/tasks')) return taskResult(8); const state = h.snapshot(); state.revision = 8; return { state, pools: {} }; });
  assert.equal((await h.run('ensureResult()')).stateRevision, 8); assert.equal(h.run('state.revision'), 8); assert.equal(h.calls.length, 2);
  const next = h.snapshot(); next.revision = 9; h.adopt(next); assert.equal(h.run('result'), undefined); assert.ok(h.renders.every(row => row.tasks === undefined || row.tasks === row.state));
});

test('reviewing a conflicting note cannot authorize overwriting a subsequent remote edit', async () => {
  const h = harness(); h.context.task = task; h.run('showTask(task)'); h.find('textarea').value = 'My draft';
  const first = h.snapshot(); first.revision = 8; first.members[0].taskStatus[task.id].note = 'First remote note'; h.adopt(first); await h.click('Save note');
  const second = h.snapshot(); second.revision = 9; second.members[0].taskStatus[task.id].note = 'Second remote note'; h.adopt(second); await h.click('Save my draft instead');
  assert.equal(h.calls.length, 0); assert.equal(h.find('textarea').value, 'My draft'); assert.equal(h.all().find(node => node.attributes['aria-label'] === 'Remote note').value, 'Second remote note');
});

test('state overtaking a task response clears stale tasks and schedules one fresh calculation', async () => {
  const h = harness(), response = deferred(); h.route(path => path.startsWith('/api/tasks') ? taskResult(8) : response.promise);
  const loading = h.run('loadTasks()'); await flush(); const next = h.snapshot(); next.revision = 9; h.adopt(next);
  const older = structuredClone(next); older.revision = 8; response.resolve({ state: older, pools: {} }); await loading;
  assert.equal(h.run('state.revision'), 9); assert.equal(h.run('result'), undefined); assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 1);
});

test('an overtaken on-demand result preserves the newest scheduled calculation', async () => {
  for (const overtaken of [true, false]) {
    const h = harness(), response = deferred(); h.route(path => path.startsWith('/api/tasks') ? taskResult(8) : response.promise);
    const loading = h.run('ensureResult()'); await flush(); const next = h.snapshot(); next.revision = 9; if (overtaken) h.adopt(next);
    const fetched = structuredClone(next); if (overtaken) fetched.revision = 8; response.resolve({ state: fetched, pools: {} }); await assert.rejects(loading, /changed while loading/);
    assert.equal(h.run('state.revision'), 9); assert.equal(h.run('result'), undefined); assert.equal([...h.timers.values()].filter(timer => timer.delay === 0).length, 1);
  }
});

test('task state synchronization cannot publish results after a member or request changes', async () => {
  for (const change of ["memberId = 'reed'", 'taskRequest++']) {
    const h = harness(), response = deferred(); h.route(path => path.startsWith('/api/tasks') ? taskResult(8) : response.promise);
    const loading = h.run('loadTasks()'); await flush(); h.run(change); const state = h.snapshot(); state.revision = 8; response.resolve({ state, pools: {} }); await loading;
    assert.equal(h.run('result'), undefined); assert.equal(h.run('state.revision'), 7);
  }
});

test('a delayed post-roll task popup cannot replace Settings opened during roll calculation', async () => {
  for (const stage of ['before', 'after']) {
    const h = harness(), response = deferred(); h.run('state.members[0].preferences.newTasks = true'); let calculations = 0;
    h.route(path => { if (!path.startsWith('/api/tasks')) return { state: { ...h.snapshot(), revision: 8 }, pools: {} }; calculations++; return calculations === (stage === 'before' ? 1 : 2) ? response.promise : taskResult(calculations === 1 ? 7 : 8); });
    const rolling = h.run("acceptRoll({ type: 'unlock-selection', memberId: 'actor1', chunkId: '12342' })"); await flush(); h.run('settingsPanels.settings()');
    response.resolve(taskResult(stage === 'before' ? 7 : 8)); await rolling; assert.equal(calculations, 2); assert.equal(h.nodes.get('dialog-title').textContent, 'Settings'); assert.equal(h.nodes.get('tool-dialog').open, true);
  }
});

test('current post-roll calculation still opens the new-task popup', async () => {
  const h = harness(); h.run('state.members[0].preferences.newTasks = true'); let calculations = 0;
  h.route(path => path.startsWith('/api/tasks') ? taskResult(++calculations === 1 ? 7 : 8) : { state: { ...h.snapshot(), revision: 8 }, pools: {} });
  await h.run("acceptRoll({ type: 'unlock-selection', memberId: 'actor1', chunkId: '12342' })"); assert.equal(h.nodes.get('dialog-title').textContent, 'New chunk tasks'); assert.equal(calculations, 2);
});

test('compact presentation IDs retain named new-task feedback after an unlock', async () => {
  const h = harness(); h.run('state.members[0].preferences.newTasks = true'); let calculations = 0;
  const nextTask = { ...task, id: 'custom:new-goal', label: 'New named goal' };
  h.route(path => path.startsWith('/api/tasks') ? ++calculations === 1 ? taskResult(7) : {
    ...taskResult(8), format: 'play-v1', tasks: [nextTask], presentation: { tasks: [{ id: nextTask.id }], alternatives: {} },
  } : { state: { ...h.snapshot(), revision: 8 }, pools: {} });
  await h.run("acceptRoll({ type:'unlock-selection',memberId:'actor1',chunkId:'12342' })");
  assert.ok(h.find('button', 'New named goal'));
  assert.ok(h.all().some(node => node.tagName === 'P' && /1 new task/.test(node.textContent)));
});

test('queued native close events after roll confirmation do not invalidate the roll popup', async () => {
  const h = harness(), response = deferred(); h.run("bindDialogLifecycle(); state.members[0].preferences = { newTasks: true, rollWarning: true, cinematicRoll: false }; statePools.actor1 = { eligible: [{ id: '12342' }] }"); let calculations = 0;
  h.route(path => path.startsWith('/api/tasks') ? ++calculations === 1 ? response.promise : taskResult(8) : { state: { ...h.snapshot(), revision: 8 }, pools: {} });
  await h.run('rollChunks(1)'); const rolling = h.click('Roll now'); await flush(); await h.nodes.get('tool-dialog').emit('close');
  response.resolve(taskResult(7)); await rolling; assert.equal(h.nodes.get('dialog-title').textContent, 'New chunk tasks'); assert.equal(calculations, 2);
});

test('native Escape and close-form submission invalidate dialog requests immediately', async () => {
  for (const event of ['cancel', 'submit']) {
    const h = harness(); h.run("bindDialogLifecycle(); openDialog('Review')"); const generation = h.run('dialogGeneration');
    await h.nodes.get(event === 'cancel' ? 'tool-dialog' : '.dialog-header').emit(event); assert.equal(h.run('dialogGeneration'), generation + 1);
    h.nodes.get('tool-dialog').close(); await h.nodes.get('tool-dialog').emit('close'); assert.equal(h.run('dialogGeneration'), generation + 1);
  }
});

test('delayed predictions, migration reports and retained-backup lists cannot replace newer dialog content', async () => {
  for (const operation of ['prediction', 'migration', 'backups']) {
    const h = harness(), response = deferred(); h.route(() => response.promise);
    let pending;
    // Predictions now render inside the chunk panel's "If unlocked" tab, never into a dialog.
    if (operation === 'prediction') { h.run("chunkTab = 'unlock'; showChunk('12341')"); pending = flush(); }
    else { if (operation === 'migration') h.run('state.members[0].preferences.advanced = true'); h.run('backupDialog()'); pending = h.click(operation === 'migration' ? 'View migration report' : 'Browse previous saves'); }
    await flush(); h.run('settingsPanels.settings()'); const content = h.nodes.get('dialog-content').children[0];
    response.resolve(operation === 'prediction' ? { delta: { tasksAdded: [], itemsAdded: [], areasAdded: [] } } : operation === 'backups' ? { backups: [] } : {}); await pending;
    assert.equal(h.nodes.get('dialog-title').textContent, 'Settings', operation); assert.equal(h.nodes.get('dialog-content').children[0], content);
  }
});

test('Preview tab ignores delayed predictions after the revision or player changes', async () => {
  for (const change of ['revision', 'member']) {
    const h = harness(), response = deferred(); let requests = 0;
    const prediction = (memberId, stateRevision) => ({ memberId, stateRevision, delta: { tasksAdded: [{ label: 'Current task', category: 'Skill' }], itemsAdded: [], areasAdded: [] } });
    h.route(() => ++requests === 1 ? response.promise : prediction(h.run('memberId'), h.run('state.revision')));
    h.run("chunkTab = 'unlock'; showChunk('12341')"); await flush();
    if (change === 'revision') { const next = h.snapshot(); next.revision = 8; h.adopt(next); }
    else h.run("memberId = 'reed'; renderState()");
    await flush();
    response.resolve(prediction('actor1', 7)); await flush(); await flush();
    // The open panel re-rendered for the current map and asked again; the stale answer never lands.
    assert.ok(requests >= 2, change);
    assert.ok(h.calls.at(-1).path.includes(`memberId=${h.run('memberId')}`));
    assert.ok(h.find('p', '1 new possible task'), change);
    assert.ok(h.find('li', 'Current task'));
  }
});

test('Preview tab shows a prediction only when it names the current player and revision', async () => {
  for (const identity of [{ memberId: 'reed', stateRevision: 7 }, { memberId: 'actor1', stateRevision: 8 }, {}]) {
    const h = harness(); h.route(async () => ({ ...identity, delta: { tasksAdded: [], itemsAdded: [], areasAdded: [] } }));
    h.run("chunkTab = 'unlock'; showChunk('12341')"); await flush(); await flush();
    assert.ok(h.find('button', 'Recalculate'), JSON.stringify(identity)); assert.ok(!h.find('p', 'No new possible tasks'));
  }
});

test('async task, unpick, teleport and history saves cannot close or refresh a newer dialog', async () => {
  for (const [open, action] of [['customTaskDialog()', 'Add task'], ['unpickDialog()', 'Forfeit one chunk'], ['teleportsDialog()', 'Add teleport'], ['renderHistory(state.history)', 'Undo most recent change']]) {
    const h = harness(), response = deferred();
    h.route(path => path.startsWith('/api/teleports?') ? { memberId: 'actor1', stateRevision: 7, automatic: false, rows: [] } : response.promise);
    h.run(open);
    if (action === 'Add teleport') {
      h.all().find(node => node.placeholder === 'Teleport name').value = 'Test route';
      h.all().find(node => node.placeholder === 'Destination chunk ID').value = '12341';
    }
    const saving = h.click(action); await flush();
    if (action === 'Add teleport') assert.equal(h.calls.find(call => call.path === '/api/command')?.body.command.type, 'set-teleport');
    h.run('settingsPanels.settings()');
    const state = h.snapshot(); state.revision = 8; response.resolve({ state, pools: {} }); await saving;
    assert.equal(h.nodes.get('dialog-title').textContent, 'Settings', open); assert.equal(h.nodes.get('tool-dialog').open, true);
  }
});

test('import previews and applies retain the newer dialog while still adopting an authorized save', async () => {
  const preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
  for (const stage of ['preview', 'apply']) {
    const h = harness(), response = deferred(); h.run('backupDialog()'); h.all().find(node => node.type === 'file').files = [new File([JSON.stringify({ format: 'rs3-chunk-picker', state: h.snapshot() })], 'fixture.json')];
    h.route(path => stage === 'apply' && path.endsWith('/preview') ? { preview } : response.promise);
    let saving = h.click('Preview import / restore'); await flush(); if (stage === 'apply') { await saving; saving = h.click('Apply reviewed replacement'); await flush(); }
    h.run('settingsPanels.settings()'); const state = h.snapshot(); state.revision = 8; response.resolve(stage === 'preview' ? { preview } : { state, pools: {} }); await saving;
    assert.equal(h.nodes.get('dialog-title').textContent, 'Settings'); assert.equal(h.nodes.get('tool-dialog').open, true); assert.equal(h.run('state.revision'), stage === 'apply' ? 8 : 7);
  }
});

test('rule-profile reading and applies cannot replace or close a newer dialog', async () => {
  for (const stage of ['read', 'apply']) {
    const h = harness(), response = deferred(); h.run('rulesDialog()'); const file = h.all().find(node => node.type === 'file');
    file.files = [{ size: 10, text: () => stage === 'read' ? response.promise : Promise.resolve('{"rules":{},"taskRules":{}}') }];
    h.route(path => path.endsWith('/preview') ? { stateRevision: 7 } : response.promise);
    let pending = file.emit('change'); await flush(); if (stage === 'apply') { await pending; pending = h.click('Apply profile'); await flush(); }
    h.run('settingsPanels.settings()'); const state = h.snapshot(); state.revision = 8; response.resolve(stage === 'read' ? '{"rules":{},"taskRules":{}}' : { state, pools: {} }); await pending;
    assert.equal(h.nodes.get('dialog-title').textContent, 'Settings'); assert.equal(h.nodes.get('tool-dialog').open, true);
  }
});

test('browsing retained backups keeps a reviewed restore usable and normal apply feedback intact', async () => {
  const h = harness(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] }; h.run('backupDialog()');
  h.all().find(node => node.type === 'file').files = [new File([JSON.stringify({ format: 'rs3-chunk-picker', state: h.snapshot() })], 'fixture.json')];
  h.route(path => path.endsWith('/preview') ? { preview } : path === '/api/backups' ? { backups: [] } : { state: { ...h.snapshot(), revision: 8 }, pools: {} });
  await h.click('Preview import / restore'); await h.click('Browse previous saves'); await h.click('Apply reviewed replacement');
  assert.equal(h.nodes.get('tool-dialog').open, false); assert.equal(h.run('state.revision'), 8); assert.ok(h.find('span', 'Import saved. Your imported records and previous save are kept in the backup.'));
});

test('retained saves preview and apply by ID with revision checks for both restore scopes', async () => {
  for (const memberId of ['', 'reed']) {
    const h = harness(), incoming = h.snapshot(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
    h.run('backupDialog()');
    h.route(path => path === '/api/backups' ? { backups: [{ id: 'snapshot-7.json.gz', revision: 7, at: '2026-10-12T12:00:00Z', bytes: 8192 }] }
      : path.endsWith('/preview') ? { preview, state: incoming } : { state: { ...incoming, revision: 8 }, pools: {} });
    if (memberId) h.all().find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === memberId)).value = memberId;
    await h.click('Browse previous saves'); await h.click('Preview selected snapshot');
    const route = memberId ? '/api/member-restore' : '/api/restore', previewCall = h.calls.find(call => call.path === `${route}/preview`);
    assert.deepEqual(JSON.parse(JSON.stringify(previewCall.body)), { backupId: 'snapshot-7.json.gz', ...(memberId ? { memberId } : {}) });
    assert.ok(h.find('h3', 'Review replacement'));
    await h.click('Apply reviewed replacement');
    const applyCall = h.calls.find(call => call.path === route);
    assert.deepEqual(JSON.parse(JSON.stringify(applyCall.body)), { backupId: 'snapshot-7.json.gz', ...(memberId ? { memberId } : {}), expectedRevision: 7 });
    assert.equal(h.calls.some(call => call.path.startsWith('/api/backups/')), false);
    assert.equal(h.run('state.revision'), 8);
  }
});

test('a picker owner restores the whole save and is told Undo cannot reverse it', async () => {
  const h = harness(), incoming = h.snapshot(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
  h.run("sessionAdmin = false; sessionMember = 'reed'; panelContext.account = { isOwner: () => true }; backupDialog()");
  const text = () => h.all().filter(node => typeof node === 'object').map(node => node.textContent).join('\n');
  assert.match(text(), /replaces this whole picker/); assert.doesNotMatch(text(), /replaces only/);
  h.route(path => path === '/api/backups' ? { backups: [{ id: 'snapshot-7.json.gz', revision: 7, at: '2026-10-12T12:00:00Z', bytes: 8192 }] }
    : path.endsWith('/preview') ? { preview, state: incoming } : { state: { ...incoming, revision: 8 }, pools: {} });
  await h.click('Browse previous saves'); await h.click('Preview selected snapshot');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(call => call.path === '/api/restore/preview').body)), { backupId: 'snapshot-7.json.gz' });
  assert.match(text(), /Undo can’t reverse it/); assert.doesNotMatch(text(), /Undo can reverse/);
  await h.click('Apply reviewed replacement');
  assert.ok(h.find('span', 'Backup restored. The previous save is under Browse previous saves.'));
});

test('changing the retained save or restore scope invalidates pending and completed previews', async () => {
  for (const changed of ['save', 'scope']) {
    const h = harness(), pending = deferred(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
    h.run('backupDialog()');
    h.route(path => path === '/api/backups' ? { backups: ['snapshot-a', 'snapshot-b'].map(id => ({ id, revision: 7, at: '2026-10-12T12:00:00Z', bytes: 8192 })) } : pending.promise);
    await h.click('Browse previous saves');
    const control = h.all().find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === (changed === 'save' ? 'snapshot-a' : 'reed')));
    const loading = h.click('Preview selected snapshot'); await flush();
    control.value = changed === 'save' ? 'snapshot-b' : 'reed'; await control.emit('change');
    pending.resolve({ preview, state: h.snapshot() }); await loading;
    assert.equal(h.find('button', 'Apply reviewed replacement'), undefined);
    await h.click('Preview selected snapshot'); assert.ok(h.find('button', 'Apply reviewed replacement'));
    control.value = changed === 'save' ? 'snapshot-a' : ''; await control.emit('change');
    assert.equal(h.find('button', 'Apply reviewed replacement'), undefined);
  }
});


test('task details reuse source evidence for singular and plural locations and method navigation', async () => {
  const h = harness(), method = { ...task, id: 'custom:method', label: 'Source method' };
  h.context.evidenceTask = { ...task, sources: [{ source: 'Declared source', location: '12341', locations: ['12341', '12342-1'], taskId: method.id, probability: 0.5, rate: '1/2', quantity: 2 }] };
  h.context.evidenceResult = { ...taskResult(7), tasks: [method] }; h.run('result = evidenceResult; showTask(evidenceTask)');
  assert.equal(h.all().filter(node => node.textContent === 'View location Chunk 12341').length, 1); assert.ok(h.find('button', 'View location Chunk 12342'));
  await h.click('View source method: Source method'); assert.equal(h.nodes.get('dialog-title').textContent, 'Source method');
});

test('a partner-only source method retains reviewed player controls and commands through navigation', async () => {
  const h = harness(), state = h.snapshot(), method = { ...task, id: 'custom:partner-method', label: 'Reed source method' };
  state.members[0].taskStatus[method.id] = { challengeCompleted: false };
  state.members[1].taskStatus = { [method.id]: { challengeCompleted: true, backlogged: true, backlogReason: 'Reed method backlog' } };
  state.members[1].completedTasks = [method.id]; h.adopt(state);
  h.context.partnerSourceTask = { ...task, sources: [{ source: 'Partner source', taskId: method.id }] };
  h.context.partnerMethodResult = { ...taskResult(7), memberId: 'reed', tasks: [h.context.partnerSourceTask, method], presentation: { tasks: [h.context.partnerSourceTask, method], alternatives: {} } };
  let returned = 0; h.context.partnerReturn = () => { returned++; };
  h.run("result = { ...partnerMethodResult, memberId:'actor1', tasks:[], presentation:{tasks:[], alternatives:{}} }; showTask(partnerSourceTask, true, {memberId:'reed', result:partnerMethodResult, onReturn:partnerReturn})");
  await h.click('View source method: Reed source method'); assert.equal(h.nodes.get('dialog-title').textContent, method.label);
  const checkbox = text => h.all().find(node => node.tagName === 'LABEL' && node.children.some(child => child.tagName === 'TEXT' && child.textContent === text))?.children[0];
  const done = checkbox('Counts for our chunk challenge · Reed'), personal = checkbox('Reed did this in-game personally');
  assert.equal(done?.checked, true); assert.equal(personal?.checked, true); assert.ok(!checkbox('Counts for our chunk challenge · Player'));
  assert.ok(h.find('p', 'Backlogged: Reed method backlog'));
  done.checked = false; await done.emit('change'); assert.deepEqual(h.calls.at(-1).body.command, { type: 'set-task-status', memberId: 'reed', taskId: method.id, challengeCompleted: false });
  personal.checked = false; await personal.emit('change'); assert.deepEqual(h.calls.at(-1).body.command, { type: 'complete-task', memberId: 'reed', taskId: method.id, completed: false });
  assert.equal(h.run('memberId'), 'actor1'); assert.equal(h.snapshot().members[0].taskStatus[method.id].challengeCompleted, false);
  await h.click('Back to Completed Tasks'); assert.equal(returned, 1, 'Nested source methods retain the original completed-panel return callback');
});

test('equipment task dialog uses declared stats and selected comparison evidence', () => {
  const h = harness(); h.run('state.members[0].preferences.advanced = true');
  h.context.gearTask = { ...task, id: 'rs3:goal:equipment:cape', label: 'Obtain a Team-1 cape', category: 'BiS', equipmentName: 'Team-1 cape' };
  h.context.gearResult = { ...taskResult(7), tasks: [h.context.gearTask], equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', equipment: { name: 'Team-1 cape' }, score: [2], comparison: 'Armour is ranked before life points.' }] } };
  h.run("definitions.equipment = { 'Team-1 cape': { slot: 'back', class: 'all', tier: 1, armour: 2, lp: 0 } }; fullResult = gearResult; showTask(gearTask, true)");
  assert.ok(h.find('h3', 'Team-1 cape')); assert.ok(h.find('dt', 'Armour')); assert.ok(h.find('dd', '2')); assert.equal(h.find('dd', '0'), undefined);
  assert.ok(h.find('p', 'Any style · Back slot · Tier 1')); assert.ok(h.find('p', 'Best back item for Melee.'));
  assert.ok(h.find('h3', 'Why this is BiS'));
  const how = h.all().find(node => node.tagName === 'DETAILS' && node.children[0]?.textContent === 'How it’s ranked');
  assert.ok(how); assert.ok(!how.open); assert.ok(how.children.includes(h.find('p', 'Armour is ranked before life points.')));
});

test('imported method preferences are saved choices and explicit automatic reset masks them', () => {
  const h = harness(), chosen = { ...task, id: 'custom:method-a', label: 'Burn logs', category: 'Firemaking', level: 15 }, peer = { ...chosen, id: 'custom:method-b', label: 'Burn oak logs' };
  h.context.chosen = chosen;
  h.context.methodsResult = { ...taskResult(7), tasks: [chosen, peer], training: { Firemaking: {} }, presentation: { tasks: [chosen], alternatives: { [chosen.id]: [peer.id] }, effectiveLevels: { [chosen.id]: 15 } } };
  h.run("member().sourceMapId = 'bbb'; state.legacy = { maps: { bbb: { chunkinfo: { altChallenges: { Firemaking: { '15': 'Burn logs' } } } } } }; fullResult = methodsResult; showTask(chosen, true)");
  assert.ok(h.find('span', 'Saved choice')); assert.equal(h.find('button', 'Choose automatically').disabled, false);
  h.run("member().taskAlternatives = { Firemaking: { '15': null } }; showTask(chosen, true)");
  assert.ok(h.find('span', 'Automatic choice')); assert.equal(h.find('button', 'Choose automatically').disabled, true);
  h.context.peer = peer; h.run('showTask(peer, true)');
  assert.ok(h.find('span', 'Active choice')); assert.ok(h.find('span', 'Burn logs')); assert.ok(h.find('span', 'Burn oak logs'));
});

test('task hover hydrates once, shares cached detail with the popup and preserves compact sidebar', async () => {
  const h = harness(), compactTask = { id: 'rs3:task:hover', label: 'Hover goal', category: 'Extra', status: 'available' };
  h.context.hoverTask = compactTask; h.context.compact = { ...taskResult(7), format: 'play-v1', tasks: [compactTask] };
  h.context.innerWidth = 1440; h.context.innerHeight = 900;
  h.run("document.getElementById('group-view').checked = false; document.body = document.getElementById('test-body'); result = compact; definitionsAreFull = false; const hoverRow = taskRow(hoverTask); hoverRow.connected = true; hoverRow.getBoundingClientRect = () => ({ left: 1000, right: 1400, top: 300, bottom: 345 }); taskHover.element.getBoundingClientRect = () => ({ width: 320, height: 200 }); document.body.append(hoverRow)");
  const row = h.nodes.get('test-body').children.find(node => node.className === 'task-row');
  h.route(path => path === '/api/definitions' ? { ...h.run('definitions'), equipment: {} } : { ...taskResult(7), tasks: [{ ...compactTask, record: { Description: 'Useful description from full evidence.' } }] });
  await row.emit('pointerenter', { pointerType: 'mouse' }); assert.equal(h.calls.length, 0);
  const reveal = async () => { const timer = [...h.timers.values()].find(timer => timer.delay === 250); assert.ok(timer); await timer.action(); };
  await reveal(); assert.equal(h.calls.filter(call => call.path.startsWith('/api/tasks?')).length, 1); assert.equal(h.run('result.format'), 'play-v1');
  await row.emit('pointerleave', { pointerType: 'mouse' }); await row.emit('pointerenter', { pointerType: 'mouse' }); await reveal();
  await h.run('showTask(hoverTask)'); assert.equal(h.calls.length, 2, 'One task detail request and one definitions request serve later hovers and the dialog');
  assert.ok(h.find('p', 'Useful description from full evidence.')); assert.equal(h.run('taskHover.element.hidden'), true);
});

test('task popup opens at once from the slim list and fills in sources when full details arrive', async () => {
  const h = harness(), response = deferred();
  const slim = { ...taskResult(7), format: 'play-v1', tasks: [{ ...task, id: 'rs3:task:detail', label: 'Compact row', description: 'Defeat the Chaos Elemental 25 times.' }] };
  h.context.slim = slim; h.run('result = slim');
  h.route(() => response.promise);
  h.run('showTask(result.tasks[0])'); await flush();
  assert.ok(h.find('p', 'Defeat the Chaos Elemental 25 times.'), 'what the task asks shows immediately');
  assert.ok(h.all().some(node => /^Counts for our chunk challenge · /.test(node.textContent ?? '')), 'controls are usable before details load');
  assert.ok(h.find('p', 'Loading sources and details…'));
  response.resolve({ ...taskResult(7), tasks: [{ ...slim.tasks[0], explanation: 'Full evidence', sources: [{ kind: 'shop', source: 'Fixture shop', item: 'Thing' }], record: { Description: 'Defeat the Chaos Elemental 25 times.' } }] });
  await flush(); await flush();
  assert.ok(!h.find('p', 'Loading sources and details…'), 'placeholder replaced');
  assert.ok(h.find('p', 'Full evidence'));
  assert.ok(h.all().some(node => node.tagName === 'SUMMARY' && node.textContent === 'Sources and locations'));
});

test('cached selected owner popup hydrates full evidence during a member switch before foreground publication', async () => {
  const h = harness(), fixture = duoFixture(h); h.route(async () => fixture.reed); await enableDuo(h);
  const full = { ...fixture.reed, format: undefined, tasks: fixture.reed.tasks.map(row => row.id === fixture.partner.id ? { ...row,
    record: { Description: 'Switched Reed full evidence' }, sources: [{ kind: 'spawn', name: 'Reed rock', location: '12342' }], explanation: 'Reed current sources' } : row) };
  h.run("memberId = 'reed'; result = fullResult = undefined; definitionsAreFull = true; renderTasks()");
  assert.ok(activeLabels(h).includes('Reed goal'));
  h.context.switchSourceOwner = undefined;
  h.run('const switchedSourceView = sourceView; sourceView = (sources, sourceResult) => { switchSourceOwner = sourceResult?.memberId; return switchedSourceView(sources, sourceResult); }');
  h.route(async path => { assert.equal(path, '/api/tasks?memberId=reed'); return full; });
  await h.click('Reed goal'); await flush(); await h.run('fullResultRequest?.promise'); await flush();
  assert.ok(h.find('p', 'Switched Reed full evidence')); assert.ok(h.find('p', 'Reed current sources'));
  assert.equal(h.context.switchSourceOwner, 'reed');
  assert.ok(h.calls.some(call => call.requestPath === '/api/tasks?memberId=reed'));
  assert.equal(h.run('result'), undefined, 'full evidence does not publish as foreground compact results');
});

test('duo selection memo retains unchanged projections and invalidates filters, saved facts and pair readiness', async () => {
  const h = harness(), fixture = duoFixture(h); h.route(async () => fixture.reed); await enableDuo(h);
  h.run("duoInspectionResults().remember({...actor1Result, projection:'duo-inspection-v1'}); duoInspectionResults().remember({...reedResult, projection:'duo-inspection-v1'})");
  const select = h.context.selectDuoTasks; let selections = 0;
  h.context.selectDuoTasks = args => { selections++; return select(args); };
  // Starting search broadens the catalogue once; subsequent text uses that union.
  h.run("document.getElementById('task-filter').value = 'goal'; renderTasks(); renderTasks()");
  assert.equal(selections, 1);
  h.run("document.getElementById('task-filter').value = 'shared'; renderTasks()"); assert.equal(selections, 1);
  await h.click('Both'); assert.equal(selections, 2);
  h.run("document.getElementById('hide-completed').checked = false; renderTasks()"); assert.equal(selections, 3);
  const next = h.snapshot(); next.revision = 8;
  next.members[0].taskStatus = { [fixture.shared.id]: { backlogged: true } };
  next.members[1].taskStatus = { [fixture.shared.id]: { challengeCompleted: true } };
  h.adopt(next); assert.equal(selections, 4); h.run('renderTasks()'); assert.equal(selections, 4, 'unchanged stale pair reuses its projection');
  assert.deepEqual(activeLabels(h), [], 'saved backlog changes ownership immediately and Both no longer matches');
  h.context.freshPlayer = { ...fixture.actor1, stateRevision: 8 };
  h.context.freshReed = { ...fixture.reed, stateRevision: 8 };
  h.run("duoResults().remember(freshPlayer); duoResults().remember(freshReed); duoInspectionResults().remember({...freshPlayer,projection:'duo-inspection-v1'}); duoInspectionResults().remember({...freshReed,projection:'duo-inspection-v1'}); renderTasks()");
  assert.equal(selections, 5, 'stale display becoming ready invalidates even at the same saved revision');
  await h.click('All'); assert.equal(selections, 6); assert.deepEqual(activeLabels(h), ['Shared goal']);
  assert.ok(h.all().some(node => node.textContent === 'Done by Reed'));
  h.run('memberId = "reed"; renderTasks()'); assert.equal(selections, 7);
});

test('duo popup uses canonical commands but an inspected alternative drops the original union identity', async () => {
  const h = harness(), alias = { id: 'custom:historical', label: 'Aliased goal', category: 'Custom', status: 'available' };
  const alternative = { ...alias, id: 'custom:alternative', label: 'Alternative goal' };
  const entry = { id: 'custom:canonical', label: 'Both', memberIds: ['actor1', 'reed'], tasksByMember: { actor1: alias, reed: alias } };
  h.context.identityTask = alias; h.context.identityEntry = entry; h.context.identityAlternative = alternative;
  let returned = 0; h.context.identityReturn = () => { returned++; };
  h.run("state.members[1].taskStatus = { 'custom:canonical': { note: 'Canonical Reed note' } }; showTask(identityTask, false, {memberId:'reed', duoEntry:identityEntry, onReturn:identityReturn})");
  const note = h.all().find(node => node.tagName === 'TEXTAREA' && node.value === 'Canonical Reed note'); assert.ok(note); note.value = 'Canonical note updated';
  await h.click('Save note');
  let saved = h.calls.find(call => call.body?.command.note === 'Canonical note updated');
  assert.equal(saved.body.command.memberId, 'reed'); assert.equal(saved.body.command.taskId, entry.id);
  for (const text of ['Counts for our chunk challenge · Reed', 'Reed did this in-game personally', 'Pin to the top of the list']) {
    const checkbox = dialogNodes(h).find(node => node.tagName === 'LABEL' && node.children.some(child => child.tagName === 'TEXT' && child.textContent === text))?.children[0];
    assert.ok(checkbox, text); checkbox.checked = true; await checkbox.emit('change');
    assert.equal(h.calls.at(-1).body.command.memberId, 'reed'); assert.equal(h.calls.at(-1).body.command.taskId, entry.id);
  }
  await h.click('View for Player');
  assert.ok(dialogNodes(h).some(node => node.tagName === 'TEXT' && node.textContent === 'Counts for our chunk challenge · Player'));
  await h.click('Back to Completed Tasks'); assert.equal(returned, 1, 'the owner switch preserves the original return action');
  h.run("showTask(identityAlternative, true, {memberId:'reed', duoEntry:identityEntry, onReturn:identityReturn})");
  assert.equal(h.all().some(node => node.className === 'duo-task-dialog-owners'), false, 'another task must not retain the original Both owner switcher');
  const otherNote = h.all().find(node => node.tagName === 'TEXTAREA'); otherNote.value = 'Alternative Reed note'; await h.click('Save note');
  saved = h.calls.find(call => call.body?.command.note === 'Alternative Reed note');
  assert.equal(saved.body.command.memberId, 'reed'); assert.equal(saved.body.command.taskId, alternative.id);
  await h.click('Back to Completed Tasks'); assert.equal(returned, 2, 'identity rejection retains the independent return action');
});


for (const order of ['selected-first', 'partner-first']) test('duo publication renders once after complete ' + order + ' responses', async () => {
  const h = harness(), fixture = duoFixture(h), selected = deferred(), peer = deferred();
  h.run("result = undefined; shownResult = undefined; document.getElementById('group-view').checked = true");
  h.context.__rs3Perf = { enabled: true, events: [] }; h.context.performance = { now: () => 0, mark() {} };
  h.route(path => path === '/api/tasks?memberId=actor1' ? selected.promise : peer.promise);
  const ownLoading = h.run('ensureResult()'); await flush(); const peerLoading = h.run('duoLoading.promise');
  if (order === 'selected-first') { selected.resolve(fixture.actor1); await ownLoading; await flush(); }
  const beforePeer = h.renders.length; peer.resolve(fixture.reed); await peerLoading; await flush();
  assert.equal(h.renders.length - beforePeer, order === 'selected-first' ? 1 : 0, 'no duplicate finally render or incomplete partner-first render');
  if (order === 'partner-first') {
    assert.equal(h.context.__rs3Perf.events.some(event => event.name === 'duo-tasks-shown'), false);
    const beforeSelected = h.renders.length; selected.resolve(fixture.actor1); await ownLoading; await flush();
    assert.equal(h.renders.length - beforeSelected, 1);
  }
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.context.__rs3Perf.events.filter(event => event.name === 'duo-tasks-shown').length, 1);
  await h.click('Both'); assert.deepEqual(activeLabels(h), ['Shared goal']);
  h.run("document.getElementById('group-view').checked = false; renderTasks()");
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal']);
});

test('legacy duo note copies to the canonical destination and protects a real canonical remote edit', async () => {
  const setup = () => {
    const h = harness(), alias = { id: 'custom:legacy-note', label: 'Legacy note goal', category: 'Custom', status: 'available' };
    h.context.legacyNoteTask = alias;
    h.context.legacyNoteEntry = { id: 'custom:canonical-note', label: 'Reed', memberIds: ['reed'], tasksByMember: { reed: alias } };
    h.run("state.members[1].taskStatus = { 'custom:legacy-note': { note: 'Imported Reed note' } }; showTask(legacyNoteTask, false, {memberId:'reed', duoEntry:legacyNoteEntry})");
    return h;
  };
  const h = setup(), draft = h.all().find(node => node.tagName === 'TEXTAREA' && node.value === 'Imported Reed note');
  assert.ok(draft); draft.value = 'Reviewed canonical Reed note'; await h.click('Save note');
  const saved = h.calls.find(call => call.body?.command.note === draft.value); assert.ok(saved);
  assert.equal(saved.body.command.taskId, 'custom:canonical-note'); assert.equal(saved.body.command.memberId, 'reed'); assert.equal(saved.body.expectedRevision, 7);
  assert.equal(h.run("state.members[1].taskStatus['custom:legacy-note'].note"), 'Imported Reed note');
  assert.equal(h.run("state.members[1].taskStatus['custom:canonical-note'].note"), draft.value);
  const changed = setup(), guardedDraft = changed.all().find(node => node.tagName === 'TEXTAREA' && node.value === 'Imported Reed note');
  guardedDraft.value = 'My canonical draft';
  changed.run("state.revision = 8; state.members[1].taskStatus['custom:canonical-note'] = { note: 'Actual canonical remote edit' }");
  await changed.click('Save note');
  assert.equal(changed.calls.filter(call => call.body?.command).length, 0);
  assert.ok(changed.all().some(node => node.attributes?.['aria-label'] === 'Remote note' && node.value === 'Actual canonical remote edit'));
  assert.equal(guardedDraft.value, 'My canonical draft'); assert.ok(changed.find('button', 'Save my draft instead'));
});


test('group foreground uses the explicit thin projection and restores cached normal personal rows immediately', async () => {
  const h = harness(), f = duoFixture(h);
  h.route(path => path.includes('reed') ? f.reed : f.actor1);
  await h.run('loadTasks()');
  assert.equal(h.calls[0].requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared] };
  h.context.thinResult = thin;
  h.route(path => path.includes('reed') ? f.reed : thin);
  h.run("document.getElementById('group-view').checked = true");
  await h.run('loadTasks()'); await flush();
  assert.ok(h.calls.some(call => call.requestPath === '/api/tasks?memberId=actor1&view=play-v1&projection=duo-sidebar-v1&revision=7'));
  assert.equal(h.run('result.projection'), 'duo-sidebar-v1');
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  const count = h.calls.length;
  h.route(() => f.actor1);
  h.run("document.getElementById('show-all').checked = true; document.getElementById('show-blocked').checked = true; document.getElementById('group-view').checked = false; renderTasks()");
  assert.equal(h.run('result.projection'), undefined);
  assert.equal(h.run('result'), f.actor1);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal', 'Unpresented goal']);
  assert.equal(h.calls.length, count + 1);
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  assert.equal(h.nodes.get('show-all').checked, true); assert.equal(h.nodes.get('show-blocked').checked, true);
  assert.equal(await h.run('ensureResult()'), f.actor1);
});

test('Group OFF keeps cached Personal rows and resets the server gate before planning while a peer is pending', async () => {
  const h = harness(), f = duoFixture(h), peer = deferred(), normal = deferred();
  h.route(() => f.actor1); await h.run('loadTasks()');
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared] };
  h.route(path => path.includes('reed') ? peer.promise : thin);
  h.run("document.getElementById('group-view').checked = true"); await h.run('loadTasks()');
  assert.equal(h.run('duoRowsReady'), false); assert.equal(h.run('result.projection'), 'duo-sidebar-v1');
  h.route(path => path.startsWith('/api/chunk-planning?') ? planningResult() : normal.promise);
  const count = h.calls.length;
  h.run("document.getElementById('group-view').checked = false; renderTasks(); renderTasks(); chunkId = '12341'; document.getElementById('chunk-info').hidden = false");
  assert.equal(h.run('result'), f.actor1, 'cached selected rows remain visible');
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal']);
  assert.equal(h.calls.length, count + 1, 'OFF registers one coalesced Personal request');
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  const planning = h.run("ensurePlanningResult('12341')"), death = h.run("advisoryApi('/api/death-estimates?memberId=actor1&chunkId=12341')");
  await flush(); assert.ok(!h.calls.some(call => call.path.startsWith('/api/chunk-planning?'))); assert.equal(h.deathCalls.length, 0);
  normal.resolve(f.actor1); await Promise.all([planning, death]);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/chunk-planning?')).length, 1);
  assert.equal(h.deathCalls.length, 1);
  peer.resolve(f.reed); await h.run('duoLoading?.promise'); await flush();
  assert.equal(h.run('result'), f.actor1); assert.equal(h.calls.filter(call => call.requestPath === '/api/tasks?memberId=actor1&view=play-v1').length, 2);
});

for (const order of ['thin-first', 'normal-first']) test(`group OFF cancels pending thin foreground and ignores its late ${order} response`, async () => {
  const h = harness(), f = duoFixture(h), thinResponse = deferred(), normalResponse = deferred();
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared] };
  h.run("result = undefined; shownResult = undefined; document.getElementById('group-view').checked = true");
  h.route(path => path.includes('reed') ? f.reed : h.calls.at(-1).requestPath.includes('projection=') ? thinResponse.promise : normalResponse.promise);
  const oldLoad = h.run('loadTasks()'); await flush();
  const signal = h.calls.find(call => call.requestPath.includes('projection=')).options.signal;
  h.run("document.getElementById('show-all').checked = true; document.getElementById('group-view').checked = false; renderTasks()");
  const normalLoad = h.run('foregroundTaskLoad.promise'); await flush();
  assert.equal(signal.aborted, true);
  assert.deepEqual(activeLabels(h), []);
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  if (order === 'thin-first') { thinResponse.resolve(thin); await oldLoad; assert.equal(h.run('result'), undefined); }
  normalResponse.resolve(f.actor1); await normalLoad;
  if (order === 'normal-first') { thinResponse.resolve(thin); await oldLoad; }
  assert.equal(h.run('result'), f.actor1);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal', 'Unpresented goal']);
  assert.equal(await h.run('ensureResult()'), f.actor1);
});

test('group OFF clears an accepted thin sidebar before its normal catalogue arrives', async () => {
  const h = harness(), f = duoFixture(h), normalResponse = deferred();
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared] };
  h.run("document.getElementById('group-view').checked = true; result = undefined; shownResult = undefined");
  h.route(path => path.includes('reed') ? f.reed : thin);
  await h.run('loadTasks()'); await flush();
  h.route(() => normalResponse.promise);
  h.run("document.getElementById('show-all').checked = true; document.getElementById('group-view').checked = false; renderTasks()");
  assert.equal(h.run('result'), undefined); assert.equal(h.run('shownResult'), undefined);
  assert.deepEqual(activeLabels(h), []);
  const loading = h.run('ensureResult()');
  assert.equal(h.calls.at(-1).requestPath, '/api/tasks?memberId=actor1&view=play-v1');
  normalResponse.resolve(f.actor1); assert.equal(await loading, f.actor1);
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Shared goal', 'Unpresented goal']);
});


test('thin foreground retains personal completed and backlog rows while duo active rows stay presented', async () => {
  const h = harness(), f = duoFixture(h);
  const saved = { id: 'custom:saved-sidebar', label: 'Saved personal goal', category: 'Custom', status: 'available', obligation: true };
  const thin = { ...f.actor1, projection: 'duo-sidebar-v1', tasks: [f.own, f.shared, saved] };
  h.context.savedSidebar = saved;
  h.context.state.tasks.push(saved);
  h.run("state.members[0].taskStatus[savedSidebar.id] = { challengeCompleted: true, backlogged: true }; document.getElementById('group-view').checked = true; result = undefined; shownResult = undefined");
  h.route(path => path.includes('reed') ? f.reed : thin);
  await h.run('loadTasks()'); await flush();
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
  assert.equal(h.nodes.get('completed-count').textContent, '(1)');
  assert.equal(h.nodes.get('backlog-count').textContent, '(1 unique task)');
  assert.equal(h.run("taskListRows.get('completed-tasks')[0].id"), saved.id);
  assert.equal(h.run("taskListRows.get('backlog-tasks')[0].id"), saved.id);
});

test('a nonactive player slim popup opens immediately and hydrates through its reviewed result loader', async () => {
  const h = harness(), response = deferred(), state = h.snapshot(), compact = { ...task, id: 'rs3:task:partner-detail', label: 'Reed compact goal', description: 'Reed immediate task description' };
  state.members[1].taskStatus = { [compact.id]: { challengeCompleted: true } }; h.adopt(state);
  h.context.partnerSlim = { ...taskResult(7), memberId: 'reed', format: 'play-v1', tasks: [compact], presentation: { tasks: [compact], alternatives: {} } };
  let loads = 0, returned = 0; h.context.loadPartnerDetails = () => { loads++; return response.promise; }; h.context.returnPartnerCompleted = () => { returned++; };
  h.run("result = {...partnerSlim, memberId:'actor1', tasks:[]}; showTask(partnerSlim.tasks[0], false, {memberId:'reed', result:partnerSlim, loadResult:loadPartnerDetails, onReturn:returnPartnerCompleted})");
  assert.equal(h.nodes.get('dialog-title').textContent, compact.label); assert.ok(h.find('p', compact.description)); assert.ok(h.find('p', 'Loading sources and details…'));
  assert.ok(h.find('button', 'Back to Completed Tasks')); assert.equal(h.calls.length, 0);
  await flush(); assert.equal(loads, 1);
  response.resolve({ ...taskResult(7), memberId: 'reed', tasks: [{ ...compact, explanation: 'Reed scoped full evidence', sources: [{ kind: 'shop', source: 'Reed fixture shop' }], record: { Description: compact.description } }] }); await flush(); await flush();
  assert.ok(h.find('p', 'Reed scoped full evidence')); assert.ok(!h.find('p', 'Loading sources and details…'));
  const done = h.all().find(node => node.tagName === 'LABEL' && node.children.some(child => child.tagName === 'TEXT' && child.textContent === 'Counts for our chunk challenge · Reed'))?.children[0];
  assert.equal(done?.checked, true); done.checked = false; await done.emit('change');
  assert.deepEqual(h.calls.at(-1).body.command, { type: 'set-task-status', memberId: 'reed', taskId: compact.id, challengeCompleted: false });
  await h.click('Back to Completed Tasks'); assert.equal(returned, 1); assert.equal(h.run('memberId'), 'actor1');
});

test('a reviewed slim popup refuses full detail results for another player or revision', async () => {
  for (const mismatch of ['player', 'revision']) {
    const h = harness(), response = deferred(), compact = { ...task, id: 'rs3:task:partner-detail', label: 'Reed compact goal' };
    h.context.partnerSlim = { ...taskResult(7), memberId: 'reed', format: 'play-v1', tasks: [compact] }; h.context.loadPartnerDetails = () => response.promise;
    h.run("showTask(partnerSlim.tasks[0], false, {memberId:'reed', result:partnerSlim, loadResult:loadPartnerDetails})"); await flush();
    response.resolve({ ...taskResult(mismatch === 'revision' ? 8 : 7), memberId: mismatch === 'player' ? 'actor1' : 'reed', tasks: [{ ...compact, explanation: 'Wrong scope evidence' }] }); await flush(); await flush();
    assert.ok(!h.find('p', 'Wrong scope evidence')); assert.ok(h.find('p', 'The saved task details changed. Open the task again.'));
    assert.equal(h.run('memberId'), 'actor1'); assert.equal(h.calls.length, 0);
  }
});
const filterNodes = h => { const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)]; return walk(h.run('activeTaskFilters().element')); };
const filterControl = (h, id) => filterNodes(h).find(node => node.id === id);
const filterSkill = (h, category) => filterNodes(h).find(node => node.dataset?.taskSkill === category);
async function chooseTaskControl(h, id, value) {
  const node = filterControl(h, id); assert.ok(node, `Missing ${id}`);
  if (typeof value === 'boolean') node.checked = value; else node.value = value;
  await node.emit('change'); await flush();
}

test('active task filters and sorting leave gameplay, backlog and completion unchanged', async () => {
  const h = harness(), fixture = duoFixture(h);
  h.context.blocked = { id: 'rs3:task:blocked', label: 'Zinc ore', category: 'Mining', level: 40, status: 'blocked', blockers: [{ detail: 'Needs Mining 40' }] };
  h.run("result = { ...actor1Result, tasks: [...actor1Result.tasks, blocked] }; state.members[0].taskStatus = { [actor1Result.tasks[0].id]: { favorite: true } }; document.getElementById('show-blocked').checked = true; renderTasks()");
  const snapshot = h.snapshot(), beforeRequests = h.calls.length;
  assert.ok(activeLabels(h).includes('Zinc ore'));
  await chooseTaskControl(h, 'task-doable', true);
  assert.ok(!activeLabels(h).includes('Zinc ore'));
  assert.ok(filterControl(h, 'task-filter-summary').children[0].textContent.startsWith('1 hidden'));
  await chooseTaskControl(h, 'task-pinned', true);
  assert.deepEqual(activeLabels(h), [fixture.own.label]);
  assert.ok(h.all().some(node => node.className === 'task-pin-star' && node.attributes['aria-label'] === 'Pinned'));
  await filterControl(h, 'task-filters-clear').emit('click'); await flush();
  await chooseTaskControl(h, 'task-sort', 'name');
  assert.deepEqual(activeLabels(h), [...activeLabels(h)].sort((a, b) => a.localeCompare(b)));
  const skill = filterSkill(h, 'Mining'); assert.ok(skill); skill.checked = true; await skill.emit('change'); await flush();
  assert.ok(activeLabels(h).every(label => resultCategory(label) === 'Mining'));
  function resultCategory(label) { return h.run('result.tasks').find(task => task.label === label)?.category; }
  assert.deepEqual(h.snapshot(), snapshot); assert.equal(h.calls.length, beforeRequests, 'Display choices send no requests');
});

test('owner chips combine with filters using the named player and Clear returns All', async () => {
  const h = harness(), fixture = duoFixture(h);
  fixture.shared.blockers = [{ detail: 'Player needs a requirement' }];
  fixture.reed.tasks = fixture.reed.tasks.map(row => row.id === fixture.shared.id ? { ...row, blockers: [] } : row);
  h.run('state.members[1].taskStatus = { [reedResult.tasks[0].id]: { favorite: true } }');
  h.route(async () => fixture.reed); await enableDuo(h);
  await chooseTaskControl(h, 'task-doable', true);
  await chooseTaskControl(h, 'task-pinned', true);
  assert.deepEqual(activeLabels(h), [fixture.shared.label]);
  await h.click('Player'); assert.deepEqual(activeLabels(h), []);
  await h.click('Reed'); assert.deepEqual(activeLabels(h), [fixture.shared.label]);
  await h.click('Both'); assert.deepEqual(activeLabels(h), [fixture.shared.label]);
  await filterControl(h, 'task-filters-clear').emit('click'); await flush(); assert.equal(h.run('duoTaskView.filter()'), 'all');
  assert.deepEqual(activeLabels(h).sort(), ['Player goal', 'Reed goal', 'Shared goal']);
});

test('browser display preferences and folded categories survive reloading and changing task views', async () => {
  const entries = new Map(), localStorage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const h = harness({ localStorage }), fixture = duoFixture(h);
  await chooseTaskControl(h, 'task-sort', 'level');
  const category = h.all().find(node => node.className === 'task-category-toggle');
  assert.ok(category); await category.emit('click');
  assert.equal(category.attributes['aria-expanded'], 'false');
  const saved = JSON.parse(entries.get('rs3:active-task-filters:v1'));
  assert.equal(saved.sort, 'level'); assert.ok(saved.folded.includes(category.dataset.category));
  const fresh = harness({ localStorage }); duoFixture(fresh);
  const folded = fresh.all().find(node => node.className === 'task-category-toggle' && node.dataset.category === category.dataset.category);
  assert.equal(folded.attributes['aria-expanded'], 'false');
  assert.equal(filterControl(fresh, 'task-sort').value, 'level');
  h.route(async () => fixture.reed); await enableDuo(h);
  assert.equal(filterControl(h, 'task-sort').value, 'level');
  const groupCategory = h.all().find(node => node.className === 'task-category-toggle' && node.dataset.category === category.dataset.category);
  assert.equal(groupCategory.attributes['aria-expanded'], 'false');
  await groupCategory.emit('click'); await flush();
  assert.equal(groupCategory.attributes['aria-expanded'], 'true');
});

test('rapid task search inputs use the existing 100ms debounce and publish only the final value', async () => {
  const h = harness(); duoFixture(h); h.run('bindTaskSearch()');
  const field = h.nodes.get('task-filter'), before = h.renders.length;
  for (const text of ['M', 'Maë', 'Player']) { field.value = text; await field.emit('input'); }
  assert.equal(h.renders.length, before);
  const timers = [...h.timers.values()].filter(timer => timer.delay === 100);
  assert.equal(timers.length, 1); timers[0].action(); await flush();
  assert.equal(h.renders.length, before + 1); assert.deepEqual(activeLabels(h), ['Player goal']);
});


test('personal claim controls use the session member while another map is viewed', async () => {
  const h = harness(); h.context.claimTask = task;
  h.run("sessionMember = 'reed'; result = { memberId: 'actor1', stateRevision: 7, tasks: [claimTask] }; claimableTaskIds = new Set([claimTask.id]); taskFacts = () => ({personal:false, group:false}); $('active-tasks').replaceChildren(taskRow(claimTask))");
  const claim = h.all().find(node => node.className === 'task-claim-action');
  assert.equal(claim.textContent, 'I’m doing this');
  assert.equal(Object.hasOwn(claim.attributes, 'aria-pressed'), false);
  await claim.emit('click');
  assert.equal(h.calls[0].body.command.memberId, 'reed');
});

test('master personal claim controls name the selected player and viewers see status without claim controls', async () => {
  const h = harness(); h.context.claimTask = task;
  h.run("result = { memberId: 'actor1', stateRevision: 7, tasks: [claimTask] }; claimableTaskIds = new Set([claimTask.id]); taskFacts = () => ({personal:false, group:false}); $('active-tasks').replaceChildren(taskRow(claimTask))");
  let claim = h.all().find(node => node.className === 'task-claim-action');
  assert.equal(claim.textContent, 'Claim for Player');
  assert.equal(claim.disabled, false);
  h.run("sessionReadOnly = true; state.taskClaims={[claimTask.id]:{memberId:'reed',at:'2026-10-12T12:00:00Z'}}; $('active-tasks').replaceChildren(taskRow(claimTask))");
  claim = h.all().find(node => node.className === 'task-claim-action');
  assert.equal(claim, undefined);
  const row = h.all().find(node => node.className === 'task-row');
  assert.equal(row.children[0].textContent, 'Not done');
  assert.ok(!row.querySelector('input'));
  assert.ok(row.querySelector('.task-claim-name').textContent.includes('Reed is doing this'));
  assert.equal(h.calls.length, 0);
});

test('claim-only conflicts retry the exact command once at the authoritative revision', async () => {
  const h = harness();
  const authoritative = h.snapshot(); authoritative.revision = 10; authoritative.taskClaims = {};
  h.route((path, body) => {
    if (h.calls.length === 1) return { ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } };
    const state = structuredClone(authoritative); state.revision++;
    state.taskClaims[task.id] = { memberId: body.command.memberId, at: '2026-10-12T12:00:00Z' };
    return { state, pools: {} };
  });
  await h.run(`command({ type: 'claim-task', memberId: 'actor1', taskId: ${JSON.stringify(task.id)} }, 7)`);
  assert.deepEqual(h.calls.map(call => call.body.expectedRevision), [7, 10]);
  assert.deepEqual(h.calls[1].body.command, h.calls[0].body.command);
  assert.equal(h.run('state.revision'), 11);
  assert.equal(h.run(`state.taskClaims[${JSON.stringify(task.id)}].memberId`), 'actor1');
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

for (const action of ['claim', 'takeover', 'clear']) test(`an unrelated claim-only save allows the reviewed ${action} retry`, async () => {
  const h = harness(), original = { memberId: 'actor1', at: '2026-10-12T11:00:00Z' };
  h.context.initialClaims = action === 'claim' ? {} : { [task.id]: original }; h.run('state.taskClaims = initialClaims');
  const authoritative = h.snapshot(); authoritative.revision = 8;
  authoritative.taskClaims['custom:unrelated'] = { memberId: 'reed', at: '2026-10-12T12:00:00Z' };
  const payload = { type: action === 'clear' ? 'clear-task-claim' : 'claim-task', memberId: action === 'clear' ? 'actor1' : 'reed', taskId: task.id, ...(action === 'takeover' ? { takeover: true } : {}) };
  h.route(() => h.calls.length === 1
    ? { ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }
    : { state: { ...authoritative, revision: 9 }, pools: {} });
  await h.run(`command(${JSON.stringify(payload)}, 7)`);
  assert.deepEqual(h.calls.map(call => call.body.expectedRevision), [7, 8]);
  assert.deepEqual(h.calls[1].body.command, payload); assert.equal(h.run('state.revision'), 9);
});

for (const action of ['claim', 'takeover', 'clear']) for (const change of action === 'claim' ? ['claimed'] : ['new-timestamp', 'different-member', 'cleared']) test(`a target claim ${change} prevents the reviewed ${action} retry`, async () => {
  const h = harness(), original = { memberId: 'actor1', at: '2026-10-12T11:00:00Z' };
  h.context.initialClaims = action === 'claim' ? {} : { [task.id]: original }; h.run('state.taskClaims = initialClaims');
  const authoritative = h.snapshot(); authoritative.revision = 8;
  if (change === 'cleared') delete authoritative.taskClaims[task.id];
  else authoritative.taskClaims[task.id] = { memberId: change === 'different-member' ? 'reed' : 'actor1', at: change === 'new-timestamp' ? '2026-10-12T12:00:00Z' : original.at };
  const payload = { type: action === 'clear' ? 'clear-task-claim' : 'claim-task', memberId: action === 'clear' ? 'actor1' : 'reed', taskId: task.id, ...(action === 'takeover' ? { takeover: true } : {}) };
  h.route(() => ({ ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }));
  await assert.rejects(h.run(`command(${JSON.stringify(payload)}, 7)`), /shared state is loaded.*try again/);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].body.command, payload);
  assert.deepEqual(h.snapshot(), authoritative);
});

test('a takeover review already behind state at claim snapshot capture cannot retry', async () => {
  const h = harness(); h.run(`state.revision = 8; state.taskClaims = { ${JSON.stringify(task.id)}: { memberId: 'actor1', at: '2026-10-12T11:00:00Z' } }`);
  const authoritative = h.snapshot(); authoritative.revision = 9;
  h.route(() => ({ ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }));
  await assert.rejects(h.run(`command({ type: 'claim-task', memberId: 'reed', taskId: ${JSON.stringify(task.id)}, takeover: true }, 7)`), /shared state is loaded.*try again/);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.expectedRevision, 7);
  assert.deepEqual(h.snapshot(), authoritative);
});

test('a confirmed takeover requires a fresh review when its target claim was renewed', async () => {
  const h = harness(), pending = deferred(); h.context.claimTask = task;
  h.run(`sessionMember = 'reed'; state.taskClaims = { ${JSON.stringify(task.id)}: { memberId: 'actor1', at: '2026-10-12T11:00:00Z' } }; result = { memberId: 'actor1', stateRevision: 7, tasks: [claimTask] }; claimableTaskIds = new Set([claimTask.id]); taskFacts = () => ({ personal: false, group: false }); $('active-tasks').replaceChildren(taskRow(claimTask))`);
  h.route(() => pending.promise);
  const action = h.all().find(node => node.className === 'task-claim-action');
  await action.emit('click'); assert.equal(h.calls.length, 0);
  const confirmation = h.all().find(node => node.className === 'task-claim-confirm');
  assert.ok(confirmation.children.some(node => node.textContent === 'Take over from Player?'));
  const taking = confirmation.children.find(node => node.tagName === 'BUTTON').emit('click'); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.command.takeover, true);
  const authoritative = h.snapshot(); authoritative.revision = 8; authoritative.taskClaims[task.id].at = '2026-10-12T12:00:00Z';
  pending.resolve({ ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }); await taking;
  assert.equal(h.calls.length, 1); assert.deepEqual(h.snapshot(), authoritative);
  assert.equal(h.nodes.get('save-status').textContent, 'Change refused · review');
});

for (const changeTarget of [false, true]) test(`a persisted claim alias ${changeTarget ? 'blocks a changed-target' : 'allows an unrelated'} retry`, async () => {
  const h = harness(), canonical = 'rs3:task:canonical';
  h.run(`state.identityRegistry = { aliases: { ${JSON.stringify(task.id)}: [${JSON.stringify(canonical)}] } }; state.taskClaims = { ${JSON.stringify(canonical)}: { memberId: 'actor1', at: '2026-10-12T11:00:00Z' } }`);
  const authoritative = h.snapshot(); authoritative.revision = 8;
  if (changeTarget) authoritative.taskClaims[canonical].at = '2026-10-12T12:00:00Z';
  else authoritative.taskClaims['custom:unrelated'] = { memberId: 'actor1', at: '2026-10-12T12:00:00Z' };
  h.route(() => h.calls.length === 1 ? { ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } } : { state: { ...authoritative, revision: 9 }, pools: {} });
  const saving = h.run(`command({ type: 'claim-task', memberId: 'reed', taskId: ${JSON.stringify(task.id)}, takeover: true }, 7)`);
  if (changeTarget) await assert.rejects(saving, /shared state is loaded.*try again/); else await saving;
  assert.equal(h.calls.length, changeTarget ? 1 : 2);
});

test('claim-only retry keeps the pending Unlock visible until acknowledgement', async () => {
  const h = harness(), first = deferred(), second = deferred(), baseline = h.snapshot();
  h.route(() => h.calls.length === 1 ? first.promise : second.promise);
  const saving = h.run("toggleChunk('12341')"); await flush();
  const claimed = structuredClone(baseline); claimed.revision = 8;
  claimed.taskClaims = { [task.id]: { memberId: 'reed', at: '2026-10-12T12:00:00Z' } };
  first.resolve({ ok: false, status: 409, value: { state: claimed, pools: {}, claimOnlyChanges: true } });
  await flush();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls.map(call => call.body.expectedRevision), [7, 8]);
  assert.deepEqual(h.calls[1].body.command, { type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' });
  assert.equal(h.run('state.revision'), 8); assert.equal(h.run('pendingChunkChanges.length'), 1);
  assert.ok(!h.snapshot().members[0].unlocked.includes('12341'));
  assert.ok(h.map.members[0].unlocked.includes('12341'), 'Claim-only conflict adoption retains the optimistic Unlock');
  assert.equal(h.nodes.get('save-status').textContent, 'Change refused · review');
  const saved = structuredClone(claimed); saved.revision = 9; saved.members[0].unlocked.push('12341');
  second.resolve({ state: saved, pools: {} }); await saving;
  assert.equal(h.run('state.revision'), 9); assert.equal(h.run('pendingChunkChanges.length'), 0);
  assert.ok(h.map.members[0].unlocked.includes('12341'));
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

for (const change of ['gameplay', 'mixed', 'preference', 'claim-without-proof', 'non-boolean-proof']) test(`a ${change} conflict requires review without retrying`, async () => {
  const h = harness(), authoritative = h.snapshot(); authoritative.revision = change === 'mixed' ? 9 : 8;
  if (['gameplay', 'mixed'].includes(change)) authoritative.members[1].unlocked.push('12342');
  if (change === 'preference') authoritative.members[1].preferences = { ...authoritative.members[1].preferences, theme: 'light' };
  if (['mixed', 'claim-without-proof', 'non-boolean-proof'].includes(change)) authoritative.taskClaims = { [task.id]: { memberId: 'reed' } };
  h.route(() => ({ ok: false, status: 409, value: { state: authoritative, pools: {}, ...(change === 'non-boolean-proof' ? { claimOnlyChanges: 'true' } : change === 'claim-without-proof' ? {} : { claimOnlyChanges: false }) } }));
  await assert.rejects(h.run("command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' })"), /shared state is loaded.*try again/);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.snapshot(), authoritative);
});

test('a second claim-only conflict stops after one retry and reverts the unsaved Unlock', async () => {
  const h = harness();
  h.route(() => { const state = h.snapshot(); state.revision++; return { ok: false, status: 409, value: { state, pools: {}, claimOnlyChanges: true } }; });
  await assert.rejects(h.run("toggleChunk('12341')"), /Chunk 12341 was not saved because another save arrived first/);
  assert.deepEqual(h.calls.map(call => call.body.expectedRevision), [7, 8]);
  assert.equal(h.run('state.revision'), 9); assert.equal(h.run('pendingChunkChanges.length'), 0);
  assert.ok(!h.map.members[0].unlocked.includes('12341'));
  assert.equal(h.nodes.get('save-status').textContent, 'Change refused · review');
});

for (const transition of ['member', 'group-view', 'session-member', 'session-admin', 'read-only', 'review-closed']) test(`claim-only retry stops if ${transition} changes during the request`, async () => {
  const h = harness(), pending = deferred(), authoritative = h.snapshot(); authoritative.revision = 8;
  h.context.reviewActive = true; h.route(() => pending.promise);
  const saving = assert.rejects(h.run("command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' }, undefined, undefined, () => reviewActive)"), /shared state is loaded.*try again/);
  await flush(); assert.equal(h.calls.length, 1);
  const changes = { member: "memberId = 'reed'", 'group-view': "$('group-view').checked = true", 'session-member': "sessionMember = 'reed'", 'session-admin': 'sessionAdmin = !sessionAdmin', 'read-only': 'sessionReadOnly = true', 'review-closed': 'reviewActive = false' };
  h.run(changes[transition]);
  pending.resolve({ ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }); await saving;
  assert.equal(h.calls.length, 1); assert.equal(h.run('state.revision'), 8);
});

for (const type of ['sync-original', 'replace-member', 'restore', 'import', 'undo', 'unpick']) test(`claim-only conflict does not silently rebase a reviewed ${type} action`, async () => {
  const h = harness(), authoritative = h.snapshot(); authoritative.revision = 8;
  h.route(() => ({ ok: false, status: 409, value: { state: authoritative, pools: {}, claimOnlyChanges: true } }));
  await assert.rejects(h.run(`command({ type: '${type}', memberId: 'actor1' }, 7, undefined, () => true)`), /shared state is loaded.*try again/);
  assert.equal(h.calls.length, 1); assert.equal(h.run('state.revision'), 8);
});

test('claim-only proof for an older response cannot rebase onto an intervening gameplay save', async () => {
  const h = harness(), pending = deferred(), claimed = h.snapshot(); claimed.revision = 8;
  h.route(() => pending.promise);
  const saving = assert.rejects(h.run("command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' })"), /shared state is loaded.*try again/);
  await flush();
  const gameplay = structuredClone(claimed); gameplay.revision = 9; gameplay.members[1].unlocked.push('12342'); h.adopt(gameplay);
  pending.resolve({ ok: false, status: 409, value: { state: claimed, pools: {}, claimOnlyChanges: true } }); await saving;
  assert.equal(h.calls.length, 1); assert.deepEqual(h.snapshot(), gameplay);
});


test('group claim controls retain the session actor across task ownership and map selection', async () => {
  const h = harness(), f = duoFixture(h);
  h.run("sessionMember = 'reed'");
  h.route(() => f.reed); await enableDuo(h);
  const row = h.all().find(node => node.className === 'task-row duo-task-row' && node.dataset.taskId === f.own.id);
  const claim = row.querySelector('.task-claim-action');
  assert.equal(claim.textContent, 'I’m doing this');
  assert.equal(claim.disabled, false);
  h.route((path, body) => { const state = h.snapshot(); state.revision++; return { state, pools: {} }; });
  await claim.emit('click');
  const payload = h.calls.find(call => call.path === '/api/command').body.command;
  assert.deepEqual(payload, { type: 'claim-task', memberId: 'reed', taskId: f.own.id });
  assert.equal(h.run('memberId'), 'actor1');
});

// Shared failure injection: no network, real screen API and shipped panel bodies.
const requestFailureKinds = [429, 503, 409, 413, 'offline', 'ECONNRESET'];
function failRequest(kind) {
  if (typeof kind === 'string') throw new TypeError(kind);
  return { ok: false, status: kind, value: { message: 'Error: internal failure\n at server (/private/file:1)' } };
}
const failureWords = kind => typeof kind === 'string' ? /Check your internet/ : ({ 429: /Too many requests/, 503: /busy or restarting/, 409: /saved map changed/, 413: /too large/ })[kind];

for (const kind of requestFailureKinds) {
  for (const loader of ['loadTasks', 'ensureResult']) test(`request failure ${kind}: ${loader} clears loading, keeps Retry through health events, and recovers`, async () => {
    const h = harness(); let failed = true;
    h.route(() => failed ? failRequest(kind) : taskResult(7));
    const first = h.run(`${loader}()`);
    if (loader === 'ensureResult') await assert.rejects(first, failureWords(kind)); else await first;
    assert.ok(h.find('button', 'Retry')); assert.equal(h.run('taskInFlight'), false);
    assert.match(h.nodes.get('task-engine-status').children[0].textContent, failureWords(kind));
    h.run("workerStatus({ready:false,status:'recovering'})");
    assert.ok(h.find('button', 'Retry'), 'worker messages must not erase recovery controls');
    const reloads = () => [...h.timers.entries()].filter(([, timer]) => timer.delay === 0);
    h.run('workerStatus({ready:true})');
    assert.equal(reloads().length, 1, 'a calculator recovery retries the failed load once');
    for (const [id, timer] of reloads()) { h.timers.delete(id); await timer.action(); }
    await flush(); assert.ok(h.find('button', 'Retry'), 'a failed automatic retry keeps recovery controls');
    const count = h.calls.length; h.run('workerStatus({ready:true}); workerStatus({ready:true})'); await flush();
    assert.equal(reloads().length, 0); assert.equal(h.calls.length, count, 'no failure-driven hot loop');
    failed = false; await h.click('Retry');
    assert.equal(h.run('result.stateRevision'), 7); assert.equal(h.run('taskInFlight'), false);
    assert.equal(h.run('taskLoadError'), undefined);
  });

  test(`request failure ${kind}: Unlock preview replaces working text with error and a working retry`, async () => {
    const h = harness(); let failed = true;
    h.route(() => failed ? failRequest(kind) : { memberId: 'actor1', stateRevision: 7, delta: { tasksAdded: [] } });
    h.run("ensureForegroundSettled = async () => {}; chunkTab = 'unlock'; showChunk('12341')"); await flush();
    assert.ok(h.find('button', 'Retry preview'));
    assert.ok(h.all().some(node => node.className === 'error' && failureWords(kind).test(node.textContent)));
    failed = false; await h.click('Retry preview'); await flush();
    assert.ok(h.find('p', 'No new possible tasks')); assert.ok(!h.find('button', 'Retry preview'));
  });

  test(`request failure ${kind}: Chunk Info Possible Tasks retries in place`, async () => {
    const h = harness({ realPlanning: true }); let failed = true;
    h.route(path => path.startsWith('/api/chunk-planning?') ? failed ? failRequest(kind) : planningResult() : taskResult(7));
    h.context.readyTasks = taskResult(7);
    h.run("result = readyTasks; ensureForegroundSettled = async () => {}; chunkTab = 'tasks'; showChunk('12341')");
    const section = h.all().find(node => node.tagName === 'DETAILS' && node.children[0]?.textContent === 'Possible Tasks');
    assert.ok(section); section.open = true; await section.emit('toggle'); await flush();
    assert.ok(h.find('button', 'Retry chunk tasks'));
    failed = false; await h.click('Retry chunk tasks'); await flush();
    assert.ok(!h.find('button', 'Retry chunk tasks')); assert.ok(h.find('button', 'All 1'));
  });

  test(`request failure ${kind}: Teleports clears busy and retries availability`, async () => {
    const h = harness(); let failed = true;
    h.route(() => failed ? failRequest(kind) : { memberId: 'actor1', stateRevision: 7, rows: [] });
    await h.run('teleportsDialog()');
    assert.ok(h.find('button', 'Retry availability'));
    assert.ok(h.all().some(node => node.className === 'teleports-error' && failureWords(kind).test(node.textContent)));
    assert.ok(h.all().filter(node => node.attributes['aria-busy']).every(node => node.attributes['aria-busy'] === 'false'));
    failed = false; await h.click('Retry availability');
    assert.ok(h.find('p', 'No automatic routes were found for this player.'));
  });
}

test('HTTP Retry-After survives repeated panel retry clicks without another fetch', async () => {
  const h = harness(); let clock = 10000, failed = true;
  h.context.Date = class extends Date { static now() { return clock; } };
  h.route(() => failed ? { ...failRequest(429), headers: { get: () => '5' } } : taskResult(7));
  await h.run('loadTasks()'); const before = h.calls.length;
  await h.click('Retry'); await h.click('Retry'); assert.equal(h.calls.length, before);
  assert.match(h.nodes.get('task-engine-status').children[0].textContent, /5 seconds/);
  clock = 15000; failed = false; await h.click('Retry'); assert.equal(h.run('result.stateRevision'), 7);
});

test('an open event stream retries failed state reconciliation with growing waits and recovers without replaying a save', async () => {
  const h = harness(); let failed = true;
  h.run("ensureForegroundSettled = async () => {}; chunkTab = 'note'; showChunk('12341'); connectEvents()"); await h.run('queue');
  const draft = h.find('textarea'); draft.value = 'Keep my unsaved note'; draft.focus();
  const latest = h.snapshot(); latest.revision = 8;
  h.route(() => failed ? failRequest(503) : { state: latest, pools: {} });
  await h.eventSources[0].emit('revision', { data: JSON.stringify({ revision: 8 }) });
  for (const delay of [1000, 2000]) {
    const timer = [...h.timers.entries()].find(([, timer]) => timer.delay === delay); assert.ok(timer);
    h.timers.delete(timer[0]); timer[1].action(); await flush();
  }
  const timer = [...h.timers.entries()].find(([, timer]) => timer.delay === 4000); assert.ok(timer);
  failed = false; h.timers.delete(timer[0]); timer[1].action(); await flush();
  assert.equal(h.run('state.revision'), 8); assert.equal(draft.value, 'Keep my unsaved note');
  assert.ok(h.calls.every(call => call.path === '/api/state')); assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

test('repeated CLOSED stream errors schedule only one reconnect and restore sync', async () => {
  const h = harness(); h.run('connectEvents()'); await h.run('queue');
  h.context.Math = Object.assign(Object.create(Math), { random: () => 0 });
  const events = h.eventSources[0]; events.readyState = 2;
  await events.emit('error'); await events.emit('error');
  const reconnects = [...h.timers.values()].filter(timer => timer.delay === 1000); assert.equal(reconnects.length, 1);
  reconnects[0].action(); assert.equal(h.eventSources.length, 2);
  await h.eventSources[1].emit('open');
  await h.eventSources[1].emit('revision', { data: JSON.stringify({ revision: 7 }) });
  assert.equal(h.nodes.get('save-status').textContent, 'Saved');
});

test('a failing on-demand load clears the busy flag after taking over an aborted player request', async () => {
  const h = harness(), old = deferred(); let count = 0;
  h.route(() => ++count === 1 ? old.promise : failRequest(503));
  const loading = h.run('loadTasks()');
  h.run("memberId = 'reed'");
  await assert.rejects(h.run('ensureResult()'), /busy or restarting/);
  old.resolve(taskResult(7)); await loading;
  assert.equal(h.run('taskInFlight'), false); assert.ok(h.find('button', 'Retry'));
});

test('accessibility: search actions name their result and hand focus to Chunk Info on close', async () => {
  const h = harness();
  h.run("chunkSearch = [{id:'12341',name:'Named chunk',search:'named chunk'}]; searchDialog()");
  await flush();
  const view = h.find('button', 'View'); assert.ok(view);
  assert.equal(view.attributes['aria-label'], 'View Named chunk');
  let closeArgs;
  h.context.captureClose = (...args) => { closeArgs = args; };
  h.run('closeDialog = captureClose');
  await view.emit('click');
  assert.equal(h.nodes.get('chunk-info').hidden, false);
  assert.equal(closeArgs[1].focusTarget, h.nodes.get('chunk-close'));
});

test('accessibility: shared errors are alerts and ordinary notices remain polite statuses', () => {
  const h = harness();
  h.run("notice('Could not save', true)");
  assert.equal(h.nodes.get('notice').attributes.role, 'alert');
  assert.equal(h.nodes.get('notice').hidden, false);
  h.run("notice('Copied')");
  assert.equal(h.nodes.get('notice').attributes.role, 'status');
});

test('simple rule toggles queue after local saves and use the resulting revision', async () => {
  const h = harness(), first = deferred();
  h.route(async (path, body) => {
    if (path === '/api/command') {
      if (body.command.type === 'set-preference') await first.promise;
      const before = h.snapshot(); assert.equal(body.expectedRevision, before.revision);
      return { state: { ...before, revision: before.revision + 1 }, pools: {} };
    }
    return taskResult(h.snapshot().revision);
  });
  const pref = h.run("command({type:'set-preference',memberId:'actor1',preferenceId:'hideChecked',value:false})"); await flush();
  h.run('rulesDialog()');
  // This rule exists in every dataset; the runner gives this file open-f2p, whose catalogue has no BiS rules.
  const control = h.all().find(node => node.attributes?.['aria-label'] === futureSlayerUnlocksRule.label);
  control.checked = false; const saving = control.emit('change'); await flush();
  assert.equal(h.calls.filter(call => call.path === '/api/command').length, 1);
  first.resolve(); await pref; await saving;
  const calls = h.calls.filter(call => call.path === '/api/command');
  assert.deepEqual(calls.map(call => call.body.expectedRevision), [7, 8]);
  assert.equal(h.run('state.revision'), 9);
});

test('backup preview cancellation suppresses late responses and Apply submits only once', async () => {
  const h = harness(), pending = deferred(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
  h.run('backupDialog()');
  h.all().find(node => node.type === 'file').files = [new File(['{}'], 'fixture.json')];
  const requestStarted = deferred(); h.route(() => { requestStarted.resolve(); return pending.promise; });
  const reading = h.click('Preview import / restore');
  await requestStarted.promise;
  assert.ok(h.find('p', 'Checking replacement…'));
  await h.click('Cancel preview');
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.ok(h.find('p', 'Preview cancelled.'));
  assert.equal(h.find('button', 'Preview import / restore').disabled, false);
  pending.resolve({ preview }); await reading;
  assert.equal(h.find('button', 'Apply reviewed replacement'), undefined);
  h.route(() => ({ preview })); await h.click('Preview import / restore');
  const applyResponse = deferred(), applyStarted = deferred(); h.route(() => { applyStarted.resolve(); return applyResponse.promise; });
  const apply = h.find('button', 'Apply reviewed replacement');
  const saving = apply.emit('click'); await flush();
  assert.equal(apply.disabled, true); assert.ok(h.find('p', 'Applying replacement…'));
  await apply.emit('click');
  await applyStarted.promise;
  assert.equal(h.calls.filter(call => call.path === '/api/restore').length, 1);
  applyResponse.resolve({ state: { ...h.snapshot(), revision: 8 }, pools: {} }); await saving;
  assert.equal(h.run('state.revision'), 8);
});

test('viewer Why uses saved facts when full details are absent, keeping all requests read-only', async () => {
  const h = viewerHarness();
  const visible = { id: 'builtin:why', label: 'Mine fixture ore', rawLabel: 'Mine fixture ore', category: 'Mining', status: 'available' };
  h.context.whyTask = visible;
  h.run("definitions.challenges = {Mining:{'Mine fixture ore':{Category:['Show Skill Tasks']}}}; result={memberId:'actor1',stateRevision:7,tasks:[whyTask]}; $('active-tasks').replaceChildren(taskRow(whyTask))");
  h.route((path, body) => {
    assert.equal(body, undefined);
    return h.calls.at(-1).requestPath.includes('view=play-v1')
      ? { format: 'play-v1', memberId: 'actor1', stateRevision: 7, tasks: [visible] }
      : { ok: false, status: 409, value: { code: 'TASK_DETAILS_UNAVAILABLE' } };
  });
  const why = h.all().find(node => node.className === 'icon-button task-why'); await why.emit('click'); await flush();
  assert.ok(h.all().some(node => node.textContent === 'Why this task?'));
  assert.ok(h.all().some(node => node.textContent?.includes('Additional calculated details')));
  assert.equal(h.all().some(node => node.className === 'task-why-retry'), false);
  assert.ok(h.calls.every(call => call.body === undefined));
});


// F4.1: hold the response open so repeated and competing player clicks overlap.
for (const action of ['Unlock Chunk 12341', 'Unlock Chunk 12342', 'Pick for me', 'Unlock both', 'Cancel roll'])
test(`F4 pending choice suppresses competing action ${action}`, async () => {
  const h = harness(), reply = deferred();
  h.run("state.members[0].pendingRoll = ['12341', '12342']; renderState()");
  h.route(() => reply.promise);
  const buttons = h.nodes.get('pending-panel').querySelectorAll('button');
  const firstButton = buttons.find(node => node.textContent === 'Unlock Chunk 12341');
  const competingButton = buttons.find(node => node.textContent === action);
  const first = firstButton.emit('click'), second = competingButton.emit('click');
  await flush();
  const next = h.snapshot(); next.revision++; next.members[0].pendingRoll = []; next.members[0].unlocked = ['12341'];
  const busy = h.nodes.get('pending-panel').querySelectorAll('button');
  const controls = busy.filter(node => node.className !== 'choice-view');
  const disabled = controls.length > 0 && controls.every(node => node.disabled);
  reply.resolve({ state: next, pools: {} }); await Promise.all([first, second]);
  assert.equal(disabled, true);
  assert.equal(h.calls.filter(call => call.path === '/api/command').length, 1);
});

test('F4 pending choice guard releases after a refusal and cancellation never opens new tasks', async () => {
  const h = harness(); h.run("state.members[0].pendingRoll = ['12341', '12342']; renderState()");
  h.route(() => ({ ok: false, status: 400, value: { error: 'Synthetic refusal' } }));
  await assert.rejects(h.run("acceptRoll({ type: 'unlock-both', memberId: 'actor1' })"), { status: 400 });
  assert.equal(h.run('rollBusy'), false);
  h.run('state.members[0].preferences.newTasks = true');
  h.route(() => { const state = h.snapshot(); state.revision++; state.members[0].pendingRoll = []; return { state, pools: {} }; });
  await h.run("acceptRoll({ type: 'cancel-roll', memberId: 'actor1' })");
  assert.equal(h.calls.filter(call => call.path === '/api/command').length, 2);
  assert.notEqual(h.nodes.get('dialog-title')?.textContent, 'New chunk tasks');
});

// F4.2: model an exhausted transport and its later receipt using the real screen queue.
for (const replacement of [false, true]) test(`F4 recovered custom task ${replacement ? 'preserves a newer dialog' : 'closes its failed form'}`, async () => {
  const h = harness(); let pending, recovered = false, sends = 0;
  h.context.createLiveSwapCommandClient = () => ({
    connectionMessage: () => '', confirm: async () => {}, pending: () => pending, paused: () => !!pending,
    async send(body) {
      sends++;
      if (!recovered) { pending = { ...body, requestId: 'task-receipt' }; throw Object.assign(new Error('Save not confirmed'), { pendingCommand: true, retryPaused: true }); }
      const state = h.snapshot(); state.revision++; state.tasks.push(pending.command.task); pending = undefined;
      return { response: { ok: true, status: 200 }, value: { state, pools: {} } };
    },
  });
  h.run('customTaskDialog()');
  const form = h.find('form'), description = form.querySelector('input'); description.value = 'Synthetic recovery task';
  await form.emit('submit', { preventDefault() {} }); await h.run('queue');
  assert.ok(form.querySelector('p').textContent.includes('Save not confirmed'));
  if (replacement) h.run('settingsPanels.settings()');
  recovered = true; await h.run('recoverPendingCommand({ retry: true })');
  assert.equal(h.run('state.tasks.length'), 2); assert.equal(sends, 2);
  if (replacement) assert.equal(h.nodes.get('dialog-title').textContent, 'Settings');
  else assert.equal(h.nodes.get('tool-dialog').open, false);
});

// F4.7: an invalid upload followed by a valid preview must replace obsolete feedback.
test('F4 backup preview feedback belongs to the selected file', async () => {
  const h = harness(), preview = { currentRevision: 7, members: [], rules: { changed: [] }, warnings: [] };
  h.run("notice('Independent feedback', true); backupDialog()");
  const file = h.all().find(node => node.type === 'file');
  file.files = [new File(['invalid gzip'], 'invalid.json.gz')];
  await h.click('Preview import / restore');
  assert.ok(h.find('p', 'Preview failed. Try again.') || h.all().some(node => /gzip.*corrupt|corrupt.*gzip/i.test(node.textContent)));
  file.files = [new File(['{}'], 'valid.json')]; await file.emit('change');
  h.route(() => ({ preview })); await h.click('Preview import / restore');
  assert.ok(h.find('button', 'Apply reviewed replacement'));
  assert.ok(!h.all().some(node => /gzip.*corrupt|corrupt.*gzip/i.test(node.textContent)));
  assert.ok(h.find('span', 'Independent feedback'));
});

test('wired quest search renders mandatory-stage readiness from personal whole completion', async () => {
  for (const completed of [false, true]) {
    const h = harness(), state = h.snapshot();
    const row = (id, title, step, record = {}) => ({ id, category: 'Quest', baseQuest: title,
      rawLabel: `~|${title}|~ ${step}`, label: `${title} ${step}`, record, status: 'available', blockers: [] });
    const stage = row('stage', 'Earlier', '5');
    const whole = row('whole', 'Earlier', 'Complete the quest', { QuestPoints: 1, Tasks: { [stage.rawLabel]: 'Quest' } });
    whole.personalCompleted = completed;
    const finish = row('finish', 'Later', 'Complete the miniquest', { QuestPoints: 0, Tasks: { [stage.rawLabel]: 'Quest' } });
    const full = { ...taskResult(7), tasks: [stage, whole, finish] };
    full.activityInfo = buildActivityInfo(full, state, 'actor1');
    await openQuestSearch(h, full);
    await questSearchChip(h, 'Can do now').emit('click'); await flush();
    assert.equal(searchLabels(h).includes(finish.label), completed);
    assert.ok(h.calls.every(call => !call.body));
    assert.deepEqual(h.snapshot(), state);
  }
});

// Minimized public count contracts: no calculator or private catalogue inputs.
test('count labels: percentage names its included-goal denominator and keeps search arithmetic', async () => {
  const h = harness();
  const tasks = Array.from({ length: 4 }, (_, i) => ({ id: `builtin:count-${i}`, label: `Count goal ${i}`, category: 'Mining', status: 'available' }));
  h.context.countFixture = { ...taskResult(7), tasks, presentation: { tasks: tasks.slice(1), completedTasks: [tasks[0]] } };
  h.run("state.tasks = countFixture.tasks; member().preferences.numTasksPercent = true; member().taskStatus = { 'builtin:count-0': { challengeCompleted: true } }; result = countFixture; $('hide-completed').checked = false; renderTasks()");
  await h.run('taskRenderDone');
  assert.equal(h.nodes.get('task-count').textContent, '25% complete · 1 of 4 included goals');
  assert.equal(h.nodes.get('task-progress-help').hidden, false);
  assert.match(await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8'), /id="task-progress-help"[^>]*>[^<]*Hide completed, search/);
  h.run("$('hide-completed').checked = true; $('completed-details').open = true; renderTasks()"); await h.run('taskRenderDone');
  assert.equal(h.nodes.get('task-count').textContent, '0% complete · 0 of 3 included goals');
  assert.equal(h.nodes.get('completed-count').textContent, '(1)');
  h.run("$('hide-completed').checked = false; $('task-filter').value = 'Count goal 0'; renderTasks()"); await h.run('taskRenderDone');
  assert.equal(h.nodes.get('task-count').textContent, '100% complete · 1 of 1 included goal');
  h.run("$('task-filter').value = 'no match'; renderTasks()"); await h.run('taskRenderDone');
  assert.equal(h.nodes.get('task-count').textContent, '0% complete · 0 of 0 included goals');
  h.run("member().preferences.numTasksPercent = false; renderTasks()"); await h.run('taskRenderDone');
  assert.equal(h.nodes.get('task-progress-help').hidden, true);
});

for (const anywhere of [false, true]) test(`count labels: ordinary pool and roll-anywhere scope (${anywhere})`, async () => {
  const h = harness();
  h.run(`member().preferences = { rollWarning: true, randomStartAlways: ${anywhere} }; statePools.actor1 = { eligible: [{ id: '12341' }] }; renderState()`);
  assert.equal(h.run('rollCandidateCount()'), anywhere ? 2 : 1);
  const labels = h.nodes.get('map-counts').children.map(node => node.children.filter(item => typeof item === 'string').join(''));
  assert.ok(labels.includes(' chunks in Player’s ordinary roll pool'));
  assert.equal(labels.includes(' roll-anywhere candidate chunks for Player'), anywhere);
  await h.run('rollChunks(1)');
  assert.ok(h.find('p', `Roll one chunk for Player from ${anywhere ? '2 roll-anywhere candidate chunks' : '1 chunks in their ordinary roll pool'}?`));
  assert.equal(h.calls.length, 0, 'Opening confirmation never rolls');
  h.run("closeDialog(); member().pendingRoll = ['12341']; renderState()");
  assert.equal(h.nodes.get('pick').disabled, true);
});
