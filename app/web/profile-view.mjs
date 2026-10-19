import { buildProfileModel } from './profile-model.mjs';
import { createProfileCopy } from './profile-copy.mjs';
import { loadBiSMemberResult } from './bis-results.mjs';
import { createInfoPanels } from './info-panels.mjs';
import { loadIcons, skillIcon, itemIcon } from './icons.mjs';
import { taskItemIcon } from './task-artwork.mjs';

const value = number => number == null ? '—' : number.toLocaleString();
const date = at => at ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

/** Detached, read-only presentation. Selects change only the displayed profile. */
export function renderProfile(context, model, { openBiS, openXpChoices, refresh } = {}) {
  const { el, button } = context, plain = context.plain ?? (text => String(text ?? ''));
  const root = el('div', undefined, 'profile-content');
  const header = el('header', undefined, 'profile-header');
  const identity = el('div'); identity.append(el('h3', plain(model.header.name), 'profile-player-name'),
    el('p', model.header.runescapeName ? plain(model.header.runescapeName) : 'RuneScape name not set', 'profile-note'));
  const facts = el('p', `${value(model.header.unlockedCount)} chunks unlocked${model.header.firstUnlockAt ? ` · First recorded unlock ${date(model.header.firstUnlockAt)}` : ''}`, 'profile-header-facts');
  header.append(identity, facts, createProfileCopy(context, model)); root.append(header);
  const body = el('div', undefined, 'profile-overview');
  const skills = el('section', undefined, 'profile-levels');
  const heading = el('div', undefined, 'profile-section-heading'); heading.append(el('h3', 'Levels'),
    el('p', `Total ${value(model.skills.totalLevel)} · Combat ${value(model.skills.combatLevel)}`, 'profile-totals'));
  skills.append(heading);
  const grid = el('dl', undefined, 'profile-skill-grid');
  for (const row of model.skills.rows) {
    const tile = el('div', undefined, `profile-skill${row.level == null ? ' profile-unknown' : ''}`);
    const name = el('dt'), source = (context.skillIcon ?? skillIcon)(row.skill);
    if (source) { const icon = el('img'); icon.src = source; icon.alt = ''; name.append(icon); }
    name.append(el('span', row.skill));
    const level = el('dd', value(row.level)); level.setAttribute('aria-label', `${row.skill}: ${row.level ?? 'not recorded'}`);
    tile.append(name, level);
    if (row.f2pCap != null) {
      const cap = el('small', `F2P ${row.f2pCap}`, 'profile-cap'); cap.title = `Free-to-play players can only reach level ${row.f2pCap} in this skill.`; level.append(cap);
    }
    grid.append(tile);
  }
  skills.append(grid, el('p', model.skills.lastSyncAt ? `Last synced ${date(model.skills.lastSyncAt)}`
    : model.skills.knownCount ? 'Recorded account levels · Last sync date unknown.'
      : 'No synced levels yet. Open RuneMetrics sync or Game plugin in Activity Info.', 'profile-note'));
  if (model.skills.knownCount > 0 && model.skills.knownCount < model.skills.totalCount) skills.append(el('p', `${model.skills.knownCount}/${model.skills.totalCount} levels recorded. Total needs all skills; combat needs all combat skills.`, 'profile-note'));
  if (openXpChoices) skills.append(button('XP choices', openXpChoices));
  const progress = el('div', undefined, 'profile-progress');
  const tasks = el('section'); tasks.append(el('h3', 'Completed tasks'));
  const counts = el('dl', undefined, 'profile-task-counts');
  for (const row of model.tasks.categories) { const line = el('div'); line.append(el('dt', row.category), el('dd', value(row.completed))); counts.append(line); }
  const total = el('div', undefined, 'profile-count-total'); total.append(el('dt', 'Total'), el('dd', value(model.tasks.completedCount))); counts.append(total);
  tasks.append(counts, el('p', 'Your personal completions and picker ticks, counted once.', 'profile-note'));
  if (model.tasks.unknownCount) tasks.append(el('p', `${value(model.tasks.unknownCount)} saved tasks have no known category.`, 'profile-note'));
  const quests = el('section', undefined, 'profile-quests'); quests.append(el('h3', 'Quests'),
    el('p', `${value(model.quests.completed)} / ${value(model.quests.total)} recorded complete`, 'profile-progress-value'),
    el('p', 'Known quests under the current content rules.', 'profile-note'));
  const achievements = el('section', undefined, 'profile-achievements'); achievements.append(el('h3', 'Diaries / achievements'),
    el('p', `${value(model.achievements.ticked)} ticked in the picker`, 'profile-progress-value'),
    el('p', 'In-game diary rewards and full tiers are not synced.', 'profile-note'));
  progress.append(tasks, quests, achievements); body.append(skills, progress); root.append(body);
  const gear = el('section', undefined, 'profile-gear');
  const gearHeading = el('div', undefined, 'profile-section-heading'); gearHeading.append(el('h3', 'Best recorded gear'));
  const style = el('select'); style.setAttribute('aria-label', 'Recorded gear style');
  for (const row of model.gear.styles) { const option = el('option', row.style); option.value = row.style; style.append(option); }
  if (model.gear.styles.length) { style.value = model.gear.defaultStyle ?? model.gear.styles[0].style; gearHeading.append(style); }
  if (openBiS) gearHeading.append(button('Current BiS →', openBiS, 'profile-bis-link'));
  gear.append(gearHeading, el('p', model.gear.totalRecorded == null
    ? 'Recorded gear details will appear after a player opens Current BiS. Refresh to check again.'
    : `${value(model.gear.totalRecorded)} items recorded obtained, including hand records. Current inventory is unknown.`, 'profile-note'));
  if (!model.gear.available && refresh) gearHeading.append(button('Refresh profile', refresh, 'profile-bis-link'));
  const slots = el('dl', undefined, 'profile-gear-grid');
  const emptyGear = el('p', model.gear.available ? 'No usable gear recorded yet.' : 'Gear information is unavailable.', 'profile-note');
  const drawGear = () => {
    slots.replaceChildren();
    const selected = model.gear.styles.find(row => row.style === style.value);
    slots.hidden = !selected; emptyGear.hidden = !!selected;
    if (!selected) return;
    for (const row of selected.slots) {
      const slot = el('div', undefined, 'profile-gear-slot'); slot.append(el('dt', row.label));
      const items = el('dd');
      // Keep the selected compatible hand setup intact. Peer hand choices can
      // belong to different tied loadouts; BiS retains those complete setups.
      const shownItems = row.coupled ? row.unused ? [] : row.items.slice(0, 1) : row.items;
      for (const item of shownItems) {
        const identity = el('span', undefined, 'profile-gear-item');
        const source = taskItemIcon(item.name, context.itemIcon ?? itemIcon);
        if (source) { const icon = el('img'); icon.src = source; icon.alt = ''; identity.append(icon); }
        const name = el('span', plain(item.name)); identity.append(name); items.append(identity);
      }
      if (!shownItems.length) items.append(el('span', row.unused ? 'Unused in this setup' : 'Not recorded', 'profile-note'));
      if (row.items.length > 1) slot.title = row.coupled ? 'Tied complete setups are in Current BiS' : 'Equally ranked recorded choices';
      slot.append(items); slots.append(slot);
    }
  };
  style.addEventListener('change', drawGear); drawGear(); gear.append(slots, emptyGear);
  if (model.gear.styles.some(row => row.slots.some(slot => slot.coupled))) gear.append(
    el('p', 'Weapons and ammunition use one compatible recorded setup. See Current BiS for tied setups and other records.', 'profile-note'));
  root.append(gear);
  return root;
}

export function createProfileView(c) {
  let datesRequest, datesRevision;
  const recordedDates = revision => {
    if (datesRevision !== revision) {
      datesRevision = revision;
      datesRequest = c.api(`/api/roll-stats?stateRevision=${revision}`).catch(() => {
        if (datesRevision === revision) datesRevision = undefined;
        return null;
      });
    }
    return datesRequest;
  };
  async function savedResult(memberId) {
    try { return await loadBiSMemberResult(c, memberId); }
    catch (error) {
      // Spectators only read retained results. A newly created viewer link can
      // have a saved task list before full BiS details have been retained.
      if (error.code !== 'TASK_RESULTS_UNAVAILABLE') throw error;
      await c.ensureFullDefinitions?.();
      const revision = c.state.revision;
      return [c.result, c.normalPlayResults?.get(memberId), c.duoResultCache?.results().get(memberId)]
        .find(result => result?.memberId === memberId && result.stateRevision === revision)
        ?? { memberId, stateRevision: revision, tasks: [] };
    }
  }
  async function open() {
    c.closeTopMenus?.();
    if (c.sandbox?.active) { c.openDialog('Profile', c.el('p', 'Exit Sandbox to view saved player profiles.', 'status-detail')); return; }
    let selectedId = c.memberId, sequence = 0;
    const root = c.el('div', undefined, 'profile-panel'), toolbar = c.el('div', undefined, 'profile-toolbar');
    const chooser = c.el('select'); chooser.setAttribute('aria-label', 'Profile player');
    for (const member of c.state.members) { const option = c.el('option', member.name); option.value = member.id; chooser.append(option); }
    chooser.value = selectedId;
    const label = c.el('label', undefined, 'profile-player-choice'); label.append(c.el('span', 'Player'), chooser); toolbar.append(label);
    const content = c.el('div'); root.append(toolbar, content);
    const generation = c.openDialog('Profile', root);
    const current = request => sequence === request && c.dialogCurrent(generation);
    async function load() {
      selectedId = chooser.value; const memberId = selectedId, revision = c.state.revision, request = ++sequence;
      content.replaceChildren(c.el('p', 'Loading profile…', 'status-detail'));
      content.setAttribute('aria-busy', 'true');
      const refresh = message => content.replaceChildren(c.el('p', message, 'status-detail'), c.button('Refresh profile', load));
      try {
        const [result, , rollStats] = await Promise.all([savedResult(memberId), (c.loadIcons ?? loadIcons)(), recordedDates(revision)]);
        if (!current(request)) return;
        if (revision !== c.state.revision) { refresh('Your save changed. Refresh to see the latest profile.'); return; }
        const model = buildProfileModel(c.state, memberId, result, c.definitions, rollStats);
        content.replaceChildren(renderProfile(c, model, { refresh: load, openXpChoices: c.openXpChoices ? () => c.openXpChoices(memberId) : undefined, openBiS: result.currentBiS ? () => {
          if (!current(request)) return;
          if (c.state.revision !== revision) { refresh('Your save changed. Refresh to see the latest profile.'); return; }
          return createInfoPanels({ ...c.panelContext, memberId: () => memberId,
            ensureResult: () => loadBiSMemberResult(c, memberId), canWrite: () => false, canWriteMember: () => false,
            showTask: task => c.openDialog(task.label, c.el('p', c.plain(task.explanation ?? task.label))) }).currentBiS('Recorded obtained');
        } : undefined }));
      } catch {
        if (!current(request)) return;
        refresh(revision !== c.state.revision ? 'Your save changed. Refresh to see the latest profile.' : 'Profile could not be loaded. Try again.');
      } finally { if (current(request)) content.setAttribute('aria-busy', 'false'); }
    }
    chooser.addEventListener('change', load); await load();
  }
  c.$('profile-open')?.addEventListener('click', () => open().catch(c.showError));
  return { open };
}
