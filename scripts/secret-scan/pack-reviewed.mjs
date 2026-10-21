import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { categories } from './scan.mjs';

const defaultPath = fileURLToPath(new URL('./pack-reviewed.json', import.meta.url));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new TypeError('Invalid reviewed pack exceptions.'); };
const keys = ['path', 'category', 'sha256', 'reason', 'jsonPaths', 'corpusSha256'];

function safePath(value) {
  if (typeof value !== 'string') return false;
  const name = value.endsWith('#gzip-transport') ? value.slice(0, -15) : value;
  if (!name || name.length > 512 || /[\\:\u0000-\u001f\u007f%#<>"|?*]/u.test(name)) return false;
  const parts = name.split('/');
  return /^(?:duo-data|duo-rules-text|duo-art)$/.test(parts[0]) && parts.length > 1
    && parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

/** Exact payload receipts only; never adds scanner-wide hosts or placeholders. */
export function loadPackReviewed(file = defaultPath) {
  let document;
  try { document = JSON.parse(readFileSync(file, 'utf8')); } catch { invalid(); }
  if (!plain(document) || document.schemaVersion !== 1 || !Array.isArray(document.entries)
    || Object.keys(document).some(key => !['schemaVersion', 'entries'].includes(key))) invalid();
  const seen = new Set();
  const entries = document.entries.map(row => {
    if (!plain(row) || Object.keys(row).some(key => !keys.includes(key))
      || !safePath(row.path) || !categories.includes(row.category) || !digest(row.sha256)
      || typeof row.reason !== 'string' || !row.reason.trim()
      || (row.category === 'private-fingerprint' ? !digest(row.corpusSha256) : row.corpusSha256 !== undefined)
      || (row.jsonPaths !== undefined && (!Array.isArray(row.jsonPaths) || !row.jsonPaths.length
        || row.jsonPaths.some(pointer => typeof pointer !== 'string' || !pointer.startsWith('/')
          || /[\u0000-\u001f\u007f]/u.test(pointer) || /~(?:[^01]|$)/u.test(pointer))
        || new Set(row.jsonPaths).size !== row.jsonPaths.length))) invalid();
    const key = JSON.stringify([row.path, row.category, row.sha256, row.corpusSha256 ?? null]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return Object.freeze({ ...row, ...(row.jsonPaths ? { jsonPaths: Object.freeze([...row.jsonPaths]) } : {}) });
  });
  return Object.freeze(entries);
}

/** A new corpus invalidates every private-value exception from an older review. */
export function reviewedPackCategories(path, sha256, reviewed, corpusSha256) {
  return new Set(reviewed.filter(row => row.path === path && row.sha256 === sha256
    && (row.category !== 'private-fingerprint' || (digest(corpusSha256) && row.corpusSha256 === corpusSha256)))
    .map(row => row.category));
}
