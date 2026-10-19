import { createFeedback } from './feedback.mjs';
import { createBackupStatus } from './backup-status.mjs';
import { createUpdates } from './updates.mjs';
import { createRuneMetricsControls } from './runemetrics.mjs';
import { createInvites } from './invites.mjs';
import { createOverlayPanel } from './overlay-panel.mjs';
import { loadTerrainManifest, loadMapPins, createMapPinsPanel } from './map-pins.mjs';
import { hydrateDisplayWorld } from './display-world.mjs';
import { createRuleRegistryFromDefinitions } from './core/rule-registry.mjs';
import { ChunkMap } from './map.mjs';
import { loadIcons } from './icons.mjs';
import { loadMapInformation } from './map-info.mjs';
import { createDuoCoordination } from './duo-coordination.mjs';
import { loadArtStatus, installPictureFallbacks, observeArtStatus } from './art-status.mjs';
import { bindTaskViewPreferences } from './task-view-preferences.mjs';

// Main-screen startup; shared values and callbacks live in the explicit screen context.
export function createScreenStartup(c) {
  let feedbackSessionReady = false;
  function mapChunkClick(id, event) {
    c.closeChunkMenu();
    if (event?.pointerType === 'touch') return c.showChunk(id);
    if (event?.ctrlKey || event?.metaKey) {
      if (!c.canWrite()) return c.notice('View-only link: you can’t change the roll pool.');
      if (c.sandbox.active) return c.notice('Leave Sandbox to change the roll pool.');
      if (!c.world.surface.has(id)) return c.notice('Only surface chunks can be added to the roll pool.');
      if (c.member().unlocked.includes(id)) return c.notice('This chunk is already unlocked. Only locked chunks can be added to the roll pool.');
      if (c.member().pendingRoll.includes(id)) return c.notice('This chunk is a pending roll choice. Finish or cancel the roll first.');
      return c.command({ type: 'set-chunk', memberId: c.memberId, chunkId: id, status: c.member().selected.includes(id) ? 'locked' : 'selected' }).catch(c.showError);
    }
    if (c.canWrite() && (c.sandbox.active || c.preferences().shiftUnlock && event?.shiftKey)) return c.toggleChunk(id).catch(c.showError);
    if (c.preferences().info) { if (!c.$('chunk-info').hidden && c.chunkId === id) c.$('chunk-close').click(); else c.showChunk(id); }
  }
  async function start() {
    feedbackSessionReady = false;
    // Feedback: what the sender is looking at helps reproduce bugs.
    const feedbackPanel = createFeedback({ api: c.api, el: c.el, button: c.button, input: c.input, field: c.field, openDialog: c.openDialog, dialogCurrent: c.dialogCurrent, notice: c.notice, isAdmin: () => c.sessionAdmin, advanced: () => Boolean(c.state) && c.advanced(),
      entryButton: c.$('feedback-open'), isReadOnly: () => !feedbackSessionReady || !c.canWrite(), streamSafe: c.streamSafe,
      context: () => c.state ? ({ player: c.member()?.name ?? '', chunk: c.chunkId && !c.$('chunk-info').hidden ? `${c.chunkId}${c.world.chunks.get(c.chunkId)?.name ? ` ${c.plain(c.world.chunks.get(c.chunkId).name)}` : ''}` : '', tab: c.chunkId && !c.$('chunk-info').hidden ? (c.chunkTab ?? c.defaultChunkTab()) : '', dialog: c.$('tool-dialog').open ? c.$('dialog-title').textContent : '', screen: `${innerWidth}x${innerHeight}`, revision: c.state?.revision ?? 0 }) : ({ screen: `${innerWidth}x${innerHeight}` }) });
    c.$('feedback-open')?.addEventListener('click', () => { if (c.canWrite()) feedbackPanel.open(); });
    c.updates = createUpdates({ el: c.el, button: c.button, openDialog: c.openDialog, api: c.api, banner: c.$('update-banner') });
    c.$('whats-new-open')?.addEventListener('click', () => c.updates.openList());
    c.$('roadmap-open')?.addEventListener('click', () => c.updates.openRoadmap());
    // One click to the RuneMetrics review for the player being viewed (also inside Activity Info).
    c.$('runemetrics-open')?.addEventListener('click', function openRuneMetrics() {
      if (!c.canWrite() || c.supportsFeature?.('runeMetrics') === false) return;
      const owner = c.member(); let generation;
      const controls = createRuneMetricsControls({ ...c.panelContext, field: c.field }, { memberId: owner.id,
        isCurrent: () => c.memberId === owner.id && c.dialogCurrent(generation), onApplied: () => { if (c.dialogCurrent(generation)) openRuneMetrics(); } });
      generation = c.openDialog(`Sync ${owner.name} from RuneMetrics`, controls);
    });
    c.backupStatus = createBackupStatus({ api: c.api, el: c.el, button: c.button, document, isAdmin: () => c.sessionAdmin, advanced: c.advanced, menuLine: c.$('backup-status-menu'), banner: c.$('backup-status-notice'), openBackup: c.backupDialog });
    const invites = createInvites({ api: c.api, el: c.el, button: c.button, input: c.input, field: c.field, openDialog: c.openDialog, dialogCurrent: c.dialogCurrent, dialog: c.$('tool-dialog'), menuButton: c.$('invites-open'), members: () => c.state?.members ?? [], streamSafe: c.streamSafe });
    const overlayPanel = createOverlayPanel({ api: c.api, el: c.el, button: c.button, openDialog: c.openDialog, dialogCurrent: c.dialogCurrent, dialog: c.$('tool-dialog'), members: () => c.state?.members ?? [] });
    c.$('overlays-open')?.addEventListener('click', () => { if (c.sessionAdmin) void overlayPanel.open().catch(c.showError); });
    const viewerSession = invites.loadSession().then(session => { c.applySession(session); if (c.$('overlays-open')) c.$('overlays-open').hidden = !session.admin; feedbackSessionReady = true; c.backupStatus.start(); feedbackPanel.setSession(session); feedbackPanel.start(); return session; });
    globalThis.addEventListener?.('pagehide', () => feedbackPanel.pause());
    globalThis.addEventListener?.('pageshow', event => { if (event.persisted) { c.streamSafe.refreshFromStorage(); feedbackPanel.start(); } });
    c.$('invites-open').addEventListener('click', () => invites.open().catch(c.showError));
    const artwork = loadArtStatus();
    const terrainManifest = c.supportsFeature?.('mapMetadata') === false ? Promise.resolve(null) : loadTerrainManifest();
    const [loaded, data, rules, displayWorld, session] = await Promise.all([c.api('/api/state'), c.api('/api/definitions?view=display-v1'), c.api('/api/rules'), c.api('/api/display-world'), viewerSession]);
    await artwork;
    installPictureFallbacks(document);
    const pictureNotice = c.el('p', undefined, 'art-status'); pictureNotice.setAttribute('role', 'status');
    c.$('map-stage').append(pictureNotice);
    observeArtStatus(art => { pictureNotice.hidden = !art?.placeholderPictures; pictureNotice.textContent = 'Using placeholder pictures'; });
    c.definitions = data; c.definitionsAreFull = Object.keys(data).some(key => key !== 'chunks'); c.world = hydrateDisplayWorld(displayWorld);
    c.registry = createRuleRegistryFromDefinitions(rules.definitions);
    const configuredOwners = new Map(c.owners.map(owner => [owner.id, owner]));
    c.owners = loaded.state.members.map(({ id, name, sourceMapId }) => {
      const mapId = sourceMapId || configuredOwners.get(id)?.mapId;
      return { id, name, ...(mapId ? { mapId } : {}) };
    });
    try { c.memberId = localStorage.getItem('duo-member'); } catch { /* Private browsing may block preference storage. */ }
    if (!loaded.state.members.some(item => item.id === c.memberId)) c.memberId = loaded.state.members.find(item => item.id === c.sessionMember)?.id ?? loaded.state.members[0]?.id;
    c.map = new ChunkMap({ stage: c.$('map-stage'), baseCanvas: c.$('map-base'), stateCanvas: c.$('map-state'), pinCanvas: c.$('map-pins'), hoverCanvas: c.$('map-hover'), tooltip: c.$('map-tooltip'), deferFallback: true, onChunk: c.mapChunkClick,
      canChunkHold: () => !document.documentElement.classList.contains('screenshot-mode'),
      onChunkHold: (id, point) => c.chunkMenu(id, point.clientX, point.clientY, 'touch'),
      onContext: (id, x, y, pointerType) => c.chunkMenu(id, x, y, pointerType) });
    loadIcons().then(loaded => { c.taskIconPainter.settle(loaded); c.categoryIconPainter.settle(loaded); });
    terrainManifest.then(async manifest => {
      c.map.setMapAssets(manifest, { pins: [] });
      if (!manifest) return;
      const assets = await loadMapPins(manifest);
      if (!assets) return;
      c.mapAssets = assets; c.map.setMapPins(assets.manifest, assets.dataset);
      createMapPinsPanel({ panel: c.$('map-pins-panel'), toggle: c.$('map-pins-open'), map: c.map, ...assets, onSources: c.mapSourcesDialog, preferences: c.preferences, canWrite: c.canWrite });
      for (const event of ['click', 'change']) c.$('map-pins-panel').addEventListener(event, () => requestAnimationFrame(c.renderLegend));
      c.renderLegend();
    }).catch(c.showError);
    if (c.supportsFeature?.('mapMetadata') !== false) loadMapInformation().then(information => { if (information) c.map.setMapInformation(information); });
    c.$('chunk-close').addEventListener('click', () => { c.disposeAccessSections(); c.map.setConnectionChunk(null); });
    bindTaskViewPreferences(c.$);
    c.adopt(loaded.state, loaded.pools, undefined, false); c.map.centerOnUnlocked(); c.saved('Saved', false, c.state.revision); void c.loadTasks();
    c.duoCoordination = createDuoCoordination({ canWrite: c.canWrite, api: c.api, viewer: session ?? {}, getState: () => ({ revision: c.state.revision, members: c.state.members, sandboxActive: c.sandbox.active }),
      lookups: () => { const names = c.historyLookups(); return { ...names, chunkName: id => c.advanced() ? `${names.chunkName(id)} (${id})` : names.chunkName(id) }; }, el: c.el, button: c.button, openDialog: c.openDialog, closeDialog: c.closeDialog, command: c.command, openHistory: c.historyDialog,
      undoButton: c.$('undo'), ownHost: c.$('undo-own'), catchUpHost: c.$('duo-catchup'), liveHost: c.$('duo-live'),
      storage: (() => { try { return localStorage; } catch { return null; } })() });
    void c.duoCoordination.refresh();
    c.bindControls();
    c.applyDatasetControls?.();
    c.usage?.start();
    c.connectEvents();
  }

  Object.assign(c, { start, mapChunkClick });
}
