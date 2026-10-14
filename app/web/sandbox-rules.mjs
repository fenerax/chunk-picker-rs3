import { taskRuleDefinitions, taskRuleCutoffDefaults, taskRuleValueError } from '../data/settings.mjs';
import { taskRuleValue } from './rules-model.mjs';

/** A personal scalar override editor avoids the saved panel's profile cascades. */
export function openSandboxRules(ctx) {
  const owner = ctx.state().members.find(row => row.id === ctx.memberId());
  const rules = [...taskRuleDefinitions].sort((a, b) => a.label.localeCompare(b.label));
  const choice = ctx.select(rules.map(rule => ({ value: rule.id, label: `${rule.category} · ${rule.label}` })), 'Multi Step Processing');
  const editor = ctx.el('div', undefined, 'form-stack'), status = ctx.el('p', '', 'status-detail');
  const render = () => {
    const rule = rules.find(row => row.id === choice.value);
    if (!rule) return;
    const current = taskRuleValue(ctx.state(), owner.id, rule);
    const source = current.source === 'Inherited' ? 'Shared setting' : current.source === 'Personal override' ? 'Personal setting' : current.source === 'Imported' ? 'From the original picker' : 'Automatic';
    const currentText = current.value === undefined ? 'Default' : typeof current.value === 'boolean' ? (current.value ? 'On' : 'Off') : String(current.value);
    const value = rule.type === 'boolean'
      ? ctx.select([{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }], String(current.value === true))
      : ctx.input('text', current.value ?? taskRuleCutoffDefaults[rule.id] ?? '');
    const apply = ctx.button('Try this rule', async () => {
      const setting = rule.type === 'boolean' ? value.value === 'true' : value.value.trim();
      const error = taskRuleValueError(rule.id, setting);
      if (error) throw new Error(error);
      apply.disabled = true;
      try {
        await ctx.command({ type: 'set-task-rule', memberId: owner.id, ruleId: rule.id, value: setting });
        status.textContent = `Trying ${rule.label} in Sandbox. Nothing was saved.`;
      } finally { apply.disabled = false; }
    });
    status.textContent = '';
    editor.replaceChildren(ctx.el('p', ctx.plain(rule.description), 'section-intro'),
      ctx.el('p', `${source}: ${currentText}`, 'status-detail'),
      ctx.field('Try this setting', value), apply);
  };
  choice.addEventListener('change', render); render();
  ctx.openDialog('Sandbox task rules', ctx.el('p', `Try a task rule for ${owner.name}. Undo last step or Reset in the sandbox banner restores it.`, 'section-intro'),
    ctx.field('Task rule', choice), editor, status);
}
