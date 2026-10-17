import { applyTheme } from './map-tools.mjs';
import { observeScreenBars } from './phone-layout.mjs';

const topMenuIds = ['info-tools', 'admin-tools', 'more-tools'];

// One Escape dismisses only the foremost surface, including modeless Search.
export function handleScreenEscape(c, event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (c.$('tool-dialog').open) c.closeDialog();
  else if (c.stickerPicker.isOpen()) c.stickerPicker.close({ restoreFocus: true });
  else {
    const menu = topMenuIds.map(id => c.$(id)).find(node => node?.open);
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    else if (c.mapDisplay?.isOpen()) c.mapDisplay.close();
    else if (!c.$('map-menu').hidden) { c.closeChunkMenu(); c.$('map-hover').focus(); }
    else if (!c.$('chunk-info').hidden) c.$('chunk-close').click();
    else return;
  }
  event.preventDefault();
}

// Toolbar, member switching, task filters, menus, shortcuts and responsive sizing.
export function createScreenControls(c) {
  function bindControls() {
    c.$('help-open')?.addEventListener('click', () => c.openDialog('Help', c.mapControls()));
    c.mapCapture?.mount();
    c.$('member').addEventListener('change', () => { const nextMember = c.$('member').value; if (c.sandbox.active) { c.sandbox.exit(); c.notice('Sandbox closed. Start Sandbox again to try changes for this player.'); } c.memberId = nextMember; c.result = c.fullResult = undefined; c.taskRequest++; c.taskController?.abort(); c.closeDialog(); c.stickerPicker.close(); c.closeChunkMenu(); try { localStorage.setItem('duo-member', c.memberId); } catch {} c.renderState(); c.map.centerOnUnlocked(); c.scheduleTasks(); });
    if (c.canWrite()) c.sandbox.mount();
    c.poolRanking?.mount();
    for (const id of c.dockPanels) c.dockObserver?.observe(c.$(id), { attributes: true, attributeFilter: ['hidden'] });
    // Appearance is a personal display preference, saved like the Settings theme.
    c.$('theme-switch')?.addEventListener('click', event => { const theme = event.target.closest?.('[data-theme-choice]')?.dataset.themeChoice; if (!theme || theme === document.documentElement.dataset.theme) return; if (!c.canWrite()) { c.setViewerPreference('theme', theme); return; } applyTheme(document.documentElement, theme, c.preferences().completedTaskColor); for (const value of ['dark', 'gray', 'light']) c.$(`theme-${value}`)?.setAttribute('aria-pressed', String(value === theme)); c.command({ type: 'set-preference', memberId: c.memberId, preferenceId: 'theme', value: theme }).catch(error => { c.preferenceSignature = undefined; c.applyPreferences(); c.showError(error); }); });
    c.$('group-view').addEventListener('change', c.renderState); c.$('center-map').addEventListener('click', () => c.map.centerOnUnlocked()); c.$('membership-overlay').addEventListener('click', () => c.setMembershipOverlay(c.$('membership-overlay').getAttribute('aria-pressed') !== 'true')); c.setMembershipOverlay(c.storedOverlay() === 'membership'); c.$('zoom-in').addEventListener('click', () => c.map.zoomBy(1.3)); c.$('zoom-out').addEventListener('click', () => c.map.zoomBy(1 / 1.3)); c.$('chunk-close').addEventListener('click', () => { const focused = c.$('chunk-info').contains(document.activeElement); c.$('chunk-info').hidden = true; c.syncPredictionIntents(); if (focused) c.$('map-hover').focus(); });
    c.$('pick').addEventListener('click', () => c.rollChunks(1)); c.$('roll-two').addEventListener('click', () => c.rollChunks(2)); c.$('undo').addEventListener('click', () => (c.duoCoordination ? c.duoCoordination.undo() : c.command({ type: 'undo' })).catch(c.showError)); c.$('random-start').addEventListener('click', () => c.command({ type: 'random-start', memberId: c.memberId }).then(() => c.map.centerOnUnlocked()).catch(c.showError));;
    c.bindTaskSearch();
    for (const id of ['hide-completed', 'show-blocked', 'show-all']) c.$(id).addEventListener('change', c.renderTasks);
    for (const [detailId, listId] of [['completed-details', 'completed-tasks'], ['backlog-details', 'backlog-tasks']]) c.$(detailId).addEventListener('toggle', () => {
      if (!c.$(detailId).open) return;
      const jobs = [];
      if (listId === 'backlog-tasks') c.renderBacklog(c.taskListRows.get(listId) ?? [], jobs);
      else c.renderCompleted(c.taskListRows.get(listId) ?? [], jobs);
      void c.paintTaskJobs(jobs, c.taskRenderGeneration);
    });
    c.$('accessible-areas').parentElement?.addEventListener('toggle', () => { if (c.$('accessible-areas').parentElement.open) c.$('accessible-areas').replaceChildren(c.list(c.result?.access.areas ?? [])); });
    const actions = { 'search-open': c.searchDialog, 'rules-open': c.rulesDialog, 'settings-open': c.settingsPanels.settings, 'unpick': c.unpickDialog, 'bis-open': c.infoPanels.currentBiS, 'activity-open': c.infoPanels.activityInfo, 'teleports-open': c.teleportsDialog, 'history-open': c.historyDialog, 'backup-open': c.backupDialog, 'original-sync-open': c.originalSync.open, 'empty-import': c.backupDialog, 'custom-task-open': c.customTaskDialog }; for (const [id, action] of Object.entries(actions)) c.$(id)?.addEventListener('click', () => Promise.resolve().then(action).catch(c.showError));
    document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !c.$('tool-dialog').open) { event.preventDefault(); c.searchDialog(); } });
    document.addEventListener('keydown', event => handleScreenEscape(c, event));
    document.addEventListener('pointerdown', event => {
      if (!c.$('map-menu').hidden && !c.$('map-menu').contains(event.target)) c.closeChunkMenu();
      if (c.stickerPicker.isOpen() && !c.stickerPicker.element.contains(event.target) && !event.target.closest?.('.sticker-action')) c.stickerPicker.close();
    });
    c.$('map-stage').addEventListener('wheel', () => { c.closeChunkMenu(); c.stickerPicker.close(); }, { passive: true });
    c.bindDialogLifecycle();
    // Top bar menus: one open at a time; a choice, an outside click or Escape closes them.
    const menus = topMenuIds.map(id => c.$(id)).filter(Boolean);
    for (const menu of menus) menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      for (const other of menus) if (other !== menu) other.open = false;
      if (menu.id === 'more-tools') void c.backupStatus.refresh();
    });
    document.querySelector('.topbar nav').addEventListener('click', event => { if (event.target.closest('button, a')) c.closeTopMenus(); });
    document.addEventListener('click', event => { for (const menu of menus) if (!menu.contains(event.target)) menu.open = false; });
    observeScreenBars(document);
    const toolbarLayout = new ResizeObserver(() => c.$('map-panel').style.setProperty('--map-toolbar-height', `${document.querySelector('.map-toolbar').getBoundingClientRect().height}px`)); toolbarLayout.observe(document.querySelector('.map-toolbar'));
    c.phoneLayout?.mount();
  }

  const closeTopMenus = () => { for (const id of topMenuIds) if (c.$(id)) c.$(id).open = false; };
  Object.assign(c, { bindControls, closeTopMenus });
}
