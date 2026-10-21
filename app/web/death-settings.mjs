import { deathSettingDefinitions, resolveDeathSettings, validateDeathSetting } from '../core/death-settings.mjs';

/** Small personal-settings surface; all writes use the existing validated command. */
const copy = {
  deathThresholdHours: ['Warning threshold (hours)', 'Mark a candidate when its slowest new task takes longer than this.'],
  defaultSecondsPerKill: ['Default seconds per kill', 'A starting guess: include fighting, respawns, travel and banking.'],
  showDeathChunks: ['Show time warnings', 'Mark slow roll candidates with skulls. You can still roll them.'],
};

export function createDeathSettings(ctx, memberId, { query = '' } = {}) {
  const { el, input, button, field, command, showError } = ctx;
  const member = () => ctx.state().members.find(owner => owner.id === memberId);
  const settings = () => resolveDeathSettings(member());
  const content = el('div', undefined, 'form-stack time-settings');
  let matches = 0;
  content.append(el('p', 'Estimates are planning aids. Drops and skills without timing data show as unknown.', 'section-intro'));

  async function save(id, value, controls, after = () => {}) {
    const generation = ctx.dialogGeneration?.(), current = () => ctx.dialogCurrent?.(generation) ?? true;
    controls.forEach(control => { control.disabled = true; });
    try {
      validateDeathSetting(id, value);
      await command({ type: 'set-preference', memberId, preferenceId: id, value });
      if (current()) after();
    } catch (error) {
      if (current()) { after(); showError(error); }
    } finally {
      if (current()) controls.forEach(control => { control.disabled = false; });
    }
  }

  for (const definition of deathSettingDefinitions.filter(item => item.type !== 'object')) {
    const [title, description] = copy[definition.id];
    if (query && !`${title} ${description} ${definition.id} skull death hours time estimates`.toLowerCase().includes(query)) continue;
    matches++;
    const checkbox = definition.type === 'boolean';
    const row = el('div', undefined, 'rule-row setting-row settings-option'), text = el('div', undefined, 'field-copy');
    const help = el('p', description, 'field-help'); help.id = `death-setting-${memberId}-${definition.id}`;
    const control = input(definition.type === 'boolean' ? 'checkbox' : 'number', settings()[definition.id]);
    if (definition.type === 'boolean') control.checked = settings()[definition.id];
    else { control.min = String(definition.min); control.max = String(definition.max); control.step = 'any'; }
    control.setAttribute('aria-label', title); control.setAttribute('aria-describedby', help.id);
    control.id = `death-control-${memberId}-${definition.id}`;
    const label = el('label', undefined, 'setting-title'); label.htmlFor = control.id;
    label.append(el('strong', title)); label.title = definition.description;
    text.append(label, help);
    const restore = () => { const value = settings()[definition.id]; if (definition.type === 'boolean') control.checked = value; else control.value = String(value); };
    control.addEventListener('change', () => save(definition.id, definition.type === 'boolean' ? control.checked : Number(control.value), [control], restore));
    row.append(text, control); content.append(row);
  }

  const overrides = el('section', undefined, 'dialog-section form-stack'), rows = el('div');
  overrides.append(el('h4', 'Monster kill times'), el('p', 'Set your pace for a monster using the exact name shown in its task sources.', 'field-help'), rows);
  const overrideGroupMatches = !query || 'monster kill times seconds per kill override exact name variant set your pace for a monster using the exact name shown in its task sources'.includes(query);
  const matchingOverrides = () => Object.entries(settings().monsterSecondsPerKill).filter(([name]) => overrideGroupMatches || name.toLowerCase().includes(query));
  function renderOverrides() {
    rows.replaceChildren();
    const values = matchingOverrides();
    if (!values.length) rows.append(el('p', overrideGroupMatches ? 'No kill times saved yet: every monster uses the default.' : 'No matching monster kill times.', 'status-detail'));
    for (const [name, seconds] of values.sort(([a], [b]) => a.localeCompare(b))) {
      const row = el('div', undefined, 'rule-row monster-override-row'), time = input('number', seconds);
      time.min = '0'; time.max = '86400'; time.step = 'any'; time.setAttribute('aria-label', `${name}: seconds per kill`);
      time.addEventListener('change', () => save('monsterSecondsPerKill', { ...settings().monsterSecondsPerKill, [name]: Number(time.value) }, [time], renderOverrides));
      const remove = button('Remove', () => {
        const next = { ...settings().monsterSecondsPerKill }; delete next[name];
        return save('monsterSecondsPerKill', next, [remove, time], renderOverrides);
      });
      const label = field(name, time); label.className = 'form-field';
      row.append(label, remove); rows.append(row);
    }
  }
  const name = input('text'), seconds = input('number', settings().defaultSecondsPerKill);
  name.setAttribute('aria-label', 'Exact monster name or variant'); name.placeholder = 'Exact monster name or variant';
  seconds.min = '0'; seconds.max = '86400'; seconds.step = 'any'; seconds.setAttribute('aria-label', 'Monster seconds per kill');
  const add = button('Save kill time', () => save('monsterSecondsPerKill', { ...settings().monsterSecondsPerKill, [name.value]: Number(seconds.value) }, [name, seconds, add], renderOverrides));
  const create = el('div', undefined, 'form-grid');
  const nameField = field('Exact monster name or variant', name), secondsField = field('Seconds per kill', seconds);
  nameField.className = secondsField.className = 'form-field';
  create.append(nameField, secondsField);
  const actions = el('div', undefined, 'form-actions'); actions.append(add);
  overrides.append(create, actions);
  if (overrideGroupMatches || matchingOverrides().length) { renderOverrides(); content.append(overrides); matches++; }
  content.hidden = matches === 0;
  return content;
}
