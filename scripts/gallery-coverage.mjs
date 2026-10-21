import { readFile, readdir } from 'node:fs/promises';

// Titles (including dynamic templates) are a stable registration seam. A line
// number changes during edits; a new title needs an explicit coverage decision.
export function dialogRegistrations(sources) {
  const records = [];
  const titles = /\bopenDialog(?:\?\.)?\s*\(\s*((?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|[^,\n)]+)/g;
  for (const [file, source] of sources) {
    for (const match of source.matchAll(titles)) {
      if (/function\s+$/.test(source.slice(Math.max(0, match.index - 20), match.index))) continue;
      const title = match[1].trim().replace(/\s+/g, ' ');
      const key = `${file} :: ${title}`;
      if (!records.some(record => record.key === key)) records.push({ key, file, title });
    }
  }
  return records.sort((a, b) => a.key.localeCompare(b.key));
}
export async function readGallerySources() {
  const directory = new URL('../app/web/', import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith('.mjs') && !file.startsWith('gallery'));
  return new Map(await Promise.all(files.map(async file => [`app/web/${file}`, await readFile(new URL(file, directory), 'utf8')])));
}
export function requiredInventoryNodes(inventory) {
  return inventory.nodes.filter(node => node.kind === 'dialog' || node.id.startsWith('region:') ||
    (node.id.startsWith('dom:') && ['panel', 'region', 'toolbar', 'banner'].includes(node.kind)) || node.id === 'helper');
}
export function shellSurfaceNodes(shell) {
  return [...shell.matchAll(/<(?:header|nav|main|aside|section|dialog|details)\b[^>]*\bid="([^"]+)"/g)]
    .map(match => ({ id: `dom:${match[1]}`, kind: 'region', label: match[1] }));
}
export function coverageProblems({ inventory, registrations, entries, exclusions, registrationCoverage }) {
  const entryIds = new Set(entries.map(entry => entry.id)), covered = new Set(entries.flatMap(entry => entry.covers));
  const problems = [];
  for (const node of requiredInventoryNodes(inventory)) if (!covered.has(node.id) && !exclusions[node.id]?.trim()) problems.push(`Inventory entry missing: ${node.id} (${node.label})`);
  for (const record of registrations) {
    const coverage = registrationCoverage[record.key];
    if (!coverage || (!coverage.entries?.length && !coverage.reason?.trim())) problems.push(`Dialog registration missing: ${record.key}`);
    else if (coverage.entries?.some(id => !entryIds.has(id))) problems.push(`Unknown gallery entry for ${record.key}`);
  }
  for (const key of Object.keys(registrationCoverage)) if (!registrations.some(record => record.key === key)) problems.push(`Retired registration coverage: ${key}`);
  for (const [id, reason] of Object.entries(exclusions)) if (!reason?.trim()) problems.push(`Exclusion needs a reason: ${id}`);
  if (entryIds.size !== entries.length) problems.push('Duplicate gallery entry IDs');
  return problems;
}
