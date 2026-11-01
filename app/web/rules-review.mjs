import { ANCIENT_EFFIGIES_RULE, taskRuleBehavior, taskRuleCategoryCounts } from '../data/settings.mjs';
import { taskRuleAutomaticValue, planTaskRuleChange } from './rules-model.mjs';
import { captureReview, reviewChanges, reviewRules, reviewSelection, reviewRecord, reviewValue, ruleValueText, reviewSummary, reviewRuleLabel } from './rules-review-model.mjs';
import { createRuleReviewPreview, rulePreviewText } from './rules-review-preview.mjs';
import { appendRuleExplanation } from './rule-explanations.mjs';

/** Session choices survive closing Rules for History; shared progress lives in the save. */
export function createRulesReview(ctx) {
  const { el, button, input, select, field, details } = ctx;
  let baseline, selectedId, filter = 'all', target, previewValue, previewIdentity, previewStatus = '', previewToken = 0;
  const drafts = new Map(), previews = createRuleReviewPreview(ctx.api);
  let host, options;
  const writable = () => ctx.canWrite?.() !== false;
  const advanced = () => writable() && ctx.preferences?.().advanced === true;
  const focus = selector => host.querySelector?.(selector)?.focus?.();
  function cancel() { previewToken++; previews.cancel(); previewStatus = ''; }
  function mount(node, config) { host = node; options = config; render(); }
  function render() {
    if (!host || !options.current()) return;
    const state = ctx.state(), sections = options.sections(), all = sections.flatMap(section => section.rules), registry = ctx.registry();
    baseline ??= captureReview(state, all, registry);
    target ??= ctx.memberId();
    const changes = reviewChanges(state, all, baseline, registry), rows = reviewRules(sections, state, { filter, changes, registry });
    const rule = reviewSelection(rows, selectedId); selectedId = rule?.id;
    host.replaceChildren();
    const progress = rows.filter(row => reviewRecord(state, row.id).reviewed).length;
    host.append(el('p', `${progress} of ${rows.length} reviewed${advanced() ? ' (including advanced)' : ''} · shared by both players`, 'rules-walk-progress'));
    const filters = select([{ value: 'all', label: 'All rules' }, { value: 'unreviewed', label: 'Not reviewed' },
      { value: 'different', label: 'Different between players' }, { value: 'changed', label: 'Changed during this review' },
      ...(all.some(row => row.members === true || row.membersOnly === true || row.requiresMembers === true) ? [{ value: 'members', label: 'Members content' }] : [])], filter);
    filters.addEventListener('change', () => { cancel(); filter = filters.value; render(); host.querySelector?.('[data-review-filter]')?.focus(); });
    filters.dataset.reviewFilter = '';
    const jump = select([...new Map(rows.map(row => [row.sectionId, { value: row.sectionId, label: row.sectionName }])).values()], rule?.sectionId);
    jump.disabled = !rows.length;
    jump.addEventListener('change', () => { cancel(); selectedId = rows.find(row => row.sectionId === jump.value)?.id; render(); host.querySelector?.('h3')?.focus(); });
    const move = direction => { cancel(); selectedId = reviewSelection(rows, selectedId, direction)?.id; render(); host.querySelector?.('h3')?.focus?.(); };
    const index = rows.findIndex(row => row.id === selectedId);
    const navigation = label => {
      const nav = el('nav', undefined, 'rules-walk-navigation'); nav.setAttribute('aria-label', label);
      const previous = button('Previous', () => move(-1)), next = button('Next', () => move(1));
      previous.disabled = index <= 0; next.disabled = index < 0 || index === rows.length - 1;
      previous.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft'); next.setAttribute('aria-keyshortcuts', 'Alt+ArrowRight');
      nav.append(previous, el('span', rows.length ? `${index + 1} of ${rows.length}` : '0 rules'), next);
      return nav;
    };
    host.onkeydown = event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target?.isContentEditable
        || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (!direction || index + direction < 0 || index + direction >= rows.length) return;
      event.preventDefault(); move(direction);
    };
    const tools = el('div', undefined, 'rules-walk-tools'); tools.append(field('Show', filters), field('Section', jump));
    host.append(tools, navigation('Review navigation'));
    if (!rule) host.append(el('p', 'No rules match this filter. Choose All rules to keep going.', 'empty-list'));
    else {
      const label = reviewRuleLabel(rule), title = el('h3', label); title.tabIndex = -1;
      const sheet = el('section', undefined, 'rules-walk-rule'); sheet.dataset.ruleId = rule.id;
      sheet.append(el('p', rule.sectionName, 'field-help'), title);
      if (advanced()) sheet.append(el('small', rule.id, 'rules-walk-id'));
      if (!appendRuleExplanation(ctx, sheet, rule) && rule.description && reviewRuleLabel({ ...rule, label: rule.id }) !== label) sheet.append(el('p', rule.description, 'rules-walk-explanation'));
      const more = details('More');
      if (rule.explanation && rule.description) more.append(el('p', rule.description, 'rules-original-tooltip'));
      for (const text of rule.tooltips ?? []) more.append(el('p', text, 'rules-original-tooltip'));
      if (rule.currentDescription && rule.currentDescription !== rule.description) more.append(el('p', rule.currentDescription));
      const behavior = rule.sharedRuleId ? null : taskRuleBehavior(rule.id);
      if (behavior && ['retained-only', 'not-implemented', 'partial'].includes(behavior.status)) more.append(el('p', advanced() ? behavior.detail : 'Some parts of this rule do not affect tasks yet.'));
      if (rule.explanation && rule.description || rule.tooltips?.length || rule.currentDescription || behavior && ['retained-only', 'not-implemented', 'partial'].includes(behavior.status)) sheet.append(more);
      const values = el('dl', undefined, 'rules-walk-values');
      for (const member of state.members) {
        const automatic = rule.sharedRuleId ? registry.get(rule.sharedRuleId).default : taskRuleAutomaticValue(state, member.id, rule).value;
        values.append(el('dt', member.name), el('dd', `${ruleValueText(reviewValue(state, member.id, rule, registry))} · Automatic (${ruleValueText(automatic)})`));
      }
      sheet.append(values);
      sheet.append(el('p', rule.sharedRuleId ? 'This choice is shared by both players. Automatic shows the picker’s default for this shared rule.'
        : 'Automatic uses the shared or imported choice, then the picker’s default. “Use automatic” removes your personal override; it does not choose rules for you.', 'field-help'));
      const owner = state.members.find(member => member.id === target) ?? state.members[0];
      const selectedValue = reviewValue(state, owner.id, rule, registry);
      const identity = JSON.stringify([rule.id, target, state.revision]);
      if (previewIdentity !== identity) { cancel(); previewIdentity = identity; previewValue = rule.type === 'boolean' ? !selectedValue : selectedValue; }
      const renderedRevision = state.revision;
      const fresh = () => options.current() && !options.busy() && writable() && ctx.state().revision === renderedRevision;
      if (writable()) {
        const who = select([...state.members.map(member => ({ value: member.id, label: member.name })), { value: 'both', label: 'Both players' }], target);
        who.dataset.changeFor = '';
        who.disabled = options.busy() || !!rule.sharedRuleId;
        if (rule.sharedRuleId) who.value = 'both';
        who.addEventListener('change', () => { cancel(); target = who.value; render(); focus('[data-change-for]'); });
        const controls = el('div', undefined, 'rules-walk-controls'); controls.append(field('Change for', who));
        const ids = () => target === 'both' ? ctx.state().members.map(member => member.id) : [target];
        const apply = async value => {
          if (!fresh()) { options.stale(); render(); return; }
          cancel();
          await options.save(rule.sharedRuleId ? [{ type: 'set-rule', ruleId: rule.sharedRuleId, value }]
            : planTaskRuleChange(ctx.state(), ids(), rule, value).commands, renderedRevision);
          focus(`[data-set-value="${value}"]`);
        };
        if (rule.type === 'boolean') {
          for (const value of [true, false]) {
            const set = button(value ? 'On' : 'Off', () => apply(value)); set.disabled = options.busy();
            set.dataset.setValue = String(value);
            set.setAttribute('aria-label', `Set ${label} ${value ? 'On' : 'Off'}`);
            set.setAttribute('aria-pressed', String(ids().every(id => reviewValue(state, id, rule, registry) === value))); controls.append(set);
          }
        } else {
          const value = rule.type === 'enum' ? select(rule.options, selectedValue) : input(rule.type === 'number' ? 'number' : 'text', selectedValue ?? '');
          value.disabled = options.busy();
          const read = () => rule.type === 'number' ? Number(value.value) : value.value;
          const set = button('Save value', () => apply(read())); set.disabled = options.busy();
          controls.append(field('Value', value), set);
        }
        if (!rule.sharedRuleId) {
          const automatic = ids().map(id => taskRuleAutomaticValue(state, id, rule).value);
          // Automatic effigies follow Universal Tertiary: a saved override stays resettable even when it matches today.
          const follows = rule.id === ANCIENT_EFFIGIES_RULE && ids().some(id => Object.hasOwn(state.members.find(member => member.id === id)?.taskRules ?? {}, rule.id));
          const same = !follows && automatic.every((value, i) => Object.is(value, reviewValue(state, ids()[i], rule, registry)));
          if (same) controls.append(el('p', 'Same as automatic', 'field-help rules-walk-automatic'));
          else {
            const reset = button(`Use automatic (${follows ? 'follows Universal Tertiary' : automatic.every(value => Object.is(value, automatic[0])) ? ruleValueText(automatic[0]) : 'different values'})`, async () => {
              if (!fresh()) { options.stale(); render(); return; }
              cancel(); await options.save(ids().filter(id => Object.hasOwn(ctx.state().members.find(member => member.id === id).taskRules ?? {}, rule.id))
                .map(memberId => ({ type: 'reset-task-rule', memberId, ruleId: rule.id })), renderedRevision);
            });
            reset.disabled = options.busy(); controls.append(reset);
          }
        }
        sheet.append(controls);
        if (!rule.sharedRuleId) {
          const preview = el('div', undefined, 'rules-walk-preview');
          const previewMember = select(state.members.map(member => ({ value: member.id, label: member.name })), owner.id);
          previewMember.dataset.previewMember = '';
          previewMember.addEventListener('change', () => { cancel(); target = previewMember.value; render(); focus('[data-preview-member]'); });
          const value = rule.type === 'boolean' ? select([{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }], String(previewValue))
            : rule.type === 'enum' ? select(rule.options, previewValue) : input(rule.type === 'number' ? 'number' : 'text', previewValue ?? '');
          value.addEventListener('change', () => { cancel(); previewValue = rule.type === 'boolean' ? value.value === 'true' : rule.type === 'number' ? Number(value.value) : value.value; message.textContent = ''; });
          const message = el('p', previewStatus, 'rules-walk-preview-status'); message.setAttribute('role', 'status');
          const check = button('Check task effect', async () => {
            if (!options.current()) return;
            const token = ++previewToken, revision = ctx.state().revision;
            const setting = rule.type === 'boolean' ? value.value === 'true' : rule.type === 'number' ? Number(value.value) : value.value;
            const action = rule.type === 'boolean' ? `Turning this ${setting ? 'on' : 'off'}` : `Using ${setting}`;
            previewStatus = 'Checking…'; message.textContent = previewStatus; check.disabled = true;
            try {
              const plan = planTaskRuleChange(ctx.state(), [owner.id], rule, setting);
              const taskRules = Object.fromEntries(plan.changes.map(change => [change.ruleId, change.after]));
              taskRules[rule.id] = setting;
              const result = await previews.check({ stateRevision: revision, memberId: owner.id, ruleId: rule.id, value: setting, taskRules });
              if (token !== previewToken || !options.current() || ctx.state().revision !== revision) return;
              previewStatus = rulePreviewText(result, action); message.textContent = previewStatus;
            } catch (error) {
              if (token !== previewToken || !options.current()) return;
              previewStatus = error.name === 'AbortError' ? '' : `${error.message} Try checking again.`; message.textContent = previewStatus;
            } finally { if (token === previewToken && options.current()) check.disabled = false; }
          });
          preview.append(el('h4', 'Task effect'), field('Preview for', previewMember), field('Try', value), check);
          if (taskRuleCategoryCounts[rule.id]) preview.append(el('p', `About ${taskRuleCategoryCounts[rule.id]} listed tasks use this rule. Current tasks may differ.`, 'field-help'));
          preview.append(message); sheet.append(preview);
        }
      }
      const record = reviewRecord(state, rule.id), draft = drafts.get(rule.id) ?? { note: record.note, revision: renderedRevision };
      const reviewed = input('checkbox'); reviewed.checked = record.reviewed;
      const tick = el('label', undefined, 'rules-walk-reviewed'); tick.append(reviewed, el('span', 'Reviewed together'));
      const note = el('textarea'); note.value = draft.note; note.maxLength = 500; note.rows = 2;
      note.addEventListener('input', () => drafts.set(rule.id, { ...draft, note: note.value }));
      const saveRecord = async checked => {
        if (!fresh() || (drafts.has(rule.id) && draft.revision !== ctx.state().revision)) { options.stale(); render(); return; }
        const submittedDraft = drafts.get(rule.id);
        const text = note.value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
        await options.save([{ type: 'set-rule-review', ruleId: rule.id, reviewed: checked, note: text }], renderedRevision);
        if (reviewRecord(ctx.state(), rule.id).note === text && drafts.get(rule.id) === submittedDraft) drafts.delete(rule.id);
        render();
        focus(checked !== record.reviewed ? 'h3' : '[data-save-note]');
      };
      reviewed.disabled = note.disabled = !writable() || options.busy();
      reviewed.addEventListener('change', () => saveRecord(reviewed.checked).catch(ctx.showError));
      if (writable()) sheet.append(tick, field('Shared note (up to 500 characters)', note));
      else sheet.append(el('p', record.reviewed ? 'Reviewed together' : 'Not reviewed yet'), el('p', record.note || 'No shared note.', 'rules-walk-note'));
      if (writable() && drafts.has(rule.id) && draft.revision !== renderedRevision) {
        sheet.append(el('p', `The save changed. Saved note: ${record.note || '(empty)'}`, 'field-help'), button('Keep draft after reading saved note', () => {
          if (!fresh()) { options.stale(); render(); return; }
          drafts.set(rule.id, { note: note.value, revision: renderedRevision }); render();
        }), button('Reload saved note', () => { drafts.delete(rule.id); render(); }));
      }
      if (writable()) { const saveNote = button('Save note', () => saveRecord(record.reviewed)); saveNote.dataset.saveNote = ''; saveNote.disabled = options.busy(); sheet.append(saveNote); }
      host.append(sheet);
      if (rows.length > 1) host.append(navigation('Review navigation after note'), el('p', 'Keyboard: Alt + ← Previous · Alt + → Next', 'field-help rules-walk-shortcuts'));
    }
    const summaryText = reviewSummary(changes), summary = details(`Changes made during this review (${changes.length})`);
    const list = el('ul');
    for (const row of changes) list.append(el('li', `${row.member} · ${row.label}: ${ruleValueText(row.before)} → ${ruleValueText(row.after)}`));
    if (!changes.length) summary.append(el('p', 'No rule values changed.')); else summary.append(list);
    const copyStatus = el('p', '', 'field-help'); copyStatus.setAttribute('role', 'status');
    summary.append(button('Copy for Discord', async () => {
      try { const clipboard = ctx.clipboard ?? globalThis.navigator?.clipboard; if (!clipboard?.writeText) throw new Error(); await clipboard.writeText(summaryText); copyStatus.textContent = 'Copied'; }
      catch { copyStatus.textContent = 'Could not copy. Select the summary text and copy it.'; }
    }), copyStatus);
    host.append(summary);
  }
  return { mount, render, cancel };
}
