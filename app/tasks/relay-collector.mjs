// A process-worker host only relays messages, so its isolate rarely collects:
// every relayed save state and result stays resident as garbage. After at least
// `minBytes` pass through, one major collection runs `delayMs` later. The host
// heap holds no calculation graph, so this pause is short and never blocks the
// calculator thread.
export function createRelayCollector({ collect = typeof globalThis.gc === 'function'
  ? () => globalThis.gc({ type: 'major', execution: 'async' }) : undefined,
clock = { setTimeout, clearTimeout }, delayMs = 500, minBytes = 1024 * 1024 } = {}) {
  let relayed = 0, timer, closed = false, collections = 0;
  return {
    note(bytes) {
      if (!collect || closed) return;
      relayed += bytes;
      if (relayed < minBytes || timer !== undefined) return;
      timer = clock.setTimeout(async () => {
        timer = undefined; relayed = 0;
        if (closed) return;
        try { await collect(); collections++; } catch { /* Collection is advisory. */ }
      }, delayMs);
      timer?.unref?.();
    },
    close() { closed = true; clock.clearTimeout(timer); timer = undefined; },
    diagnostics: () => ({ available: !!collect, pending: timer !== undefined, collections }),
  };
}

/** Bytes of shared buffers carried by a process-worker transport envelope. */
export function envelopeBytes(envelope) {
  return (envelope?.shared ?? []).reduce((sum, row) => sum + (row.bytes?.byteLength ?? 0), 0);
}
