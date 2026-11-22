const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
const read = async route => { const r = await fetch(route, { credentials: 'same-origin', cache: 'no-store' }); const value = await r.json(); if (!r.ok) throw new Error(value.message); return value; };
export async function renderPastMaps(root, id) {
  root.replaceChildren();
  if (!id) {
    const { maps } = await read('/api/past-maps');
    if (!maps.length) root.append(el('p', 'No Past maps yet. Leaving or being removed from a group preserves a map here.'));
    for (const m of maps.slice().reverse()) {
      const row = el('article'), a = el('a', `${m.reason === 'removed' ? 'Removed from group' : m.reason === 'rejoined' ? 'Before joining another group' : 'Left group'} · ${new Date(m.createdAt).toLocaleString()}`); a.href = `/past-maps/${m.id}`;
      row.append(a, el('p', `Character ${m.characterId.slice(-6)} · read only`)); root.append(row);
    }
    return;
  }
  const { metadata, document: saved } = await read(`/api/past-maps/${id}`), state = saved.state;
  const download = el('a', 'Download saved map (JSON)'); download.href = `/api/past-maps/${id}/download`; download.download = `past-map-${id}.json`;
  const all = el('a', 'All Past maps'); all.href = '/past-maps';
  root.append(el('h2', `${metadata.reason === 'removed' ? 'Removed from group' : metadata.reason === 'rejoined' ? 'Before joining another group' : 'Left group'} · ${new Date(metadata.createdAt).toLocaleString()}`), el('p', `Frozen revision ${state.revision}. This saved copy cannot roll, edit or restore group access.`), download, el('span', ' · '), all);
  for (const member of state.members) {
    const section = el('section'); section.append(el('h2', member.name), el('p', `${member.unlocked.length} unlocked chunks · ${member.completedTasks.length} completed tasks${member.id === metadata.memberId ? ' · Your former slot' : ''}`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${member.name} saved chunk map`);
    const points = member.unlocked.map(id => ({ id, x: Math.floor(Number(id) / 256), y: -(Number(id) % 256) }));
    const xs = points.map(p => p.x), ys = points.map(p => p.y), minX = points.length ? Math.min(...xs) : 0, minY = points.length ? Math.min(...ys) : 0, maxX = Math.max(...xs, minX + 1), maxY = Math.max(...ys, minY + 1);
    svg.setAttribute('viewBox', `${minX - 1} ${minY - 1} ${maxX - minX + 3} ${maxY - minY + 3}`);
    for (const p of points) { const rect = document.createElementNS(svg.namespaceURI, 'rect'); rect.setAttribute('x', p.x); rect.setAttribute('y', p.y); rect.setAttribute('width', '.95'); rect.setAttribute('height', '.95'); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `Chunk ${p.id}${member.notes?.[p.id] ? ': ' + member.notes[p.id] : ''}`; rect.append(title); svg.append(rect); }
    if (points.length) section.append(svg);
    const chunks = el('details'); chunks.append(el('summary', 'Saved chunks and notes'));
    for (const chunk of member.unlocked) chunks.append(el('p', `Chunk ${chunk}${member.notes?.[chunk] ? ' · ' + member.notes[chunk] : ''}`)); section.append(chunks);
    if (member.journal) section.append(el('h3', 'Journal'), el('p', member.journal));
    const progress = el('details'); progress.append(el('summary', 'Saved progress, checks and settings'));
    const pre = el('pre', JSON.stringify(member, null, 2)); progress.append(pre); section.append(progress); root.append(section);
  }
  const rules = el('details'); rules.append(el('summary', 'Saved group rules, goals and definitions'), el('pre', JSON.stringify({ rules: state.rules, groupGoals: state.groupGoals, finishLine: state.finishLine, tasks: state.tasks }, null, 2))); root.append(rules);
  const history = el('details'); history.append(el('summary', `History · ${state.history.length} events (latest 200 shown; download keeps all)`));
  for (const e of state.history.slice(-200).reverse()) history.append(el('p', `${e.at} · ${e.actor?.label || e.command?.memberId || 'Group'} · ${e.type}`)); root.append(history);
}
if (globalThis.document?.getElementById('past-maps')) void renderPastMaps(document.getElementById('past-maps'), location.pathname.split('/')[2]).catch(e => { document.getElementById('past-error').textContent = e.message; });
