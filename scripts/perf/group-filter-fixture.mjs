// Synthetic browser inputs derived only from scale-dataset.mjs definitions.
// Results model already-calculated, owner-specific maps; this fixture never
// starts a calculator or reads an installed save.
export function groupFilterFixture(definitions, { historyLength = 20000 } = {}) {
  const tasks = Object.entries(definitions.challenges).flatMap(([category, rows]) => Object.entries(rows).map(([label, record]) => ({
    label, category, level: record.Level ?? 0, record,
  }))).map((task, i) => ({ ...task, id: `rs3:task:synthetic:${i}`, aliases: [`historical:${i}`],
    ...(i % 13 === 0 ? { completionIds: [`rs3:task:synthetic:${i}`, `rs3:task:synthetic:${Math.max(0, i - 1)}`] } : {}),
    ...(i % 101 === 0 ? { hidden: true } : {}), ...(i % 103 === 0 ? { neverShow: true } : {}),
  }));
  const members = ['one', 'two'].map((id, m) => ({ id, name: `Player ${m + 1}`, unlocked: [m ? 'east' : 'west', 'shared'],
    completedTasks: tasks.filter((_, i) => (i + m) % 5 < 2).map((task, i) => i % 2 ? task.id : task.aliases[0]),
    taskStatus: Object.fromEntries(tasks.flatMap((task, i) => (i + m) % 3 === 0 ? [[i % 2 ? task.id : task.aliases[0], { challengeCompleted: true, favorite: i % 59 === 0 }]]
      : i % 71 === 0 ? [[task.id, { backlogged: true }]] : [])), taskAlternatives: {},
  }));
  const entries = Object.fromEntries(tasks.map(task => [task.id, { category: task.category }]));
  const aliases = Object.fromEntries(tasks.map(task => [task.aliases[0], task.id]));
  // Two competing catalogue aliases must keep this historical reference ambiguous.
  if (tasks.length > 2) { tasks[0].aliases.push('ambiguous'); tasks[1].aliases.push('ambiguous'); members[0].completedTasks.push('ambiguous'); }
  const state = { revision: 7, tasks, members, rules: {}, identityRegistry: { entries, aliases },
    history: Array.from({ length: historyLength }, (_, i) => ({ type: 'set-task-status', memberId: members[i % 2].id, at: i, taskId: tasks[i % tasks.length].id })),
  };
  const results = members.map((member, m) => {
    // A small obsolete/imported tail exists only in saved state. Locked tasks
    // retain an owner-specific blocker; completed rows are suppressed normally.
    const rows = tasks.filter((_, i) => i % 29 !== 0).map((task, i) => ({ ...task,
      status: (i + m * 3) % 11 < 2 ? 'blocked' : 'available',
      blockers: (i + m * 3) % 11 < 2 ? [{ detail: `Locked on ${member.name}'s map` }] : [],
    }));
    const done = new Set(members.flatMap(owner => [...owner.completedTasks, ...Object.keys(owner.taskStatus).filter(id => owner.taskStatus[id].challengeCompleted)]));
    const completedTasks = rows.filter(task => done.has(task.id) || task.aliases.some(id => done.has(id)));
    const completed = new Set(completedTasks.map(task => task.id));
    const presented = rows.filter(task => !completed.has(task.id) && task.status === 'available' && !task.hidden && !task.neverShow);
    return { memberId: member.id, stateRevision: state.revision, projection: 'duo-inspection-v1', tasks: rows,
      neverShowIds: rows.filter((_, i) => i % 197 === 0).map(task => task.id),
      presentation: { tasks: presented.map(task => ({ id: task.id })), completedTasks: completedTasks.map(task => ({ id: task.id })) },
      collectionPlanning: { completionGroups: {} },
    };
  });
  return { state, results };
}
