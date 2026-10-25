import { interiorCandidates, interiorPanel } from './interior-view.mjs';
import { bindStickerFlyout } from './sticker-picker.mjs';
import { createScreenChunkNotes } from './screen-chunk-notes.mjs';
import { createScreenChunkColours } from './chunk-colour-picker.mjs';
import { createChunkSections } from './chunk-sections.mjs';
import { CACHE_SECTION_OFFSET } from './data/surface-grid.mjs';
import { itemIcon } from './icons.mjs';
import { createChunkQuestList } from './chunk-quest-filters.mjs';
import { travelIntoChunk } from './teleports.mjs';

// Main-screen chunks; shared values and callbacks live in the explicit screen context.
export function createScreenChunks(c) {
  createScreenChunkNotes(c);
  createScreenChunkColours(c);
  function disposeAccessSections() { c.accessSections?.dispose(); c.accessSections = null; }

  function predictionActorScope() { return JSON.stringify([c.sessionMember, c.sessionAdmin, c.sessionReadOnly]); }

  function syncPredictionIntents() {
    const owner = c.member(), revision = c.state?.revision, actorScope = predictionActorScope();
    const wanted = new Set();
    if (owner && c.canWrite() && !c.sandbox.active) {
      // An offered choice remains actionable even when the partner owns it.
      for (const id of owner.pendingRoll) wanted.add(String(id));
      if (!c.$('chunk-info').hidden && c.chunkId && c.world.surface.has(String(c.chunkId)) && !owner.unlocked.includes(String(c.chunkId))) wanted.add(String(c.chunkId));
    }
    for (const [id, request] of c.predictionIntents) {
      if (!wanted.has(id) || request.memberId !== c.memberId || request.actorScope !== actorScope || !c.compatibleTaskRevision(request.revision, revision)) {
        request.controller.abort(); c.predictionIntents.delete(id);
      } else request.revision = revision;
    }
    for (const id of wanted) {
      if (c.predictionIntents.has(id) || !c.world.surface.has(id) || owner.unlocked.includes(id)) continue;
      const controller = new AbortController(), request = { memberId: c.memberId, revision, actorScope, controller };
      c.predictionIntents.set(id, request);
      // Preparation acknowledges only; it never publishes hypothetical tasks or
      // changes the saved map. Abandoned, stale and failed intents stay quiet.
      request.promise = (async () => {
        let prepared = false;
        try {
          // Startup and save adoption can expose offers before the next task-load
          // turn. Register and settle the current list before admitting speculation.
          const current = () => {
            const currentOwner = c.member();
            return !controller.signal.aborted && c.predictionIntents.get(id) === request && c.canWrite() && !c.sandbox.active
              && c.memberId === request.memberId && predictionActorScope() === request.actorScope && c.compatibleTaskRevision(request.revision)
              && currentOwner && !currentOwner.unlocked.includes(id) && (currentOwner.pendingRoll.includes(id)
                || !c.$('chunk-info').hidden && String(c.chunkId) === id);
          };
          while (current()) {
            const waitingRevision = c.state.revision;
            try { await c.ensureForegroundSettled(); }
            catch (error) {
              // An unchanged save can supersede the foreground wait while this
              // exact preparation is still wanted. Reacquire only on that proof.
              if (current() && waitingRevision !== c.state.revision && c.compatibleTaskRevision(waitingRevision)) continue;
              throw error;
            }
            if (!current()) return;
            if (waitingRevision !== c.state.revision) {
              if (c.compatibleTaskRevision(waitingRevision)) continue;
              return;
            }
            request.revision = c.state.revision;
            break;
          }
          if (!current()) return;
          const value = await c.api('/api/prediction-intent', { memberId: request.memberId, chunkId: id, revision: request.revision }, controller.signal);
          prepared = true;
          return value;
        } finally {
          // A later settled task paint or explicit sync may retry. Failure itself
          // never schedules another request, and cannot delete a replacement.
          if (!prepared && c.predictionIntents.get(id) === request) c.predictionIntents.delete(id);
        }
      })().catch(() => {});
    }
  }

  function chunkSignature(id) {
    const status = owner => ['unlocked', 'selected', 'pendingRoll', 'blacklisted'].map(key => owner[key]?.includes(id) ? 1 : 0).join('');
    return JSON.stringify([c.memberId, c.$('group-view').checked, c.state.members.map(owner => [owner.id, owner.name, status(owner), owner.notes?.[id] ?? null, owner.stickers?.[id] ?? null, [Object.hasOwn(owner.chunkColours ?? {}, id), owner.chunkColours?.[id]], owner.chunkColourNames,
      owner.areaOverrides?.[id] ?? null, Object.entries(owner.sectionOverrides ?? {}).filter(([key]) => key.split('-')[0] === String(id))]),
      c.pool.eligible.some(item => item.id === id), c.pool.excluded.some(item => item.id === id), c.result ? c.result.access?.areas?.includes(id) : null,
      c.result ? c.result.bossGates?.map(gate => `${gate.id}:${gate.open ? gate.openedBy : gate.reason}`).join() : null, c.state.rules, c.preferences().advanced,
      // Preview follows gameplay; location evidence still follows the exact save.
      ['unlock', 'challenges', 'clues', 'tasks'].includes(c.chunkTab ?? c.defaultChunkTab())
        ? [(c.chunkTab ?? c.defaultChunkTab()) === 'unlock' ? c.canonicalTaskRevision() : c.state.revision, c.sandbox.signature(), predictionActorScope()] : null]);
  }

  function showChunk(id) {
    c.chunkId = id; c.shownChunkSignature = c.chunkSignature(id); const indexed = c.world.chunks.get(id) ?? c.world.areas.get(id), record = c.world.resourceContents?.get(id) ?? c.definitions.chunks[id]
      ?? (indexed?.terrainOnly ? { Nickname: indexed.name } : undefined); if (!record || !indexed) { c.syncPredictionIntents(); return; }
    c.map?.setConnectionChunk?.(id);
    c.$('chunk-info').hidden = false; c.$('chunk-title').textContent = c.advanced() && !c.world.areas.has(id) ? `${id} · ${c.plain(indexed.name)}` : c.plain(indexed.name);
    c.usage?.panelOpened('chunk-info');
    c.syncPredictionIntents();
    const content = c.$('chunk-content'); content.replaceChildren();
    const area = c.world.areas.has(id);
    const summary = chunkSummary(id, indexed, record); content.append(summary);
    c.$('chunk-tools').replaceChildren(...(c.supportsFeature?.('rsCatalogues') === false ? [] : [c.iconLink(c.wikiSearch(c.plain(indexed.name)), `Search the RuneScape Wiki for ${c.plain(indexed.name)}`, 'wiki')]));
    renderChunkTabs(id, record, area, c.member().unlocked.includes(id), content);
    c.shownChunkSummarySignature = c.chunkSignature(id);
  }

  // Saved status and actions have their own surface. Refreshing them never
  // replaces a focused note editor, its draft, or a running tab request.
  function chunkSummary(id, indexed, record) {
    const content = c.el('div', undefined, 'chunk-live-summary');
    const owned = c.state.members.filter(item => item.unlocked.includes(id)).map(item => item.name), area = c.world.areas.has(id);
    content.append(c.el('p', area ? c.result?.access.areas.includes(id) ? 'Accessible interior' : 'Interior not currently accessible' : owned.length ? `Unlocked by ${owned.join(' and ')}` : c.member().pendingRoll.includes(id) ? 'Pending roll choice' : c.member().selected.includes(id) ? 'In roll pool (added by hand)' : c.member().blacklisted.includes(id) ? 'Never roll' : 'Locked', 'chunk-status'));
    const facts = c.el('div', undefined, 'chunk-facts'), entry = [...c.pool.eligible, ...c.pool.excluded].find(item => item.id === id);
    const mine = c.member().unlocked.includes(id);
    if (!area && !mine) facts.append(c.el('p', c.member().pendingRoll.includes(id) ? `Offered in ${c.member().name}’s pending roll.` : c.pool.eligible.some(item => item.id === id) ? `Eligible for ${c.member().name}’s next roll.` : `Outside ${c.member().name}’s current roll pool.`, 'status-detail'));
    const connection = mine ? null : c.result?.partnerConnections?.byChunk?.[id];
    if (connection) {
      facts.append(c.el('p', connection.connected ? `Connected partner chunk · usable by ${c.member().name}` : `Partner chunk · no round trip for ${c.member().name}`, 'status-detail'));
      const travel = c.el('div', undefined, 'form-stack');
      if (connection.connected) travel.append(c.el('p', `Route there: ${connection.out}`, 'status-detail'), c.el('p', `Route back: ${connection.back}`, 'status-detail'));
      else travel.append(c.el('p', connection.reason, 'status-detail'));
      travel.append(c.el('p', 'Connected partner chunks provide resources and training. Their tasks still belong to the player who unlocked them.', 'status-detail'));
      facts.append(c.details('Partner connection', travel));
    }
    if (entry?.reasons.length && !mine) {
      const reasons = c.el('div', undefined, 'form-stack'); entry.reasons.forEach(reason => reasons.append(c.el('p', reason.ruleId === 'roll.selected' ? 'Added to the roll pool by hand.' : reason.ruleId === 'state.blacklisted' ? 'Set to never roll for this player.' : reason.detail, 'eligibility-reason')));
      facts.append(c.details('Why this roll status?', reasons));
    }
    if (!area && !mine && !c.member().pendingRoll.includes(id) && !c.pool.eligible.some(item => item.id === id)) facts.append(travelHere(id));
    // Places this chunk leads into that have no spot on the surface map (interiors, instances, other maps).
    // One chip per name; same-named records (floors of one dungeon) open together in Inside.
    const leadsTo = [...new Map(interiorCandidates(id, record, c.world).filter(place => place !== id).map(place => [c.plain((c.world.areas.get(place) ?? c.world.chunks.get(place))?.name ?? place), place])).values()];
    let leadsRow;
    if (leadsTo.length) {
      const row = leadsRow = c.el('div', undefined, 'leads-to'); row.append(c.el('span', 'Leads to', 'leads-to-label'));
      for (const place of leadsTo) row.append(c.button(c.plain((c.world.areas.get(place) ?? c.world.chunks.get(place))?.name ?? place), () => { c.chunkTab = 'interior'; c.showChunk(place); }, 'leads-to-place'));
      facts.append(row);
    }
    content.append(facts);
    const colours = c.chunkColours.summary(id); if (colours.children.length) content.append(colours);
    const actions = c.el('div', undefined, 'chunk-actions');
    for (const action of c.chunkStatusActions(id)) actions.append(c.button(action.label, action.run, action.primary ? 'primary-action' : undefined));
    if (c.canWrite() && c.world.surface.has(id)) { const sticker = c.button('', () => { const box = sticker.getBoundingClientRect(); c.stickerPicker.open(id, { x: box.left, y: box.bottom + 6 }); }, 'sticker-action'); sticker.append(c.icon('sticker'), document.createTextNode(' Sticker')); actions.append(sticker); }
    const colour = c.chunkColours.action(id); if (colour) actions.append(colour);
    if (actions.children.length) content.append(actions);
    if (leadsRow) leadsRow.hidden = c.chunkTab === 'interior';
    return content;
  }

  // Carpets and teleports that land in a chunk outside the pool, and what each still needs.
  // Shown only where a travel line touches the chunk; the route check runs when opened.
  function travelHere(id) {
    if (c.supportsFeature?.('rsCatalogues') === false || c.sandbox?.active
      || !c.map?.connectionsForChunk?.(id)?.some(edge => edge.kind && edge.kind !== 'walking')) return '';
    const box = c.el('div', undefined, 'form-stack'), node = c.details('Travel into this chunk', box);
    box.append(c.el('p', 'Open to see which routes land here and what each still needs.', 'status-detail'));
    node.addEventListener('toggle', () => {
      if (!node.open || node.dataset.loaded) return;
      node.dataset.loaded = 'true';
      const memberId = c.memberId, revision = c.state.revision;
      box.replaceChildren(c.el('p', 'Checking your routes…', 'status-detail'));
      c.api(`/api/teleports?member=${encodeURIComponent(memberId)}`).then(value => {
        if (value.memberId !== memberId || value.stateRevision !== revision) throw new Error('The saved map changed. Close and reopen this section.');
        const routes = travelIntoChunk(value.rows ?? [], id);
        box.replaceChildren(...routes.flatMap(group => [c.el('p', `${group.available ? 'Usable' : 'Not usable'}: ${group.reasons.join(' ')}`, 'eligibility-reason'),
          c.el('p', group.names.map(name => c.plain(name)).join(' · '), 'status-detail')]));
        if (!routes.length) box.append(c.el('p', 'None of your travel routes lands in this chunk. The lines show routes from the chunks around it.', 'status-detail'));
        box.append(c.button('Open Teleports', () => c.teleportsDialog()));
      }).catch(error => { delete node.dataset.loaded; box.replaceChildren(c.el('p', error.message || String(error), 'error')); });
    });
    return node;
  }

  function refreshChunkSummary() {
    const id = c.chunkId, old = c.$('chunk-content').querySelector('.chunk-live-summary');
    if (!old || c.$('chunk-info').hidden) return;
    const signature = c.chunkSignature(id);
    if (signature === c.shownChunkSummarySignature) return;
    c.shownChunkSummarySignature = signature;
    const indexed = c.world.chunks.get(id) ?? c.world.areas.get(id), record = c.world.resourceContents?.get(id) ?? c.definitions.chunks[id] ?? {};
    const focused = old.contains(document.activeElement), label = focused ? document.activeElement.textContent : null;
    const next = chunkSummary(id, indexed, record); old.replaceWith(next);
    const inverse = { 'Add to roll pool': 'Remove from roll pool', 'Remove from roll pool': 'Add to roll pool', 'Unlock': 'Lock chunk', 'Never roll': 'Allow in roll pool' };
    if (focused) ([...next.querySelectorAll('button')].find(node => node.textContent === (inverse[label] ?? label)) ?? next.querySelector('.chunk-actions')?.querySelector('button'))?.focus();
  }

  function renderChunkTabs(id, record, area, mine, content) {
    // One panel, a row of tabs: the old stack of collapsible sections made every visit a hunt.
    let planningSections;
    const planningSection = index => (planningSections ??= [...c.chunkPlanning.render(id).children])[index];
    const hasNote = c.state.members.some(owner => owner.notes?.[id]?.trim()), topology = c.world.sectionTopology.get(id);
    const tabs = [
      { id: 'contents', label: 'Contents', render: () => c.chunkContents(record, undefined, true) },
      ...(c.canWrite() && c.supportsFeature?.('training') !== false ? [{ id: 'tasks', label: 'Tasks', render: () => planningSection(1) }, { id: 'clues', label: 'Clues', render: () => planningSection(0) }] : []),
      ...(c.canWrite() && c.world.surface.has(id) && !mine ? [{ id: 'unlock', label: 'Preview', render: () => c.unlockPreview(id) }] : []),
      ...(c.world.chunks.has(id) ? [{ id: 'note', label: hasNote || c.chunkDrafts.has(`${c.memberId}:${id}`) ? 'Note ●' : 'Note', accessibleLabel: hasNote ? 'Note (saved note)' : c.chunkDrafts.has(`${c.memberId}:${id}`) ? 'Note (unsaved draft)' : 'Note', render: () => c.chunkNote(id) }] : []),
      ...(interiorCandidates(id, record, c.world).length ? [{ id: 'interior', label: 'Inside', render: () => interiorPanel({ el: c.el, button: c.button, api: c.api, world: c.world }, interiorCandidates(id, record, c.world)) }] : []),
      ...(area || topology ? [{ id: 'access', label: 'Access', render: () => c.chunkAccess(id, topology) }] : []),
    ];
    // The Inside tab lists the same places as its map picker, so hide the duplicate row there.
    content.append(c.tabStrip(tabs, c.chunkTab ?? c.defaultChunkTab(), tab => { c.chunkTab = tab; const row = content.querySelector('.leads-to'); if (row) row.hidden = tab === 'interior'; }));
  }

  function closeChunkMenu() {
    c.stickerFlyout?.destroy(); c.stickerFlyout = null;
    const menu = c.$('map-menu');
    if (menu && !menu.hidden) {
      const restore = typeof document !== 'undefined' && menu.contains(document.activeElement);
      menu.hidden = true; menu.replaceChildren();
      if (restore) {
        const target = c.chunkMenuReturnFocus;
        (target && target !== document.body && target.isConnected !== false ? target : c.$('map-hover'))?.focus();
      }
      c.chunkMenuReturnFocus = null;
    }
  }

  function chunkMenu(id, x, y, pointerType) {
    const indexed = c.world.chunks.get(id); if (!indexed) return;
    c.closeChunkMenu();
    const menu = c.$('map-menu'), item = (label, run, cls) => { const node = c.button(label, () => { c.closeChunkMenu(); return run(); }, cls); node.setAttribute('role', 'menuitem'); return node; };
    const name = c.plain(indexed.name), surface = c.world.surface.has(id), mine = c.member().unlocked.includes(id);
    const wiki = c.el('a', 'Search the Wiki', 'map-menu-link'); wiki.href = c.wikiSearch(name); wiki.target = '_blank'; wiki.rel = 'noopener noreferrer'; wiki.setAttribute('role', 'menuitem'); wiki.addEventListener('click', c.closeChunkMenu);
    const stickers = c.canWrite() && surface ? c.el('button', 'Sticker ▸', 'sticker-action') : null;
    if (stickers) stickers.type = 'button';
    menu.replaceChildren(c.el('p', c.advanced() ? `${id} · ${name}` : name, 'map-menu-title'), item('Chunk details', () => c.showChunk(id)),
      ...c.chunkStatusActions(id).map(action => {
        const node = item(action.label, action.run, action.primary ? 'is-primary' : undefined);
        if (action.poolToggle && pointerType !== 'touch' && !globalThis.matchMedia?.('(hover: none)').matches) node.append(c.el('small', 'Ctrl/Cmd-click', 'roll-pool-shortcut'));
        return node;
      }),
      ...(c.canWrite() && surface && !mine ? [item('Preview unlock', () => { c.chunkTab = 'unlock'; c.showChunk(id); })] : []),
      ...(stickers ? [stickers] : []), ...[c.chunkColours.action(id)].filter(Boolean), wiki);
    menu.querySelector('.chunk-colour-action')?.setAttribute('role', 'menuitem');
    const box = c.$('map-panel').getBoundingClientRect();
    c.$('map-tooltip').hidden = true; menu.hidden = false;
    const width = menu.offsetWidth || 220, height = menu.offsetHeight || 260;
    menu.style.left = `${Math.max(8, Math.min(x - box.left, box.width - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y - box.top, box.height - height - 8))}px`;
    if (stickers) c.stickerFlyout = bindStickerFlyout({ picker: c.stickerPicker, trigger: stickers, menu, chunkId: id, closeMenu: c.closeChunkMenu });
    c.chunkMenuReturnFocus = typeof document !== 'undefined' ? document.activeElement : null;
    menu.querySelector('button')?.focus();
  }

  function tabStrip(tabs, active, onChange) {
    // Terrain-only chunks can have cache components without retained sections.
    // Add their display tab here so the chunk-detail renderer keeps its own seam.
    if (!tabs.some(tab => tab.id === 'access') && c.world.cacheWalking?.topology.has(c.chunkId)) {
      const id = c.chunkId;
      tabs = [...tabs, { id: 'access', label: 'Access', render: () => c.chunkAccess(id, new Map()) }];
    }
    const wrap = c.el('div', undefined, 'chunk-tabs'), bar = c.el('div', undefined, 'tab-bar'), panel = c.el('div', undefined, 'tab-panel');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Chunk information');
    const prefix = `chunk-tabs-${c.chunkTabSequence = (c.chunkTabSequence ?? 0) + 1}`;
    panel.id = `${prefix}-panel`; panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
    const show = tab => {
      c.disposeAccessSections();
      c.disposeChunkNotes();
      for (const node of bar.children) {
        const selected = node.dataset.tab === tab.id;
        node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1;
        if (selected) panel.setAttribute('aria-labelledby', node.id);
      }
      const view = tab.render(); panel.replaceChildren(view);
      // Derived sections load when opened, so opening them inside the tab starts their fetch.
      if (view.tagName === 'DETAILS') view.open = true;
      onChange(tab.id);
    };
    for (const [index, tab] of tabs.entries()) {
      const node = c.button(tab.label, () => show(tab), 'tab'); node.dataset.tab = tab.id;
      node.id = `${prefix}-${tab.id}`; node.setAttribute('role', 'tab'); node.setAttribute('aria-controls', panel.id);
      if (tab.accessibleLabel) node.setAttribute('aria-label', tab.accessibleLabel);
      node.addEventListener('keydown', event => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : offset ? (index + offset + tabs.length) % tabs.length : null;
        if (next === null) return;
        event.preventDefault(); show(tabs[next]); bar.children[next].focus();
      });
      bar.append(node);
    }
    wrap.append(bar, panel); show(tabs.find(tab => tab.id === active) ?? tabs[0]); return wrap;
  }

  function chunkStatusActions(id) {
    if (!c.canWrite()) return [];
    if (c.sandbox.active) return c.world.surface.has(id) ? [{ label: c.member().unlocked.includes(id) ? 'Lock in Sandbox' : 'Unlock in Sandbox', primary: true, run: () => c.sandbox.toggleChunk(id) }] : [];
    if (!c.world.surface.has(id) || c.member().pendingRoll.includes(id)) return [];
    const current = c.member().unlocked.includes(id) ? 'unlocked' : c.member().selected.includes(id) ? 'selected' : c.member().blacklisted.includes(id) ? 'blacklisted' : 'locked';
    return [['Unlock', 'unlocked'], ['Add to roll pool', 'selected'], ['Never roll', 'blacklisted'], [current === 'selected' ? 'Remove from roll pool' : current === 'blacklisted' ? 'Allow in roll pool' : 'Lock chunk', 'locked']]
      .filter(([, status]) => status !== current && !(current === 'unlocked' && status !== 'locked'))
      .map(([label, status]) => ({ label, poolToggle: status === 'selected' || current === 'selected' && status === 'locked', primary: status === 'unlocked', run: () => {
        // Button positions shift with the chunk's status, so removing an unlock needs an explicit yes.
        if (current === 'unlocked' && status === 'locked') {
          c.usage?.pageOpened('dialog:native-lock');
          if (!confirm(`Lock ${c.plain(c.world.chunks.get(id)?.name) || id} again? It will no longer be one of ${c.member().name}’s unlocked chunks.`)) return;
        }
        return c.command({ type: 'set-chunk', memberId: c.memberId, chunkId: id, status });
      } }));
  }

  function predictUnlock(id) {
    if (!c.canWrite()) return Promise.reject(new Error('This link is view only.'));
    if (c.sandbox.active) return c.sandbox.predictUnlock(id);
    const key = JSON.stringify([c.memberId, c.canonicalTaskRevision(), id, predictionActorScope()]);
    if (!c.predictions.has(key)) {
      if (c.predictions.size > 24) c.predictions.delete(c.predictions.keys().next().value);
      c.predictions.set(key, c.api(`/api/predict?memberId=${encodeURIComponent(c.memberId)}&chunkId=${id}`).catch(error => { c.predictions.delete(key); throw error; }));
    }
    return c.predictions.get(key);
  }

  function unlockPreview(id) {
    if (!c.canWrite()) return c.el('p', 'Unlock previews are available to players.');
    const box = c.el('div', undefined, 'form-stack'), outcome = c.el('div', undefined, 'unlock-preview'), requested = c.memberId, sandboxScope = c.sandbox.signature(), actorScope = predictionActorScope();
    outcome.append(c.el('p', 'Working out what this chunk would add…', 'status-detail'));
    box.append(outcome, ...(c.sandbox.active ? [] : [c.deathChunks.panel(id)]));
    c.predictUnlock(id).then(value => {
      if (!outcome.isConnected || c.chunkId !== id || c.memberId !== requested || c.sandbox.signature() !== sandboxScope || predictionActorScope() !== actorScope) return;
      if (value.memberId !== c.memberId || !c.compatibleTaskRevision(value.stateRevision)) { outcome.replaceChildren(c.el('p', 'The map changed while this was calculating.', 'status-detail'), c.button('Recalculate', () => outcome.parentElement?.replaceWith(c.unlockPreview(id)))); return; }
      const added = value.delta.tasksAdded, groups = new Map();
      for (const task of added) { if (!groups.has(task.category)) groups.set(task.category, []); groups.get(task.category).push(task); }
      outcome.replaceChildren(c.el('p', added.length ? `${added.length} new possible task${added.length === 1 ? '' : 's'}` : 'No new possible tasks', 'unlock-count'));
      for (const [category, tasks] of groups) outcome.append(c.el('h4', `${category} (${tasks.length})`, 'content-heading'), c.list(tasks.map(task => c.plain(task.label))));
      if (value.delta.itemsAdded?.length || value.delta.areasAdded?.length) { const additions = c.el('div'); if (value.delta.itemsAdded?.length) additions.append(c.el('h4', 'Items'), c.list(value.delta.itemsAdded.map(item => c.plain(typeof item === 'string' ? item : item.name ?? item.label)))); if (value.delta.areasAdded?.length) additions.append(c.el('h4', 'Areas'), c.list(value.delta.areasAdded.map(area => c.plain(c.world.areas.get(typeof area === 'string' ? area : area.id)?.name ?? (typeof area === 'string' ? area : area.name ?? area.label))))); if (c.advanced()) additions.append(c.jsonPreview({ items: value.delta.itemsAdded, areas: value.delta.areasAdded })); outcome.append(c.details('New items and areas', additions)); }
    }).catch(error => { if (outcome.isConnected) outcome.replaceChildren(c.el('p', error.message || String(error), 'error')); });
    return box;
  }

  function chunkAccess(id, topology) {
    const box = c.el('div', undefined, 'form-stack'), choices = [{ value: 'auto', label: 'Automatic' }, { value: 'true', label: 'Accessible' }, { value: 'false', label: 'Blocked' }];
    if (c.world.areas.has(id)) { const override = c.member().areaOverrides?.[id], control = c.select(choices, override === undefined ? 'auto' : String(override)); control.disabled = !c.canWrite(); control.addEventListener('change', () => c.command({ type: 'set-area', memberId: c.memberId, areaId: id, accessible: control.value === 'auto' ? null : control.value === 'true' }).catch(c.showError)); box.append(c.field('Area access override', control)); }
    if (topology) {
      const accessMember = c.memberId;
      c.accessSectionsMember = accessMember;
      c.accessSections = createChunkSections({ canWrite: c.canWrite, chunkId: id, topologyKeys: [...topology.keys()], overrides: c.member().sectionOverrides ?? {},
        load: () => c.api(`/api/chunk-sections?chunk=${encodeURIComponent(id)}`),
        onOverride: (sectionId, accessible) => c.command({ type: 'set-section', memberId: accessMember, sectionId, accessible }),
        onHighlight: section => c.map?.setSectionHighlight?.(id, section),
        drawTerrain: (context, size) => c.map?.drawChunkTerrain?.(context, id, size),
        subscribeTerrain: redraw => c.map?.subscribeChunkTerrain?.(id, redraw) ?? (() => {}),
      });
      box.append(c.accessSections.element);
    }
    return box;
  }

  function chunkContents(record, componentId, flat = false) {
    const container = c.el('div', undefined, 'chunk-content-list'), kinds = { Object: 'objects', NPC: 'npcs', Monster: 'monsters', Shop: 'shops', Spawn: 'spawns' };
    const preferred = { monsters: 'Monster', npcs: 'NPC', spawns: 'Spawn', shops: 'Shop', features: 'Object', quests: 'Quest', connections: 'Connect' }[c.preferences().defaultChunkinfo];
    for (const [key, value] of Object.entries(record)) {
      if (['Name', 'Nickname', 'ObjectProvenance'].includes(key)) continue;
      if (key === 'Sections') { for (const [section, contents] of Object.entries(value ?? {})) { const node = c.details(`Section ${section}`, c.chunkContents(contents, undefined, flat)); node.open = preferred && Object.hasOwn(contents, preferred); container.append(node); } continue; }
      if (key === 'CacheComponents') {
        for (const [id, contents] of Object.entries(value ?? {})) {
          const numeric = Number(id.split(/[-:]/).at(-1)), label = numeric >= CACHE_SECTION_OFFSET ? numeric - CACHE_SECTION_OFFSET : numeric;
          const node = c.details(`Walkable area ${label}`, c.chunkContents(contents, id, flat));
          node.title = 'Game-data walking geometry. Current access depends on your unlocked chunks, routes and restrictions.';
          node.open = preferred && Object.hasOwn(contents, preferred); container.append(node);
        }
        continue;
      }
      if (typeof value !== 'object' || value === null) { container.append(c.el('p', `${key}: ${value}`)); continue; }
      if (key === 'Quest' && Object.keys(value).length) {
        const quests = createChunkQuestList(c, Object.entries(value));
        if (flat) { const group = c.el('section', undefined, 'content-group'); group.append(c.el('h4', `Quest · ${Object.keys(value).length}`, 'content-heading'), quests); container.append(group); }
        else { const group = c.details(`Quest (${Object.keys(value).length})`, quests); group.open = key === preferred; container.append(group); }
        continue;
      }
      const rows = c.el('div', undefined, 'form-stack');
      for (const [name, count] of Object.entries(value)) {
        const displayName = key === 'Connect' ? c.plain((c.world.chunks.get(name) ?? c.world.areas.get(name))?.name) || name : c.plain(name); const row = c.el('div', undefined, 'content-row'), title = c.el('span', `${displayName}${typeof count === 'number' ? ` × ${count}` : ''}`);
        const picture = key === 'Spawn' ? itemIcon(c.plain(name)) : null;
        if (picture) { const img = c.el('img', undefined, 'content-icon'); img.src = picture; img.alt = ''; img.width = img.height = 20; img.loading = 'lazy'; title.prepend(img); }
        const provenance = key === 'Object' ? record.ObjectProvenance?.[name] : undefined;
        // Label only resource classes the game data checks; benches, stalls and
        // other unclassified objects were never compared, so they stay unlabelled.
        if (c.advanced() && (provenance?.source === 'game-data' || (provenance?.source === 'retained-only' && provenance.classKey))) {
          const confirmed = provenance.source === 'game-data';
          const label = c.el('small', confirmed ? 'Game data' : 'Not in game data', `status-detail object-provenance ${confirmed ? 'is-confirmed' : 'is-unconfirmed'}`);
          label.title = confirmed ? 'Placement confirmed in the game files.' : 'Listed by the reference picker; the game files have no matching placement here.';
          title.append(label);
        }
        // The contents list includes placements beyond the player's current reach.
        // Only a current access calculation can distinguish those from unknown access.
        const components = provenance?.components ?? (componentId ? [componentId] : []);
        if (provenance?.cacheOnly === true && components.length && c.result?.memberId === c.memberId
          && c.result.stateRevision === c.state.revision && Array.isArray(c.result.access?.components)
          && components.some(id => c.result.access.bases?.includes(id.split('-')[0]))
          && !components.some(id => c.result.access.components.includes(id))) {
          const availability = c.el('small', 'Behind a door or inaccessible', 'status-detail object-provenance');
          availability.title = 'This resource is visible in the chunk contents, but its location is not currently reachable by this player.';
          title.append(availability);
        }
        // A boss gate is per player, so only this player's current result can say.
        const gate = key === 'Monster' && c.result?.memberId === c.memberId ? c.result.bossGates?.find(status => status.monsters.includes(name)) : undefined;
        if (gate && !gate.open) {
          const locked = c.el('small', 'Boss locked', 'status-detail object-provenance');
          locked.title = gate.reason;
          title.append(locked);
        }
        row.append(title);
        if (gate && c.canWrite() && (!gate.open || gate.openedBy === 'manual')) {
          const toggle = c.button(gate.open ? 'Relock boss' : 'Unlock now', async () => {
            await c.command({ type: 'set-boss-unlock', memberId: c.memberId, gate: gate.id, unlocked: !gate.open });
          });
          toggle.dataset.bossGate = gate.id;
          row.append(toggle);
        }
        if (kinds[key] && c.canWrite()) { const kind = kinds[key], blocked = c.member().sourceBacklogs?.[kind]?.[name] ?? !!c.result?.access?.backloggedSources?.[kind]?.[name]; row.append(c.button(blocked ? 'Use source' : 'Backlog source', async () => { await c.command({ type: 'set-source-backlog', memberId: c.memberId, kind, name, backlogged: !blocked }); })); }
        else if (key === 'Connect' && (c.world.chunks.has(name) || c.world.areas.has(name))) row.append(c.button('View', () => { c.map.centerOnChunk(name); c.showChunk(name); }));
        rows.append(row);
      }
      if (rows.children.length) {
        if (flat) { const group = c.el('section', undefined, 'content-group'); group.append(c.el('h4', `${key} · ${rows.children.length}`, 'content-heading'), rows); container.append(group); }
        else { const group = c.details(`${key} (${rows.children.length})`, rows); group.open = key === preferred; container.append(group); }
      }
    }
    if (!container.children.length) container.append(c.el('p', 'Nothing is recorded in this chunk.', 'status-detail'));
    return container;
  }

  // Gate states arrive with the task result, after the command that changed
  // them. Redraw then, even from the gate button itself, and keep its focus.
  function refreshBossGates() {
    if (!c.chunkId || c.$('chunk-info').hidden || c.chunkSignature(c.chunkId) === c.shownChunkSignature) return;
    const content = c.$('chunk-content'), focused = content.contains(document.activeElement) ? document.activeElement : undefined;
    if (focused && !focused.dataset?.bossGate) return;
    c.showChunk(c.chunkId);
    if (focused) content.querySelector(`[data-boss-gate="${focused.dataset.bossGate}"]`)?.focus();
  }

  Object.assign(c, { refreshBossGates, disposeAccessSections, syncPredictionIntents, chunkSignature, showChunk, refreshChunkSummary, closeChunkMenu, chunkMenu, tabStrip, chunkStatusActions, predictUnlock, unlockPreview, chunkAccess, chunkContents });

  c.$?.('map-menu')?.addEventListener('keydown', event => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const menu = c.$('map-menu'), items = [...menu.querySelectorAll('[role="menuitem"]')].filter(node => !node.disabled && !node.hidden);
    if (!items.length) return;
    const index = items.indexOf(typeof document !== 'undefined' ? document.activeElement : event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
    event.preventDefault(); items[next].focus();
  });

  c.dockPanels = ['chunk-info', 'map-pins-panel'];

  c.dockObserver = typeof MutationObserver !== 'function' ? null : new MutationObserver(records => {
    for (const { target } of records) if (!target.hidden) for (const id of c.dockPanels) if (id !== target.id && !c.$(id).hidden) { if (id === 'chunk-info') c.$('chunk-close').click(); else c.$(id).querySelector('.close-button')?.click(); }
    c.syncPredictionIntents();
  });

  c.defaultChunkTab = () => ({ clues: 'clues', challenges: 'tasks' })[c.preferences().defaultChunkinfo] ?? 'contents';
}
