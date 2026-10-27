/** Literal Tailscale IP ranges; DNS suffixes and other private LANs are excluded. */
export function isTailscaleAddress(hostname = '') {
  if (/^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    return parts[1] >= 64 && parts[1] <= 127 && parts.every(part => part <= 255);
  }
  try {
    const host = new URL(`http://${hostname.startsWith('[') ? hostname : `[${hostname}]`}/`).hostname;
    return host.startsWith('[fd7a:115c:a1e0:');
  } catch { return false; }
}

export function canSaveAddress(scope = globalThis) {
  return scope.isSecureContext !== false || (scope.location?.protocol === 'http:' && isTailscaleAddress(scope.location.hostname));
}

export const insecureAddressMessage = 'This address cannot save safely. Open the HTTPS link or localhost.';

export function browserUUID(crypto = globalThis.crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
