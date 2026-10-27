import { BlockList, isIP } from 'node:net';

const privateClients = new BlockList();
privateClients.addSubnet('127.0.0.0', 8, 'ipv4');
privateClients.addAddress('::1', 'ipv6');
privateClients.addSubnet('100.64.0.0', 10, 'ipv4');
privateClients.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6');
const loopback = new BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

/** Canonicalize addresses so mapped IPv4 and alternate IPv6 spellings share limits. */
export function clientAddress(value) {
  if (typeof value !== 'string' || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  let canonical;
  try { canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1); } catch { return null; }
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}
function matches(list, address) { return !!address && list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6'); }
export function isPrivateClient(address) { return matches(privateClients, clientAddress(address)); }

export function normalizePublicOrigin(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('RS3_PUBLIC_ORIGIN must be an HTTPS origin.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin !== value) {
    throw new TypeError('RS3_PUBLIC_ORIGIN must be an HTTPS origin without a path, credentials or trailing slash.');
  }
  return parsed.origin;
}

export function normalizeIngressRole(value = 'private') {
  if (value !== 'private' && value !== 'public') throw new TypeError('ingressRole must be private or public.');
  return value;
}

function publicHost(value, publicOrigin) {
  // Parse an authority only: URL's permissive handling of paths, credentials,
  // numeric host aliases and whitespace must not expand this allowlist.
  if (typeof value !== 'string') return false;
  const match = /^(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match || match[0] !== value || (match[2] !== undefined && Number(match[2]) > 65535)) return false;
  const name = match[1].startsWith('[') ? match[1].slice(1, -1) : match[1];
  if (match[1].startsWith('[') && isIP(name) !== 6) return false;
  if (matches(loopback, clientAddress(name))) return true;
  return !!publicOrigin && value.toLowerCase() === new URL(publicOrigin).host.toLowerCase();
}

/** Listener policy owns privilege; forwarding metadata only describes a request. */
export function requestContext(request, { host, publicOrigin, ingressRole = 'private' } = {}) {
  normalizeIngressRole(ingressRole);
  const publicIngress = ingressRole === 'public';
  const peer = clientAddress(request.socket.remoteAddress);
  const bound = clientAddress(host);
  // Public proxy trust is deliberately narrower than the legacy private lane.
  const trustedProxy = publicIngress ? peer === '127.0.0.1' || peer === '::1'
    : matches(loopback, peer) || (!!bound && !matches(loopback, bound) && isPrivateClient(bound) && peer === bound);
  const hasForwarding = trustedProxy && ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'].some(key => key in request.headers);
  // tailscaled overwrites XFF with one IP, rather than appending a chain. Reject chains.
  const forwarded = trustedProxy ? clientAddress(request.headers['x-forwarded-for']) : null;
  const address = publicIngress && trustedProxy ? forwarded : hasForwarding ? forwarded : peer;
  // Any marker, even an untrusted/spoofed one, disables master credentials.
  const funnel = 'tailscale-funnel-request' in request.headers;
  const secure = !!request.socket.encrypted || (trustedProxy && (request.headers['x-forwarded-proto'] === 'https' || funnel));
  let effectiveHost = request.headers.host;
  if (publicIngress) {
    if (!publicHost(effectiveHost, publicOrigin)) throw Object.assign(new Error('Unexpected public Host.'), { status: 403 });
    if (trustedProxy && 'x-forwarded-host' in request.headers) {
      effectiveHost = request.headers['x-forwarded-host'];
      if (!publicHost(effectiveHost, publicOrigin)) throw Object.assign(new Error('Unexpected forwarded Host.'), { status: 403 });
    }
    effectiveHost = effectiveHost.toLowerCase();
  }
  const origin = `${secure ? 'https' : 'http'}://${effectiveHost}`;
  return { address, rateKey: address ?? `unknown:${peer ?? 'peer'}`, trustedProxy, funnel, secure, origin, ingressRole,
    publicRequest: publicIngress || funnel || !isPrivateClient(address), masterAllowed: !publicIngress && !funnel && isPrivateClient(address), publicOrigin };
}

export function checkRequestOrigin(request, context) {
  const origin = request.headers.origin;
  const allowed = context.publicRequest
    ? context.secure && !!context.publicOrigin && context.origin === context.publicOrigin && origin === context.publicOrigin
    : origin === context.origin || (!!context.publicOrigin && context.secure && context.origin === context.publicOrigin && origin === context.publicOrigin);
  if (origin && !allowed) throw Object.assign(new Error('This mutation must come from the same origin.'), { status: 403 });
  if (context.publicRequest && !origin) throw Object.assign(new Error('An Origin header is required.'), { status: 403 });
  if (request.headers['sec-fetch-site'] === 'cross-site') throw Object.assign(new Error('Cross-site mutations are forbidden.'), { status: 403 });
  if (!origin && !request.headers.authorization) throw Object.assign(new Error('An Origin header is required for cookie-authenticated mutations.'), { status: 403 });
}

/** Bounded fixed windows. Active buckets are never evicted to reset a client's limit.
 * The calculation budget stops scripted spam from a leaked link; opening a chunk
 * costs several budgeted requests and the master link shares one identity across
 * every tab, so it stays far above what a person clicking around can reach. */
export function createRateLimits({ now = Date.now, failedJoins = 10, joinWindowMs = 15 * 60 * 1000,
  unauthenticated = 60, requestWindowMs = 60 * 1000, maxClients = 10000,
  expensive = 600, expensiveGlobal = 1200, expensiveWindowMs = 60 * 1000 } = {}) {
  for (const value of [failedJoins, joinWindowMs, unauthenticated, requestWindowMs, maxClients, expensive, expensiveGlobal, expensiveWindowMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Rate limit settings must be positive integers.');
  }
  const buckets = new Map();
  function bucket(key, kind, window) {
    const at = now();
    const id = `${kind}:${key}`;
    let entry = buckets.get(id);
    if (entry && entry.until > at) return entry;
    for (const [id, entry] of buckets) if (entry.until <= at) buckets.delete(id);
    const selected = buckets.size >= maxClients ? `${kind}:overflow` : id;
    entry = buckets.get(selected);
    if (!entry || entry.until <= at) { entry = { count: 0, until: at + window }; buckets.set(selected, entry); }
    return entry;
  }
  function check(entry, limit, increment) {
    if (entry.count >= limit) throw Object.assign(new Error('Please try again later.'), { status: 429, retryAfter: Math.max(1, Math.ceil((entry.until - now()) / 1000)) });
    if (increment) entry.count++;
  }
  return {
    expensive(key) {
      const total = bucket('global', 'expensive-total', expensiveWindowMs);
      const identity = bucket(key, 'expensive', expensiveWindowMs);
      // Check both before charging either; rejected identities cannot drain the global budget.
      check(total, expensiveGlobal, false); check(identity, expensive, false);
      total.count++; identity.count++;
    },
    unauthenticated(key) { check(bucket(key, 'request', requestWindowMs), unauthenticated, true); },
    joinAllowed(key) { check(bucket(key, 'join', joinWindowMs), failedJoins, false); },
    joinFailed(key) { bucket(key, 'join', joinWindowMs).count++; },
    beginJoin(key) {
      const entry = bucket(key, 'join', joinWindowMs);
      check(entry, failedJoins, true);
      let finished = false;
      return success => { if (!finished && success) entry.count--; finished = true; };
    },
  };
}

/** Shared picker/overlay connection budget; a new session cannot reset an invite's cap. */
export function createStreamLimits({ streamsPerIdentity = 16, streamsGlobal = 64 } = {}) {
  for (const value of [streamsPerIdentity, streamsGlobal]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Stream limits must be positive integers.');
  }
  const identities = new Map();
  let total = 0;
  return (key, response) => {
    // A peer may disconnect while authentication/sidecar persistence is awaited.
    if (response.destroyed || response.writableEnded) return false;
    const count = identities.get(key) ?? 0;
    if (count >= streamsPerIdentity || total >= streamsGlobal) throw Object.assign(new Error('Too many event streams. Close an existing connection and retry.'), { status: 429, retryAfter: 20 });
    total++; identities.set(key, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true; total--;
      const remaining = identities.get(key) - 1;
      if (remaining) identities.set(key, remaining); else identities.delete(key);
    };
    response.once('close', release); response.once('finish', release);
    return true;
  };
}

/** Disconnect slow SSE consumers instead of accumulating buffered broadcasts. */
export function writeEvent(response, bytes) {
  if (response.destroyed) return false;
  if (response.write(bytes)) return true;
  response.destroy(); return false;
}
