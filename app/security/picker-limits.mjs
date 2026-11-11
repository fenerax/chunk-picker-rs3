import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Conservative admission bounds. EN6 capacity measurements can replace these
// defaults without changing accounting or the disabled-mode request path.
export const MP7_DEFAULTS = Object.freeze({
  maxOutstandingJobsPerPicker: 4, maxWaitersPerJob: 64,
  expensivePerAccount: 600, expensivePerPicker: 600, expensiveGlobal: 1200,
  streamsPerAccount: 16, streamsPerPicker: 32, streamsGlobal: 64,
  pluginKeysPerCharacter: 3, pluginKeysPerAccount: 30, pluginKeysPerPicker: 15, pluginKeysGlobal: 9000,
  keyChangesPerAccount: 12, keyChangesPerMember: 12,
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
// Second segment of a plugin key quota row (`keys:<scope>:...`); `keys:global` falls back to the service.
const keyScopeLabels = new Map([['character', 'This character'], ['account', 'This login'], ['picker', 'This group']]);
const refusal = (message, retryAfter = 1, status = 429) => Object.assign(new Error(message), { status, retryAfter });
const keyHash = request => {
  const key = /^Bearer (gpk_[A-Za-z0-9_-]{43})$/i.exec(request.headers.authorization ?? '')?.[1];
  return key && hash(key);
};

/** One instance belongs to the server, including dormant pickers. */
export function createPickerLimits(options = {}, { now = Date.now, onKeyCount = () => {} } = {}) {
  const config = pickerLimitOptions(options), buckets = new Map(), streams = new Map(), cold = new Map(), keys = new Map(), bodyHeld = new Map();
  const keyCounts = new Map();
  let bucketCursor = buckets.entries();
  let registry, legacyId;
  const legacyAccounts = new Map();
  const scope = (identity, pickerId) => ({ pickerId, accountId: identity?.accountId ?? identity?.id ?? `picker:${pickerId}`, ...(identity?.accountIds ? { accountIds: identity.accountIds } : {}) });
  function rows(kind, owner, accountLimit, pickerLimit, globalLimit) {
    return [...(globalLimit ? [[`${kind}:global`, globalLimit]] : []), ...(accountLimit ? (owner.accountIds ?? [owner.accountId]).map(id => [`${kind}:account:${id}`, accountLimit]) : []),
      ...(pickerLimit ? [[`${kind}:picker:${owner.pickerId}`, pickerLimit]] : [])];
  }
  function charge(entries, amount = 1, window = config.limitWindowMs, message = 'Too many requests. Wait and retry.') {
    const at = now();
    // Bounded background reclamation; selected buckets also expire lazily.
    // Admission must not walk every login's live rate buckets on each request.
    for (let i = 0; i < 16; i++) {
      const item = bucketCursor.next();
      if (item.done) { bucketCursor = buckets.entries(); break; }
      const [key, entry] = item.value;
      if (entry.until <= at) buckets.delete(key);
    }
    const selected = entries.map(([key, limit]) => {
      if (buckets.get(key)?.until <= at) buckets.delete(key);
      // Overflow shares a bucket rather than evicting live accounting.
      const overflow = key.split(':').slice(0, 2).join(':') + ':overflow';
      // Keep using a live overflow window after reclamation frees capacity;
      // otherwise one identity could acquire a fresh bucket mid-window.
      if (!buckets.has(key) && (buckets.size >= config.limitMaxAccounts * 16 || buckets.get(overflow)?.until > at)) key = overflow;
      let entry = buckets.get(key);
      if (entry?.until <= at) { buckets.delete(key); entry = undefined; }
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
    const accounts = registry?.accountsForMember?.(legacyId, memberId) ?? legacyAccounts.get(memberId) ?? [];
    // Old keys did not record their issuer. Charge every possible owning account
    // until such a key is revoked, instead of guessing and resetting a quota.
    return scope(accounts.length ? { accountIds: accounts } : undefined, pickerId);
  }
  function pluginScope(request, pickerId, memberId) {
    const known = keys.get(keyHash(request));
    if (known) return known;
    const capability = registry?.resolveCapability('plugin-key', keyHash(request));
    if (capability) return scope(capability, pickerId);
    return legacyScope(pickerId, memberId);
  }
  // Until durable characters exist, a character key scope is the immutable
  // (picker, member) tuple. Never use the login allowance as a member allowance.
  function keyRows(owner) {
    return [...rows('keys', owner, config.pluginKeysPerAccount, config.pluginKeysPerPicker, config.pluginKeysGlobal),
      [`keys:character:${JSON.stringify([owner.pickerId, owner.memberId])}`, config.pluginKeysPerCharacter]];
  }
  function keyLease(owner) {
    for (const [key, limit] of keyRows(owner)) {
      onKeyCount();
      if ((keyCounts.get(key) ?? 0) < limit) continue;
      const scope = keyScopeLabels.get(key.split(':')[1]) ?? 'The service';
      throw refusal(`${scope} has reached its plugin key limit. Revoke an existing key before creating another.`);
    }
  }
  // Includes pending issuance: a persistence await cannot oversubscribe a cap.
  function adjustKeys(owner, amount) {
    for (const [key] of keyRows(owner)) {
      onKeyCount();
      const count = (keyCounts.get(key) ?? 0) + amount;
      if (count) keyCounts.set(key, count); else keyCounts.delete(key);
    }
  }
  function revokeKey(digest) {
    const owner = keys.get(digest);
    if (!owner) return;
    adjustKeys(owner, -1); keys.delete(digest);
  }
  return {
    config, scope, pluginScope,
    async initialize(value) {
      registry = value;
      const pickers = registry.listPickers();
      legacyId = pickers.find(picker => picker.kind === 'legacy-shared')?.id;
      // Older adapters can supply a startup snapshot. The registry itself uses
      // its live membership index, including membership edits and retirements.
      if (legacyId && !registry.accountsForMember) for (const account of registry.listAccounts()) for (const membership of account.memberships) {
        if (membership.pickerId !== legacyId) continue;
        if (!legacyAccounts.has(membership.memberId)) legacyAccounts.set(membership.memberId, []);
        legacyAccounts.get(membership.memberId).push(account.id);
      }
      for (const picker of pickers) {
        if (picker.lifecycle !== 'active') continue;
        let document;
        try { document = JSON.parse(await readFile(path.join(registry.pickerDirectory(picker.id), 'plugin-keys.json'), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const record of document.keys) if (!record.revoked) {
          const capability = registry.resolveCapability('plugin-key', record.tokenHash);
          const account = record.accountId ? { accountId: record.accountId } : capability;
          const owner = account ? scope(account, picker.kind === 'legacy-shared' ? 'legacy' : picker.id)
            : picker.kind === 'legacy-shared' ? legacyScope('legacy', record.player) : scope(undefined, picker.id);
          const entry = { ...owner, memberId: record.player };
          revokeKey(record.tokenHash);
          keys.set(record.tokenHash, entry); adjustKeys(entry, 1);
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
      const owner = { ...(identity?.accountId ? scope(identity, pickerId) : pluginScope({ headers: {} }, pickerId, memberId)), memberId };
      keyLease(owner);
      adjustKeys(owner, 1);
      let released = false;
      return { finish(key) {
        if (released) return; released = true;
        if (key) { revokeKey(hash(key)); keys.set(hash(key), owner); }
        else adjustKeys(owner, -1);
      } };
    },
    revokeKey,
    keyChange(identity, pickerId, memberId) {
      charge([...rows('key-change', scope(identity, pickerId), config.keyChangesPerAccount, 0, 0),
        [`key-change:member:${JSON.stringify([pickerId, memberId ?? 'admin'])}`, config.keyChangesPerMember]],
      1, config.limitWindowMs, 'Too many plugin key changes. Wait before creating or revoking another key.');
    },
    // Diagnostics only: admission uses the incrementally maintained map.
    keyCounts() { return Object.fromEntries(keyCounts); },
    // Deleted pickers stop holding key quota, dormant ones included. An account
    // tombstone alone releases nothing: deleting an account also tombstones the
    // pickers it owns, while its keys on a surviving shared picker stay usable
    // and so stay counted, with their issuer's traffic accounting.
    forgetDeleted() {
      if (!registry) return;
      const pickers = new Set(registry.deletionRecords().pickers.map(t => t.pickerId));
      for (const [digest, owner] of keys) if (pickers.has(owner.pickerId)) revokeKey(digest);
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
