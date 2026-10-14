import { sourceMembershipRecord } from './data/source-membership.mjs';

/** Compact, read-only projection for optional map layers. Keep the evidence
 * catalogue server-side; the browser receives only reviewed admission fields. */
export function projectMapLayerData(definitions) {
  const names = new Set(), chunks = {};
  for (const [base, chunk] of Object.entries(definitions.chunks ?? {})) {
    if (!/^\d+$/.test(base)) continue;
    const record = {};
    if (Object.hasOwn(chunk, 'Not F2P')) record['Not F2P'] = chunk['Not F2P'];
    if (chunk.Sections) {
      record.Sections = {};
      for (const [id, section] of Object.entries(chunk.Sections)) {
        const projected = {};
        if (Object.hasOwn(section, 'Not F2P')) projected['Not F2P'] = section['Not F2P'];
        if (section.Monster) projected.Monster = { ...section.Monster };
        record.Sections[id] = projected;
        for (const name of Object.keys(section.Monster ?? {})) names.add(name);
      }
    } else if (chunk.Monster) {
      record.Monster = { ...chunk.Monster };
      for (const name of Object.keys(chunk.Monster)) names.add(name);
    }
    chunks[base] = record;
  }
  for (const mapping of [definitions.codeItems?.slayerTasks, definitions.codeItems?.reaperTasks]) {
    for (const aliases of Object.values(mapping ?? {})) for (const name of Object.keys(aliases)) names.add(name);
  }
  const monsterMembership = {};
  for (const name of names) {
    const record = sourceMembershipRecord('Monster', name);
    if (record) monsterMembership[name] = { members: record.members, status: record.status };
  }
  return { chunks, clues: definitions.clues,
    codeItems: { slayerTasks: definitions.codeItems?.slayerTasks, reaperTasks: definitions.codeItems?.reaperTasks }, monsterMembership };
}
