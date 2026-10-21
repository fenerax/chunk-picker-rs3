import { skillChangeText } from './runemetrics.mjs';

const MAX_AGE = 10 * 60 * 1000;
const date = value => value ? new Date(value).toLocaleString() : 'Never';
export function positionAge(seenAt, now = Date.now()) {
  const age = now - new Date(seenAt).getTime();
  return Number.isFinite(age) && age >= -30000 && age < MAX_AGE ? Math.max(0, age) : null;
}
const ageText = age => age < 60000 ? 'just now' : `${Math.floor(age / 60000)}m ago`;
const reviewText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
const achievementReasons = { unclear: 'Choose the matching task.', beta: 'Reported from a beta world. Check against your main account.', 'world-unknown': 'World type was not reported. Check before applying.', retry: 'Automatic ticking could not finish. Review and try applying here.' };

// Position annotations are advisory. They never change map access or roll rules.
export function drawGamePluginPositions(ctx, map, pointForChunk, now = Date.now()) {
  const visible = new Map((map.members ?? map.visibleMembers ?? []).map(owner => [owner.id, owner]));
  const occupied = new Map();
  for (const row of map.gamePluginPositions ?? []) {
    const owner = visible.get(row.memberId), age = positionAge(row.seenAt, now), point = pointForChunk(row.chunkId);
    if (!owner || age === null || !point) continue;
    const size = 128 * map.zoom, position = row.position;
    const x = map.offset.x + (point.x + .5) * size;
    const y = map.offset.y + (point.y + .5) * size;
    if (x < -100 || y < -40 || x > map.width + 100 || y > map.height + 40) continue;
    const label = `${owner.name} · ${ageText(age)}${position?.floor ? ` · floor ${position.floor}` : ''}`;
    const cell = `${Math.round(x / 60)}:${Math.round(y / 30)}`, stack = occupied.get(cell) ?? 0;
    occupied.set(cell, stack + 1);
    ctx.save(); ctx.globalAlpha = Math.max(.2, 1 - age / MAX_AGE);
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = owner.color; ctx.fill(); ctx.strokeStyle = '#111820'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '600 12px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const width = ctx.measureText(label).width + 12;
    const left = Math.max(2, Math.min(map.width - width - 2, x + 10)), top = Math.max(2, Math.min(map.height - 22, y - 10 + stack * 23));
    ctx.fillStyle = '#111820'; ctx.fillRect(left, top, width, 21);
    ctx.fillStyle = '#fff'; ctx.fillText(label, left + 6, top + 10.5); ctx.restore();
  }
}

export function createGamePlugin(c) {
  let snapshot = { keys: [], positions: [], active: false }, inFlight, timer, stopped = false;
  const listeners = new Set();
  const writable = memberId => c.canWrite() && !c.sandbox?.active && (c.sessionAdmin || c.sessionMember === memberId);
  function paint() {
    c.map?.setGamePluginPositions(snapshot.positions ?? []);
    for (const listener of listeners) listener();
  }
  function schedule() {
    clearTimeout(timer);
    if (!stopped && snapshot.active && !document.hidden) timer = setTimeout(() => void refresh(), 5000);
  }
  async function refresh() {
    if (!c.state || stopped) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try { snapshot = await c.api('/api/game-plugin'); paint(); }
      catch { paint(); /* Expire old markers even while the connection is down. */ }
      finally { inFlight = undefined; schedule(); }
    })();
    return inFlight;
  }
  function controls({ memberId, isCurrent = () => true, keys = false, onApplied } = {}) {
    const { el, button, field } = c;
    const owner = c.state.members.find(item => item.id === memberId);
    const root = el('section', undefined, 'game-plugin form-stack dialog-section');
    root.setAttribute('aria-label', `Game plugin for ${owner?.name ?? 'player'}`);
    const status = el('p', 'Loading game plugin…', 'info-meta'), content = el('div', undefined, 'form-stack');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    root.append(el('h3', 'Game plugin'), el('p', 'Send levels, completed quests, achievements and your recent position from the game. Uniquely matched achievements from live worlds tick tasks automatically; Undo can restore them. Review levels, quests and other achievement matches here.', 'field-help'), status, content);
    const current = () => isCurrent() && root.isConnected && c.state.members.some(item => item.id === memberId);
    let busy = false, disposed = false, reviewRequest = 0, renderedSignature, draftLabel = '', secret = '', secretInput, secretHost;
    const openDiagnostics = new Set();
    let selectedPreview;
    const achievementChoices = new Map();
    const report = (message, failed = false) => { status.textContent = message; status.className = failed ? 'warning' : 'info-meta'; };
    const clearSecret = () => { secret = ''; if (secretInput) secretInput.value = ''; secretHost?.remove(); secretInput = secretHost = undefined; };
    const unsubscribeSafe = c.streamSafe?.subscribe(() => { clearSecret(); renderedSignature = undefined; void update(); });
    const dialog = c.$('tool-dialog');
    const observer = globalThis.MutationObserver ? new MutationObserver(() => { if (!root.isConnected) dispose(); }) : null;
    const dispose = () => { if (disposed) return; disposed = true; clearSecret(); listeners.delete(update); unsubscribeSafe?.(); observer?.disconnect(); dialog?.removeEventListener('close', dispose); dialog?.removeEventListener('cancel', clearSecret); };
    dialog?.addEventListener('close', dispose, { once: true });
    dialog?.addEventListener('cancel', clearSecret, { once: true });
    if (dialog) observer?.observe(dialog, { childList: true, subtree: true });
    function keyRows() {
      const rows = el('div', undefined, 'game-plugin-keys');
      const records = (snapshot.keys ?? []).filter(row => (row.memberId ?? row.player?.id ?? row.player) === memberId);
      if (!records.length) rows.append(el('p', 'No plugin keys for this player.', 'info-meta'));
      for (const record of records) {
        const row = el('div', undefined, 'game-plugin-key');
        row.append(el('strong', record.label || 'Game plugin key'), el('p', `Created ${date(record.createdAt)} · Last used ${date(record.lastUsedAt)}${record.lastWorld ? ` · World ${record.lastWorld.id ?? record.lastWorld}` : ''}${record.revoked ? ' · Revoked' : ''}`, 'info-meta'));
        if (record.diagnostics?.lines?.length) {
          // The plugin's own status lines, so nobody has to screenshot the in-game console.
          const details = el('details', undefined, 'game-plugin-diagnostics');
          details.open = openDiagnostics.has(record.id);
          details.addEventListener('toggle', () => { if (details.open) openDiagnostics.add(record.id); else openDiagnostics.delete(record.id); });
          details.append(el('summary', `Plugin diagnostics · received ${date(record.diagnostics.receivedAt)}`), c.list(record.diagnostics.lines));
          row.append(details);
        }
        if (!record.revoked && writable(memberId)) row.append(button('Revoke key', async () => {
          if (!current() || busy || !writable(memberId)) return;
          busy = true; row.setAttribute('aria-busy', 'true');
          try { await c.api(`/api/game-plugin/keys/${encodeURIComponent(record.id)}/revoke`, {}); clearSecret(); await refresh(); busy = false; if (current()) { await update(); report('Plugin key revoked.'); } }
          catch (error) { if (current()) report(error.message, true); }
          finally { busy = false; row.removeAttribute('aria-busy'); }
        }));
        rows.append(row);
      }
      return rows;
    }
    function keyForm() {
      const section = el('section', undefined, 'form-stack');
      section.append(el('h4', `Plugin keys for ${owner.name}`), el('p', 'Anyone with this key can report game data for this player. Uniquely matched achievements from live worlds tick tasks automatically, with Undo. Levels, quests and other achievement matches wait for review. Keep the key private. You can copy a new key once; create another if you lose it.', 'field-help'), keyRows());
      if (!writable(memberId)) return section;
      const label = el('input'); label.type = 'text'; label.maxLength = 80; label.placeholder = 'For example: home PC'; label.autocomplete = 'off';
      label.value = draftLabel; label.addEventListener('input', () => { draftLabel = label.value; });
      const create = button('Create plugin key', async () => {
        if (!current() || busy || !writable(memberId)) return;
        busy = true; create.disabled = true; clearSecret();
        try {
          const value = await c.api('/api/game-plugin/keys', { memberId, label: label.value.trim() || 'Game plugin' });
          if (!current()) return;
          secret = value.key;
          secretHost = el('div', undefined, 'form-stack game-plugin-secret');
          secretInput = el('input'); secretInput.type = 'password'; secretInput.readOnly = true; secretInput.value = secret; secretInput.autocomplete = 'off';
          const copy = button('Copy key once', async () => {
            if (!current() || !secret) return;
            copy.disabled = true;
            try { await navigator.clipboard.writeText(secret); clearSecret(); await update(); report('Key copied. Paste it into the game plugin. It will not be shown again.'); }
            catch { if (!current() || !secret) return; copy.disabled = false; secretInput.type = 'text'; secretInput.focus(); secretInput.select(); report('Copy is unavailable in this browser. Copy the selected key, then hide it.'); }
          });
          secretHost.append(el('p', 'Save this key now. It will not be shown again.', 'warning'), field('New plugin key', secretInput), copy, button('Hide key', () => { clearSecret(); void update(); }));
          section.append(secretHost); report('Plugin key created.');
          // Refresh the shared list without replacing this one-time secret field.
          await refresh();
        } catch (error) { if (current()) report(error.message, true); }
        finally { busy = false; create.disabled = false; }
      });
      section.append(field('Key label (optional)', label), create);
      return section;
    }
    function review(value) {
      if (selectedPreview !== value.previewId) { selectedPreview = value.previewId; achievementChoices.clear(); }
      const section = el('section', undefined, 'game-plugin-review form-stack');
      section.append(el('h4', `Review plugin progress for ${owner.name}`), el('p', `Received ${date(value.fetchedAt)}${value.world ? ` · World ${value.world.id}` : ''}`, 'info-meta'));
      if (value.world?.beta) section.append(el('p', 'This snapshot came from a beta world. Beta progress may differ from your main account. Check every change before applying.', 'warning'));
      const skills = value.skills ?? [], quests = value.quests ?? [], unmatched = value.unmatched?.quests ?? [];
      section.append(el('h5', `Observed skill changes (${skills.length})`), skills.length ? c.list(skills.map(skillChangeText)) : el('p', 'No new skill changes.', 'info-meta'), el('h5', `New personal quest completions (${quests.length})`), quests.length ? c.list(quests.map(row => row.title ?? c.plain(row.label))) : el('p', 'No new personal quest completions.', 'info-meta'));
      section.append(el('h5', `Unmatched quest names (${unmatched.length})`), unmatched.length ? c.list(unmatched.map(row => `${row.title} · Could not match this to a quest completion in this app.`)) : el('p', 'All reported quests matched.', 'info-meta'));
      const achievements = (value.achievements ?? []).slice(0, 200);
      if (achievements.length) {
        section.append(el('h5', `Achievement matches to review (${achievements.length})`), el('p', 'Choose a task for each achievement you want to tick. Leave it skipped to make no change.', 'field-help'));
        for (const achievement of achievements) {
          const row = el('div', undefined, 'game-plugin-achievement form-stack'), title = reviewText(achievement.title);
          row.append(el('strong', title), el('p', achievement.candidates?.length ? achievementReasons[achievement.reason] ?? achievementReasons.unclear : 'No matching task was found. This achievement stays skipped.', 'info-meta'));
          const choice = el('select'), skip = el('option', 'Skip this achievement'); skip.value = ''; choice.append(skip);
          for (const candidate of achievement.candidates ?? []) {
            const option = el('option', reviewText(c.plain(candidate.label))); option.value = candidate.taskId; choice.append(option);
          }
          choice.value = achievementChoices.get(achievement.achievementId) ?? '';
          choice.disabled = !writable(memberId) || !achievement.candidates?.length;
          choice.addEventListener('change', () => { if (choice.value) achievementChoices.set(achievement.achievementId, choice.value); else achievementChoices.delete(achievement.achievementId); });
          row.append(field(`Task for ${title}`, choice)); section.append(row);
        }
      }
      const more = (value.achievementsMore ?? 0) + Math.max(0, (value.achievements?.length ?? 0) - achievements.length);
      if (more > 0) section.append(el('p', `${more} more achievement matches are not shown. Only the first 200 can be reviewed in this snapshot.`, 'info-meta'));
      section.append(el('p', 'Apply saves the listed levels, XP, personal quest completions and selected achievement ticks. Unmatched quests are skipped. Skipped achievements stay unchanged. Your position does not unlock chunks or complete tasks.', 'field-help'));
      if (!writable(memberId)) { section.append(el('p', 'View only. This player or an admin can apply or dismiss this snapshot.', 'info-meta')); return section; }
      const actions = el('div', undefined, 'form-actions');
      const apply = button('Apply plugin snapshot', () => mutate('apply'));
      const dismiss = button('Dismiss snapshot', () => mutate('dismiss'));
      const stale = c.state.revision !== value.stateRevision;
      apply.disabled = stale;
      if (stale) section.append(el('p', 'The saved map changed. Refresh the review before applying.', 'warning'), button('Refresh review', () => update()));
      async function mutate(action) {
        if (!current() || busy || !writable(memberId)) return;
        if (action === 'apply' && c.state.revision !== value.stateRevision) { apply.disabled = true; report('The saved map changed. Refresh the review before applying.', true); return; }
        const selectedAchievements = achievements.filter(row => row.candidates?.some(candidate => candidate.taskId === achievementChoices.get(row.achievementId)))
          .map(row => ({ achievementId: row.achievementId, taskId: achievementChoices.get(row.achievementId) }));
        busy = true; apply.disabled = dismiss.disabled = true;
        try {
          const task = c.queue.then(async () => {
            await c.api(`/api/game-plugin/${action}`, { previewId: value.previewId, ...(action === 'apply' ? { expectedRevision: value.stateRevision, ...(selectedAchievements.length ? { achievements: selectedAchievements } : {}) } : {}) });
            if (action === 'apply') { const loaded = await c.api('/api/state'); c.adopt(loaded.state, loaded.pools); }
          });
          c.queue = task.catch(() => {}); await task;
          busy = false;
          if (current()) { await update(); report(action === 'apply' ? 'Plugin snapshot applied.' : 'Plugin snapshot dismissed.'); if (action === 'apply') await onApplied?.(); }
        } catch (error) { if (current()) { apply.disabled = true; report(error.status === 409 ? 'The saved map changed. Refresh the review and check the changes again.' : error.message, true); section.append(button('Refresh review', () => update())); } }
        finally { busy = false; dismiss.disabled = false; }
      }
      actions.append(apply, dismiss); section.append(actions); return section;
    }
    async function update() {
      if (!current()) { dispose(); return; }
      if (busy || disposed || secret) return;
      const request = ++reviewRequest;
      try {
        const value = await c.api(`/api/game-plugin/review?memberId=${encodeURIComponent(memberId)}`);
        if (!current() || request !== reviewRequest || busy || secret || disposed) return;
        const preview = Object.hasOwn(value, 'preview') ? value.preview : value;
        if (preview && preview.memberId !== memberId) throw new Error('This snapshot belongs to another player. Refresh the review.');
        const assembly = snapshot.keys?.find(row => (row.memberId ?? row.player?.id ?? row.player) === memberId && row.achievements)?.achievements;
        const signature = JSON.stringify([preview, c.state.revision, assembly, keys ? snapshot.keys : null, writable(memberId), snapshot.active]);
        if (renderedSignature === signature) return;
        renderedSignature = signature;
        content.replaceChildren(...(preview ? [review(preview)] : [el('p', 'No plugin snapshot waiting for review. Send one from the game plugin.', 'info-meta')]), ...(keys && c.canWrite() ? [keyForm()] : []));
        if (assembly) {
          const counts = assembly.completeCount === null || assembly.matchedTaskCount === null ? 'Counts available after all parts arrive' : `${assembly.completeCount} complete · ${assembly.matchedTaskCount} matched tasks`;
          const summary = el('p', `Achievement snapshot: ${assembly.received} of ${assembly.parts} parts received · ${counts} · Last ticked ${assembly.lastTickedCount} tasks${assembly.lastTickedAt ? ` at ${date(assembly.lastTickedAt)}` : ''}.`, 'info-meta');
          content.append(summary);
        }
        report(snapshot.active ? 'Game plugin is connected. Recent positions fade after 10 minutes.' : 'Waiting for the game plugin.');
      } catch (error) { if (current() && request === reviewRequest) { renderedSignature = undefined; report(error.message, true); content.replaceChildren(button('Retry', () => update())); } }
    }
    listeners.add(update);
    queueMicrotask(() => { if (current()) void refresh().then(update); else dispose(); });
    return root;
  }
  function open() {
    if (!c.canWrite()) return;
    let generation;
    generation = c.openDialog('Game plugin', controls({ memberId: c.memberId, keys: true, isCurrent: () => c.dialogCurrent(generation) }));
  }
  c.$('game-plugin-open')?.addEventListener('click', open);
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && snapshot.active) void refresh(); });
  globalThis.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  globalThis.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void refresh(); } });
  return { refresh, controls, open, render: () => { for (const listener of listeners) listener(); } };
}
