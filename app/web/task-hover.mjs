import { itemIcon, skillIcon } from './icons.mjs';
import { taskItemIcon } from './task-artwork.mjs';
import { taskIcon } from './browser-task-icons.mjs';
import { renderTaskEquipment } from './task-equipment.mjs';

const plain = value => String(value ?? '').replace(/~\|([^|]*)\|~/g, (_, label) => label.split('#')[0]).replace(/\[\+\]/g, '').replace(/<[^>]*>/g, '').trim();

/** Prefer the space beside a row; narrow screens use the space above or below it. */
export function taskHoverPosition(row, card, viewport) {
  const padding = 8, gap = 10, width = Math.min(card.width || 320, viewport.width - padding * 2);
  const height = Math.min(card.height || 240, viewport.height - padding * 2);
  const clamp = (value, maximum) => Math.max(padding, Math.min(value, maximum));
  if (row.left - gap - padding >= width) return { left: row.left - gap - width, top: clamp(row.top, viewport.height - height - padding), width, maxHeight: viewport.height - padding * 2, side: 'left' };
  if (viewport.width - row.right - gap - padding >= width) return { left: row.right + gap, top: clamp(row.top, viewport.height - height - padding), width, maxHeight: viewport.height - padding * 2, side: 'right' };
  const above = Math.max(0, row.top - gap - padding), below = Math.max(0, viewport.height - row.bottom - gap - padding);
  const useAbove = above >= height || above > below, maxHeight = useAbove ? above : below;
  return { left: clamp(row.left, viewport.width - width - padding), top: useAbove ? row.top - gap - Math.min(height, maxHeight) : row.bottom + gap, width, maxHeight, side: useAbove ? 'above' : 'below' };
}

export function taskHoverSources(task, locationName = value => value) {
  const rows = [];
  for (const source of task.sources ?? []) {
    const locations = [...new Set([source.location, ...(Array.isArray(source.locations) ? source.locations : source.locations ? [source.locations] : [])].filter(Boolean))];
    const places = (Array.isArray(locations) ? locations : [locations]).slice(0, 2).map(location => plain(locationName(typeof location === 'object' ? location.id ?? location.location ?? location.name : location))).filter(Boolean);
    const name = plain(source.source ?? source.name ?? source.task ?? source.kind);
    const label = [name, places.join(', ')].filter(Boolean).join(' · ');
    if (label && !rows.includes(label)) rows.push(label);
    if (rows.length === 3) break;
  }
  if (!rows.length) {
    const declared = task.record?.Chunks ?? task.locations ?? [];
    for (const location of (Array.isArray(declared) ? declared : [declared]).slice(0, 3)) {
      const label = plain(locationName(location)); if (label) rows.push(label);
    }
  }
  return rows;
}

export function renderTaskHover(task, { document, result, equipment = {}, locationName, iconLookup = itemIcon, skillLookup = skillIcon } = {}) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const card = el('div', undefined, 'task-hover-content'), heading = el('div', undefined, 'task-hover-heading');
  const url = taskIcon(task, { itemIcon: name => taskItemIcon(name, iconLookup), skillIcon: skillLookup });
  if (url) { const image = el('img', undefined, 'task-hover-icon'); image.src = url; image.alt = ''; image.width = image.height = 32; heading.append(image); }
  heading.append(el('strong', plain(task.label))); card.append(heading);
  const asks = plain(task.record?.Description ?? task.description);
  if (asks) card.append(el('p', asks, 'task-hover-asks'));
  card.append(el('p', `${task.category}${task.level && !(task.generated && task.category === 'BiS') ? ` · Level ${task.level}` : ''}`, 'task-hover-meta'));
  const availability = task.status === 'available' ? 'Doable now' : plain(task.blockers?.[0]?.detail) || (task.status === 'completed' ? 'Completed' : 'Needs review');
  const state = el('p', availability, 'task-hover-state'); state.dataset.doable = task.status === 'available'; card.append(state);
  const stats = renderTaskEquipment(task, result, equipment, { document, compact: true, iconLookup });
  if (stats) card.append(stats);
  const sources = taskHoverSources(task, locationName);
  if (sources.length) { const list = el('ul', undefined, 'task-hover-sources'); sources.forEach(source => list.append(el('li', source))); card.append(list); }
  return card;
}

let sequence = 0;
/** One controller reuses the existing full-result cache. It never loads while rendering rows. */
export function createTaskHover({ document = globalThis.document, viewport = globalThis.window, getScope = () => '', getDetails, getContext = () => ({}), setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout } = {}) {
  const card = document.createElement('aside'); card.className = 'task-hover'; card.id = `task-hover-${++sequence}`; card.hidden = true; card.setAttribute('role', 'tooltip');
  let active, timer, version = 0, suppressClick = false, touchStart;
  function hide() {
    cancel(timer); timer = undefined; version++;
    if (active) {
      if (active.description) active.target.setAttribute('aria-describedby', active.description);
      else active.target.removeAttribute?.('aria-describedby');
    }
    active = undefined; card.hidden = true; touchStart = undefined; suppressClick = false;
  }
  function position() {
    if (!active || !active.row.isConnected) { hide(); return; }
    card.style.maxHeight = ''; card.style.width = `${Math.min(320, viewport.innerWidth - 16)}px`;
    const point = taskHoverPosition(active.row.getBoundingClientRect(), card.getBoundingClientRect(), { width: viewport.innerWidth, height: viewport.innerHeight });
    for (const key of ['left', 'top', 'width', 'maxHeight']) card.style[key] = `${point[key]}px`;
    card.dataset.side = point.side;
  }
  function paint(task) { card.replaceChildren(renderTaskHover(task, { document, ...getContext() })); position(); }
  function schedule(row, target, task, mode) {
    if (active?.row === row && !card.hidden) {
      if (active.target !== target) {
        if (active.description) active.target.setAttribute('aria-describedby', active.description);
        else active.target.removeAttribute?.('aria-describedby');
        active.target = target; active.description = target.getAttribute?.('aria-describedby');
        target.setAttribute('aria-describedby', [active.description, card.id].filter(Boolean).join(' '));
      }
      return;
    }
    hide(); const current = ++version, scope = getScope();
    active = { row, target, task, mode, description: target.getAttribute?.('aria-describedby') };
    timer = later(async () => {
      if (current !== version || scope !== getScope() || !row.isConnected) return;
      if (!card.isConnected) document.body.append(card);
      card.hidden = false; target.setAttribute('aria-describedby', [active.description, card.id].filter(Boolean).join(' '));
      if (mode === 'touch') suppressClick = true;
      paint(task);
      if (!getDetails) return;
      try {
        const detailed = await getDetails(task);
        if (current === version && scope === getScope() && detailed && row.isConnected) paint(detailed);
      } catch {
        if (current === version && !card.hidden) { const note = document.createElement('p'); note.className = 'task-hover-meta'; note.textContent = 'More details unavailable. Open the task to retry.'; card.firstChild?.append(note); position(); }
      }
    }, mode === 'touch' ? 500 : 250);
  }
  function attach(row, target, task) {
    row.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') schedule(row, target, task, 'pointer'); });
    row.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch' && active?.row === row) hide(); });
    row.addEventListener('focusin', event => { if (active?.mode !== 'touch') schedule(row, event.target ?? target, task, 'focus'); });
    row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget) && active?.row === row) hide(); });
    row.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || !target.contains(event.target)) return;
      suppressClick = false; schedule(row, target, task, 'touch'); touchStart = { x: event.clientX, y: event.clientY };
    });
    row.addEventListener('pointermove', event => { if (touchStart && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 10) { suppressClick = false; hide(); } });
    row.addEventListener('pointerup', event => { if (event.pointerType === 'touch') { touchStart = undefined; if (card.hidden) hide(); } });
    row.addEventListener('pointercancel', hide);
    row.addEventListener('contextmenu', event => { if (active?.mode === 'touch') event.preventDefault(); });
    row.addEventListener('click', event => { if (suppressClick && active?.row === row) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  const escape = event => { if (event.key === 'Escape' && active) hide(); };
  const outside = event => { if (active && !active.row.contains(event.target)) { suppressClick = false; hide(); } };
  document.addEventListener?.('keydown', escape);
  document.addEventListener?.('pointerdown', outside, true);
  viewport?.addEventListener?.('scroll', hide, true);
  viewport?.addEventListener?.('resize', hide);
  return { attach, hide, element: card, dispose() { hide(); card.remove(); document.removeEventListener?.('keydown', escape); document.removeEventListener?.('pointerdown', outside, true); viewport?.removeEventListener?.('scroll', hide, true); viewport?.removeEventListener?.('resize', hide); } };
}
