import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';

export const normalizeItemMembershipName = name => decodeLegacyText(String(name)).normalize('NFC');
const templateFields = ['noteTemplate', 'noteTemplate_old', 'loanTemplate', 'loanTemplate_old',
  'bindTemplate', 'bindTemplate_old', 'combine_template', 'combine_template_old'];

/** Raw opcode flag only; template definitions inherit ordinary item properties. */
export function buildItemMembershipIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const raw = row.definition ?? row;
    if (!raw.name || row.template === true || templateFields.some(field => raw[field] !== undefined)) continue;
    if (raw.members !== undefined && typeof raw.members !== 'boolean') throw new TypeError(`Invalid members flag: ${row.id}`);
    const name = normalizeItemMembershipName(raw.name);
    const entry = index.get(name) ?? { name, freeIds: [], memberIds: [] };
    (raw.members === true ? entry.memberIds : entry.freeIds).push(row.id);
    index.set(name, entry);
  }
  return [...index.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')).map(entry => ({
    ...entry, freeIds: entry.freeIds.sort((a,b)=>a-b), memberIds: entry.memberIds.sort((a,b)=>a-b),
    members: entry.freeIds.length && entry.memberIds.length ? null : entry.memberIds.length > 0,
  }));
}

export function createItemMembershipLookup(entries) {
  const exact = new Map(entries.map(entry => [entry.name, entry]));
  const folded = new Map();
  for (const entry of entries) {
    const key = entry.name.toLocaleLowerCase('en');
    const candidates = folded.get(key) ?? [];
    candidates.push(entry); folded.set(key, candidates);
  }
  return name => {
    const normalizedName = normalizeItemMembershipName(name);
    let entry = exact.get(normalizedName), match = 'exact';
    if (!entry) {
      const candidates = folded.get(normalizedName.toLocaleLowerCase('en')) ?? [];
      if (candidates.length === 1) { entry = candidates[0]; match = 'unique-casefold'; }
      else return { status: 'unknown', members: null, normalizedName, candidateIds: [],
        reason: candidates.length ? 'ambiguous-casefold' : 'unmatched' };
    }
    const members = entry.wikiDisagreement ? null : entry.wikiResolution?.members ?? entry.members;
    return { status: members === null ? 'unknown' : members ? 'members' : 'free', members,
      normalizedName: entry.name, match, candidateIds: [...entry.freeIds, ...entry.memberIds].sort((a,b)=>a-b),
      cacheMembers: entry.members, reason: entry.wikiDisagreement ? 'cache-wiki-disagreement' : entry.wikiResolution ? 'pinned-wiki-item-ids' : members === null ? 'conflicting-variants' : 'unanimous-cache-variants',
      ...(entry.wikiResolution ? { resolvedIds: entry.wikiResolution.ids, wiki: entry.wikiResolution } : {}) };
  };
}
