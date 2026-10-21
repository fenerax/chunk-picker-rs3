import { MINING_PICKAXES, MINING_PROFILES } from '../training/mining-rates.mjs';
import { sameRuneScapeName } from '../core/game-progress.mjs';

export const miningPickaxeLabel = value => String(value).replace(/ \+ (\d+)/g, ' +$1');
export function assumedMiningPickaxe(level, pickaxes = MINING_PICKAXES) {
  const usable = pickaxes.filter(pick => Number.isInteger(level) && pick.level <= level);
  return usable.at(-1) ?? null;
}
function savedMiningLevel(member) {
  const observation = member?.skillProgress?.Mining;
  return observation?.source === 'runemetrics' && sameRuneScapeName(observation.runescapeName, member.runescapeName)
    && Number.isInteger(observation.level) && observation.level >= 1 && observation.level <= 120
    && Number.isFinite(observation.xp) && observation.xp >= 0 ? observation.level : null;
}

/** Personal estimate choices. All writes use the shell's revision-checked command. */
export function createMiningSettings(ctx, memberId, { query = '', inline = false, level, isCurrent = () => true, onChange = () => {} } = {}) {
  const { el, select, command, showError = () => {} } = ctx;
  const content = el('section', undefined, inline ? 'helper-training-mining' : 'form-stack mining-settings');
  const writable = () => (typeof ctx.canWrite === 'function' ? ctx.canWrite() : ctx.canWrite) === true && typeof command === 'function';
  if (!writable()) { content.hidden = true; return content; }
  let disposed = false, generation = 0;
  const preferences = () => ctx.preferences?.(memberId) ?? ctx.state?.().members.find(member => member.id === memberId)?.preferences ?? {};
  const miningLevel = () => typeof level === 'function' ? level() : level ?? savedMiningLevel(ctx.state?.().members.find(member => member.id === memberId));
  const title = el(inline ? 'p' : 'h4', 'Mining', inline ? 'helper-training-note' : undefined);
  const fields = el('div', undefined, inline ? 'helper-training-row' : 'form-stack');
  const controls = [], listeners = [];
  content.append(title, fields);
  const definitions = [
    { id: 'miningPickaxe', title: 'Pickaxe', help: 'Best for my level picks the best F2P pickaxe your Mining level allows. Choose the one you actually use.', default: 'auto', options: () => {
      const best = assumedMiningPickaxe(miningLevel());
      return [{ value: 'auto', label: best ? `Best for my level (${miningPickaxeLabel(best.label)})` : 'Best for my level' }, ...MINING_PICKAXES.map(pick => ({ value: pick.id, label: `${miningPickaxeLabel(pick.label)} · Mining ${pick.level}` }))];
    } },
    { id: 'miningAttention', title: 'Attention', help: 'Active clicking, occasional clicking or AFK.', default: 'active', options: () => MINING_PROFILES.map(profile => ({ value: profile.id, label: profile.id === 'afk' ? 'AFK' : profile.id === 'occasional' ? 'Occasional clicking' : 'Active clicking' })) },
  ];
  function helpText(definition) {
    if (definition.id !== 'miningPickaxe') return definition.help;
    const selected = MINING_PICKAXES.find(pick => pick.id === (preferences().miningPickaxe ?? 'auto'));
    const best = assumedMiningPickaxe(miningLevel());
    const summary = selected ? `${miningPickaxeLabel(selected.label)}. ` : best ? `Assumed: ${miningPickaxeLabel(best.label)}. ` : '';
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
    if (query && !`mining ${definition.title} ${definition.help} ${definition.id} active occasional afk rune`.toLowerCase().includes(query)) continue;
    const row = el('div', undefined, inline ? 'helper-training-field' : 'rule-row setting-row settings-option');
    const text = el('div', undefined, inline ? undefined : 'field-copy'), help = el('p', helpText(definition), inline ? 'helper-training-note' : 'field-help');
    const control = select(definition.options(), preferences()[definition.id] ?? definition.default);
    control.id = `mining-${inline ? 'helper-' : ''}${memberId}-${definition.id}`; help.id = `${control.id}-help`;
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
    const row = controls.find(row => row.definition.id === 'miningPickaxe');
    const option = row?.control.children?.[0];
    if (option) option.textContent = row.definition.options()[0].label;
    if (row) row.help.textContent = helpText(row.definition);
  };
  content.dispose = () => { disposed = true; generation++; for (const [control, listener] of listeners) control.removeEventListener?.('change', listener); };
  return content;
}
