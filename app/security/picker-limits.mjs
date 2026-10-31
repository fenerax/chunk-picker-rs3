import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Conservative admission bounds. EN6 capacity measurements can replace these
// defaults without changing accounting or the disabled-mode request path.
export const MP7_DEFAULTS = Object.freeze({
  maxOutstandingJobsPerPicker: 4, maxWaitersPerJob: 64,
  expensivePerAccount: 600, expensivePerPicker: 600, expensiveGlobal: 1200,
  streamsPerAccount: 16, streamsPerPicker: 32, streamsGlobal: 64,
  pluginKeysPerAccount: 3, pluginKeysPerPicker: 6, pluginKeysGlobal: 192,
  pluginRequestsPerKey: 4, pluginRequestsPerAccount: 16, pluginRequestsPerPicker: 32, pluginRequestsGlobal: 128,
  invitationsPerAccount: 10, invitationsPerPicker: 20, invitationsGlobal: 100,
  registrationsPerAccount: 3, registrationsGlobal: 30,
  provisioningPerAccount: 3, provisioningGlobal: 30,
  coldStartsPerAccount: 1, coldStartsGlobal: 1,
  bodyBytesPerRequest: 256 * 1024 * 1024, bodyBytesPerAccount: 256 * 1024 * 1024,
  bodyBytesPerPicker: 256 * 1024 * 1024, bodyBytesGlobal: 512 * 1024 * 1024,
  // Owned backup bodies may wait on the network; their own global budget keeps
  // the rest of bodyBytesGlobal for ordinary writes. Keep it below bodyBytesGlobal.
  importBodyBytesGlobal: 384 * 1024 * 1024, importBodyIdleMs: 30000, importBodyTotalMs: 600000,
  limitWindowMs: 60000, pluginWindowMs: 1000, limitMaxAccounts: 10000,
});
export function pickerLimitOptions(options = {}) {
  const config = Object.fromEntries(Object.entries(MP7_DEFAULTS).map(([key, fallback]) => [key, options[key] ?? fallback]));
  for (const [key, value] of Object.entries(config)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${key} must be a positive integer.`);
  return Object.freeze(config);
}
const hash = value => createHash('sha256').update(value).digest('hex');
const refusal = (message, retryAfter = 1, status = 429) => Object.assign(new Error(message), { status, retryAfter });
const keyHash = request => {
  const key = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
  return key && hash(key);
};

/** One instance belongs to the server, including dormant pickers. */
export function createPickerLimits(options = {}, { now = Date.now } = {}) {
  const config = pickerLimitOptions(options), buckets = new Map(), streams = new Map(), cold = new Map(), keys = new Map(), bodyHeld = new Map();
  let registry;
  const scope = (identity, pickerId) => ({ pickerId, accountId: identity?.accountId ?? identity?.id ?? `picker:${pickerId}`, ...(identity?.accountIds ? { accountIds: identity.accountIds } : {}) });
  function rows(kind, owner, accountLimit, pickerLimit, globalLimit) {
    return [...(globalLimit ? [[`${kind}:global`, globalLimit]] : []), ...(accountLimit ? (owner.accountIds ?? [owner.accountId]).map(id => [`${kind}:account:${id}`, accountLimit]) : []),
      ...(pickerLimit ? [[`${kind}:picker:${owner.pickerId}`, pickerLimit]] : [])];
  }
  function charge(entries, amount = 1, window = config.limitWindowMs, message = 'Too many requests. Wait and retry.') {
    const at = now();
    for (const [key, entry] of buckets) if (entry.until <= at) buckets.delete(key);
    const selected = entries.map(([key, limit]) => {
      // Overflow shares a bucket rather than evicting live accounting.
      if (!buckets.has(key) && buckets.size >= config.limitMaxAccounts * 16) key = key.split(':').slice(0, 2).join(':') + ':overflow';
      let entry = buckets.get(key);
      if (!entry) { entry = { count: 0, until: at + window }; buckets.set(key, entry); }
      return { entry, limit };
    });
    for (const { entry, limit } of selected) if (entry.count + amount > limit) throw refusal(message, Math.max(1, Math.ceil((entry.until - at) / 1000)));
    for (const { entry } of selected) entry.count += amount;
    return selected;
  }
  function lease(counts, entries, message, status = 429) {
    for (const [key, limit] of entries) if ((counts.get(key) ?? 0) >= limit) throw refusal(message, 1, status);
    for (const [key] of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return; released = true;
      for (const [key] of entries) { const count = counts.get(key) - 1; if (count) counts.set(key, count); else counts.delete(key); }
    };
  }
  function legacyScope(pickerId, memberId) {
    const legacyId = registry?.listPickers().find(p => p.kind === 'legacy-shared')?.id;
    const accounts = registry?.listAccounts().filter(account => account.memberships.some(m => m.pickerId === legacyId && m.memberId === memberId)) ?? [];
    // Old keys did not record their issuer. Charge every possible owning account
    // until such a key is revoked, instead of guessing and resetting a quota.
    return scope(accounts.length ? { accountIds: accounts.map(account => account.id) } : undefined, pickerId);
  }
  function pluginScope(request, pickerId, memberId) {
    const known = keys.get(keyHash(request));
    if (known) return known;
    const capability = registry?.resolveCapability('plugin-key', keyHash(request));
    if (capability) return scope(capability, pickerId);
    return legacyScope(pickerId, memberId);
  }
  function keyLease(owner) {
    const counts = keyCounts();
    for (const [key, limit] of rows('keys', owner, config.pluginKeysPerAccount, config.pluginKeysPerPicker, config.pluginKeysGlobal)) if ((counts.get(key) ?? 0) >= limit) throw refusal('Too many plugin keys. Revoke an existing key before creating another.');
  }
  // Includes pending issuance: a persistence await cannot oversubscribe a cap.
  const reservations = new Map();
  function keyCounts() {
    const counts = new Map(reservations);
    for (const owner of keys.values()) for (const [key] of rows('keys', owner, 1, 1, 1)) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }
  return {
    config, scope, pluginScope,
    async initialize(value) {
      registry = value;
      for (const picker of registry.listPickers()) {
        if (picker.lifecycle !== 'active') continue;
        let document;
        try { document = JSON.parse(await readFile(path.join(registry.pickerDirectory(picker.id), 'plugin-keys.json'), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const record of document.keys) if (!record.revoked) {
          const capability = registry.resolveCapability('plugin-key', record.tokenHash);
          const account = record.accountId ? { accountId: record.accountId } : capability;
          keys.set(record.tokenHash, account ? scope(account, picker.kind === 'legacy-shared' ? 'legacy' : picker.id)
            : picker.kind === 'legacy-shared' ? legacyScope('legacy', record.player) : scope(undefined, picker.id));
        }
      }
    },
    expensive(identity, pickerId) { charge(rows('expensive', scope(identity, pickerId), config.expensivePerAccount, config.expensivePerPicker, config.expensiveGlobal)); },
    stream(identity, pickerId, response) {
      if (response.destroyed || response.writableEnded) return false;
      const release = lease(streams, rows('streams', scope(identity, pickerId), config.streamsPerAccount, config.streamsPerPicker, config.streamsGlobal),
        'Too many event streams. Close an existing connection and retry.');
      response.once('close', release); response.once('finish', release); return true;
    },
    coldStart(owner) { return lease(cold, rows('cold', owner, config.coldStartsPerAccount, 0, config.coldStartsGlobal), 'Pickers are opening. Wait a moment and retry.', 503); },
    invitation(identity, pickerId) { charge(rows('invites', scope(identity, pickerId), config.invitationsPerAccount, config.invitationsPerPicker, config.invitationsGlobal), 1, config.limitWindowMs, 'Too many invitations. Wait before creating another invite.'); },
    plugin(request, pickerId, memberId) {
      charge([...rows('plugin', pluginScope(request, pickerId, memberId), config.pluginRequestsPerAccount, config.pluginRequestsPerPicker, config.pluginRequestsGlobal),
        [`plugin:key:${keyHash(request)}`, config.pluginRequestsPerKey]], 1, config.pluginWindowMs, 'Plugin traffic is too high. Slow the plugin polling rate and retry.');
    },
    reserveKey(identity, pickerId, memberId) {
      // Resolve pre-existing legacy player keys to the same account as issuance.
      const owner = identity?.accountId ? scope(identity, pickerId) : pluginScope({ headers: {} }, pickerId, memberId);
      keyLease(owner);
      const entries = rows('keys', owner, 1, 1, 1);
      for (const [key] of entries) reservations.set(key, (reservations.get(key) ?? 0) + 1);
      let released = false;
      return { finish(key) {
        if (released) return; released = true;
        if (key) keys.set(hash(key), owner);
        for (const [name] of entries) { const count = reservations.get(name) - 1; if (count) reservations.set(name, count); else reservations.delete(name); }
      } };
    },
    revokeKey(digest) { keys.delete(digest); },
    // Deleted pickers stop holding key quota, dormant ones included. An account
    // tombstone alone releases nothing: deleting an account also tombstones the
    // pickers it owns, while its keys on a surviving shared picker stay usable
    // and so stay counted, with their issuer's traffic accounting.
    forgetDeleted() {
      if (!registry) return;
      const pickers = new Set(registry.deletionRecords().pickers.map(t => t.pickerId));
      for (const [digest, owner] of keys) if (pickers.has(owner.pickerId)) keys.delete(digest);
    },
    registration(client) { charge(rows('registration', { accountId: client }, config.registrationsPerAccount, 0, config.registrationsGlobal), 1, config.limitWindowMs, 'Too many sign-in attempts. Wait before starting sign-in again.'); },
    provisioningRegistry(value) {
      return new Proxy(value, { get(target, name) {
        if (!['firstLogin', 'ensureDefaultPicker'].includes(name)) return target[name];
        return async (...args) => {
          const account = name === 'firstLogin' ? target.findIdentity(...args) : target.getAccount(args[0]);
          const picker = account?.defaultPickerId && target.getPicker(account.defaultPickerId);
          if (name === 'firstLogin' && !account) charge(rows('new-account', { accountId: hash(JSON.stringify(args)) }, config.registrationsPerAccount, 0, config.registrationsGlobal), 1, config.limitWindowMs, 'Too many account registrations. Wait before trying sign-in again.');
          if (!picker || picker.provisioning !== 'ready') charge(rows('provision', { accountId: account?.id ?? hash(JSON.stringify(args)) }, config.provisioningPerAccount, 0, config.provisioningGlobal), 1, config.limitWindowMs, 'Too many picker creation attempts. Wait and retry sign-in.');
          return target[name](...args);
        };
      } });
    },
    body(request) {
      const declared = Number(request.headers['content-length']);
      if (declared > config.bodyBytesPerRequest) throw refusal('Request body is too large. Send a smaller request.');
      const reserved = Number.isSafeInteger(declared) && declared > 0 ? declared : 0;
      const message = 'Upload budget reached. Wait and send a smaller request.';
      const held = new Map();
      function admit(entries, amount) {
        for (const [key, limit] of entries) if ((bodyHeld.get(key) ?? 0) + amount > limit) throw refusal(message);
        const charged = charge(entries, amount, config.limitWindowMs, message);
        for (const [key] of entries) {
          bodyHeld.set(key, (bodyHeld.get(key) ?? 0) + amount);
          held.set(key, (held.get(key) ?? 0) + amount);
        }
        return charged;
      }
      const credits = reserved ? [admit(rows('body', {}, 0, 0, config.bodyBytesGlobal), reserved)] : [];
      const importRows = () => rows('import-body', {}, 0, 0, config.importBodyBytesGlobal);
      let owner, bytes = 0, failed = false, released = false, importing = false;
      const emit = request.emit;
      // All existing body readers (iterator, pipe and resume) share this ingress
      // check. Refused chunks never reach a parser or an allocation buffer.
      request.emit = function (event, ...args) {
        if (event === 'data') {
          if (failed || released) return false;
          const size = Buffer.byteLength(args[0]);
          try {
            if (bytes + size > config.bodyBytesPerRequest) throw refusal('Request body is too large. Send a smaller request.');
            const extra = Math.max(0, bytes + size - reserved) - Math.max(0, bytes - reserved);
            if (extra) admit([...rows('body', owner ?? {}, owner ? config.bodyBytesPerAccount : 0, owner ? config.bodyBytesPerPicker : 0, config.bodyBytesGlobal),
              ...(importing ? importRows() : [])], extra);
            bytes += size;
          } catch (error) { failed = true; this.pause(); return emit.call(this, 'error', error); }
        }
        return emit.call(this, event, ...args);
      };
      request.on('error', () => {});
      const bind = selected => {
        if (owner) return;
        const accountCredits = reserved ? admit(rows('body', selected, config.bodyBytesPerAccount, config.bodyBytesPerPicker, 0), reserved) : [];
        owner = selected; credits.push(accountCredits);
      };
      // Called once a request is known to be an owned backup upload, before any
      // wait on its body: charges what it holds and will hold to the import budget.
      bind.importing = () => {
        if (importing || released) return;
        const amount = Math.max(reserved, bytes);
        if (amount) credits.push(admit(importRows(), amount));
        importing = true;
      };
      bind.release = () => {
        if (released) return; released = true;
        const unused = Math.max(0, reserved - bytes);
        for (const group of credits) for (const { entry } of group) entry.count -= unused;
        for (const [key, amount] of held) {
          const remaining = bodyHeld.get(key) - amount;
          if (remaining) bodyHeld.set(key, remaining); else bodyHeld.delete(key);
        }
      };
      return bind;
    },
  };
}
