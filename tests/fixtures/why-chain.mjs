export function caveFixture() {
  const blocker = (kind, detail) => ({ kind, detail });
  const row = (id, label, record, blockers, category = 'Nonskill') => ({ id, label, rawLabel: label, record, blockers, category, status: 'blocked' });
  const tasks = [
    row('slay', 'Slay a small cave bug', { Monsters: ['Cave bug#Level 6'] }, [blocker('monsters', 'Monsters: Cave bug#Level 6.')], 'Slayer'),
    row('caves', 'Swamp caves', { UnlocksArea: true, Tasks: { 'Enter the caves[+]': 'Nonskill' } }, [blocker('tasks', 'Requires Enter the caves[+] (Nonskill).')]),
    row('cellar', 'Enter via the castle cellar', { Tasks: { 'Cave quest 2': 'Quest' } }, [blocker('tasks', 'Requires Cave quest 2 (Quest).')]),
    row('hole', 'Enter via the swamp hole', { Chunks: ['101'], Items: ['Rope'] }, [blocker('chunks', 'Chunks: 101.'), blocker('items', 'Items: Rope.')]),
    row('quest2', 'Cave quest 2', { Tasks: { 'Cave quest 1': 'Quest' } }, [blocker('tasks', 'Requires Cave quest 1 (Quest).')], 'Quest'),
    row('quest1', 'Cave quest 1', { Skills: { Agility: 13 } }, [blocker('training', 'Agility 13 needs an accessible primary training method or personal level/completion evidence; currently reachable level 1.')], 'Quest'),
  ];
  const definitions = { chunks: { 'Swamp caves': { Monster: { 'Cave bug#Level 6': 1 } }, '101': { Nickname: 'Swamp shore' } },
    codeItems: { tasksPlus: { 'Enter the caves[+]': ['Enter via the castle cellar', 'Enter via the swamp hole'] }, slayerTasks: { 'Cave bugs': { 'Cave bug#Level 6': true } } } };
  const result = { tasks, memberId: 'player', stateRevision: 7, access: { areas: [], diagnostics: [] }, activityInfo: { slayer: { masters: [{ name: 'Example master', tasks: [{ name: 'Cave bugs', requirements: {}, planningEligible: false, blockers: [blocker('monsters', 'No matching target monster is reachable.')] }] }] } } };
  return { definitions, result };
}
