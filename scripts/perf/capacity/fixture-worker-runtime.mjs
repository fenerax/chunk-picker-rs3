export function serveFixtureWorker(port, build) {
  let sequence = 0, running, stopping = false;
  const acknowledgements = new Map();
  const progress = value => {
    if (stopping) return Promise.reject(new Error('Fixture worker is stopping.'));
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
      for (const pending of acknowledgements.values()) pending.reject(new Error('Fixture worker is stopping.'));
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
      } catch (error) { if (!stopping) port.postMessage({ type: 'failure', message: error.message }); }
    })().finally(() => { running = undefined; });
  });
  // This runs only after the worker entrypoint's static imports and input parse.
  port.postMessage({ type: 'ready' });
}
