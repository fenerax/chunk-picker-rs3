import { taskRuleBehavior, taskRuleCategoryCounts } from '../data/settings.mjs';
import { taskRuleAutomaticValue, planTaskRuleChange } from './rules-model.mjs';
import { captureReview, reviewChanges, reviewRules, reviewSelection, reviewRecord, reviewValue, ruleValueText, reviewSummary } from './rules-review-model.mjs';
import { createRuleReviewPreview, rulePreviewText } from './rules-review-preview.mjs';

/** Session choices survive closing Rules for History; shared progress lives in the save. */
export function createRulesReview(ctx) {
  const { el, button, input, select, field, details } = ctx;
  let baseline, selectedId, filter = 'all', target, previewValue, previewIdentity, previewStatus = '', previewToken = 0;
  const drafts = new Map(), previews = createRuleReviewPreview(ctx.api);
  let host, options;
  const writable = () => ctx.canWrite?.() !== false;
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
    const progress = all.filter(row => reviewRecord(state, row.id).reviewed).length;
    host.append(el('p', `${progress} of ${all.length} reviewed · shared by both players`, 'rules-walk-progress'));
    const filters = select([{ value: 'all', label: 'All rules' }, { value: 'unreviewed', label: 'Not reviewed' },
      { value: 'different', label: 'Different between players' }, { value: 'changed', label: 'Changed during this review' },
      ...(all.some(row => row.members === true || row.membersOnly === true || row.requiresMembers === true) ? [{ value: 'members', label: 'Members content' }] : [])], filter);
    filters.addEventListener('change', () => { cancel(); filter = filters.value; render(); });
    const jump = select([...new Map(rows.map(row => [row.sectionId, { value: row.sectionId, label: row.sectionName }])).values()], rule?.sectionId);
    jump.addEventListener('change', () => { cancel(); selectedId = rows.find(row => row.sectionId === jump.value)?.id; render(); });
    const nav = el('div', undefined, 'rules-walk-navigation');
    const move = direction => { cancel(); selectedId = reviewSelection(rows, selectedId, direction)?.id; render(); host.querySelector?.('h3')?.focus?.(); };
    const previous = button('Previous', () => move(-1)), next = button('Next', () => move(1));
    const index = rows.findIndex(row => row.id === selectedId);
    previous.disabled = index <= 0; next.disabled = index < 0 || index === rows.length - 1;
    nav.append(previous, el('span', rows.length ? `${index + 1} of ${rows.length}` : '0 rules'), next);
    const tools = el('div', undefined, 'rules-walk-tools'); tools.append(field('Show', filters), field('Section', jump));
    host.append(tools, nav);
    if (!rule) host.append(el('p', 'No rules match this filter. Choose All rules to keep going.', 'empty-list'));
    else {
      const title = el('h3', rule.label); title.tabIndex = -1;
      const sheet = el('section', undefined, 'rules-walk-rule'); sheet.dataset.ruleId = rule.id;
      sheet.append(el('p', rule.sectionName, 'field-help'), title);
      if (rule.description) sheet.append(el('p', rule.description, 'rules-walk-explanation'));
      const more = details('More');
      for (const text of rule.tooltips ?? []) more.append(el('p', text, 'rules-original-tooltip'));
      if (rule.currentDescription && rule.currentDescription !== rule.description) more.append(el('p', rule.currentDescription));
      const behavior = rule.sharedRuleId ? null : taskRuleBehavior(rule.id);
      if (behavior && ['retained-only', 'not-implemented', 'partial'].includes(behavior.status)) more.append(el('p', behavior.detail));
      if (!(rule.tooltips?.length || rule.currentDescription)) more.append(el('p', rule.description || rule.label));
      sheet.append(more);
      const values = el('dl', undefined, 'rules-walk-values');
      for (const member of state.members) {
        const automatic = rule.sharedRuleId ? registry.get(rule.sharedRuleId).default : taskRuleAutomaticValue(state, member.id, rule).value;
        values.append(el('dt', member.name), el('dd', `${ruleValueText(reviewValue(state, member.id, rule, registry))} · Automatic (${ruleValueText(automatic)})`));
      }
      sheet.append(values);
      const owner = state.members.find(member => member.id === target) ?? state.members[0];
      const selectedValue = reviewValue(state, owner.id, rule, registry);
      const identity = JSON.stringify([rule.id, target, state.revision]);
      if (previewIdentity !== identity) { cancel(); previewIdentity = identity; previewValue = rule.type === 'boolean' ? !selectedValue : selectedValue; }
      const renderedRevision = state.revision;
      const fresh = () => options.current() && !options.busy() && writable() && ctx.state().revision === renderedRevision;
      if (writable()) {
        const who = select([...state.members.map(member => ({ value: member.id, label: member.name })), { value: 'both', label: 'Both players' }], target);
        who.disabled = options.busy() || !!rule.sharedRuleId;
        if (rule.sharedRuleId) who.value = 'both';
        who.addEventListener('change', () => { cancel(); target = who.value; render(); });
        const controls = el('div', undefined, 'rules-walk-controls'); controls.append(field('Change for', who));
        const ids = () => target === 'both' ? ctx.state().members.map(member => member.id) : [target];
        const apply = async value => {
          if (!fresh()) { options.stale(); render(); return; }
          cancel();
          await options.save(rule.sharedRuleId ? [{ type: 'set-rule', ruleId: rule.sharedRuleId, value }]
            : planTaskRuleChange(ctx.state(), ids(), rule, value).commands, renderedRevision);
        };
        if (rule.type === 'boolean') {
          for (const value of [true, false]) {
            const set = button(value ? 'On' : 'Off', () => apply(value)); set.disabled = options.busy();
            set.setAttribute('aria-label', `Set ${rule.label} ${value ? 'On' : 'Off'}`); controls.append(set);
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
          const same = automatic.every((value, i) => Object.is(value, reviewValue(state, ids()[i], rule, registry)));
          const label = same ? 'Same as automatic' : `Use automatic (${automatic.every(value => Object.is(value, automatic[0])) ? ruleValueText(automatic[0]) : 'different values'})`;
          const reset = button(label, async () => {
            if (!fresh()) { options.stale(); render(); return; }
            cancel(); await options.save(ids().filter(id => Object.hasOwn(ctx.state().members.find(member => member.id === id).taskRules ?? {}, rule.id))
              .map(memberId => ({ type: 'reset-task-rule', memberId, ruleId: rule.id })), renderedRevision);
          });
          reset.disabled = options.busy() || same; controls.append(reset);
        }
        sheet.append(controls);
        if (!rule.sharedRuleId) {
          const preview = el('div', undefined, 'rules-walk-preview');
          const previewMember = select(state.members.map(member => ({ value: member.id, label: member.name })), owner.id);
          previewMember.addEventListener('change', () => { cancel(); target = previewMember.value; render(); });
          const value = rule.type === 'boolean' ? select([{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }], String(previewValue))
            : rule.type === 'enum' ? select(rule.options, previewValue) : input(rule.type === 'number' ? 'number' : 'text', previewValue ?? '');
          value.addEventListener('change', () => { cancel(); previewValue = rule.type === 'boolean' ? value.value === 'true' : rule.type === 'number' ? Number(value.value) : value.value; render(); });
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
      };
      reviewed.disabled = note.disabled = !writable() || options.busy();
      reviewed.addEventListener('change', () => saveRecord(reviewed.checked).catch(ctx.showError));
      sheet.append(tick, field('Shared note (up to 500 characters)', note));
      if (writable() && drafts.has(rule.id) && draft.revision !== renderedRevision) {
        sheet.append(el('p', `The save changed. Saved note: ${record.note || '(empty)'}`, 'field-help'), button('Keep draft after reading saved note', () => {
          if (!fresh()) { options.stale(); render(); return; }
          drafts.set(rule.id, { note: note.value, revision: renderedRevision }); render();
        }), button('Reload saved note', () => { drafts.delete(rule.id); render(); }));
      }
      if (writable()) { const saveNote = button('Save note', () => saveRecord(record.reviewed)); saveNote.disabled = options.busy(); sheet.append(saveNote); }
      host.append(sheet);
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
