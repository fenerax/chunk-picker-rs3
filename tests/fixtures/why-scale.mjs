import { caveFixture } from './why-chain.mjs';

// Hand-authored shape at the documented duo-legacy Lumbridge-only scale; no
// live state, reference-data excerpt or account identity is used.
export function whyScaleFixture(count = 20_436) {
  const { result, definitions } = caveFixture();
  definitions.challenges = {};
  const size = count - result.tasks.length;
  const description = 'A synthetic objective with a personal requirement, an item source and access information. '.repeat(9);
  for (let i = 0; i < size; i++) {
    const label = `Synthetic regional objective ${i}`, parent = `Synthetic regional objective ${Math.floor(i / 16) * 16}`;
    const record = { Description: description, Chunks: ['12850'], ...(i % 16 ? { Tasks: { [parent]: 'Extra' } } : {}) };
    definitions.challenges.Extra ??= {}; definitions.challenges.Extra[label] = record;
    result.tasks.push({ id: `synthetic:${i}`, label, rawLabel: label, category: 'Extra', status: i % 5 ? 'available' : 'blocked', record,
      sources: [{ kind: 'task', task: label, location: ['12850'], detail: 'A synthetic source with ordinary player-facing labels.' }],
      blockers: i % 5 ? [] : [{ kind: 'tasks', detail: `Requires ${parent} (Extra).` }] });
  }
  result.memberId = 'player'; result.stateRevision = 7;
  const state = { revision: 7, rules: { 'content.f2p': false }, members: [{ id: 'player', unlocked: ['12850'], completedTasks: [] }] };
  return { result, definitions, state };
}

export function scaleWorkerDefinitions(count = 20_560) {
  const Extra = {}, description = 'A synthetic regional objective with personal requirements and recorded access. '.repeat(11);
  for (let i = 0; i < count; i++) Extra[`Regional objective ${i}`] = { Description: description, Chunks: [i % 5 ? '12850' : '12851'],
    ...(i % 16 ? { Tasks: { [`Regional objective ${Math.floor(i / 16) * 16}`]: 'Extra' } } : {}) };
  return { challenges: { Extra }, chunks: { '12850': {}, '12851': {} }, drops: {}, codeItems: {}, equipment: {},
    walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'] };
}
