const MAX_AGE = 10 * 60 * 1000;
const date = value => value ? new Date(value).toLocaleString() : 'Never';
export function positionAge(seenAt, now = Date.now()) {
  const age = now - new Date(seenAt).getTime();
  return Number.isFinite(age) && age >= -30000 && age < MAX_AGE ? Math.max(0, age) : null;
}
const ageText = age => age < 60000 ? 'just now' : `${Math.floor(age / 60000)}m ago`;
const reviewText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
// Diary labels repeat the achievement title after the area, so rows show only the area when they can.
const taskText = (title, label) => { const text = String(label ?? '').trim(), name = String(title ?? '').trim(); return reviewText(name && text.endsWith(name) && text.length > name.length ? text.slice(0, -name.length).trim() : text); };
const count = value => Number(value).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const worldNotes = { beta: 'This snapshot came from a beta world. Beta progress may differ from your main account. Check before applying.', unknown: 'World type was not reported for some achievements. Check before applying.' };
const worldTags = { beta: 'Beta', unknown: 'World unknown' };

// One achievement choice per row: single matches start selected, several
// matches start skipped, and no task is chosen twice (the server refuses that).
export function initialAchievementChoices(achievements) {
  const choices = new Map(), used = new Set();
  for (const row of achievements) {
    const [only] = row.candidates ?? [];
    if (row.candidates?.length === 1 && !used.has(only.taskId)) { choices.set(row.achievementId, only.taskId); used.add(only.taskId); }
  }
  return choices;
}

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
    // The dialog title or the Activity Info section already names it.
    root.append(el('p', 'Send levels, completed quests, achievements and your recent position from the game. Uniquely matched achievements from live worlds tick tasks automatically; Undo can restore them. Review levels, quests and other achievement matches here.', 'field-help'), status, content);
    const current = () => isCurrent() && root.isConnected && c.state.members.some(item => item.id === memberId);
    let busy = false, disposed = false, reviewRequest = 0, renderedSignature, draftLabel = '', secret = '', secretInput, secretHost;
    const openDiagnostics = new Set();
    let selectedPreview, singlesOpen = false;
    let achievementChoices = new Map();
    const itemChoices = new Set();
    const skippedParts = new Set();
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
      const achievements = (value.achievements ?? []).slice(0, 200);
      if (selectedPreview !== value.previewId) { selectedPreview = value.previewId; achievementChoices = initialAchievementChoices(achievements); skippedParts.clear(); itemChoices.clear(); singlesOpen = false; }
      const canWrite = writable(memberId), stale = c.state.revision !== value.stateRevision;
      const skills = value.skills ?? [], quests = value.quests ?? [], unmatched = value.unmatched?.quests ?? [];
      const items = value.items ?? [], unmappedItems = value.unmappedItems ?? [];
      const section = el('section', undefined, 'game-plugin-review form-stack');
      section.append(el('h4', `Review plugin progress for ${owner.name}`), el('p', `Received ${date(value.fetchedAt)}${value.world ? ` · World ${value.world.id}` : ''}`, 'info-meta'));
      // World warnings appear once. Rows carry a short tag only when worlds are mixed.
      const worlds = new Set(achievements.map(row => row.world).filter(world => world === 'beta' || world === 'unknown'));
      const mixed = new Set(achievements.map(row => row.world)).size > 1;
      if (value.world?.beta) section.append(el('p', worldNotes.beta, 'warning'));
      else if (worlds.has('beta')) section.append(el('p', `${mixed ? 'Achievements tagged Beta' : 'These achievements'} came from a beta world. Beta progress may differ from your main account. Check before applying.`, 'warning'));
      if (worlds.has('unknown')) section.append(el('p', mixed ? 'Achievements tagged World unknown were reported without a world type. Check before applying.' : worldNotes.unknown, 'warning'));
      const summary = el('p', undefined, 'game-plugin-summary'), syncs = [];
      summary.setAttribute('aria-live', 'polite');
      let apply;
      const chosen = () => achievements.filter(row => row.candidates?.some(candidate => candidate.taskId === achievementChoices.get(row.achievementId)));
      function refreshChoices() {
        for (const sync of syncs) sync();
        const parts = [];
        if (skills.length && !skippedParts.has('skills')) parts.push(plural(skills.length, 'skill level'));
        if (quests.length && !skippedParts.has('quests')) parts.push(plural(quests.length, 'quest'));
        const ticks = chosen().length;
        if (ticks) parts.push(plural(ticks, 'achievement tick'));
        const itemTicks = items.filter(row => itemChoices.has(row.taskId)).length;
        if (itemTicks) parts.push(plural(itemTicks, 'item task'));
        summary.textContent = parts.length ? `Apply saves ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.` : 'Nothing is selected. Dismiss clears this snapshot without changes.';
        if (apply) apply.disabled = stale || !parts.length;
      }
      // A section the player takes or leaves as a whole: levels or quests.
      function part(key, title, ...body) {
        const box = el('section', undefined, 'game-plugin-part'), head = el('div', undefined, 'game-plugin-part-head');
        head.append(el('h5', title)); box.append(head, ...body);
        if (!key || !canWrite) return box;
        const choice = el('div', undefined, 'game-plugin-choice'), note = el('p', undefined, 'info-meta game-plugin-skip-note');
        choice.setAttribute('role', 'group'); choice.setAttribute('aria-label', `${title}: apply or skip`);
        const take = button('Apply', () => { skippedParts.delete(key); refreshChoices(); }), leave = button('Skip', () => { skippedParts.add(key); refreshChoices(); });
        choice.append(take, leave); head.append(choice); box.append(note);
        syncs.push(() => {
          const skipped = skippedParts.has(key);
          take.setAttribute('aria-pressed', String(!skipped)); leave.setAttribute('aria-pressed', String(skipped));
          box.className = `game-plugin-part${skipped ? ' is-skipped' : ''}`;
          note.textContent = skipped ? 'Skipped. These stay unchanged.' : '';
        });
        return box;
      }
      if (skills.length) {
        const table = el('table', undefined, 'game-plugin-table'), head = el('tr'), thead = el('thead'), tbody = el('tbody');
        head.append(el('th', 'Skill'), el('th', 'Level'), el('th', 'XP')); thead.append(head); table.append(thead, tbody);
        for (const row of skills) {
          const before = row.before, up = before && row.after.level > before.level, gain = before ? row.after.xp - before.xp : 0;
          const line = el('tr'), name = el('th', row.skill), level = el('td', up ? `${count(before.level)} → ${count(row.after.level)}` : count(row.after.level), up ? 'is-up' : undefined);
          name.setAttribute('scope', 'row');
          line.append(name, level, el('td', `${count(row.after.xp)}${gain ? ` (${gain > 0 ? '+' : '−'}${count(Math.abs(gain))})` : ''}`)); tbody.append(line);
        }
        section.append(part('skills', `Skill levels (${skills.length})`, table));
      }
      if (quests.length || unmatched.length) {
        const body = [quests.length ? c.list(quests.map(row => row.title ?? c.plain(row.label))) : el('p', 'No new quest completions matched.', 'info-meta')];
        if (unmatched.length) body.push(el('p', `Not in the picker, so not applied (${unmatched.length}):`, 'info-meta game-plugin-unmatched'), c.list(unmatched.map(row => reviewText(row.title))));
        section.append(part(quests.length ? 'quests' : null, `Quests completed (${quests.length})`, ...body));
      }
      if (achievements.length) {
        const singles = achievements.filter(row => row.candidates?.length === 1), several = achievements.filter(row => row.candidates?.length !== 1);
        const box = part(null, `Achievements (${achievements.length})`);
        box.append(el('p', `${plural(singles.length, 'achievement')} with one matching task${several.length ? ` · ${count(several.length)} with several` : ''}.`, 'info-meta'));
        // Pressing the same task twice is refused by the server, so the controls refuse it first.
        const taken = (row, taskId) => achievements.some(other => other !== row && achievementChoices.get(other.achievementId) === taskId);
        if (canWrite) {
          const bulk = el('div', undefined, 'form-actions game-plugin-bulk');
          bulk.append(button('Select all single matches', () => { for (const row of singles) { const taskId = row.candidates[0].taskId; if (!taken(row, taskId)) achievementChoices.set(row.achievementId, taskId); } refreshChoices(); }),
            button('Skip all achievements', () => { achievementChoices.clear(); refreshChoices(); }));
          box.append(bulk);
        }
        // Area labels alone don't say what an achievement asks for, so each row links its wiki page.
        const wiki = title => c.iconLink && c.supportsFeature?.('rsCatalogues') !== false ? [c.iconLink(c.wikiSearch(title), `Open ${title} on the RuneScape Wiki`, 'wiki')] : [];
        const tags = row => [...(mixed && worldTags[row.world] ? [el('span', worldTags[row.world], 'game-plugin-tag')] : []),
          ...(row.reason === 'retry' ? [el('span', 'Auto-tick failed', 'game-plugin-tag')] : [])];
        if (several.length) {
          const list = el('div', undefined, 'game-plugin-matches');
          for (const row of several) {
            const line = el('div', undefined, 'game-plugin-match'), title = reviewText(row.title), text = el('div', undefined, 'game-plugin-match-text');
            text.append(el('strong', title), ...wiki(title), ...tags(row));
            const choice = el('select'), skip = el('option', row.candidates?.length ? 'Skip' : 'No matching task'); skip.value = ''; choice.append(skip);
            for (const candidate of row.candidates ?? []) { const option = el('option', taskText(row.title, c.plain(candidate.label))); option.value = candidate.taskId; choice.append(option); }
            choice.setAttribute('aria-label', `Task for ${title}`); choice.disabled = !canWrite || !row.candidates?.length;
            choice.addEventListener('change', () => {
              if (choice.value && taken(row, choice.value)) { choice.value = achievementChoices.get(row.achievementId) ?? ''; report('That task is already chosen for another achievement.', true); return; }
              if (choice.value) achievementChoices.set(row.achievementId, choice.value); else achievementChoices.delete(row.achievementId);
              refreshChoices();
            });
            syncs.push(() => { choice.value = achievementChoices.get(row.achievementId) ?? ''; line.className = `game-plugin-match${choice.value ? ' is-chosen' : ''}`; });
            line.append(text, choice); list.append(line);
          }
          box.append(el('h6', `Choose a task (${several.length})`), list);
        }
        if (singles.length) {
          const details = el('details', undefined, 'game-plugin-singles'), heading = el('summary'), list = el('div', undefined, 'game-plugin-matches');
          details.open = singlesOpen || !several.length && singles.length <= 12;
          details.addEventListener('toggle', () => { singlesOpen = details.open; });
          for (const row of singles) {
            const [task] = row.candidates, title = reviewText(row.title);
            const line = el('label', undefined, 'game-plugin-match'), tick = el('input'), text = el('span', undefined, 'game-plugin-match-text');
            tick.type = 'checkbox'; tick.disabled = !canWrite;
            text.append(el('strong', title), ...wiki(title), el('span', taskText(row.title, c.plain(task.label)), 'game-plugin-task'), ...tags(row));
            tick.addEventListener('change', () => {
              if (tick.checked && taken(row, task.taskId)) { tick.checked = false; report('That task is already chosen for another achievement.', true); return; }
              if (tick.checked) achievementChoices.set(row.achievementId, task.taskId); else achievementChoices.delete(row.achievementId);
              refreshChoices();
            });
            syncs.push(() => { tick.checked = achievementChoices.get(row.achievementId) === task.taskId; });
            line.append(tick, text); list.append(line);
          }
          syncs.push(() => { heading.textContent = `One matching task (${singles.length}) · ${count(singles.filter(row => achievementChoices.has(row.achievementId)).length)} selected`; });
          details.append(heading, list); box.append(details);
        }
        section.append(box);
      }
      if (items.length || unmappedItems.length) {
        // Item rows start unticked: having an item doesn't show where it came from, so the player decides.
        const box = part(null, `Items (${items.length})`);
        if (items.length) {
          box.append(el('p', 'Tick a task only if the evidence fits it. Having an item does not show where it came from.', 'field-help'));
          const list = el('div', undefined, 'game-plugin-matches');
          for (const item of items) {
            const line = el('label', undefined, 'game-plugin-match'), tick = el('input'), text = el('span', undefined, 'game-plugin-match-text');
            tick.type = 'checkbox'; tick.disabled = !canWrite;
            const tag = worldTags[item.world] && !(item.world === 'beta' && value.world?.beta) ? [el('span', worldTags[item.world], 'game-plugin-tag')] : [];
            text.append(el('strong', reviewText(c.plain(item.label))), el('span', `${item.evidence === 'worn' ? 'Worn' : 'Owned'}: ${reviewText(item.gameName)} (game item ${item.gameItemId}) · ${reviewText(item.seen)}`, 'game-plugin-task'), ...tag);
            tick.addEventListener('change', () => { if (tick.checked) itemChoices.add(item.taskId); else itemChoices.delete(item.taskId); refreshChoices(); });
            syncs.push(() => { tick.checked = itemChoices.has(item.taskId); });
            line.append(tick, text); list.append(line);
          }
          box.append(list);
          if (value.itemsMore > 0) box.append(el('p', `${value.itemsMore} more item matches are not shown.`, 'info-meta'));
        }
        if (unmappedItems.length) box.append(el('p', `Not matched to tasks yet, no reviewed ID (${unmappedItems.length + (value.unmappedItemsMore ?? 0)}):`, 'info-meta game-plugin-unmatched'),
          c.list(unmappedItems.map(row => `${reviewText(row.name)} · game item ${row.gameItemId}`)));
        section.append(box);
      }
      const more = (value.achievementsMore ?? 0) + Math.max(0, (value.achievements?.length ?? 0) - achievements.length);
      if (more > 0) section.append(el('p', `${more} more achievement matches are not shown. Only the first 200 can be reviewed in this snapshot.`, 'info-meta'));
      if (!canWrite) { refreshChoices(); section.append(el('p', 'View only. This player or an admin can apply or dismiss this snapshot.', 'info-meta')); return section; }
      section.append(el('p', 'Skipped items stay unchanged. Your position never unlocks chunks or completes tasks.', 'field-help'));
      const footer = el('div', undefined, 'game-plugin-apply'), actions = el('div', undefined, 'form-actions');
      apply = button('Apply selected', () => mutate('apply'));
      const dismiss = button('Dismiss snapshot', () => mutate('dismiss'));
      if (stale) section.append(el('p', 'The saved map changed. Refresh the review before applying.', 'warning'), button('Refresh review', () => update()));
      refreshChoices();
      async function mutate(action) {
        if (!current() || busy || !writable(memberId)) return;
        if (action === 'apply' && c.state.revision !== value.stateRevision) { apply.disabled = true; report('The saved map changed. Refresh the review before applying.', true); return; }
        const selectedAchievements = chosen().map(row => ({ achievementId: row.achievementId, taskId: achievementChoices.get(row.achievementId) }));
        const selectedItems = items.filter(row => itemChoices.has(row.taskId)).map(row => ({ taskId: row.taskId }));
        const skipped = { ...(skills.length && skippedParts.has('skills') ? { skills: false } : {}), ...(quests.length && skippedParts.has('quests') ? { quests: false } : {}) };
        busy = true; apply.disabled = dismiss.disabled = true;
        try {
          const task = c.queue.then(async () => {
            await c.api(`/api/game-plugin/${action}`, { previewId: value.previewId, ...(action === 'apply' ? { expectedRevision: value.stateRevision, ...skipped, ...(selectedAchievements.length ? { achievements: selectedAchievements } : {}), ...(selectedItems.length ? { items: selectedItems } : {}) } : {}) });
            if (action === 'apply') { const loaded = await c.api('/api/state'); c.adopt(loaded.state, loaded.pools); }
          });
          c.queue = task.catch(() => {}); await task;
          busy = false;
          if (current()) { await update(); report(action === 'apply' ? 'Plugin snapshot applied.' : 'Plugin snapshot dismissed.'); if (action === 'apply') await onApplied?.(); }
        } catch (error) { if (current()) { apply.disabled = true; report(error.status === 409 ? 'The saved map changed. Refresh the review and check the changes again.' : error.message, true); section.append(button('Refresh review', () => update())); } }
        finally { busy = false; dismiss.disabled = false; }
      }
      actions.append(apply, dismiss); footer.append(summary, actions); section.append(footer); return section;
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
