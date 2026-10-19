const unavailable = (code, message) => Object.assign(new Error(message), { status: 503, code, retryAfter: 1 });

/** Synchronous START boundaries keep sidecar writes outside a writer transfer. */
export function createLiveSwapAdmission() {
  let frozen = false, exclusions = 0, ordinary = 0;
  const drains = new Set();
  return {
    get frozen() { return frozen; },
    get exclusions() { return exclusions; },
    get ordinary() { return ordinary; },
    cancelFreeze() { frozen = false; },
    begin() {
      if (frozen) throw unavailable('PICKER_UPDATING', 'Please try again in a moment.');
      exclusions++;
      let released = false, drainable = false;
      return {
        ordinary() {
          if (released || drainable) return;
          // Admission was taken before freeze; changing its class cannot race
          // freeze because both transitions are synchronous on the HTTP thread.
          exclusions--; ordinary++; drainable = true;
        },
        finish() {
          if (released) return;
          released = true;
          if (drainable) ordinary--; else exclusions--;
          if (!ordinary) { for (const resolve of drains) resolve(); drains.clear(); }
        },
      };
    },
    async freeze(timeoutMs = 2000) {
      if (frozen) throw unavailable('LIVE_SWAP_ALREADY_FROZEN', 'The picker is already updating.');
      if (exclusions) throw unavailable('LIVE_SWAP_BUSY', 'A request is still running. Please try again in a moment.');
      frozen = true;
      if (!ordinary) return;
      let timer, drained;
      try {
        await Promise.race([
          new Promise(resolve => { drained = resolve; drains.add(resolve); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable('LIVE_SWAP_DRAIN_TIMEOUT', 'Write freeze drain deadline expired; old writer retained.')), timeoutMs); }),
        ]);
      } catch (error) { frozen = false; throw error; }
      finally { clearTimeout(timer); drains.delete(drained); }
    },
  };
}
