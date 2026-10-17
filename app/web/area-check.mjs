import { createAreaSelection, AREA_CHECK_CAP } from './area-check-selection.mjs';
import { loadIcons, skillIcon } from './icons.mjs';

export function areaRangeText(range) {
  if (!range?.lowest) return 'No method recorded';
  return range.lowest.level === range.highest.level ? `${range.lowest.level}` : `${range.lowest.level}–${range.highest.level}`;
}
export function areaGapText(range) {
  const gap = range?.largestGap;
  if (!gap) {
    if (!range?.gapTarget) return 'No task here needs this skill';
    if (range.methods?.some(method => method.status === 'available' && !method.blockers?.length
      && method.level >= range.gapTarget.level)) return `No task here needs more than level ${range.gapTarget.level}`;
    return range.availableCount ? 'No long gap' : 'No method recorded';
  }
  const method = gap.methods[0];
  return `${gap.fromLevel} → ${gap.toLevel} on ${method.label}${gap.methods.length > 1 ? ` and ${gap.methods.length - 1} more` : ''}`;
}
export function areaGapEndText(gap) {
  const names = [...new Set(gap.evidence.map(method => method.label))].slice(0, 2).join(', ');
  return `${gap.kind === 'requirement' ? 'Area requirement' : 'Next method'}${names ? ` · ${names}` : ''}`;
}
export function areaStartText(range) {
  const gap = range?.bootstrapGap;
  if (!gap) return '';
  const source = gap.source === 'f2p-reference' ? 'F2P reference level' : gap.source === 'personal' ? 'recorded level' : 'starting level';
  return `Can't start: ${gap.fromLevel} → ${gap.toLevel} (${source})`;
}
export function areaTaskSummary(scope) {
  const counts = { quests: 0, achievements: 0, other: 0 };
  for (const { category, count } of scope?.categories ?? []) {
    counts[category === 'Quest' ? 'quests' : category === 'Diary' ? 'achievements' : 'other'] += count;
  }
  const parts = [];
  if (counts.quests) parts.push(`${counts.quests} quest${counts.quests === 1 ? '' : 's'}`);
  if (counts.achievements) parts.push(`${counts.achievements} achievement${counts.achievements === 1 ? '' : 's'}`);
  if (counts.other) parts.push(`${counts.other} other task${counts.other === 1 ? '' : 's'}`);
  return parts.length ? `Opens ${parts.join(', ')}` : 'No new tasks';
}
export function renderAreaTasks(c, tasks) {
  const section = c.el('section', undefined, 'area-check-tasks');
  section.setAttribute('aria-label', 'Tasks');
  section.append(c.el('h3', 'Tasks'), c.el('p', 'Compared with your current task list.', 'area-check-methods'));
  const scopes = c.el('div', undefined, 'area-check-task-scopes');
  for (const [key, label] of [['alone', 'Alone'], ['combined', 'With current chunks']]) {
    const scope = tasks?.[key];
    const block = c.el('section', undefined, 'area-check-task-scope');
    block.setAttribute('aria-label', label);
    block.append(c.el('h4', label), c.el('p', areaTaskSummary(scope), 'area-check-task-summary'));
    for (const { category, count, tasks: rows } of scope?.categories ?? []) {
      const name = category === 'Quest' ? 'Quests' : category === 'Diary' ? 'Achievements' : category;
      const details = c.details(`${name} (${count})`);
      details.className = 'area-check-task-details';
      let expanded = false;
      details.addEventListener('toggle', () => {
        if (!details.open || expanded) return;
        expanded = true;
        details.append(c.list(rows.map(task => c.plain(task.label))));
      });
      block.append(details);
    }
    scopes.append(block);
  }
  section.append(scopes, c.el('p', 'Task predictions follow the current engine, rules and saved progress; blocked near-misses are not shown.', 'area-check-methods'));
  return section;
}
export function areaDiscordMessages(result, name, limit = 1900) {
  const title = `Area check · ${name} · ${result.chunkIds.length} chunks · ${result.members ? 'ASSUMES MEMBERS' : 'F2P'}`;
  const scopeText = (label, range) => `${label} ${areaRangeText(range)}; ${range.largestGap ? `gap ${areaGapText(range)} (${areaGapEndText(range.largestGap)})` : areaGapText(range)}${range.bootstrapGap ? `; ${areaStartText(range)}` : ''}`;
  const lines = [`Tasks · Alone: ${areaTaskSummary(result.tasks?.alone)}.`,
    `Tasks · With current chunks: ${areaTaskSummary(result.tasks?.combined)}.`,
    'Method entry levels. Gaps of 15+ levels mean continuing with an old method. Alone / with current chunks:', ...result.rows.map(row =>
    `${row.skill}: ${scopeText('alone', row.alone)} / ${scopeText('with current', row.combined)}`),
  'Gap targets stop at what tasks need: selected area alone, or current chunks plus the area. No requirement means no gap. Missing usable methods mean unknown coverage.'];
  const messages = []; let current = title;
  for (const line of lines) {
    if (`${current}\n${line}`.length > limit) { messages.push(current); current = `${title} (continued)`; }
    current += `\n${line}`;
  }
  messages.push(current); return messages;
}

function renderRange(c, range, label, members) {
  const scope = c.el('div', undefined, 'area-check-scope'); scope.setAttribute('data-label', label);
  const target = range.gapTarget ?? { level: range.cap ?? 1, kind: 'limit' };
  const usable = range.methods.filter(method => method.status === 'available' && !method.blockers?.length && method.level <= target.level);
  const levels = [...new Set(usable.map(method => method.level))].sort((a, b) => a - b);
  const summary = c.plain(areaGapText(range));
  const endText = target.kind === 'requirement' ? 'Area requirement' : `${members ? 'Members' : 'F2P'} cap`;
  const axis = c.el('div', undefined, 'area-check-axis');
  axis.append(c.el('strong', label), c.el('span', `${target.level} · ${endText}`)); scope.append(axis);
  const bar = c.el('div', undefined, 'area-check-bar'); bar.setAttribute('role', 'img');
  bar.setAttribute('data-endpoint-kind', target.kind); bar.setAttribute('data-target-level', String(target.level));
  const facts = [`${label}. Levels 1 to ${target.level}. Endpoint: ${endText}.`, summary + '.'];
  if (levels.length) {
    facts.push(`Usable method entry levels: ${levels.join(', ')}.`);
    const position = level => 100 * (level - 1) / Math.max(1, target.level - 1);
    const segment = (className, from, to) => {
      const node = c.el('span', undefined, className);
      node.setAttribute('data-from-level', String(from)); node.setAttribute('data-to-level', String(to));
      // CSSOM property writes follow the map/theme positioning pattern under strict CSP.
      node.style.setProperty('--area-start', `${position(from)}%`);
      node.style.setProperty('--area-width', `${position(to) - position(from)}%`);
      bar.append(node);
    };
    if (levels[0] > 1 && range.bootstrapGap) {
      const end = Math.min(levels[0], range.bootstrapGap.toLevel);
      segment('area-check-unstarted', 1, end);
    }
    for (const gap of range.trainingGaps) {
      segment('area-check-grind', gap.fromLevel, gap.toLevel);
      facts.push(`Long gap: ${c.plain(areaGapText({ largestGap: gap }))}.`);
    }
    for (const level of levels) {
      const tick = c.el('span', undefined, 'area-check-tick'); tick.setAttribute('data-level', String(level));
      tick.style.setProperty('--area-start', `${position(level)}%`);
      tick.title = `Lv ${level}: ${usable.filter(method => method.level === level).map(method => c.plain(method.label)).join(', ')}`;
      bar.append(tick);
    }
  } else { bar.classList.toggle('area-check-empty', true); facts.push('No usable method recorded. Coverage is unknown.'); }
  if (range.bootstrapGap) facts.push(areaStartText(range) + '.');
  bar.setAttribute('aria-label', facts.join(' '));
  for (const child of bar.children) child.setAttribute('aria-hidden', 'true');
  const start = c.el('span', '1', 'area-check-level-one'); start.setAttribute('aria-hidden', 'true');
  const line = c.el('p', summary, range.largestGap ? 'area-check-gap' : 'area-check-methods');
  scope.append(bar, start, line); return scope;
}

export function renderAreaTable(c, result) {
  const table = c.el('div', undefined, 'area-check-ladders');
  const legend = c.el('p', undefined, 'area-check-legend');
  for (const [className, text] of [['area-check-key-tick', 'Usable method'], ['area-check-key-grind', '15+ level grind'], ['area-check-key-unstarted', "Can't start"]]) {
    const key = c.el('span'); key.append(c.el('i', undefined, className), text); legend.append(key);
  }
  table.append(legend);
  const largest = row => Math.max(row.alone.largestGap?.size ?? 0, row.combined.largestGap?.size ?? 0);
  const sorted = [...result.rows].sort((a, b) => largest(b) - largest(a) || a.skill.localeCompare(b.skill));
  const body = c.el('div', undefined, 'area-check-rows');
  const rest = c.el('div', undefined, 'area-check-rows');
  for (const row of sorted) {
    const tr = c.el('section', undefined, 'area-check-row'), skill = c.el('h3', undefined, 'area-check-skill');
    tr.setAttribute('aria-label', row.skill);
    const icon = skillIcon(row.skill);
    if (icon) { const img = c.el('img'); img.src = icon; img.alt = ''; img.width = img.height = 20; skill.append(img); }
    skill.append(c.el('span', row.skill));
    tr.classList.toggle('area-check-large-gap', largest(row) >= 15);
    const details = c.details('Methods');
    details.className = 'area-check-details';
    let expanded = false;
    details.addEventListener('toggle', () => {
      if (!details.open || expanded) return; expanded = true;
      for (const [label, range] of [['Alone', row.alone], ['With current chunks', row.combined]]) {
        details.append(c.el('p', `${label}: old methods may still earn XP. Renewable supplies and XP rates are not verified.`, 'area-check-methods'));
        if (range.bootstrapGap) details.append(c.el('p', areaStartText(range), 'area-check-start'));
        if (range.gapTarget) {
          details.append(c.el('p', `Target: ${range.gapTarget.level} · Area requirement`, 'area-check-methods'));
          if (range.gapTarget.requirements?.length) details.append(c.list(range.gapTarget.requirements.map(method => `${method.level} · ${c.plain(method.label)}`)));
        }
        details.append(c.list(range.methods.map(method => `${method.level} · ${c.plain(method.label)}${method.blockers?.length ? ` — ${method.blockers.map(blocker => blocker.detail).join('; ')}` : ''}`)));
        if (range.trainingGaps?.length) details.append(c.list(range.trainingGaps.map(gap => `${areaGapText({ largestGap: gap })} · ${areaGapEndText(gap)}`)));
      }
    });
    tr.append(skill, renderRange(c, row.alone, 'Alone', result.members), renderRange(c, row.combined, 'With current', result.members), details);
    (largest(row) ? body : rest).append(tr);
  }
  if (body.children.length) table.append(body);
  else table.append(c.el('p', 'No long gaps recorded.', 'area-check-methods'));
  if (rest.children.length) {
    const without = c.details(`Show skills without gaps (${rest.children.length})`, rest);
    without.className = 'area-check-without-gaps'; without.open = !body.children.length; table.append(without);
  }
  return table;
}

export function createScreenAreaCheck(c) {
  if (c.supportsFeature?.('training') === false) return;
  let selection, controller, generation, lastChunks, dialogRevision, dialogRefresh, sequence = 0;
  const group = c.el('div', undefined, 'toolbar-group toolbar-area-check');
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Area check');
  const toggle = c.button('Area check', () => {
    if (!c.map?.model) return;
    if (selection?.active) { selection.cancel(); return; }
    if (c.sandbox.active) c.sandbox.exit();
    c.closeChunkMenu(); c.closeDialog();
    selection ??= createAreaSelection(c.map, { onSelect: ids => { toggle.setAttribute('aria-pressed', 'false'); normalHint(); open(ids); },
      onHint: text => { c.$('map-hint').textContent = text; }, onCancel: () => { toggle.setAttribute('aria-pressed', 'false'); normalHint(); } });
    c.map.pointerTool = selection; selection.start(); toggle.setAttribute('aria-pressed', 'true');
    c.$('map-hint').textContent = `Drag an area · Touch: tap two corners · Up to ${AREA_CHECK_CAP} chunks · Escape cancels`;
    c.$('map-hover').focus({ preventScroll: true });
  });
  toggle.id = 'area-check-toggle'; toggle.setAttribute('aria-pressed', 'false');
  toggle.title = `Compare tasks and training in an area of up to ${AREA_CHECK_CAP} chunks. Nothing is saved.`;
  group.append(toggle); document.querySelector('.map-toolbar').append(group);
  const normalHint = () => { c.$('map-hint').textContent = 'Drag to pan · Scroll to zoom · Click for chunk info'; };
  c.$('map-hover').addEventListener('pointercancel', () => selection?.cancel());
  document.addEventListener('keydown', event => {
    if (!selection?.active) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); selection.cancel(); toggle.focus(); }
    else if (event.key === 'Enter' && event.target === c.$('map-hover')) {
      event.preventDefault(); event.stopImmediatePropagation();
      selection.corner(c.map.pointer ?? { x: c.map.width / 2, y: c.map.height / 2 });
    }
  }, true);
  c.$('tool-dialog').addEventListener('close', () => {
    if (!c.$('tool-dialog').open) { controller?.abort(); if (!selection?.active) selection?.cancel(); }
  });
  c.areaCheck = { refreshRevision() {
    if (c.dialogCurrent(generation) && dialogRevision !== c.state.revision) void dialogRefresh();
    if (selection?.active) c.$('map-hint').textContent = `Drag an area · Touch: tap two corners · Up to ${AREA_CHECK_CAP} chunks · Escape cancels`;
  } };

  function open(chunkIds) {
    lastChunks = chunkIds; let memberId = c.memberId, asMembers = false;
    const panel = c.el('div', undefined, 'area-check-panel'), controls = c.el('div', undefined, 'area-check-controls');
    const summary = c.el('p', `${chunkIds.length} selected chunks · limit ${AREA_CHECK_CAP}`, 'status-detail');
    if (c.$('group-view').checked) {
      const player = c.select(c.state.members.map(member => ({ value: member.id, label: member.name })), memberId);
      player.addEventListener('change', () => { memberId = player.value; void refresh(); });
      controls.append(c.field('Player', player));
    }
    const label = c.el('label', undefined, 'checkbox-field'), members = c.input('checkbox'); members.checked = false;
    members.addEventListener('change', () => { asMembers = members.checked; void refresh(); }); label.append(members, 'As members'); controls.append(label);
    const state = c.el('p', '', 'status-detail'); state.setAttribute('role', 'status');
    const output = c.el('div', undefined, 'area-check-output');
    const selectAgain = c.button('Select another area', () => { c.closeDialog(); toggle.click(); });
    panel.append(summary, controls, state, output, selectAgain); generation = c.openDialog('Area check', panel); dialogRefresh = refresh; void refresh();
    async function refresh() {
      const request = ++sequence; controller?.abort(); controller = new AbortController();
      const revision = c.state.revision, chosenMember = memberId;
      dialogRevision = revision;
      state.textContent = 'Checking tasks and training… You can close this panel while it runs.'; output.replaceChildren(); output.setAttribute('aria-busy', 'true');
      const query = new URLSearchParams({ memberId, chunks: lastChunks.join(','), asMembers: String(asMembers), revision: String(revision) });
      try {
        const [result] = await Promise.all([c.api(`/api/area-check?${query}`, undefined, controller.signal), loadIcons()]);
        if (request !== sequence || !c.dialogCurrent(generation)) return;
        if (c.state.revision !== revision || result.memberId !== chosenMember || result.stateRevision !== revision) throw new Error('The saved map changed. Select the area again.');
        const name = c.state.members.find(member => member.id === memberId)?.name ?? memberId;
        state.textContent = `${name} · ${result.members ? 'Assumes members content' : 'F2P content'}`;
        output.append(renderAreaTasks(c, result.tasks));
        const big = result.rows.filter(row => row.alone.largestGap).sort((a, b) => b.alone.largestGap.size - a.alone.largestGap.size).slice(0, 3);
        if (big.length) output.append(c.el('p', `Biggest gaps in this area: ${big.map(row => `${row.skill} ${row.alone.largestGap.fromLevel} → ${row.alone.largestGap.toLevel}`).join(' · ')}`, 'area-check-biggest'));
        output.append(renderAreaTable(c, result));
        output.append(c.el('p', 'Levels show where methods start; you can keep using an old method. A gap is 15+ levels with no newer usable method. Targets stop at the highest active task requirement: this area alone, or your current chunks plus this area. They follow your task rules and leave out backlogged or completed tasks. No requirement means no gap or “Can’t start” warning. “Can’t start” means no route from your starting level to a needed method or requirement. “With current” includes your partner’s shareable supplies.', 'area-check-note'));
        output.append(c.details('Coverage and assumptions', c.list(result.limitations)));
        const actions = c.el('div', undefined, 'area-check-copy');
        const messages = areaDiscordMessages(result, name);
        messages.forEach((text, index) => {
          const copied = c.el('output'); copied.setAttribute('role', 'status');
          const fallback = c.el('textarea'); fallback.readOnly = true; fallback.hidden = true; fallback.value = text; fallback.rows = 6;
          fallback.setAttribute('aria-label', `Discord message ${index + 1}`);
          actions.append(c.button(messages.length === 1 ? 'Copy for Discord' : `Copy for Discord ${index + 1}/${messages.length}`, async () => {
            try { await navigator.clipboard.writeText(text); copied.textContent = 'Copied'; }
            catch { fallback.hidden = false; fallback.focus(); fallback.select(); copied.textContent = 'Copy the selected text below.'; }
          }), copied, fallback);
        });
        output.append(actions);
      } catch (error) { if (request === sequence && c.dialogCurrent(generation) && error.name !== 'AbortError') { state.textContent = error.message; output.append(c.button('Retry', refresh)); } }
      finally { if (request === sequence) output.setAttribute('aria-busy', 'false'); }
    }
  }
}
