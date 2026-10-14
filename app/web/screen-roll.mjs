// Main-screen roll; shared values and callbacks live in the explicit screen context.
export function createScreenRoll(c) {
  function renderRollControls() {
    const owner = c.member(), candidates = c.rollCandidateCount();
    const blocked = !c.canWrite() || c.sandbox.active || c.rollBusy || !owner || !!owner.pendingRoll.length;
    c.$('pick').disabled = blocked || candidates < 1;
    c.$('roll-two').disabled = blocked || candidates < 2;
    c.$('pick').textContent = c.preferences().randomStartAlways ? 'Random Chunk' : 'Pick Chunk';
    c.$('unpick').disabled = blocked || !owner?.unlocked.length;
  }

  function rollCandidateCount() {
    if (!c.preferences().randomStartAlways) return c.statePools[c.memberId]?.eligible.length ?? 0;
    const settings = c.registry.resolve(c.state.rules), unlocked = new Set(c.member().unlocked);
    const blocked = new Set(c.member().blacklisted);
    return [...c.world.surface].filter(id => c.world.walkable.has(id) && (!settings['content.f2p'] || c.world.f2p.has(id)) && !unlocked.has(id) && !blocked.has(id)).length;
  }

  async function rollChunks(count, confirmed = false) {
    if (!c.canWrite()) return;
    const owner = c.member(), candidates = c.rollCandidateCount();
    if (c.rollBusy || !owner || owner.pendingRoll.length || candidates < count) return;
    if (c.preferences().rollWarning && !confirmed) {
      const reviewedMember = c.memberId, revision = c.state.revision;
      const generation = c.openDialog('Confirm chunk roll', c.el('p', `Roll ${count === 2 ? 'two choices' : 'one chunk'} for ${owner.name} from ${candidates} chunks in the roll pool?`), c.button('Roll now', async () => {
        if (c.memberId !== reviewedMember || c.state.revision !== revision) throw new Error('The map changed. Close this window and review the roll again.');
        c.closeDialog(generation); await c.rollChunks(count, true);
      }), c.button('Cancel', () => c.closeDialog(generation))); return;
    }
    const rollingMemberId = c.memberId, generation = c.dialogGeneration;
    const rollingName = owner.name, fancy = c.preferences().cinematicRoll;
    const rollType = c.preferences().randomStartAlways ? 'random-start' : 'roll';
    c.rollBusy = true;
    c.renderRollControls();
    try {
      const before = c.preferences().newTasks ? await c.ensureResult() : null;
      const response = await c.command({ type: rollType, memberId: rollingMemberId, count });
      const picks = response.state.history.at(-1)?.command?.rolled ?? [];
      if (rollingMemberId === c.memberId && fancy && picks.length) await c.presentRoll(picks, rollingName);
      if (before && count === 1 && rollingMemberId === c.memberId) await c.newTaskPopup(before, generation);
    }
    catch (error) { c.showError(error); }
    finally { c.rollBusy = false; c.renderState(); }
  }

  async function presentRoll(ids, ownerName) {
    const overlay = c.el('section', undefined, 'roll-presentation');
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-label', `${ownerName}’s roll result`);
    overlay.append(c.el('h2', ids.length > 1 ? `${ownerName}’s roll choices` : `${ownerName}’s new chunk`));
    const cards = c.el('div', undefined, 'roll-cards');
    for (const id of ids) {
      const card = c.el('div', undefined, 'roll-card');
      const name = c.plain(c.world.chunks.get(id)?.name) || id; card.append(c.el('strong', name)); if (c.advanced() && name !== id) card.append(c.el('span', id));
      cards.append(card);
    }
    overlay.append(cards);
    c.$('map-panel').append(overlay);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = reduced ? null : cards.animate([{ opacity: 0, transform: 'translateY(-18px) scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 800, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    const skip = c.button('Show result now', () => animation?.finish());
    overlay.append(skip);
    try { if (animation) await animation.finished.catch(() => {}); }
    finally { overlay.remove(); }
    if (ids.length === 1) c.map.centerOnChunk(ids[0]);
  }

  async function newTaskPopup(before, generation = c.dialogGeneration) {
    const after = await c.ensureResult(), prior = new Set((before.presentation?.tasks ?? []).map(task => task.id));
    if (generation !== c.dialogGeneration) return;
    const byId = new Map((after.tasks ?? []).map(task => [task.id, task]));
    const added = (after.presentation?.tasks ?? []).map(task => byId.get(task.id) ?? task).filter(task => task.status === 'available' && !prior.has(task.id));
    const content = c.el('div', undefined, 'form-stack'); content.append(c.el('p', `${added.length} new tasks after this roll. See all available methods in Activity Info.`));
    for (const task of added.slice(0, 100)) content.append(c.button(task.label, () => c.showTask(task)));
    if (added.length > 100) content.append(c.el('p', 'The task sidebar contains the full list.'));
    c.openDialog('New chunk tasks', content);
  }

  function unpickDialog() {
    const ownerId = c.memberId, revision = c.state.revision;
    const generation = c.openDialog('Forfeit a chunk', c.el('p', `Re-lock a random chunk from ${c.member().name}’s map? It will stay selected for future rolls. Your progress is kept, and Undo can reverse this change.`), c.button('Forfeit one chunk', async () => { await c.command({ type: 'unpick', memberId: ownerId }, revision); c.closeDialog(generation); }), c.button('Cancel', () => c.closeDialog(generation)));
  }

  async function acceptRoll(payload) {
    const generation = c.dialogGeneration;
    const before = c.preferences().newTasks ? await c.ensureResult() : null;
    await c.command(payload);
    if (before && payload.memberId === c.memberId) await c.newTaskPopup(before, generation);
  }

  Object.assign(c, { renderRollControls, rollCandidateCount, rollChunks, presentRoll, newTaskPopup, unpickDialog, acceptRoll });
}
