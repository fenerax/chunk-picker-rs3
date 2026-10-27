import { browserUUID } from './save-address.mjs';

// IndexedDB transactions provide atomic ownership on private HTTP, where Web
// Locks are unavailable. A reload's pagehide cannot finish the release, so a
// held record is taken over when no open page answers for it on the ownership
// channel. The original of a duplicated tab still answers and keeps it.
const channelName = 'picker.command-ownership.v1';
const owned = new Map(), probes = new Map();
let channel;

function ownershipChannel(Channel) {
  if (channel || typeof Channel !== 'function') return channel;
  channel = new Channel(channelName);
  channel.onmessage = ({ data }) => {
    if (data?.type === 'probe' && owned.has(data.clientId)) channel.postMessage({ type: 'owned', probe: data.probe });
    else if (data?.type === 'owned') probes.get(data.probe)?.();
  };
  return channel;
}

// Without a channel no page can answer, so a held record is never taken over.
function ownerAnswers(clientId, Channel, probeMs, probe) {
  const bus = ownershipChannel(Channel);
  if (!bus) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => { probes.delete(probe); resolve(false); }, probeMs);
    probes.set(probe, () => { clearTimeout(timer); probes.delete(probe); resolve(true); });
    bus.postMessage({ type: 'probe', clientId, probe });
  });
}

// One readwrite transaction: IndexedDB serializes them, so read-then-write is a compare-and-swap.
function swap(db, clientId, expected, next) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('owners', 'readwrite'), store = transaction.objectStore('owners');
    let seen;
    const read = store.get(clientId);
    read.onsuccess = () => {
      seen = read.result;
      if (seen !== expected) return;
      if (next === undefined) store.delete(clientId); else store.put(next, clientId);
    };
    transaction.oncomplete = () => resolve(seen);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function acquireHttpSession(clientId, indexedDB = globalThis.indexedDB,
  { BroadcastChannel: Channel = globalThis.BroadcastChannel, probeMs = 300, token = browserUUID() } = {}) {
  // Claimed before the first await: a second call from this page must not take over the first.
  if (owned.has(clientId)) return Promise.resolve(null);
  owned.set(clientId, token);
  ownershipChannel(Channel); // An owner must listen before anyone asks.
  const fail = () => { if (owned.get(clientId) === token) owned.delete(clientId); };
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('picker.command-ownership.v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('owners');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  }).then(async db => {
    db.onversionchange = () => db.close();
    try {
      const seen = await swap(db, clientId, undefined, token);
      if (seen !== undefined && (await ownerAnswers(clientId, Channel, probeMs, token) || await swap(db, clientId, seen, token) !== seen)) {
        db.close(); fail(); return null;
      }
    } catch (error) { db.close(); throw error; }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (owned.get(clientId) === token) owned.delete(clientId);
      swap(db, clientId, token, undefined).catch(() => {}).finally(() => db.close());
    };
  }).catch(error => { fail(); throw error; });
}
