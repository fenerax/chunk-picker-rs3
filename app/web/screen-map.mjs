import { gameStorage } from './screen-save-status.mjs';
import { projectChunkState } from './command-state.mjs';
import { chunkColourLegend } from './chunk-colour-picker.mjs';
import { createTravelLinesKey } from './map-info.mjs';
import { createMapTaskCounts } from './map-task-counts.mjs';
import { createMapActivityLayers } from './map-activity-layers.mjs';

// Main-screen map; shared values and callbacks live in the explicit screen context.
export function createScreenMap(c) {
  c.mapTaskCounts = createMapTaskCounts(c);
  c.activityLayers = createMapActivityLayers(c);
  function mapControls() {
    const section = c.el('section', undefined, 'map-controls');
    section.append(c.el('h3', 'Map controls'), c.el('p', 'Click or tap: chunk info · Ctrl/Cmd-click: add/remove a locked surface chunk from the roll pool · Shift-click: unlock or re-lock (when Shift-click unlock is on in Settings) · Right-click or long-press: chunk menu.', 'status-detail'));
    if (!c.canWrite()) section.append(c.el('p', 'View-only link: map changes are unavailable.', 'status-detail'));
    else if (c.sandbox.active) section.append(c.el('p', 'In Sandbox, click to lock or unlock. Leave Sandbox to change the roll pool.', 'status-detail'));
    else section.append(c.el('p', 'Adding to the roll pool keeps the chunk locked. Other roll rules still apply. By default, remaining hand-added chunks are removed after you unlock a rolled chunk; change this in Chunk Rules.', 'status-detail'));
    return section;
  }
  function renderState() {
    if (!c.member()) return;
    c.originalSync.refresh();
    c.applyPreferences();
    const dropdown = c.$('member'); dropdown.replaceChildren(...c.state.members.map(item => { const node = c.el('option', item.name); node.value = item.id; return node; })); dropdown.value = c.memberId;
    // The visible switch drives the same select, so its change handler stays the single code path.
    c.$('member-switch').replaceChildren(...c.state.members.map(item => {
      const node = c.button(item.name, () => { if (item.id === c.memberId) return; dropdown.value = item.id; dropdown.dispatchEvent(new Event('change')); });
      node.setAttribute('aria-pressed', String(item.id === c.memberId)); return node;
    }));
    c.pool = c.statePools[c.memberId] ?? { eligible: [], excluded: [], accessible: [] };
    c.syncPredictionIntents();
    c.renderMapState();
    c.deathChunks.refresh();
    c.poolRanking?.refresh();
    c.renderRollControls();
    c.mapDisplay?.refresh();
    c.finishLine?.refresh();
    c.partnerSupply?.refresh();
    c.bossGatesView?.refresh();
    c.$('undo').disabled = !c.canWrite() || c.sandbox.active || !c.state.history.some(event => event.undo && !event.undoneRevision);
    c.duoCoordination?.render();
    c.gamePlugin?.render();
    for (const id of ['settings-open', 'game-plugin-open', 'bis-open', 'activity-open', 'teleports-open', 'backup-open', 'original-sync-open', 'invites-open', 'feedback-open', 'custom-task-open', 'random-start']) if (c.$(id)) c.$(id).disabled = c.sandbox.active;
    for (const theme of ['dark', 'gray', 'light']) { const choice = c.$(`theme-${theme}`); if (choice) choice.disabled = c.sandbox.active; }
    const pending = c.$('pending-panel'); pending.hidden = !c.member().pendingRoll.length; pending.replaceChildren();
    if (c.member().pendingRoll.length) {
      pending.append(c.el('h2', c.canWrite() ? 'Choose your next chunk' : `${c.member().name}’s pending roll`), c.el('p', !c.canWrite() ? 'Waiting for the player to choose a chunk.' : c.member().pendingRoll.length > 1 ? 'Unlock a choice below, or let the picker choose at random.' : 'Review this chunk, then unlock it when you’re ready.', 'pending-intro'));
      for (const id of c.member().pendingRoll) {
        const row = c.el('div', undefined, 'pending-choice'), title = c.el('div', undefined, 'pending-choice-title');
        const name = c.plain(c.world.chunks.get(id)?.name) || id; title.append(c.el('strong', name)); if (c.advanced() && name !== id) title.append(c.el('small', `Chunk ${id}`));
        row.append(title, ...(c.canWrite() ? [c.button(`Unlock ${name}`, () => c.acceptRoll({ type: 'unlock-selection', memberId: c.memberId, chunkId: id }), 'primary-action')] : []), c.button(`View ${name}`, () => { c.map.centerOnChunk(id); c.showChunk(id); }, 'choice-view'));
        pending.append(row);
      }
      const actions = c.el('div', undefined, 'pending-actions');
      actions.append(c.button('Pick for me', () => c.acceptRoll({ type: 'pick-for-me', memberId: c.memberId })));
      if (c.member().pendingRoll.length > 1) actions.append(c.button('Unlock both', () => c.acceptRoll({ type: 'unlock-both', memberId: c.memberId })));
      actions.append(c.button('Cancel roll', () => c.acceptRoll({ type: 'cancel-roll', memberId: c.memberId }), 'cancel-roll')); if (c.canWrite()) pending.append(actions);
      for (const button of pending.querySelectorAll('button')) if (button.className !== 'choice-view') button.disabled = c.rollBusy;
    }
    c.$('recent-panel').hidden = !c.preferences().recent || !!c.member().pendingRoll.length;
    c.$('recent-content').replaceChildren(c.mapTools.recentPanel());
    if (c.chunkId && !c.$('chunk-info').hidden && (c.accessSections && c.accessSectionsMember !== c.memberId || c.sandbox.active && ['unlock', 'challenges', 'clues', 'tasks'].includes(c.chunkTab ?? c.defaultChunkTab()) || !c.$('chunk-content').contains(document.activeElement)) && c.chunkSignature(c.chunkId) !== c.shownChunkSignature) c.showChunk(c.chunkId);
    c.refreshChunkNotes();
    c.refreshChunkSummary();
    c.renderTasks();
    c.$('map-hint').textContent = c.sandbox.active ? 'Sandbox: click chunks to lock or unlock · Right-click or Search for details' : 'Drag to pan · Scroll to zoom · Click for chunk info';
    c.areaCheck?.refreshRevision();
    c.sandbox.refreshChrome();
    c.applyDatasetControls?.();
  }

  function renderMapState() {
    const projected = projectChunkState(c.state, c.pendingChunkChanges), owner = projected.members.find(item => item.id === c.memberId);
    if (!owner) return;
    c.map.setModel({ world: c.world, state: projected, memberId: c.memberId, groupView: c.$('group-view').checked, pool: c.pool, preferences: c.preferences(), sandbox: c.sandbox.markers() });
    c.questMap?.refresh();
    void c.activityLayers.refresh();
    const count = (value, label) => { const node = c.el('span', undefined, 'map-count'); node.append(c.el('strong', value.toLocaleString()), ` ${label}`); return node; };
    c.$('map-counts').replaceChildren(count(owner.unlocked.length, `chunks unlocked by ${owner.name}`), count(new Set(projected.members.flatMap(item => item.unlocked)).size, 'unique chunks unlocked by group'), count(c.pool.eligible.length, `chunks in ${owner.name}’s ordinary roll pool`),
      ...(c.preferences().randomStartAlways ? [count(c.rollCandidateCount(), `roll-anywhere candidate chunks for ${owner.name}`)] : []));
    c.copyLists?.map(owner, c.pool);
    c.$('empty-map').hidden = owner.unlocked.length > 0;
    c.renderLegend();
  }

  function storedOverlay() { try { return gameStorage().getItem('picker.overlay'); } catch { return null; } }

  function setMembershipOverlay(on) {
    if (c.supportsFeature?.('rsCatalogues') === false) on = false;
    c.$('membership-overlay').setAttribute('aria-pressed', String(on)); c.map.setOverlay(on ? 'membership' : null);
    try { if (on) gameStorage().setItem('picker.overlay', 'membership'); else gameStorage().removeItem('picker.overlay'); } catch {}
    if (c.state && c.member()) c.renderLegend();
  }

  function renderLegend() {
    const focusedLayer = /^map-activity-(clues|slayer)-legend$/.test(globalThis.document?.activeElement?.id ?? '') ? document.activeElement.id : null;
    const item = (label, kind, color) => { const node = c.el('span', undefined, 'legend-item'); const swatch = c.el('i', undefined, `swatch swatch-${kind}`); if (color) swatch.style.setProperty('--swatch', color); swatch.setAttribute('aria-hidden', 'true'); node.append(swatch, label); return node; };
    const visible = c.$('group-view').checked ? c.map.members : c.map.members.filter(owner => owner.id === c.memberId);
    const owners = c.$('group-view').checked && c.map.members.length > 1 ? c.map.members.filter(owner => owner.unlocked?.some(id => !c.map.members.every(other => other.unlocked?.includes(id)))).map(owner => item(`${owner.name} only`, 'tab', owner.color)) : [];
    const disconnected = c.$('group-view').checked && Object.values(c.map.connections?.byChunk ?? {}).some(connection => connection.connected === false);
    c.$('map-legend').replaceChildren(
      ...(visible.some(owner => owner.unlocked?.length) ? [item('Unlocked', 'border', c.preferences().unlockedBorderColor || '#FF0000')] : []), ...owners,
      ...(disconnected ? [item('Disconnected partner', 'disconnected')] : []),
      ...(visible.some(owner => owner.selected?.length) ? [item('In roll pool (added by hand)', 'selected')] : []),
      ...(c.pool?.eligible?.some(row => !visible.some(owner => owner.selected?.includes(row.id))) ? [item('Automatic roll option (numbered)', 'pool')] : []),
      ...(visible.some(owner => owner.pendingRoll?.length) ? [item('Roll choices', 'pending')] : []),
      item('Chunk info open', 'open'),
      chunkColourLegend(c, visible),
      ...(c.preferences().showTaskCounts !== false ? [item('Active task count', 'task-count')] : []),
      ...(c.supportsFeature?.('mapMetadata') !== false && c.preferences().showPlaceNames !== false ? [item('Place names', 'place-name')] : []),
      ...(c.sandbox.active ? [item('Sandbox change (hatched)', 'sandbox')] : []),
      ...(c.preferences().showDeathChunks !== false && c.map.deathMarkers?.size ? [item('Estimated death chunk', 'death')] : []),
      ...(c.map.pins?.enabled?.size ? [item('Map icons', 'pin')] : []),
      ...(c.map.overlay === 'membership' ? [item('Members-only land', 'members'), item('Free-to-play boundary', 'members-edge'), item('Not walkable', 'border', '#96a5b4')] : []),
      c.activityLayers.controls('legend'), c.mapControls(),
      ...(c.map.travelLinesVisible !== false && typeof createTravelLinesKey === 'function' ? [(() => { const group = c.el('div', undefined, 'legend-travel'); group.append(c.el('span', 'Travel lines (selected chunk)', 'legend-travel-title'), createTravelLinesKey(document)); return group; })()] : []));
    if (focusedLayer) c.$(focusedLayer)?.focus?.();
  }

  Object.assign(c, { renderState, renderMapState, storedOverlay, setMembershipOverlay, renderLegend, mapControls });
}
