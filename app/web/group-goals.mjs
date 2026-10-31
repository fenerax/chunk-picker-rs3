/** The shared, ordered goals list is independent of either player's task view. */
export function createGroupGoals(c) {
  let draft, saving = false, searchSequence = 0;
  const foldKey = 'rs3-group-goals-folded';
  let folded = false;
  try { folded = globalThis.localStorage?.getItem(foldKey) === '1'; } catch {}
  const setFolded = value => { folded = value; try { globalThis.localStorage?.setItem(foldKey, value ? '1' : '0'); } catch {} render(); };
  const writable = () => c.canWrite() && !c.sandbox?.active;
  const plain = value => c.plain(value ?? '');
  const goals = () => c.state?.groupGoals ?? [];

  function tasks() {
    const rows = [...(c.state?.tasks ?? []), ...(c.result?.tasks ?? [])];
    for (const result of c.duoResultCache?.results?.().values() ?? []) rows.push(...(result.tasks ?? []));
    return [...new Map(rows.map(task => [task.id, task])).values()];
  }

  function action(label, callback, disabled = false) {
    const button = c.button(label, () => {
      if (!writable() || saving) return;
      return callback();
    }, 'group-goal-action');
    button.disabled = disabled || saving;
    return button;
  }

  async function save(payload, revision, editor) {
    if (!writable() || saving || (editor && draft !== editor)) return;
    saving = true; render();
    try {
      await c.command(payload, revision);
      if (editor && draft === editor) draft = undefined;
    } catch (error) {
      c.showError(error);
    } finally {
      saving = false; render();
    }
  }

  function tick(goal, label, checked, memberId, revision) {
    const wrap = c.el('label', undefined, 'group-goal-tick');
    const input = c.input('checkbox'); input.checked = checked; input.disabled = saving;
    input.setAttribute('aria-label', `${label}: ${plain(goal.text)}`);
    input.addEventListener('change', () => {
      if (!writable() || saving) { input.checked = checked; return; }
      const payload = { type: 'set-group-goal-done', goalId: goal.id, done: input.checked };
      if (memberId !== undefined) payload.memberId = memberId;
      return save(payload, revision);
    });
    wrap.append(input, c.el('span', label)); return wrap;
  }

  function linked(goal) {
    const link = goal.link;
    if (!link) return undefined;
    const label = `${link.kind === 'task' ? 'Task' : 'Item'}: ${plain(link.label)}`;
    const task = link.kind === 'task' && tasks().find(row => row.id === link.id);
    if (writable() && task && typeof c.showTask === 'function') {
      return c.button(label, () => c.showTask(tasks().find(row => row.id === link.id) ?? task), 'group-goal-link');
    }
    // A saved item label remains useful without waking the full task calculator.
    return c.el('span', label, 'group-goal-link');
  }

  function openEditor(goal) {
    if (!writable() || saving) return;
    const editor = { goalId: goal?.id, revision: c.state.revision, link: goal?.link ? { ...goal.link } : undefined,
      originalLink: goal?.link ? { ...goal.link } : undefined };
    draft = editor; folded = false;
    editor.form = c.el('form', undefined, 'group-goal-editor');
    editor.text = c.input('text', goal?.text ?? ''); editor.text.required = true; editor.text.maxLength = 200;
    editor.completion = c.select([{ value: 'players', label: 'Each player' }, { value: 'group', label: 'Once for the group' }], goal?.completion ?? 'players');
    editor.kind = c.select([{ value: '', label: 'No link' }, { value: 'task', label: 'Picker task' }, { value: 'item', label: 'Picker item' }], goal?.link?.kind ?? '');
    editor.search = c.input('search'); editor.search.placeholder = 'Type at least 2 letters';
    editor.searchField = c.field('Find a link', editor.search);
    editor.matches = c.el('div', undefined, 'group-goal-matches');
    editor.matches.setAttribute('aria-live', 'polite');
    editor.selected = c.el('p', undefined, 'group-goal-note');
    editor.stale = c.el('p', undefined, 'group-goal-note'); editor.stale.setAttribute('role', 'status');
    editor.review = action('Keep draft', () => { editor.revision = c.state.revision; updateEditor(editor); });
    editor.submit = c.el('button', goal ? 'Save goal' : 'Add goal', 'group-goal-save'); editor.submit.type = 'submit';
    const dismiss = () => {
      if (saving || draft !== editor) return;
      draft = undefined; searchSequence++;
      const targets = render();
      (targets?.edits.get(editor.goalId) ?? targets?.add ?? targets?.fold)?.focus();
    };
    editor.cancel = c.button('Cancel', dismiss, 'group-goal-action');
    const controls = c.el('div', undefined, 'group-goal-editor-actions');
    controls.append(editor.submit, editor.cancel, editor.review);
    editor.form.append(c.field('Goal', editor.text), c.field('Complete', editor.completion), c.field('Link (optional)', editor.kind), editor.searchField, editor.selected, editor.matches, editor.stale, controls);
    editor.form.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || draft !== editor) return;
      event.preventDefault(); event.stopPropagation(); dismiss();
    });
    editor.form.addEventListener('submit', event => {
      event.preventDefault();
      if (!writable() || saving || draft !== editor) return;
      const text = editor.text.value.trim();
      if (!text) { c.showError(new Error('Enter a short goal.')); editor.text.focus(); return; }
      if (text.length > 200) { c.showError(new Error('Keep the goal to 200 characters.')); editor.text.focus(); return; }
      if (editor.kind.value && !editor.link) { c.showError(new Error('Choose a picker result, or select No link.')); return; }
      const payload = { type: editor.goalId ? 'update-group-goal' : 'add-group-goal',
        goalId: editor.goalId ?? `group-goal:${c.browserUUID()}`, text, completion: editor.completion.value };
      if (editor.link && (!editor.goalId || JSON.stringify(editor.link) !== JSON.stringify(editor.originalLink))) payload.link = { ...editor.link };
      else if (!editor.link && editor.goalId) payload.link = null;
      return save(payload, editor.revision, editor);
    });
    editor.kind.addEventListener('change', () => {
      if (draft !== editor || !writable() || saving) return;
      editor.link = undefined; editor.search.value = ''; searchSequence++;
      editor.matches.replaceChildren(); updateEditor(editor);
      if (editor.kind.value) editor.search.focus();
    });
    editor.search.addEventListener('input', () => searchLinks(editor));
    updateEditor(editor); render(); editor.text.focus();
  }

  function updateEditor(editor) {
    const hasKind = !!editor.kind.value;
    editor.searchField.hidden = !hasKind; editor.matches.hidden = !hasKind;
    editor.selected.hidden = !editor.link;
    editor.selected.textContent = editor.link ? `Linked ${editor.link.kind}: ${plain(editor.link.label)}` : '';
    const stale = editor.revision !== c.state.revision;
    const current = goals().find(goal => goal.id === editor.goalId);
    editor.stale.hidden = !stale;
    editor.stale.textContent = stale ? editor.goalId
      ? current ? `Shared goals changed. Saved goal: ${plain(current.text)} · ${current.completion === 'players' ? 'Each player' : 'Once for the group'}${current.link ? ` · ${plain(current.link.label)}` : ''}. Review before keeping your draft.`
        : 'This goal was removed. Cancel this edit to add a new goal.'
      : 'Shared goals changed. Review the list before keeping your draft.' : '';
    editor.review.hidden = !stale || (!!editor.goalId && !current);
    for (const control of [editor.text, editor.completion, editor.kind, editor.search, editor.submit, editor.cancel, editor.review]) control.disabled = saving;
    for (const control of editor.matches.children) if (control.tagName === 'BUTTON') control.disabled = saving;
  }

  async function searchLinks(editor) {
    const sequence = ++searchSequence, kind = editor.kind.value, query = editor.search.value.trim().toLocaleLowerCase();
    if (draft !== editor || !writable() || saving) return;
    editor.matches.replaceChildren();
    if (!kind || query.length < 2) return;
    const current = () => draft === editor && writable() && !saving && sequence === searchSequence;
    try {
      let candidates;
      if (kind === 'task') candidates = tasks().map(task => ({ kind, id: task.id, label: plain(task.label), category: plain(task.category) }));
      else {
        editor.matches.append(c.el('p', 'Loading picker items…', 'group-goal-note'));
        const [result, identities] = await Promise.all([c.ensureFullResult(false), import('../tasks/identity.mjs')]);
        if (!current()) return;
        candidates = (result.items ?? []).map(item => ({ kind, id: identities.entityId('item', item.name, item), label: plain(item.name) }))
          .filter(item => item.id.startsWith('rs3:entity:'));
      }
      if (!current()) return;
      const matches = candidates.filter(row => `${row.label} ${row.category ?? ''}`.toLocaleLowerCase().includes(query));
      editor.matches.replaceChildren();
      for (const choice of matches.slice(0, 8)) {
        const button = action(`${choice.label}${choice.category ? ` · ${choice.category}` : ''}`, () => {
          if (!current()) return;
          editor.link = { kind: choice.kind, id: choice.id, label: choice.label };
          editor.matches.replaceChildren(); editor.search.value = ''; updateEditor(editor); editor.submit.focus();
        });
        editor.matches.append(button);
      }
      if (!matches.length) editor.matches.append(c.el('p', 'No picker matches. Try another name.', 'group-goal-note'));
      else if (matches.length > 8) editor.matches.append(c.el('p', 'First 8 matches. Keep typing to narrow the list.', 'group-goal-note'));
    } catch (error) {
      if (current()) { editor.matches.replaceChildren(c.el('p', 'Could not load links. Type again to retry.', 'group-goal-note')); c.showError(error); }
    }
  }

  function render() {
    const root = c.$('group-goals');
    if (!root || !c.state) return;
    const focus = (c.document ?? globalThis.document)?.activeElement;
    const restoreFocus = draft?.form.contains?.(focus);
    const selection = restoreFocus ? [focus.selectionStart, focus.selectionEnd] : undefined;
    const write = writable(), list = goals(), revision = c.state.revision;
    const edits = new Map(); let add;
    const heading = c.el('div', undefined, 'group-goals-heading');
    const title = c.el('h2', 'Group goals'); title.id = 'group-goals-title';
    root.setAttribute('aria-labelledby', title.id); root.setAttribute('aria-busy', String(saving));
    const open = !folded || !!draft, doneCount = list.filter(goal => goal.done).length;
    const fold = c.button(list.length ? `${doneCount} of ${list.length} done` : open ? 'Hide' : 'Show', () => setFolded(open), 'group-goals-fold');
    fold.setAttribute('aria-expanded', String(open)); fold.setAttribute('aria-controls', 'group-goals-body');
    fold.setAttribute('aria-label', open ? 'Hide group goals' : 'Show group goals');
    heading.append(title, fold);
    if (write) { add = action('Add goal', () => openEditor(), !!draft); heading.append(add); }
    const content = c.el('ol', undefined, 'group-goals-list');
    for (const [index, goal] of list.entries()) {
      const row = c.el('li', undefined, `group-goal${goal.done ? ' group-goal-done' : ''}`); row.dataset.goalId = goal.id;
      row.append(c.el('p', plain(goal.text), 'group-goal-text'));
      const link = linked(goal); if (link) row.append(link);
      const progress = c.el('div', undefined, 'group-goal-progress');
      if (write) {
        progress.append(tick(goal, 'Done', !!goal.done, undefined, revision));
        if (goal.completion === 'players') for (const member of c.state.members) {
          progress.append(tick(goal, plain(member.name), goal.completedBy.includes(member.id), member.id, revision));
        }
      } else {
        progress.append(c.el('span', goal.done ? 'Done' : 'To do', 'group-goal-status'));
        if (goal.completion === 'players') for (const member of c.state.members) {
          progress.append(c.el('span', `${plain(member.name)}: ${goal.completedBy.includes(member.id) ? 'done' : 'to do'}`));
        }
      }
      const footer = c.el('div', undefined, 'group-goal-footer'); footer.append(progress); row.append(footer);
      if (write) {
        const controls = c.el('div', undefined, 'group-goal-actions');
        const edit = action('Edit', () => openEditor(goal), !!draft);
        edits.set(goal.id, edit);
        const up = action('Up', () => save({ type: 'move-group-goal', goalId: goal.id, index: index - 1 }, revision), index === 0);
        const down = action('Down', () => save({ type: 'move-group-goal', goalId: goal.id, index: index + 1 }, revision), index === list.length - 1);
        const remove = action('Remove', () => save({ type: 'remove-group-goal', goalId: goal.id }, revision), draft?.goalId === goal.id);
        for (const [button, verb] of [[edit, 'Edit'], [up, 'Move up'], [down, 'Move down'], [remove, 'Remove']]) button.setAttribute('aria-label', `${verb}: ${plain(goal.text)}`);
        controls.append(edit, up, down, remove); footer.append(controls);
        if (draft?.goalId === goal.id) { updateEditor(draft); row.append(draft.form); }
      }
      content.append(row);
    }
    const body = c.el('div', undefined, 'group-goals-body'); body.id = 'group-goals-body'; body.hidden = !open;
    root.replaceChildren(heading, body);
    if (list.length) body.append(content);
    else body.append(c.el('p', 'No shared goals yet.', 'group-goals-empty'));
    if (write && draft && (!draft.goalId || !list.some(goal => goal.id === draft.goalId))) { updateEditor(draft); body.append(draft.form); }
    if (write && restoreFocus) { focus.focus(); if (selection[0] !== null && selection[0] !== undefined) focus.setSelectionRange?.(...selection); }
    return { edits, add, fold };
  }

  c.groupGoals = { render };
  return c.groupGoals;
}
