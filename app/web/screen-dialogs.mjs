import { openSandboxRules } from './sandbox-rules.mjs';
import { openTeleportsDialog } from './teleports.mjs';
import { backupSaveLabel } from './backup-status.mjs';
import { createSearchDialog } from './screen-search.mjs';
import { createBackupUpload, downloadFullBackup } from './backup-transfer.mjs';

// Native textarea focus can reveal only the caret, and progressive details can
// move a control after the browser has scrolled it. Keep the whole focused box
// in the body scrollport without changing focus, selection or the outer page.
export function keepDialogFocusVisible({ document, dialog, content, view = globalThis }) {
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    view.requestAnimationFrame(() => {
      pending = false;
      const active = document.activeElement;
      if (!dialog.open || !content.contains(active) || !content.clientHeight) return;
      const box = active.getBoundingClientRect(), body = content.getBoundingClientRect();
      const top = body.top + content.clientTop, bottom = top + content.clientHeight;
      if (box.height <= content.clientHeight && box.bottom > bottom) content.scrollTop += box.bottom - bottom;
      else if (box.top < top) content.scrollTop += box.top - top;
    });
  };
  dialog.addEventListener('focusin', schedule);
  if (view.MutationObserver) new view.MutationObserver(schedule).observe(content, { childList: true, subtree: true, characterData: true });
  if (view.ResizeObserver) {
    const observer = new view.ResizeObserver(schedule);
    observer.observe(content);
    observer.observe(document.querySelector('.dialog-header'));
  }
}

// Main-screen dialogs; shared values and callbacks live in the explicit screen context.
export function createScreenDialogs(c) {
  const search = createSearchDialog(c);
  let returnFocus, returnToTasks;
  function restoreDialogFocus() {
    let target = returnFocus;
    const closedMenu = target?.closest?.('details:not([open])');
    if (closedMenu) target = closedMenu.querySelector('summary');
    if (!target?.isConnected || target === document.body || target.closest?.('[hidden], dialog:not([open])') || target.checkVisibility?.() === false) {
      target = returnToTasks ? c.$('task-filter') : c.$('map-hover');
      if (target?.closest?.('[hidden]')) target = c.$(`phone-tab-${document.documentElement?.dataset.phoneTab ?? 'map'}`);
      target ??= c.$('map-hover');
    }
    target?.focus({ preventScroll: true });
    returnFocus = undefined; returnToTasks = false;
  }
  function dialogCurrent(generation) { return generation === c.dialogGeneration && c.$('tool-dialog').open; }

  function beginDialogRequest() { search.clear(); return ++c.dialogGeneration; }

  function closeDialog(generation, { focusTarget } = {}) {
    if (generation !== undefined && !c.dialogCurrent(generation)) return;
    // A result can hand focus to the surface it opens instead of its old launcher.
    if (focusTarget) { returnFocus = focusTarget; returnToTasks = false; }
    search.clear(); c.dialogGeneration++; c.$('tool-dialog').close();
  }

  function bindDialogLifecycle() {
    const dialog = c.$('tool-dialog');
    keepDialogFocusVisible({ document, dialog, content: c.$('dialog-content') });
    dialog.addEventListener('close', () => { if (!dialog.open) { search.clear(); restoreDialogFocus(); } });
    dialog.addEventListener('cancel', c.beginDialogRequest); document.querySelector('.dialog-header').addEventListener('submit', c.beginDialogRequest);
    const outside = event => { const box = dialog.getBoundingClientRect?.(); return !!box && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom); };
    let startedOutside = false;
    dialog.addEventListener('pointerdown', event => { startedOutside = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => { if (startedOutside && event.target === dialog && outside(event)) { c.beginDialogRequest(); c.closeDialog(); } startedOutside = false; });
  }

  function openDialog(title, ...nodes) {
    const dialog = c.$('tool-dialog');
    c.usage?.dialogOpened(title, nodes, dialog.open);
    if (!dialog.open && !dialog.contains?.(document.activeElement)) { returnFocus = document.activeElement; returnToTasks = !!returnFocus?.closest?.('.task-sidebar'); }
    search.clear(); c.taskHover?.hide(); for (const hover of c.duoHovers.values()) hover.hide();
    c.dialogGeneration++; c.$('dialog-title').textContent = title; c.$('dialog-content').replaceChildren(...nodes); c.$('dialog-content').scrollTop = 0;
    const modeless = title === 'Search' && typeof dialog.show === 'function';
    if (dialog.open && !!dialog.classList?.contains('search-dialog') !== modeless) dialog.close();
    dialog.classList?.toggle('search-dialog', modeless); dialog.scrollTop = 0;
    if (!dialog.open) { if (modeless) dialog.show(); else dialog.showModal(); }
    c.refreshSaveRecovery?.();
    return c.dialogGeneration;
  }

  function engineDetails(detailResult = c.result) {
    if (!c.advanced() || !detailResult) return;
    if (detailResult.format === 'play-v1' && !c.sandbox.active) {
      const revision = c.state.revision, requestedMember = c.memberId;
      const generation = c.openDialog('Task calculation', c.el('p', 'Loading calculation details…', 'status-detail'));
      return c.ensureFullResult().then(value => { if (c.dialogCurrent(generation) && revision === c.state.revision && requestedMember === c.memberId) c.engineDetails(value); });
    }
    const timing = detailResult.cache?.timingMs ?? {};
    const timings = [['Request', detailResult.cache?.requestMs], ['Engine', timing.engineMs], ['Collections', timing.collectionMs],
      ['Equipment', timing.equipmentMs], ['Presentation', timing.presentationMs], ['Calculation total', timing.totalMs]]
      .filter(([, value]) => Number.isFinite(value) && value >= 0).map(([label, value]) => `${label}: ${Math.round(value)} ms`);
    c.openDialog('Task calculation', c.el('p', 'Possible tasks describe what your accessible chunks can support. Personal quest progress and challenge checks are recorded separately.', 'section-intro'),
      ...(timings.length ? [c.el('p', `${timings.join(' · ')}${detailResult.cache?.hit ? ' · Cached result' : ''}`, 'info-meta')] : []),
      c.lazyJSON('Calculation and coverage', { metrics: detailResult.metrics, coverage: detailResult.coverage, presentation: detailResult.presentation?.coverage }), c.lazyJSON('Training methods', detailResult.training), c.lazyJSON('Data issues', detailResult.diagnostics));
  }

  function searchDialog() { return search.open(); }

  function rulesDialog(options) { return c.sandbox.active ? openSandboxRules(c.panelContext) : c.rulesPanel.open(options); }

  function teleportsDialog() {
    if (c.supportsFeature?.('rsCatalogues') === false) return;
    return openTeleportsDialog(c.panelContext, { uuid: c.browserUUID }).ready;
  }

  function historyLookups() {
    const tasks = new Map([...(c.state.tasks ?? []), ...(c.fullResult?.tasks ?? []), ...(c.result?.tasks ?? [])].map(task => [task.id, c.plain(task.label)]));
    return { memberName: id => c.state.members.find(item => item.id === id)?.name ?? id,
      chunkName: id => { const record = c.world?.chunks.get(id) ?? c.world?.areas.get(id); return record ? c.plain(record.name) || id : id; },
      taskLabel: id => tasks.get(id) ?? id, ruleLabel: id => c.registry?.get?.(id)?.label ?? id, routeLabel: id => c.travelRouteNames?.get(id) ?? id };
  }

  function download(value, name) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = c.el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

  // Keep native button activation; expose the purpose and current filename on it.
  function filePicker(file, purpose) {
    const wrap = c.el('span', undefined, 'file-picker'), name = c.el('span', 'No file chosen', 'file-picker-name');
    const choose = c.button('Choose file…', () => file.click());
    const field = c.field(purpose, wrap, choose);
    const action = c.el('span', choose.textContent); action.id = `${choose.id}-action`;
    choose.replaceChildren(action);
    name.id = `${choose.id}-filename`;
    // Include the visible button text as well as the surrounding purpose label.
    choose.setAttribute('aria-labelledby', `${action.id} ${field.firstChild.id}`);
    choose.setAttribute('aria-describedby', name.id);
    file.className = 'file-picker-input'; file.tabIndex = -1;
    file.addEventListener('change', () => { name.textContent = file.files?.[0]?.name ?? 'No file chosen'; });
    wrap.append(choose, name, file);
    return field;
  }
  async function readJSON(file) { const selected = file.files[0]; if (!selected) throw new Error('Choose a JSON file.'); if (selected.size > 32 * 1024 * 1024) throw new Error('This file is larger than 32 MB.'); try { return JSON.parse(await selected.text()); } catch { throw new Error('The file is not valid JSON.'); } }

  function replacementSummary(preview, incoming) {
    const content = c.el('div', undefined, 'form-stack'); content.append(c.el('p', `This preview uses the current save. If the save changes, preview it again.`, 'status-detail'));
    for (const changes of preview.members) { const row = c.el('section', undefined, 'history-row'), imported = incoming?.members.find(member => member.id === changes.id); row.append(c.el('h3', `${changes.name}${changes.status === 'removed' ? ' · will be removed' : ''}`)); if (imported) row.append(c.el('p', `${imported.unlocked.length} unlocked · ${imported.selected.length} added by hand · ${Object.values(imported.taskStatus ?? {}).filter(status => status.challengeCompleted).length} challenge checks · ${imported.completedTasks.length} personal game completions`)); row.append(c.el('p', `Unlocked: +${changes.unlocked.added.length} / −${changes.unlocked.removed.length} · Hand-added roll pool: +${changes.selected.added.length} / −${changes.selected.removed.length}`, 'status-detail')); content.append(row); }
    for (const changes of preview.members) if (changes.obtainedEquipment?.added.length || changes.obtainedEquipment?.removed.length) content.append(c.el('p', `${changes.name}’s gear recorded by hand: +${changes.obtainedEquipment.added.length} / −${changes.obtainedEquipment.removed.length}`, 'status-detail'));
    if (preview.rules.changed.length) content.append(c.details('Shared rule changes', c.list(preview.rules.changed.map(rule => `${c.registry?.get?.(rule.ruleId)?.label ?? rule.ruleId}: ${rule.before === undefined ? 'Automatic' : rule.before === true ? 'On' : rule.before === false ? 'Off' : rule.before} → ${rule.after === undefined ? 'Automatic' : rule.after === true ? 'On' : rule.after === false ? 'Off' : rule.after}`))));
    if (preview.warnings.length) content.append(c.details(`${preview.warnings.length} replacement warnings`, c.list(preview.warnings.map(warning => warning.replaceAll('selected candidates', 'hand-added roll pool chunks').replaceAll('selected chunks', 'hand-added roll pool chunks').replaceAll('blacklisted chunks', 'chunks set to never roll')))));
    content.append(c.el('p', 'After replacing both maps, Undo only goes back as far as this replacement. Earlier changes remain in History and the full backup.', 'status-detail')); if (c.advanced()) content.append(c.lazyJSON('Detailed replacement changes', preview)); return content;
  }

  function backupDialog() {
    if (!c.state) { c.notice('The picker is still loading. Try again in a moment.'); return; }
    let previewRequest = 0, retainedRequest = 0, reading = false, submitting = false, previewController;
    const statusLine = c.backupStatus?.line();
    void c.backupStatus?.refresh();
    const generic = c.dataset?.capabilities?.independent === true;
    const legacyImport = c.supportsFeature?.('originalSync') !== false;
    const content = c.el('div', undefined, 'form-stack'); content.append(c.el('p', generic ? 'Full backups include maps, tasks, progress, rules, notes and history. Every replacement retains the previous state on the server.' : 'Full backups include both maps, progress, rules, notes, teleport confirmations, original imported records and history. Every replacement retains the previous state on the server.', 'section-intro'), c.button('Download full backup', async () => downloadFullBackup(`${generic ? 'grid-challenge' : 'rs3-duo'}-${new Date().toISOString().slice(0, 10)}.json.gz`, c.panelContext?.pickerSession ? c.panelContext?.pickerSession.fetch : fetch)));
    if (statusLine) content.prepend(statusLine);
    const file = c.input('file'); file.accept = '.json,.json.gz,application/json,application/gzip'; const preview = c.el('div');
    const progress = c.el('p', '', 'status-detail'); progress.setAttribute('role', 'status'); progress.setAttribute('aria-live', 'polite');
    const previewError = c.el('p', '', 'status-detail'); previewError.setAttribute('role', 'alert'); previewError.hidden = true;
    const cancel = c.button('Cancel preview', () => { invalidatePreview(); progress.textContent = 'Preview cancelled.'; previewButton.focus?.(); }); cancel.hidden = true;
    const invalidatePreview = () => { previewRequest++; previewController?.abort(); previewController = undefined; reading = false; previewButton.disabled = false; cancel.hidden = true; progress.textContent = ''; previewError.textContent = ''; previewError.hidden = true; preview.replaceChildren(); };
    // Admins replace both maps or one player's; an invite that owns a player restores only that map.
    const scopes = c.sessionAdmin ? [{ value: '', label: 'Both maps (whole save)' }, ...c.state.members.map(member => ({ value: member.id, label: `Only ${member.name}’s map` }))] : [];
    const scope = scopes.length ? c.select(scopes, '') : null;
    scope?.addEventListener('change', invalidatePreview);
    file.addEventListener('change', invalidatePreview);
    // A picker owner restores the whole save, like an admin choosing Both maps.
    const owner = c.panelContext?.account?.isOwner?.() === true;
    const scopedMember = () => owner ? null : c.sessionAdmin ? scope.value || null : c.sessionMember;
    const read = async (document, generation = c.dialogGeneration, request = ++previewRequest, backupId) => {
      if (reading || submitting) return;
      reading = true; previewButton.disabled = true; previewError.textContent = ''; previewError.hidden = true; preview.replaceChildren(); cancel.hidden = false;
      const controller = new AbortController(); previewController = controller;
      const stage = text => { if (previewController === controller && c.dialogCurrent(generation) && request === previewRequest) progress.textContent = text; };
      stage(backupId !== undefined ? 'Checking replacement…' : 'Preparing backup…');
      try {
      if (!c.dialogCurrent(generation) || request !== previewRequest) return; const memberScope = scopedMember();
      const path = memberScope ? '/api/member-restore' : '/api/restore';
      const payload = backupId !== undefined ? { backupId, ...(memberScope ? { memberId: memberScope } : {}) }
        : createBackupUpload(file.files[0], { members: c.owners, ...(memberScope ? { memberId: memberScope } : {}) }, { onStage: stage });
      const value = await c.api(`${path}/preview`, payload, controller.signal); if (!c.dialogCurrent(generation) || request !== previewRequest) return; const expectedRevision = (value.preview ?? value).currentRevision;
      preview.replaceChildren(c.el('h3', 'Review replacement'), c.el('p', memberScope ? `Applying this replaces ${c.state.members.find(member => member.id === memberScope)?.name ?? 'this player'}’s map only. Undo can reverse it.` : owner ? 'Applying this replaces the whole picker with the previewed state, including rules and History. Undo can’t reverse it; the current save stays under Browse previous saves. Download a full backup above to keep a portable copy.' : 'Applying this replaces the saved group with the previewed state. Download a full backup above to keep a portable copy.', 'warning'), c.replacementSummary(value.preview ?? value, value.state ?? document?.state));
      if (value.warnings?.length) preview.append(c.details('Import warnings', c.list(value.warnings)));
      const apply = c.button('Apply reviewed replacement', async () => {
        if (apply.disabled || !c.dialogCurrent(generation) || request !== previewRequest) return;
        submitting = true; apply.disabled = true; previewButton.disabled = true; file.disabled = true; if (scope) scope.disabled = true;
        progress.textContent = 'Applying replacement…';
        try {
          const response = await c.api(path, { ...payload, expectedRevision }); c.adopt(response.state, response.pools); c.saved('Saved', false, c.state.revision, { confirmed: true });
          if (!c.dialogCurrent(generation)) return;
          c.closeDialog(generation); c.map.centerOnUnlocked(); c.notice(memberScope ? `${c.state.members.find(member => member.id === memberScope)?.name ?? 'The'}’s map was replaced. Undo can reverse it.` : owner ? 'Backup restored. The previous save is under Browse previous saves.' : legacyImport ? 'Import saved. Your imported records and previous save are kept in the backup.' : 'Backup restored. The previous save is retained, and Undo can reverse this replacement.');
        } catch (error) { if (c.dialogCurrent(generation)) { progress.textContent = 'Replacement was not confirmed. Check History before trying again.'; c.showError(error); } }
        finally { submitting = false; if (c.dialogCurrent(generation)) { previewButton.disabled = false; file.disabled = false; if (scope) scope.disabled = false; } }
      });
      preview.append(apply); stage('Replacement ready to review.');
      } catch (error) { if (error.name !== 'AbortError' && c.dialogCurrent(generation) && request === previewRequest) { progress.textContent = 'Preview failed. Try again.'; previewError.textContent = `${error.message || String(error)} Choose a full backup downloaded with Download full backup above.`; previewError.hidden = false; } }
      finally { if (previewController === controller) { previewController = undefined; reading = false; previewButton.disabled = false; cancel.hidden = true; } }
    };
    const retained = c.el('div', undefined, 'form-stack'); retained.append(c.button('Browse previous saves', async () => {
      const generation = c.dialogGeneration, request = ++retainedRequest, response = await c.api('/api/backups');
      if (!c.dialogCurrent(generation) || request !== retainedRequest) return;
      if (!response.backups.length) { retained.replaceChildren(c.el('p', 'No previous saves yet.')); return; }
      const lookups = c.historyLookups(), choices = c.select(response.backups.map(backup => ({ value: backup.id, label: backupSaveLabel(backup, lookups) })), response.backups[0].id);
      const summary = c.el('p', '', 'retained-save-summary'), technical = c.el('div');
      const selected = () => {
        const backup = response.backups.find(item => item.id === choices.value);
        summary.textContent = backupSaveLabel(backup, lookups);
        technical.replaceChildren(...(c.advanced() ? [c.lazyJSON('Save details', { label: `Revision ${backup.revision} · ${new Date(backup.at).toLocaleString()} · ${Math.round(backup.bytes / 1024)} KB`, ...backup })] : []));
      };
      choices.addEventListener('change', () => { invalidatePreview(); selected(); }); selected();
      retained.replaceChildren(c.field('Previous save', choices), summary, technical, c.button('Preview selected snapshot', async () => {
        const generation = c.dialogGeneration, request = ++previewRequest;
        await read(undefined, generation, request, choices.value);
      }));
    }));
    const ownName = c.state.members.find(member => member.id === c.sessionMember)?.name;
    if (!owner && !c.sessionAdmin && !ownName) { content.append(c.el('p', 'This link isn’t linked to a player, so it can’t restore a map. Ask an admin to set its player.', 'status-detail')); return; }
    if (owner) content.append(c.el('p', 'Restoring here replaces this whole picker: maps, progress, rules, notes and History. Undo can’t reverse it, but the current save is kept and listed under Browse previous saves.', 'status-detail'));
    else if (scope) content.append(c.field('Replace', scope));
    else content.append(c.el('p', `Restoring here replaces only ${ownName}’s map. The other map, shared rules and History stay, and Undo can reverse it.`, 'status-detail'));
    const previewButton = c.button(legacyImport ? 'Preview import / restore' : 'Preview restore', () => read());
    content.append(filePicker(file, legacyImport ? 'Choose a full backup or an exported copy of both maps' : 'Choose a full backup'), c.el('p', 'Choose .json or .json.gz. Backups download compressed. Limit: 256 MiB after decompression.', 'status-detail'), previewButton, progress, previewError, cancel, preview, retained, ...(legacyImport && c.advanced() ? [c.button('View migration report', async () => { const generation = c.beginDialogRequest(), value = await c.api('/api/migration'); if (c.dialogCurrent(generation)) c.openDialog('Migration report', c.lazyJSON('Imported names and unmatched records', value)); })] : [])); c.openDialog('Backup & Import', content);
    c.$('tool-dialog')?.addEventListener('close', () => { previewController?.abort(); }, { once: true });
  }

  function mapSourcesDialog() {
    const content = c.el('div', undefined, 'form-stack');
    if (c.dataset?.capabilities?.independent === true) {
      content.append(c.el('p', (c.dataset.status?.() ?? c.dataset).description || 'This small coordinate world and its goals were independently written.'), c.el('p', 'The map uses a plain grid and placeholder pictures. This dataset supports territory, tasks, notes, history and sharing.', 'status-detail'));
      c.openDialog('About / Map sources', content); return;
    }
    const link = (label, href) => { const anchor = c.el('a', label); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor; };
    content.append(c.el('p', 'RuneScape map artwork and icons belong to Jagex Limited. This independent picker is not endorsed by or affiliated with Jagex.'),
      link('Jagex Fan Content Policy', 'https://legal.jagex.com/docs/policies/fan-content-policy'));
    content.append(c.el('h3', 'Map contributors'), c.el('p', 'Terrain rendering and coordinate data: Mejrs and the RuneScape Wiki mapping contributors. RuneScape Wiki is operated by Weird Gloop.'),
      link('Mejrs mapping project', 'https://github.com/mejrs/mejrs.github.io'), link('RuneScape Wiki mapping project', 'https://runescape.wiki/w/RuneScape:Map'), link('Weird Gloop', 'https://weirdgloop.org/'));
    if (c.mapAssets) {
      const { manifest, dataset } = c.mapAssets;
      const imported = manifest.retrievedAt ?? manifest.importedAt ?? manifest.generatedAt ?? manifest.createdAt;
      content.append(c.el('h3', 'Local map snapshot'), c.el('p', `Pins: ${dataset.snapshotDate ?? manifest.pins.snapshotDate ?? '2021-12-18'} · ${dataset.sourceKind === 'copied-cache' ? 'copied game-cache export' : 'community snapshot'}. Some icons depend on in-game conditions that have not been checked.`, 'status-detail'));
      if (imported) content.append(c.el('p', `Terrain imported: ${imported}. Repository dates do not establish the cache date of every tile.`, 'status-detail'));
      else content.append(c.el('p', 'Terrain dates and source versions are recorded in the local manifest. Tile cache dates are not verified.', 'status-detail'));
      if (c.advanced()) content.append(link('Local map source data', '/assets/map/manifest.json'));
      if (c.advanced() && manifest.pins.manifestPath) content.append(link('Cache pin provenance manifest', `/assets/map/${manifest.pins.manifestPath}`));
      if (c.advanced() && manifest.terrain.commit) content.append(c.el('p', `Terrain source commit: ${manifest.terrain.commit}${manifest.terrain.commitDate ? ` (${manifest.terrain.commitDate})` : ''}`, 'status-detail'));
      content.append(c.el('p', 'Separate local terrain and coordinate pins are displayed. The icons use checked categories from the Wiki legend. Other icon types are not shown.', 'status-detail'));
      content.append(c.el('p', 'Terrain uses community tiles, then available cache-rendered tiles, then the original image. Icons baked into the original image cannot be filtered. Some icons depend on in-game conditions. Instance locations still need checking.', 'status-detail'));
    } else content.append(c.el('h3', 'Built-in map'), c.el('p', 'The built-in reference image is active. Its icons are part of the image and cannot be filtered. A local terrain and pin import enables the Map icons control.', 'status-detail'));
    content.append(link('Terrain repository', 'https://github.com/mejrs/layers_rs3'), link('Pin snapshot and labels', 'https://github.com/mejrs/data_rs3/tree/b8424a43d8370adc71de53f7d6438ad0f77d0944'),
      link('Wiki icon legend and file credits', 'https://runescape.wiki/w/Icon'), link('Wiki licensing policy', 'https://meta.weirdgloop.org/w/Licensing'),
      c.el('p', 'Community asset repositories do not declare a reuse licence. Wiki text licensing does not cover Jagex artwork; source attribution does not establish redistribution permission.', 'status-detail'));
    c.openDialog('About / Map sources', content);
  }

  Object.assign(c, { dialogCurrent, beginDialogRequest, closeDialog, bindDialogLifecycle, openDialog, engineDetails, searchDialog, rulesDialog, teleportsDialog, historyLookups, download, readJSON, replacementSummary, backupDialog, mapSourcesDialog });
}
