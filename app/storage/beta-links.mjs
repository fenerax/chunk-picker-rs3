import { createHash, randomUUID } from 'node:crypto';
import { generateToken } from '../security/tokens.mjs';
import { writeRegistryJson } from './registry-lock.mjs';

const DAY = 86400000;
const hash = secret => createHash('sha256').update(secret).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export const BETA_LINK_FILE = 'beta-links.json';
export function admissionMode(options = {}) {
  const mode = options.admission === undefined ? 'invite-only' : options.admission;
  if (!['invite-only', 'open'].includes(mode)) throw new TypeError('multiPicker.admission must be invite-only or open.');
  return mode;
}
const unavailable = () => { throw Object.assign(new Error('This beta link is unavailable. Ask the person who invited you for a new link.'), { status: 403 }); };
export function createBetaLinks({ file, document = { schemaVersion: 1, links: [] }, now, poison }) {
  const bad = () => { throw new TypeError('Invalid beta-link store.'); };
  const keys = ['id', 'secretHash', 'createdAt', 'expiresAt', 'label', 'status', 'terminalAt', 'accountId'];
  if (!document || Object.keys(document).some(k => !['schemaVersion', 'links'].includes(k)) || document.schemaVersion !== 1 || !Array.isArray(document.links) || document.links.length > 20000) bad();
  const ids = new Set(), hashes = new Set();
  for (const i of document.links) {
    if (!i || Object.keys(i).length !== keys.length || Object.keys(i).some(k => !keys.includes(k)) || !uuid(i.id) || ids.has(i.id)
      || !/^[0-9a-f]{64}$/.test(i.secretHash) || hashes.has(i.secretHash)
      || !Number.isFinite(Date.parse(i.createdAt)) || !Number.isFinite(Date.parse(i.expiresAt)) || Date.parse(i.expiresAt) <= Date.parse(i.createdAt)
      || !(i.label === null || typeof i.label === 'string' && i.label.length <= 120 && !/[\u0000-\u001f\u007f]/.test(i.label))
      || !['pending', 'consuming', 'consumed', 'expired', 'revoked'].includes(i.status)
      || (['pending', 'consuming'].includes(i.status) ? i.terminalAt !== null : !Number.isFinite(Date.parse(i.terminalAt)))
      || (['consuming', 'consumed'].includes(i.status) ? !uuid(i.accountId) : i.accountId !== null)) bad();
    ids.add(i.id); hashes.add(i.secretHash);
  }
  let current = structuredClone(document), cursor = 0;
  const stamp = () => new Date(now()).toISOString();
  async function save(next) {
    try { await writeRegistryJson(file, next); current = next; }
    catch (error) { poison(); throw error; }
  }
  function terminal(i, status) { i.status = status; i.terminalAt = status === 'expired' ? i.expiresAt : stamp(); }
  function clean(next) {
    const visited = new Set();
    for (let n = 0; n < Math.min(16, next.links.length); n++) visited.add(next.links[cursor++ % next.links.length].id);
    for (const i of next.links) if (visited.has(i.id) && i.status === 'pending' && Date.parse(i.expiresAt) <= now()) terminal(i, 'expired');
    next.links = next.links.filter(i => !visited.has(i.id) || !i.terminalAt || now() - Date.parse(i.terminalAt) < 30 * DAY);
  }
  function bySecret(secret) {
    if (typeof secret !== 'string' || !/^bet_[A-Za-z0-9_-]{43}$/.test(secret)) unavailable();
    const i = current.links.find(i => i.secretHash === hash(secret));
    if (!i || i.status !== 'pending' || Date.parse(i.expiresAt) <= now()) unavailable();
    return i;
  }
  const view = ({ secretHash, accountId, ...i }) => structuredClone(i);
  return {
    preview(secret) { return view(bySecret(secret)); },
    list() { return current.links.map(i => view(i.status === 'pending' && Date.parse(i.expiresAt) <= now() ? { ...i, status: 'expired', terminalAt: i.expiresAt } : i)); },
    async issue({ label = null, expiresInMs = 14 * DAY } = {}) {
      const issuedAt = now();
      if (!(label === null || typeof label === 'string' && label.length <= 120 && !/[\u0000-\u001f\u007f]/.test(label)) || !Number.isSafeInteger(expiresInMs) || expiresInMs < 1 || !Number.isFinite(new Date(issuedAt + expiresInMs).getTime())) throw new TypeError('Use a short label and a positive expiry in milliseconds.');
      const next = structuredClone(current); clean(next);
      if (next.links.length >= 20000 || next.links.filter(i => i.status === 'pending' && Date.parse(i.expiresAt) > now()).length >= 10000) throw Object.assign(new Error('The beta-link limit has been reached. Revoke unused links or wait for old records to expire.'), { status: 409 });
      const secret = 'bet_' + generateToken(), i = { id: randomUUID(), secretHash: hash(secret), createdAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + expiresInMs).toISOString(), label, status: 'pending', terminalAt: null, accountId: null };
      next.links.push(i); await save(next); return { ...view(i), secret };
    },
    async revoke(id) {
      const next = structuredClone(current), i = next.links.find(i => i.id === id);
      if (!i) unavailable();
      if (i.status === 'pending') terminal(i, 'revoked');
      clean(next); await save(next); return view(i);
    },
    async begin(secret, accountId) {
      const id = bySecret(secret).id, next = structuredClone(current), i = next.links.find(i => i.id === id);
      i.status = 'consuming'; i.accountId = accountId; await save(next); return id;
    },
    async recover(accountExists) {
      const next = structuredClone(current);
      for (const i of next.links) if (i.status === 'consuming') {
        if (accountExists(i.accountId)) terminal(i, 'consumed');
        else { i.status = 'pending'; i.accountId = null; }
      }
      clean(next);
      if (JSON.stringify(next) !== JSON.stringify(current)) await save(next);
    },
  };
}
