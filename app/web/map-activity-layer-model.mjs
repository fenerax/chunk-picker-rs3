import { membershipSourceBlocker } from '../data/access-policy.mjs';
import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';

const TIERS = ['easy', 'medium', 'hard', 'elite', 'master'];
const indices = new WeakMap();
const baseId = value => /^\d+(?:-\d+)?$/.test(String(value)) ? String(value).split('-')[0] : null;
const clean = value => String(value).replace(/~\|([^|]+)\|~/g, '$1').replace(/\*/g, '').trim();
const neutral = new Set(['None', 'Manually Locked', 'Select a task', '']);

function indexDefinitions(definitions, world) {
  let worlds = indices.get(definitions);
  if (!worlds) indices.set(definitions, worlds = new WeakMap());
  if (worlds.has(world)) return worlds.get(world);
  const clues = new Map(), monsters = [];
  const mapped = base => world.chunks?.has(base) && (world.surface?.has(base) ?? true);
  for (const tier of TIERS) for (const [location, present] of Object.entries(definitions.clues?.[tier] ?? {})) {
    const base = baseId(location);
    if (!present || !base || !mapped(base)) continue;
    if (!clues.has(base)) clues.set(base, []);
    clues.get(base).push({ tier, label: `${tier[0].toUpperCase()}${tier.slice(1)} clue location` });
  }
  for (const [base, chunk] of Object.entries(definitions.chunks ?? {})) {
    if (!/^\d+$/.test(base) || !mapped(base)) continue;
    for (const [sectionId, section] of Object.entries(chunk.Sections ?? { '0': chunk })) {
      for (const [name, quantity] of Object.entries(section.Monster ?? {})) {
        if (quantity !== false) monsters.push({ base, location: sectionId === '0' ? base : `${base}-${sectionId}`, name: clean(name), members: chunk['Not F2P'] === true || section['Not F2P'] === true });
      }
    }
  }
  const result = { clues, monsters }; worlds.set(world, result); return result;
}

/** Recorded planning locations only. Verified membership restrictions apply.
 * Named interiors are omitted; a Connect edge alone does not locate a monster.
 * world.monsterMembership is an optional server projection of membership records.
 */
export function buildMapActivityLayers({ definitions = {}, world = {}, state = {}, memberId } = {}) {
  const member = state.members?.find(value => value.id === memberId);
  const legacy = state.legacy?.maps?.[member?.sourceMapId]?.chunkinfo ?? {};
  const personalLock = member && Object.hasOwn(member, 'slayerLock');
  const lock = personalLock ? member.slayerLock : legacy.slayerLocked;
  const f2p = state.rules?.['content.f2p'] ?? true;
  const index = indexDefinitions(definitions, world), clues = new Map(), slayer = new Map();
  if (!f2p) for (const [base, rows] of index.clues) clues.set(base, rows.map(row => ({ ...row })));
  const targets = [];
  for (const [field, mapping] of [['monster', definitions.codeItems?.slayerTasks], ['boss', definitions.codeItems?.reaperTasks]]) {
    const label = clean((personalLock ? lock?.[field] : decodeLegacyText(lock?.[field])) ?? '');
    if (!neutral.has(label)) targets.push({ label, aliases: new Set(Object.entries(mapping?.[label] ?? {}).filter(([, present]) => present !== false).map(([name]) => clean(name))) });
  }
  let unknown = false;
  for (const target of targets) for (const row of index.monsters) {
    // A # variant belongs to its explicitly mapped base entity. Parenthetical
    // variants stay exact: distinct locations may have distinct membership.
    if (!target.aliases.has(row.name) && !target.aliases.has(row.name.split('#')[0])) continue;
    if (f2p) {
      if (row.members || !world.f2p?.has(row.base) || membershipSourceBlocker('Monster', row.name, row.location, true)
        || membershipSourceBlocker('Monster', row.name.split('#')[0], row.base, true)) continue;
      const memberships = definitions.monsterMembership ?? world.monsterMembership;
      const membership = memberships instanceof Map ? memberships.get(row.name) : memberships?.[row.name];
      const verified = ['verified-infobox', 'verified-row'].includes(membership?.status);
      if (membership?.members === true && verified) continue;
      const baseMembership = memberships instanceof Map ? memberships.get(row.name.split('#')[0]) : memberships?.[row.name.split('#')[0]];
      if (!verified && baseMembership?.members === true
        && ['verified-infobox', 'verified-row'].includes(baseMembership.status)) continue;
      if (membership?.members !== false || !verified) unknown = true;
    }
    if (!slayer.has(row.base)) slayer.set(row.base, []);
    const label = `${target.label}: ${row.name}`;
    if (!slayer.get(row.base).some(value => value.label === label)) slayer.get(row.base).push({ label });
  }
  const slayerLabel = targets.map(target => target.label).join(' / ');
  let slayerNote = targets.length ? 'Surface spots only; caves and buildings aren’t shown.' : 'No Slayer monster or Reaper boss is locked for this player.';
  if (targets.some(target => target.aliases.size === 0)) slayerNote += ' No monsters are recorded for this saved task.';
  if (unknown) slayerNote += ' Some monster membership is unverified.';
  if (targets.length && slayer.size === 0) slayerNote += ' No recorded map chunks match this task.';
  return { clues, slayer, tiers: [...TIERS], slayerLabel,
    clueNote: f2p ? 'Clue scrolls are members-only.' : 'Clue spots only; items and quests aren’t checked.', slayerNote };
}
