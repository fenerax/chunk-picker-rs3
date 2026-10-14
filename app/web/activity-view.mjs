import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';

const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()];
const levelOf = rows => Math.max(0, ...rows.map(row => Number(row.level) || 0));

// Select before constructing paged lists or lazy details. Counts describing the
// calculation stay intact; the list count describes the current display choice.
export function filterActivityView(view, filters, tab) {
  const taskFilters = { ...filters, questStatuses: [] };
  const select = rows => selectActivityRows(rows ?? [], taskFilters);
  const ordered = rows => selectActivityRows(rows, { statuses: [], questStatuses: [], sort: filters.sort });
  const filtering = filters.statuses?.length > 0;
  const groups = rows => ordered(rows.flatMap(group => {
    if (!selectActivityRows([group], { ...filters, statuses: [], sort: 'default' }).length) return [];
    const tasks = select(group.tasks), wholeCompletion = select(group.wholeCompletion);
    return filtering && !tasks.length && !wholeCompletion.length ? [] : [{ ...group, tasks, wholeCompletion, totalCount: group.tasks.length,
      level: group.level ?? levelOf([...tasks, ...wholeCompletion]) }];
  }));
  if (tab === 'Quests') return { ...view, quests: groups(view.quests) };
  if (tab === 'Achievements') return { ...view, achievements: groups(view.achievements) };
  if (tab === 'Activities') return { ...view, activities: select(view.activities) };
  if (tab === 'Skills') {
    const skills = view.skills.flatMap(skill => {
      const tasks = unique([...(skill.availableTasks ?? []), ...(skill.blockedTasks ?? [])]);
      const filteredTasks = select(tasks);
      return filtering && !filteredTasks.length ? [] : [{ ...skill, filteredTasks, level: levelOf(filteredTasks) }];
    });
    return { ...view, skills: ordered(skills) };
  }
  if (tab === 'Slayer') {
    const masters = view.slayer.masters.flatMap(master => {
      const tasks = select((master.tasks ?? []).map(task => ({ ...task,
        status: task.planningEligible ? 'available' : 'blocked',
        level: Math.max(Number(task.requirements?.Level) || 0, ...Object.values(task.requirements?.Skills ?? {}).map(Number), 0) })));
      const method = select(master.method ? [master.method] : [])[0];
      return filtering && !tasks.length && !method ? [] : [{ ...master, tasks, method, level: levelOf(tasks) }];
    });
    return { ...view, slayer: { ...view.slayer, masters: ordered(masters) } };
  }
  if (tab === 'Clues') {
    const tiers = view.clues.tiers.flatMap(tier => {
      const tasks = select(tier.tasks);
      return filtering && !tasks.length ? [] : [{ ...tier, tasks, level: levelOf(tasks) }];
    });
    return { ...view, clues: { ...view.clues, tiers: ordered(tiers) } };
  }
  return view;
}

export function filteredActivityTab(context, { tab, view, render }) {
  const host = context.el('div', undefined, 'form-stack'), body = context.el('div');
  const paint = () => {
    const searches = new Map(Array.from(body.querySelectorAll?.('input[type=search]') ?? []).map(input => [input.getAttribute('aria-label'), input.value]));
    body.replaceChildren(render(filterActivityView(view, controls.preferences(), tab)));
    for (const input of body.querySelectorAll?.('input[type=search]') ?? []) {
      const value = searches.get(input.getAttribute('aria-label'));
      if (value) { input.value = value; input.dispatchEvent(new Event('input')); }
    }
  };
  const controls = createActivityFilterControls(context, { tab, quests: tab === 'Quests', onChange: paint });
  host.append(controls.element, body);
  paint();
  return host;
}
