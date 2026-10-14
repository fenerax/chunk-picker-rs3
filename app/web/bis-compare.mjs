const array = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values.filter(Boolean))];
const itemName = value => typeof value === 'string' ? value : value?.name ?? value?.equipment?.name;
const styleOrder = ['Melee', 'Ranged', 'Magic', 'Necromancy', 'Prayer', 'Melee Tank', 'Ranged Tank', 'Magic Tank', 'Necromancy Tank'];
const slotOrder = ['head', 'neck', 'back', 'cape', 'torso', 'body', 'legs', 'hands', 'feet', 'ring', 'main hand', 'off-hand', 'ammo', 'pocket', 'aura'];
const roles = [['main hand', 'mainHand', 'Main hand'], ['off-hand', 'offHand', 'Off-hand'], ['ammo', 'ammunition', 'Ammunition']];
const title = value => value.replace(/^./, char => char.toUpperCase());
const ordered = (values, order) => values.sort((a, b) => {
  const index = value => order.includes(value) ? order.indexOf(value) : order.length;
  return index(a) - index(b) || a.localeCompare(b);
});

function reasonFor(style, coupled) {
  if (coupled) return style.endsWith(' Tank')
    ? 'Complete hand loadout: armour + life points; armour, then life points break score ties.'
    : style === 'Prayer' ? 'Complete compatible hand loadout: combined prayer bonus; armour, then life points break ties.'
      : 'Complete compatible weapon loadout: picker score includes both hands and ammunition; armour, then life points break ties. This is not DPS.';
  return style.endsWith(' Tank') ? 'Armour, then life points.'
    : style === 'Prayer' ? 'Prayer bonus.' : 'Style damage and accuracy bonus, then armour, then life points.';
}

function indexPlan(plan) {
  const rows = new Map();
  const recommendations = [...array(plan?.recommendations), ...array(plan?.specialist?.tank?.recommendations)];
  for (const rec of recommendations) {
    if (rec.loadoutMode || !rec.equipment?.name) continue;
    rows.set(`${rec.style}\0${rec.slot}`, {
      style: rec.style, slot: rec.slot, items: unique([rec.equipment.name, ...array(rec.alternatives).map(itemName)]),
      rank: Array.isArray(rec.score) && rec.score.length && rec.score.every(Number.isFinite) ? [...rec.score] : null,
      coupled: false, explanation: rec.comparison || reasonFor(rec.style, false),
    });
  }
  const loadouts = [...array(plan?.loadouts), ...array(plan?.specialist?.tank?.loadouts)];
  const slotsByName = new Map(recommendations.map(rec => [rec.equipment?.name, rec.equipment?.slot ?? rec.slot]));
  for (const loadout of loadouts) {
    const best = loadout.best;
    if (!best) continue;
    // Peer item arrays represent complete tied loadouts, never independent upgrades.
    const peers = array(best.alternatives);
    const rank = Number.isFinite(best.score) ? [best.score, best.defence?.armour ?? 0, best.defence?.lifePoints ?? 0] : null;
    for (const [slot, role] of roles) {
      const peerItems = peers.flatMap(peer => array(peer.items).filter((name, index) => {
        const itemSlot = slotsByName.get(name);
        // Engine peer arrays have the same hand mode and component order as
        // best.items. Peer names need not have their own recommendation row.
        if (!itemSlot) return best[role] && index === array(best.items).indexOf(best[role]);
        return role === 'mainHand' ? ['main hand weapon', '2h weapon'].includes(itemSlot)
          : role === 'offHand' ? ['off-hand', 'off-hand weapon'].includes(itemSlot) : itemSlot === 'ammo';
      }));
      rows.set(`${loadout.style}\0${slot}`, {
        style: loadout.style, slot, items: unique([best[role], ...peerItems]), rank, coupled: true,
        unused: !best[role], mode: best.mode, loadoutItems: [...array(best.items)],
        tiedLoadouts: peers.map(peer => [...array(peer.items)]), explanation: reasonFor(loadout.style, true),
      });
    }
  }
  return rows;
}

function compareRecorded(entries, coupled) {
  if (entries.length !== 2 || entries.some(entry => !entry?.rank)) return { status: 'unknown', winner: null, label: 'Recorded comparison unknown' };
  const [left, right] = entries;
  if (left.rank.length !== right.rank.length) return { status: 'unknown', winner: null, label: 'Recorded rankings are not comparable' };
  for (let i = 0; i < left.rank.length; i++) {
    const difference = left.rank[i] - right.rank[i];
    if (Math.abs(difference) > (coupled && i === 0 ? 1e-8 : 0)) return {
      status: 'higher', winner: difference > 0 ? 0 : 1,
      label: coupled ? 'Higher-ranked recorded loadout' : 'Higher-ranked recorded gear',
    };
  }
  return { status: 'tie', winner: null, label: coupled ? 'Equal-ranked recorded loadouts' : 'Equal-ranked recorded gear' };
}

/** Read-only projection of already calculated Current BiS results. No inventory
 * inference, engine evaluation, cross-style total or comparison against missing gear. */
export function buildBiSComparison(pairs = []) {
  const players = pairs.map(({ member, result }) => ({
    id: member?.id, name: member?.name ?? member?.displayName ?? member?.id ?? 'Player',
    available: !!result?.currentBiS,
    recorded: indexPlan(result?.currentBiS?.owned?.recordedBest),
    obtainable: indexPlan(result?.currentBiS?.obtainable),
  }));
  const keys = unique(players.flatMap(player => [...player.recorded.keys(), ...player.obtainable.keys()]));
  const styles = ordered(unique(keys.map(key => key.split('\0')[0])), styleOrder).map(style => ({
    style,
    rows: ordered(keys.filter(key => key.split('\0')[0] === style).map(key => key.split('\0')[1]), slotOrder).map(slot => {
      const key = `${style}\0${slot}`;
      const cells = players.map(player => ({ recorded: player.recorded.get(key) ?? null, obtainable: player.obtainable.get(key) ?? null }));
      const coupled = cells.some(cell => cell.recorded?.coupled || cell.obtainable?.coupled);
      return { style, slot, label: roles.find(role => role[0] === slot)?.[2] ?? title(slot), coupled,
        explanation: reasonFor(style, coupled), cells, comparison: compareRecorded(cells.map(cell => cell.recorded), coupled) };
    }),
  }));
  return { players: players.map(({ id, name, available }) => ({ id, name, available })), styles };
}

/** context.el(tag, text, className), optional plain(text), itemIcon(name), advanced.
 * Returns a detached node; the caller owns loading, fetching and mounting. */
export function renderBiSComparison(context, pairs = []) {
  const { el, itemIcon } = context;
  const advanced = typeof context.advanced === 'function' ? context.advanced() === true : context.advanced === true;
  const plain = context.plain ?? (value => String(value ?? ''));
  const model = buildBiSComparison(pairs);
  const root = el('div', undefined, 'bis-comparison');
  root.append(el('p', 'Recorded gear is the best gear each player marked obtained. Whether they still own or wear it is unknown. Obtainable gear shows what they can get.', 'bis-ranking-note'));
  for (const player of model.players.filter(player => !player.available)) root.append(el('p', `${plain(player.name)}: gear calculation unavailable.`, 'info-empty'));
  if (!model.styles.length) root.append(el('p', 'No recorded or obtainable gear comparisons are available.', 'info-empty'));
  function gear(entry, label) {
    const node = el('div', undefined, 'bis-compare-gear');
    node.append(el('p', label, 'bis-compare-kind'));
    if (!entry) node.append(el('p', label === 'Recorded obtained' ? 'No usable gear recorded.' : 'No obtainable gear known.', 'bis-compare-unknown'));
    else if (!entry.items.length) node.append(el('p', entry.unused ? 'Unused in this loadout.' : 'Gear unknown.', 'bis-compare-unknown'));
    else for (const name of entry.items) {
      const identity = el('div', undefined, 'bis-item-identity');
      const source = itemIcon?.(name);
      if (source) { const icon = el('img', undefined, 'bis-item-icon'); icon.src = source; icon.alt = ''; identity.append(icon); }
      identity.append(el('span', plain(name), 'bis-item-name')); node.append(identity);
    }
    if (entry?.items.length > 1) node.append(el('small', 'These choices rank equally.', 'bis-compare-unknown'));
    if (entry?.coupled) {
      const label = advanced ? `Compared as ${plain(entry.mode)}` : 'Compared together';
      node.append(el('small', `${label}: ${entry.loadoutItems.map(plain).join(' + ')}`, 'bis-compare-loadout'));
      for (const items of entry.tiedLoadouts) node.append(el('small', `Equally ranked setup: ${items.map(plain).join(' + ')}`, 'bis-compare-loadout'));
    }
    return node;
  }
  for (const section of model.styles) {
    const group = el('section', undefined, 'bis-style-section');
    group.append(el('h3', plain(section.style), 'bis-style-heading'));
    for (const row of section.rows) {
      const rowNode = el('section', undefined, 'bis-compare-row');
      rowNode.append(el('h4', row.label, 'bis-compare-slot'));
      const summary = row.comparison.status === 'tie' ? 'Recorded gear ranks equally.'
        : row.comparison.winner === null ? 'Not enough recorded gear to compare.'
          : `${plain(model.players[row.comparison.winner].name)} has ${row.coupled ? 'a better recorded weapon setup' : 'better recorded gear'}.`;
      const reason = advanced ? row.explanation : row.coupled ? 'Weapons are compared with their off-hand and ammunition.'
        : row.style.endsWith(' Tank') ? 'Armour comes first, then life points.' : row.style === 'Prayer' ? 'Compared by prayer bonus.' : null;
      rowNode.append(el('p', summary, 'bis-compare-status'));
      if (reason) rowNode.append(el('p', reason, 'bis-compare-reason'));
      const columns = el('div', undefined, 'bis-compare-players');
      row.cells.forEach((cell, index) => {
        const column = el('div', undefined, `bis-compare-player${row.comparison.winner === index ? ' bis-compare-higher' : ''}`);
        column.append(el('h5', plain(model.players[index].name), 'bis-compare-player-name'), gear(cell.recorded, 'Recorded obtained'), gear(cell.obtainable, 'Obtainable'));
        columns.append(column);
      });
      rowNode.append(columns); group.append(rowNode);
    }
    root.append(group);
  }
  return root;
}
