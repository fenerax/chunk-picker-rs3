import { gameStorage } from './screen-save-status.mjs';
import { readTaskFilters, writeTaskFilters, selectTaskFilters } from './task-filters-model.mjs';

const categoryName = category => ({ Quest: 'Quests', Diary: 'Achievements' })[category] ?? category;

/** Browser-only display choices. No saved gameplay commands belong here. */
export function createTaskFilters({ document, getStorage = () => gameStorage(), onChange = () => {}, clearSearch = () => {}, getClaimMemberId }) {
  let storage;
  try { storage = getStorage(); } catch { /* Browsers can deny storage access. */ }
  let filters = readTaskFilters(storage), categoryKey, skillInputs = [], expanded = false, categoryId = 0;
  let shownCategories = [], categoryBodies = [];
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const root = el('div', undefined, 'active-task-filters');
  const toggle = el('button', 'Filter & sort', 'task-filters-toggle'); toggle.id = 'task-filters-toggle'; toggle.type = 'button';
  const panel = el('div', undefined, 'task-filters-panel'); panel.id = 'task-filters-panel';
  toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-expanded', 'false');
  const setExpanded = value => { expanded = value; root.dataset.expanded = String(expanded); toggle.setAttribute('aria-expanded', String(expanded)); };
  toggle.addEventListener('click', () => setExpanded(!expanded));
  const skills = el('details', undefined, 'task-skill-picker'), skillSummary = el('summary', 'Skill'), skillChoices = el('div', undefined, 'task-skill-choices');
  skills.append(skillSummary, skillChoices);
  skills.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !skills.open) return;
    event.preventDefault(); event.stopPropagation(); skills.open = false; skillSummary.focus();
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
    event.preventDefault(); event.stopPropagation(); skills.open = false; setExpanded(false); toggle.focus();
  });
  const save = () => { writeTaskFilters(storage, filters); onChange(); };
  const foldAll = el('button', 'Collapse all', 'task-category-fold-all'); foldAll.id = 'task-category-fold-all'; foldAll.type = 'button'; foldAll.hidden = true;
  const refreshFoldAll = () => {
    foldAll.hidden = !shownCategories.length;
    foldAll.textContent = shownCategories.some(category => !filters.folded.includes(category)) ? 'Collapse all' : 'Expand all';
    foldAll.setAttribute('aria-label', `${foldAll.textContent} skill groups`);
    foldAll.setAttribute('aria-controls', categoryBodies.join(' '));
  };
  foldAll.addEventListener('click', () => {
    if (!shownCategories.length) return;
    const collapse = shownCategories.some(category => !filters.folded.includes(category));
    filters = { ...filters, folded: collapse ? [...new Set([...filters.folded, ...shownCategories])] : filters.folded.filter(category => !shownCategories.includes(category)) };
    refreshFoldAll();
    // Reuse the screen's single, cancellable paint queue for every open group.
    save();
  });
  const checkbox = (id, text, key) => {
    const label = el('label'), control = el('input'); control.type = 'checkbox'; control.id = id; control.checked = filters[key];
    control.addEventListener('change', () => { filters = { ...filters, [key]: control.checked }; save(); });
    label.append(control, document.createTextNode(text)); return { label, control };
  };
  const doable = checkbox('task-doable', 'Doable now', 'doable'), pinned = checkbox('task-pinned', 'Pinned only', 'pinned');
  const hidePartnerClaims = checkbox('task-hide-partner-claims', 'Hide tasks my partner is doing', 'hidePartnerClaims');
  const onlyMyClaims = checkbox('task-only-my-claims', 'Only my claimed tasks', 'onlyMyClaims');
  const sortLabel = el('label', undefined, 'task-sort-label'), sort = el('select'); sort.id = 'task-sort'; sort.setAttribute('aria-label', 'Sort active tasks');
  for (const [value, text] of [['default', 'Default order'], ['level', 'Level (low to high)'], ['skill', 'Skill (A to Z)'], ['name', 'Name (A to Z)']]) {
    const option = el('option', text); option.value = value; sort.append(option);
  }
  sort.value = filters.sort; sort.addEventListener('change', () => { filters = { ...filters, sort: sort.value }; save(); });
  sortLabel.append(el('span', 'Sort'), sort);
  const help = el('p', undefined, 'task-filter-help'); help.id = 'task-doable-help'; doable.control.setAttribute('aria-describedby', help.id);
  const row = el('div', undefined, 'task-filter-row'); row.append(skills, doable.label, pinned.label, hidePartnerClaims.label, onlyMyClaims.label, sortLabel); panel.append(row, help);
  const summary = el('div', undefined, 'task-filter-summary'); summary.id = 'task-filter-summary'; summary.setAttribute('role', 'status');
  const hiddenCount = el('span'), clear = el('button', 'Clear'); clear.id = 'task-filters-clear'; clear.type = 'button';
  clear.addEventListener('click', () => {
    filters = { ...filters, skills: [], doable: false, pinned: false, hidePartnerClaims: false, onlyMyClaims: false, sort: 'default' };
    doable.control.checked = pinned.control.checked = hidePartnerClaims.control.checked = onlyMyClaims.control.checked = false; sort.value = 'default'; categoryKey = undefined;
    clearSearch(); save();
  });
  summary.append(hiddenCount, clear); root.append(toggle, foldAll, panel, summary);
  function refreshCategories(categories) {
    const options = [...new Set([...categories, ...filters.skills])].sort((a, b) => categoryName(a).localeCompare(categoryName(b)));
    const key = JSON.stringify(options);
    if (key !== categoryKey) {
      categoryKey = key;
      skillInputs = [];
      skillChoices.replaceChildren(...options.map(category => {
        const label = el('label'), choice = el('input'); choice.type = 'checkbox'; choice.value = category; choice.dataset.taskSkill = category;
        skillInputs.push(choice);
        choice.checked = filters.skills.includes(category);
        choice.addEventListener('change', () => {
          filters = { ...filters, skills: choice.checked ? [...filters.skills, category] : filters.skills.filter(value => value !== category) };
          save();
        });
        label.append(choice, document.createTextNode(categoryName(category))); return label;
      }));
      if (!options.length) skillChoices.append(el('p', 'No skills in this view.'));
    }
    for (const choice of skillInputs) choice.checked = filters.skills.includes(choice.value);
    skillSummary.textContent = filters.skills.length ? `Skill (${filters.skills.length})` : 'Skill';
  }
  return {
    element: root,
    preferences: () => filters,
    select(rows, options, { group = false, ownerHidden = 0, search = '', externalActive = false, doableFixed = false } = {}) {
      const claimIdentity = getClaimMemberId ? { claimMemberId: getClaimMemberId() } : {};
      const selection = selectTaskFilters(rows, { ...claimIdentity, ...options, filters, search }); refreshCategories(selection.categories);
      const fixedHint = doableFixed ? `This view already shows tasks ${options?.state?.members?.find(member => member.id === options.memberId)?.name ?? 'the selected player'} can do now.` : '';
      doable.control.disabled = doableFixed; doable.control.title = doable.label.title = fixedHint;
      help.textContent = fixedHint || (group ? 'Doable now hides tasks that need a level or requirement you don’t have yet. In group view, a task stays if either player on it can do it.' : 'Doable now hides tasks that need a level or requirement you don’t have yet.');
      const shown = selection.rows;
      shownCategories = [...new Set(shown.map(row => (row.task ?? row).category))];
      categoryBodies = []; refreshFoldAll();
      const hidden = selection.hidden + ownerHidden;
      clear.hidden = !externalActive && !hidden && !search && !filters.skills.length && !filters.doable && !filters.pinned && !filters.hidePartnerClaims && !filters.onlyMyClaims && filters.sort === 'default';
      hiddenCount.textContent = `${hidden.toLocaleString()} hidden by filters${clear.hidden ? '' : ' · '}`;
      summary.hidden = !hidden && clear.hidden;
      toggle.textContent = `Filter & sort${filters.skills.length || filters.doable || filters.pinned || filters.hidePartnerClaims || filters.onlyMyClaims ? ' · on' : ''}`;
      return shown;
    },
    category(heading, category, body, paint) {
      const control = el('button', undefined, 'task-category-toggle'); control.type = 'button'; control.dataset.category = category;
      body.id = `active-task-category-${++categoryId}`; control.setAttribute('aria-controls', body.id);
      categoryBodies.push(body.id); refreshFoldAll();
      // Preserve the existing category label and its icon inside the button.
      if (heading.childNodes) control.append(...Array.from(heading.childNodes));
      else { control.textContent = heading.textContent; control.append(...heading.children); }
      heading.replaceChildren(control);
      let painted = !filters.folded.includes(category);
      const show = () => { const open = !filters.folded.includes(category); control.setAttribute('aria-expanded', String(open)); body.hidden = !open; return open; };
      const paintOnce = () => { if (!painted) { painted = true; return paint(); } };
      control.addEventListener('click', () => {
        const fold = !filters.folded.includes(category);
        filters = { ...filters, folded: fold ? [...filters.folded, category] : filters.folded.filter(value => value !== category) };
        writeTaskFilters(storage, filters); refreshFoldAll(); if (show()) void paintOnce();
      });
      return show();
    },
  };
}

export function appendTaskPin(document, content, pinned) {
  if (!pinned) return;
  const star = document.createElement('span'); star.className = 'task-pin-star'; star.setAttribute('role', 'img'); star.setAttribute('aria-label', 'Pinned');
  const icon = document.createElement('span'); icon.className = 'task-pin-icon'; icon.setAttribute('aria-hidden', 'true');
  star.append(icon); content.append(star);
}
