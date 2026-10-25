// Every gated boss with each player's state. Gates are per player: levels are
// the player's own, and gear counts what the group can get together.
export function buildBossGatesModel(state, results) {
  const members = state.members.map(member => {
    const gates = results.get(member.id)?.bossGates;
    return { id: member.id, name: member.name || member.id, ready: Array.isArray(gates), gates: new Map((gates ?? []).map(gate => [gate.id, gate])) };
  });
  const source = members.find(member => member.ready);
  const gates = source ? [...source.gates.values()].map(gate => ({
    id: gate.id, boss: gate.boss, condition: gate.condition,
    players: members.map(member => {
      const status = member.gates.get(gate.id);
      return status ? { memberId: member.id, name: member.name, ready: true, open: status.open, openedBy: status.openedBy, missing: status.missing ?? [], gearItems: status.gearItems ?? [] }
        : { memberId: member.id, name: member.name, ready: false };
    }),
  })) : [];
  return {
    members: members.map(({ id, name, ready }) => ({ id, name, ready, open: gates.filter(gate => gate.players.some(player => player.memberId === id && player.open)).length })),
    gates,
  };
}

/** What a player still needs for a gate, or what opened it. */
export function bossGateDetail(player) {
  if (!player.ready) return 'Still loading';
  if (player.openedBy === 'manual') return 'Unlocked by hand';
  if (player.open) return player.gearItems.length ? `Gear: ${player.gearItems.join(', ')}` : '';
  return player.missing.length ? player.missing.join('; ') : 'Unlock by hand from the chunk panel';
}

export function renderBossGates(c, model, { hideOpen = false } = {}) {
  const root = c.el('div', undefined, 'boss-gates-content');
  root.append(c.el('p', 'What opens each boss. Levels are each player’s own synced levels. Gear counts what the group can get from everyone’s unlocked areas.', 'boss-gates-intro'));
  root.append(c.el('p', model.members.map(member => member.ready ? `${member.name}: ${member.open} of ${model.gates.length} open` : `${member.name}: still loading`).join(' · '), 'boss-gates-note'));
  const gates = hideOpen ? model.gates.filter(gate => !gate.players.every(player => player.open)) : model.gates;
  if (!model.gates.length) { root.append(c.el('p', 'Saved task details are still loading. Refresh to try again.', 'status-detail')); return root; }
  if (!gates.length) { root.append(c.el('p', 'Every boss is open for everyone.', 'boss-gates-note')); return root; }
  const list = c.el('ul', undefined, 'boss-gates-list');
  for (const gate of gates) {
    const row = c.el('li', undefined, 'boss-gates-row'); row.dataset.gate = gate.id;
    row.append(c.el('strong', gate.boss), c.el('p', `Condition: ${gate.condition}`, 'boss-gates-condition'));
    const players = c.el('ul', undefined, 'boss-gates-players');
    for (const player of gate.players) {
      const line = c.el('li', undefined, `boss-gates-player${player.open ? ' is-open' : ''}`);
      line.append(c.el('span', player.ready ? player.open ? 'Open' : 'Locked' : '…', 'boss-gates-state'), c.el('span', player.name, 'boss-gates-name'),
        c.el('span', bossGateDetail(player), 'boss-gates-detail'));
      players.append(line);
    }
    row.append(players); list.append(row);
  }
  root.append(list);
  return root;
}

export function createBossGatesView(c) {
  let active, sequence = 0, hideOpen = false;
  const current = run => active && run === sequence && c.dialogCurrent(active.generation);
  async function load() {
    if (!active || !c.dialogCurrent(active.generation)) return;
    const run = ++sequence, revision = c.state.revision;
    active.revision = revision; active.content.setAttribute('aria-busy', 'true');
    try {
      if (c.sandbox?.active) throw new Error('Exit Sandbox to view saved boss gates.');
      const results = new Map();
      for (const member of c.state.members) results.set(member.id, await c.ensureDuoDetails(member.id, false, false));
      if (!current(run)) return;
      if (revision !== c.state.revision) return load();
      const model = buildBossGatesModel(c.state, results);
      const toolbar = c.el('div', undefined, 'boss-gates-toolbar');
      const filter = c.el('label', undefined, 'boss-gates-filter'), box = c.el('input');
      box.type = 'checkbox'; box.checked = hideOpen;
      box.addEventListener('change', () => { hideOpen = box.checked; active.content.lastChild.replaceWith(renderBossGates(c, model, { hideOpen })); });
      filter.append(box, c.el('span', 'Hide bosses open for everyone'));
      toolbar.append(filter, c.button('Refresh', () => load()));
      active.content.replaceChildren(toolbar, renderBossGates(c, model, { hideOpen }));
    } catch (error) {
      if (!current(run)) return;
      active.content.replaceChildren(c.el('p', c.sandbox?.active ? error.message : 'Boss gates could not be loaded. Refresh to try again.', 'status-detail'), c.button('Refresh boss gates', () => load()));
    } finally { if (current(run)) active.content.setAttribute('aria-busy', 'false'); }
  }
  async function open() {
    c.closeTopMenus?.();
    const root = c.el('div', undefined, 'boss-gates-panel'), content = c.el('div');
    content.append(c.el('p', 'Loading boss gates…', 'status-detail')); root.append(content);
    active = { content, generation: c.openDialog('Boss gates', root), revision: c.state.revision }; await load();
  }
  function refresh() { if (active && c.dialogCurrent(active.generation) && active.revision !== c.state.revision) void load(); }
  c.$('boss-gates-open')?.addEventListener('click', () => open().catch(c.showError));
  const view = { open, refresh }; c.bossGatesView = view; return view;
}
