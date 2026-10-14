import { buildFinishLineModel } from './finish-line-model.mjs';
import { createFinishLineCopy } from './finish-line-copy.mjs';
import { loadBiSMemberResult } from './bis-results.mjs';

/** Shared checklist, with personal facts and a small explicit editing mode. */
export function renderFinishLine(c, model, { edit = false, expanded = new Set(), save, addCustom, canTick = () => false, customDraft = '', onCustomDraft = () => {} } = {}) {
  const root = c.el('div', undefined, 'finish-line-content');
  root.append(c.el('p', 'Draft — adjust this together. These are suggested goals before members, not a requirement to switch.', 'finish-line-intro'));
  const overview = c.el('div', undefined, 'finish-line-overview');
  for (const member of [...model.members, { ...model.duo, name: 'Duo' }]) {
    const row = c.el('div', undefined, 'finish-line-total');
    row.append(c.el('strong', `${member.name} ${member.percent}%`), c.el('span', `${member.done}/${member.total} done`, 'finish-line-note'));
    const progress = c.el('progress'); progress.max = 100; progress.value = member.percent;
    progress.setAttribute('aria-label', `${member.name} finish line progress`); row.append(progress); overview.append(row);
  }
  root.append(overview, c.el('p', 'Every goal counts the same, and levels count partly on the way to their target. Anything not recorded yet counts as not done. A duo goal is done once you have both finished it.', 'finish-line-note'));
  for (const group of model.groups) {
    if (!group.items.length && group.id === 'custom') continue;
    const section = c.el('details', undefined, 'finish-line-group'); section.open = expanded.has(group.id);
    section.dataset.group = group.id;
    const summary = c.el('summary'); summary.append(c.el('span', group.label), c.el('span', `${group.done}/${group.total} duo done`, 'finish-line-count'));
    section.append(summary);
    section.addEventListener('toggle', () => { if (section.open) expanded.add(group.id); else expanded.delete(group.id); });
    for (const item of group.items) {
      const row = c.el('div', undefined, `finish-line-item${item.enabled ? '' : ' finish-line-off'}`);
      row.dataset.item = item.id;
      const heading = c.el('div', undefined, 'finish-line-item-heading');
      if (edit) {
        const label = c.el('label', undefined, 'finish-line-include');
        const include = c.el('input'); include.type = 'checkbox'; include.checked = item.enabled;
        include.setAttribute('aria-label', `Include ${item.label}`);
        include.addEventListener('change', () => save(include, { type: 'set-finish-line-item', itemId: item.id, enabled: include.checked }));
        label.append(include, c.el('span', item.label, 'finish-line-item-label')); heading.append(label);
      } else heading.append(c.el('span', item.label, 'finish-line-item-label'));
      if (edit && item.kind === 'skill') {
        const target = c.el('input'); target.type = 'number'; target.min = 1; target.max = item.maxTarget ?? 120; target.step = 1; target.value = item.target;
        target.setAttribute('aria-label', `${item.label} target level`);
        target.addEventListener('change', () => {
          const level = Number(target.value);
          if (!Number.isSafeInteger(level) || level < 1 || level > Number(target.max)) {
            target.value = item.target; c.showError(new Error(`Choose a whole level from 1 to ${target.max}.`)); return;
          }
          if (level !== item.target) return save(target, { type: 'set-finish-line-item', itemId: item.id, target: level });
        });
        heading.append(target);
      }
      const status = c.el('p', item.enabled ? item.status : `Off · ${item.status}`, `finish-line-status${item.duo.done && item.enabled ? ' finish-line-done' : ''}`);
      row.append(heading, status);
      if (item.reason) row.append(c.el('p', item.reason, 'finish-line-note'));
      if (item.details?.length) row.append(c.el('p', item.details.join(' · '), 'finish-line-note'));
      if (edit && item.kind === 'custom') {
        const ticks = c.el('div', undefined, 'finish-line-ticks');
        for (const player of item.players.filter(player => canTick(player.memberId))) {
          const label = c.el('label'), tick = c.el('input'); tick.type = 'checkbox'; tick.checked = player.done;
          tick.setAttribute('aria-label', `${player.name}: ${item.label} done`);
          tick.addEventListener('change', () => save(tick, { type: 'set-finish-line-custom', itemId: item.id, memberId: player.memberId, completed: tick.checked }));
          label.append(tick, c.el('span', `${player.name} done`)); ticks.append(label);
        }
        row.append(ticks);
      }
      section.append(row);
    }
    root.append(section);
  }
  if (edit) {
    const form = c.el('form', undefined, 'finish-line-custom-form'), input = c.el('input');
    input.type = 'text'; input.maxLength = 500; input.required = true; input.placeholder = 'A goal for our duo';
    input.id = 'finish-line-custom-text'; input.value = customDraft;
    input.addEventListener('input', () => onCustomDraft(input.value));
    const label = c.el('label', 'Add a custom goal'); label.htmlFor = input.id;
    let pending = false;
    const add = c.button('Add goal', () => submit());
    const submit = async () => {
      if (pending) return;
      const text = input.value.trim(); if (!text) { input.focus(); return; }
      pending = true; add.disabled = true;
      try { await addCustom(add, text); }
      finally { pending = false; add.disabled = false; }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    form.append(label, input, add, c.el('p', 'Custom goals have a manual tick for each player. Changes are shared and can be undone in History.', 'finish-line-note')); root.append(form);
  }
  return root;
}

export function createFinishLineView(c) {
  let active, sequence = 0, loading;
  const current = run => active && run === sequence && c.dialogCurrent(active.generation);
  async function savedResults() {
    await c.ensureFullDefinitions?.();
    const results = new Map();
    for (const member of c.state.members) {
      try { results.set(member.id, await loadBiSMemberResult(c, member.id)); }
      catch (error) {
        if (error.code !== 'TASK_RESULTS_UNAVAILABLE') throw error;
        results.set(member.id, { memberId: member.id, stateRevision: c.state.revision, tasks: [] });
      }
    }
    return results;
  }
  function load(force = false) {
    if (!active || !c.dialogCurrent(active.generation)) return Promise.resolve();
    const signature = `${active.generation}:${c.state.revision}:${active.edit}`;
    if (loading?.signature === signature) return loading.promise;
    if (!force && active.rendered === signature) return Promise.resolve();
    const run = ++sequence, revision = c.state.revision;
    active.revision = revision; active.content.setAttribute('aria-busy', 'true');
    const focused = (c.document ?? globalThis.document)?.activeElement;
    const focusLabel = active.content.contains?.(focused) ? focused?.getAttribute?.('aria-label') : null;
    const promise = (async () => {
    try {
      const results = await savedResults();
      if (!current(run)) return;
      if (revision !== c.state.revision) { return load(); }
      const model = buildFinishLineModel(c.state, results, c.definitions);
      const write = c.canWrite() && !c.sandbox?.active;
      const toolbar = c.el('div', undefined, 'finish-line-toolbar');
      toolbar.append(createFinishLineCopy(c, model));
      toolbar.append(c.button('Refresh', () => load(true)));
      if (write) toolbar.append(c.button(active.edit ? 'Done editing' : 'Edit draft', () => { active.edit = !active.edit; return load(); }));
      else toolbar.append(c.el('span', 'View only', 'finish-line-note'));
      const save = async (control, payload) => {
        if (!current(run) || active.saving || !c.canWrite() || c.sandbox?.active) return;
        const generation = active.generation;
        active.saving = true; active.content.setAttribute('aria-busy', 'true');
        for (const node of active.content.querySelectorAll?.('input,button') ?? []) node.disabled = true;
        control.disabled = true;
        if (payload.type === 'add-finish-line-custom') active.customDraft = '';
        try {
          await c.command(payload, revision);
          if (c.dialogCurrent(generation) && active.generation === generation) {
            await load();
          }
          return true;
        }
        catch (error) {
          if (c.dialogCurrent(generation) && active.generation === generation) {
            if (payload.type === 'add-finish-line-custom') active.customDraft = payload.text;
            c.showError(error); await load(true);
          }
          return false;
        }
        finally {
          if (c.dialogCurrent(generation) && active.generation === generation) {
            active.saving = false;
            for (const node of active.content.querySelectorAll?.('input,button') ?? []) node.disabled = false;
            active.content.setAttribute('aria-busy', 'false');
          }
          control.disabled = false;
        }
      };
      active.content.replaceChildren(toolbar, renderFinishLine(c, model, { edit: active.edit && write, expanded: active.expanded, save,
        canTick: id => write && (c.sessionAdmin === true || c.sessionMember === id),
        customDraft: active.customDraft, onCustomDraft: value => { if (current(run)) active.customDraft = value; },
        addCustom: (control, text) => save(control, { type: 'add-finish-line-custom', itemId: `finish:${c.browserUUID()}`, text }) }));
      active.rendered = signature;
      active.content.setAttribute('aria-busy', String(!!active.saving));
      if (active.saving) for (const node of active.content.querySelectorAll?.('input,button') ?? []) node.disabled = true;
      if (focusLabel) [...active.content.querySelectorAll?.('[aria-label]') ?? []].find(node => node.getAttribute('aria-label') === focusLabel)?.focus();
    } catch {
      if (!current(run)) return;
      active.rendered = undefined;
      active.content.replaceChildren(c.el('p', 'Finish line could not be loaded. Try again.', 'status-detail'), c.button('Refresh finish line', () => load(true)));
      active.content.setAttribute('aria-busy', 'false');
    }
    })();
    loading = { signature, promise }; promise.finally(() => { if (loading?.promise === promise) loading = undefined; });
    return promise;
  }
  async function open() {
    c.closeTopMenus?.();
    if (c.sandbox?.active) { c.openDialog('F2P finish line', c.el('p', 'Exit Sandbox to view the saved finish line.', 'status-detail')); return; }
    const root = c.el('div', undefined, 'finish-line-panel'), content = c.el('div');
    content.append(c.el('p', 'Loading finish line…', 'status-detail')); root.append(content);
    active = { content, generation: c.openDialog('F2P finish line', root), edit: false, expanded: new Set(), customDraft: '', revision: c.state.revision };
    await load();
  }
  function refresh() { if (active && c.dialogCurrent(active.generation) && active.revision !== c.state.revision) void load(); }
  c.$('finish-line-open')?.addEventListener('click', () => open().catch(c.showError));
  const view = { open, refresh }; c.finishLine = view; return view;
}
