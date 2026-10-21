import { gatheringSettingDefinitions, calculatorBankingSettingDefinitions as bankingSettingDefinitions } from '../core/gathering-settings.mjs';

const labels = { 'cook-drop': 'Cook and drop', 'fletch-drop': 'Fletch and drop', unknown: 'Unknown', fire: 'Fire', range: 'Range' };
const label = value => labels[value] ?? (/^\d+$/.test(value) ? `${value}%` : value === 'none' ? 'None' : value === 'basic' ? 'Wood box' : value[0].toUpperCase() + value.slice(1));

/** Saved personal estimate choices, using the shell's revision-checked command. */
export function createBankingSettings(ctx, memberId, { query = '', inline = false, skill, advanced, isCurrent = () => true, onChange = () => {} } = {}) {
  const { el, select, command, showError = () => {} } = ctx;
  const content = el('section', undefined, inline ? 'helper-training-banking' : 'form-stack banking-settings');
  const writable = () => (typeof ctx.canWrite === 'function' ? ctx.canWrite() : ctx.canWrite) === true && typeof command === 'function';
  if (!writable()) { content.hidden = true; return content; }
  let disposed = false, generation = 0;
  const preferences = () => ctx.preferences?.(memberId) ?? ctx.state?.().members.find(member => member.id === memberId)?.preferences ?? {};
  const fields = el('div', undefined, inline ? 'helper-training-row' : 'form-stack');
  content.append(el(inline ? 'p' : 'h4', 'Gathering', inline ? 'helper-training-note' : undefined), fields);
  const controls = [], listeners = [];
  const definitions = [...bankingSettingDefinitions, ...gatheringSettingDefinitions];
  function restore() { for (const { definition, control } of controls) control.value = preferences()[definition.id] ?? definition.default; }
  function updateVisibility() {
    const selectedSkill = typeof skill === 'function' ? skill() : skill;
    for (const { definition, row, help, control } of controls) {
      const process = preferences().gatheringProcessing ?? 'none';
      if (inline && selectedSkill && definition.id === 'gatheringProcessing') {
        const allowed = selectedSkill === 'Fishing' ? 'cook-drop' : 'fletch-drop';
        for (const option of control.options ?? []) option.disabled = option.hidden = !['none', allowed].includes(option.value);
        if (!['none', allowed].includes(control.value)) control.value = 'none';
      }
      const extra = definition.id === 'gatheringProcessing' && ['Fishing', 'Woodcutting'].includes(selectedSkill)
        || definition.id === 'gatheringCookingFacility' && selectedSkill === 'Fishing' && process === 'cook-drop'
        || definition.id === 'gatheringCookingSuccess' && selectedSkill === 'Fishing' && process === 'cook-drop'
        || ['gatheringSurge', 'gatheringLodestones'].includes(definition.id) && (preferences().gatheringMode ?? 'drop') === 'bank';
      const shown = (!definition.advanced || (advanced ?? preferences().advanced) === true) && (!inline || !selectedSkill || definition.id === 'gatheringMode'
        || definition.id === 'gatheringOreBox' && selectedSkill === 'Mining'
        || definition.id === 'gatheringWoodBox' && selectedSkill === 'Woodcutting' || extra);
      row.hidden = !shown; if (inline) help.hidden = !shown;
    }
  }
  async function save(definition, control) {
    if (disposed || !isCurrent() || !writable()) { restore(); return; }
    const token = ++generation, dialog = ctx.dialogGeneration?.();
    const current = () => !disposed && token === generation && isCurrent() && (ctx.dialogCurrent?.(dialog) ?? true);
    controls.forEach(row => { row.control.disabled = true; }); onChange('saving');
    try {
      await command({ type: 'set-preference', memberId, preferenceId: definition.id, value: control.value });
      if (current()) { restore(); updateVisibility(); onChange('saved'); }
    } catch (error) {
      if (current()) { restore(); showError(error); onChange('error', error); }
    } finally { if (current()) controls.forEach(row => { row.control.disabled = !writable(); }); }
  }
  for (const definition of definitions) {
    if (query && !`gathering banking ${definition.label} ${definition.description} ${definition.options.join(' ')}`.toLowerCase().includes(query.toLowerCase())) continue;
    const row = el('div', undefined, inline ? 'helper-training-field' : 'rule-row setting-row settings-option');
    const text = el('div', undefined, inline ? undefined : 'field-copy');
    const control = select(definition.options.map(value => ({ value, label: label(value) })), preferences()[definition.id] ?? definition.default);
    control.id = `banking-${inline ? 'helper-' : ''}${memberId}-${definition.id}`;
    control.setAttribute('aria-label', definition.label);
    const title = el('label', definition.label, inline ? undefined : 'setting-title'); title.htmlFor = control.id;
    const help = el('p', definition.description, inline ? 'helper-training-note' : 'field-help'); help.id = `${control.id}-help`;
    control.setAttribute('aria-describedby', help.id);
    text.append(title); row.append(text, control); fields.append(row);
    if (inline) fields.append(help); else text.append(help);
    controls.push({ definition, control, row, help });
    const listener = () => save(definition, control); control.addEventListener('change', listener); listeners.push([control, listener]);
  }
  content.hidden = controls.length === 0;
  updateVisibility();
  content.refresh = () => { if (!disposed) { restore(); updateVisibility(); } };
  content.dispose = () => { disposed = true; generation++; for (const [control, listener] of listeners) control.removeEventListener?.('change', listener); };
  return content;
}
