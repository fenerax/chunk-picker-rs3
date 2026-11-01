import { gameStorage } from './screen-save-status.mjs';
import { originalSettings } from './data/settings.mjs';
import { applyTheme } from './map-tools.mjs';
import { createStreamSafe } from './stream-safe.mjs';

// Main-screen settings; shared values and callbacks live in the explicit screen context.
export function createScreenSettings(c) {
  c.streamSafe = createStreamSafe({ el: c.el, button: c.button, input: c.input, indicator: c.$('stream-safe-indicator'), menuButton: c.$('stream-safe-toggle') });
  function preferences(id = c.memberId) {
    const owner = c.state.members.find(item => item.id === id);
    return { ...originalSettings, theme: 'dark', roll2: true, taskSidebar: true, taskSearchbar: true, hideChecked: true,
      ...c.state.legacy?.maps?.[owner?.sourceMapId]?.settings,
      advanced: false, showTaskHow: true, ...owner?.preferences,
      ...(!c.canWrite() ? { advanced: false, info: true, recent: true, topButtons: true, chunkTasks: true, taskSidebar: true, taskSearchbar: true, ...c.viewerPreferences } : {}), ...c.mapDisplay?.sizes };
  }

  function setViewerPreference(id, value) {
    if (c.canWrite() || !['theme', 'ids'].includes(id)) return;
    c.viewerPreferences[id] = value;
    try { gameStorage().setItem('picker.viewer-preferences', JSON.stringify(c.viewerPreferences)); } catch { /* Display remains usable without storage. */ }
    c.preferenceSignature = undefined; c.applyPreferences(); c.renderMapState();
  }

  function applySession(session) {
    c.preferenceSignature = undefined;
    c.sessionReadOnly = session.readOnly === true || session.canWrite === false || session.capabilities?.canWrite === false;
    c.sessionAdmin = !c.sessionReadOnly && session.adminAvailable !== false && session.admin === true;
    c.$('admin-tools').hidden = !c.sessionAdmin;
    if (!c.sessionAdmin) c.$('admin-tools').open = false;
    c.sessionMember = session.memberId ?? null;
    c.streamSafe.sessionReady();
    document.documentElement.dataset.readOnly = String(c.sessionReadOnly);
    if (c.sessionReadOnly) {
      try {
        const saved = JSON.parse((session.multiPicker ? gameStorage() : localStorage).getItem('picker.viewer-preferences') ?? '{}');
        if (['dark', 'gray', 'light'].includes(saved.theme)) c.viewerPreferences.theme = saved.theme;
        if (typeof saved.ids === 'boolean') c.viewerPreferences.ids = saved.ids;
      } catch { /* Invalid or unavailable local preferences use the map defaults. */ }
    }
    c.$('view-only-badge').hidden = !c.sessionReadOnly;
  }

  function applyPreferences() {
    const prefs = c.preferences(), signature = `${c.memberId}:${JSON.stringify(prefs)}`;
    if (signature === c.preferenceSignature) return;
    c.preferenceSignature = signature;
    applyTheme(document.documentElement, prefs.theme, prefs.completedTaskColor);
    for (const theme of ['dark', 'gray', 'light']) c.$(`theme-${theme}`)?.setAttribute('aria-pressed', String(theme === prefs.theme));
    document.documentElement.style.setProperty('--completed-decoration', prefs.completedTaskStrikethrough ? 'line-through' : 'none');
    c.$('hide-completed').checked = prefs.hideChecked;
    c.$('task-filter').hidden = !prefs.taskSearchbar;
    document.querySelector('label[for="task-filter"]').hidden = !prefs.taskSearchbar;
    let restoreSearch = c.$('show-task-search');
    if (!restoreSearch && !prefs.taskSearchbar) {
      restoreSearch = c.button('Show task search', async () => {
        await c.command({ type: 'set-preference', memberId: c.memberId, preferenceId: 'taskSearchbar', value: true });
        c.$('task-filter').focus();
      });
      restoreSearch.id = 'show-task-search';
      c.$('task-filter').after(restoreSearch);
    }
    if (restoreSearch) { restoreSearch.hidden = !!prefs.taskSearchbar; restoreSearch.disabled = !c.canWrite() || c.sandbox.active; }
    document.querySelector('.task-sidebar').hidden = !prefs.chunkTasks;
    document.querySelector('.workspace').dataset.sidebar = prefs.chunkTasks ? prefs.taskSidebar ? 'expanded' : 'compact' : 'hidden';
    c.$('bis-open').hidden = c.$('activity-open').hidden = !prefs.topButtons;
    c.$('roll-two').hidden = !prefs.roll2;
    c.$('unpick').hidden = !prefs.unpick;
    c.$('history-open').hidden = !prefs.recent;
    c.$('recent-panel').hidden = !prefs.recent;
    if (!prefs.info) { c.$('chunk-info').hidden = true; c.disposeAccessSections(); c.map?.setConnectionChunk?.(null); }
    c.mapDisplay?.refresh();
    if (!c.canWrite()) for (const id of ['settings-open', 'game-plugin-open', 'runemetrics-open', 'feedback-open', 'teleports-open', 'invites-open', 'backup-open', 'original-sync-open', 'pick', 'roll-two', 'unpick', 'undo', 'sandbox-toggle', 'custom-task-open', 'empty-import', 'random-start']) { const node = c.$(id); if (node) node.hidden = node.disabled = true; }
    c.applyDatasetControls?.();
  }

  const advanced = () => c.canWrite() && c.preferences().advanced === true;
  Object.assign(c, { preferences, applyPreferences, setViewerPreference, applySession, advanced });

  c.member = () => c.state.members.find(item => item.id === c.memberId);
}
