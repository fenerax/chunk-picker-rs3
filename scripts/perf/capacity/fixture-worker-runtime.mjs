export function serveFixtureWorker(port, build, { exit = code => process.exit(code) } = {}) {
  let sequence = 0, running, stopping = false;
  const stoppedError = new Error('Fixture worker is stopping.');
  const acknowledgements = new Map();
  const progress = value => {
    if (stopping) return Promise.reject(stoppedError);
    const pending = Promise.withResolvers(), id = ++sequence;
    acknowledgements.set(id, pending);
    port.postMessage({ type: 'progress', id, value });
    return pending.promise;
  };
  port.on('message', message => {
    if (message.type === 'ack') {
      acknowledgements.get(message.id)?.resolve(); acknowledgements.delete(message.id); return;
    }
    if (message.type === 'stop') {
      if (stopping) return;
      stopping = true;
      for (const pending of acknowledgements.values()) pending.reject(stoppedError);
      acknowledgements.clear();
      // The active build includes openStore failure cleanup and store.close().
      // Closing the channel only after that settles permits a natural exit.
      void (async () => {
        await running;
        port.postMessage({ type: 'stopped' });
        port.close();
      })();
      return;
    }
    if (message.type !== 'build' || stopping) return;
    if (running) { port.postMessage({ type: 'failure', message: 'Fixture worker already has a build.' }); return; }
    running = (async () => {
      try {
        const value = await build(message.job, progress);
        if (!stopping) port.postMessage({ type: 'result', value });
      } catch (error) {
        if (stopping && error === stoppedError) return;
        // The build has settled, including its awaited close. A rejected close
        // can deliberately retain a production writer guard. Fail this scratch
        // isolate after reporting, so that guard cannot keep the pool waiting
        // forever for natural exit. process.exit only exits this Worker thread.
        stopping = true;
        try { port.postMessage({ type: 'failure', message: error.message }); }
        finally { port.close(); exit(1); }
      }
    })().finally(() => { running = undefined; });
  });
  // This runs only after the worker entrypoint's static imports and input parse.
  port.postMessage({ type: 'ready' });
}
