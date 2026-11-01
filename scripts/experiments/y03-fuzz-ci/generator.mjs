// Authored public definitions and generated saves; no released packs or saves.
export function randomFor(seed) {
  let x = seed >>> 0;
  return () => { x += 0x6D2B79F5; let t = Math.imul(x ^ x >>> 15, 1 | x); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
export function definitions() {
  const ids = Array.from({ length: 48 }, (_, i) => String((48 + Math.floor(i / 8)) * 256 + 48 + i % 8));
  return { chunks: Object.fromEntries(ids.map((id, i) => [id, {
    Object: { [i % 2 ? 'Oak' : 'Tree']: true }, Spawn: { [i % 3 ? 'Token' : 'Seed']: 1 },
    ...(i % 4 === 0 ? { Shop: { Supplies: 1 } } : {}),
  }])), walkableChunks: ids, walkableChunksF2P: ids, sections: {},
  shopItems: { Supplies: { Token: true } }, codeItems: {}, challenges: {
    Woodcutting: { Logs: { Level: 1, Objects: ['Tree'], Primary: true, Output: 'Logs' }, Oak: { Level: 15, Objects: ['Oak'], Primary: true, Output: 'Oak logs' } },
    Firemaking: { Burn: { Level: 1, Items: ['Logs'], Primary: true }, BurnOak: { Level: 15, Items: ['Oak logs'], Primary: true } },
    Crafting: { CycleA: { Items: ['CycleB'], Output: 'CycleA' }, CycleB: { Items: ['CycleA'], Output: 'CycleB' },
      Root: { Chunks: [ids.at(-1)], Output: 'CycleA' }, Token: { Items: ['Token'], Primary: true, Output: 'Badge' } },
    Quest: { First: { Chunks: [ids[0]], Output: 'Permit' }, Second: { Tasks: { First: 'Quest' }, Skills: { Woodcutting: 30 } } },
    Extra: { Gate: { Items: ['Badge', 'Permit'] }, Missing: { Items: ['Absent'] },
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['Location ' + i, { Chunks: [ids[i * 6]], Skills: { Mining: 1 + i * 7 } }])) },
  } };
}
export function makeState(index, seed, defs, createGroupState, taskId) {
  const random = randomFor(seed + index * 7919), ids = Object.keys(defs.chunks);
  const tasks = Object.entries(defs.challenges).flatMap(([category, entries]) => Object.entries(entries).map(([label, record]) => ({ id: taskId(category, label, record), label, category })));
  const members = Array.from({ length: index % 2 + 1 }, (_, slot) => {
    const order = shuffle(ids, random), count = [1, 2, 12, 47, 48][index % 5];
    return { id: 'synthetic' + slot, name: 'Player ' + slot, unlocked: order.slice(0, count), selected: order.slice(count, count + 1),
      pendingRoll: [], blacklisted: [], teleports: [],
      passiveLevels: Object.fromEntries(['Woodcutting', 'Firemaking', 'Mining'].map(skill => [skill, 1 + Math.floor(random() * 99)])),
      taskRules: { 'Collection Log': random() < .5, Timegated: random() < .5 } };
  });
  const state = createGroupState(members);
  state.tasks = tasks; state.revision = index;
  state.rules = { 'content.f2p': random() < .5, 'access.shared': random() < .5 };
  for (const member of state.members) member.completedTasks = shuffle(tasks, random).slice(0, Math.floor(random() * tasks.length)).map(t => t.id);
  return state;
}
export function requestsFor(state, defs, index) {
  const requests = [{ type: 'prepare-rules' }];
  for (const member of state.members) {
    const future = Object.keys(defs.chunks).find(id => !member.unlocked.includes(id)) ?? member.unlocked[0];
    requests.push(...['full', 'play-v1'].map(resultView => ({ type: 'evaluate', memberId: member.id, resultView,
      resultTransport: 'json-shared-v1', duoProjection: true, duoSidebarProjection: true })),
    { type: 'roll-pool', memberId: member.id },
    { type: 'predict', memberId: member.id, chunkId: future, predictionProgress: true },
    { type: 'death-estimates', memberId: member.id, chunkIds: [future] },
    { type: 'chunk-planning', memberId: member.id, chunkId: member.unlocked[0] },
    { type: 'sandbox', memberId: member.id, chunkId: { changes: { unlockChunks: member.unlocked.includes(future) ? [] : [future],
      lockChunks: member.unlocked.length > 1 ? member.unlocked.slice(-1) : [], doneTasks: state.tasks.slice(0, index % 3).map(t => t.id) } } },
    { type: 'area-check', memberId: member.id, chunkId: { chunkIds: [future], asMembers: index % 2 === 0 } },
    { type: 'how-task', memberId: member.id, chunkId: state.tasks[index % state.tasks.length].id });
  }
  return requests;
}
