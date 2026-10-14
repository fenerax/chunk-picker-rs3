import { itemIcon } from './icons.mjs';
import { taskItemIcon } from './task-artwork.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const unique = values => [...new Set(values)];
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
const nameOf = value => typeof value === 'string' ? value : value?.name ?? value?.item ?? value?.equipmentName;
const statFields = [
  ['ability_damage', 'Ability damage'], ['auto_damage', 'Auto-attack damage'], ['accuracy', 'Accuracy'],
  ['damage_tier', 'Damage tier'], ['accuracy_tier', 'Accuracy tier'], ['armour', 'Armour'], ['lp', 'Life points'], ['prayer', 'Prayer bonus'],
  ...['melee', 'ranged', 'magic', 'necromancy'].flatMap(style => [
    [`${style}_damage`, `${style[0].toUpperCase()}${style.slice(1)} damage bonus`],
    [`${style}_accuracy`, `${style[0].toUpperCase()}${style.slice(1)} accuracy bonus`],
  ]),
  ['weight', 'Weight', 'kg'], ['attack_range', 'Attack range'], ['attack_speed_ticks', 'Attack speed', 'ticks'],
];

/** Declared numeric stats only: missing fields stay missing, explicit zero stays zero. */
export function equipmentStats(definition = {}) {
  if (!definition || typeof definition !== 'object') return [];
  return statFields.filter(([key]) => Object.hasOwn(definition, key) && numeric(definition[key]))
    .map(([key, label, unit]) => ({ key, label, value: Number(definition[key]), ...(unit ? { unit } : {}) }));
}

function taskDetails(task, result) {
  const full = task?.id && list(result.tasks).find(row => row.id === task.id);
  return { ...task, ...full };
}

function recommendations(result) {
  return [...list(result.equipmentPlanning?.recommendations), ...list(result.currentBiS?.obtainable?.recommendations)];
}

/** Use explicit item metadata, never remove words from a task's display label. */
export function equipmentTaskItems(task, fullResult = {}, equipmentDefinitions = {}) {
  const row = taskDetails(task, fullResult);
  const goal = row.goal;
  const equipmentMetadata = row.category === 'BiS' || row.kind === 'equipment' || row.objectiveKind === 'equipment'
    || list(row.record?.Category).some(tag => typeof tag === 'string' && /^BIS(?: |$)/.test(tag));
  const candidates = unique([
    row.equipmentName, goal?.equipmentName, goal?.item, ...list(goal?.items),
    ...(equipmentMetadata ? [row.item, ...list(row.record?.ItemsDetails), ...list(row.record?.Items)] : []),
  ].map(nameOf).filter(name => typeof name === 'string' && name));
  const evidence = [...list(fullResult.equipment), ...recommendations(fullResult).map(rec => rec.equipment).filter(Boolean)];
  return candidates.flatMap(name => {
    const equipment = evidence.find(value => value.name === name) ?? null;
    const definition = Object.hasOwn(equipmentDefinitions, name) ? equipmentDefinitions[name] : equipment?.data ?? null;
    // Explicit equipment identities remain useful while definitions load lazily.
    if (!definition && !equipment && name !== row.equipmentName && name !== goal?.equipmentName) return [];
    return [{ name, definition, equipment }];
  });
}

const sameScore = (left, right) => {
  const a = list(left), b = list(right);
  return a.length > 0 && a.length === b.length && a.every((value, index) => numeric(value) && numeric(b[index]) && Number(value) === Number(b[index]));
};
const sameCategory = (left, right) => left.style === right.style && left.slot === right.slot;

/** Read-only presentation over the engine's selected recommendations and comparisons. */
export function equipmentTaskModel(task, fullResult = {}, equipmentDefinitions = {}) {
  const row = taskDetails(task, fullResult);
  const items = equipmentTaskItems(row, fullResult, equipmentDefinitions).map(item => {
    const data = item.definition ?? {};
    return { ...item, stats: equipmentStats(data), style: data.class ?? item.equipment?.class ?? null,
      slot: data.slot ?? item.equipment?.slot ?? null, tier: numeric(data.tier) ? Number(data.tier) : null };
  });
  const itemNames = new Set(items.map(item => item.name));
  const allRecommendations = recommendations(fullResult);
  const selected = allRecommendations.filter(rec => itemNames.has(rec.equipment?.name));
  const evidence = new Map();
  for (const gear of [...list(fullResult.equipment), ...allRecommendations.map(rec => rec.equipment).filter(Boolean)]) {
    if (gear.data && !evidence.has(gear.name)) evidence.set(gear.name, gear.data);
  }
  const definitionFor = name => Object.hasOwn(equipmentDefinitions, name) ? equipmentDefinitions[name] : evidence.get(name);
  const explanations = [], comparisons = [], limitations = [];
  const bestFor = new Map(), ranking = [];
  const loadouts = [...list(fullResult.equipmentPlanning?.loadouts), ...list(fullResult.currentBiS?.obtainable?.loadouts)];
  const paths = list(fullResult.equipmentPlanning?.specialist?.upgradePaths ?? fullResult.currentBiS?.obtainable?.specialist?.upgradePaths);
  function addComparison(value) {
    if (!value.items?.length || value.items.every(name => itemNames.has(name))) return;
    const targets = list(value.targetItems).map(name => items.find(item => item.name === name) ?? {
      name, slot: definitionFor(name)?.slot, stats: equipmentStats(definitionFor(name)),
    });
    const stats = value.items.map(name => {
      const definition = definitionFor(name);
      const declared = equipmentStats(definition);
      const target = targets.find(item => item.slot && item.slot === definition?.slot);
      const deltas = target ? target.stats.flatMap(stat => {
        const other = declared.find(value => value.key === stat.key);
        return other ? [{ ...stat, value: stat.value - other.value }] : [];
      }) : [];
      const sameStats = !!target?.stats.length && target.stats.length === declared.length
        && target.stats.every(stat => declared.some(other => other.key === stat.key && other.value === stat.value));
      return { name, targetName: target?.name, stats: declared, deltas, sameStats };
    });
    comparisons.push({ ...value, stats });
  }
  for (const rec of selected) {
    const loadout = loadouts.filter(value => value.style === rec.style).flatMap(value => list(value.selected ?? value.best))
      .find(value => list(value.items).includes(rec.equipment.name) && (!rec.loadoutMode || value.mode === rec.loadoutMode));
    const key = JSON.stringify([rec.equipment.name, rec.slot]);
    if (!bestFor.has(key)) bestFor.set(key, { name: rec.equipment.name, slot: rec.slot, styles: new Set() });
    bestFor.get(key).styles.add(rec.style);
    if (rec.comparison) ranking.push(rec.comparison);
    if (loadout) {
      explanations.push(`Part of the best ${loadout.mode} ${rec.style} loadout: ${list(loadout.items).join(' + ')}.`);
      const components = Object.entries(loadout.components ?? {}).filter(([, value]) => numeric(value))
        .map(([key, value]) => `${key}: ${statText({ value })}`);
      if (components.length) ranking.push(`Loadout ranking components — ${components.join('; ')}.`);
      const tradeoff = loadouts.find(value => value.style === rec.style && list(value.selected ?? value.best).includes(loadout))?.tradeoffs?.[0];
      if (tradeoff) addComparison({ kind: 'loadout', label: 'Alternative obtainable loadout', style: rec.style, slot: rec.slot,
        items: list(tradeoff.items), targetItems: list(loadout.items), score: tradeoff.score, targetScore: loadout.score });
    }
    for (const name of list(rec.alternatives)) addComparison({ kind: 'tie', label: 'Equal-ranked alternative', style: rec.style,
      slot: rec.slot, items: [name], targetItems: [rec.equipment.name], score: rec.score, targetScore: rec.score });
    const path = paths.find(path => (sameCategory(path, rec) || loadout && path.kind === 'loadout' && path.style === rec.style && path.mode === loadout.mode)
      && list(path.steps).some(step => loadout ? sameScore(step.score, loadout.score) : list(step.items).includes(rec.equipment.name)));
    if (path) {
      if (path.comparison) ranking.push(path.comparison);
      const index = path.steps.findIndex(step => loadout ? sameScore(step.score, loadout.score) : list(step.items).includes(rec.equipment.name));
      if (index > 0) addComparison({ kind: 'next', label: 'Next lower-ranked obtainable choice', style: rec.style, slot: rec.slot,
        items: list(path.steps[index - 1].items), targetItems: loadout ? list(loadout.items) : [rec.equipment.name], score: path.steps[index - 1].score, targetScore: path.steps[index].score,
        comparison: path.comparison });
    }
    const recorded = list(fullResult.currentBiS?.owned?.recordedBest?.recommendations).find(other => sameCategory(other, rec));
    if (recorded && recorded.equipment?.name !== rec.equipment.name) addComparison({ kind: 'recorded', label: 'Personally recorded obtained choice',
      style: rec.style, slot: rec.slot, items: [recorded.equipment.name], targetItems: [rec.equipment.name], score: recorded.score, targetScore: rec.score });
  }
  const joinStyles = values => values.length > 1 ? `${values.slice(0, -1).join(', ')} and ${values.at(-1)}` : values[0];
  explanations.unshift(...[...bestFor.values()].map(({ name, slot, styles }) => `${items.length > 1 ? `${name}: best` : 'Best'} ${slot} item for ${joinStyles([...styles])}.`));
  if (items.length) {
    if (!selected.length) limitations.push('This item is not currently recommended as BiS.');
    if (!comparisons.length) limitations.push('No other item is known for comparison yet.');
    if (items.some(item => !item.definition)) limitations.push('Item stats are unavailable; unknown stats stay unknown.');
    limitations.push('Equipment comparisons do not predict damage per second against a monster.');
    if (comparisons.some(value => value.kind === 'recorded')) limitations.push('Marking an item obtained does not confirm you still own or wear it.');
  }
  return { items, explanations: unique(explanations), ranking: unique(ranking), comparisons: [...new Map(comparisons.map(value => [JSON.stringify(value), value])).values()], limitations };
}

const statText = stat => `${Number(stat.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}${stat.unit ? ` ${stat.unit}` : ''}`;

/** Shared detail/hover renderer. Icons are resolved through the existing icon helper. */
export function renderTaskEquipment(task, fullResult = {}, equipmentDefinitions = {}, options = {}) {
  const model = equipmentTaskModel(task, fullResult, equipmentDefinitions);
  if (!model.items.length) return null;
  const document = options.document ?? globalThis.document;
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const node = el('section', undefined, `task-equipment${options.compact ? ' task-equipment-compact' : ''}`);
  node.setAttribute('aria-label', 'Equipment details');
  function statsList(stats) {
    const dl = el('dl', undefined, 'task-equipment-stats');
    for (const stat of stats) {
      const pair = el('div'); pair.append(el('dt', stat.label), el('dd', statText(stat))); dl.append(pair);
    }
    return dl;
  }
  for (const item of model.items) {
    const card = el('div', undefined, 'task-equipment-item'), header = el('div', undefined, 'task-equipment-header');
    const url = options.compact ? null : taskItemIcon(item.name, options.iconLookup ?? itemIcon);
    if (url) {
      const icon = el('img', undefined, 'task-equipment-icon');
      icon.src = url; icon.alt = ''; icon.width = 32; icon.height = 32; header.append(icon);
    }
    header.append(el(options.compact ? 'strong' : 'h3', item.name));
    const styleName = item.style === 'all' ? 'Any style' : item.style ? `${item.style[0].toUpperCase()}${item.style.slice(1)}` : null;
    card.append(header, el('p', [styleName, item.slot ? `${item.slot[0].toUpperCase()}${item.slot.slice(1)} slot` : null, item.tier !== null ? `Tier ${item.tier}` : null].filter(Boolean).join(' · '), 'task-equipment-meta'));
    const levels = Object.entries(item.definition?.requirements ?? {}).filter(([, value]) => numeric(value)).map(([skill, level]) => `${skill} ${Number(level)}`);
    if (levels.length) card.append(el('p', `Equip: ${levels.join(' · ')}`, 'task-equipment-meta'));
    const primary = ['ability_damage', 'auto_damage', 'accuracy', 'armour', 'lp', 'prayer', 'damage_tier', 'accuracy_tier'];
    const stats = options.compact ? [
      ...primary.flatMap(key => item.stats.filter(stat => stat.key === key)),
      ...item.stats.filter(stat => !primary.includes(stat.key) && stat.value !== 0),
    ].filter(stat => stat.value !== 0).slice(0, 8) : item.stats.filter(stat => stat.value !== 0);
    card.append(stats.length ? statsList(stats) : el('p', item.stats.length ? 'No bonuses.' : 'No stats recorded for this item.', 'task-equipment-meta'));
    node.append(card);
  }
  if (options.compact) return node;
  if (model.explanations.length) {
    const evidence = el('div', undefined, 'task-equipment-evidence'); evidence.append(el('h3', 'Why this is BiS'));
    for (const value of model.explanations) evidence.append(el('p', value));
    if (options.advanced === true && model.ranking?.length) { const how = el('details', undefined, 'task-equipment-more'); how.append(el('summary', 'How it’s ranked')); for (const value of model.ranking) how.append(el('p', value)); evidence.append(how); }
    node.append(evidence);
  }
  const renderComparison = comparison => {
    const card = el('div', undefined, 'task-equipment-comparison');
    const heading = { next: 'Next best', tie: 'Equally good', recorded: 'What you recorded', loadout: 'Other loadout' }[comparison.kind] ?? comparison.label;
    card.append(el('h4', `${heading} for ${comparison.style}: ${comparison.items.join(' + ')}`));
    for (const item of comparison.stats) {
      const changes = item.deltas.filter(stat => stat.value !== 0);
      const target = model.items.length === 1 && model.items[0].name === item.targetName ? 'This item' : item.targetName;
      if (changes.length) card.append(el('p', `${target} vs ${item.name}: ${changes.map(stat => `${stat.value > 0 ? '+' : '−'}${statText({ ...stat, value: Math.abs(stat.value) })} ${stat.label.toLowerCase()}`).join(', ')}`, 'task-equipment-delta'));
      else if (item.sameStats) card.append(el('p', `${target === 'This item' ? 'Same stats' : `${target} has the same stats`} as ${item.name}.`, 'task-equipment-meta'));
      else card.append(el('p', `Full stat comparison unavailable for ${item.name}.`, 'task-equipment-meta'));
    }
    return card;
  };
  const preferred = model.comparisons.find(value => value.kind === 'next') ?? model.comparisons.find(value => value.kind === 'recorded') ?? model.comparisons[0];
  if (preferred) node.append(renderComparison(preferred));
  const remaining = model.comparisons.filter(value => value !== preferred);
  if (remaining.length) {
    const more = el('details', undefined, 'task-equipment-more'); more.append(el('summary', `Other equipment comparisons (${remaining.length})`));
    let loaded = false;
    more.addEventListener('toggle', () => {
      if (!more.open || loaded) return; loaded = true;
      for (const comparison of remaining) {
        const entry = el('details'); entry.append(el('summary', `${comparison.label} · ${comparison.style}: ${comparison.items.join(' + ')}`));
        let shown = false;
        entry.addEventListener('toggle', () => { if (entry.open && !shown) { shown = true; entry.append(renderComparison(comparison)); } });
        more.append(entry);
      }
    });
    node.append(more);
  }
  if (model.limitations.length) { const notes = el('details', undefined, 'task-equipment-more'); notes.append(el('summary', 'Notes')); for (const value of model.limitations) notes.append(el('p', value, 'task-equipment-meta')); node.append(notes); }
  return node;
}
