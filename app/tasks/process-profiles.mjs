// Host-local capture ownership. Waiting for online is cancellable and does
// not make the calculator's native profiler state uncertain.
export function createProcessProfiles({ worker, online, retire, openSession = async () => {
  const { Session } = await import('node:inspector');
  const session = new Session(); session.connect(); return session;
}, stopTimeoutMs = 1000 }) {
  let current;
  const post = (session, method) => new Promise((resolve, reject) => session.post(method, (error, value) => error ? reject(error) : resolve(value)));
  const cancelled = capture => capture.cancelled || Date.now() >= capture.deadline;
  function check(capture) { if (cancelled(capture)) throw new Error('Capture cancelled.'); }
  function finish(capture) {
    capture.cancelled = true; capture.cancel.resolve(); clearTimeout(capture.timer);
    return capture.finished ??= (async () => {
      // Relay sampling stops independently of a stalled native start/stop.
      const relay = (async () => {
        try {
          await capture.relayReady.catch(() => {});
          if (capture.relayStarted) return (await post(capture.session, 'Profiler.stop')).profile;
        } finally { capture.session?.disconnect(); }
      })();
      const calculator = (async () => {
        if (!capture.issued) return;
        let timer;
        try {
          return await Promise.race([
            capture.native.then(handle => handle.stop()),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native profiler did not stop.')), stopTimeoutMs); timer.unref?.(); }),
          ]);
        } catch (error) { capture.uncertain = true; retire(); throw error; }
        finally { clearTimeout(timer); }
      })();
      // A relay error must neither bypass native cleanup nor retire a healthy
      // calculator whose native stop succeeded.
      const [nativeResult, relayResult] = await Promise.allSettled([calculator, relay]);
      if (nativeResult.status === 'rejected') throw nativeResult.reason;
      if (relayResult.status === 'rejected') throw relayResult.reason;
      return { calculator: nativeResult.value, relay: relayResult.value };
    })();
  }
  return {
    async start(deadline) {
      if (current || !Number.isFinite(deadline) || deadline <= Date.now()) throw new Error('Capture unavailable.');
      const capture = current = { deadline: Math.min(deadline, Date.now() + 600000), cancel: Promise.withResolvers() };
      capture.timer = setTimeout(() => { void finish(capture).catch(() => {}); }, capture.deadline - Date.now()); capture.timer.unref?.();
      capture.relayReady = (async () => {
        capture.session = await openSession(); check(capture);
        await post(capture.session, 'Profiler.enable'); check(capture);
        capture.relayStarted = true;
        await post(capture.session, 'Profiler.start');
      })();
      try {
        await capture.relayReady; check(capture);
        await Promise.race([online, capture.cancel.promise]); check(capture);
        // No await may separate this check from issuing the native request.
        capture.issued = true;
        capture.native = (async () => worker.startCpuProfile())();
        await Promise.race([capture.native, capture.cancel.promise]); check(capture);
      } catch (error) {
        try { await finish(capture); } finally { if (current === capture) current = undefined; }
        throw error;
      }
    },
    async stop() {
      const capture = current;
      if (!capture) throw new Error('No capture.');
      try { return await finish(capture); } finally { if (current === capture) current = undefined; }
    },
    async cancel() {
      const capture = current;
      if (!capture) return true;
      // A lost IPC acknowledgement alone does not make native state uncertain:
      // prove both profilers stopped when possible. finish() retires only if a
      // native request fails or exceeds its bounded stop allowance.
      try { await finish(capture); }
      catch (error) { if (capture.uncertain) throw error; }
      finally { if (current === capture) current = undefined; }
      return true;
    },
  };
}
