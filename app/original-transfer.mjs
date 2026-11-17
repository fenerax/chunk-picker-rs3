import { originalChunkURL, legacyChunkIndex } from './original-chunk-url.mjs';
import { originalRuleDefaults, taskRuleValueError } from './data/settings.mjs';
import { collectionRules } from './tasks/collection.mjs';

function originalArchive(state, memberId) {
  const seen = new Set();
  for (let node = state.provenance; node && typeof node === 'object' && !seen.has(node); node = node.restore?.incomingProvenance) {
    seen.add(node);
    // Archives keep their source attribution. Walk each transfer backwards,
    // newest first, to interpret this node and its incoming restore in those
    // source IDs without rewriting any evidence (including ID swaps).
    const transfers = new Set();
    for (let transfer = node.transferRoster; transfer && typeof transfer === 'object'; transfer = transfer.previous) {
      if (transfers.has(transfer)) return;
      transfers.add(transfer);
      const sources = Object.entries(transfer.mapping ?? {}).filter(([, target]) => target === memberId);
      if (sources.length !== 1) return;
      memberId = sources[0][0];
    }
    const archive = node.originalPasteImports?.findLast(row => row.memberId === memberId);
    if (archive) return archive;
  }
}

// Output only formats accepted by the original's public controls. The player
// pastes each piece; this module never contacts the original service.
export function originalTransfer(state, memberId, dataset, world, { defaults = originalRuleDefaults } = {}) {
  const member = state.members.find(row => row.id === memberId);
  if (!member) throw Object.assign(new Error('Choose a known player.'), { status: 400 });
  const encodedURL = originalChunkURL(member.unlocked, dataset, world, member.selected);
  // The original base converter treats an empty token as zero, so '?;…' and
  // '?' unlock grid cell zero there. Do not offer a link that adds territory.
  const url = member.unlocked.length ? encodedURL : null;
  const effective = collectionRules(state, memberId), rules = {}, resetRules = [], retained = new Map(), collisions = new Set();
  // Reuse the existing per-key decisions, without reparsing an archived paste.
  // Retained original settings can go back even when they had no active effect
  // here. Current explicit settings take precedence; duplicate keys stay out.
  const archive = originalArchive(state, memberId);
  for (const row of archive?.rules ?? []) {
    if (retained.has(row.key)) collisions.add(row.key);
    retained.set(row.key, row.value);
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    const saved = !collisions.has(key) && retained.has(key) ? retained.get(key) : fallback;
    const savedValue = effective[key] ?? saved;
    // Original amount inputs have string defaults but also accept JSON numbers.
    const value = typeof fallback === 'string' && typeof savedValue === 'number' ? String(savedValue) : savedValue;
    // Invalid/structured settings never become executable input or invalid JSON.
    const valid = typeof value === typeof fallback && ['boolean', 'number', 'string'].includes(typeof value) && (typeof savedValue !== 'number' || Number.isFinite(savedValue)) && !taskRuleValueError(key, value);
    rules[key] = valid ? value : fallback;
    if (!Object.hasOwn(effective, key) && (!retained.has(key) || collisions.has(key)) || !valid) resetRules.push(key);
  }
  const selected = [...member.selected].sort((a, b) => legacyChunkIndex(b) - legacyChunkIndex(a));
  const appOnlyRules = Object.keys(effective).filter(key => !Object.hasOwn(defaults, key));
  return { url, rulesJSON: Object.keys(rules).length ? JSON.stringify(rules, null, 2) : null,
    journal: member.journal ?? '',
    selectedOrderChanged: JSON.stringify(selected) !== JSON.stringify(member.selected),
    resetRules: resetRules.slice(0, 100).map(key => key.slice(0, 512)), resetRuleCount: resetRules.length,
    appOnlyRules: appOnlyRules.slice(0, 100).map(key => key.slice(0, 512)), appOnlyRuleCount: appOnlyRules.length,
    message: url ? 'Import from URL replaces unlocked and selected chunks in the original picker, clears its pending choices and blacklist, and resets recent rolls. Keep a full backup first.'
      : 'No safe chunk link is available for an empty unlocked map: the original URL importer would unlock grid cell zero. Clear its unlocked chunks and recreate selected chunks with its own map controls instead. Rules and journal can still be copied below.' };
}
