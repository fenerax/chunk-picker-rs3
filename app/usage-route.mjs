import { openUsageStore, USAGE_MAX_BYTES } from './storage/usage.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });

/** Fixed windows bound both request volume and identity-bucket memory. */
export function createUsageRateLimit({ now = Date.now, perIdentity = 12, global = 600, windowMs = 60000, maxIdentities = 1000 } = {}) {
  for (const value of [perIdentity, global, windowMs, maxIdentities]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Usage rate limits must be positive integers.');
  }
  const identities = new Map();
  let total = { count: 0, until: 0 };
  return key => {
    const at = new Date(now()).getTime();
    if (total.until <= at) total = { count: 0, until: at + windowMs };
    for (const [id, bucket] of identities) if (bucket.until <= at) identities.delete(id);
    let bucket = identities.get(key);
    if (total.count >= global || (!bucket && identities.size >= maxIdentities) || bucket?.count >= perIdentity) {
      throw Object.assign(failure(429, 'Please try usage counts again later.'), { retryAfter: Math.max(1, Math.ceil(((bucket?.until ?? total.until) - at) / 1000)) });
    }
    if (!bucket) { bucket = { count: 0, until: at + windowMs }; identities.set(key, bucket); }
    total.count++; bucket.count++;
  };
}

export async function openUsageRoute({ dataDir, members, authenticate, bodyJSON, json, now = Date.now, rateLimits, readOnly = false, storage, admission } = {}) {
  const actors = members.map(member => member.id);
  storage ??= await openUsageStore({ dataDir, actors, now, readOnly });
  admission ??= createUsageRateLimit({ now, ...rateLimits });
  return {
    async handle(request, response, { route, security, identity, closed, checkRequestOrigin } = {}) {
      if (route !== '/api/usage') return false;
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) throw failure(405, 'Method not allowed.');
      if (request.method !== 'POST') {
        if (!identity.admin || identity.readOnly) throw failure(403, 'Administrator access required.');
        const document = await storage.read();
        const fresh = authenticate(request, security);
        if (!fresh) throw failure(401, 'Access required.');
        if (!fresh.admin || fresh.readOnly) throw failure(403, 'Administrator access required.');
        await json(request, response, 200, document); return true;
      }
      checkRequestOrigin(request, security);
      admission(identity.inviteId ? `invite:${identity.inviteId}` : identity.kind);
      const body = await bodyJSON(request, USAGE_MAX_BYTES);
      if (closed()) throw failure(503, 'The picker is stopping. Retry after it restarts.');
      // Invitation revocation or relinking may finish while receiving the body.
      const fresh = authenticate(request, security);
      if (!fresh) throw failure(401, 'Access required.');
      // The master link belongs to the first player; unlinked invitations stay separate.
      const actor = fresh.readOnly ? 'viewer' : fresh.memberId ?? (fresh.kind === 'master' ? actors[0] : 'unlinked');
      await storage.add(body, actor);
      await json(request, response, 200, { accepted: true }); return true;
    },
    close: () => storage.close(),
  };
}
