import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { writeRegistryJson, syncDirectory } from './registry-lock.mjs';
import { registryObject as object, REGISTRY_ACCOUNT } from './registry-legacy.mjs';

const cid = v => typeof v === 'string' && /^c_[0-9a-f]{32}$/.test(v);
const pid = v => typeof v === 'string' && /^p_[0-9a-f]{32}$/.test(v);
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const bad = () => { throw new TypeError('Invalid retirement ledger.'); };
export const slotKey = s => JSON.stringify([s.pickerId, s.memberId]);
export const DELETION_POINTS = ['deletion-intent', 'deletion-registry-intent', 'deletion-roster', 'deletion-credentials', 'deletion-retired', 'deletion-complete'];
export const RETIREMENT_MIGRATION_POINTS = ['retirement-registry-preimage', 'retirement-ledger-preimage', 'retirement-backed-up', 'retirement-intent', 'retirement-ledger', 'retirement-registry', 'retirement-versioned'];
export function validateRetirements(ledger) {
  if (ledger.schemaVersion !== 3) return;
  if (!Array.isArray(ledger.characters) || !Array.isArray(ledger.slots) || !Array.isArray(ledger.deletions)) bad();
  const chars = new Set(), slots = new Set(), ids = new Set();
  const issuedCharacters = new Set(ledger.issuedCharacterIds), issuedPickers = new Set(ledger.issuedPickerIds);
  for (const c of ledger.characters) {
    if (!object(c, ['characterId', 'deletedAt']) || !cid(c.characterId) || !date(c.deletedAt) || chars.has(c.characterId) || !issuedCharacters.has(c.characterId)) bad();
    chars.add(c.characterId);
  }
  for (const s of ledger.slots) {
    if (!object(s, ['pickerId', 'memberId', 'characterId', 'retiredAt']) || !pid(s.pickerId) || typeof s.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.memberId)
      || !(s.characterId === null || cid(s.characterId)) || !date(s.retiredAt) || slots.has(slotKey(s)) || !issuedPickers.has(s.pickerId) || s.characterId !== null && !issuedCharacters.has(s.characterId)) bad();
    slots.add(slotKey(s));
  }
  for (const d of ledger.deletions) {
    if (!object(d, ['id', 'kind', 'accountId', 'characterId', 'pickerId', 'deleteGroup', 'targets', 'groups', 'createdAt', 'completedAt', 'receiptProof']) || !REGISTRY_ACCOUNT.test(d.id) || ids.has(d.id)
      || !['character', 'picker', 'account'].includes(d.kind) || !REGISTRY_ACCOUNT.test(d.accountId) || !(d.characterId === null || cid(d.characterId)) || !(d.pickerId === null || pid(d.pickerId))
      || typeof d.deleteGroup !== 'boolean' || !Array.isArray(d.targets) || !Array.isArray(d.groups) || new Set(d.groups).size !== d.groups.length || d.groups.some(p => !pid(p))
      || !date(d.createdAt) || !(d.completedAt === null || date(d.completedAt)) || !(d.receiptProof === undefined || d.receiptProof === null || /^[0-9a-f]{64}$/.test(d.receiptProof))) bad();
    const targets = new Set();
    for (const t of d.targets) {
      if (!object(t, ['characterId', 'pickerId', 'memberId']) || !cid(t.characterId) || !pid(t.pickerId) || typeof t.memberId !== 'string' || targets.has(t.characterId)
        || !chars.has(t.characterId) || !slots.has(slotKey(t))) bad();
      targets.add(t.characterId);
    }
    if (d.groups.some(p => !d.targets.some(t => t.pickerId === p))) bad();
    ids.add(d.id);
  }
}
export function registryV5(doc) {
  return { ...structuredClone(doc), schemaVersion: 5, deletions: structuredClone(doc.deletions ?? []) };
}
export function seedRetiredSlots(doc, ledger) {
  const add = s => { if (!ledger.slots.some(t => slotKey(t) === slotKey(s))) ledger.slots.push(s); };
  for (const d of doc.departures ?? []) if (d.completedAt) add({ ...d.source, characterId: d.characterId, retiredAt: d.completedAt });
  // Old onboarding receipts did not retain their source character. Preserve
  // the binding prohibition without guessing an identity from account order.
  for (const p of doc.pickers.filter(p => p.lifecycle === 'retired')) for (const memberId of p.memberIds) {
    const past = doc.pastMaps?.find(m => m.pickerId === p.id && m.memberId === memberId);
    add({ pickerId: p.id, memberId, characterId: past?.characterId ?? null, retiredAt: past?.createdAt ?? p.createdAt });
  }
  for (const c of doc.characters.filter(c => c.lifecycle === 'retired')) if (!ledger.characters.some(t => t.characterId === c.id)) ledger.characters.push({ characterId: c.id, deletedAt: c.createdAt });
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function retained(file, target) {
  const bytes = await readFile(file), temporary = `${target}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    try { await link(temporary, target); }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (!(await readFile(target)).equals(bytes)) throw new Error('Retirement migration preimage differs. Review recovery before upgrading.'); }
  } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  return hash(bytes);
}
/** The retained two-file intent is authoritative until both publications finish. */
export async function migrateRetirements(doc, ledger, { registryDir, ledgerFile, point, validate, start = false }) {
  const file = path.join(registryDir, 'registry.json'), intentFile = path.join(registryDir, 'retirement-migration.json');
  let intent;
  try { intent = JSON.parse(await readFile(intentFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (intent && !intent.completed) {
    if (intent.format !== 'registry-retirement-migration-v1' || !Array.isArray(intent.targets) || intent.targets.length !== 2 || !Array.isArray(intent.sources)) throw new Error('Invalid retirement migration intent.');
    for (const [n, target] of [file, ledgerFile].entries()) {
      const digest = hash(await readFile(target));
      if (digest !== intent.sources[n] && digest !== hash(JSON.stringify(intent.targets[n]) + '\n')) throw new Error('Retirement migration source changed. Review recovery before starting.');
    }
  } else {
    if (!start && doc.schemaVersion === 4 && ledger.schemaVersion === 2) {
      try { await readFile(path.join(registryDir, 'registry.pre-retirements-v4.json')); start = true; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (!start || doc.schemaVersion >= 5 && ledger.schemaVersion === 3) return [doc, ledger];
    if (doc.schemaVersion !== 4 || ![2, 3].includes(ledger.schemaVersion)) throw new Error('Retirement migration requires registry 4 and ledger 2 or 3.');
    const next = registryV5(doc), nextLedger = { ...structuredClone(ledger), schemaVersion: 3, slots: structuredClone(ledger.slots ?? []), deletions: structuredClone(ledger.deletions ?? []) };
    seedRetiredSlots(doc, nextLedger); validate(next, nextLedger);
    const sources = [await retained(file, path.join(registryDir, 'registry.pre-retirements-v4.json'))];
    await syncDirectory(registryDir); await point('retirement-registry-preimage');
    sources.push(await retained(ledgerFile, path.join(registryDir, 'ledger.pre-retirements-v2.json')));
    await syncDirectory(registryDir); await point('retirement-ledger-preimage');
    await syncDirectory(registryDir); await point('retirement-backed-up');
    intent = { format: 'registry-retirement-migration-v1', sources, targets: [next, nextLedger] };
    await writeRegistryJson(intentFile, intent); await point('retirement-intent');
  }
  validate(...intent.targets);
  await writeRegistryJson(ledgerFile, intent.targets[1]); await point('retirement-ledger');
  await writeRegistryJson(file, intent.targets[0]); await point('retirement-registry');
  await writeRegistryJson(intentFile, { ...intent, completed: true }); await point('retirement-versioned');
  return intent.targets;
}
