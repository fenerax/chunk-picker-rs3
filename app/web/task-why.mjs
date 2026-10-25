import { explainTask } from '../tasks/task-provenance.mjs';

let sequence = 0;
const SOURCES = Object.freeze({ Automatic: 'default', Inherited: 'shared setting', Imported: 'imported setting', 'Personal override': 'your setting' });

/** Rule labels, values and sources come from the Rules model, loaded on first use. */
export async function createRuleDescriber(state, memberId, loadRules = () => import('./rules-model.mjs')) {
  const { rulesCatalogue, taskRuleValue } = await loadRules();
  const rows = new Map();
  for (const section of rulesCatalogue.sections) for (const row of section.rows) if (!rows.has(row.key)) {
    rows.set(row.key, { label: row.key === 'Achievement' ? 'Show Achievement Tasks' : row.label ?? row.key, section: section.name });
  }
  return id => {
    const { value, source } = taskRuleValue(state, memberId, { id });
    const on = value === undefined || ![false, 'false', 0].includes(value);
    return { ...rows.get(id), value, on, source, catalogued: rows.has(id) };
  };
}

/** Rules the Rules screen can show; other record tags stay internal. */
export function catalogued(describe) {
  return id => { const rule = describe(id); return rule?.catalogued || id === 'Rare Drop Amount' ? rule : undefined; };
}

/** openRule(id) opens the Rules screen at that rule; without it the section is named as text. */
export function renderTaskWhy(why, { document, actions = [], openRule } = {}) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const line = (term, text) => { const node = el('p'); node.append(el('span', `${term}: `, 'task-why-term'), text); return node; };
  const card = el('div', undefined, 'task-why-content');
  card.append(el('strong', 'Why this task?'));
  for (const rule of why.rules) {
    const source = SOURCES[rule.source] ? ` (${SOURCES[rule.source]})` : '';
    card.append(line('Rule', `${rule.label}, ${rule.on ? 'on' : 'off'}${source}${rule.section && !openRule ? ` · Rules → ${rule.section}` : ''}`));
  }
  if (openRule) {
    const linked = why.rules.filter(rule => rule.section).slice(0, 2);
    actions = [...linked.map(rule => {
      const link = el('button', linked.length === 1 ? `Change in Rules → ${rule.section}` : `Change ${rule.label} in Rules`, 'task-why-link');
      link.type = 'button'; link.addEventListener('click', () => openRule(rule.id));
      return link;
    }), ...actions];
  }
  if (!why.rules.length) card.append(line('Rule', 'No rule switches this task on or off.'));
  if (why.categoryNote) card.append(line(why.category, why.categoryNote));
  if (why.set?.preferred && why.set.over.length) card.append(line('Picked over', `${why.set.over.join(', ')} (same set)`));
  if (why.set && !why.set.preferred && why.set.by) card.append(line('Hidden behind', `${why.set.by} (same set)`));
  if (why.bossGate) card.append(line(why.bossGate.open === false ? 'Boss locked' : 'Boss unlocked', `${why.bossGate.boss}. ${why.bossGate.reason}`));
  for (const chain of why.neededFor) card.append(line('Needed for', chain.join(' → ')));
  const source = why.sources[0];
  if (source?.text) card.append(line('Possible from', `${source.text}${source.rate ? ` (${source.rate}${why.rareDrop ? `, counts because ${why.rareDrop.label} is on` : ''})` : ''}`));
  for (const reason of why.hidden) card.append(line('Hidden', reason));
  if (actions.length) { const row = el('p', undefined, 'task-why-actions'); row.append(...actions); card.append(row); }
  return card;
}

/**
 * A "?" button that opens an inline explanation under its row. The full
 * result is loaded only when a player opens it.
 */
export function appendTaskWhy(row, task, { document, button, icon, load, openRule, actions = () => [] }) {
  const label = String(task.label ?? '').replace(/~\|([^|]*)\|~/g, (_, value) => value.split('#')[0]).replace(/\[\+\]/g, '');
  const toggle = button('', () => open(), 'icon-button task-why');
  const panel = document.createElement('div'); panel.className = 'task-why-panel'; panel.id = `task-why-${++sequence}`; panel.hidden = true;
  toggle.title = 'Why is this task here?'; toggle.setAttribute('aria-label', `Why is ${label} here?`);
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', panel.id); toggle.append(icon('why'));
  let version = 0;
  async function open() {
    if (!panel.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); version++; return; }
    const current = ++version;
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Checking…', className: 'task-why-loading' }));
    try {
      const { task: detailed, result, describeRule, locationName } = await load(task);
      if (current !== version) return;
      panel.replaceChildren(renderTaskWhy(explainTask(detailed, { result, describeRule, locationName }), { document, actions: actions(task), openRule }));
    } catch (error) {
      if (current !== version) return;
      panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: error?.message || 'This explanation is unavailable. Try again.', className: 'task-why-loading' }));
    }
  }
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); open(); toggle.focus?.(); } });
  row.append(toggle, panel);
  return toggle;
}
