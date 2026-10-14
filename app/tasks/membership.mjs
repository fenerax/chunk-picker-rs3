import { pickerEntityMembership } from '../data/item-membership.mjs';
import { sourceMembershipIncidentalOutput } from '../data/source-membership.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const clean = value => String(value).replace(/\*/g, '').replace(/~\|([^|]+)\|~/g, (_, name) => name.split('#')[0]);

/** Picker entities include reviewed virtual currencies as well as cache items. */
export function itemMembershipBlocker(name, f2p = true, definitions = {}) {
  if (!f2p) return null;
  const membership = pickerEntityMembership(clean(name));
  if (membership.members !== true && definitions.equipment?.[clean(name)]?.members !== true) return null;
  return { kind: 'membership', code: 'members-only-item', item: clean(name),
    detail: `Members-only item: ${clean(name)}.`, candidateIds: membership.candidateIds,
    ...(membership.evidence || membership.wiki?.url ? { evidence: membership.evidence ?? membership.wiki.url } : {}) };
}

/** Expand transparent output tables, retaining mixed free/member activities. */
export function membershipOutputItems(category, output, definitions, seen = new Set(), rootCache) {
  if (typeof output !== 'string' || seen.has(output)) return [];
  const table = definitions.skillItems?.[category]?.[output] ?? definitions.codeItems?.dropTables?.[output];
  if (!table) return [clean(output)];
  // The caller scopes this cache to one fixed definitions variant. Recursive
  // expansions retain their own path-specific cycle cutoffs.
  let roots;
  if (rootCache && !seen.size) {
    roots = rootCache.get(category);
    if (roots?.has(output)) return roots.get(output);
    if (!roots) rootCache.set(category, roots = new Map());
  }
  const products = Object.entries(table).filter(([, value]) => value !== false).flatMap(([name]) =>
    membershipOutputItems(category, name, definitions, new Set([...seen, output])));
  if (roots) roots.set(output, Object.freeze(products));
  return products;
}

/** Hard membership gates, without changing identity or erasing saved facts.
 * Unknown item names remain unknown. An alias with enough free/unknown choices
 * and an activity with at least one free/unknown random product remain usable.
 * Rewards are filtered at source admission, rather than banning a free quest.
 */
export function taskItemMembershipBlockers(record, category, definitions, label = '',
  blockerFor = name => itemMembershipBlocker(name, true, definitions), outputRootCache) {
  const blockers = [];
  for (const token of list(record.Items)) {
    const name = clean(token), alias = /^(.*\[\+\])(?:x(\d+))?$/.exec(name);
    let alternatives = alias && definitions.codeItems?.itemsPlus?.[alias[1]];
    if (alias && !alternatives) {
      const keys = Object.keys(definitions.codeItems?.itemsPlus ?? {}).filter(key => key.toLowerCase() === alias[1].toLowerCase());
      if (keys.length === 1) alternatives = definitions.codeItems.itemsPlus[keys[0]];
    }
    if (alias && !alternatives) continue; // Unknown aliases are diagnosed by the engine.
    const names = [...new Set(alternatives ?? [name])], needed = alias?.[2] ? Number(alias[2]) : 1;
    const blocked = names.map(blockerFor).filter(Boolean);
    if (names.length - blocked.length < needed && blocked.length) {
      blockers.push(...blocked.map(blocker => ({ ...blocker, requirement: token })));
    }
  }
  const products = [...new Set(list(record.Output).flatMap(output => membershipOutputItems(category, output, definitions, new Set(), outputRootCache)))];
  if (products.length && products.every(blockerFor)
    && !sourceMembershipIncidentalOutput(category, label, record, true)) {
    blockers.push(...products.map(name => ({ ...blockerFor(name), product: true })));
  }
  return [...new Map(blockers.map(blocker => [JSON.stringify(blocker), blocker])).values()];
}
