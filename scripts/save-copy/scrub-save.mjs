import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { gameVocabulary, repositoryRoot } from './policy.mjs';
import { loadReviewed, inspectText } from '../secret-scan/scan.mjs';
import { loadCorpus, defaultCorpusDir } from '../secret-scan/fingerprints.mjs';

const placeholder = value => /^(?:(?:(?:rs3:task:)?custom:)?example\d{5}|player\d+|qx[a-z])$/.test(value);
const personalField = /(?:email|hostname|computername|ipaddress|account(?:name|id)|displayname|player(?:name|id)|runescapename|rsn|memberid|mapid|invite|token|secret|password|credential|join|homepath|nickname|username|address)/i;
const freeField = /^(?:name|handle|note|notes|journal|text|backlogReason|reason|warnings|chunkNotes|stickeredNotes|friends|friendsAlt|chunkColourNames)$/i;
const timestamps = /^(?:at|capturedAt|appliedAt|fetchedAt|createdAt|updatedAt)$/;
const numeric = /^\d+(?:-\d+)?$/;
const publicSourceHash = `sha256:${'0'.repeat(64)}`;
const gameNumericFields = new Set(['unlocked','selected','pendingRoll','blacklisted','startingChunk','chunkId','rolled','path','topbarSelection','chunkOrder','manualPrimary','recent','recentTime','recentFancyRollTime','randomLoot','chunkNeighboursOptions']);
const dictionaries = new Set(['maps','entries','aliases','notes','taskStatus','taskRules','sectionOverrides','sourceBacklogs','areaOverrides','preferences','primaryOverrides','passiveLevels','maxLevels','stickers','chunkColours','chunkColourNames','taskAlternatives','skillProgress','questProgress','teleportOverrides','xpChoices','taskClaims','rules','settings','chunks','chunkinfo','chunkOrder','challenges','altChallenges','manualSections','manualEquipment','manualMonsters','possibleAreas','assignedXpRewards','completedChallenges','stickered','stickeredColors','stickeredNotes','chunkNotes','userTasks','friends','friendsAlt','byMember','startByMember']);
const numericKeyFields = new Set(['notes','chunks','chunkinfo','chunkOrder','stickers','chunkColours','sectionOverrides','stickered','stickeredColors','stickeredNotes','chunkNotes','possibleAreas','unlocked','selected','manualSections']);
const scalarType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const privateShape = value => /(?:[a-z]:[\\/]users[\\/]|\/(?:home|users)\/|\\\\[^\\\s]+\\|\/join\/|\b[a-z0-9.-]+\.ts\.net\b|[^\s@]+@[^\s@]+\.[a-z]{2,})/i.test(value) || isIP(value) !== 0;
const fail = category => { throw Object.assign(new Error('Save-copy operation refused.'), { category }); };

export function backupCounts(document) {
  const state = document?.state;
  if (document?.format !== 'rs3-chunk-picker' || document.schemaVersion !== 1 || state?.schemaVersion !== 1
    || !Array.isArray(state.members) || !Array.isArray(state.tasks) || !Array.isArray(state.history)) fail('invalid-backup');
  return { members: state.members.length, tasks: state.tasks.length, history: state.history.length,
    chunks: state.members.map(member => Object.fromEntries(['unlocked', 'selected', 'pendingRoll', 'blacklisted'].map(key => [key, member[key]?.length ?? 0]))) };
}

// Mutates only a JSON tree owned by the caller. Maps are kept in memory and
// are never included in the value-free report or written to disk.
export function scrubBackup(document, { vocabulary, checking = false, blockedStrings = new Set() } = {}) {
  const before = backupCounts(document);
  if (!(vocabulary?.values instanceof Set) || !(vocabulary?.keys instanceof Set)) fail('missing-game-vocabulary');
  const mapping = new Map(), rows = new Map(), referenceValues = new Set();
  const reserved = new Set();
  function reserve(value) {
    if (typeof value === 'string' && placeholder(value)) reserved.add(value);
    else if (Array.isArray(value)) value.forEach(reserve);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { reserve(key); reserve(child); }
  }
  reserve(document);
  let next = 0;
  const remember = (value, replacement) => {
    if (typeof value === 'string' && value) {
      referenceValues.add(value);
      if (!placeholder(value) && !mapping.has(value)) mapping.set(value, replacement);
    }
  };
  document.state.members.forEach((member, index) => {
    remember(member.sourceMapId, index < 26 ? `qx${String.fromCharCode(97 + index)}` : `example${String(index + 1).padStart(5, '0')}`);
    remember(member.id, `player${index + 1}`);
  });
  function replacement(value) {
    if (!value || placeholder(value)) return value;
    if (!mapping.has(value)) {
      do { if (++next > 99999) fail('placeholder-limit'); } while (reserved.has(`example${String(next).padStart(5, '0')}`));
      const prefix = /^(?:rs3:task:)?custom:/.exec(value)?.[0] ?? '';
      mapping.set(value, `${prefix}example${String(next).padStart(5, '0')}`);
    }
    return mapping.get(value);
  }
  function record(location, kind, action, type) {
    const key = `${location}\0${kind}\0${action}\0${type}`;
    if (!rows.has(key)) rows.set(key, { path: location, kind, action, type, count: 0 });
    rows.get(key).count++;
  }
  function string(value, location, field, force, parent) {
    let kind, output = value;
    if (field === 'sourceHash') { kind = 'private-source-fingerprint'; output = publicSourceHash; }
    else if (blockedStrings.has(value)) { kind = 'secret-scan-match'; output = replacement(value); }
    else if (personalField.test(field) || privateShape(value) || field === 'name' || field === 'handle'
      || field === 'id' && /(?:\.members\[\]|\.memberChanges\[\])\.id$/.test(location)) { kind = 'identity-or-access'; output = replacement(value); }
    else if (force || freeField.test(field)) { kind = force === 'unknown' ? 'unknown-string' : 'free-text'; output = replacement(value); }
    else if (placeholder(value)) kind = 'placeholder';
    else if (timestamps.test(field) && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)) kind = 'game-history-time';
    else if ((field === 'taskRules' || /\.taskRules\./.test(location) || parent?.type === 'set-task-rule')
      && /\d/.test(value) && /^[\d+.,e~\s/-]+$/i.test(value)) kind = 'game-rule-number-or-rate';
    else if (numeric.test(value)) {
      if (gameNumericFields.has(field) || /\.legacy\.maps\./.test(location)) kind = 'game-number-or-colour';
      else { kind = 'unknown-string'; output = replacement(value); }
    }
    else if (/^#[a-f0-9]{6}$/i.test(value) && /colou?r|stickeredColors/i.test(field)) kind = 'game-number-or-colour';
    else if (vocabulary.gameValue?.(value) || vocabulary.values.has(value) || vocabulary.values.has(value.replace(/^\*fb\*_/, ''))) kind = 'authored-game-data';
    else { kind = 'unknown-string'; output = replacement(value); }
    const action = output === value ? 'kept' : 'replaced';
    record(location, kind, action, 'string');
    return output;
  }
  function walk(value, location, field = '', force = false, parent = null) {
    if (typeof value === 'string') return string(value, location, field, force, parent);
    const legacyGameNumber = /\.legacy\.maps\..*\.chunkinfo\./.test(location) && force !== 'free';
    if (typeof value === 'number' && (blockedStrings.has(String(value)) || personalField.test(field) || force && !legacyGameNumber)) {
      const output = replacement(String(value));
      record(location, 'private-or-unknown-number', 'replaced', 'number'); return output;
    }
    const type = scalarType(value);
    record(location, type === 'object' || type === 'array' ? 'structure' : 'game-scalar', 'kept', type);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const child = walk(value[index], `${location}[]`, field, force, parent);
        if (!checking) value[index] = child;
      }
    } else if (value && typeof value === 'object') {
      // Undo patches store their semantic field in path, their contents in value.
      const semantic = Array.isArray(value.path)
        ? (freeField.test(value.path.at(-1)) || value.path[0] === 'preferences' && value.path.length > 1 ? value.path.at(-1) : value.path[0]) : field;
      const changes = [];
      for (const key of Object.keys(value)) {
        const known = vocabulary.keys.has(key);
        const dictionary = dictionaries.has(field);
        const privateKey = blockedStrings.has(key) || /^(?:friends|friendsAlt|maps)$/.test(field) || referenceValues.has(key) && /member/i.test(field);
        const keyLocation = `${location}.${known && !dictionary && !privateKey ? key : '{key}'}`;
        const numericKey = numeric.test(key.replace(/^\*fb\*_/, ''));
        const safeKey = !privateShape(key) && (numericKey
          ? numericKeyFields.has(field) || /\.(?:legacy\.maps|taskAlternatives|sourceBacklogs)\./.test(location)
          : known || vocabulary.gameValue?.(key) || vocabulary.values.has(key) || placeholder(key));
        const outputKey = privateKey || !safeKey ? replacement(key) : key;
        record(`${location}.{keys}`, privateKey ? 'personal-reference' : safeKey ? 'game-or-schema-key' : 'unknown-key', outputKey === key ? 'kept' : 'replaced', 'key');
        let childField = key, childForce = force;
        if (freeField.test(key)) childForce = 'free';
        if (key === 'label' && (field === 'actor' || field === 'actors')) childForce = 'free';
        if (!safeKey && !privateKey) childForce = 'unknown';
        if ((key === 'before' || key === 'after') && Array.isArray(value.path)) childField = semantic;
        if (key === 'value' && (field !== 'command')) childField = field;
        if (key === 'value' && field === 'command') childField = value.preferenceId ?? value.ruleId ?? key;
        if (key === 'value' && freeField.test(field)) childForce = 'free';
        const child = walk(value[key], keyLocation, childField, childForce, value);
        changes.push([key, outputKey, child]);
      }
      // Define properties rather than assigning user-controlled __proto__ keys.
      if (!checking) {
        for (const [old] of changes) delete value[old];
        for (const [, key, child] of changes) {
          if (Object.hasOwn(value, key)) fail('key-collision');
          Object.defineProperty(value, key, { value: child, enumerable: true, configurable: true, writable: true });
        }
      }
    }
    return value;
  }
  walk(document, '$');
  const after = backupCounts(document);
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('game-counts-changed');
  return { document, report: { schema: 'rs3-save-copy-report-v1', counts: before,
    categories: [...rows.values()].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)) } };
}

export async function availableCorpus(directory) {
  const selected = directory ?? process.env.SECRET_SCAN_CORPUS ?? defaultCorpusDir;
  try { await lstat(selected); }
  catch (error) { if (error.code === 'ENOENT' && !directory && !process.env.SECRET_SCAN_CORPUS) return null; fail('missing-or-invalid-corpus'); }
  return loadCorpus(selected);
}

function scanPrivateValues(document, corpus) {
  const reviewed = loadReviewed();
  // Scan decoded keys and strings, including every archived snapshot. Shared
  // game catalogues repeat heavily in a backup: scan each distinct string
  // once in bounded JSON batches instead of materializing a huge pretty copy.
  // Numeric spellings are included for private numeric corpus entries.
  // Semantic field bindings were checked above. No line exceptions apply.
  const findings = [], blockedStrings = new Set();
  const distinct = new Set();
  function collect(value) {
    if (typeof value === 'string') distinct.add(value);
    else if (typeof value === 'number') distinct.add(String(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { distinct.add(key); collect(child); }
  }
  collect(document);
  let batch = [];
  function scanBatch() {
    const found = inspectText(JSON.stringify(batch, null, 1), { corpus, reviewedHosts: reviewed.hosts, placeholders: reviewed.placeholders, escaped: true });
    findings.push(...found);
    for (const finding of found) {
      const value = batch[finding.line - 2];
      if (value !== undefined) blockedStrings.add(value);
      else fail('scanner-location-unmapped');
    }
    batch = [];
  }
  for (const value of distinct) {
    // Decoding an escaped newline changes scanner line numbering. Scan these
    // leaves separately so their entire original value is unambiguously bound.
    if (/[\\%\r\n]/.test(value)) {
      const found = inspectText(value, { corpus, reviewedHosts: reviewed.hosts, placeholders: reviewed.placeholders });
      findings.push(...found); if (found.length) blockedStrings.add(value);
    } else { batch.push(value); if (batch.length === 4096) scanBatch(); }
  }
  if (batch.length) scanBatch();
  return { findings, blockedStrings };
}

export async function checkBackup(document, { vocabulary, corpus = null, validate } = {}) {
  backupCounts(document);
  const { report } = scrubBackup(document, { vocabulary, checking: true });
  const changed = report.categories.filter(row => row.action !== 'kept');
  if (changed.length) fail('unscrubbed-fields');
  const { findings } = scanPrivateValues(document, corpus);
  if (findings.length) {
    const scanCategories = {};
    for (const finding of findings) scanCategories[finding.category] = (scanCategories[finding.category] ?? 0) + 1;
    throw Object.assign(new Error('Save-copy operation refused.'), { category: 'secret-scan-findings', scanCategories });
  }
  if (!validate) {
    // Bootstrap uses the dataset/pack selection supplied by the caller.
    try { validate = (await import('../../app/core/state.mjs')).importBackup; }
    catch { fail('backup-validator-unavailable'); }
  }
  try { await validate(document); } catch (error) {
    const validationLocations = [...String(error.stack ?? '').matchAll(/\/(app\/[^(): ]+\.mjs):(\d+):\d+/g)]
      .slice(0, 4).map(match => ({ module: match[1], line: Number(match[2]) }));
    throw Object.assign(new Error('Save-copy operation refused.'), { category: 'invalid-backup-state', validationLocations });
  }
  return { valid: true, secretScan: 'clean', corpus: corpus ? 'checked' : 'absent', counts: backupCounts(document) };
}

export async function prepareSaveCopy(raw, { vocabulary, corpus = null, validate } = {}) {
  backupCounts(raw);
  const { blockedStrings } = scanPrivateValues(raw, corpus);
  const result = scrubBackup(raw, { vocabulary, blockedStrings });
  result.report.check = await checkBackup(result.document, { vocabulary, corpus, validate });
  return result;
}

async function readBackup(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch { fail('input-unreadable-or-invalid-json'); }
}

async function separateFiles(files) {
  const canonical = [];
  for (const filename of files) {
    const absolute = path.resolve(filename);
    try { canonical.push(await realpath(absolute)); }
    catch { canonical.push(path.join(await realpath(path.dirname(absolute)), path.basename(absolute))); }
  }
  if (new Set(canonical.map(file => process.platform === 'win32' ? file.toLowerCase() : file)).size !== files.length) fail('input-output-alias');
  for (const output of canonical.slice(1)) {
    const relative = path.relative(repositoryRoot, output);
    if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) fail('output-inside-source-tree');
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {}, positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--check', '--report', '--corpus-dir'].includes(arg) && args[index + 1] && !options[arg]) options[arg] = args[++index];
    else if (arg.startsWith('--')) fail('usage');
    else positional.push(arg);
  }
  if (options['--check']) {
    if (positional.length || options['--report']) fail('usage');
    const document = await readBackup(options['--check']);
    const vocabulary = await gameVocabulary(), corpus = await availableCorpus(options['--corpus-dir']);
    const result = await checkBackup(document, { vocabulary, corpus });
    console.log(JSON.stringify(result)); return result;
  }
  if (positional.length !== 2) fail('usage');
  const [input, output] = positional;
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  if (options['--report']) await mkdir(path.dirname(path.resolve(options['--report'])), { recursive: true });
  await separateFiles([input, output, ...(options['--report'] ? [options['--report']] : [])]);
  const inputBytes = (await lstat(input)).size;
  const raw = await readBackup(input);
  const vocabulary = await gameVocabulary(), corpus = await availableCorpus(options['--corpus-dir']);
  // A failed check never produces an upload candidate.
  const { document, report } = await prepareSaveCopy(raw, { vocabulary, corpus });
  const check = report.check;
  const bytes = JSON.stringify(document) + '\n';
  report.check = check; report.inputBytes = inputBytes; report.outputBytes = Buffer.byteLength(bytes);
  report.actions = { kept: 0, replaced: 0, dropped: 0 };
  for (const row of report.categories) report.actions[row.action] += row.count;
  if (options['--report']) await writeFile(options['--report'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ written: true, outputBytes: report.outputBytes, categories: report.categories.length, check }));
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(JSON.stringify({ error: error.category ?? 'save-copy-failed', ...(error.scanCategories ? { scanCategories: error.scanCategories } : {}), ...(error.validationLocations ? { validationLocations: error.validationLocations } : {}) })); process.exitCode = 1; });
}
