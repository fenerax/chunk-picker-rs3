// Search-owned lookups: saved notes never enter the immutable world index.
export function chunkNotesForSearch(members) {
  const notes = new Map();
  for (const member of members ?? []) for (const [id, value] of Object.entries(member.notes ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const entries = notes.get(id) ?? [];
    entries.push({ memberId: member.id, name: member.name, text: value, search: value.toLowerCase() });
    notes.set(id, entries);
  }
  return notes;
}

export function matchingSearchChunks(index, notes, query, areas = new Map()) {
  query = query.toLowerCase().trim();
  return index.filter(entry => !query || entry.search.includes(query) || notes.get(entry.id)?.some(note => note.search.includes(query)))
    .sort((a, b) => Number(b.id.toLowerCase() === query) - Number(a.id.toLowerCase() === query)
      || Number(b.name?.toLowerCase().trim() === query) - Number(a.name?.toLowerCase().trim() === query)
      || Number(areas.has(a.id)) - Number(areas.has(b.id)));
}

export function searchNoteExcerpt(text, query, limit = 160) {
  text = text.replace(/\s+/g, ' ').trim();
  const position = text.toLowerCase().indexOf(query.replace(/\s+/g, ' '));
  const start = Math.max(0, position - 45);
  return `${start ? '…' : ''}${text.slice(start, start + limit)}${text.length > start + limit ? '…' : ''}`;
}

// Original picker index.js item-source ordering: ranked rates first, most common
// first, and stable ties. Use computed probabilities for nested drop tables.
export function searchSourceRate(source) {
  if (source.kind === 'shop') return 1;
  if (source.kind !== 'drop' && source.rate === undefined && source.probability === undefined && !source.unknownRate) return null;
  if (source.unknownRate) return 1 / 999999999999999;
  if (Number.isFinite(source.probability) && source.probability >= 0) return source.probability;
  const rate = String(source.rate ?? '').replaceAll(',', '').trim();
  if (rate === 'Always') return 1;
  const fraction = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(rate);
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
  return 1 / 999999999999999;
}

export function sortSearchSources(sources = []) {
  return sources.map(source => ({ source, rate: searchSourceRate(source) }))
    .sort((a, b) => Number(b.rate !== null) - Number(a.rate !== null) || (b.rate ?? 0) - (a.rate ?? 0))
    .map(entry => entry.source);
}

export function searchLocations(record) {
  const ids = new Set();
  const add = value => {
    if (typeof value === 'string' || typeof value === 'number') ids.add(String(value));
    else if (value) add(value.location ?? value.chunkId ?? value.id);
  };
  for (const value of record.locations ?? record.chunks ?? []) add(value);
  for (const source of record.sources ?? []) {
    add(source.location);
    for (const location of source.locations ?? []) add(location);
  }
  if (record.location) add(record.location);
  if (record.primary && typeof record.primary === 'object') for (const id of searchLocations(record.primary)) ids.add(id);
  return [...ids];
}

export function searchPage(entries, page, size = 120) {
  const pages = Math.max(1, Math.ceil(entries.length / size));
  page = Math.max(0, Math.min(page, pages - 1));
  return { entries: entries.slice(page * size, (page + 1) * size), page, pages,
    first: entries.length ? page * size + 1 : 0, last: Math.min((page + 1) * size, entries.length) };
}
