// Secret scan: blocks credentials and personal values before they reach the
// public repository. It reads Git objects only, so it scans exactly what a
// push would send:
//   node scripts/secret-scan/scan.mjs --tree HEAD          every file at one commit
//   node scripts/secret-scan/scan.mjs --commits A..B       each new commit's changed files,
//                                                          message and attribution
//   (--commits B alone covers B's whole history)
// The private-value corpus is required (default .local/export-gate, or
// --corpus-dir). --without-corpus runs the pattern rules only; CI uses it,
// and the pre-push hook on the release PC runs with the corpus.
// Findings print as category, path and line, never the matched text.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocked, defaultCorpusDir, fingerprintLines, loadCorpus, normalize } from './fingerprints.mjs';
import { attributionRefusals } from './noreply.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reviewedPath = fileURLToPath(new URL('./reviewed.json', import.meta.url));
export const categories = ['private-fingerprint', 'token', 'account-map-binding', 'personal-default', 'service-binding', 'network-identifier', 'machine-path'];

// Unspecified, loopback, documentation (RFC 5737), public resolvers and
// Tailscale's fixed service address name no one's network.
const genericIP = ip => /^(?:0\.0\.0\.0|127\.\d+\.\d+\.\d+|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+|8\.8\.8\.8|1\.1\.1\.1|100\.64\.0\.0|100\.100\.100\.100)$/.test(ip);
const genericHost = host => /^(?:localhost|127\.0\.0\.1|\[::1\]|host|fixture|test|example|\*)$/.test(host)
  || /^example\.(?:com|net|org)$/.test(host) || /\.(?:invalid|example|test|localhost)$/.test(host) || /[{}$<>]/.test(host);
const genericEmail = email => /^(?:fenerax@users\.noreply\.github\.com|noreply@anthropic\.com|noreply@github\.com)$/.test(email)
  || /@(?:example\.(?:com|net|org)|(?:[a-z0-9-]+\.)*(?:invalid|example|test))$/.test(email);
// Account folders that name no person: Windows' generic `User`, CI runners and placeholders.
const genericAccount = String.raw`(?:user|public|default|runner|runneradmin|<[^>/]*>|\$\{[^}/]*\}|%username%|\$env:username)(?=$|[\/\s"'\x60),;])`;
// Named groups hold the value a rule binds. Test and documentation values
// pass when they are placeholders (see placeholderValue); `w`, the bare
// `token` field, also passes when it is plain words and numbers.
const patterns = [
  ['machine-path', new RegExp(String.raw`\b[a-z]:\/users\/(?!${genericAccount})[^\s\/"'\x60]+|(?:^|[\s"'\x60(=])\/(?:home|users)\/(?!${genericAccount})[^\s\/"'\x60]+|%userprofile%`, 'gim')],
  ['token', /(?:\/join\/(?<v1>[^\s"'<>?#/\\[\]{}$]{4,})|#key=(?<v2>[^\s"'<>]+)|[?#&](?:access[_-]?token|invite[_-]?token|master[_-]?token|token)=(?<v3>[^\s"'<>]+)|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|aiza[a-z0-9_-]{30,})|\bbearer\s+[a-z0-9_-]{16,}|(?:invite[_-]?token|master[_-]?token|access[_-]?token)\s*[=:]\s*["'](?<v4>[a-z0-9_-]{16,})["'])/gi],
  ['token', /["']?(?:secret|client[_-]?secret|password|private[_-]?key|api[_-]?key|(?:invite|master|access|refresh|auth)[_-]?token)["']?\s*[:=]\s*["'](?<v5>[^"'\n]{8,})["']|["']?token["']?\s*[:=]\s*["'](?<w>[^"'\s]{8,})["']|-----begin (?:[a-z]+ )?private key-----|\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b|\/(?:invite|join)\/(?<v6>[a-z0-9_-]{4,})/gi],
  ['account-map-binding', /(?<![a-z0-9_])["']?(?:account(?:name|id)?|rsn|runemetricsname|originalmapid|mapid)["']?\s*[:=]\s*["'](?<v7>[^"'\n]+)["']|(?:runemetrics|\/profile|\/quests)\S*[?&](?:user|name)=(?<v8>[^\s"'&]+)/gi],
  ['personal-default', /(?:\b(?:person|member|player|owner|account|identity)\s*[:=]\s*\{[^}]{0,160}?\b(?:name|label)|["']?(?:masterlabel|defaultmembername|membername|playername)["']?)\s*[:=]\s*["'](?!(?:player(?: [a-z0-9]+)?|administrator|member|test|entry|item|before|after)(?:["']|[- ]))(?<v9>[^"'\n]{3,})["']/gi],
  ['service-binding', /\b(?:firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|chunkpickerrs3|firebase-adminsdk)\b|["']?(?:apikey|projectid|messagingsenderid|storagebucket|databaseurl)["']?\s*[:=]\s*["'][^"'\n]+["']/gi],
  // Tailnet hosts and MAC addresses. mDNS and LAN hosts skip code that reads
  // a property, such as `paths.local)` or `data.local = `.
  ['network-identifier', /\b(?:[a-z0-9-]+\.)+ts\.net\b|\b(?:[a-f0-9]{2}:){5}[a-f0-9]{2}\b|\b(?:[a-z0-9-]+\.)+(?:local|lan|internal)\b(?!\s*(?:[)\],;(=]|\?\.|\|\||&&|!==?))/gi],
];

export function loadReviewed(file = reviewedPath) {
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const reasoned = row => typeof row?.reason === 'string' && row.reason.trim();
  if (document?.schemaVersion !== 1 || !Array.isArray(document.hosts) || !Array.isArray(document.placeholders) || !Array.isArray(document.lines)
    || document.hosts.some(row => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(row?.host ?? '') || !reasoned(row))
    || document.placeholders.some(row => typeof row?.value !== 'string' || !row.value.trim() || !reasoned(row))
    || document.lines.some(row => typeof row?.path !== 'string' || !row.path || !categories.includes(row.category)
      || !/^[a-f0-9]{64}$/.test(row.sha256 ?? '') || !reasoned(row))) throw blocked('invalid-reviewed-file');
  return { hosts: document.hosts.map(row => row.host), placeholders: new Set(document.placeholders.map(row => normalize(row.value))),
    lines: new Set(document.lines.map(row => `${row.path}\0${row.category}\0${row.sha256}`)) };
}

// Test and documentation values carry a marker word as a whole segment
// ("fixture-secret", "invented-map", "examplegim") or are templates
// ("${token}", "<name>"). reviewed.json lists the other placeholders, such
// as the anonymised map codes. Values arrive normalized (lower case).
const marker = /^(?:fixture|test|example|invented|synthetic|demo|fake|placeholder|sample|dummy|stale|wrong|valid|invalid|other|unknown|missing|arbitrary|redacted|secret|token|none|null)$/;
const markerPrefix = /^(?:fixture|example|invented|synthetic|placeholder|sample)/;
function placeholderValue(value, placeholders) {
  const plain = value.trim().toLowerCase().replace(/[).:;,`]+$/, '');
  if (/[{}$<>[\]*]/.test(plain) || /^\.+$/.test(plain) || placeholders.has(plain)) return true;
  return plain.split(/[^a-z0-9]+/).some(segment => marker.test(segment) || markerPrefix.test(segment));
}
const plainWords = value => value.split(/[^a-z0-9]+/i).filter(Boolean).every(segment => /^(?:[a-z]+|\d+)$/i.test(segment));

// Public reference hosts carry no binding, unless the URL itself names a
// person, an account or a credential.
function bindingURL(url, reviewedHosts, placeholders) {
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) return true;
  if (genericHost(host)) return false;
  if (url.port || url.hash.includes('=')) return true;
  if ([...url.searchParams].some(([key, found]) => /user|name|account|token|secret|password|key|auth|invite/i.test(key) && !placeholderValue(normalize(found), placeholders))) return true;
  if (/login|logout|account|token/i.test(url.searchParams.get('action') ?? '')) return true;
  let target = url.pathname + url.search;
  try { target = decodeURIComponent(target); } catch { /* keep encoded */ }
  // User pages and the special pages that take a user name identify a person.
  if (/\buser(?:[_ ]talk)?:/i.test(target) || /\bspecial:(?!(?:permanentlink|diff)\/(?:\d+|\$\{[^}]*\})(?:$|[?#&])|redirect\/|search(?:$|[?#&]))/i.test(target)) return true;
  return !reviewedHosts.some(reviewed => host === reviewed || host.endsWith(`.${reviewed}`));
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

const lineCounter = text => {
  const breaks = [];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) breaks.push(index);
  return offset => { let low = 0, high = breaks.length; while (low < high) { const mid = (low + high) >> 1; if (breaks[mid] < offset) low = mid + 1; else high = mid; } return low; };
};

// Pattern rules over one line-bounded piece. Returns [category, line within piece, stable].
function inspectPiece(raw, reviewedHosts, placeholders, escaped) {
  const findings = [];
  // Escapes never span a line, so each line decodes on its own. A line whose
  // escapes decode to a line break is unstable: its findings are reported at
  // the source line but cannot use a line exception.
  const parts = raw.split('\n').map(decoded), text = parts.join('\n');
  const origin = parts.flatMap((part, index) => part.split('\n').map(() => index));
  const value = normalize(text), valueLine = lineCounter(value), textLine = lineCounter(text);
  const add = (category, line) => { const source = origin[line] ?? line; findings.push([category, source, !parts[source]?.includes('\n')]); };
  // UNC paths. In JSON and JavaScript source a literal \\host is written \\\\host;
  // segments after a drive letter, as in C:\\Users\\..., are not hosts.
  const unc = escaped ? /(?<!\\)\\{4,}([a-z0-9_.?-]+)\\+([a-z0-9_$.-]+)(?![{(])/gi : /(?<!\\)\\{2,}([a-z0-9_.?-]+)\\+([a-z0-9_$.-]+)(?![{(])/gi;
  for (const match of text.matchAll(unc)) {
    // Adjacent escaped control characters in parser tests are not UNC paths,
    // nor are the local device prefixes \\.\ and \\?\ (named pipes, long paths).
    if ((/^[nrtbf]$/i.test(match[1]) && /^[nrtbf]$/i.test(match[2])) || /^[.?]$/.test(match[1])) continue;
    if (/[a-z]:(?:\\+[^\\\s"'\x60]+)*$/i.test(text.slice(Math.max(0, match.index - 260), match.index))) continue;
    add('machine-path', textLine(match.index));
  }
  for (const [category, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const [group, bound] = Object.entries(match.groups ?? {}).find(([, found]) => found !== undefined) ?? [];
      if (bound !== undefined && (placeholderValue(bound, placeholders) || (group === 'w' && plainWords(bound)))) continue;
      add(category, valueLine(match.index + (match[0].match(/^\s+/)?.[0].length ?? 0)));
    }
  }
  // 43 characters is a 32-byte base64url secret, such as an invite token.
  // A random one has both cases (all but about 1 in 10^9); slugs, coordinate
  // keys and camelCase names do not, or are words with no digit.
  for (const match of text.matchAll(/(?<![a-z0-9_-])[a-z0-9_-]{43}(?![a-z0-9_-])/gi))
    if (/[A-Z]/.test(match[0]) && /[a-z]/.test(match[0]) && !match[0].split(/[-_]/).every(word => /^(?:[A-Za-z][a-z]*(?:[A-Z][a-z]*)*|\d+[A-Z]?\d*[A-Z]?)$/.test(word))) add('token', textLine(match.index));
  // Windows' default computer names: seven random capitals and digits. A
  // lower-case word suffix is a file name, such as `desktop-current.png`.
  for (const match of text.matchAll(/\b(?:desktop|laptop)-([a-z0-9]{7})\b/gi))
    if (/\d/.test(match[1]) || match[1] === match[1].toUpperCase()) add('network-identifier', textLine(match.index));
  for (const match of value.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g))
    if (!genericIP(match[0]) && match[0].split('.').every(part => Number(part) <= 255)) add('network-identifier', valueLine(match.index));
  for (const match of value.matchAll(/(?<![\w:])(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*(?![\w:])/gi))
    if (isIP(match[0]) === 6 && !['::', '::1', 'fd7a:115c:a1e0::'].includes(match[0]) && !/^2001:db8:/.test(match[0])) add('network-identifier', valueLine(match.index));
  for (const match of value.matchAll(/[^\s"'<>@()[\]{}=,;:]+@((?:[a-z0-9-]+\.)+[a-z]{2,})\b/g))
    if (!genericEmail(match[0])) add('network-identifier', valueLine(match.index));
  // Path normalization collapses repeated slashes, so URLs parse before it.
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>`\\)]+/gi)) {
    let url;
    try { url = new URL(match[0]); } catch { url = null; }
    // A URL that does not parse still names its host when it has one.
    const host = url?.hostname ?? /^https?:\/\/([^/?#:]*)/i.exec(match[0])[1];
    if (url ? bindingURL(url, reviewedHosts, placeholders) : !genericHost(host.toLowerCase()) && /[a-z0-9]/i.test(host)) add('network-identifier', textLine(match.index));
  }
  return findings;
}

// Line-bounded pieces, each with up to four lines of the previous piece so a
// rule that spans a line break still sees both halves.
function* pieces(text, size = 1 << 18) {
  let start = 0, line = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) { const newline = text.indexOf('\n', end); end = newline === -1 ? text.length : newline + 1; }
    let overlap = start;
    for (let count = 0; count < 4 && overlap > 0; count++) overlap = text.lastIndexOf('\n', overlap - 2) + 1;
    if (start - overlap > 2048) overlap = start;
    const overlapLines = text.slice(overlap, start).split('\n').length - 1;
    yield { raw: text.slice(overlap, end), firstLine: line - overlapLines };
    line += text.slice(start, end).split('\n').length - 1;
    start = end;
  }
}

// Binary files: printable runs of six or more characters, one run per line.
export function textOf(bytes) {
  if (!bytes.includes(0)) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* binary */ }
  }
  return (bytes.toString('latin1').match(/[\x20-\x7e]{6,}/g) ?? []).join('\n');
}

export function inspectText(text, { corpus, reviewedHosts = [], placeholders = new Set(), escaped = false }) {
  const findings = new Map();
  const add = (category, line, stable = true) => { const key = `${category}:${line}`; if (!findings.has(key) || !stable) findings.set(key, { category, line, stable }); };
  for (const { raw, firstLine } of pieces(text))
    for (const [category, line, stable] of inspectPiece(raw, reviewedHosts, placeholders, escaped)) add(category, firstLine + line + 1, stable);
  if (corpus) {
    for (const line of fingerprintLines(text, corpus)) add('private-fingerprint', line);
    const plain = decoded(text);
    if (plain !== text) for (const line of fingerprintLines(plain, corpus)) add('private-fingerprint', line, plain.split('\n').length === text.split('\n').length);
  }
  return [...findings.values()];
}

/** entries: [{ path, bytes }]. corpus null skips the private-value check. */
export function scanEntries(entries, { corpus, reviewed = loadReviewed() }) {
  if (corpus !== null && !(corpus?.byLength instanceof Map)) throw blocked('missing-or-invalid-corpus');
  const findings = [];
  for (const entry of entries) {
    const named = inspectText(entry.path, { corpus, reviewedHosts: reviewed.hosts, placeholders: reviewed.placeholders });
    // A path that itself holds a finding is never printed.
    const location = named.length ? '[redacted-path]' : entry.path;
    for (const { category } of named) findings.push({ category, path: location, line: 0 });
    if (!entry.bytes) continue;
    const text = textOf(entry.bytes), lines = text.split('\n');
    for (const finding of inspectText(text, { corpus, reviewedHosts: reviewed.hosts, placeholders: reviewed.placeholders, escaped: /\.(?:json|[cm]?js|ts)$/i.test(entry.path) })) {
      // An exception names the exact path, category and line bytes. Decoding
      // that moves line breaks cannot borrow a different line's exception.
      const line = (lines[finding.line - 1] ?? '').replace(/\r$/, '');
      if (finding.stable && reviewed.lines.has(`${entry.path}\0${finding.category}\0${sha256(line)}`)) continue;
      findings.push({ category: finding.category, path: location, line: finding.line });
    }
  }
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.category.localeCompare(b.category));
  const counts = {};
  for (const { category } of findings) counts[category] = (counts[category] ?? 0) + 1;
  return { status: findings.length ? 'blocked, not clean' : 'clean', files: entries.length, categories: counts, findings };
}

const git = (repo, args, input) => execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], { input, windowsHide: true, maxBuffer: 1 << 30 });

function blobs(repo, rows) {
  if (!rows.length) return [];
  const batch = git(repo, ['cat-file', '--batch'], rows.map(row => `${row.oid}\n`).join(''));
  let offset = 0;
  return rows.map(row => {
    const end = batch.indexOf(10, offset), header = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(batch.subarray(offset, end).toString());
    if (!header || header[1] !== row.oid) throw blocked('git-object');
    const size = Number(header[2]); offset = end + 1;
    const bytes = batch.subarray(offset, offset + size); offset += size + 1;
    return { path: row.path, bytes };
  });
}

/** Every regular file at one commit. Links and submodules are refused. */
export function treeEntries(repo, revision) {
  const rows = git(repo, ['ls-tree', '-r', '-z', '--full-tree', revision]).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t(.+)$/s.exec(row);
    if (!match) throw blocked('non-regular-entry');
    return { oid: match[2], path: match[3] };
  });
  return blobs(repo, rows);
}

/** For each commit in the range (rev-list arguments): the files it adds or changes, its message, and its attribution. */
export function commitEntries(repo, range) {
  const commits = git(repo, ['rev-list', '--reverse', ...[range].flat()]).toString().split('\n').filter(Boolean);
  const rows = [], seen = new Set(), messages = [];
  for (const commit of commits) {
    const tokens = git(repo, ['diff-tree', '-r', '-z', '--root', '--no-renames', '--no-commit-id', commit]).toString().split('\0');
    for (let index = 0; index + 1 < tokens.length; index += 2) {
      const name = tokens[index + 1];
      // :<old mode> <new mode> <old oid> <new oid> <status>
      const [, mode, , oid, status] = tokens[index].slice(1).split(' ');
      if (status === 'D') continue;
      if (!/^100(?:644|755)$/.test(mode)) throw blocked('non-regular-entry');
      if (!seen.has(`${oid}\0${name}`)) { seen.add(`${oid}\0${name}`); rows.push({ oid, path: name }); }
    }
    messages.push({ path: `commit ${commit.slice(0, 12)} message`, bytes: git(repo, ['show', '-s', '--format=%B', commit]) });
  }
  return { commits, entries: [...blobs(repo, rows), ...messages] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = { repo: process.cwd(), corpusDir: defaultCorpusDir };
    for (let index = 0; index < args.length; index++) {
      const name = args[index];
      if (name === '--without-corpus') options.corpusDir = null;
      else if (['--tree', '--commits', '--corpus-dir', '--repo'].includes(name) && args[index + 1]) options[name.slice(2).replace('-dir', 'Dir')] = args[++index];
      else throw blocked('usage');
    }
    if (!options.tree && !options.commits) throw blocked('usage');
    const corpus = options.corpusDir ? await loadCorpus(options.corpusDir) : null;
    if (!corpus) console.log('No private-value corpus: credential and personal-value patterns only. The pre-push hook checks the corpus.');
    const entries = [], refusals = [];
    if (options.tree) entries.push(...treeEntries(options.repo, options.tree));
    if (options.commits) {
      const range = commitEntries(options.repo, options.commits);
      entries.push(...range.entries);
      refusals.push(...attributionRefusals(options.repo, range.commits));
      console.log(`${range.commits.length} commits checked.`);
    }
    const result = scanEntries(entries, { corpus });
    console.log(result.status);
    for (const { category, path: name, line } of result.findings) console.log(`${category} ${name}:${line}`);
    for (const { commit, author, committer } of refusals) console.log(`attribution ${commit.slice(0, 12)}: ${[author ? '' : 'author', committer ? '' : 'committer'].filter(Boolean).join(' and ')} not a GitHub noreply address`);
    console.log(JSON.stringify({ files: result.files, categories: result.categories, attributionRefused: refusals.length }));
    process.exitCode = result.findings.length || refusals.length ? 1 : 0;
  } catch (error) {
    console.error(`blocked, not clean (${error.category ?? 'scan-failed'})`);
    process.exitCode = 2;
  }
}
