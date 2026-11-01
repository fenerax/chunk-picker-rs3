let sequence = 0;
// Chunk-data access is how the picker has always judged places. It stays a
// named gap in the proof (for audits) but reads as one footnote, not a step.
const SOFT_GAPS = new Set(['resource-only-access']);

// Postorder preserves dependency order, including shared prerequisites. The DAG
// remains intact; only redundant bookkeeping is folded out of the player view.
export function taskHowSteps(proof, { advanced = false, locationName = () => '' } = {}) {
  const nodes = proof.nodes ?? {}, folded = new Set(), routes = new Map(), purposes = new Map();
  const strip = text => String(text ?? '').replace(/[.!]$/, '');
  const place = (id, fallback) => {
    const name = locationName(id) || fallback || id;
    return /^(?:(?:chunk|surface region) )?\d+(?:-\d+)?$/i.test(name) ? 'your unlocked chunk' : name;
  };
  for (const node of Object.values(nodes)) {
    if (node.preparationOnly) {
      const seen = new Set();
      const annotate = id => {
        if (seen.has(id)) return; seen.add(id);
        const child = nodes[id]; if (!child) return;
        if (child.kind === 'item-source') purposes.set(id, node.taskLabel.replace(/^Obtain (?:an? )?/i, ''));
        else if (child.kind === 'requirement') for (const next of child.allOf ?? []) annotate(next);
      };
      for (const child of node.allOf ?? []) annotate(child);
    }
    if (node.kind === 'item-source') for (const child of node.allOf ?? []) if (nodes[child]?.kind === 'placement') folded.add(child);
    if (node.kind !== 'location' || !node.areaAccess || !node.from) continue;
    const seen = new Set();
    const route = id => {
      if (seen.has(id)) return; seen.add(id);
      const entry = nodes[id]; if (!entry) return;
      if (entry.kind === 'task' && entry.category === 'Nonskill') {
        folded.add(id);
        if (entry.allOf.some(child => nodes[child]?.field === 'Chunks' && nodes[child].selectedSubjects?.includes(node.from))) routes.set(node, entry.taskLabel);
      } else if (entry.field !== 'Tasks') return;
      for (const child of entry.allOf ?? []) route(child);
    };
    for (const child of node.allOf ?? []) route(child);
  }
  const placements = node => (node.allOf ?? []).flatMap(id => {
    const child = nodes[id];
    return child?.kind === 'placement' && child.location ? [child]
      : child?.kind === 'requirement' && ['Monsters', 'Monster', 'Objects', 'NPCs', 'Shops', 'Mix', 'Placements'].includes(child.field) ? placements(child) : [];
  });
  const steps = [], visited = new Set();
  const visit = id => {
    if (visited.has(id)) return; visited.add(id);
    const node = nodes[id]; if (!node) return;
    const preparation = id => nodes[id]?.field === 'Tasks' || nodes[id]?.kind === 'skill' ? 0 : nodes[id]?.field === 'Items' ? 1 : 2;
    for (const child of [...(node.allOf ?? [])].sort((a, b) => preparation(a) - preparation(b))) visit(child);
    if (!advanced && (folded.has(id) || ['requirement', 'policy', 'training-method'].includes(node.kind)
      || node.kind === 'gap' && SOFT_GAPS.has(node.gap)
      || node.kind === 'location' && node.rule === 'owned-chunk' && node.evidenceClass !== 'manual'
      || node.preparationOnly)) return;
    let label = node.label;
    if (node.kind === 'location' && node.from) {
      let via = routes.get(node);
      if (via) {
        via = via.replace(new RegExp(`^(?:Access|Enter) (?:the )?${String(node.subjectId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} via `, 'i'), '');
        if (via === node.from) via = place(node.from, node.fromName);
      }
      const from = place(node.from, node.fromName);
      label = `Get into ${place(node.subjectId, node.placeName)} ${via && via !== from ? `via ${strip(via)} in ${from}` : `from ${from}`}.`;
    } else if (node.kind === 'placement' && node.location) label = `Find ${node.subjectId} in ${place(node.location, node.placeName)}.`;
    else if (node.kind === 'item-source' && node.sourceKind !== 'recorded') {
      const source = { spawn: 'item spawn', drop: `drop from ${node.sourceName}`, shop: `buy from ${node.sourceName}`, object: node.sourceName }[node.sourceKind];
      label = `Get ${node.subjectId}${purposes.has(id) ? ` (${purposes.get(id)})` : ''}${source ? ` — ${source}` : ''}${node.location ? ` in ${place(node.location, node.placeName)}` : ''}.`;
    } else if (node.kind === 'task' && node.taskLabel) {
      // allOf contains the selected witnesses: every exported placement is needed.
      // OR and count groups have already selected one sufficient set in the proof.
      const places = [...new Set(placements(node).map(child => place(child.location, child.placeName)))];
      label = `${node.areaUnlock ? 'Get into ' : ''}${strip(node.taskLabel)}${node.instruction ? `: ${strip(node.instruction)}` : ''}${places.length && !node.areaUnlock ? ` — in ${places.join(' and ')}` : ''}.`;
    }
    if (!advanced && node.kind === 'placement' && node.location && Object.values(nodes).some(parent => parent.kind === 'task' && !parent.areaUnlock && placements(parent).includes(node))) return;
    steps.push({ id, node, label });
  };
  visit(proof.root); return steps;
}

export function renderTaskHow(proof, { document, advanced = false, locationName } = {}) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const card = el('div', undefined, 'task-why-content');
  card.append(el('strong', 'How the picker reaches this planning result'));
  const gaps = proof.gaps ?? [], soft = gaps.some(gap => SOFT_GAPS.has(gap.kind));
  const hard = proof.proofStatus !== 'complete' && (!gaps.length || gaps.some(gap => !SOFT_GAPS.has(gap.kind)));
  if (hard) card.append(el('p', "The picker can't show this step yet. This is a partial explanation.", 'status-detail'));
  const steps = el('ol', undefined, 'task-how-steps');
  for (const { id, node, label } of taskHowSteps(proof, { advanced, locationName })) {
    const step = el('li', label);
    if (advanced) step.append(el('small', ` ${node.subjectId ?? id} · ${node.rule ?? node.gap ?? node.kind}`, 'task-meta'));
    steps.append(step);
  }
  card.append(steps);
  if (soft && !advanced) card.append(el('p', "Places come from the chunk data. The picker hasn't checked the exact walking route to each one.", 'status-detail'));
  return card;
}

/** Closure-local request state: no new screen-context/VM globals. */
export function appendTaskHow(row, task, { document, button, load, scope, advanced = () => false, locationName, readOnly = false, enabled = true }) {
  if (!enabled || task.status !== 'available') return;
  const panel = document.createElement('div'); panel.className = 'task-why-panel task-how-panel'; panel.hidden = true;
  panel.id = `task-how-${++sequence}`; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', `How to do ${task.label}`);
  const toggle = button('How?', () => open(), 'task-how task-why-link');
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', panel.id);
  let version = 0, controller;
  function close() { version++; controller?.abort(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); panel.setAttribute('aria-busy', 'false'); }
  async function refresh() {
    const current = ++version, captured = scope(); controller?.abort(); controller = new AbortController();
    panel.setAttribute('aria-busy', 'true'); panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Checking the planning path…', className: 'task-why-loading' }));
    try {
      if (readOnly) { panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'How is not available in this saved view. Opening it cannot start a calculator.' })); return; }
      const proof = await load(task, controller.signal);
      if (current !== version) return;
      if (captured !== scope()) throw new Error('The selected map or saved state changed. Open How again.');
      panel.replaceChildren(renderTaskHow(proof, { document, advanced: advanced(), locationName }));
    } catch (error) {
      if (current !== version || error.name === 'AbortError') return;
      const retry = button('Retry How', () => refresh(), 'task-why-retry');
      panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: error.message || 'This path is unavailable. Try again.' }), retry);
    } finally { if (current === version) panel.setAttribute('aria-busy', 'false'); }
  }
  function open() { if (!panel.hidden) { close(); return; } panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); return refresh(); }
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); toggle.focus?.(); } });
  row.append(toggle, panel); return toggle;
}
