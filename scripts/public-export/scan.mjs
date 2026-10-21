import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { allowedBytes, blocked, hardDenied, isMain, maxFileBytes, noLinks, safeRelative, sha256, textBytes, validateProvenance } from './common.mjs';
import { defaultCorpusDir, fingerprintLines, loadCorpus, normalize } from './fingerprints.mjs';

const provenancePath = fileURLToPath(new URL('./placeholder-provenance.json', import.meta.url));
const exceptionsPath = fileURLToPath(new URL('./reviewed-exceptions.json', import.meta.url));
const genericIPs = new Set(['0.0.0.0', '127.0.0.0', '127.0.0.1', '100.64.0.0']);
const standardFormatURLs = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);
const patterns = [
  ['machine-path', /(?:\b[a-z]:\/users\/|\/(?:home|users|root)\/[^\s/"']+|~\/|%userprofile%|(?:^|[\/\s"'`(])\.local(?=$|[\/\s"'`),]))/gim],
  ['token', /(?:\/join\/[^\s"'<>?#/\\[\]{}$]{4,}|#key=[^\s"'<>]+|[?#&](?:access[_-]?token|invite[_-]?token|master[_-]?token|token)=[^\s"'<>]+|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|aiza[a-z0-9_-]{30,})|\bbearer\s+[a-z0-9_-]{16,}|(?:invite[_-]?token|master[_-]?token|access[_-]?token)\s*[=:]\s*["'][a-z0-9_-]{16,}["'])/gi],
  ['token', /["']?(?:secret|client[_-]?secret|password|private[_-]?key|api[_-]?key|(?:invite|master|access|refresh|auth)[_-]?token|token)["']?\s*[:=]\s*["'][^"'\n]{8,}["']|-----begin (?:[a-z]+ )?private key-----|\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b|\/(?:invite|join)\/[a-z0-9_-]{4,}/gi],
  ['account-map-binding', /["']?(?:account(?:name|id)?|rsn|runemetricsname|originalmapid|mapid)["']?\s*[:=]\s*["'][^"'\n]+["']|(?:runemetrics|\/profile|\/quests)\S*[?&](?:user|name)=[^\s"'&]+/gi],
  ['personal-default', /(?:\b(?:person|member|player|owner|account|identity)\s*[:=]\s*\{[^}]{0,160}?\b(?:name|label)|["']?(?:masterlabel|defaultmembername|membername|playername)["']?)\s*[:=]\s*["'](?!(?:player(?: [a-z0-9]+)?|administrator|member|test|entry|item|before|after)(?:["']|[- ]))[^"'\n]{3,}["']/gi],
  ['service-binding', /\b(?:firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|chunkpickerrs3|firebase-adminsdk)\b|["']?(?:apikey|projectid|messagingsenderid|storagebucket|databaseurl)["']?\s*[:=]\s*["'][^"'\n]+["']/gi],
  ['copied-source', /source[- ]chunk|chunkpickerrs3-export|chunk-info(?:-export)?\.json|original[-_ ]picker|whitecatblack#\d+|(?:copyright|attribution)[^\n]{0,80}\bjagex\b/gi],
  ['legacy-task-id', /\brs3:task:[a-z0-9][a-z0-9:_-]*/gi],
  ['cache-catalogue', /\bcache[-_][a-z0-9._-]+\.(?:json|jsonl|csv)\b|\bcache[-_ ]catalog(?:ue)?s?\b/gi],
  ['network-identifier', /\b(?:[a-z0-9-]+\.)+(?:ts\.net|local|lan|internal)\b|\b(?:[a-f0-9]{2}:){5}[a-f0-9]{2}\b|\b[^\s"'<>@]+@(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi],
];

function reviewedPublicURL(url) {
  // These identify public source documents. They must never waive account,
  // user, credential or deployment bindings on otherwise approved hosts.
  if (url.username || url.password || url.port || url.hash) return false;
  const sensitiveQuery = [...url.searchParams.keys()].some(key => /(?:user|name|account|token|secret|password|key|auth|invite)/i.test(key));
  if (sensitiveQuery) return false;
  if (url.protocol === 'https:' && ['runescape.wiki', 'en.runescape.wiki'].includes(url.hostname)) {
    if (/^\/w\/[^?#]+$/.test(url.pathname) && !/^\/w\/(?:user(?:_talk)?|special):/i.test(url.pathname)) return true;
    if (url.pathname === '/api.php' && (!url.searchParams.has('action') || ['query', 'parse'].includes(url.searchParams.get('action')))
      && ![...url.searchParams.values()].some(value => /\b(?:user(?:_talk)?|special):/i.test(value))) return true;
  }
  return url.protocol === 'https:' && url.hostname === 'creativecommons.org'
    && url.pathname.replace(/\/$/, '') === '/licenses/by-nc-sa/3.0' && !url.search;
}

function decoded(value) {
  let text = value;
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/\\u\{([a-f0-9]{1,6})\}|\\u([a-f0-9]{4})|\\x([a-f0-9]{2})/gi, (whole, extended, unicode, hex) => {
      const point = parseInt(extended ?? unicode ?? hex, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }).replace(/(?:%[a-f0-9]{2})+/gi, value => { try { return decodeURIComponent(value); } catch { return value; } });
  }
  return text;
}

function inspectText(text, corpus) {
  const findings = [];
  const add = (category, line) => findings.push({ category, line });
  const decodedText = decoded(text);
  for (const match of decodedText.matchAll(/\\{2,}([a-z0-9_.-]+)\\+([a-z0-9_$.-]+)/gi)) {
    // Adjacent escaped control characters in authored parser tests are not UNC bindings.
    if (/^[nrtbf]$/i.test(match[1]) && /^[nrtbf]$/i.test(match[2])) continue;
    add('machine-path', 1 + (decodedText.slice(0, match.index).match(/\n/g)?.length ?? 0));
  }
  // Decoding covers JSON string escapes and percent-encoded URLs/filenames.
  const value = normalize(decodedText);
  const lineAt = offset => 1 + (value.slice(0, offset).match(/\n/g)?.length ?? 0);
  for (const [category, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) add(category, lineAt(match.index + (match[0].match(/^\s+/)?.[0].length ?? 0)));
  }
  for (const match of value.matchAll(/(?<![a-z0-9_-])[a-z0-9_-]{43}(?![a-z0-9_-])/gi)) add('token', lineAt(match.index));
  for (const match of value.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (!genericIPs.has(match[0]) && match[0].split('.').every(part => Number(part) <= 255)) add('network-identifier', lineAt(match.index));
  }
  // Full IPv6 hosts, including bare addresses; subnet literals used by auth are generic.
  for (const match of value.matchAll(/(?<![\w:])(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*(?![\w:])/gi)) {
    if (isIP(match[0]) === 6 && !['::', '::1', 'fd7a:115c:a1e0::'].includes(match[0])) add('network-identifier', lineAt(match.index));
  }
  // Path normalization collapses repeated slashes. Parse URLs before that step.
  for (const match of decodedText.matchAll(/https?:\/\/[^\s"'<>`\\)]+/gi)) {
    try {
      const url = new URL(match[0]);
      const host = url.hostname.toLowerCase();
      const generic = /^(?:localhost|127\.0\.0\.1|\[::1\]|example\.(?:com|net|org))$/.test(host) || /\.(?:invalid|example)$/.test(host);
      if ((!generic && !/[{}$]/.test(host) && !standardFormatURLs.has(url.href) && !reviewedPublicURL(url)) || url.username || url.password)
        add('network-identifier', 1 + (decodedText.slice(0, match.index).match(/\n/g)?.length ?? 0));
    } catch { /* Interpolated and incomplete source-code URLs are not bindings. */ }
  }
  for (const line of fingerprintLines(text, corpus)) add('private-fingerprint', line);
  if (decodedText !== text) for (const line of fingerprintLines(decodedText, corpus)) add('private-fingerprint', line);
  return findings;
}

function validateExceptions(document) {
  const categories = new Set(['machine-path', 'personal-default', 'account-map-binding', 'service-binding', 'copied-source', 'legacy-task-id', 'cache-catalogue', 'network-identifier', 'token']);
  if (document?.schemaVersion !== 1 || !Array.isArray(document.lines) || document.lines.some(row =>
    !safeRelative(row?.path) || !categories.has(row.category) || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
    || typeof row.reason !== 'string' || !row.reason.trim())) throw blocked('invalid-reviewed-exceptions');
  return document.lines;
}

export function scanEntries(entries, { corpus, provenance, reviewedExceptions = { schemaVersion: 1, lines: [] } }) {
  if (!corpus?.key || !(corpus.byLength instanceof Map) || !corpus.byLength.size) throw blocked('missing-or-invalid-corpus');
  validateProvenance(provenance);
  const exceptions = validateExceptions(reviewedExceptions);
  const findings = [], seen = new Set();
  const add = (category, relativePath, line = 1) => {
    const id = `${category}:${relativePath}:${line}`;
    if (!seen.has(id)) { findings.push({ category, path: relativePath, line }); seen.add(id); }
  };
  for (const entry of entries) {
    const filenameFindings = inspectText(entry.path, corpus);
    const unsafePath = !safeRelative(entry.path) || filenameFindings.length > 0;
    const location = unsafePath ? '[redacted-path]' : entry.path;
    if (hardDenied(entry.path)) add('forbidden-path', location);
    for (const finding of filenameFindings) add(finding.category, location);
    if (entry.directory) continue;
    if (entry.category) { add(entry.category, location); continue; }
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.text ?? '', 'utf8');
    if (bytes.length > maxFileBytes) { add('scan-limit', location); continue; }
    const text = textBytes(bytes);
    // Only reviewed text SVG placeholders are eligible media. A provenance row
    // cannot authorize a raster, or disguise binary bytes as a source/SVG file.
    if (/\.(?:png|jpe?g|gif|webp|bmp|ico|tiff?|avif)$/i.test(entry.path)
      || text === null || !allowedBytes(entry.path, bytes, provenance)) { add('unapproved-binary', location); continue; }
    if (text !== null) {
      const lines = text.split(/\r?\n/);
      const stableLines = decoded(text).split('\n').length === lines.length;
      for (const finding of inspectText(text, corpus)) {
        // Decoded escape sequences can introduce line breaks. Do not let an
        // encoded value borrow an exception hash from a different source line.
        const reviewed = stableLines && exceptions.some(row => row.path === entry.path && row.category === finding.category
          && row.sha256 === sha256(Buffer.from(lines[finding.line - 1] ?? '', 'utf8')));
        if (!reviewed) add(finding.category, location, finding.line);
      }
      if (/\.json$/i.test(entry.path)) {
        try { JSON.parse(text); } catch { add('invalid-json', location); }
      }
    }
  }
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.category.localeCompare(b.category));
  const categories = {};
  for (const { category } of findings) categories[category] = (categories[category] ?? 0) + 1;
  return { status: findings.length ? 'blocked, not clean' : 'clean', files: entries.filter(entry => !entry.directory).length, categories, findings };
}

export async function scanDirectory(directory, { corpusDir = defaultCorpusDir, provenance, reviewedExceptions } = {}) {
  const corpus = await loadCorpus(corpusDir);
  const approved = provenance ?? validateProvenance(JSON.parse(await readFile(provenancePath, 'utf8')));
  const reviewed = reviewedExceptions ?? JSON.parse(await readFile(exceptionsPath, 'utf8'));
  const root = path.resolve(directory);
  await noLinks(root);
  if (!(await lstat(root)).isDirectory()) throw blocked('invalid-candidate');
  const entries = [];
  let totalBytes = 0, visited = 0;
  async function walk(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      if (++visited > 10000) throw blocked('scan-limit');
      const relativePath = relative ? `${relative}/${name}` : name;
      const absolute = path.join(root, relativePath);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) { entries.push({ path: relativePath, category: 'symlink' }); continue; }
      if (['.git', '.hg', '.svn', '.gitmodules'].includes(name.toLowerCase())) { entries.push({ path: relativePath, category: 'nested-repository' }); continue; }
      await noLinks(absolute);
      if (info.isDirectory()) { entries.push({ path: relativePath, directory: true }); await walk(relativePath); }
      else if (!info.isFile()) entries.push({ path: relativePath, category: 'special-file' });
      else if (info.size > maxFileBytes) entries.push({ path: relativePath, category: 'scan-limit' });
      else {
        totalBytes += info.size;
        if (totalBytes > 64 * 1024 * 1024) throw blocked('scan-limit');
        entries.push({ path: relativePath, bytes: await readFile(absolute) });
      }
    }
  }
  await walk();
  return scanEntries(entries, { corpus, provenance: approved, reviewedExceptions: reviewed });
}

export function reportScan(result, write = value => console.log(value)) {
  write(result.status);
  for (const { category, path: relativePath, line } of result.findings) write(`${category} ${relativePath}:${line}`);
  write(JSON.stringify({ files: result.files, categories: result.categories }));
}

if (isMain(import.meta.url)) {
  try {
    const [directory, option, corpusDir, ...extra] = process.argv.slice(2);
    if (!directory || extra.length || (option && (option !== '--corpus-dir' || !corpusDir))) throw blocked('usage');
    const result = await scanDirectory(directory, { corpusDir });
    reportScan(result);
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(`blocked, not clean (${error.category ?? 'scan-failed'})`);
    process.exitCode = 2;
  }
}
