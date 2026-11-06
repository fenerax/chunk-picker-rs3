// Replay policy belongs to the same published state as automatic completion.
// This provenance extension is intentionally outside gameplay Undo deltas.
const limits = { achievements: 20000, items: 2000 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const indexes = new WeakMap();

function validate(record) {
  if (!object(record) || Object.keys(record).some(key => !Object.hasOwn(limits, key))) throw new TypeError('Invalid plugin suppression record.');
  for (const [kind, limit] of Object.entries(limits)) {
    const ids = record[kind];
    if (!Array.isArray(ids) || ids.length > limit || ids.some(id => kind === 'achievements'
      ? !Number.isSafeInteger(id) || id < 0
      : typeof id !== 'string' || !id.length || id.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(id))) throw new TypeError('Invalid plugin suppression IDs.');
  }
  return record;
}

export function hasPluginHandled(state, player, kind, id) {
  const players = state.provenance?.pluginAutoHandled;
  const record = players && Object.hasOwn(players, player) ? players[player] : null;
  if (!record) return false;
  let index = indexes.get(record);
  if (!index) {
    validate(record);
    index = { achievements: new Set(record.achievements), items: new Set(record.items) };
    indexes.set(record, index);
  }
  return index[kind].has(id);
}

// Restore changes gameplay, never revokes a published replay decision. Sources
// must already use destination member IDs (and member imports must be scoped
// before mapping). Reject an oversized union rather than forget older decisions.
export function reconcilePluginHandled(state, ...sources) {
  const records = new Map();
  const members = new Set(state.members.map(member => member.id));
  let present = false;
  for (const source of [state, ...sources]) {
    const players = source.provenance?.pluginAutoHandled;
    if (players === undefined) continue;
    present = true;
    if (!object(players)) throw new TypeError('Invalid plugin suppression players.');
    for (const [id, input] of Object.entries(players)) {
      if (!members.has(id)) continue;
      validate(input);
      const prior = records.get(id) ?? { achievements: [], items: [] };
      records.set(id, validate({
        achievements: [...new Set([...prior.achievements, ...input.achievements])].sort((a, b) => a - b),
        items: [...new Set([...prior.items, ...input.items])].sort(),
      }));
    }
  }
  return present ? { ...state, provenance: { ...state.provenance, pluginAutoHandled: Object.fromEntries(records) } } : state;
}

export function withPluginHandled(state, command, input) {
  if (input === undefined) return state;
  if (command.type !== 'apply-game-progress') throw new TypeError('Plugin suppression requires a progress command.');
  validate(input);
  // Achievement aliases may share one task; retain every matched ID, including
  // those deduplicated out of the completion rows. Item IDs are task identities.
  if (input.items.some(id => !command.items?.some(row => row.taskId === id))
    || (command.achievements ?? []).some(row => !input.achievements.includes(row.achievementId))) throw new TypeError('Plugin suppression does not match the progress command.');
  const players = state.provenance?.pluginAutoHandled ?? {};
  if (!object(players)) throw new TypeError('Invalid plugin suppression players.');
  const prior = Object.hasOwn(players, command.memberId) ? validate(players[command.memberId]) : { achievements: [], items: [] };
  const record = validate({
    achievements: [...new Set([...prior.achievements, ...input.achievements])].sort((a, b) => a - b),
    items: [...new Set([...prior.items, ...input.items])].sort(),
  });
  return { ...state, provenance: { ...state.provenance, pluginAutoHandled: {
    ...Object.fromEntries(Object.entries(players).filter(([id]) => state.members.some(member => member.id === id))),
    [command.memberId]: record,
  } } };
}
