// Optional picker settings live in free-form provenance so frozen schema-1
// readers can preserve them without understanding a new member preference.
export function pluginTestingSettings(state) {
  const seen = new Set(), nodes = [];
  let settings = {};
  for (let node = state.provenance; node && typeof node === 'object' && !seen.has(node); node = node.restore?.incomingProvenance) {
    seen.add(node); nodes.push(node);
    if (Object.hasOwn(node, 'pluginTestingMode')) {
      const value = node.pluginTestingMode;
      settings = value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === 'boolean')) : {};
      nodes.pop(); break;
    }
  }
  for (const node of nodes.reverse()) {
    const mappings = [], visited = new Set();
    for (let transfer = node.transferRoster; transfer && typeof transfer === 'object' && !visited.has(transfer); transfer = transfer.previous) {
      visited.add(transfer); mappings.push(transfer.mapping);
    }
    for (const mapping of mappings.reverse()) settings = Object.fromEntries(Object.entries(settings)
      .filter(([id]) => mapping && Object.hasOwn(mapping, id) && typeof mapping[id] === 'string').map(([id, enabled]) => [mapping[id], enabled]));
  }
  return Object.fromEntries(state.members.filter(member => Object.hasOwn(settings, member.id)).map(member => [member.id, settings[member.id]]));
}

export const pluginTestingMode = (state, player) => pluginTestingSettings(state)[player] === true;

export function withPluginTestingMode(state, player, enabled) {
  if (pluginTestingMode(state, player) === enabled) return state;
  const provenance = state.provenance;
  if (provenance !== undefined && (!provenance || typeof provenance !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(provenance)))) {
    throw Object.assign(new Error('Plugin testing mode cannot be changed because this save\'s provenance is not a plain object.'), { status: 409 });
  }
  return { ...state, provenance: { ...(provenance ?? {}), pluginTestingMode: { ...pluginTestingSettings(state), [player]: enabled } } };
}
