import { installGallerySafety } from './gallery-safety.mjs';
import { galleryEntries } from './gallery-catalogue.mjs';

document.documentElement.classList.add('gallery-preview');
document.documentElement.dataset.galleryCapture = String(new URLSearchParams(location.search).get('capture') === '1');
const note = document.createElement('output'); note.className = 'gallery-safety-note'; note.textContent = 'Not saved: gallery'; note.setAttribute('role', 'status'); document.body.append(note);
const safety = installGallerySafety(text => { note.textContent = text; });
Date.now = () => Date.parse('2026-10-13T12:00:00.000Z');
let c, fixtures;
const fail = error => {
  document.documentElement.dataset.galleryError = error.message;
  document.documentElement.dataset.galleryErrorStack = error.stack ?? '';
  note.textContent = `Gallery sample failed: ${error.message}`;
};
window.addEventListener('error', event => fail(event.error ?? new Error(event.message)));
window.addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
const noOp = () => {};
const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function build() {
  const { createGalleryFixtures } = await import('./gallery-fixtures.mjs');
  const entry = galleryEntries.find(entry => entry.id === new URLSearchParams(location.search).get('entry'));
  fixtures = createGalleryFixtures(safety.save, { usageEmpty: entry?.usageEmpty });
  const [{ createScreenContext }, { createScreenUi }, { createScreenSettings }, { createScreenDialogs }, { createScreenTasks }, { createScreenTaskDialogs }, { createScreenChunks }, { createScreenPanels }, { createScreenMap }, { createScreenHistory }, { createScreenRoll }, { createScreenCustomTasks }] = await Promise.all([
    import('./screen-context.mjs'), import('./screen-ui.mjs'), import('./screen-settings.mjs'), import('./screen-dialogs.mjs'), import('./screen-tasks.mjs'), import('./screen-task-dialogs.mjs'), import('./screen-chunks.mjs'), import('./screen-panels.mjs'), import('./screen-map.mjs'), import('./screen-history.mjs'), import('./screen-roll.mjs'), import('./screen-custom-tasks.mjs'),
  ]);
  c = createScreenContext(); createScreenUi(c);
  Object.assign(c, { state: fixtures.state, world: fixtures.world, definitions: fixtures.definitions, registry: fixtures.registry, memberId: 'player1', sessionAdmin: true, result: fixtures.result, fullResult: fixtures.result, shownResult: fixtures.result,
    api: fixtures.api, advisoryApi: fixtures.api, closeTopMenus: noOp, foregroundSettled: () => false,
    canonicalTaskRevision: () => 7, compatibleTaskRevision: revision => revision === 7,
    ensureResult: async () => fixtures.result, ensureFullResult: async () => fixtures.result, ensurePlanningResult: async () => fixtures.result, ensureFullDefinitions: async () => fixtures.definitions,
  });
  createScreenSettings(c); createScreenDialogs(c); createScreenTasks(c); createScreenTaskDialogs(c); createScreenChunks(c); createScreenHistory(c); createScreenCustomTasks(c); createScreenRoll(c);
  const open = c.openDialog;
  c.openDialog = (...args) => { const generation = open(...args); c.$('tool-dialog').append(note); return generation; };
  Object.assign(c, safety); // Never initialize the live command or live-update factories.
  c.ensureDuoDetails = async id => fixtures.resultFor(id);
  c.completedResult = async id => fixtures.resultFor(id);
  c.normalPlayResults = new Map(c.state.members.map(member => [member.id, fixtures.resultFor(member.id)]));
  const sandbox = { active: false, signature: () => 'gallery', isNewTask: () => false, markers: () => ({ unlocked: [], locked: [] }), refreshChrome: noOp, exit: noOp };
  c.sandbox = sandbox;
  // Map badges and Chunk Info's "On the map" view read task locations; as in the app, only doable tasks get them (all at 12341).
  for (const member of c.state.members) { const result = fixtures.resultFor(member.id); result.taskLocations ??= Object.fromEntries(result.tasks.filter(task => task.status === 'available').map(task => [task.id, ['12341']])); c.duoResults?.().remember?.(result); }
  const { ChunkMap } = await import('./map.mjs');
  c.map = new ChunkMap({ stage: c.$('map-stage'), baseCanvas: c.$('map-base'), stateCanvas: c.$('map-state'), pinCanvas: c.$('map-pins'), hoverCanvas: c.$('map-hover'), tooltip: c.$('map-tooltip'), deferFallback: true, onChunk: id => c.showChunk(id) });
  createScreenPanels(c); c.sandbox = sandbox;
  c.syncPredictionIntents = noOp; c.deathChunks.refresh = noOp;
  c.deathChunks.panel = () => c.el('p', 'No death estimate in this sample.', 'status-detail');
  c.predictUnlock = async () => ({ memberId: c.memberId, stateRevision: 7, delta: { tasksAdded: [c.result.tasks[2]], itemsAdded: [], areasAdded: [] } });
  c.panelContext.predictUnlock = c.predictUnlock;
  c.pool = { eligible: ['12342', '12343'].map(id => ({ id, reasons: [] })), excluded: [], accessible: ['12341'], partnerConnections: { byChunk: {} } };
  c.statePools = Object.fromEntries(c.state.members.map(member => [member.id, c.pool]));
  createScreenMap(c);
  c.renderTasks = () => {
    c.claimableTaskIds = new Set(c.result.tasks.map(task => task.id));
    c.$('active-tasks').replaceChildren(...c.result.tasks.slice(0, 5).map(c.taskRow));
    c.$('backlog-tasks').replaceChildren(c.taskRow(c.result.tasks[5]));
    c.$('completed-tasks').replaceChildren(c.taskRow(c.result.tasks[1]));
    c.$('accessible-areas').replaceChildren(c.el('p', 'Lumbridge · Sample cellar'));
    c.$('task-engine-status').textContent = '6 example tasks';
  };
  c.refreshChunkNotes = noOp;
  const { createGroupGoals } = await import('./group-goals.mjs'); createGroupGoals(c); c.groupGoals.render();
  const { createXpChoices } = await import('./lamp-choices.mjs'); createXpChoices(c);
  const { createProfileView } = await import('./profile-view.mjs'); c.galleryProfile = createProfileView(c);
  const { createScreenJournal } = await import('./screen-journal.mjs'); createScreenJournal(c);
  const { createScreenRollStats } = await import('./screen-roll-stats.mjs'); createScreenRollStats(c);
  const { createScreenCapture } = await import('./screen-capture.mjs'); createScreenCapture(c);
  const { createFinishLineView } = await import('./finish-line-view.mjs'); c.finishLine = createFinishLineView(c);
  const { createPartnerSupplyView } = await import('./partner-supply-view.mjs'); c.partnerSupply = createPartnerSupplyView(c);
  const { createBossGatesView } = await import('./boss-gates-view.mjs'); c.bossGatesView = createBossGatesView(c);
  const { createScreenAreaCheck } = await import('./area-check.mjs'); createScreenAreaCheck(c);
  const { createMapPinsPanel } = await import('./map-pins.mjs');
  createMapPinsPanel({ panel: c.$('map-pins-panel'), toggle: c.$('map-pins-open'), map: c.map,
    manifest: { categories: [{ id: 'banks', label: 'Banks', group: 'Services' }, { id: 'trees', label: 'Trees', group: 'Resources' }], pins: {} },
    dataset: { pins: [{ id: 'gallery-bank', categoryId: 'banks', name: 'Lumbridge bank', chunkId: '12341', x: 1, y: 1 }, { id: 'gallery-tree', categoryId: 'trees', name: 'Tree', chunkId: '12342', x: 2, y: 1 }] }, preferences: c.preferences, storage: null, onSources: c.mapSourcesDialog });
  c.renderState();
  c.$('backlog-details').open = c.$('completed-details').open = true;
  c.$('group-goals').hidden = false;
  for (const id of ['chunk-close', 'pins-close']) c.$(id)?.addEventListener('click', () => { c.$(id === 'chunk-close' ? 'chunk-info' : 'map-pins-panel').hidden = true; });
  c.$('member').addEventListener('change', event => { c.memberId = event.target.value; c.renderState(); });
  c.bindDialogLifecycle();
  // Public feature callbacks retain the real controls; writes reach the same
  // throwing seam as the editable samples, without starting live subscriptions.
  for (const [id, action] of Object.entries({ 'pick': () => c.rollChunks(1), 'roll-two': () => c.rollChunks(2), 'unpick': c.unpickDialog, 'settings-open': c.settingsPanels.settings, 'rules-open': c.rulesDialog, 'search-open': c.searchDialog, 'activity-open': c.infoPanels.activityInfo, 'bis-open': c.infoPanels.currentBiS, 'backup-open': c.backupDialog, 'undo': safety.command, 'sandbox-toggle': safety.command, 'custom-task-open': c.customTaskDialog, 'center-map': () => c.map.centerOnUnlocked(), 'zoom-in': () => c.map.zoomBy(1.3), 'zoom-out': () => c.map.zoomBy(1 / 1.3) })) c.$(id)?.addEventListener('click', () => Promise.resolve().then(action).catch(c.showError));
  // Only the overview needs world artwork. Decoding the 38-megapixel fallback
  // behind each isolated tool wastes memory and does not help review that tool.
  if ((new URLSearchParams(location.search).get('entry') ?? 'main') === 'main') c.map.setMapAssets(null, null);
  else { c.map.imageStatus = 'unused'; c.$('map-stage').dataset.mapImage = 'unused'; }
  const { loadIcons } = await import('./icons.mjs'); await loadIcons();
  const theme = new URLSearchParams(location.search).get('theme') ?? 'dark';
  const { applyTheme, themePalettes } = await import('./map-tools.mjs');
  if (!Object.hasOwn(themePalettes, theme)) throw new Error('Unknown gallery theme');
  c.member().preferences.theme = theme; c.applyPreferences();
  applyTheme(document.documentElement, theme);
  c.renderMapState();
  c.saved('Not saved: gallery');
  await waitFrame();
}

function isolate(selector) {
  const sample = document.querySelector(selector); if (!sample) throw new Error(`Missing gallery region: ${selector}`);
  sample.hidden = false; sample.classList.add('sample-region');
  document.body.append(sample);
  for (const node of document.querySelectorAll('body > .workspace, body > .topbar, body > #phone-tabs')) if (node !== sample) node.hidden = true;
}
async function clickLabel(label, root = document) {
  const button = [...root.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  if (!button) throw new Error(`Missing sample control: ${label}`);
  button.click(); await waitFrame();
}

async function render(entry) {
  const { render: type } = entry;
  if (type === 'main') { const { createScreenPhoneLayout } = await import('./screen-phone-layout.mjs'); createScreenPhoneLayout(c); c.phoneLayout?.mount(); return; }
  if (type === 'menu') {
    if (entry.menu === 'admin-tools') {
      c.applySession({ admin: true });
      for (const id of ['invites-open', 'overlays-open', 'usage-open']) c.$(id).hidden = false;
    }
    c.$(entry.menu).open = true; isolate('.topbar'); return;
  }
  if (type === 'badges') { c.applySession({ readOnly: true }); c.applyPreferences(); c.$('stream-safe-indicator').hidden = false; isolate('.topbar'); return; }
  if (type === 'task-folds') {
    const { createTaskFilters } = await import('./task-filters.mjs');
    const rows = c.result.tasks.slice(0, 5);
    let preferences = JSON.stringify({ folded: entry.folded ? rows.map(task => task.category) : [] });
    const render = () => {
      const jobs = [], generation = ++c.taskRenderGeneration;
      const shown = c.taskFiltersView.select(rows, { state: c.state, memberId: c.memberId });
      c.grouped(c.$('active-tasks'), shown, jobs, generation, true);
      return c.paintTaskJobs(jobs, generation);
    };
    c.taskFiltersView = createTaskFilters({ document, getStorage: () => ({ getItem: () => preferences, setItem: (key, value) => { preferences = value; } }), onChange: render });
    c.$('task-filter').after(c.taskFiltersView.element);
    await render(); isolate('.task-sidebar'); return;
  }
  if (type === 'region') {
    if (entry.id === 'recent') c.$('recent-panel').open = true;
    if (entry.id === 'summary') c.$('legend-details').open = true;
    if (entry.id === 'pending') { c.member().pendingRoll = ['12342', '12343']; c.renderState(); }
    if (entry.id === 'sidebar') c.bindTaskSearch();
    isolate(entry.selector); return;
  }
  if (type === 'chunk') { c.chunkTab = entry.tab; c.showChunk(entry.tab === 'unlock' ? '12342' : entry.tab === 'access' ? 'Sample cellar' : '12341'); isolate('#chunk-info'); return; }
  if (type === 'settings') { c.settingsPanels.settings(); await clickLabel({ map: 'Map', rolling: 'Rolling', tasks: 'Tasks', panels: 'Panels', time: 'Time estimates' }[entry.section], c.$('dialog-content')); return; }
  if (type === 'usage-settings' || type === 'usage') { const { renderGalleryUsage } = await import('./gallery-usage.mjs'); return renderGalleryUsage(c, entry); }
  if (type === 'rules') return c.rulesPanel.open();
  if (type === 'rules-profile') {
    const { createRulesPanel } = await import('./rules-panel.mjs');
    createRulesPanel({ ...c.panelContext, registry: () => c.registry, download: safety.download, readJSON: async () => ({ format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: {}, taskRules: {} }), jsonPreview: c.jsonPreview, historyDialog: c.historyDialog,
      api: async route => route === '/api/profile/preview' ? { stateRevision: 7, rules: {}, warnings: [] } : safety.save() }).open();
    c.$('dialog-content').querySelector('input[type="file"]').dispatchEvent(new Event('change')); await waitFrame(); return;
  }
  if (type === 'history') return c.renderHistory(c.state.history);
  if (type === 'coordination' || type === 'partner-undo') {
    const { createDuoCoordination } = await import('./duo-coordination.mjs');
    const event = { ...c.state.history[0], actor: { kind: 'invite', label: 'Player 2', inviteId: 'gallery-player2', memberId: 'player2' } };
    const snapshot = { stateRevision: 7, history: [event], latestUndo: { event, undoRevision: 7, canUndo: true } };
    const panel = createDuoCoordination({ canWrite: c.canWrite, api: async () => snapshot, viewer: { actor: { kind: 'invite', label: 'Player 1', inviteId: 'gallery-player1', memberId: 'player1' }, memberId: 'player1' }, getState: () => c.state, lookups: c.historyLookups,
      el: c.el, button: c.button, openDialog: c.openDialog, closeDialog: c.closeDialog, command: safety.command, openHistory: c.historyDialog,
      undoButton: c.$('undo'), ownHost: c.$('undo-own'), catchUpHost: c.$('duo-catchup'), liveHost: c.$('duo-live'), storage: { getItem: () => '0', setItem: safety.save }, setTimer: () => 0, clearTimer: noOp });
    await panel.refresh();
    if (type === 'partner-undo') return panel.undo();
    c.state.revision = 8; snapshot.stateRevision = 8; snapshot.history.push({ ...event, revision: 8 }); await panel.refresh();
    const host = c.el('div', undefined, 'gallery-state-host'); host.append(c.$('duo-catchup'), c.$('duo-live')); document.body.append(host);
    document.querySelector('.workspace').hidden = document.querySelector('.topbar').hidden = true; return;
  }
  if (type === 'backup') return c.backupDialog();
  if (type === 'migration') { c.backupDialog(); await clickLabel('View migration report'); return; }
  if (type === 'teleports') return c.teleportsDialog();
  if (type === 'search') return c.searchDialog();
  if (type === 'about') return c.mapSourcesDialog();
  if (type === 'original') return c.originalSync.open();
  if (type === 'profile') return c.galleryProfile.open();
  if (type === 'activity') return c.infoPanels.activityInfo(entry.tab);
  if (type === 'bis') return c.infoPanels.currentBiS(entry.tab);
  if (type === 'journal') return c.journal.open();
  if (type === 'members' || type === 'members-confirm') { await c.membersStart.open(); if (type === 'members-confirm') await clickLabel('Review members start'); return; }
  if (type === 'setup-guide') { const { createScreenSetupGuide } = await import('./setup-guide.mjs'); createScreenSetupGuide(c); return c.setupGuide.open(); }
  if (type === 'sandbox') { const { openSandboxRules } = await import('./sandbox-rules.mjs'); return openSandboxRules(c.panelContext); }
  if (type === 'area') {
    c.$('area-check-toggle').click(); await waitFrame();
    c.map.centerOnChunk('12341'); await waitFrame();
    const point = { x: c.map.width / 2, y: c.map.height / 2 }; c.map.pointerTool.corner(point); c.map.pointerTool.corner(point); return;
  }
  if (type === 'xp') return c.openXpChoices();
  if (type === 'roll-confirm') return c.rollChunks(2);
  if (type === 'roll-new') return c.newTaskPopup({ presentation: { tasks: [] } });
  if (type === 'roll-forfeit') return c.unpickDialog();
  if (type === 'roll-stats') return c.rollStatsDialog();
  if (type === 'finish') return c.finishLine.open();
  if (type === 'partner') return c.partnerSupply.open();
  if (type === 'boss-gates') {
    // Sample results carry no gate states; show one of each kind of row.
    const mole = '40 Defence and 40 Attack, Ranged, Magic or Necromancy and the group can get a tier-40 weapon, body and legs in one style';
    const kbd = '40 Defence and 40 Attack, Ranged, Magic or Necromancy and 37 Prayer and the group can get a tier-40 weapon, body and legs in one style';
    const gate = (id, boss, condition, fields) => ({ id, boss, monsters: [boss], condition, open: false, openedBy: null, reason: '', missing: [], gearItems: [], ...fields });
    const samples = {
      player1: [gate('giant-mole', 'Giant Mole', mole, { open: true, openedBy: 'levels', gearItems: ['Steel 2h sword', 'Steel platebody', 'Steel platelegs'] }),
        gate('king-black-dragon', 'King Black Dragon', kbd, { missing: ['Prayer 31/37'] }), gate('vorago', 'Vorago', 'group content, unlocked by hand')],
      player2: [gate('giant-mole', 'Giant Mole', mole, { missing: ['Defence 34/40'] }),
        gate('king-black-dragon', 'King Black Dragon', kbd, { missing: ['Prayer 12/37', 'needs tier-40 melee legs'] }), gate('vorago', 'Vorago', 'group content, unlocked by hand', { open: true, openedBy: 'manual' })],
    };
    for (const member of c.state.members) fixtures.resultFor(member.id).bossGates ??= samples[member.id] ?? samples.player1;
    return c.bossGatesView.open();
  }
  if (type === 'custom') return c.customTaskDialog();
  if (type === 'custom-edit') return c.customTaskDialog(c.state.tasks[0]);
  if (type === 'custom-delete') return c.deleteCustomTaskDialog(c.state.tasks[0]);
  if (type === 'task') return c.showTask(c.result.tasks[2], true);
  if (type === 'item') return c.showItem({ name: 'Bronze hatchet', slot: 'Main hand', class: 'Melee', tier: 1, sources: [] });
  if (type === 'completed') return c.completedView.open();
  if (type === 'tick-active') {
    // The sample sidebar skips the live task render, so hand the menu the rows it shows.
    c.tickActiveTasks.update(c.result.tasks.slice(0, 5), { ready: true, host: c.$('copy-active-tasks')?.parentElement ?? c.$('task-count').parentElement });
    return c.tickActiveTasks.open();
  }
  if (type === 'stickers') return c.mapTools.sticker('12341');
  if (type === 'marker') return c.mapTools.startingChunk();
  if (type === 'download') return c.mapCapture.downloadDialog();
  if (type === 'calculation') return c.engineDetails();
  if (type === 'unavailable') {
    c.result.activityInfo.activities = [{ ...c.result.tasks[0], id: 'missing' }];
    await c.infoPanels.activityInfo('Activities'); await clickLabel('Open task', c.$('dialog-content')); return;
  }
  if (type === 'display') { c.mapDisplay.open(); isolate('#map-display-panel'); return; }
  if (type === 'icons') { c.$('map-pins-open').click(); isolate('#map-pins-panel'); return; }
  if (type === 'stickers-quick') { c.stickerPicker.open('12341', { x: 16, y: 100 }); return; }
  if (type === 'colour') { c.chunkTab = 'contents'; c.showChunk('12341'); await clickLabel('Colour', c.$('chunk-content')); return; }
  if (type === 'pool') {
    const { createScreenPoolRanking } = await import('./pool-ranking.mjs'); createScreenPoolRanking(c); c.poolRanking.mount(); c.$('pool-ranking-toggle').click(); isolate('#pool-ranking-panel'); return;
  }
  if (type === 'helper') {
    c.$('helper-open').click(); await waitFrame();
    const button = document.querySelector(`[data-section="${entry.section}"]`); if (!button) throw new Error('Missing Helper section'); button.click(); return;
  }
  if (type === 'runemetrics') { const { createRuneMetricsControls } = await import('./runemetrics.mjs'); let generation; const controls = createRuneMetricsControls(c.panelContext, { memberId: c.memberId, isCurrent: () => c.dialogCurrent(generation), onApplied: safety.save }); generation = c.openDialog('Sync Player 1 from RuneMetrics', controls); return; }
  if (['overlays', 'invites', 'feedback', 'news', 'roadmap'].includes(type)) {
    const options = { ...c, dialog: c.$('tool-dialog'), members: () => c.state.members, streamSafe: c.streamSafe, storage: null, isAdmin: () => true, isReadOnly: () => false, banner: c.$('update-banner') };
    if (type === 'overlays') { const { createOverlayPanel } = await import('./overlay-panel.mjs'); return createOverlayPanel(options).open(); }
    if (type === 'invites') { const { createInvites } = await import('./invites.mjs'); const panel = createInvites({ ...options, menuButton: c.$('invites-open') }); await panel.loadSession(); return panel.open(); }
    if (type === 'feedback') { const { createFeedback } = await import('./feedback.mjs'); return createFeedback(options).open(); }
    const { createUpdates } = await import('./updates.mjs'); const updates = createUpdates(options); return type === 'news' ? updates.openList() : updates.openRoadmap();
  }
  if (type === 'notice') { c.notice('A sample save failed. Retry when the picker reconnects.', true); isolate('#notice'); return; }
  if (type === 'empty') { for (const member of c.state.members) { member.unlocked = []; member.selected = []; } c.renderMapState(); c.$('active-tasks').replaceChildren(c.el('p', 'No tasks in this view.', 'empty-list')); return; }
  if (type === 'loading') { c.$('task-engine-status').textContent = 'Loading tasks…'; c.$('active-tasks').replaceChildren(); isolate('.task-sidebar'); return; }
  if (type === 'error') { const box = c.$('startup-error'); box.hidden = false; box.replaceChildren(c.el('h2', 'Could not open the picker'), c.el('p', 'Example connection failure.'), c.button('Retry', safety.save)); return; }
  if (type === 'banners') {
    const host = c.el('div', undefined, 'gallery-state-host'); document.body.append(host);
    for (const [id, text] of [['update-banner', 'The picker has been updated.'], ['backup-status-notice', 'The latest backup needs attention.'], ['sandbox-banner', 'Sandbox · These changes are temporary.']]) { const banner = c.$(id); banner.hidden = false; banner.append(c.el('span', text), c.button('Dismiss', () => { banner.hidden = true; })); host.append(banner); }
    document.querySelector('.workspace').hidden = document.querySelector('.topbar').hidden = true; return;
  }
  throw new Error(`Unknown gallery renderer: ${type}`);
}

try {
  const id = new URLSearchParams(location.search).get('entry') ?? 'main', entry = galleryEntries.find(entry => entry.id === id);
  if (!entry) throw new Error('Unknown gallery entry');
  await build(); await render(entry);
  // Factories can start asynchronous fixture reads without returning a promise.
  await waitFrame();
  for (let attempt = 0; attempt < 100 && document.querySelector('#helper-page[aria-busy="true"], #helper-content[aria-busy="true"]'); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  if (c.map.image.src) await c.map.image.decode().catch(noOp);
  await waitFrame(); // Image load invalidates the canvas for the next frame.
  if (fixtures.errors.length) throw new Error(fixtures.errors.join('; '));
  if (document.documentElement.dataset.galleryError) throw new Error(document.documentElement.dataset.galleryError);
  await document.fonts.ready;
  document.documentElement.dataset.galleryTheme = c.preferences().theme;
  if (document.documentElement.dataset.galleryCapture === 'true') {
    const [{ createGalleryCapture }, { themePalettes }] = await Promise.all([import('./gallery-capture.mjs'), import('./map-tools.mjs')]);
    window.__galleryCapture = createGalleryCapture(c, document, themePalettes, waitFrame);
  }
  document.documentElement.dataset.galleryReady = 'true';
} catch (error) { fail(error); }
