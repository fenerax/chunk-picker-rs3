import { taskRuleBehavior } from '../data/settings.mjs';
import { rulesCatalogue, buildRulesSections, taskRuleValue, taskRuleAutomaticValue, ruleEnabled, filterRulesSections, planTaskRuleChange, reviewPreset, profileCommands } from './rules-model.mjs';
import { visibleRulesSections } from './kept-rules.mjs';
import { createRulesReview } from './rules-review.mjs';
import { ruleValueText } from './rules-review-model.mjs';
import { appendRuleExplanation } from './rule-explanations.mjs';

const advanced = ctx => ctx.canWrite?.() !== false && ctx.preferences?.().advanced === true;
const displayValue = value => value === undefined ? 'Automatic' : value === true ? 'On' : value === false ? 'Off' : String(value);

/** The catalogue editor uses only the revision-checked command/profile seam. */
export function createRulesPanel(ctx) {
  const { el, input, select, field, button, details, command, showError } = ctx;
  const guidedReview = createRulesReview(ctx);
  let reviewMode = false;
  function open({ ruleId, memberId } = {}) {
    if (ruleId) reviewMode = false;
    const writable = ctx.canWrite?.() !== false;
    let target = ctx.state().members.some(member => member.id === memberId) ? memberId : ctx.memberId(), generation, busy = false, reviewApply;
    const expanded = new Set([rulesCatalogue.sections[0].id]);
    const root = el('div', undefined, 'rules-panel');
    const tools = el('div', undefined, 'rules-tools'), targetControl = select([
      ...ctx.state().members.map(member => ({ value: member.id, label: member.name })), { value: 'both', label: 'Both players' },
    ], target);
    targetControl.id = 'rules-target';
    const presetControl = select(rulesCatalogue.presets.map(preset => ({ value: preset.name, label: preset.name })), rulesCatalogue.presets[0].name);
    presetControl.id = 'rules-preset';
    const search = input('search'); search.id = 'rules-search'; search.placeholder = 'Find a rule…';
    search.value = ruleId ?? '';
    const onlyOn = input('checkbox'); onlyOn.id = 'rules-only-on';
    const onLabel = el('label', undefined, 'rules-on-filter'); onLabel.htmlFor = onlyOn.id; onLabel.append(onlyOn, el('span', 'Only show rules that are on'));
    const scope = el('p', undefined, 'rules-scope'), status = el('p', undefined, 'rules-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const reviewHost = el('div', undefined, 'rules-review-host');
    const layout = el('div', undefined, 'rules-layout'), navigation = el('nav', undefined, 'rules-navigation'); navigation.setAttribute('aria-label', 'Rule sections');
    const sectionsHost = el('div', undefined, 'rules-sections');
    const jump = select([], ''); jump.id = 'rules-jump'; jump.setAttribute('aria-label', 'Jump to a rule section');
    const profileHost = el('div', undefined, 'rules-profiles');
    const memberIds = () => target === 'both' ? ctx.state().members.map(member => member.id) : [target];
    const current = () => ctx.dialogCurrent?.(generation) ?? true;
    const registry = () => ctx.registry();
    const ruleDefinitions = () => visibleRulesSections(buildRulesSections(rulesCatalogue, ctx.state(), registry().definitions), advanced(ctx));
    const fact = (definition, memberId) => definition.sharedRuleId
      ? { value: registry().resolve(ctx.state().rules)[definition.sharedRuleId], source: 'Shared · both players', explicit: true }
      : taskRuleValue(ctx.state(), memberId, definition);
    function combinedFact(definition) {
      const ids = memberIds(), facts = ids.map(id => fact(definition, id)), same = facts.every(item => Object.is(item.value, facts[0].value));
      return { ...facts[0], value: same ? facts[0].value : undefined, mixed: !same,
        source: definition.sharedRuleId ? 'Shared · both players' : ids.length === 1 ? facts[0].source : ids.map((id, index) => `${ctx.state().members.find(member => member.id === id).name}: ${displayValue(facts[index].value)}`).join(' · ') };
    }
    function sectionCount(section) {
      return section.rules.filter(rule => memberIds().some(id => fact(rule, id).value === true)).length;
    }
    async function save(commands, revision = ctx.state().revision) {
      if (!writable || !current() || busy || !commands.length) return;
      busy = true; render();
      let applied = 0;
      try {
        for (const payload of commands) { await command(payload, revision + applied); applied++; }
        if (current()) status.textContent = commands.length === 1 ? 'Saved. Undo is available in History.' : 'Saved for both players. Each player’s save can be undone in History.';
      } catch (error) {
        if (current()) { status.textContent = applied ? 'One player’s change was saved before the next save failed. Use History to review or undo it.' : 'Change was not saved. Review the latest rules and try again.'; showError(error); }
      } finally {
        busy = false;
        if (current()) render();
      }
    }
    function jumpTo(id) {
      expanded.add(id); render();
      sectionsHost.querySelector?.(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderReview(review) {
      if (!current()) return;
      reviewHost.replaceChildren();
      const box = el('section', undefined, 'rules-review'), title = el('h3', `Review ${review.name}`);
      title.tabIndex = -1;
      const saveCount = review.commands.length;
      const summary = el('p', `${review.changes.length} changes. ${saveCount > 1 ? 'One undoable save per player.' : 'One save, one Undo.'}`, 'field-help');
      const changes = el('ul', undefined, 'rules-review-changes');
      for (const change of review.changes) changes.append(el('li', `${change.memberName} · ${ruleDefinitions().flatMap(section => section.rules).find(rule => rule.id === change.ruleId)?.label ?? registry().get(change.ruleId)?.label ?? change.ruleId}: ${displayValue(change.before)} → ${displayValue(change.after)}${change.beforeSource === 'Automatic' ? ' (saves your choice)' : ''}`));
      if (!review.changes.length) changes.append(el('li', 'These values are already saved.'));
      const apply = button('Apply preset', async () => {
        if (!current()) return;
        if (busy) { status.textContent = 'Wait for the current save, then review the preset again.'; return; }
        if (ctx.state().revision !== review.revision) { status.textContent = 'Rules changed since this review. Review the preset again.'; apply.disabled = true; return; }
        await save(review.commands, review.revision);
        if (current()) reviewHost.replaceChildren();
      }, 'primary-action');
      apply.disabled = busy || !review.changes.length;
      reviewApply = { button: apply, hasChanges: !!review.changes.length };
      box.append(title, summary, el('p', 'Original preset values are listed below. Unused and other rules keep their saved choices.', 'field-help'), changes,
        el('div', undefined, 'rules-review-actions'));
      box.children[box.children.length - 1].append(apply, button('Cancel review', () => { reviewHost.replaceChildren(); reviewApply = null; }));
      reviewHost.append(box); title.focus?.();
    }
    const reviewButton = button('Review preset', () => {
      const preset = rulesCatalogue.presets.find(item => item.name === presetControl.value);
      if (preset) renderReview(reviewPreset(ctx.state(), memberIds(), preset));
    });
    tools.append(field('Task rules for', targetControl), field('Original preset', presetControl), reviewButton);
    const guidedHost = el('div', undefined, 'rules-walk');
    const modeButton = button('Review rules', () => { guidedReview.cancel(); reviewMode = !reviewMode; render(); });
    root.append(modeButton, guidedHost);
    root.append(scope);
    if (writable) root.append(tools);
    root.append(field('Find a rule', search), onLabel, status, reviewHost, field('Jump to section', jump), layout);
    layout.append(navigation, sectionsHost);

    function rowFor(definition, definitions, memberValues) {
      const renderedRevision = ctx.state().revision;
      function freshRow() {
        if (!current() || busy) return false;
        if (ctx.state().revision === renderedRevision) return true;
        status.textContent = 'Rules changed since this row was shown. Review the latest value and try again.';
        render(); return false;
      }
      const value = combinedFact(definition), isShared = !!definition.sharedRuleId;
      const row = el('div', undefined, `rules-rule${definition.depth ? ' rules-child' : ''}${definition.contextOnly ? ' rules-context' : ''}`);
      row.dataset.ruleId = definition.id;
      if (definition.depth) row.className += ` rules-depth-${Math.min(definition.depth, 4)}`;
      const copy = el('div', undefined, 'rules-rule-copy'), controlId = `rules-control-${encodeURIComponent(definition.id)}`;
      const control = definition.type === 'boolean' ? input('checkbox') : definition.type === 'enum' ? select(definition.options, value.value) : input(definition.type === 'number' ? 'number' : 'text', value.value ?? '');
      control.id = controlId; control.setAttribute('aria-label', definition.label);
      if (definition.type === 'boolean') { control.checked = value.value === true; control.indeterminate = value.mixed || value.value === undefined; }
      else { control.placeholder = value.mixed ? 'Different values' : 'Automatic'; if (/Amount$/.test(definition.id)) control.setAttribute('inputmode', 'decimal'); }
      const canEdit = isShared || memberIds().every(id => ruleEnabled(definition, memberValues.get(id), definitions));
      control.disabled = !writable || busy || !canEdit;
      row.dataset.disabled = String(!canEdit);
      const label = el('label', undefined, 'rules-rule-title'); label.htmlFor = controlId;
      label.title = definition.description;
      if (definition.type === 'boolean') label.append(control, el('span', definition.label));
      else label.append(el('span', definition.label));
      if (definition.difficultyMarker === 'extreme-supreme') {
        const marker = el('span', ' *'); marker.title = 'Extreme / Supreme'; label.append(marker);
      }
      const behavior = isShared ? null : taskRuleBehavior(definition.id);
      const limited = behavior && ['retained-only', 'not-implemented', 'partial'].includes(behavior.status);
      if (advanced(ctx) && limited) { const badge = el('span', behavior.status === 'partial' ? 'Partly supported' : 'No effect yet', 'rules-coverage'); badge.title = behavior.status === 'partial' ? behavior.detail : 'Saved, but it does not change tasks in this picker yet.'; label.append(badge); }
      copy.append(label);
      if (!isShared) {
        for (const id of memberIds()) {
          const current = fact(definition, id), automatic = taskRuleAutomaticValue(ctx.state(), id, definition).value;
          const name = memberIds().length > 1 ? `${ctx.state().members.find(member => member.id === id).name}: ` : '';
          copy.append(el('p', `${name}Current: ${ruleValueText(current.value)} · ${current.explicit ? 'Your choice' : 'Automatic'}. Automatic default: ${ruleValueText(automatic)}.`, 'rules-value-source'));
        }
      }
      // Skip a description that only repeats the label.
      const plainText = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!appendRuleExplanation(ctx, copy, definition) && definition.description && plainText(definition.description) !== plainText(definition.label)) copy.append(el('p', definition.description, 'rules-desc'));
      // Only say where a value comes from when it matters: players differ, or the parent rule is off.
      const note = value.mixed ? `${ctx.state().members.map(member => member.name).join(' and ')} have different values.` : !canEdit ? `Turn on ${definition.parent ?? 'the parent rule'} to change this; its value is kept.` : '';
      if (note) copy.append(el('p', note, 'rules-value-source'));
      const help = details('More', el('p', isShared ? 'Shared by both players.' : 'For the selected player.', 'rules-current-description')); if (advanced(ctx)) help.append(el('p', `${isShared ? 'Shared by both players' : 'Personal'} · ${value.source}`, 'rules-current-description'));
      if (definition.explanation && definition.description) help.append(el('p', definition.description, 'rules-original-tooltip'));
      if (limited) help.append(el('p', behavior.status === 'partial' ? behavior.detail : 'This rule is saved but does not affect tasks yet.', 'rules-coverage-detail'));
      for (const tooltip of definition.tooltips ?? []) help.append(el('p', tooltip, 'rules-original-tooltip'));
      if (definition.currentDescription && definition.currentDescription !== definition.description) help.append(el('p', `In this picker: ${definition.currentDescription}`, 'rules-current-description'));
      if (advanced(ctx) && !isShared && !limited) help.append(el('p', `In this picker: ${behavior.detail}`, 'rules-current-description'));
      help.className = 'rules-help'; help.id = `${controlId}-help`; control.setAttribute('aria-describedby', help.id);
      copy.append(help); row.append(copy);
      if (definition.type !== 'boolean') row.append(control);
      control.addEventListener('change', async () => {
        if (!freshRow() || !canEdit) return;
        control.disabled = true;
        const next = definition.type === 'boolean' ? control.checked : definition.type === 'number' ? Number(control.value) : control.value;
        const commands = isShared ? [{ type: 'set-rule', ruleId: definition.sharedRuleId, value: next }] : planTaskRuleChange(ctx.state(), memberIds(), definition, next).commands;
        await save(commands, renderedRevision);
      });
      if (writable && !isShared && memberIds().some(id => taskRuleValue(ctx.state(), id, definition).explicit)) {
        const automatic = memberIds().map(id => taskRuleAutomaticValue(ctx.state(), id, definition).value);
        const same = automatic.every((item, index) => Object.is(item, fact(definition, memberIds()[index]).value));
        if (same) help.append(el('p', 'Same as automatic', 'field-help'));
        else {
          const reset = button(`Use automatic (${automatic.every(item => Object.is(item, automatic[0])) ? ruleValueText(automatic[0]) : 'different values'})`, () => {
            if (!freshRow()) return;
            return save(memberIds().filter(id => taskRuleValue(ctx.state(), id, definition).explicit).map(memberId => ({ type: 'reset-task-rule', memberId, ruleId: definition.id })), renderedRevision);
          }, 'rules-reset');
          reset.disabled = busy || !canEdit; help.append(reset);
        }
      }
      return row;
    }
    function keptRow(definition) {
      const value = combinedFact(definition), row = el('div', undefined, 'rules-kept-row');
      row.dataset.ruleId = definition.id;
      row.title = taskRuleBehavior(definition.id).detail;
      row.append(el('span', definition.label), el('span', value.mixed ? value.source : value.source === 'Automatic'
        ? `Automatic (${ruleValueText(value.value)})` : `${ruleValueText(value.value)}${writable ? ` · ${value.source}` : ''}`, 'rules-kept-value'));
      const copy = el('div', undefined, 'rules-kept-copy');
      appendRuleExplanation(ctx, copy, definition);
      const more = details('More');
      if (definition.description) more.append(el('p', definition.description, 'rules-original-tooltip'));
      for (const tooltip of definition.tooltips ?? []) more.append(el('p', tooltip, 'rules-original-tooltip'));
      if (definition.currentDescription && definition.currentDescription !== definition.description) more.append(el('p', definition.currentDescription));
      if (definition.description || definition.tooltips?.length || definition.currentDescription) copy.append(more);
      row.append(copy);
      return row;
    }
    function render() {
      const sections = ruleDefinitions(), definitions = sections.flatMap(section => section.rules);
      modeButton.textContent = reviewMode ? 'Back to all rules' : 'Review rules';
      modeButton.setAttribute('aria-pressed', String(reviewMode));
      root.dataset.reviewMode = String(reviewMode);
      guidedHost.hidden = !reviewMode;
      if (reviewMode) {
        guidedReview.mount(guidedHost, { sections: ruleDefinitions, current, busy: () => busy, save,
          stale: () => { status.textContent = 'Rules changed. Review the latest value and try again.'; } });
        return;
      }
      const memberValues = new Map(memberIds().map(id => [id, new Map(definitions.map(rule => [rule.id, fact(rule, id).value]))]));
      const values = new Map(definitions.map(rule => [rule.id, memberIds().some(id => fact(rule, id).value === true) ? true : combinedFact(rule).value]));
      const filtered = filterRulesSections(sections, values, { query: search.value, onlyOn: onlyOn.checked });
      navigation.replaceChildren(); sectionsHost.replaceChildren(); jump.replaceChildren();
      const jumpPrompt = el('option', 'Choose a section…'); jumpPrompt.value = ''; jump.append(jumpPrompt);
      scope.textContent = target === 'both' ? `Task rules apply to ${ctx.state().members.map(member => member.name).join(' and ')}. Shared map rules always affect both players.` : `Task rules belong to ${ctx.state().members.find(member => member.id === target).name}. Shared map rules always affect both players.`;
      targetControl.disabled = presetControl.disabled = reviewButton.disabled = !writable || busy;
      if (reviewApply) reviewApply.button.disabled = busy || !reviewApply.hasChanges;
      for (const section of filtered) {
        const full = sections.find(item => item.id === section.id), count = section.kept ? `${full.rules.length} kept` : `${sectionCount(full)} on / ${full.rules.filter(rule => rule.type === 'boolean').length}`;
        const navButton = button(section.name, () => jumpTo(section.id), 'rules-nav-link'); navButton.append(el('span', section.kept ? `${full.rules.length} kept` : `${sectionCount(full)} on`, 'rules-nav-count')); navigation.append(navButton);
        const option = el('option', `${section.name} · ${section.kept ? `${full.rules.length} kept` : `${sectionCount(full)} on`}`); option.value = section.id; jump.append(option);
        const group = el('details', undefined, 'rules-section'); group.dataset.sectionId = section.id; group.id = `rules-section-${section.id}`;
        group.open = expanded.has(section.id) || !!search.value.trim() || !!onlyOn.checked;
        const summary = el('summary'); summary.append(el('span', section.name, 'rules-section-name'), el('span', count, 'rules-section-count')); group.append(summary);
        group.addEventListener('toggle', () => { if (group.open) expanded.add(section.id); else expanded.delete(section.id); });
        const rows = el('div', undefined, 'rules-section-rows');
        for (const definition of section.rules) rows.append(section.kept || !writable ? keptRow(definition) : rowFor(definition, definitions, memberValues));
        group.append(rows); sectionsHost.append(group);
      }
      if (!filtered.length) sectionsHost.append(el('p', 'No matching rules. Clear the search or turn off the On filter.', 'empty-list'));
    }
    targetControl.addEventListener('change', () => { target = targetControl.value; reviewHost.replaceChildren(); reviewApply = null; render(); });
    search.addEventListener('input', render); onlyOn.addEventListener('change', render); jump.addEventListener('change', () => { if (jump.value) jumpTo(jump.value); });
    const exportButton = button('Export rule profile', () => {
      const id = target === 'both' ? ctx.memberId() : target;
      ctx.download({ format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: ctx.state().rules, taskRules: ctx.state().members.find(member => member.id === id).taskRules ?? {} }, 'rs3-rule-profile.json');
    });
    const file = input('file'); file.accept = '.json,application/json';
    file.addEventListener('change', async () => {
      const requestGeneration = generation, requestedTarget = target;
      try {
        const profile = await ctx.readJSON(file);
        if (!ctx.dialogCurrent?.(requestGeneration) || target !== requestedTarget) return;
        const id = requestedTarget === 'both' ? ctx.memberId() : requestedTarget;
        const response = await ctx.api('/api/profile/preview', { profile, memberId: id });
        if (!ctx.dialogCurrent?.(requestGeneration) || target !== requestedTarget) return;
        const previewGeneration = ctx.openDialog('Apply rule profile', ...(advanced(ctx) ? [ctx.jsonPreview(response)] : [el('p', `Apply this profile to ${ctx.state().members.find(member => member.id === id).name}? It will replace their saved rules. Undo is available in History.`)]), button('Apply profile', async () => {
          await command({ type: 'set-profile', memberId: id, rules: profile.rules, taskRules: profile.taskRules }, response.stateRevision);
          ctx.closeDialog(previewGeneration);
        }));
      } catch (error) { if (ctx.dialogCurrent?.(requestGeneration)) showError(error); }
    });
    profileHost.append(el('h3', 'Saved profiles'), el('p', 'Export or import a profile for the selected player. With Both players selected, the current map player owns the profile.', 'field-help'), exportButton, field('Import rule profile', file));
    if (writable) root.append(details('Profiles & history', profileHost));
    const footer = el('div', undefined, 'rules-footer');
    footer.append(el('p', 'Automatic clears your personal choice and uses the shared or imported value, then the picker’s default if neither exists. The value beside Automatic shows the result. Turning off a parent rule keeps the choices beneath it.', 'field-help'), button(writable ? 'History & Undo' : 'History', () => { guidedReview.cancel(); ctx.historyDialog(); }));
    root.append(footer);
    generation = ctx.openDialog('Chunk Rules', root); render();
    if (ruleId) ctx.$?.(`rules-control-${encodeURIComponent(ruleId)}`)?.focus?.();
    ctx.$?.('tool-dialog')?.addEventListener('close', () => guidedReview.cancel(), { once: true });
    return root;
  }
  return { open };
}
