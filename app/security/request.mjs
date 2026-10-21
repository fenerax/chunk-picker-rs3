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

/** Only loopback and this server's exact bound Tailscale IP can be tailscaled. */
export function requestContext(request, { host, publicOrigin } = {}) {
  const peer = clientAddress(request.socket.remoteAddress);
  const bound = clientAddress(host);
  const trustedProxy = matches(loopback, peer) || (!!bound && !matches(loopback, bound) && isPrivateClient(bound) && peer === bound);
  const hasForwarding = trustedProxy && ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'].some(key => key in request.headers);
  // tailscaled overwrites XFF with one IP, rather than appending a chain. Reject chains.
  const forwarded = hasForwarding ? clientAddress(request.headers['x-forwarded-for']) : null;
  const address = hasForwarding ? forwarded : peer;
  // Any marker, even an untrusted/spoofed one, disables master credentials.
  const funnel = 'tailscale-funnel-request' in request.headers;
  const secure = !!request.socket.encrypted || (trustedProxy && (request.headers['x-forwarded-proto'] === 'https' || funnel));
  const origin = `${secure ? 'https' : 'http'}://${request.headers.host}`;
  return { address, rateKey: address ?? `unknown:${peer ?? 'peer'}`, trustedProxy, funnel, secure, origin,
    publicRequest: funnel || !isPrivateClient(address), masterAllowed: !funnel && isPrivateClient(address), publicOrigin };
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

/** Bounded fixed windows. Active buckets are never evicted to reset a client's limit. */
export function createRateLimits({ now = Date.now, failedJoins = 10, joinWindowMs = 15 * 60 * 1000,
  unauthenticated = 60, requestWindowMs = 60 * 1000, maxClients = 10000 } = {}) {
  for (const value of [failedJoins, joinWindowMs, unauthenticated, requestWindowMs, maxClients]) {
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
