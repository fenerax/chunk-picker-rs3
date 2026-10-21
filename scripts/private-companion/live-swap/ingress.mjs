import net from 'node:net';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { failure } from './journal.mjs';

// Scratch direct-peer lanes stay inside this reserved local test range.
export const scratchPeerPorts = Object.freeze({ first: 8900, last: 8999 });
const portOK = port => Number.isInteger(port) && port >= 1024 && port <= 65535;
const loopback = host => host === '::1' || (net.isIPv4(host) && host.startsWith('127.'));
const canonical = host => net.isIPv6(host) ? new URL(`http://[${host}]/`).hostname.slice(1, -1) : host;
export function validateLanes(lanes, { scratch = false } = {}) {
  if (!Array.isArray(lanes) || !lanes.length || lanes.length > 8) throw failure('LIVE_SWAP_LANES');
  const names = new Set(), binds = new Set();
  const result = lanes.map(lane => {
    if (!lane || Object.keys(lane).some(key => !['name', 'host', 'port', 'trust'].includes(key))
      || !/^[a-z][a-z0-9-]{0,31}$/.test(lane.name) || !net.isIP(lane.host) || !portOK(lane.port)
      || !['loopback-proxy', 'direct-peer'].includes(lane.trust)) throw failure('LIVE_SWAP_LANE');
    const host = canonical(lane.host), local = loopback(host);
    // Production accepts explicit unicast tailnet binds only. No wildcards,
    // DNS aliases, mapped IPv4 or test trust overrides from topology JSON.
    const tailnet = net.isIPv4(host) ? host.startsWith('100.') && Number(host.split('.')[1]) >= 64 && Number(host.split('.')[1]) <= 127
      : host.startsWith('fd7a:115c:a1e0:');
    if ((lane.trust === 'loopback-proxy' && !local) || (lane.trust === 'direct-peer' && !(tailnet || (scratch && local && lane.port >= scratchPeerPorts.first && lane.port <= scratchPeerPorts.last)))) throw failure('LIVE_SWAP_LANE_TRUST');
    const bind = `${host}:${lane.port}`;
    if (names.has(lane.name) || binds.has(bind)) throw failure('LIVE_SWAP_LANE_DUPLICATE');
    names.add(lane.name); binds.add(bind);
    return Object.freeze({ ...lane, host });
  });
  if (!result.some(lane => lane.trust === 'loopback-proxy')) throw failure('LIVE_SWAP_LANE_PROBE');
  return Object.freeze(result);
}

export function validateDoorTopology(topology) {
  if (!topology || Object.keys(topology).some(key => !['schemaVersion', 'capability', 'legacyWatchdogMode', 'door', 'coordinator', 'stateDir', 'dataDir', 'journal', 'controlTokenFile', 'identityModule', 'helpers', 'runtimePins', 'old', 'next', 'currentPointer', 'nodePin', 'compatibilityEvidence', 'freezeBudgetEvidence', 'resourceEvidence'].includes(key))) throw failure('LIVE_SWAP_TOPOLOGY_FIELDS');
  const door = topology.door;
  if (!door || Object.keys(door).some(key => !['listen', 'lanes', 'contextHost', 'controlPipe', 'stateFile', 'recordFile', 'proofFile'].includes(key))) throw failure('LIVE_SWAP_DOOR_FIELDS');
  if (door.lanes !== undefined) {
    if (door.listen !== undefined) throw failure('LIVE_SWAP_DOOR_FIELDS');
    const lanes = validateLanes(door.lanes);
    if (!lanes.some(lane => lane.host === door.contextHost)) throw failure('LIVE_SWAP_LANE_CONTEXT');
    return lanes;
  }
  if (!portOK(door.listen) || door.contextHost !== undefined) throw failure('LIVE_SWAP_TOPOLOGY_PORT');
  return null;
}

export const ingressHeader = 'x-picker-ingress';
const proxyHeader = name => name.startsWith('x-forwarded-') || ['forwarded', 'x-real-ip', 'tailscale-funnel-request'].includes(name);
const mac = (token, payload) => createHmac('sha256', token).update(`picker-ingress-v1:${payload}`).digest('hex');
export function forwardHeaders(request, lane, token, contextHost) {
  const headers = { ...request.headers };
  delete headers[ingressHeader];
  if (!lane) return headers;
  const removed = {};
  for (const name of Object.keys(headers)) if (proxyHeader(name)) { removed[name] = headers[name]; if (lane.trust === 'direct-peer') delete headers[name]; }
  const payload = Buffer.from(JSON.stringify({ peer: request.socket.remoteAddress, encrypted: !!request.socket.encrypted,
    host: contextHost, proxy: removed, method: request.method, url: request.url })).toString('base64url');
  if (lane.trust === 'direct-peer') headers['x-forwarded-for'] = request.socket.remoteAddress;
  headers[ingressHeader] = `${payload}.${mac(token, payload)}`;
  return headers;
}

// The staged core hook calls this before authentication. Rel5's own request
// context function still owns all policy; no copied policy lives in the door.
export function createIngressContext({ token, contextHost, requestContext }) {
  return (request, options) => {
    const value = request.headers[ingressHeader];
    if (value === undefined) return requestContext(request, { ...options, host: contextHost });
    const reject = () => { throw failure('LIVE_SWAP_INGRESS_AUTH'); };
    if (typeof value !== 'string' || value.length > 48 * 1024 || !loopback(request.socket.remoteAddress)) return reject();
    const [payload, signature, extra] = value.split('.'), expected = mac(token, payload);
    if (extra !== undefined || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return reject();
    let proof; try { proof = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return reject(); }
    if (!net.isIP(proof.peer) || proof.host !== contextHost || proof.method !== request.method || proof.url !== request.url
      || typeof proof.encrypted !== 'boolean' || !proof.proxy || Object.keys(proof.proxy).some(key => !proxyHeader(key))) return reject();
    const headers = { ...request.headers };
    for (const name of Object.keys(headers)) if (proxyHeader(name) || name === ingressHeader) delete headers[name];
    Object.assign(headers, proof.proxy);
    return requestContext({ headers, socket: { remoteAddress: proof.peer, encrypted: proof.encrypted } }, { ...options, host: contextHost });
  };
}
