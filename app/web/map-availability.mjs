import { createPassivePoolRankingClient } from './pool-ranking.mjs';

export const AVAILABILITY_HELP = 'Newly available, non-hidden obligatory task IDs, with progress held fixed. Includes completed and backlogged entries and alternative methods. Additions only: not unfinished goals, net gain, time or desirability. Uses saved comparison and preview counts; this layer starts no calculations.';
const valid = value => Number.isSafeInteger(value) && value >= 0;

/** A display projection of retained full-pool counts, never of bounded examples. */
export function projectAvailability(response, ids, skill = '') {
  const rows = new Map((response?.rows ?? []).map(row => [String(row.id), row]));
  const counts = new Map();
  let checked = 0, maximum = 0;
  for (const id of new Set(ids.map(String))) {
    const row = rows.get(id);
    const value = skill ? row?.bySkill?.[skill]?.count ?? 0 : row?.count;
    const count = row?.status === 'checked' && valid(value) ? value : null;
    counts.set(id, count);
    if (count !== null) { checked++; maximum = Math.max(maximum, count); }
  }
  return { counts, checked, total: counts.size, maximum, skill };
}

export function availabilityDescription(model, id) {
  if (!model?.counts.has(id)) return [];
  const value = model.counts.get(id);
  return [`New task options${model.skill ? ` (${model.skill})` : ''}: ${value === null ? 'unknown; no saved count' : `${value}; checked`}.`];
}

/** Inset heat leaves ownership edges and normal click targets intact. Unknown is
 * dashed, checked zero is solid, and only checked positives enter the scale. */
export function drawAvailabilityCell(context, model, id, x, y, size) {
  if (!model?.counts.has(id) || size < 7) return;
  const count = model.counts.get(id), inset = Math.min(5, size * .18), side = size - inset * 2;
  context.save();
  context.lineWidth = 1.5; context.setLineDash([]);
  if (count === null) {
    context.strokeStyle = '#b8c6d4'; context.setLineDash([3, 3]);
  } else {
    context.strokeStyle = count === 0 ? '#fff' : '#ffc857';
    if (count > 0) {
      context.fillStyle = `rgba(255,174,35,${.12 + .38 * count / Math.max(1, model.maximum)})`;
      context.fillRect(x + inset, y + inset, side, side);
    }
  }
  context.strokeRect(x + inset, y + inset, side, side);
  if (size >= 48) {
    const text = count === null ? '?' : `+${count}`;
    const font = Math.min(14, Math.max(11, size * .11));
    context.font = `bold ${font}px Calibri, "Segoe UI", sans-serif`;
    const width = Math.min(side, (context.measureText?.(text)?.width ?? text.length * font * .65) + 6);
    context.setLineDash([]); context.fillStyle = '#071017';
    context.fillRect(x + inset, y + inset, width, font + 5);
    context.fillStyle = count === null ? '#cbd5df' : '#fff';
    context.textAlign = 'left'; context.textBaseline = 'top';
    context.fillText(text, x + inset + 3, y + inset + 2, Math.max(1, width - 6));
  }
  context.restore();
}

export function createMapAvailability(c) {
  let enabled = false, skill = '', data, key, signature, view, legendNode, error = '';
  let model = projectAvailability(undefined, []);
  const ids = () => (c.pool?.eligible ?? []).map(row => String(row.id));
  const scope = () => ({ memberId: c.memberId, revision: c.state?.revision,
    pickerId: c.panelContext?.pickerSession?.pickerId ?? 'legacy', datasetDigest: c.dataset?.digest,
    candidatesKey: ids().join(','), sandboxActive: !!c.sandbox?.active });
  const client = createPassivePoolRankingClient({
    api: (...args) => c.api(...args), scope, hidden: () => !!globalThis.document?.hidden,
    onUpdate: value => { data = value; error = ''; paint(); },
    onError: () => { error = 'Saved counts could not refresh. Retrying…'; sync(); },
  });
  const status = () => c.sandbox?.active ? 'Unavailable in Sandbox.'
    : `${model.checked} of ${model.total} checked · ${model.total - model.checked} unknown. ${error}`.trim();
  const name = id => c.plain(c.world?.chunks.get(id)?.name) || `Chunk ${id}`;

  function sync() {
    if (legendNode) { legendNode.hidden = !enabled; legendNode.textContent = `New task options: ${status()} Gold = more options · solid white = checked zero · dashed = unknown.`; }
    if (!view) return;
    view.toggle.checked = enabled;
    view.content.hidden = !enabled;
    view.note.textContent = status();
    view.select.disabled = !!c.sandbox?.active;
  }
  function paint() {
    model = projectAvailability(data, ids(), skill);
    const next = JSON.stringify([enabled, key, skill, [...model.counts]]);
    if (next !== signature) {
      signature = next;
      c.map?.setAvailability?.(enabled && !c.sandbox?.active ? model : null);
      if (view) {
        const active = globalThis.document?.activeElement, focused = view.list.contains(active);
        const scrollTop = view.list.scrollTop;
        const skills = [...new Set((data?.rows ?? []).flatMap(row => Object.keys(row.bySkill ?? {})))];
        if (skill && !skills.includes(skill)) skills.push(skill);
        view.select.replaceChildren(...['', ...skills.sort()].map(value => {
          const option = c.el('option', value || 'All task options'); option.value = value; return option;
        })); view.select.value = skill;
        view.list.replaceChildren(...[...model.counts].map(([id, count]) => {
          let entry = view.entries.get(id);
          if (!entry) {
            const row = c.el('li'), button = c.button('', () => c.map.centerOnChunk(id));
            row.append(button); entry = { row, button }; view.entries.set(id, entry);
          }
          entry.button.textContent = `${name(id)}: ${count === null ? 'unknown' : `+${count} checked`}`;
          return entry.row;
        }));
        for (const id of view.entries.keys()) if (!model.counts.has(id)) view.entries.delete(id);
        if (focused && active.isConnected) active.focus({ preventScroll: true });
        view.list.scrollTop = scrollTop;
      }
    }
    sync();
  }
  function refresh() {
    const next = JSON.stringify(scope());
    if (next !== key) { key = next; data = undefined; error = ''; }
    paint();
    client.setActive(enabled); client.refresh();
  }
  function controls() {
    const group = c.el('section', undefined, 'map-availability-controls');
    const label = c.el('label', undefined, 'map-display-option'), toggle = c.input('checkbox');
    toggle.id = 'map-availability-toggle'; label.append(toggle, c.el('span', 'New task options'));
    const content = c.el('div'), note = c.el('p', '', 'map-display-note'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
    const help = c.el('p', AVAILABILITY_HELP, 'map-display-note');
    const keyNote = c.el('p', 'Gold: more options · solid white: checked zero · dashed / ?: unknown. Zoom in for counts.', 'map-display-note');
    const selectLabel = c.el('label', 'Skill '), select = c.el('select'); select.setAttribute('aria-label', 'New task options skill'); selectLabel.append(select);
    const details = c.el('details'), summary = c.el('summary', 'Inspect new task options'), list = c.el('ol');
    details.append(summary, list); content.append(note, help, keyNote, selectLabel, details); group.append(label, content);
    view = { toggle, content, note, select, list, entries: new Map() };
    toggle.addEventListener('change', () => { enabled = toggle.checked; refresh(); c.renderLegend?.(); });
    select.addEventListener('change', () => { skill = select.value; paint(); });
    signature = undefined; paint(); return group;
  }
  globalThis.document?.addEventListener('visibilitychange', refresh);
  globalThis.addEventListener?.('pagehide', () => client.dispose());
  return { controls, refresh, legend() { legendNode = c.el('span', '', 'map-availability-legend'); sync(); return legendNode; } };
}
