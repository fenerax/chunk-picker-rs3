import { skillIcon, itemIcon } from './icons.mjs';
import { createSettingsPanel } from './settings-panel.mjs';
import { createMembersStart } from './members-start.mjs';
import { createInfoPanels } from './info-panels.mjs';
import { createMapTools } from './map-tools.mjs';
import { createChunkPlanning } from './chunk-planning.mjs';
import { createRulesPanel } from './rules-panel.mjs';
import { createCompletedView } from './completed-view.mjs';
import { createStickerPicker } from './sticker-picker.mjs';
import { createOriginalSync } from './dataset-panels.mjs';
import { mountOriginalSyncControl } from './original-sync-loader.mjs';
import { createDeathChunks } from './death-chunks.mjs';
import { createSandbox } from './sandbox.mjs';
import { createHelperView } from './helper.mjs';
import { createMapDisplay } from './map-display.mjs';
import { loadBiSMemberResult } from './bis-results.mjs';

// Main-screen panels; shared values and callbacks live in the explicit screen context.
export function createScreenPanels(c) {
  c.mapDisplay = createMapDisplay(c);
  c.panelContext = { $: c.$, onTravelRoutes: rows => { c.travelRouteNames ??= new Map(); for (const row of rows) if (row.name) c.travelRouteNames.set(row.id, row.name); }, canWrite: c.canWrite, advanced: c.advanced, skillIcon, itemIcon, state: () => c.state, result: () => c.result, memberId: () => c.memberId, world: () => c.world, definitions: () => c.definitions, selectedChunkId: () => c.chunkId, isChunkOpen: () => !c.$('chunk-info').hidden,
    dialogGeneration: () => c.dialogGeneration, beginDialogRequest: c.beginDialogRequest, dialogCurrent: c.dialogCurrent, isDialogOpen: () => c.$('tool-dialog').open, closeDialog: c.closeDialog,
    questMapControls: options => c.questMap.controls(options),
    openXpChoices: id => c.openXpChoices(id),
    centerOnChunk: id => c.map.centerOnChunk(id), preferences: c.preferences, el: c.el, button: c.button, input: c.input, select: c.select, field: c.field, details: c.details, list: c.list, openDialog: c.openDialog, command: c.command, api: c.api, applyRuneMetrics: c.applyRuneMetrics, showError: c.showError, plain: c.plain, showTask: c.showTask,
    showChunk: id => { c.closeDialog(); c.map.centerOnChunk(id); c.showChunk(id); }, ensureResult: c.ensureFullResult, ensureMemberResult: id => loadBiSMemberResult(c, id), ensurePlanningResult: c.ensurePlanningResult, rulesDialog: c.rulesDialog, startingChunk: () => c.mapTools.startingChunk(), mapDisplay: c.mapDisplay.open,
    predictUnlock: c.predictUnlock, unlockable: id => c.canWrite() && !!c.world?.surface.has(String(id)) && !c.member().unlocked.includes(String(id)) };

  c.panelContext.canWriteMember = id => c.canWrite() && !c.sandbox.active && (!c.sessionMember || c.sessionMember === id);
  c.panelContext.supportsFeature = c.supportsFeature;
  c.panelContext.streamSafe = c.streamSafe;
  c.panelContext.usage = c.usage;
  c.panelContext.membersStartAvailable = () => c.canWrite() && !c.sandbox?.active;
  c.membersStart = createMembersStart({ ...c.panelContext, canWrite: c.panelContext.membersStartAvailable });
  if (c.supportsFeature?.('rsCatalogues') !== false) c.panelContext.membersStart = c.membersStart.open;
  c.settingsPanels = createSettingsPanel(c.panelContext);

  c.infoPanels = createInfoPanels(c.panelContext);

  c.mapTools = createMapTools(c.panelContext);

  c.chunkPlanning = createChunkPlanning(c.panelContext);

  if (c.supportsFeature?.('training') !== false) createHelperView({ api: c.api, command: c.command, usage: c.usage, canWrite: c.canWrite, getState: () => c.state, getPreferences: c.preferences, getMemberId: () => c.memberId, getResult: id => [c.fullResult, c.result, c.normalPlayResults.get(id)].find(value => value?.memberId === id && value.stateRevision === c.state?.revision) });

  c.rulesPanel = createRulesPanel({ ...c.panelContext, registry: () => c.registry, download: c.download, readJSON: c.readJSON, jsonPreview: c.jsonPreview, historyDialog: c.historyDialog });

  c.completedView = createCompletedView({ ...c.panelContext, document, registry: () => c.registry, taskIconPainter: c.taskIconPainter, categoryIconPainter: c.categoryIconPainter, hoverTasks: c.hoverTasks, backlogForm: c.backlogForm,
    isSandbox: () => c.sandbox.active, schedulePaint: callback => requestAnimationFrame(callback), isReviewReady: () => !c.sandbox.active,
    loadResult: c.completedResult,
    loadDetails: owner => c.ensureDuoDetails(owner, false, false) });

  for (const id of ['completed-review', 'completed-open']) c.$(id)?.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation(); c.closeTopMenus();
    const filter = c.duoEnabled() ? c.duoView().filter() : c.memberId;
    c.completedView.open(['all', 'both'].includes(filter) ? 'both' : filter).catch(c.showError);
  });

  c.stickerPicker = createStickerPicker({ el: c.el, button: c.button, command: c.command, host: c.$('map-panel'), state: () => c.state, memberId: () => c.memberId, member: c.member, world: () => c.world, openFullDialog: id => c.mapTools.sticker(id), showError: c.showError });

  if (createOriginalSync && c.supportsFeature?.('originalSync') !== false) {
    mountOriginalSyncControl(c);
    c.originalSync = createOriginalSync(c.panelContext);
  } else c.originalSync = { open() {}, refresh() {} };

  c.$('map-sources-open')?.addEventListener('click', c.mapSourcesDialog);

  c.deathChunks = c.supportsFeature?.('training') === false ? { refresh() {}, panel: () => c.el('span') } : createDeathChunks({ ...c.panelContext, api: c.advisoryApi, map: () => c.map, pool: () => c.pool, isForegroundReady: () => c.canWrite() && c.foregroundSettled(), onMarkersChanged: () => { if (c.sandbox.active) c.map?.setDeathMarkers?.(new Map()); c.renderLegend(); }, setTimeout, clearTimeout });

  c.sandbox = createSandbox({ document, api: c.api, el: c.el, button: c.button, openDialog: c.openDialog, showError: c.showError, notice: c.notice, chunkName: id => c.plain(c.world?.chunks.get(id)?.name ?? ''),
    getSnapshot: () => ({ state: c.state, statePools: c.statePools, result: c.result, fullResult: c.fullResult, shownResult: c.shownResult, memberId: c.memberId }),
    ensureReady: async () => {
      await c.queue; await c.ensureResult(); const requestedMember = c.memberId, revision = c.state.revision;
      await c.api('/api/sandbox/evaluate', { memberId: requestedMember, baseRevision: revision, changes: { unlockChunks: [], lockChunks: [], doneTasks: [] } });
      if (c.memberId !== requestedMember || c.state.revision !== revision) throw new Error('The saved map changed while opening Sandbox. Try again.');
    },
    display: snapshot => { ({ state: c.state, statePools: c.statePools, result: c.result, fullResult: c.fullResult, shownResult: c.shownResult } = snapshot); c.taskFactsCache = undefined; c.planningResults.clear(); c.shownChunkSignature = undefined; c.renderState(); c.$('task-engine-status').textContent = `${c.sandbox.active ? 'Sandbox · ' : ''}${c.result?.metrics.availableCount?.toLocaleString() ?? 0} possible tasks`; },
    onModeChange: active => { c.taskRequest++; c.taskController?.abort(); clearTimeout(c.syncTimer); c.syncTimer = null; c.taskHover?.hide(); c.closeDialog(); c.closeChunkMenu(); c.disposeAccessSections(); if (active) c.map?.setDeathMarkers?.(new Map()); else c.deathChunks.refresh(); },
  });
}
