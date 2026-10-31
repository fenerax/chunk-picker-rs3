import { skillGoals, helperTrialCaps, helperSkillCap } from './helper-model.mjs';
import { levelChart, dataTable } from './helper-charts.mjs';
export function renderGoals(host, { document, member, getResult, getState = () => undefined, onPlan, f2p = true }) {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  host.append(el('h2', 'What our chunks mean'), el('p', 'Your saved levels beside the highest levels your active tasks ask for.', 'helper-intro'));
  const result = getResult();
  if (!result) { host.append(el('p', 'Waiting for this player’s task list. The Helper uses the same results as the picker.', 'helper-note')); return () => {}; }
  const goals = skillGoals(member, result, getState(), { f2p }), active = goals.filter(row => row.targetLevel !== null);
  if (!active.length) { host.append(el('p', 'No active skill level goals in this task list. Completed and backlogged tasks are left out.')); return () => {}; }
  host.append(el('p', `Gold bars show your current level. The dot and second number show the task target. “?” means no saved level.${f2p ? ' Members skill trials are marked in the table.' : ''}`, 'helper-note'), levelChart(document, goals),
    dataTable(document, 'Skill levels and task targets', ['Skill', 'Saved level', 'Highest task level', 'XP needed', 'Active goals'], active.map(row => [f2p && helperTrialCaps[row.skill] ? `${row.skill} (F2P trial to ${helperTrialCaps[row.skill]})` : row.skill, row.currentLevel ?? 'Not synced', row.targetLevel, row.xpRemaining?.toLocaleString() ?? 'Unknown', row.goalCount])));
  const payoffs = active.flatMap(row => row.payoff.filter(payoff => payoff.xp !== null && payoff.level <= helperSkillCap(row.skill, f2p) && payoff.level > (row.currentLevel ?? 1)).map(payoff => ({ ...payoff, skill: row.skill, currentLevel: row.currentLevel,
    levelGoalsMet: row.goals.filter(goal => goal.targetLevel > (row.currentLevel ?? 1) && goal.targetLevel <= payoff.level).length }))).sort((a, b) => b.levelGoalsMet - a.levelGoalsMet || a.xp - b.xp).slice(0, 10);
  host.append(el('h3', 'Grinds that cover more level goals'), el('p', 'These counts cover level requirements only, above your saved level. With no saved level, you may already meet some of them. Quests, supplies and other steps still need doing. The Helper never ticks off tasks.', 'helper-note'));
  const list = el('ol', undefined, 'helper-payoffs');
  for (const payoff of payoffs) { const row = el('li'), button = el('button', `Plan ${payoff.skill} to ${payoff.level}`); button.type = 'button'; button.addEventListener('click', () => onPlan(payoff.skill, payoff.level)); row.append(el('span', `${payoff.skill} to ${payoff.level} ${payoff.currentLevel === null ? 'could meet up to' : 'meets'} ${payoff.levelGoalsMet} more level ${payoff.levelGoalsMet === 1 ? 'goal' : 'goals'}.`), button); list.append(row); } host.append(list);
  const details = el('details'); details.append(el('summary', 'See the tasks behind these goals'));
  for (const row of active) { const group = el('section'); group.append(el('h4', row.skill)); const tasks = el('ul'); for (const goal of row.goals) tasks.append(el('li', `${goal.label} — level ${goal.targetLevel}`)); group.append(tasks); details.append(group); } host.append(details);
  return () => {};
}
