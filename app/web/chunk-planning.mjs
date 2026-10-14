import { baseLocationId, buildChunkPlanningIndex, buildChunkPlanningIndexIncremental } from '../tasks/chunk-planning-index.mjs';
import { taskIcon } from './browser-task-icons.mjs';
export { baseLocationId, buildChunkPlanningIndex, buildChunkPlanningIndexIncremental };
const values = value => value == null ? [] : Array.isArray(value) ? value : [value];

let taskFilter = 'highest';
const SKILLS = new Set(['Agility', 'Archaeology', 'Attack', 'Constitution', 'Construction', 'Cooking', 'Crafting', 'Defence', 'Divination', 'Dungeoneering', 'Farming', 'Firemaking', 'Fishing', 'Fletching', 'Herblore', 'Hunter', 'Invention', 'Magic', 'Mining', 'Necromancy', 'Prayer', 'Ranged', 'Runecrafting', 'Slayer', 'Smithing', 'Strength', 'Summoning', 'Thieving', 'Woodcutting']);
export function createChunkPlanning(context) {
  const { el, button, details, list, showTask, ensureResult } = context;
  const indexes = new WeakMap();
  const plain = value => context.plain(String(value ?? ''));
  const note = (value, cls = 'info-meta') => el('p', plain(value), cls);
  const advanced = () => context.canWrite?.() !== false && context.preferences?.()?.advanced === true;
  const locationName = id => {
    const name = world()?.areas?.get(id)?.name ?? world()?.chunks?.get(baseLocationId(id))?.name;
    return name ? `${name}${/^\d+-\d+$/.test(id) ? ` · Section ${String(id).split('-').at(-1)}` : ''}` : id;
  };
  const defs = () => context.definitions?.() ?? context.getDefinitions?.() ?? {};
  const world = () => context.world?.();
  const indexFor = result => {
    // Preference saves only replace the result wrapper; its tasks stay identical.
    const source = result.tasks ?? result, definitions = defs(), currentWorld = world(), cached = indexes.get(source);
    if (cached?.definitions === definitions && cached.world === currentWorld) return cached.index;
    const index = buildChunkPlanningIndex(definitions, result, currentWorld);
    indexes.set(source, { definitions, world: currentWorld, index }); return index;
  };
  const indexForView = async (result, isCurrent) => {
    const source = result.tasks ?? result, definitions = defs(), currentWorld = world(), cached = indexes.get(source);
    if (cached?.definitions === definitions && cached.world === currentWorld) return cached.index;
    const index = await buildChunkPlanningIndexIncremental(definitions, result, currentWorld, isCurrent);
    if (!isCurrent()) throw new Error('The viewed chunk changed while loading location evidence.');
    indexes.set(source, { definitions, world: currentWorld, index }); return index;
  };
  function accessText(location, result, index) {
    const id = index.canonical(location), access = result.access ?? {};
    const accessible = /^\d+-\d+$/.test(id) ? values(access.sections).includes(id) : /^\d+$/.test(id) ? values(access.bases).includes(id) : values(access.areas).includes(id);
    return accessible ? 'Reachable with your current chunks' : 'Not confirmed reachable with your current chunks';
  }
  function paged(rows, renderRow, label) {
    const container = el('div', undefined, 'info-list'), search = el('input'), count = note(''), body = el('div');
    search.type = 'search'; search.placeholder = `Filter ${label}`; search.setAttribute('aria-label', `Filter ${label}`); count.setAttribute('aria-live', 'polite');
    let limit = 60;
    const more = button('Show more', () => { limit += 60; render(); }, 'wide-button');
    const render = () => {
      const query = search.value.trim().toLowerCase(), filtered = rows.filter(row => !query || `${row.task?.label ?? ''} ${row.task?.category ?? ''} ${row.tier ?? ''} ${row.location ?? ''} ${row.evidence?.map(value => `${value.location} ${value.reason}`).join(' ') ?? ''}`.toLowerCase().includes(query));
      body.replaceChildren(...filtered.slice(0, limit).map(renderRow)); count.textContent = `${Math.min(limit, filtered.length)} shown · ${filtered.length} matching · ${rows.length} total ${label}`;
      more.hidden = filtered.length <= limit; more.textContent = `Show 60 more (${Math.max(0, filtered.length - limit)} remaining)`;
      if (!filtered.length) body.append(note(query ? 'No matches. Try another filter.' : `No ${label} listed for this location.`, 'info-empty'));
    };
    search.addEventListener('input', () => { limit = 60; render(); }); container.append(search, count, body, more); render(); return container;
  }
  function render(chunkId) {
    const snapshot = { memberId: context.memberId(), revision: context.state().revision, chunkId: String(chunkId) }, container = el('div', undefined, 'chunk-content-list');
    const current = () => context.memberId() === snapshot.memberId && context.state().revision === snapshot.revision
      && context.state().members.some(member => member.id === snapshot.memberId) && String(context.selectedChunkId()) === snapshot.chunkId
      && context.isChunkOpen?.() !== false;
    const assertCurrent = () => { if (!current()) throw new Error('The player, save or viewed chunk changed. Reopen Chunk Info before viewing this task.'); };
    // Compact rows: what the task is and whether it is doable now; the full evidence lives in the task view.
    const taskView = (row, result, index) => {
      const task = row.task, node = button('', async () => {
        assertCurrent(); const generation = context.dialogGeneration?.(), wasOpen = context.isDialogOpen?.();
        const refreshed = await ensureResult(); assertCurrent();
        if (generation !== undefined && context.dialogGeneration?.() !== generation || wasOpen && context.isDialogOpen?.() === false) return;
        const latest = refreshed.tasks?.find(value => value.id === task.id);
        if (!latest) throw new Error('This task is no longer in your current task list. Refresh Chunk Info.');
        showTask(latest);
      }, `linked-task ${task.status === 'available' ? 'is-doable' : 'is-blocked'}`);
      const picture = taskIcon(task, context);
      if (picture) { const img = el('img', undefined, 'task-icon'); img.src = picture; img.alt = ''; img.width = img.height = 22; img.loading = 'lazy'; node.append(img); }
      const text = el('span', undefined, 'linked-task-text');
      text.append(el('span', plain(task.label), 'linked-task-label'), el('span', task.status === 'available' ? `${task.category} · doable now` : `${task.category} · ${plain(task.blockers?.[0]?.detail ?? task.status)}`, 'linked-task-meta'));
      node.append(text); node.setAttribute?.('aria-label', `${plain(task.label)}: ${task.status === 'available' ? 'doable now' : 'blocked'}. Open task details.`);
      return node;
    };
    // A predicted task is not in the current calculation yet, so it is shown, not opened.
    const predictedView = task => {
      const node = el('div', undefined, 'linked-task is-predicted');
      const picture = taskIcon(task, context);
      if (picture) { const img = el('img', undefined, 'task-icon'); img.src = picture; img.alt = ''; img.width = img.height = 22; img.loading = 'lazy'; node.append(img); }
      const text = el('span', undefined, 'linked-task-text');
      const level = Number.isFinite(Number(task.level)) && Number(task.level) > 1 ? ` · level ${task.level}` : '';
      text.append(el('span', plain(task.label), 'linked-task-label'), el('span', `${task.category}${level} · new if unlocked`, 'linked-task-meta'));
      node.append(text); return node;
    };
    function derivedSection(title, category, build) {
      const body = el('div', undefined, 'form-stack'), section = details(title, body); section.className = 'chunk-section'; let loaded = false, loading = false;
      const load = async () => {
        if (loaded || loading) return; loading = true; body.replaceChildren(note('Loading tasks for this chunk…'));
        try {
          const result = await (context.ensurePlanningResult ? context.ensurePlanningResult(snapshot.chunkId) : ensureResult());
          if (!current() || section.isConnected === false) return;
          if (result.stateRevision != null && result.stateRevision !== snapshot.revision) throw new Error('Your task list changed. Reopen Chunk Info to refresh this location.');
          const index = result.format === 'chunk-planning-v1'
            ? { canonical: String, byLocation: new Map([[snapshot.chunkId, new Map(result.rows.map(row => [row.task.id, row]))]]),
              clueLocations: new Map([[snapshot.chunkId, result.clueLocations]]) }
            : await indexForView(result, current);
          if (!current() || section.isConnected === false) return;
          body.replaceChildren(note('Tasks that use something in this chunk.'), build(result, index)); loaded = true;
        } catch (error) { if (current()) body.replaceChildren(note(error.message, 'error'), button('Retry chunk tasks', load)); }
        finally { loading = false; }
      };
      section.addEventListener('toggle', () => { if (section.open) void load(); });
      section.open = context.preferences?.().defaultChunkinfo === category; return section;
    }
    container.append(derivedSection('Clues', 'clues', (result, index) => {
      const node = el('div', undefined, 'form-stack'), declarations = index.clueLocations.get(snapshot.chunkId) ?? [], rows = [...(index.byLocation.get(snapshot.chunkId)?.values() ?? [])].filter(row => row.task.record?.ClueTier);
      node.append(note('The clue list shows locations recorded for this chunk. It does not check which clues you own or whether you can finish the whole scroll.'), el('h3', 'Clue locations'), paged(declarations, declaration => {
        const row = el('div', undefined, 'info-row'); row.append(el('strong', `${plain(declaration.tier)} · ${plain(locationName(declaration.location))}`), note(accessText(declaration.location, result, index)));
        if (advanced()) row.append(note(`Location ID: ${declaration.location} · Reference marker: ${typeof declaration.marker === 'boolean' ? String(declaration.marker) : 'unknown'}`));
        return row;
      }, 'clue locations'), el('h3', 'Clue steps'), paged(rows, row => taskView(row, result, index), 'clue steps')); return node;
    }), derivedSection('Possible Tasks', 'challenges', (result, index) => {
      const rows = [...(index.byLocation.get(snapshot.chunkId)?.values() ?? [])].sort((a, b) => Number(b.task.status === 'available') - Number(a.task.status === 'available'));
      // "Highest level": per skill, only the top doable task this chunk supports (a level-50
      // Woodcutting task makes the lower ones redundant); doable non-skill tasks stay as they are.
      const top = new Map();
      for (const row of rows) if (row.task.status === 'available' && SKILLS.has(row.task.category) && Number.isFinite(Number(row.task.level))) {
        const best = top.get(row.task.category);
        if (!best || Number(row.task.level) > Number(best.task.level)) top.set(row.task.category, row);
      }
      const highest = row => row.task.status === 'available' && (SKILLS.has(row.task.category) ? top.get(row.task.category) === row : true);
      const filters = [['highest', 'Highest level', highest], ['doable', 'Doable', row => row.task.status === 'available'],
        ['blocked', 'Blocked', row => row.task.status !== 'available'], ['all', 'All', () => true]];
      // "If unlocked": the new tasks this member would have to do after unlocking this chunk (shared Preview prediction).
      const unlockable = context.unlockable?.(snapshot.chunkId) === true && typeof context.predictUnlock === 'function';
      if (unlockable) filters.push(['unlock', 'If unlocked', null]);
      if (!unlockable && taskFilter === 'unlock') taskFilter = 'highest';
      const node = el('div', undefined, 'form-stack'), bar = el('div', undefined, 'task-filter-bar'), list = el('div'), chips = new Map();
      bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Which tasks to show');
      const show = key => {
        taskFilter = key;
        for (const [chip, id] of chips) chip.setAttribute('aria-pressed', String(id === key));
        if (key === 'unlock') { list.replaceChildren(unlockList()); return; }
        const shown = rows.filter(filters.find(([id]) => id === key)[2]);
        list.replaceChildren(shown.length ? paged(shown, row => taskView(row, result, index), 'tasks')
          : note(key === 'highest' ? 'Nothing doable uses this chunk yet. Try Blocked or All.' : 'No tasks in this view.'));
      };
      let unlockChip;
      for (const [key, label, test] of filters) { const chip = button(test ? `${label} ${rows.filter(test).length}` : label, () => show(key), `filter-chip${key === 'unlock' ? ' filter-chip-unlock' : ''}`); chips.set(chip, key); bar.append(chip); if (key === 'unlock') unlockChip = chip; }
      // Per skill, the highest new task covers the lower ones (as in Highest level); other new tasks all count.
      const splitNew = added => {
        const best = new Map(), ranked = task => SKILLS.has(task.category) && Number.isFinite(Number(task.level));
        for (const task of added) if (ranked(task)) { const top = best.get(task.category); if (!top || Number(task.level) > Number(top.level)) best.set(task.category, task); }
        const required = added.filter(task => !ranked(task) || best.get(task.category) === task);
        return { required, lower: added.filter(task => !required.includes(task)) };
      };
      function unlockList() {
        const box = el('div', undefined, 'form-stack');
        box.append(note('Working out what unlocking this chunk would add…'));
        context.predictUnlock(snapshot.chunkId).then(value => {
          if (!current() || box.isConnected === false) return;
          const added = value.delta?.tasksAdded ?? [], { required, lower } = splitNew(added);
          if (unlockChip) unlockChip.textContent = `If unlocked ${required.length}`;
          if (!added.length) { box.replaceChildren(note('Unlocking this chunk would not add any new tasks.')); return; }
          box.replaceChildren(note('New tasks if this chunk were unlocked.'), paged(required, predictedView, 'new tasks'));
          if (lower.length) box.append(details(`Lower-level tasks in the same skills (${lower.length})`, paged(lower, predictedView, 'lower tasks')));
        }).catch(error => { if (current()) box.replaceChildren(note(error.message || String(error), 'error')); });
        return box;
      }
      node.append(bar, list); show(taskFilter); return node;
    })); return container;
  }
  return { render, prime: indexFor };
}
