import { sourceRateText } from '../tasks/rates.mjs';
import { createRuneMetricsControls } from './runemetrics.mjs';
import { taskItemIcon } from './task-artwork.mjs';
import { taskIcon } from './browser-task-icons.mjs';
import { resolvePicture } from './art-status.mjs';
import { filteredActivityTab } from './activity-view.mjs';
import { readBiSPreferences, writeBiSPreferences } from './bis-preferences.mjs';
import { createEquipmentRecorder, createHandRecordActions } from './bis-recorded.mjs';
import { createBiSComparisonView } from './bis-comparison-view.mjs';

// Translate narrative explanations only. Item and activity names keep their spelling.
function plainInfoText(value) {
  let text = String(value ?? '');
  const phrases = [
    ['No declared weight metadata.', 'Item weights are unknown.'],
    ['The dataset does not identify item tradeability; access and challenge completion do not establish a transferable reward.', 'Tradeability is unknown. Being able to reach an item or finish a task does not mean you can give its reward to your partner.'],
    ['A personal obtain record exists, but the engine currently has no eligible source and equipability result for this item.', 'You marked this obtained, but a source and the requirements to equip it are not confirmed in your current chunks.'],
    ['Only explicit personal obtain-task records with current engine eligibility participate. Unrecorded ammunition, challenge-only checks and another member’s obtain records do not supply gear.', 'Only gear you marked obtained and can use in your chunks is compared. Mark ammunition obtained too. A shared task check or your partner’s gear does not mean you own it.'],
    ['Explicit personal obtain-task completion; current possession and equipped slot are unconfirmed.', 'You marked this obtained. Whether you still own or wear it is unknown.'],
    ['Personal obtain record added by hand; current possession and equipped slot are unconfirmed.', 'You recorded this as obtained. Whether you still own or wear it is unknown.'],
    ['No engine-confirmed reachable assignment method for this master.', 'No way to get an assignment from this Slayer master is known in your chunks yet.'],
    ['This assignment has no declared target-monster mapping.', 'The monsters for this assignment are unknown.'],
    ['Eligibility uses reachable training ceilings. Current combat/Slayer levels and the in-game assignment are not independently verified by manual declarations. Personal quest requirements are not satisfied by another member’s completion.', 'Possible assignments use the levels your chunks can support. Your current combat and Slayer levels and in-game assignment may differ. You must complete required quests yourself.'],
    ['Counts describe declared clue steps and locations. They do not predict complete-scroll success or prove possession of a clue.', 'Counts show known clue steps and locations. They do not mean you own a clue or can finish a whole scroll.'],
    ['ActivityInfo indexes engine-supported declarative records. Blocked and unsupported rows retain their reasons; display alternatives remain visible here.', 'This view shows known activities, including other options and reasons some are blocked or unknown.'],
    ['Reachable training and possible quest points are planning results, not current account statistics.', 'Possible levels and quest points show what your chunks support. Your account progress may differ.'],
    ['Engine-confirmed item sources and equipment eligibility.', 'Known sources and requirements to equip the item.'],
    ['Loadout ranking uses damage/accuracy tiers, compatible ammunition, and declared special/passive bonuses.', 'Weapon setups compare damage and accuracy tiers, compatible ammunition, special attacks and passive effects.'],
    ['Relic availability and prerequisites only. The dataset does not declare relic-energy budgets, simultaneous activation limits or an optimal relic combination.', 'Relics show availability and requirements. Energy costs, how many you can activate at once and the best combination are unknown.'],
    ['Weight comparisons require explicit weight metadata; coupled weight weapon layouts are not ranked.', 'Known item weights are compared. Combined weapon setups are not compared by weight yet.'],
    ['Skilling Set/Priority metadata supports tool comparisons; independent quality-of-life and relic goals have no universal numeric ranking.', 'Tools are compared within their skilling sets. Other useful items and relics are listed separately.'],
    ['Combat equipment set-effect simulation remains unsupported.', 'Combat set effects are not included in the comparison.'],
    ['Combat set bonuses and relic-energy combination optimization are not implemented. Skilling tools use explicit Set/Priority metadata; weight requires declared weights.', 'Combat set bonuses and the best relic combinations are not included. Tools are compared within skilling sets, and weight comparisons need known item weights.'],
    ['Magic spell/rune availability is inherited from engine eligibility; individual spell loadouts are not ranked.', 'Magic spells use reachable rune supplies and requirements. Individual spell setups are not compared.'],
    ['Explicit skilling-tool priorities and independent quality-of-life goals come from the reference task metadata, not combat tiers or guessed XP rates. The BIS Skilling rule controls active goals; this catalogue keeps comparisons visible.', 'Tools use known skilling comparisons. Other useful items are listed separately. The Best skilling gear rule controls which become tasks; you can compare tools here either way.'],
    ['Tank scores compare declared defence; weapon modes are coupled and ordinary slots use armour then life points.', 'Tank choices compare armour, then life points. Weapons and shields are compared together.'],
    ['Lower declared Priority wins within this explicit equipment Set; equal priorities remain alternatives.', 'Tools are compared within their set. Equally good choices stay listed.'],
    ['No complete declared priority ranking is available for this set.', 'Some tool comparisons in this set are unknown.'],
    ['No eligible item has a declared weight. Weight reduction is not inferred from names, tiers or armour.', 'Weights are unknown for the items you can use. Names, tiers and armour do not tell us their weight.'],
    ['The minimum declared weight wins per ordinary slot. Weapon-hand combinations require a separate compatible loadout.', 'The lightest item wins in each armour slot. Weapons must be compared in compatible setups.'],
    ['Declared permanent, ability and prayer unlock goals have distinct effects. They are listed with prerequisites rather than assigned a shared equipment score.', 'Permanent unlocks, abilities and prayers have different effects. Their requirements are shown separately.'],
    ['personal completion evidence', 'your own quest completion'],
    ['declared special/passive bonuses', 'known special attacks and passive effects'],
    ['Lower declared equipment weight wins.', 'Lighter equipment wins.'],
    ['Higher declared prayer bonus wins.', 'Higher Prayer bonus wins.'],
    ['personal obtain-record', 'obtained gear'],
    ['Personal obtain-record', 'Obtained gear'],
    ['personal obtain records', 'items you marked obtained'],
    ['personal obtain-task completion', 'marking the item obtained yourself'],
    ['Declared priority', 'Tool ranking'],
  ];
  for (const [before, after] of phrases) text = text.replaceAll(before, after);
  return text.replace(/Unresolved assignment metadata: [^.]+\./g, 'Some assignment requirements are unknown. Check them in-game.');
}

export function savedNote(state, payload) {
  const owner = state.members.find(member => member.id === payload.memberId);
  if (!owner) throw new Error('Unknown member. Reopen the note before saving.');
  return (payload.type === 'set-journal' ? owner.journal : payload.type === 'set-note' ? owner.notes?.[payload.chunkId] : owner.taskStatus?.[payload.taskId]?.note) ?? '';
}
export function reviewedNoteRevision(state, payload, revision, original) {
  if (original === undefined) return revision ?? state.revision;
  const remoteNote = savedNote(state, payload);
  if (remoteNote !== original) throw Object.assign(new Error('This note changed in another browser. Review the remote note before saving your draft.'), { noteConflict: true, remoteNote, revision: state.revision });
  return state.revision;
}
export function createNoteEditor(ctx, { label, saveLabel, payload, review, isCurrent, onChange, onSaved, maxLength }) {
  const { el, field, button } = ctx, content = el('div', undefined, 'form-stack'), note = el('textarea'), conflict = el('div', undefined, 'form-stack');
  if (maxLength !== undefined) note.maxLength = maxLength;
  if (ctx.canWrite?.() === false) { note.value = review.value; note.readOnly = true; content.append(field(label, note)); return content; }
  const clearConflict = () => { conflict.replaceChildren(); conflict.hidden = true; }; conflict.hidden = true;
  note.value = review.value; note.addEventListener('input', () => { review.value = note.value; onChange?.(); });
  const persist = async () => {
    if (!isCurrent()) return;
    const value = note.value; review.value = value; onChange?.(); save.disabled = true;
    try {
      const response = await ctx.command({ ...payload, note: value }, review.revision, review.original, isCurrent);
      review.original = value; review.revision = response?.state.revision ?? ctx.state().revision;
      onSaved?.(value);
      if (isCurrent()) clearConflict();
    } catch (error) {
      if (!isCurrent()) return;
      if (!error.noteConflict) { ctx.showError(error); return; }
      const acceptReview = () => { review.original = error.remoteNote; review.revision = error.revision; };
      const remote = el('textarea'); remote.value = error.remoteNote; remote.readOnly = true; remote.setAttribute('aria-label', 'Remote note');
      conflict.hidden = false;
      conflict.replaceChildren(el('p', 'This note changed in another browser. Your draft is kept above. Choose which version to use.', 'warning'), field('Remote note', remote), button('Use remote note', () => { if (!isCurrent()) return; acceptReview(); note.value = review.value = error.remoteNote; onChange?.(); onSaved?.(error.remoteNote); clearConflict(); }), button('Save my draft instead', () => { if (!isCurrent()) return; acceptReview(); return persist(); }));
    } finally { if (isCurrent()) save.disabled = false; }
  };
  const save = button(saveLabel, persist);
  content.append(field(label, note), save, conflict); return content;
}

// Read-only views over worker results. Personal facts, shared access and
// challenge completion are deliberately displayed as separate evidence.
export function createInfoPanels(context) {
  const { el, button, details, openDialog, showTask, ensureResult } = context;
  const advanced = () => context.advanced?.() ?? context.preferences?.()?.advanced === true;
  const list = rows => context.list(rows.map(plainInfoText));
  const locationName = value => {
    const id = String(value), world = context.world?.();
    const name = world?.chunks?.get(id)?.name ?? world?.chunks?.get(id.split('-')[0])?.name;
    return name ? `${text(name)}${advanced() ? ` · Chunk ${id}` : ''}` : text(value);
  };
  const text = value => context.plain(String(value ?? ''));
  const values = value => value == null ? [] : Array.isArray(value) ? value : [value];
  const snapshots = new WeakMap();
  const taskIndexes = new WeakMap();
  function taskIndex(result) {
    if (!taskIndexes.has(result)) taskIndexes.set(result, new Map((result.tasks ?? []).map(task => [task.id, task])));
    return taskIndexes.get(result);
  }
  const names = (ids, result) => values(ids).map(id => snapshots.get(result)?.memberNames[id] ?? id).join(', ');
  const beginRequest = () => ({ memberId: context.memberId(), generation: context.beginDialogRequest?.() ?? context.dialogGeneration?.(), wasOpen: context.isDialogOpen?.() });
  const requestCurrent = request => context.memberId() === request.memberId && context.state().members.some(member => member.id === request.memberId)
    && (request.generation === undefined || context.dialogGeneration?.() === request.generation)
    && (!request.wasOpen || context.isDialogOpen?.() !== false);
  async function requestedResult(request) {
    try { return await ensureResult(); }
    catch (error) { if (requestCurrent(request)) throw error; return undefined; }
  }
  function capture(result, request) {
    const state = context.state();
    const member = state.members.find(member => member.id === request.memberId);
    snapshots.set(result, { memberId: request.memberId, revision: result.stateRevision ?? state.revision,
      memberName: state.members.find(member => member.id === request.memberId)?.name ?? request.memberId,
      authoredPrimary: { ...member?.primaryOverrides },
      observedSkills: { ...member?.skillProgress },
      memberNames: Object.fromEntries(state.members.map(member => [member.id, member.name])) });
    return snapshots.get(result);
  }
  function assertSnapshot(snapshot) {
    if (!snapshot || context.memberId() !== snapshot.memberId || !context.state().members.some(member => member.id === snapshot.memberId)) throw new Error('The selected member changed or was removed. Refresh this panel before changing controls or opening a task.');
    if (context.state().revision !== snapshot.revision) throw new Error('Saved state changed after this panel was calculated. Refresh the panel before changing controls or opening a task.');
  }
  function snapshotControls(snapshot, refresh) {
    const node = el('div', undefined, 'info-toolbar snapshot-bar');
    node.append(paragraph(`${snapshot.memberName} · last checked result`, 'status-detail'), button('Refresh', refresh));
    return node;
  }
  function field(label, input) {
    const node = el('label', undefined, input.type === 'checkbox' ? 'checkbox-field' : 'form-field'); node.append(el('span', label), input); return node;
  }
  function numberInput(value = '') {
    const node = el('input'); node.type = 'number'; node.min = '1'; node.max = '120'; node.step = '1'; node.value = String(value);
    return node;
  }
  function levelValue(input) {
    if (!input.value.trim()) return null;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > 120) throw new Error('Enter a whole level from 1 to 120, or clear the field to inherit its saved default.');
    return value;
  }
  async function saveControls(result, payload, tab) {
    const snapshot = snapshots.get(result); assertSnapshot(snapshot);
    const request = beginRequest();
    await context.command({ ...payload, memberId: snapshot.memberId }, snapshot.revision);
    if (requestCurrent(request)) await activityInfo(tab);
  }
  function trainingControls(skill, result) {
    if (context.canWrite?.() === false) return empty('Manual training settings are available to players.');
    if (!context.command || !result.playerControls) return empty('Training assumptions will appear after a current calculation with saved player controls.');
    const controls = result.playerControls, snapshot = snapshots.get(result), node = el('div', undefined, 'form-stack');
    const primary = el('select');
    for (const [value, label] of [['', 'Use saved training assumption'], ['true', 'Assume a main training method is available'], ['false', 'Use reachable training methods only']]) {
      const option = el('option', label); option.value = value; primary.append(option);
    }
    primary.value = Object.hasOwn(snapshot.authoredPrimary, skill.skill) ? String(snapshot.authoredPrimary[skill.skill]) : '';
    const passive = numberInput(controls.passiveLevels?.[skill.skill] ?? ''), maximum = numberInput(controls.maxLevels?.[skill.skill] ?? '');
    passive.placeholder = 'Automatic'; maximum.placeholder = 'Automatic';
    node.append(paragraph(`These assumptions change the levels ${snapshot.memberName} could reach. Progress sync records actual account levels and XP separately. You can always use training methods already reachable in your chunks.`), paragraph(`Main training method assumed: ${controls.primaryOverrides?.[skill.skill] ? 'enabled' : 'disabled'}`), field('Assume a main training method', primary), button('Save training assumption', () => saveControls(result, { type: 'set-primary-override', skill: skill.skill, enabled: primary.value === '' ? null : primary.value === 'true' }, 'Skills')), field('Level possible without a main method (1–120)', passive), field('Training level limit (1–120)', maximum), paragraph('Clear a level to use its saved default. The first level allows progress without a main method; the limit sets the highest level to plan for.'), button('Save training levels', () => saveControls(result, { type: 'set-skill-levels', skill: skill.skill, passiveLevel: levelValue(passive), maxLevel: levelValue(maximum) }, 'Skills')));
    return node;
  }
  function slayerControls(view, result) {
    if (context.canWrite?.() === false) return empty('Slayer settings are available to players.');
    if (!context.command || !result.playerControls) return empty('Slayer locking controls will appear after a current calculation with saved player controls.');
    const node = el('div', undefined, 'form-stack'), controls = result.playerControls, lock = controls.slayerLock, enabled = el('input');
    enabled.type = 'checkbox'; enabled.checked = !!lock;
    const fields = el('div', undefined, 'form-stack'), level = numberInput(lock?.level ?? 1);
    const choose = (declared, saved, label) => {
      const input = el('select');
      for (const value of [...new Set(['None', 'Manually Locked', ...values(declared), ...(saved ? [saved] : [])])]) {
        const option = el('option', text(value)); option.value = value; input.append(option);
      }
      input.value = saved ?? 'None'; fields.append(field(label, input)); return input;
    };
    fields.append(field('Manually reported Slayer level (1–120)', level));
    const monster = choose(view.lockOptions?.monsters, lock?.monster, 'Locked Slayer task'), boss = choose(view.lockOptions?.bosses, lock?.boss, 'Locked Reaper task');
    fields.hidden = !enabled.checked; enabled.addEventListener('change', () => { fields.hidden = !enabled.checked; });
    const release = view.lockRelease ?? result.slayerLockRelease;
    node.append(el('h3', 'Personal Slayer locking'), paragraph('If you’re assigned a Slayer or Reaper task you can’t do in your chunks, record it here with your current Slayer level. Saving with the box unticked clears it.'), paragraph(lock ? `Slayer lock: on (Slayer ${lock.level})${release ? ' · released for planning, see below' : ''}` : 'Slayer lock: off', 'info-progress'), field(`Slayer locked for ${snapshots.get(result).memberName}`, enabled), fields);
    if (release) {
      const method = release.taskId && taskIndex(result).get(release.taskId);
      const reason = release.kind === 'target' ? `${text(release.name)} is reachable for ${text(release.assignment)}.` : release.kind === 'manual-primary' ? 'Manual primary Slayer training is enabled.' : method ? `${text(method.label)} provides primary Slayer training without an assignment.` : 'A primary Slayer method is reachable without an assignment.';
      node.append(paragraph(`Training can continue despite this Slayer lock: ${reason} Your saved lock stays here until you clear it.`));
      if (method) node.append(taskButton(method.id, 'View method releasing the lock', result));
    }
    node.append(button('Save Slayer lock', () => {
      const reportedLevel = enabled.checked ? levelValue(level) : null;
      if (enabled.checked && reportedLevel === null) throw new Error('Enter the manually reported Slayer level before saving a lock.');
      return saveControls(result, { type: 'set-slayer-lock', lock: enabled.checked ? { level: reportedLevel, monster: monster.value === 'None' && boss.value === 'None' ? 'Manually Locked' : monster.value, boss: boss.value } : null }, 'Slayer');
    }));
    return node;
  }
  let serial = 0;
  const paragraph = (value, cls = 'info-meta') => el('p', text(plainInfoText(value)), cls);
  const toggleText = value => value === true ? 'enabled' : value === false ? 'disabled' : 'unknown';
  const empty = value => paragraph(value, 'info-empty');
  const searchText = row => [row.label, row.name, row.skill, row.tier, row.category, row.style, row.slot,
    row.equipment?.name, row.location, ...values(row.locations), ...values(row.tasks).map(task => task.label),
    ...values(row.availableTasks).map(task => task.label), ...values(row.sources ?? row.equipment?.sources).flatMap(source => [source.name, source.source, source.location, ...values(source.locations)])].filter(Boolean).join(' ').toLowerCase();

  function lazy(title, render) {
    const node = details(title); let loaded = false;
    node.addEventListener('toggle', () => { if (node.open && !loaded) { loaded = true; node.append(render()); } });
    return node;
  }

  function paged(rows, renderRow, label = 'entries') {
    const container = el('div', undefined, 'info-list');
    const toolbar = el('div', undefined, 'info-toolbar'), search = el('input');
    search.type = 'search'; search.placeholder = `Filter ${label}`; search.setAttribute('aria-label', `Filter ${label}`);
    const count = el('p', undefined, 'info-meta'), body = el('div'), more = button('Show more', () => { shown += 60; render(); }, 'wide-button');
    count.setAttribute('aria-live', 'polite');
    let shown = 60;
    function render() {
      const query = search.value.trim().toLowerCase(), filtered = rows.filter(row => !query || searchText(row).includes(query));
      body.replaceChildren(...filtered.slice(0, shown).map(renderRow));
      count.textContent = `${Math.min(shown, filtered.length).toLocaleString()} shown · ${filtered.length.toLocaleString()} matching · ${rows.length.toLocaleString()} total ${label}`;
      more.hidden = shown >= filtered.length;
      more.textContent = `Show 60 more (${Math.max(0, filtered.length - shown).toLocaleString()} remaining)`;
      if (!filtered.length) body.append(empty(query ? 'No matches. Try a different filter.' : `No ${label} in this view.`));
    }
    search.addEventListener('input', () => { shown = 60; render(); });
    toolbar.append(search, count); container.append(toolbar, body, more); render(); return container;
  }

  function tabs(entries, initial = 0, onChange = () => {}) {
    const container = el('div', undefined, 'info-panel'), nav = el('div', undefined, 'info-tabs'), body = el('div');
    nav.setAttribute('role', 'tablist');
    const tabButtons = [];
    const prefix = `info-${++serial}`;
    entries.forEach(([label, render], index) => {
      const tab = button(label, () => activate(index));
      tab.id = `${prefix}-tab-${index}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${prefix}-body`);
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % entries.length : event.key === 'ArrowLeft' ? (index + entries.length - 1) % entries.length : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : null;
        if (next !== null) { event.preventDefault(); activate(next); tabButtons[next].focus(); }
      });
      tabButtons.push(tab); nav.append(tab);
    });
    body.id = `${prefix}-body`; body.setAttribute('role', 'tabpanel'); body.tabIndex = 0;
    function activate(index) {
      tabButtons.forEach((tab, tabIndex) => { tab.setAttribute('aria-selected', String(index === tabIndex)); tab.tabIndex = index === tabIndex ? 0 : -1; });
      body.setAttribute('aria-labelledby', tabButtons[index].id); body.replaceChildren(entries[index][1]()); onChange(index);
    }
    container.append(nav, body); activate(initial); return container;
  }

  function sourceView(sources, result, openTask) {
    if (!sources?.length) return empty('No known source for this item.');
    return paged(sources.map(source => ({ ...source, label: source.source ?? source.name ?? source.location ?? source.kind ?? 'Source' })), source => {
      const row = el('div', undefined, 'info-row');
      row.append(el('strong', text(source.label)), paragraph([{ drop: 'Monster drop', shop: 'Shop', task: 'Training or task', chunks: 'Location', spawn: 'Item spawn' }[source.kind] ?? (advanced() ? source.kind : 'Source'), advanced() && source.sourceKind ? `Source kind: ${source.sourceKind}` : '', source.item ? `Item: ${text(source.item)}` : '', sourceRateText(source), advanced() && source.probability != null ? `Probability: ${Number(source.probability).toLocaleString(undefined, { maximumSignificantDigits: 4 })}` : '', source.quantity ? `Quantity: ${source.quantity}` : ''].filter(Boolean).join(' · ')));
      for (const location of [...new Set([source.location, ...values(source.locations)].filter(Boolean))]) {
        if (context.showChunk) row.append(button(`View location ${locationName(location)}`, () => { const id = String(location); context.showChunk(/^\d+-\d+$/.test(id) ? id.split('-')[0] : id); }));
        else row.append(paragraph(`Location: ${locationName(location)}`));
      }
      const method = taskIndex(result).get(source.taskId);
      if (method) row.append(openTask ? button(`View source method: ${text(method.label)}`, () => openTask(method)) : snapshots.has(result) ? taskButton(method.id, `View source method: ${text(method.label)}`, result) : button(`View source method: ${text(method.label)}`, () => showTask(method)));
      return row;
    }, 'sources');
  }

  function requirementsView(requirements = {}) {
    const lines = [];
    for (const [skill, level] of Object.entries(requirements.skills ?? {})) lines.push(`${text(skill)}: ${level}`);
    for (const [task, category] of Object.entries(requirements.tasks ?? {})) lines.push(`${text(category)} prerequisite: ${text(task)}`);
    if (requirements.items?.length) lines.push(`Required items: ${requirements.items.map(text).join(', ')}`);
    if (requirements.chunks?.length) lines.push(`Required locations: ${requirements.chunks.map(locationName).join(', ')}`);
    return lines.length ? list(lines) : empty('No other known requirements.');
  }

  function taskButton(id, label = 'Open task', panelResult) {
    const snapshot = snapshots.get(panelResult);
    return button(label, async () => {
      assertSnapshot(snapshot);
      const request = beginRequest();
      const result = await requestedResult(request);
      if (!requestCurrent(request)) return;
      assertSnapshot(snapshot);
      const task = result && taskIndex(result).get(id);
      if (task) showTask(task);
      else openDialog('Task unavailable', paragraph('This task is no longer in the current calculation. Reopen Activity Info or Current BiS to refresh the view.'));
    });
  }

  function progress(row) {
    return paragraph(row.challengeSatisfied ? `Done${row.personalCompleted ? ' · you did it in-game' : ' (counts for the duo)'}` : row.personalCompleted ? 'Done in-game' : 'Not done yet', 'info-progress');
  }

  function taskRow(task, result) {
    const row = el('div', undefined, 'info-row');
    const title = el('div', undefined, 'info-row-title'), full = taskIndex(result).get(task.evidenceTaskId ?? task.id);
    const url = taskIcon({ ...full, ...task }, context);
    if (url) { const image = el('img', undefined, 'task-icon'); image.src = url; image.alt = ''; image.width = image.height = 22; image.loading = 'lazy'; title.append(image); }
    title.append(el('strong', text(task.label)));
    row.append(title, paragraph([task.level > 1 ? `Level ${task.level}` : '', task.primary ? 'Primary method' : '', task.status === 'available' ? 'Doable now' : 'Blocked', task.selected ? 'Active goal' : 'Other option', task.sourceCount ? `${task.sourceCount} source${task.sourceCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')), progress(task));
    if (task.blockers?.length) row.append(paragraph(task.blockers.map(blocker => blocker.detail).join(' '), 'blocked-reason'));
    row.append(taskButton(task.id, undefined, result), lazy('Requirements and sources', () => {
      const full = taskIndex(result).get(task.evidenceTaskId ?? task.id), record = full?.record ?? {};
      const requirements = { skills: record.Skills ?? task.requirements?.skills, tasks: record.Tasks ?? task.requirements?.tasks,
        items: values(record.Items ?? task.requirements?.items), chunks: values(record.Chunks ?? task.requirements?.chunks) };
      const evidence = el('div', undefined, 'form-stack'); evidence.append(requirementsView(requirements), sourceView(full?.sources ?? task.sources, result));
      if (advanced() && task.suppressionReasons?.length) evidence.append(paragraph(`Active-list display: ${task.suppressionReasons.join(' ')}`));
      if (task.wiki) { const link = el('a', 'Open RuneScape Wiki'); link.href = task.wiki; link.target = '_blank'; link.rel = 'noopener noreferrer'; evidence.append(link); }
      return evidence;
    }));
    return row;
  }

  function equipmentRow(recommendation, result) {
    const gear = recommendation.equipment ?? {}, challenge = recommendation.challenge ?? {}, access = recommendation.sourceAccess ?? {};
    const row = el('div', undefined, 'info-row');
    const obtained = challenge.personalCompleted || result.currentBiS?.owned?.recordedObtained?.some(item => item.name === gear.name);
    row.append(gearIdentity(gear, recommendation.slot), paragraph(`${recommendation.style} · ${recommendation.slot}${recommendation.loadoutMode ? ` · ${recommendation.loadoutMode}` : ''}${gear.tier != null ? ` · Tier ${gear.tier}` : ''}`), paragraph(`You marked obtained: ${obtained ? 'yes' : 'no'} · Task: ${challenge.challengeSatisfied ? 'done' : 'not done'}${challenge.satisfiedBy?.length ? ` · Checked by ${names(challenge.satisfiedBy, result)}` : ''}`, 'info-progress'));
    if (advanced() && recommendation.score != null) row.append(paragraph(`Picker ranking components: ${values(recommendation.score).join(' / ')}${recommendation.comparison ? ` · ${recommendation.comparison}` : ''}`));
    row.append(paragraph([gear.armour != null ? `Armour ${gear.armour}` : '', gear.data?.lp != null ? `Life points ${gear.data.lp}` : '', gear.data?.weight != null ? `Weight ${gear.data.weight}` : ''].filter(Boolean).join(' · ')));
    row.append(paragraph(challenge.explanation), paragraph(access.explanation));
    const task = result.tasks?.find(task => task.equipmentName === gear.name);
    if (task) row.append(taskButton(task.id, 'View obtain task and progress', result));
    row.append(lazy('Sources, equip requirements and alternatives', () => {
      const detail = el('div', undefined, 'form-stack');
      if (access.personalLocations?.length) detail.append(paragraph(`Sources on ${snapshots.get(result).memberName}’s own unlocked map: ${access.personalLocations.map(locationName).join(', ')}`));
      for (const shared of access.sharedLocations ?? []) detail.append(paragraph(`Shared source ${locationName(shared.location)} · Unlocked by ${names(shared.memberIds, result)}`));
      if (access.connectedAreas?.length) detail.append(paragraph(`Connected interiors and other areas: ${access.connectedAreas.map(locationName).join(', ')}`));
      detail.append(requirementsView({ skills: gear.data?.requirements ?? {} }), sourceView(gear.sources, result));
      if (gear.data?.charges) detail.append(paragraph(`Degrades after ${gear.data.charges} charges. Upkeep is not subtracted from the ranking.`));
      if (recommendation.alternatives?.length) detail.append(paragraph(`Tied alternatives: ${recommendation.alternatives.map(text).join(', ')}`));
      detail.append(paragraph(recommendation.rewardSharing)); return detail;
    })); return row;
  }

  const slotFiles = { head: 'Head', neck: 'Neck', back: 'Back', torso: 'Torso', body: 'Torso', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring', pocket: 'Pocket', aura: 'Aura', ammo: 'Ammo', 'ammo (2h)': 'Ammo_(2h)', 'main hand weapon': 'Main_hand_weapon', 'off-hand weapon': 'Off-hand_weapon', 'off-hand': 'Off-hand', '2h weapon': '2h_weapon' };
  function slotBadge(slot) {
    const route = resolvePicture(`/assets/${slotFiles[slot] ?? 'Clean'}_slot.png`);
    if (!route) return el('span', slot ?? 'Slot', 'bis-slot-placeholder');
    const picture = el('img', undefined, 'bis-slot-icon'); if (picture.dataset) picture.dataset.slot = slot ?? 'Slot'; picture.src = route; picture.alt = ''; picture.width = 24; picture.height = 24; return picture;
  }
  function gearIdentity(gear, slot) {
    const node = el('span', undefined, 'bis-item-identity'), url = taskItemIcon(gear.name, name => context.itemIcon?.(name));
    const picture = url ? el('img', undefined, 'bis-item-icon') : slotBadge(slot ?? gear.slot);
    if (url) { picture.src = url; picture.alt = ''; picture.width = 32; picture.height = 32; }
    node.append(picture, el('strong', text(gear.name), 'bis-item-name')); return node;
  }
  function gearStats(gear) {
    const data = gear.data ?? {}, lines = [];
    const add = (label, value) => { if (value != null && value !== '' && Number(value) !== 0) lines.push(`${label} ${value}`); };
    add('Tier', gear.tier ?? data.tier); add('Armour', gear.armour ?? data.armour); add('Life points', data.lp);
    add('Damage tier', data.damage_tier); add('Accuracy tier', data.accuracy_tier);
    add('Ability damage', data.ability_damage); add('Accuracy', data.accuracy); add('Prayer', data.prayer); add('Weight', data.weight);
    for (const style of ['melee', 'ranged', 'magic', 'necromancy']) {
      add(`${style[0].toUpperCase()}${style.slice(1)} damage`, data[`${style}_damage`]); add(`${style[0].toUpperCase()}${style.slice(1)} accuracy`, data[`${style}_accuracy`]);
    }
    return lines;
  }
  function gearSources(gear) {
    return values(gear.sources).map(source => [source.source ?? source.name ?? source.kind ?? 'Source', ...values(source.location).map(locationName), ...values(source.locations).map(locationName), sourceRateText(source)].filter(Boolean).map(text).join(' · '));
  }
  function gearEvidence(recommendation, result) {
    const node = lazy(`Details: ${text(recommendation.equipment.name)}`, () => equipmentRow(recommendation, result)); node.className = 'bis-evidence'; return node;
  }
  function loadoutAlternatives(loadouts, hiddenNames = new Set()) {
    const node = el('div', undefined, 'bis-alternatives');
    for (const loadout of loadouts) {
      const selected = loadout.selected ?? [loadout.best].filter(Boolean);
      const options = [...selected.flatMap(chosen => values(chosen.alternatives).map(alternative => ({ ...alternative, label: `Tied ${chosen.mode}` }))), ...values(loadout.tradeoffs).map(option => ({ ...option, label: option.mode }))].map(option => ({ ...option, name: values(option.items).filter(name => !hiddenNames.has(name)).join(' + ') })).filter(option => option.name);
      if (options.length) node.append(lazy(`${loadout.style}: tied alternatives and other weapon modes (${options.length})`, () => paged(options, option => {
        const row = el('div', undefined, 'info-row'); row.append(el('strong', text(option.name)), paragraph(advanced() ? `${option.label} · Score ${Number(option.score).toFixed(2)}${option.scoreDifference != null ? ` · ${Number(option.scoreDifference).toFixed(2)} below selected score` : ' · Tied score'}` : `${option.label}${option.scoreDifference != null ? ' · Lower ranked alternative' : ' · Equally good'}`));
        if (option.defence) row.append(paragraph(`Armour ${option.defence.armour} · Life points ${option.defence.lifePoints}`)); return row;
      }, 'loadout alternatives')));
    }
    return node;
  }

  // All grouping uses the calculation already loaded for this panel. A supporting
  // hand/ammo item can be usable from shared access without creating an obligation.
  function gearOverview(loadouts = [], recommendations = [], result, label = 'gear recommendations', hiddenNames = new Set()) {
    const node = el('div', undefined, 'bis-overview'), toolbar = el('div', undefined, 'bis-filters'), search = el('input'), style = el('select'), count = paragraph('', 'bis-result-count'), body = el('div', undefined, 'bis-style-list');
    const models = [], coupledNames = new Map(), definitions = context.definitions?.()?.equipment ?? {};
    for (const loadout of loadouts) for (const chosen of loadout.selected ?? [loadout.best].filter(Boolean)) {
      const parts = [['Main hand', chosen.mainHand, chosen.mode === 'two-handed' ? '2h weapon' : 'main hand weapon'], ['Off-hand', chosen.offHand, 'off-hand'], ['Ammunition', chosen.ammunition, 'ammo']];
      const items = parts.filter(([, name]) => name).map(([role, name, slot]) => {
        const recommendation = recommendations.find(row => row.style === loadout.style && row.equipment?.name === name && (!row.loadoutMode || row.loadoutMode === chosen.mode));
        const supplied = recommendation?.equipment ?? result.equipment?.find(row => row.name === name) ?? { name, slot };
        return { role, recommendation, equipment: { ...supplied, data: supplied.data ?? definitions[name] } };
      });
      const used = coupledNames.get(loadout.style) ?? new Set(); items.forEach(item => used.add(item.equipment.name)); coupledNames.set(loadout.style, used);
      models.push({ style: loadout.style, slot: 'Weapon loadout', mode: chosen.mode, chosen, items, loadout });
    }
    for (const recommendation of recommendations) if (!coupledNames.get(recommendation.style)?.has(recommendation.equipment?.name)) models.push({ style: recommendation.style, slot: recommendation.slot, items: [{ equipment: recommendation.equipment ?? {}, recommendation }] });
    const visibleModels = models.map(model => ({ ...model, items: model.items.flatMap(item => {
      if (!hiddenNames.has(item.equipment.name)) return [item];
      if (model.chosen) return [];
      return values(item.recommendation?.alternatives).filter(name => !hiddenNames.has(name)).map(name => ({ equipment: result.equipment?.find(row => row.name === name) ?? { name, slot: model.slot, data: definitions[name] }, role: 'Equally good alternative' }));
    }) })).filter(model => model.items.length);
    const searchable = model => [model.style, model.slot, model.mode, ...model.items.flatMap(item => [item.role, searchText(item.recommendation ?? { equipment: item.equipment }), ...gearStats(item.equipment), ...gearSources(item.equipment)])].join(' ').toLowerCase();
    search.type = 'search'; search.placeholder = `Filter ${label}`; search.setAttribute('aria-label', `Filter ${label}`);
    style.setAttribute('aria-label', `Filter ${label} by style`);
    const all = el('option', 'All styles'); all.value = ''; style.append(all);
    const styles = [...new Set(models.map(model => model.style))];
    for (const name of styles) { const option = el('option', text(name)); option.value = name; style.append(option); }
    count.setAttribute('aria-live', 'polite'); toolbar.append(search, style, count);
    const description = paragraph('Weapons are ranked together with their off-hand and ammunition. Open an item’s details to see what it beats.', 'bis-ranking-note');
    function renderRow(model) {
      const row = el('tr', undefined, model.chosen ? 'bis-gear-row bis-coupled-row' : 'bis-gear-row'), slot = el('th', undefined, 'bis-slot-cell'), identity = el('td', undefined, 'bis-equipment-cell'), stats = el('td', undefined, 'bis-stats-cell'), source = el('td', undefined, 'bis-source-cell');
      slot.scope = 'row'; slot.append(slotBadge(model.chosen ? model.chosen.mode === 'two-handed' ? '2h weapon' : 'main hand weapon' : model.slot), el('span', text(model.slot).replace(/^./, letter => letter.toUpperCase())), ...(model.mode ? [el('small', text(model.mode))] : []));
      stats.setAttribute('data-label', 'Key stats'); source.setAttribute('data-label', 'Source');
      if (model.chosen?.defence) {
        const defence = gearStats({ armour: model.chosen.defence.armour, data: { lp: model.chosen.defence.lifePoints } });
        if (defence.length) stats.append(paragraph(defence.join(' · ')));
      }
      for (const item of model.items) {
        const gear = item.equipment, entry = el('div', undefined, 'bis-item');
        if (item.role) entry.append(el('small', item.role, 'bis-component-role'));
        entry.append(gearIdentity(gear, gear.slot));
        if (item.recommendation?.challenge) entry.append(paragraph(item.recommendation.challenge.challengeSatisfied ? (item.recommendation.challenge.personalCompleted ? 'Done' : 'Done (counts for the duo)') : 'Not done yet', 'bis-item-progress'));
        identity.append(entry);
        const declared = gearStats(gear);
        if (declared.length) stats.append(paragraph(`${model.chosen ? `${text(gear.name)}: ` : ''}${declared.join(' · ')}`, 'bis-declared-stats'));
        const lines = gearSources(gear), evidence = el('div', undefined, 'bis-item-source');
        evidence.append(paragraph(`${model.chosen ? `${text(gear.name)}: ` : ''}${lines.slice(0, 2).join('; ') || 'No known source for this item.'}${lines.length > 2 ? `; +${lines.length - 2} more sources` : ''}`));
        if (item.recommendation) evidence.append(gearEvidence(item.recommendation, result));
        else evidence.append(lazy(`Sources: ${text(gear.name)}`, () => { const detail = el('div', undefined, 'form-stack'); detail.append(paragraph('This item supports the weapon setup. Being able to reach it does not mean you own it or have to obtain it.'), requirementsView({ skills: gear.data?.requirements ?? {} }), sourceView(gear.sources, result)); if (gear.data?.charges) detail.append(paragraph(`Degrades after ${gear.data.charges} charges. Upkeep is not subtracted from the ranking.`)); return detail; }));
        source.append(evidence);
      }
      if (!model.chosen && !stats.children.length) stats.append(empty('No known stats.'));
      if (model.chosen && !model.chosen.offHand) identity.append(paragraph('Off-hand: None', 'bis-unused-slot'));
      if (model.chosen && !model.chosen.ammunition) identity.append(paragraph('Ammunition: None required', 'bis-unused-slot'));
      row.append(slot, identity, stats, source); return row;
    }
    function render() {
      const query = search.value.trim().toLowerCase(), filtered = visibleModels.filter(model => (!style.value || model.style === style.value) && (!query || searchable(model).includes(query)));
      count.textContent = `${filtered.length} matching · ${visibleModels.length} total rows`; body.replaceChildren();
      for (const name of styles) {
        const rows = filtered.filter(model => model.style === name), alternatives = loadoutAlternatives(loadouts.filter(loadout => loadout.style === name), hiddenNames);
        if (!rows.length && (!alternatives.children.length || query || style.value && style.value !== name)) continue;
        const section = el('section', undefined, 'bis-style-section'), heading = el('h3', text(name), 'bis-style-heading'), table = el('table', undefined, 'bis-gear-table'), head = el('thead'), headings = el('tr'), tableBody = el('tbody');
        heading.id = `bis-style-${++serial}`; table.setAttribute('aria-labelledby', heading.id);
        for (const title of ['Slot', 'Equipment', 'Key stats', 'Source']) { const cell = el('th', title); cell.scope = 'col'; headings.append(cell); }
        head.append(headings); tableBody.append(...rows.map(renderRow)); table.append(head, tableBody); section.append(heading, ...(rows.length ? [table] : []), alternatives); body.append(section);
      }
      if (!body.children.length) body.append(empty(query || style.value ? 'No matches. Try a different filter.' : `No ${label} in this view.`));
    }
    search.addEventListener('input', render); style.addEventListener('change', render); node.append(toolbar, description, body); render(); return node;
  }

  function specialistTaskRow(summary, result) {
    const full = taskIndex(result).get(summary.evidenceTaskId ?? summary.id);
    const node = taskRow({ ...full, ...summary }, result);
    if (advanced() && summary.priority != null) node.append(paragraph(`Declared priority ${summary.priority}`));
    return node;
  }

  function upgradeView(paths, result) {
    return paged(paths, path => lazy(`${path.style} · ${path.slot} · ${path.steps.length} upgrades`, () => {
      const node = el('div', undefined, 'form-stack');
      node.append(paragraph(path.comparison), paragraph(path.explanation), paragraph(path.recordedStart ? `Personal obtain-record starting comparison: ${values(path.recordedStart).map(text).join(' + ')}. Current possession is unconfirmed.` : 'No obtained gear is known as a starting point.'));
      node.append(paged(path.steps.map(step => ({ ...step, name: step.items.join(' + ') })), step => {
        const row = el('div', undefined, 'info-row'); row.append(el('strong', text(step.name))); if (advanced()) row.append(paragraph(`Exact picker score${Array.isArray(step.score) ? ' components' : ''}: ${values(step.score).join(' / ')}${step.alternativeCount != null ? ` · ${step.alternativeCount} additional equal-score loadouts` : ''}`));
        if (advanced() && step.components) row.append(paragraph(Object.entries(step.components).map(([name, value]) => `${text(name)}: ${value}`).join(' · ')));
        const tasks = step.items.map(name => result.tasks.find(task => task.equipmentName === name)).filter(Boolean);
        for (const task of tasks) row.append(taskButton(task.id, `View obtain task: ${text(task.equipmentName)}`, result));
        return row;
      }, 'upgrades')); return node;
    }), 'upgrade comparisons');
  }

  function specialistView(view, result, hiddenNames = new Set()) {
    if (hiddenNames.size) {
      const needed = row => { const task = taskIndex(result).get(row.evidenceTaskId ?? row.id); return !hiddenNames.has(row.equipmentName ?? row.name ?? task?.equipmentName); };
      view = { ...view, skilling: { ...view.skilling, sets: (view.skilling?.sets ?? []).map(set => ({ ...set, best: set.best.filter(needed), alternatives: set.alternatives.filter(needed), unavailable: set.unavailable.filter(needed) })), unranked: (view.skilling?.unranked ?? []).filter(needed) }, upgradePaths: (view.upgradePaths ?? []).map(path => ({ ...path, steps: path.steps.map(step => ({ ...step, items: step.items.filter(name => !hiddenNames.has(name)) })).filter(step => step.items.length) })).filter(path => path.steps.length) };
    }
    const section = lazy('Specialist comparisons: Tank, weight, skilling, relics, unlocks and upgrades', () => {
      const node = el('div', undefined, 'form-stack');
      node.append(tabs([
        ['Tank', () => {
          const content = el('div', undefined, 'form-stack'); content.append(paragraph(`Active tank goals: ${toggleText(view.tank?.enabled)}. Tank choices compare armour, then life points. Weapons and shields are compared together.`), gearOverview(view.tank?.loadouts, view.tank?.recommendations, result, 'tank recommendations', hiddenNames)); return content;
        }],
        ['Weight', () => {
          const coverage = view.weight?.coverage ?? {}, content = el('div', undefined, 'form-stack');
          content.append(paragraph(`Active weight goals: ${toggleText(view.weight?.enabled)}${advanced() ? ` · Known item weights: ${coverage.declaredWeightRecords ?? 0} · Usable items with weights: ${coverage.eligibleWeightRecords ?? 0}` : ''}`), paragraph(coverage.explanation ?? 'Item weights are unknown.', coverage.supported ? 'info-meta' : 'warning'), gearOverview([], view.weight?.recommendations, result, 'weight recommendations', hiddenNames)); return content;
        }],
        ['Skilling', () => {
          const content = el('div', undefined, 'form-stack'), skilling = view.skilling ?? {};
          content.append(paragraph(`Active skilling goals: ${toggleText(skilling.enabled)}. You can compare tools below.`), paragraph(skilling.explanation), paged(skilling.sets ?? [], set => lazy(`${text(set.name)} · ${set.best.length} best / tied goals`, () => {
            const body = el('div', undefined, 'form-stack'); body.append(paragraph(set.comparison), el('h3', set.ranked ? 'Best tools and ties' : 'Some tool comparisons are unknown'), paged(set.best, row => specialistTaskRow(row, result), 'best / tied skilling goals'), lazy(`Other reachable alternatives (${set.alternatives.length})`, () => paged(set.alternatives, row => specialistTaskRow(row, result), 'skilling alternatives')), lazy(`Blocked / unsupported (${set.unavailable.length})`, () => paged(set.unavailable, row => specialistTaskRow(row, result), 'unavailable skilling goals'))); return body;
          }), 'skilling sets'), el('h3', 'Independent skilling and quality-of-life goals'), paged(skilling.unranked ?? [], row => specialistTaskRow(row, result), 'independent skilling goals')); return content;
        }],
        ['Relics', () => {
          const content = el('div', undefined, 'form-stack'); content.append(paragraph(`Active relic goals: ${toggleText(view.relics?.enabled)}. Required levels and tasks are shown below.`), list(view.relics?.coverage?.limitations ?? []), paged(view.relics?.tasks ?? [], row => specialistTaskRow(row, result), 'relic prerequisite goals')); return content;
        }],
        ['Unlocks', () => {
          const content = el('div', undefined, 'form-stack'); content.append(paragraph(view.misc?.explanation), paged(view.misc?.tasks ?? [], row => specialistTaskRow(row, result), 'permanent, ability and prayer unlocks')); return content;
        }],
        ['Upgrades', () => upgradeView(view.upgradePaths ?? [], result)],
      ]));
      if (view.coverage?.limitations?.length) node.append(details('Specialist coverage', list(view.coverage.limitations))); return node;
    }); section.className = 'bis-specialist'; return section;
  }

  async function currentBiS(initialTab = 'Obtainable') {
    // The calculation can take a few seconds, so the dialog opens first, as Profile does.
    const memberId = context.memberId(), loading = openDialog('Current BiS', paragraph('Loading…', 'status-detail'));
    const request = { memberId, generation: loading ?? context.dialogGeneration?.(), wasOpen: true };
    const result = await requestedResult(request), view = result?.currentBiS;
    if (!requestCurrent(request)) {
      // Don't leave our own Loading… behind when the selected player changed underneath it.
      if (context.dialogGeneration?.() === request.generation && context.isDialogOpen?.() !== false) openDialog('Current BiS', empty('The selected player changed. Open Current BiS again.'));
      return;
    }
    if (!view) { openDialog('Current BiS', empty('Equipment information is unavailable. Retry after the task calculation finishes.')); return; }
    const snapshot = capture(result, request);
    const intro = paragraph(`${snapshot.memberName} · ${view.accessPolicy === 'shared' ? 'Shared unlocked access' : 'Personal unlocked access'} · ${view.completionScope === 'any' ? 'Either member may satisfy a challenge' : view.completionScope === 'all' ? 'Every member must satisfy a challenge' : 'Personal challenge completion'}`, 'section-intro');
    const partner = context.state().members.find(member => member.id !== snapshot.memberId), compareLabel = partner ? `Compare with ${partner.name}` : 'Compare gear';
    const tabNames = ['Obtainable', 'Recorded obtained', compareLabel];
    const canRecord = () => context.canWriteMember?.(snapshot.memberId) ?? context.canWrite?.() !== false;
    let generation;
    const panelCurrent = () => context.memberId() === snapshot.memberId && context.dialogGeneration?.() === generation && context.isDialogOpen?.() !== false;
    const isCurrent = () => panelCurrent() && context.state().revision === snapshot.revision;
    const gearReview = { memberId: snapshot.memberId, revision: snapshot.revision, canRemove: canRecord,
      assertCurrent: () => { assertSnapshot(snapshot); if (!canRecord() || !isCurrent()) throw new Error('Reopen Recorded obtained before changing gear.'); },
      onSaved: () => panelCurrent() ? currentBiS('Recorded obtained') : undefined };
    const content = tabs([
      ['Obtainable', () => {
        const node = el('div', undefined, 'form-stack'), hide = el('input'), label = el('label', undefined, 'bis-hide-obtained'), body = el('div');
        hide.type = 'checkbox'; hide.checked = readBiSPreferences(context.storage).hideObtained;
        label.append(hide, el('span', 'Hide gear I already have'));
        const render = () => {
          const hiddenNames = new Set(hide.checked ? (view.owned.recordedObtained ?? []).map(item => item.name) : []);
          body.replaceChildren(gearOverview(view.obtainable.loadouts, view.obtainable.recommendations, result, 'gear recommendations', hiddenNames));
          if (view.obtainable.specialist) body.append(specialistView(view.obtainable.specialist, result, hiddenNames));
        };
        hide.addEventListener('change', () => { writeBiSPreferences({ hideObtained: hide.checked }, context.storage); render(); });
        node.append(paragraph(view.owned.explanation), label, body); render();
        if (view.importedSelections?.length) node.append(lazy(`Imported source overrides (${view.importedSelections.length})`, () => list(view.importedSelections.map(item => `${text(item.name)}: ${item.meaning}`))));
        if (view.coverage?.limitations?.length) node.append(details('Ranking coverage', list(view.coverage.limitations))); return node;
      }],
      ['Recorded obtained', () => {
        const node = el('div', undefined, 'form-stack'); node.append(paragraph('These are items you marked obtained yourself. A shared task check does not add an item here. Whether you still own or wear them, your bank stock and your current levels are unknown.'));
        if (canRecord()) node.append(createEquipmentRecorder(context, gearReview));
        const best = view.owned.recordedBest;
        if (best) {
          const excluded = best.coverage?.excludedRecordedItems ?? [];
          node.append(el('h3', 'Best among items you marked obtained'), paragraph(best.coverage?.scope ?? 'This compares gear you marked obtained and can still use in your chunks. Weapons need compatible ammunition you also marked obtained.'), paragraph(`${best.coverage?.eligibleRecordedItems ?? 0} usable items marked obtained · ${excluded.length} obtained items cannot be compared yet`), gearOverview(best.loadouts, best.recommendations, result, 'recommendations for items you marked obtained'));
          if (best.specialist) node.append(specialistView(best.specialist, result));
          if (excluded.length) node.append(lazy(`Historical records excluded from ranking (${excluded.length})`, () => paged(excluded, item => {
            const row = el('div', undefined, 'info-row'); row.append(el('strong', text(item.name)), paragraph(item.reason)); return row;
          }, 'excluded historical records')));
          if (best.coverage?.limitations?.length) node.append(details('Personal-record ranking coverage', list(best.coverage.limitations)));
          const diagnostics = (best.diagnostics ?? []).filter(issue => issue.kind !== 'recorded-equipment-currently-ineligible');
          if (advanced() && diagnostics.length) node.append(lazy(`Personal-record ranking issues (${diagnostics.length})`, () => paged(diagnostics.map(issue => ({ ...issue, label: issue.item ?? issue.taskId ?? issue.kind })), issue => {
            const row = el('div', undefined, 'info-row'); row.append(el('strong', text(issue.label)), paragraph(issue.detail ?? issue.kind)); return row;
          }, 'ranking issues')));
        }
        node.append(lazy(`All items you marked obtained (${view.owned.recordedObtained?.length ?? 0})`, () => {
          const records = el('div', undefined, 'form-stack'); records.append(paragraph('Historical obtain completions remain listed even when an item is excluded from the current comparison.'), paged(view.owned.recordedObtained ?? [], item => {
            const row = el('div', undefined, 'info-row'); row.append(gearIdentity(item, item.slot), paragraph(`${item.slot} · ${item.evidence}`));
            // Keep the hand-record marker, Remove and Open task on one line.
            const actions = item.addedByHand ? createHandRecordActions(context, { ...gearReview, item }) : row;
            if (result.tasks?.some(task => task.id === item.taskId)) actions.append(taskButton(item.taskId, undefined, result));
            if (actions !== row) row.append(actions); return row;
          }, 'items you marked obtained')); return records;
        })); return node;
      }],
      [compareLabel, () => createBiSComparisonView({ ...context, advanced }, { memberId: snapshot.memberId, result, isCurrent })],
    ], Math.max(0, tabNames.indexOf(initialTab)), index => { initialTab = tabNames[index]; }); content.className = 'info-panel bis-panel'; generation = openDialog('Current BiS', snapshotControls(snapshot, () => currentBiS(initialTab)), intro, content) ?? context.dialogGeneration?.();
  }

  // Skills: a tile grid first, one skill's detail and training plan on click.
  const skillFamilies = {
    combat: ['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Magic', 'Prayer', 'Summoning', 'Necromancy'],
    gathering: ['Mining', 'Fishing', 'Woodcutting', 'Farming', 'Hunter', 'Divination', 'Archaeology'],
    artisan: ['Smithing', 'Crafting', 'Fletching', 'Herblore', 'Runecrafting', 'Cooking', 'Construction', 'Firemaking'],
  };
  const skillFamily = name => Object.entries(skillFamilies).find(([, skills]) => skills.includes(name))?.[0] ?? 'support';
  function skillBadge(name, size = 'small') {
    const url = context.skillIcon?.(name);
    if (url) { const img = el('img', undefined, `skill-badge skill-badge-${size}`); img.src = url; img.alt = ''; return img; }
    const badge = el('span', name.slice(0, 2), `skill-badge skill-badge-${size} family-${skillFamily(name)}`); badge.setAttribute('aria-hidden', 'true'); return badge;
  }
  const hours = value => value == null ? 'time unknown' : value < 1 ? `${Math.max(1, Math.round(value * 60))} min` : `${Math.floor(value)} h ${String(Math.round((value % 1) * 60)).padStart(2, '0')} m`;
  const gp = value => { if (value == null) return 'GP unknown'; const sign = value < 0 ? '−' : '+', abs = Math.abs(value); return `${sign}${abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${Math.round(abs / 1e3)}k` : Math.round(abs)} gp`; };
  function meter(value, max) {
    const node = el('progress', undefined, 'skill-meter'); node.max = Math.max(1, max); node.value = Math.max(0, Math.min(node.max, value)); node.setAttribute('aria-label', `Reachable level ${value} out of ${max}`); return node;
  }
  function skillsOverview(view, result) {
    const host = el('div', undefined, 'skills-view');
    const observedOf = skill => snapshots.get(result)?.observedSkills?.[skill.skill];
    const showGrid = () => {
      const grid = el('div', undefined, 'skill-grid');
      for (const skill of view.skills) {
        const observed = observedOf(skill), methods = (skill.filteredTasks ?? skill.availableTasks).length;
        const tile = button('', () => host.replaceChildren(skillDetail(skill, result, showGrid)), `skill-tile${methods ? '' : ' is-empty'}`);
        tile.setAttribute('aria-label', `${skill.skill}: ${observed ? `level ${observed.level}` : 'level not synced'}, reachable ceiling ${skill.reachableLevel}, ${methods} methods`);
        const head = el('span', undefined, 'skill-tile-head');
        head.append(skillBadge(skill.skill), el('span', skill.skill, 'skill-name'), el('span', observed ? String(observed.level) : '–', 'skill-level'));
        tile.append(head, meter(skill.reachableLevel, skill.cap ?? 99), el('span', `${methods} method${methods === 1 ? '' : 's'} · reach ${skill.reachableLevel}`, 'skill-sub'));
        grid.append(tile);
      }
      const synced = view.skills.some(skill => observedOf(skill));
      if (!view.skills.length) grid.append(empty('No skills match these filters.'));
      host.replaceChildren(...(synced ? [] : [paragraph(context.canWrite?.() === false ? 'Account levels have not been synced yet.' : 'Your real levels are not synced yet. Use progress sync below to show them on each skill and plan training from them.', 'skills-hint')]), grid);
    };
    showGrid(); return host;
  }
  function skillDetail(skill, result, back) {
    const node = el('div', undefined, 'skill-detail'), observed = snapshots.get(result)?.observedSkills?.[skill.skill];
    const header = el('div', undefined, 'skill-detail-head'), titles = el('div');
    titles.append(el('h3', skill.skill), paragraph(observed ? `Level ${observed.level} · ${Number(observed.xp).toLocaleString()} XP (${observed.source === 'game-plugin' ? 'Game plugin' : observed.source === 'official-api' ? 'RuneScape API' : 'RuneMetrics'})` : context.canWrite?.() === false ? 'Account level has not been synced yet.' : 'Level not synced yet: enter it below or sync progress.', 'status-detail'));
    header.append(button('← All skills', back, 'back-button'), skillBadge(skill.skill, 'large'), titles);
    const stats = el('div', undefined, 'skill-stats');
    for (const [value, label] of [[skill.reachableLevel, 'reachable ceiling'], [skill.availableTasks.length, 'methods you can use'], [skill.selectedGoals?.length ?? 0, 'active goals']]) { const stat = el('div', undefined, 'skill-stat'); stat.append(el('strong', String(value)), el('span', label)); stats.append(stat); }
    node.append(header, stats, trainingPlanner(skill, result, observed));
    const methods = el('section', undefined, 'skill-methods'); methods.append(el('h4', 'Training methods', 'content-heading'));
    methods.append(paged(skill.filteredTasks ?? skill.availableTasks, task => {
      const row = el('div', undefined, 'method-row'), name = button(text(task.label), () => showTask(task), 'method-name');
      const status = task.personalCompleted || task.challengeSatisfied ? 'Done' : task.status === 'available' && !task.blockers?.length ? 'Doable' : 'Blocked';
      row.append(el('span', task.level ? String(task.level) : '–', 'method-level'), name, el('span', `${status}${task.primary ? ' · Primary' : ''}`, 'method-tag'));
      return row;
    }, `${skill.skill} methods`));
    node.append(methods, lazy('Training assumptions', () => trainingControls(skill, result)));
    return node;
  }
  function trainingPlanner(skill, result, observed) {
    if (context.canWrite?.() === false) return el('span');
    const section = el('section', undefined, 'training-plan'), form = el('div', undefined, 'plan-form'), output = el('div', undefined, 'plan-output');
    const from = numberInput(observed?.level ?? ''), to = numberInput('');
    const goalLevels = (skill.selectedGoals ?? []).map(task => Number(task.level)).filter(level => Number.isFinite(level) && level > (observed?.level ?? 0));
    to.value = String(goalLevels.length ? Math.min(...goalLevels) : Math.min(skill.cap ?? 99, (observed?.level ?? 1) + 10));
    from.placeholder = 'Your level';
    // The target follows the starting level until the player sets it themselves.
    let targetEdited = false;
    to.addEventListener('input', () => { targetEdited = true; });
    from.addEventListener('input', () => { const level = Number(from.value); if (!targetEdited && Number.isInteger(level) && level > 0) to.value = String(Math.min(skill.cap ?? 99, level + 10)); });
    const run = async () => {
      if (!from.value.trim()) { output.replaceChildren(paragraph('Enter your current level to see a plan.', 'info-empty')); return; }
      if (Number(to.value) <= Number(from.value)) { output.replaceChildren(paragraph(`Level ${from.value} already meets level ${to.value}. Raise the target to plan training.`, 'info-empty')); return; }
      output.replaceChildren(paragraph('Planning…', 'status-detail'));
      const query = `/api/training-plan?memberId=${encodeURIComponent(context.memberId())}&skill=${encodeURIComponent(skill.skill)}&targetLevel=${Number(to.value)}&fromLevel=${Number(from.value)}`;
      try { output.replaceChildren(planView(await context.api(query))); }
      catch (error) { output.replaceChildren(paragraph(error.message || String(error), 'error')); }
    };
    form.append(field('From level', from), field('To level', to), button('Plan training', run, 'primary-action'));
    section.append(el('h4', 'How to get there', 'content-heading'), form, output);
    if (from.value) void run(); else output.append(paragraph('Enter your current level to see the fastest, the balanced and the money-making route.', 'info-empty'));
    return section;
  }
  function planView(plan) {
    const node = el('div', undefined, 'plan-view');
    if (plan.status !== 'estimated' && !Object.keys(plan.plans ?? {}).length) { node.append(...(plan.issues ?? []).map(issue => paragraph(issue.detail, 'info-empty'))); return node; }
    node.append(paragraph(`${Number(plan.xpNeeded ?? 0).toLocaleString()} XP from level ${plan.fromLevel} to ${plan.toLevel}`, 'status-detail'));
    const cards = el('div', undefined, 'plan-cards');
    for (const [key, title, note] of [['best-xp', 'Fastest', 'Best XP, cost no object'], ['balanced', 'Balanced', 'Cheap, roughly break-even'], ['money-making', 'Makes money', 'Best GP per hour']]) {
      const option = plan.plans?.[key], card = el('article', undefined, `plan-card plan-${key}`);
      card.append(el('h5', title), el('p', note, 'plan-note'));
      if (!option?.segments?.length) { card.append(paragraph(option?.issues?.[0]?.detail ?? 'No reviewed method fits this route yet.', 'info-empty')); cards.append(card); continue; }
      const totals = el('p', undefined, 'plan-totals'); totals.append(el('strong', hours(option.hours)), el('span', gp(option.netGp)));
      card.append(totals);
      const steps = el('ol', undefined, 'plan-steps');
      for (const segment of option.segments) {
        const step = el('li');
        step.append(el('span', `${segment.fromLevel}→${segment.toLevel}`, 'plan-range'), el('span', text(segment.label), 'plan-method'),
          el('span', [segment.actions != null ? `${Number(segment.actions).toLocaleString()} actions` : '', segment.xpPerHour ? `${Number(segment.xpPerHour).toLocaleString()} XP/h` : ''].filter(Boolean).join(' · '), 'plan-detail'));
        if (segment.inputs?.length) step.append(el('span', `Needs ${segment.inputs.map(input => `${Number(input.totalQuantity).toLocaleString()} ${text(input.item)}`).join(', ')}`, 'plan-detail'));
        steps.append(step);
      }
      card.append(steps); if (!option.complete) card.append(paragraph('Partial route: no reviewed method covers the rest yet.', 'plan-note'));
      cards.append(card);
    }
    node.append(cards);
    const locked = (plan.lockedMethods ?? []).filter(method => method.betterFor?.length);
    if (locked.length) {
      const box = el('div', undefined, 'plan-locked'); box.append(el('h5', 'Better methods behind other chunks'));
      box.append(list(locked.map(method => `${text(method.label)} (level ${method.level}) · ${(method.blockers ?? []).map(blocker => text(blocker.detail ?? blocker.name ?? blocker.kind)).filter(Boolean).slice(0, 2).join('; ') || 'not reachable yet'}`)));
      node.append(box);
    }
    node.append(paragraph(`Prices: Grand Exchange guide prices from ${plan.plans?.['best-xp']?.segments?.[0]?.priceDate ?? 'the date shown for the method'}. GP counts what you make; raw materials you gather yourself are not priced, and times exclude gathering and banking.`, 'plan-footnote'));
    return node;
  }

  function groupView(group, result, quest = false) {
    const total = group.totalCount ?? group.tasks.length;
    return lazy(`${text(group.name)} · ${group.availableCount} of ${total} steps doable now`, () => {
      const node = el('div', undefined, 'form-stack');
      const generation = context.dialogGeneration?.();
      if (quest && context.questMapControls) node.append(context.questMapControls({ quest: group.name, guard: () => { assertSnapshot(snapshots.get(result)); return context.dialogCurrent?.(generation) !== false; } }));
      node.append(paragraph(`Steps you marked done: ${group.personallyCompletedCount}/${total} · Steps that count for your group: ${group.challengeSatisfiedCount}/${total}. This does not mean the whole quest or achievement is complete.`, 'info-progress'));
      if (group.wholeCompletion?.length) node.append(el('h3', 'Whole quest or achievement completion'), ...group.wholeCompletion.map(task => taskRow(task, result)));
      node.append(paged(group.tasks, task => taskRow(task, result), 'steps')); return node;
    });
  }

  function achievementView(view, result) {
    const node = el('div', undefined, 'form-stack'), chooser = el('select'), body = el('div');
    const selected = view.achievements.filter(group => group.required);
    for (const [value, label] of [['selected', `Required achievement groups (${selected.length})`], ['all', `All achievement groups (${view.achievements.length})`]]) {
      const option = el('option', label); option.value = value; chooser.append(option);
    }
    chooser.setAttribute('aria-label', 'Achievement group visibility');
    chooser.value = context.preferences?.().hideAchievements ? 'selected' : 'all';
    const render = () => { body.replaceChildren(paged(chooser.value === 'selected' ? selected : view.achievements, group => groupView(group, result), 'achievement groups')); };
    chooser.addEventListener('change', render);
    node.append(paragraph('The required view follows your achievement family rules and includes completed or currently blocked groups. Use all groups to inspect other families.'), field('Show achievement groups', chooser), body); render(); return node;
  }

  function slayerView(view, result) {
    const node = el('div', undefined, 'form-stack'); node.append(slayerControls(view, result), list(view.limitations), paged(view.masters, master => lazy(`${master.name} · ${master.eligibleCount} of ${master.totalCount} assignments possible now`, () => {
      const detail = el('div', undefined, 'form-stack'); detail.append(paragraph(master.reachable ? 'You can reach this Slayer master for an assignment.' : 'No way to get an assignment from this master is known in your chunks yet.'));
      if (master.method) detail.append(taskRow(master.method, result));
      detail.append(paged(master.tasks, task => {
        const row = el('div', undefined, 'info-row'); row.append(el('strong', text(task.name)), paragraph(`${task.planningEligible ? 'Possible assignment' : 'Blocked / unknown'} · Assignment weight ${task.weight}`));
        if (task.reachableMonsters.length) row.append(paragraph(`Reachable target monsters: ${task.reachableMonsters.map(text).join(', ')}`));
        if (task.blockers.length) row.append(list(task.blockers.map(blocker => blocker.detail)));
        row.append(requirementsView({ skills: { ...task.requirements.Skills, ...(task.requirements.Level ? { Slayer: task.requirements.Level } : {}), ...(task.requirements.CombatLevel ? { Combat: task.requirements.CombatLevel } : {}) }, tasks: task.requirements.Tasks, chunks: values(task.requirements.Chunks) })); return row;
      }, 'assignments')); return detail;
    }), 'Slayer masters')); return node;
  }

  async function activityInfo(initialTab = 'Skills') {
    const request = beginRequest(), result = await requestedResult(request), view = result?.activityInfo;
    if (!requestCurrent(request)) return;
    if (!view) { openDialog('Activity Info', empty('Activity information is unavailable. Retry after the task calculation finishes.')); return; }
    const snapshot = capture(result, request);
    const filtered = (tab, render) => () => filteredActivityTab(context, { tab, view, render });
    const content = tabs([
      ['Skills', filtered('Skills', filteredView => skillsOverview(filteredView, result))],
      ['Quests', filtered('Quests', filteredView => paged(filteredView.quests, group => groupView(group, result, true), 'quests'))],
      ['Achievements', filtered('Achievements', filteredView => achievementView(filteredView, result))],
      ['Activities', filtered('Activities', filteredView => paged(filteredView.activities, task => taskRow(task, result), 'activities'))],
      ['Slayer', filtered('Slayer', filteredView => slayerView(filteredView.slayer, result))],
      ['Clues', filtered('Clues', filteredView => {
        const view = filteredView;
        const node = el('div', undefined, 'form-stack'); node.append(list(view.clues.limitations), ...view.clues.tiers.map(tier => lazy(`${String(tier.tier).replace(/^./, letter => letter.toUpperCase())} · ${tier.availableCount} of ${tier.totalCount} steps reachable`, () => {
          const detail = el('div', undefined, 'form-stack'); detail.append(paragraph(`${tier.reachableLocations.length}/${tier.declaredLocations.length} known locations are accessible.`), lazy('Accessible locations', () => list(tier.reachableLocations.map(locationName))), paged(tier.tasks, task => taskRow(task, result), 'clue steps')); return detail;
        }))); if (!view.clues.tiers.length) node.append(empty('No clue steps match these filters.')); return node;
      })],
    ], Math.max(0, ['Skills', 'Quests', 'Achievements', 'Activities', 'Slayer', 'Clues'].indexOf(initialTab)), index => { initialTab = ['Skills', 'Quests', 'Achievements', 'Activities', 'Slayer', 'Clues'][index]; });
    let generation;
    const syncControls = context.canWrite?.() !== false && context.api && context.applyRuneMetrics ? createRuneMetricsControls({ ...context, field }, {
      memberId: snapshot.memberId,
      isCurrent: () => context.memberId() === snapshot.memberId && context.dialogGeneration?.() === generation && context.isDialogOpen?.() !== false,
      onApplied: () => activityInfo(initialTab),
    }) : undefined;
    const nodes = [snapshotControls(snapshot, () => activityInfo(initialTab)), paragraph(context.canWrite?.() === false ? 'Reachable levels describe what the unlocked chunks can support. Synced account levels show the player’s recorded progress.' : 'Levels here are the highest you could reach from your unlocked chunks, not your account levels. Progress sync (below) records your real ones.', 'section-intro')];
    if (context.openXpChoices) nodes.push(button('XP choices', () => context.openXpChoices(snapshot.memberId)));
    // Sync is occasional, so it sits below the main tabs in its own collapsed section.
    const sync = syncControls ? details('Progress sync', syncControls) : null;
    const plugin = context.gamePlugin ? details('Game plugin', context.gamePlugin.controls({ memberId: snapshot.memberId,
      isCurrent: () => context.memberId() === snapshot.memberId && context.dialogGeneration?.() === generation && context.isDialogOpen?.() !== false,
      onApplied: () => activityInfo(initialTab),
    })) : null;
    generation = openDialog('Activity Info', ...nodes, content, ...(sync ? [sync] : []), ...(plugin ? [plugin] : []), details('Activity coverage', list(view.coverage.limitations))) ?? context.dialogGeneration?.();
  }
  return { currentBiS, activityInfo, sourceView };
}
