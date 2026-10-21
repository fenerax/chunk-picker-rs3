import { taskRuleDefinitions } from '../data/settings.mjs';
import { rulesCatalogue } from './rules-model.mjs';

const time = value => value ? new Date(value).toLocaleString() : 'never';
const refreshRequired = 'Saved state changed. Fetch a fresh original-picker preview and review it before applying.';
const groups = ['chunks', 'selections', 'blacklist', 'pendingRoll', 'rules', 'tasks'];

function differs(member, group) {
  const value = member[group];
  if (group === 'chunks') return !!(value.unlock.length || value.lock.length);
  if (group === 'selections') return !!(value.add.length || value.remove.length || value.orderChanged);
  if (group === 'blacklist') return !!(value.add.length || value.remove.length);
  if (group === 'pendingRoll') return value.changed;
  if (group === 'tasks') return !!(value?.complete?.length || value?.backlogAdd?.length);
  return value.length > 0;
}

// Fetching is read-only. Only the reviewed token and selected groups enter the
// shared command queue; the server resolves that token to trusted source data.
export function createOriginalSync(context) {
  const { el, button, list, details } = context;
  const advanced = () => context.canWrite?.() !== false && context.preferences?.()?.advanced === true;
  const ruleLabels = new Map([...rulesCatalogue.rules.map(rule => [rule.key, rule.label ?? rule.key]), ...taskRuleDefinitions.map(rule => [rule.id, rule.label]), ['content.f2p', 'Free-to-play content']]);
  let refresh = () => {};

  async function open() {
    const root = el('div', undefined, 'form-stack'), status = el('p', undefined, 'info-meta'), review = el('div', undefined, 'form-stack');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    let generation, serial = 0, busy = false, preview, controller, applyButton, checks = [];
    const current = () => context.dialogCurrent(generation);
    const active = request => current() && request === serial;
    const setStatus = (message, failed = false) => { status.textContent = message; status.className = failed ? 'warning' : 'info-meta'; };
    const setBusy = value => {
      busy = value; fetchButton.disabled = value; cancel.disabled = value && !!preview;
      checks.forEach(input => { input.disabled = value || !preview; });
    };
    const clearReview = () => { preview = undefined; applyButton = undefined; checks = []; review.replaceChildren(); };
    const abandon = () => { serial++; controller?.abort(); controller = undefined; clearReview(); context.closeDialog(generation); };
    const chunkName = (id, action) => {
      const name = context.world()?.chunks.get(id)?.name ?? context.definitions()?.chunks?.[id]?.name;
      const label = name ? `${context.plain(name)}${advanced() ? ` (${id})` : ''}` : id;
      return action ? `${action} ${label}` : label;
    };
    const chunkList = (ids, action) => ids.length ? list(ids.map(id => chunkName(id, action))) : el('p', 'None', 'info-meta');
    const changes = (title, ids, action = title) => details(`${title} (${ids.length})`, chunkList(ids, action));
    const valueText = value => value == null ? 'Default' : typeof value === 'boolean' ? (value ? 'On' : 'Off') : typeof value === 'object' ? (advanced() ? JSON.stringify(value) : 'Custom setting') : String(value);
    const taskText = task => `${context.plain(task.label ?? (advanced() ? task.id ?? task.originalId : 'Unnamed task'))} (${context.plain(task.category)})`;
    const sourcesText = task => advanced() && task.sources?.length ? ` · Sources: ${task.sources.map(source => context.plain(valueText(source))).join(', ')}` : '';
    const taskChanges = (title, tasks, describe = taskText) => details(`${title} (${tasks.length})`, tasks.length ? list(tasks.map(describe)) : el('p', 'None', 'info-meta'));
    const selected = new Map();
    const selections = () => [...selected].map(([memberId, choices]) => ({ memberId, groups: groups.filter(group => choices.has(group)) })).filter(member => member.groups.length);
    const updateApply = () => { if (applyButton) applyButton.disabled = busy || !preview || !selections().length || context.state().revision !== preview.currentRevision; };
    refresh = () => {
      if (!current()) { controller?.abort(); clearReview(); return; }
      if (preview && context.state().revision !== preview.currentRevision) {
        preview = undefined; checks.forEach(input => { input.disabled = true; });
        if (applyButton) applyButton.disabled = true;
        setStatus(refreshRequired, true);
      }
    };

    function renderPreview(value) {
      if (value.currentRevision !== context.state().revision) { clearReview(); setStatus(refreshRequired, true); return; }
      preview = value; selected.clear(); checks = [];
      const content = el('div', undefined, 'form-stack');
      content.append(el('p', `Fetched ${time(value.capturedAt)} · Preview expires ${time(value.expiresAt)}`, 'info-meta'));
      if (advanced()) content.append(el('p', `Saved revision ${value.currentRevision}`, 'info-meta'));
      for (const warning of value.warnings ?? []) content.append(el('p', typeof warning === 'string' ? warning : warning.message ?? (advanced() ? JSON.stringify(warning) : 'Some original-picker information needs review.'), 'warning'));
      if (value.members.some(member => member.rules.some(rule => rule.shared || rule.id === 'F2P' || rule.id === 'content.f2p'))) {
        content.append(el('p', 'F2P is shared: applying it changes the content rules for both players.', 'warning'));
      }
      for (const member of value.members) {
        const section = el('section', undefined, 'dialog-section form-stack');
        section.append(el('h3', `${member.name} · Original map${advanced() ? ` ${member.sourceMapId}` : ''}`), el('p', `Last synced: ${time(member.lastSynced)}`, 'info-meta'));
        const choices = new Set(); selected.set(member.id, choices);
        const addGroup = (group, label, ...rows) => {
          const changed = differs(member, group);
          if (changed) {
            const input = el('input'); input.type = 'checkbox'; input.checked = group !== 'rules' && group !== 'tasks';
            input.setAttribute('aria-label', `${member.name}: ${label}`);
            if (input.checked) choices.add(group);
            input.addEventListener('change', () => { if (!current() || busy || !preview) return; if (input.checked) choices.add(group); else choices.delete(group); updateApply(); });
            checks.push(input);
            const field = el('label', undefined, 'checkbox-field'); field.append(input, el('span', label)); section.append(field, ...rows);
          } else {
            section.append(el('p', `${label}: no changes`, 'info-meta'));
            if (group === 'tasks' || (group === 'chunks' && member.chunks.keepLocal?.length) || (group === 'pendingRoll' && member.pendingRoll.after.length)) section.append(...rows);
          }
        };
        addGroup('chunks', 'Unlocked chunks', changes('Unlock', member.chunks.unlock), changes('Lock', member.chunks.lock),
          changes('Kept from this picker', member.chunks.keepLocal ?? [], ''));
        addGroup('selections', 'Selected candidates', changes('Add candidates', member.selections.add, 'Add candidate'), changes('Remove candidates', member.selections.remove, 'Remove candidate'),
          details(member.selections.orderChanged ? 'Candidate order changes' : 'Candidate order', el('p', 'Current order', 'info-meta'), chunkList(member.selections.before), el('p', 'After sync', 'info-meta'), chunkList(member.selections.after)));
        addGroup('blacklist', 'Blacklist', changes('Blacklist', member.blacklist.add), changes('Remove from blacklist', member.blacklist.remove));
        addGroup('pendingRoll', 'Pending roll', details('Pending roll choices', el('p', 'Current', 'info-meta'), chunkList(member.pendingRoll.before), el('p', 'After sync', 'info-meta'), chunkList(member.pendingRoll.after)));
        addGroup('rules', 'Rules (optional)', list(member.rules.map(rule => `${ruleLabels.get(rule.id) ?? (advanced() ? rule.id : 'Other saved rule')}: ${rule.inherited ? 'Shared setting' : valueText(rule.before)} → ${valueText(rule.after)}`)));
        const tasks = member.tasks ?? {};
        addGroup('tasks', 'Tasks (optional)',
          el('p', 'Review historical or manual challenge checks and backlog reasons before selecting Tasks. Imports only add completions and backlog entries; local completions, backlog reasons and task cleanup are kept.', 'field-help'),
          taskChanges('Complete challenge tasks', tasks.complete ?? [], task => `${taskText(task)}${sourcesText(task)}`),
          taskChanges('Kept from this picker', tasks.keepLocal ?? [], task => `${taskText(task)}${task.reason ? ` · ${context.plain(task.reason)}` : ''}${sourcesText(task)}`),
          taskChanges('Keep completed challenge tasks', tasks.keepCompleted ?? []),
          taskChanges('Add to backlog', tasks.backlogAdd ?? [], task => `${taskText(task)} · Reason: ${context.plain(task.reason)}`),
          taskChanges('Keep local backlog', tasks.keepBacklog ?? [], task => `${taskText(task)} · Reason: ${context.plain(task.reason)}`),
          taskChanges('Original tasks that could not be matched', tasks.unmapped ?? [], task => `${taskText(task)} · ${advanced() ? `Original ID: ${context.plain(task.originalId)} · ${context.plain(task.reason)}` : 'Could not match this check to a task in this app.'}${advanced() && task.candidates?.length ? ` · Candidates: ${task.candidates.map(candidate => context.plain(valueText(candidate))).join(', ')}` : ''}${sourcesText(task)}`),
          taskChanges('Backlog reason conflicts', tasks.backlogConflicts ?? [], task => `${taskText(task)} · Original reason: ${context.plain(task.reason)} · Keep local reason: ${context.plain(task.localReason)}`));
        if (typeof member.originalF2P === 'boolean') section.append(el('p', `Original F2P: ${member.originalF2P ? 'on' : 'off'} · Shared F2P in this app: ${member.currentF2P ? 'on' : 'off'}`, 'info-meta'));
        const observations = member.observations ?? { notes: {}, taskChecks: {} };
        const originalNotes = Object.entries(observations.notes ?? {}).filter(([, note]) => typeof note === 'string');
        if (originalNotes.length) section.append(details(`Original notes (${originalNotes.length}) · view only`, list(originalNotes.map(([id, note]) => `${chunkName(id)}: ${context.plain(note)}`))));
        if (advanced()) section.append(details('Advanced original save data',
          details(`Original notes (${Object.keys(observations.notes ?? {}).length}) · raw data`, el('pre', JSON.stringify(observations.notes ?? {}, null, 2), 'data-preview')),
          details(`Original task checks (${Object.keys(observations.taskChecks ?? {}).length}) · view only`, el('pre', JSON.stringify(observations.taskChecks ?? {}, null, 2), 'data-preview')),
          details(`Original custom tasks (${Object.keys(observations.userTasks ?? {}).length}) · view only`, el('pre', JSON.stringify(observations.userTasks ?? {}, null, 2), 'data-preview'))));
        content.append(section);
      }
      content.append(el('p', 'Only checked groups are applied. Local unlocks and task cleanup are kept. Tasks add challenge checks and backlog entries, never remove local completions or backlog entries, and preserve local reasons. Challenge checks never update actual personal quests or skills. Apply preserves local notes and personal progress. Changes that move a chunk between unlocked, selected and pending groups may require those groups together.', 'field-help'));
      applyButton = button('Apply selected changes', async () => {
        if (!current() || busy || preview !== value) return;
        if (context.state().revision !== value.currentRevision) { refresh(); return; }
        if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) { preview = undefined; updateApply(); setStatus('This preview expired. Fetch a fresh original-picker preview.', true); return; }
        const members = selections();
        if (!members.length) { updateApply(); return; }
        const request = serial; setBusy(true); updateApply(); setStatus('Applying reviewed original-picker changes…');
        try {
          await context.command({ type: 'sync-original', previewId: value.previewId, members }, value.currentRevision, undefined, current);
          if (!active(request)) return;
          clearReview(); setStatus('Selected original-picker changes applied.');
        } catch (error) {
          if (!active(request)) return;
          setStatus(error.status === 409 ? refreshRequired : error.message || String(error), true);
          // Validation errors can be corrected by selecting related groups.
          // Conflicts and expired tokens require a newly fetched review.
          if (error.status === 409 || /expired|preview.*(?:invalid|missing|not found)/i.test(error.message ?? '')) preview = undefined;
        } finally { if (active(request)) { setBusy(false); updateApply(); } }
      });
      const actions = el('div', undefined, 'form-actions'); actions.append(applyButton, button('Cancel', () => { if (current() && !busy) abandon(); })); content.append(actions);
      review.replaceChildren(content); setStatus('Review both players’ differences, then Apply or Cancel.'); updateApply();
    }

    async function fetchPreview() {
      if (!current() || busy) return;
      const request = ++serial; controller?.abort(); controller = new AbortController(); clearReview(); setBusy(true);
      setStatus('Fetching original maps…');
      try {
        const value = await context.api('/api/original-sync/preview', {}, controller.signal);
        if (!active(request)) return;
        renderPreview(value); fetchButton.textContent = 'Fetch fresh preview';
      } catch (error) {
        if (active(request)) { clearReview(); setStatus(error.message || String(error), true); fetchButton.textContent = 'Retry fetch'; }
      } finally { if (active(request)) { controller = undefined; setBusy(false); updateApply(); } }
    }
    const fetchButton = button('Fetch original maps', fetchPreview), cancel = button('Cancel', () => { if (current() && (!busy || !preview)) abandon(); });
    const actions = el('div', undefined, 'form-actions'); actions.append(fetchButton, cancel);
    root.append(el('p', 'Read the linked public original maps and review their differences before updating this app. Rules and Tasks are optional and unchecked by default.', 'section-intro'), actions, status, review);
    generation = context.openDialog('Sync from original picker', root);
    await fetchPreview();
  }

  return { open, refresh: () => refresh() };
}
