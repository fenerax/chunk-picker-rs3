// Adds private values to the local fingerprint corpus without printing them.
//   node scripts/secret-scan/corpus-add.mjs < values.txt         one value per line
//   node scripts/secret-scan/corpus-add.mjs --file values.txt
//   node scripts/secret-scan/corpus-add.mjs --save copy-of-save.json
// --save reads member identities from a disposable copy of a save, plus the
// literal ids and labels in app/legacy-game-defaults.mjs. It never looks for a
// save by itself. Every added value must then block in plain, upper-case,
// decomposed, JSON, escaped and file-name form, or the run fails.
// --corpus-dir picks a corpus other than .local/export-gate.
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addFingerprints, blocked, defaultCorpusDir, hasFingerprint, loadCorpus } from './fingerprints.mjs';
import { scanEntries } from './scan.mjs';

const defaultsPath = fileURLToPath(new URL('../../app/legacy-game-defaults.mjs', import.meta.url));
const identityKeys = ['id', 'name', 'runescapeName', 'rsn', 'accountName', 'handle', 'mapId', 'sourceMapId'];
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

async function fileBytes(filename, limit) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size > limit) throw blocked('input-invalid');
  return readFile(filename);
}

async function stdinBytes(limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > limit) throw blocked('input-limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Reads quoted literals only; the module is never executed.
function defaultsValues(text) {
  const values = [];
  for (const match of text.matchAll(/\b(?:id|name|mapId|masterLabel)\s*:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) {
    const literal = match[1];
    if (literal.startsWith('"')) { values.push(JSON.parse(literal)); continue; }
    const body = literal.slice(1, -1);
    if (/\\(?![\\'"nrtbf/]|u[\da-f]{4}|x[\da-f]{2})/i.test(body)) throw blocked('defaults-invalid');
    values.push(body.replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\\'"nrtbf/]))/gi, (_, unicode, hex, escaped) =>
      unicode || hex ? String.fromCharCode(parseInt(unicode ?? hex, 16)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[escaped] ?? escaped)));
  }
  return values;
}

function memberValues(text) {
  const document = JSON.parse(text);
  const members = Array.isArray(document) ? document : document?.state?.members ?? document?.members;
  if (!Array.isArray(members) || !members.length || members.length > 1000) throw blocked('members-invalid');
  return members.flatMap(member => {
    if (!member || typeof member !== 'object' || typeof member.name !== 'string' || !member.name.trim()) throw blocked('members-invalid');
    return identityKeys.map(key => member[key]).filter(value => typeof value === 'string' && value.trim());
  });
}

// Values stay in memory; only pass or fail leaves this function.
function verifyBlocks(values, corpus) {
  for (const value of values) {
    if (!hasFingerprint(value, corpus)) throw blocked('negative-check-failed');
    for (const variant of new Set([value, value.toUpperCase(), value.normalize('NFD'), value.replaceAll('\\', '/')])) {
      const escaped = [...variant].map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
      const result = scanEntries([
        { path: 'negative.txt', bytes: Buffer.from(`Synthetic prefix\n${variant}\nSynthetic suffix`) },
        { path: `${encodeURIComponent(variant)}.txt`, bytes: Buffer.from('Synthetic content') },
        { path: 'negative.json', bytes: Buffer.from(JSON.stringify({ binding: variant })) },
        { path: 'escaped.txt', bytes: Buffer.from(escaped) },
      ], { corpus, reviewed: { hosts: [], placeholders: new Set(), lines: new Set() } });
      const where = new Set(result.findings.filter(f => f.category === 'private-fingerprint').map(f => f.path));
      if (!['negative.txt', 'negative.json', 'escaped.txt', '[redacted-path]'].every(location => where.has(location))) throw blocked('negative-check-failed');
    }
  }
}

export async function addValues({ file, save, corpusDir = defaultCorpusDir, defaults = defaultsPath } = {}) {
  let values;
  if (save) values = [...defaultsValues(decode(await fileBytes(defaults, 64 * 1024))), ...memberValues(decode(await fileBytes(save, 64 * 1024 ** 2)))];
  else values = decode(file ? await fileBytes(file, 2 * 1024 ** 2) : await stdinBytes(2 * 1024 ** 2)).split(/\r?\n/).filter(value => value.length);
  values = [...new Set(values)];
  if (!values.length || values.some(value => value.length > 4096)) throw blocked('input-invalid');
  const entries = await addFingerprints(values, corpusDir);
  verifyBlocks(values, await loadCorpus(corpusDir));
  return { entries, added: values.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const args = process.argv.slice(2), options = {};
    const names = { '--file': 'file', '--save': 'save', '--corpus-dir': 'corpusDir' };
    for (let index = 0; index < args.length; index += 2) {
      const name = names[args[index]];
      if (!name || !args[index + 1] || options[name] !== undefined) throw blocked('usage');
      options[name] = args[index + 1];
    }
    if (options.file && options.save) throw blocked('usage');
    const { entries, added } = await addValues(options);
    console.log(`Corpus ready: ${entries} entries; ${added} values checked to block.`);
  } catch (error) {
    console.error(`blocked, not clean (${error.category ?? 'corpus-add-failed'})`);
    process.exitCode = 2;
  }
}
