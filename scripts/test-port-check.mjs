import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Catch literal listener arguments/options and named constants used by them,
// including quoted numbers and separators. Test listeners should use OS port 0.
export function hardCodedTestPorts(source) {
  const pattern = /(?:\bport\b["']?\s*[:=]\s*|\.listen\s*\(\s*)(["']?)([89](?:_?\d){3})\b\1/gi;
  const matches = [...source.matchAll(pattern)];
  const declarations = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(["']?)([89](?:_?\d){3})\b\2/g;
  for (const match of source.matchAll(declarations)) {
    const identifier = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usage = new RegExp(`(?:\\bport\\b["']?\\s*:\\s*|\\.listen\\s*\\(\\s*)${identifier}(?![\\w$])`);
    if (usage.test(source) && !matches.some(existing => existing.index >= match.index && existing.index < match.index + match[0].length)) {
      matches.push({ index: match.index, 2: match[3] });
    }
  }
  return matches.sort((a, b) => a.index - b.index).map(match => ({
    line: source.slice(0, match.index).split('\n').length,
    port: Number(match[2].replaceAll('_', '')),
  }));
}

export async function checkTestPorts(directory, names) {
  const violations = (await Promise.all(names.map(async name => {
    const source = await readFile(directory instanceof URL ? new URL(name, directory) : path.join(directory, name), 'utf8');
    return hardCodedTestPorts(source).map(({ line, port }) => `${name}:${line} (port ${port})`);
  }))).flat();
  if (violations.length) throw new Error(`Hard-coded test listen ports: ${violations.join(', ')}. Use port: 0 and read the bound address.`);
}
