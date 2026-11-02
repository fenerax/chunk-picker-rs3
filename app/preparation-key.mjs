import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

let sources;
export function preparationSourceDigest() {
  if (sources) return sources;
  const root = new URL('./', import.meta.url), digest = createHash('sha256');
  function visit(directory) {
    for (const entry of readdirSync(new URL(directory, root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = directory + entry.name;
      if (entry.isDirectory()) visit(relative + '/');
      else if (entry.isFile() && entry.name.endsWith('.mjs')) digest.update(relative).update('\0').update(readFileSync(new URL(relative, root)));
    }
  }
  visit('');
  return sources = digest.digest('hex');
}
export function inputValidationKey(digest, environment) {
  try {
    if (typeof digest !== 'string') return;
    return createHash('sha256').update(JSON.stringify([1, digest, environment, preparationSourceDigest(), process.versions.node])).digest('hex');
  } catch { /* Unreadable sources disable optional validation reuse. */ }
}
