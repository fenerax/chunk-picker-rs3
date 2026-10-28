import { withStoreWrite } from './snapshot.mjs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

// Feedback from the people using the picker (bugs, ideas). Kept beside the save, not in it,
// so it never appears in History, Undo or gameplay backups.
const KINDS = new Set(['bug', 'idea', 'other']);
const MAX_ITEMS = 2000, MAX_TEXT = 4000, MAX_CONTEXT_VALUE = 200, MAX_CONTEXT_KEYS = 12;
const error = (status, message) => Object.assign(new Error(message), { status });

function cleanContext(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw error(400, 'Feedback context must be an object.');
  const entries = Object.entries(value).slice(0, MAX_CONTEXT_KEYS)
    .filter(([key, item]) => /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof item))
    .map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, MAX_CONTEXT_VALUE) : item]);
  return entries.length ? Object.fromEntries(entries) : null;
}

function validate(document) {
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.items)) throw new TypeError('Invalid feedback store.');
  for (const item of document.items) {
    if (typeof item.id !== 'string' || !KINDS.has(item.kind) || typeof item.text !== 'string' || !['new', 'done'].includes(item.status)) throw new TypeError('Invalid feedback item.');
  }
  if (document.seen !== undefined && (!document.seen || typeof document.seen !== 'object' || Array.isArray(document.seen)
    || Object.values(document.seen).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string')))) throw new TypeError('Invalid feedback seen state.');
  return document;
}

// Labels can collide or change. A linked player shares identity across links;
// unlinked invitations and the master owner have stable, separate identities.
function actorKey(actor) {
  if (actor?.memberId) return `member:${actor.memberId}`;
  if (actor?.kind === 'master') return 'master';
  if (actor?.inviteId) return `invite:${actor.inviteId}`;
  throw error(400, 'A feedback identity is required.');
}
function owns(item, actor) {
  if (item.from?.memberId) return item.from.memberId === actor?.memberId;
  if (item.from?.inviteId) return item.from.inviteId === actor?.inviteId;
  return item.from?.kind === 'master' && actor?.kind === 'master';
}

async function atomicWrite(file, document) {
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (failure) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(failure.code) || attempt >= 6) throw failure;
        await delay(20 * 2 ** attempt);
      }
    }
  } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); }
}

/** Open under the gameplay store's existing exclusive data-directory lock. */
export async function openFeedbackStore({ dataDir, now = Date.now, hourlyLimit = 30 } = {}) {
  const file = path.join(dataDir, 'feedback.json');
  let current;
  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
  catch (failure) { if (failure.code !== 'ENOENT') throw failure; current = { schemaVersion: 1, items: [] }; }
  let queue = Promise.resolve(), closed = false;
  const recent = new Map();
  function mutate(operation) {
    if (closed) return Promise.reject(new Error('Feedback store is closed.'));
    const pending = queue.then(() => withStoreWrite(dataDir, async () => {
      const next = structuredClone(current);
      const result = operation(next);
      await atomicWrite(file, next); current = next;
      return result;
    }));
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    list() { return structuredClone(current.items).reverse(); },
    own(actor) { return structuredClone(current.items.filter(item => owns(item, actor))).reverse(); },
    summary(actor, admin = false) {
      const seen = new Set(current.seen?.[actorKey(actor)] ?? []);
      return { unread: admin ? current.items.filter(item => !seen.has(item.id)).length : 0 };
    },
    markSeen(ids, actor, admin = false) {
      if (!Array.isArray(ids) || ids.length > MAX_ITEMS || ids.some(id => typeof id !== 'string')) throw error(400, 'Send the displayed feedback IDs.');
      const key = actorKey(actor);
      return mutate(next => {
        const allowed = new Set(next.items.filter(item => admin || owns(item, actor)).map(item => item.id));
        if (ids.some(id => !allowed.has(id))) throw error(400, 'Only displayed feedback can be marked seen.');
        next.seen ??= {};
        const retained = new Set(next.items.map(item => item.id));
        next.seen[key] = [...new Set([...(next.seen[key] ?? []), ...ids])].filter(id => retained.has(id));
        return { unread: admin ? next.items.filter(item => !next.seen[key].includes(item.id)).length : 0 };
      });
    },
    counts() { return { total: current.items.length, open: current.items.filter(item => item.status === 'new').length }; },
    add(input, from) {
      if (!input || typeof input !== 'object') throw error(400, 'Send feedback as an object.');
      if (Object.keys(input).some(key => !['kind', 'text', 'context'].includes(key))) throw error(400, 'Use kind, text and optional context.');
      if (!KINDS.has(input.kind)) throw error(400, 'Choose bug, idea or other.');
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) throw error(400, 'Write something before sending.');
      if (text.length > MAX_TEXT) throw error(400, `Keep feedback under ${MAX_TEXT} characters.`);
      const context = cleanContext(input.context);
      // A light per-sender limit; the picker is private, this only stops accidental floods.
      const key = from?.inviteId ?? from?.kind ?? 'unknown', hourAgo = now() - 3600000;
      const times = (recent.get(key) ?? []).filter(time => time > hourAgo);
      if (times.length >= hourlyLimit) throw error(429, 'That’s a lot of feedback in an hour; please try again later.');
      times.push(now()); recent.set(key, times);
      return mutate(next => {
        if (next.items.length >= MAX_ITEMS) next.items.splice(0, next.items.length - MAX_ITEMS + 1);
        if (next.seen) {
          const retained = new Set(next.items.map(item => item.id));
          for (const key of Object.keys(next.seen)) next.seen[key] = next.seen[key].filter(id => retained.has(id));
        }
        const item = { id: randomUUID(), at: new Date(now()).toISOString(), kind: input.kind, text, ...(context ? { context } : {}),
          from: { label: String(from?.label ?? 'Unknown').slice(0, 80), ...(from?.kind ? { kind: from.kind } : {}),
            ...(from?.inviteId ? { inviteId: from.inviteId } : {}), ...(from?.memberId ? { memberId: from.memberId } : {}) }, status: 'new' };
        next.items.push(item);
        return structuredClone(item);
      });
    },
    setStatus(id, status) {
      if (!['new', 'done'].includes(status)) throw error(400, 'Status must be new or done.');
      return mutate(next => {
        const item = next.items.find(value => value.id === id);
        if (!item) throw error(404, 'Feedback not found.');
        item.status = status;
        if (status === 'done') item.doneAt = new Date(now()).toISOString(); else delete item.doneAt;
        return structuredClone(item);
      });
    },
    async close() { closed = true; await queue; },
  };
}
