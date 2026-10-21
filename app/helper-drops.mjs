/** Small, uncached view of drops already admitted by the task calculation.
 * The calculation has checked source access, membership and item evidence.
 * A reachable monster is not a promise that the player can defeat it.
 */
export function helperDrops(result) {
  const rows = new Map();
  for (const item of result.items ?? []) for (const source of item.sources ?? []) {
    if (source.kind !== 'drop' || !source.source || !(source.probability > 0 && source.probability <= 1)) continue;
    const key = `${source.source}\u0000${item.name}\u0000${source.probability}`;
    rows.set(key, { monster: source.source, item: item.name, denominator: 1 / source.probability,
      rate: source.rate ?? `1/${1 / source.probability}`, wiki: `https://runescape.wiki/w/${encodeURIComponent(source.source.replaceAll('#', '/'))}` });
  }
  return [...rows.values()].sort((a, b) => a.monster.localeCompare(b.monster) || a.item.localeCompare(b.item));
}
