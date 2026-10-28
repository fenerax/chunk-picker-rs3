import { WOODCUTTING_HATCHETS } from '../training/woodcutting-rates.mjs';
import { progressBelongsToMember } from '../core/game-progress.mjs';

export const woodcuttingHatchetLabel = value => String(value).replace(/ \+ (\d+)/g, ' +$1');
export function assumedWoodcuttingHatchet(level, hatchets = WOODCUTTING_HATCHETS) {
  const usable = hatchets.filter(pick => Number.isInteger(level) && pick.level <= level);
  return usable.at(-1) ?? null;
}
function savedWoodcuttingLevel(member) {
  const observation = member?.skillProgress?.Woodcutting;
  return progressBelongsToMember(observation, member)
    && Number.isInteger(observation.level) && observation.level >= 1 && observation.level <= 120
    && Number.isFinite(observation.xp) && observation.xp >= 0 ? observation.level : null;
}

/** Personal estimate choices. All writes use the shell's revision-checked command. */
export function createWoodcuttingSettings(ctx, memberId, { query = '', inline = false, level, isCurrent = () => true, onChange = () => {} } = {}) {
  const { el, select, command, showError = () => {} } = ctx;
  const content = el('section', undefined, inline ? 'helper-training-woodcutting' : 'form-stack woodcutting-settings');
  const writable = () => (typeof ctx.canWrite === 'function' ? ctx.canWrite() : ctx.canWrite) === true && typeof command === 'function';
  if (!writable()) { content.hidden = true; return content; }
  let disposed = false, generation = 0;
  const preferences = () => ctx.preferences?.(memberId) ?? ctx.state?.().members.find(member => member.id === memberId)?.preferences ?? {};
  const woodcuttingLevel = () => typeof level === 'function' ? level() : level ?? savedWoodcuttingLevel(ctx.state?.().members.find(member => member.id === memberId));
  const title = el(inline ? 'p' : 'h4', 'Woodcutting', inline ? 'helper-training-note' : undefined);
  const fields = el('div', undefined, inline ? 'helper-training-row' : 'form-stack');
  const controls = [], listeners = [];
  content.append(title, fields);
  const definitions = [
    { id: 'woodcuttingHatchet', title: 'Hatchet', help: 'Best for my level picks the best F2P hatchet your Woodcutting level allows. Choose the one you actually use.', default: 'auto', options: () => {
      const best = assumedWoodcuttingHatchet(woodcuttingLevel());
      return [{ value: 'auto', label: best ? `Best for my level (${woodcuttingHatchetLabel(best.label)})` : 'Best for my level' }, ...WOODCUTTING_HATCHETS.map(pick => ({ value: pick.id, label: `${woodcuttingHatchetLabel(pick.label)} · Woodcutting ${pick.level}` }))];
    } },
  ];
  function helpText(definition) {
    if (definition.id !== 'woodcuttingHatchet') return definition.help;
    const selected = WOODCUTTING_HATCHETS.find(pick => pick.id === (preferences().woodcuttingHatchet ?? 'auto'));
    const best = assumedWoodcuttingHatchet(woodcuttingLevel());
    const summary = selected ? `${woodcuttingHatchetLabel(selected.label)}. ` : best ? `Assumed: ${woodcuttingHatchetLabel(best.label)}. ` : '';
    return `${summary}${definition.help}`;
  }
  function restore() {
    for (const { definition, control, help } of controls) { control.value = preferences()[definition.id] ?? definition.default; help.textContent = helpText(definition); }
  }
  async function save(definition, control) {
    if (disposed || !isCurrent() || !writable()) { restore(); return; }
    const token = ++generation, dialog = ctx.dialogGeneration?.();
    const current = () => !disposed && token === generation && isCurrent() && (ctx.dialogCurrent?.(dialog) ?? true);
    const value = control.value;
    controls.forEach(row => { row.control.disabled = true; }); onChange('saving');
    try {
      await command({ type: 'set-preference', memberId, preferenceId: definition.id, value });
      if (current()) { restore(); onChange('saved'); }
    } catch (error) {
      if (current()) { restore(); showError(error); onChange('error', error); }
    } finally {
      if (current()) controls.forEach(row => { row.control.disabled = !writable(); });
    }
  }
  for (const definition of definitions) {
    if (query && !`woodcutting ${definition.title} ${definition.help} ${definition.id} bronze iron steel black mithril adamant rune`.toLowerCase().includes(query)) continue;
    const row = el('div', undefined, inline ? 'helper-training-field' : 'rule-row setting-row settings-option');
    const text = el('div', undefined, inline ? undefined : 'field-copy'), help = el('p', helpText(definition), inline ? 'helper-training-note' : 'field-help');
    const control = select(definition.options(), preferences()[definition.id] ?? definition.default);
    control.id = `woodcutting-${inline ? 'helper-' : ''}${memberId}-${definition.id}`; help.id = `${control.id}-help`;
    control.setAttribute('aria-label', definition.title); if (!inline) control.setAttribute('aria-describedby', help.id);
    const label = el('label', definition.title, inline ? undefined : 'setting-title'); label.htmlFor = control.id; if (inline) label.title = definition.help;
    text.append(label); if (!inline) text.append(help);
    row.append(text, control); fields.append(row); controls.push({ definition, control, help });
    const listener = () => save(definition, control); control.addEventListener('change', listener); listeners.push([control, listener]);
  }
  if (inline) content.append(el('p', 'Saved for this player.', 'helper-training-note'));
  content.hidden = controls.length === 0;
  content.refresh = () => {
    if (disposed) return;
    const row = controls.find(row => row.definition.id === 'woodcuttingHatchet');
    const option = row?.control.children?.[0];
    if (option) option.textContent = row.definition.options()[0].label;
    if (row) row.help.textContent = helpText(row.definition);
  };
  content.dispose = () => { disposed = true; generation++; for (const [control, listener] of listeners) control.removeEventListener?.('change', listener); };
  return content;
}
