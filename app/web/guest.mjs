import { createGuestTransport } from './guest-transport.mjs';
import { configurePickerStorage } from './screen-save-status.mjs';

try {
  let screen;
  const guest = await createGuestTransport({ changed: () => {
    screen?.notice('This save changed in another tab. Reload before making another change.', true);
    const badge = document.getElementById('save-status'); badge.textContent = 'Reload browser save'; badge.dataset.status = 'failed';
  } });
  // Dataset/bootstrap and optional presentation loaders share this document's
  // guest-only transport. Member documents never import this entrypoint.
  globalThis.fetch = guest.fetch;
  // Resolve the public artwork inventory before the shared map chooses its
  // fallback image. Independent datasets deliberately have no artwork.
  const { loadArtStatus } = await import('./art-status.mjs');
  await loadArtStatus(guest.fetch);
  configurePickerStorage(`guest-${guest.backup.state.provenance.dataset.digest}`);
  const { createPickerScreen } = await import('./main.mjs');
  const disabled = new Set(['runeMetrics', 'originalSync', 'gallery', 'training']);
  screen = createPickerScreen({
    configureTransport(c) {
      c.panelContext.pickerSession.fetch = guest.fetch;
      c.panelContext.guest = true;
      c.supportsFeature = ((original) => feature => !disabled.has(feature) && original(feature))(c.supportsFeature);
      return { commandClient: guest.commandClient };
    },
    configureScreen(c) {
      c.connectEvents = () => {};
      c.usage = undefined;
      c.panelContext.usage = undefined;
      c.gamePlugin.refresh = async () => {};
      c.panelContext.gamePlugin = undefined;
      c.panelContext.applyRuneMetrics = undefined;
      c.panelContext.guest = true;
      c.panelContext.membersStart = undefined;
      c.panelContext.membersStartAvailable = () => false;
      c.groupGoals = { render() {} };
      c.deathChunks = { refresh() {}, panel: () => c.el('p', 'Sign in for death estimates. Guest calculations are limited to one chunk at a time.', 'field-help') };
      const showChunk = c.showChunk;
      c.showChunk = (...args) => {
        const tab = c.chunkId === String(args[0]) ? c.phoneLayout?.tab : undefined;
        const result = showChunk(...args);
        if (tab) c.phoneLayout.select(tab, { persist: false });
        return result;
      };
      c.historyDialog = () => c.renderHistory(c.state.history);
      c.panelContext.supportsFeature = c.supportsFeature;
      const applyControls = c.applyDatasetControls;
      c.applyDatasetControls = () => {
        applyControls();
        for (const id of ['admin-tools', 'account-tools', 'account-open', 'invites-open', 'accounts-open', 'overlays-open', 'usage-open', 'gallery-open',
          'feedback-open', 'runemetrics-open', 'game-plugin-open', 'original-sync-open', 'partner-supply-open', 'whats-new-open', 'roadmap-open']) {
          const node = c.$(id); if (node) node.hidden = true;
        }
        for (const id of ['sandbox-toggle', 'pool-ranking-toggle', 'area-check-toggle', 'helper-open', 'members-preview-open']) {
          const node = c.$(id); if (node) { node.disabled = true; node.title = 'Sign in for bulk previews. Guest calculations are limited to one chunk at a time.'; node.setAttribute('aria-describedby', 'guest-preview-limit'); }
        }
        c.$('group-goals').hidden = true;
        c.$('group-view').checked = false;
        c.$('group-view').closest('label').hidden = true;
        document.querySelector('.member-picker').hidden = true;
        c.$('empty-map-title').textContent = 'Start your browser map';
        c.$('empty-map-instructions').textContent = 'Choose a starting chunk on the map or use Search. Export / Import can restore a portable solo save.';
        c.$('empty-import').hidden = true;
      };
      c.backupDialog = () => {
        const box = c.el('div', undefined, 'form-stack');
        const status = c.el('p', 'Cloud backups need an account. Download your browser save to keep or move it.', 'status-detail'); status.setAttribute('role', 'status');
        const download = c.button('Download save', () => c.download(JSON.parse(guest.save.exportText()), 'chunk-picker-guest.json'));
        const file = c.input('file'); file.accept = '.json,application/json'; file.id = 'guest-import-file';
        const label = c.field('Import a portable solo save', file);
        const restore = c.button('Import save', async () => {
          const selected = file.files[0];
          if (!selected) { status.textContent = 'Choose a save file first.'; file.focus(); return; }
          if (selected.size > 2 * 1024 ** 2 - 4096) throw new Error('This guest save is too large. Keep it to import after signing in.');
          const text = await selected.text(); guest.save.parseImport(text);
          if (!confirm('Replace this browser’s guest save? Download your current save first if you want to keep it.')) return;
          restore.disabled = true;
          // A replacement can have an older revision or a different member.
          // Start a new screen so revision guards and derived caches reset.
          try { await guest.importText(text); location.reload(); }
          finally { restore.disabled = false; }
        });
        box.append(status, download, label, restore); c.openDialog('Export / Import', box);
      };
      const saved = c.saved;
      c.saved = (text, error, revision, details) => saved(text === 'Saved' ? 'Saved in this browser' : text, error, revision, details);
    },
  });
  document.documentElement.dataset.guest = 'true';
  document.title = 'Guest picker · Chunk Picker RS3';
  const banner = screen.el('aside', undefined, 'guest-notice'); banner.id = 'guest-notice';
  const notice = screen.el('span'); notice.append(screen.el('strong', 'This save is only on this browser. '), 'Clearing site data removes it.');
  const details = screen.el('details'), summary = screen.el('summary', 'About guest mode');
  details.append(summary, screen.el('p', 'Calculations use the server temporarily; your save is never stored there. Groups, invites, progress sync, plugin keys, OBS overlays and cloud backups need an account. Download your guest save before signing in to import it into your new picker.'));
  const signIn = screen.el('a', 'Sign in'); signIn.href = '/auth/signin';
  const previewLimit = screen.el('small', 'Bulk previews need an account; guests can preview one chunk at a time.', 'sr-only'); previewLimit.id = 'guest-preview-limit';
  banner.append(previewLimit);
  banner.append(notice, screen.button('Export / Import', screen.backupDialog), screen.button('Reload save', () => location.reload()), signIn, details);
  document.querySelector('.topbar').after(banner);
  window.addEventListener('storage', event => { if (event.key === guest.save.key || event.key === null) guest.markStale(); });
  await screen.start();
} catch (error) {
  const { showStartupError } = await import('./startup-read.mjs'); showStartupError(error);
}
