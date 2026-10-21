import { chunkNotesForSearch, matchingSearchChunks, searchNoteExcerpt, sortSearchSources, searchLocations, searchPage } from './screen-search-data.mjs';
import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';
import { taskIcon } from './browser-task-icons.mjs';
import { loadIcons, itemIcon, skillIcon } from './icons.mjs';
import { createTaskIconPainter } from './task-icon-painter.mjs';

export function createSearchDialog(c) {
  let dispose;
  const clear = () => { dispose?.(); dispose = undefined; };

  function open() {
    c.questMap?.clear();
    const search = c.input('search');
    const mode = c.select(c.sandbox.active ? ['Chunks', 'Tasks'] : ['Chunks', 'Tasks',
      ...(c.supportsFeature?.('quests') === false ? [] : ['Quests']),
      ...(c.supportsFeature?.('rsCatalogues') === false ? [] : ['Items & drops']),
      ...(c.supportsFeature?.('equipment') === false ? [] : ['Equipment']),
      ...(c.supportsFeature?.('training') === false ? [] : ['Training methods'])], 'Chunks');
    const results = c.el('div', undefined, 'search-results');
    const rows = c.el('div'), count = c.el('p', '', 'status-detail');
    count.setAttribute('role', 'status');
    const paging = c.el('div', undefined, 'search-paging');
    const highlight = c.input('checkbox'); highlight.checked = true;
    const highlightLabel = c.el('label', undefined, 'search-highlight-toggle');
    highlightLabel.append(highlight, c.el('span', 'Highlight matches on map'));
    const mapCount = c.el('small', '', 'search-map-count');
    search.placeholder = c.sandbox.active ? 'Name, chunk ID, note or task…' : 'Name, chunk ID, note, item or task…';
    const revision = c.state.revision, requestedMember = c.memberId;
    const notes = chunkNotesForSearch(c.state.members);
    let requestId = 0, timer, closed = false, entries = [], page = 0, matchIds = [], query = '', requestedMode = 'Chunks';
    const iconPainter = createTaskIconPainter({ resolveIcon: task => taskIcon(task, { itemIcon, skillIcon }),
      createImage: () => c.el('img'), refreshOnSettle: true });
    void loadIcons().then(loaded => iconPainter.settle(loaded));
    let taskLocations, taskLocationRequest, needsTaskLocations = false, taskLocationStatus = '';
    const scopeCurrent = () => !closed && revision === c.state.revision && requestedMember === c.memberId && c.dialogCurrent(generation);
    const current = () => scopeCurrent() && mode.value === requestedMode && search.value.toLowerCase().trim() === query;
    const setMatches = () => {
      const ids = current() && highlight.checked && query ? matchIds : [];
      c.map?.setSearchMatches?.(ids);
      const surfaces = new Set(ids.map(id => id.split('-')[0]).filter(id => c.world.surface?.has(id) ?? c.world.chunks.has(id)));
      mapCount.textContent = current() && highlight.checked && query && taskLocationStatus ? taskLocationStatus : surfaces.size ? `${surfaces.size.toLocaleString()} ${surfaces.size === 1 ? 'chunk' : 'chunks'} highlighted in pink` : query ? 'No chunks highlighted' : 'Type to highlight matching chunks';
    };
    const openChunk = (id, matchedNotes, query) => {
      c.chunkNoteReveal = matchedNotes?.length ? { chunkId: id, memberIds: matchedNotes.map(note => note.memberId), query } : undefined;
      if (c.chunkNoteReveal) c.chunkTab = 'note';
      c.closeDialog(generation); c.map.centerOnChunk(id); c.showChunk(id);
    };

    async function enrichTaskMatches(request, targetEntries) {
      const ready = () => current() && request === requestId && ['Tasks', 'Quests'].includes(requestedMode) && highlight.checked && query;
      if (!ready() || !needsTaskLocations || !targetEntries.length) return;
      taskLocationStatus = 'Finding matching task locations…'; setMatches();
      try {
        if (!taskLocations && !taskLocationRequest) {
          taskLocationRequest = c.ensureFullResult().then(value => {
            const locations = new Map((value.tasks ?? []).map(task => [task.id, searchLocations(task)]));
            if (scopeCurrent()) taskLocations = locations;
            return locations;
          }).finally(() => { taskLocationRequest = undefined; });
        }
        const locations = taskLocations ?? await taskLocationRequest;
        if (!ready()) return;
        for (const entry of targetEntries) entry.locations = locations.get(entry.taskId) ?? [];
        matchIds = [...new Set(targetEntries.flatMap(entry => entry.locations))];
        taskLocationStatus = ''; setMatches();
      } catch {
        if (ready()) { taskLocationStatus = 'Task map locations are unavailable. Try the highlight switch again.'; setMatches(); }
      }
    }

    function paintPage() {
      if (!current()) return;
      const entryRequest = requestId;
      const value = searchPage(entries, page); page = value.page;
      count.textContent = `${entries.length.toLocaleString()} ${entries.length === 1 ? 'result' : 'results'}${value.pages > 1 ? ` · ${value.first.toLocaleString()}–${value.last.toLocaleString()}` : ''}`;
      rows.replaceChildren();
      for (const entry of value.entries) {
        const row = c.el('div', undefined, 'search-result'), text = c.el('div', undefined, 'search-result-copy');
        const title = c.el('span', undefined, 'search-result-title');
        if (entry.task || entry.item) iconPainter.append(title, entry.task ?? { item: entry.item });
        title.append(c.el('span', entry.label));
        text.append(title, c.el('small', entry.subtitle));
        for (const note of entry.notes ?? []) text.append(c.el('small', `${note.name}’s note: ${searchNoteExcerpt(note.text, query)}`, 'search-note'));
        row.append(text, c.button('View', () => {
          if (!current() || entryRequest !== requestId) throw new Error('Saved state or search changed. Search again before opening this result.');
          return entry.action();
        }));
        rows.append(row);
      }
      paging.replaceChildren();
      if (value.pages > 1) {
        const move = (nextPage, direction) => {
          if (!current() || entryRequest !== requestId) return;
          page = nextPage; paintPage(); results.scrollTop = 0;
          const buttons = [...paging.children].filter(node => node.tagName === 'BUTTON');
          (buttons[direction]?.disabled ? buttons[1 - direction] : buttons[direction])?.focus();
        };
        const previous = c.button('Previous', () => move(page - 1, 0)), next = c.button('Next', () => move(page + 1, 1));
        previous.disabled = page === 0; next.disabled = page === value.pages - 1;
        paging.append(previous, c.el('span', `Page ${page + 1} of ${value.pages}`), next);
      }
      if (!entries.length) rows.append(c.el('p', 'No results. Try another name or note.', 'status-detail'));
    }

    async function render() {
      const request = ++requestId;
      query = search.value.toLowerCase().trim(); requestedMode = mode.value;
      needsTaskLocations = false; taskLocationStatus = '';
      const renderedQuery = query, renderedMode = requestedMode;
      const ready = () => current() && request === requestId && query === renderedQuery && requestedMode === renderedMode;
      results.setAttribute('aria-busy', 'true');
      try {
        let sourceResult = c.result;
        if (!results.children.length) results.append(c.el('p', 'Loading search…', 'status-detail'));
        if (['Items & drops', 'Equipment', 'Training methods'].includes(renderedMode) || !c.sandbox.active && renderedMode === 'Quests') sourceResult = await c.ensureFullResult();
        if (renderedMode === 'Chunks') await c.ensureChunkSearch();
        if (!ready()) return;
        if (renderedMode === 'Chunks') {
          entries = matchingSearchChunks(c.chunkSearch, notes, query, c.world.areas).map(({ id, name }) => {
            const owners = c.state.members.filter(owner => owner.unlocked.includes(id)).map(owner => owner.name);
            const matchedNotes = renderedQuery ? (notes.get(id) ?? []).filter(note => note.search.includes(renderedQuery)) : [];
            return { label: c.advanced() && !c.world.areas.has(id) ? `${id} · ${name}` : name,
              subtitle: c.world.areas.has(id) ? 'Interior or connected area' : `Surface chunk · ${owners.length ? `Unlocked by ${owners.join(' and ')}` : c.member().selected.includes(id) ? 'In roll pool (added by hand)' : c.member().blacklisted?.includes(id) ? 'Never roll' : c.pool?.eligible?.some(item => item.id === id) ? 'In roll pool' : 'Locked'}`,
              locations: [id], notes: notes.get(id) ?? [], action: () => openChunk(id, matchedNotes, renderedQuery) };
          });
        } else if (['Tasks', 'Quests'].includes(renderedMode)) {
          needsTaskLocations = sourceResult?.format === 'play-v1';
          // Quests mode loads Activity Info so quest filters apply; Tasks keeps the compact result.
          const filtered = renderedMode === 'Quests' && !c.sandbox.active;
          const quests = new Map((sourceResult?.activityInfo?.quests ?? []).flatMap(group => group.tasks.map(task => [task.id, task])));
          const rows = (sourceResult?.tasks ?? []).map(task => ({ ...task, ...(sourceResult?.activityInfo?.questStates?.[task.id] ?? quests.get(task.id)) }))
            .filter(task => renderedMode !== 'Quests' || task.category === 'Quest')
            .filter(task => !filtered || selectActivityRows([task], questFilters.preferences()).length);
          entries = (!filtered ? rows : selectActivityRows(rows, { sort: questFilters.preferences().sort })).filter(task => !query || `${task.label} ${task.category}`.toLowerCase().includes(query))
            .map(task => ({ task, taskId: task.id, label: task.label, subtitle: `${task.category} · ${task.status}`, locations: searchLocations(task), action: () => c.showTask(task) }));
        } else if (renderedMode === 'Training methods') {
          entries = Object.entries(sourceResult?.training ?? {}).filter(([skill]) => !query || skill.toLowerCase().includes(query))
            .map(([skill, value]) => ({ label: skill, subtitle: `Can train to level ${value.level} · Main method ${value.primary ? 'available' : 'unavailable'}`,
              locations: (sourceResult.tasks ?? []).filter(task => task.category === skill && task.status === 'available').flatMap(searchLocations),
              action: () => { c.$('task-filter').value = skill; c.renderTasks(); c.closeDialog(generation); } }));
        } else {
          entries = (renderedMode === 'Equipment' ? sourceResult?.equipment ?? [] : sourceResult?.items ?? [])
            .filter(item => !query || item.name.toLowerCase().includes(query)).map(item => {
              return { item: item.name, label: item.name, subtitle: renderedMode === 'Equipment' ? `${item.slot} · ${item.class} · Tier ${item.tier}` : `${item.sources?.length ?? 0} ways to get it`,
                locations: searchLocations(item), action: () => c.showItem({ ...item, sources: sortSearchSources(item.sources) }, sourceResult) };
            });
        }
        // All matching locations, independent of the currently displayed page.
        matchIds = [...new Set(entries.flatMap(entry => entry.locations))];
        page = 0; results.replaceChildren(count, rows, paging); results.removeAttribute?.('aria-busy');
        paintPage(); setMatches();
        void enrichTaskMatches(request, entries);
      } catch (error) {
        if (ready()) { matchIds = []; setMatches(); results.removeAttribute?.('aria-busy'); results.replaceChildren(c.el('p', error.message, 'error'), c.button('Retry search', render)); }
      }
    }

    const invalidate = () => { requestId++; clearTimeout(timer); matchIds = []; taskLocationStatus = ''; c.map?.setSearchMatches?.([]); results.setAttribute('aria-busy', 'true'); count.textContent = 'Searching…'; };
    search.addEventListener('input', () => { invalidate(); timer = setTimeout(() => { if (scopeCurrent()) void render(); }, 120); });
    const questFilters = createActivityFilterControls(c, { tab: 'Quest search', quests: true, activity: false, onChange: () => { invalidate(); return render(); } });
    const showQuestFilters = () => { questFilters.element.hidden = c.sandbox.active || mode.value !== 'Quests'; };
    mode.addEventListener('change', () => { invalidate(); showQuestFilters(); return render(); });
    highlight.addEventListener('change', () => { setMatches(); void enrichTaskMatches(requestId, entries); });
    const generation = c.openDialog('Search', c.field('Search across your map', search), c.field('Search in', mode), questFilters.element, highlightLabel, mapCount, results);
    const escape = event => { if (event.key === 'Escape' && !closed && c.dialogCurrent(generation)) { event.preventDefault(); c.closeDialog(generation); } };
    globalThis.document?.addEventListener?.('keydown', escape);
    dispose = () => { closed = true; requestId++; clearTimeout(timer); globalThis.document?.removeEventListener?.('keydown', escape); c.map?.setSearchMatches?.([]); };
    showQuestFilters(); void render(); search.focus();
  }
  return { open, clear };
}
