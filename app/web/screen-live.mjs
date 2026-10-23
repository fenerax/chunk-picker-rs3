// Main-screen live; shared values and callbacks live in the explicit screen context.
export function createScreenLive(c) {
  function connectEvents() {
    const recovery = c.queue.then(() => c.recoverPendingCommand());
    c.queue = recovery.catch(error => { c.saved(error.retryPaused ? 'Save not confirmed' : 'Save confirmation needed', true); c.showError(error); });
    const ready = new Set();
    let attempts = 0;
    open();
    function open() {
      const events = new EventSource('/api/events');
      events.addEventListener('revision', async event => {
        const update = JSON.parse(event.data), revision = update.revision;
        c.primeSavedTasks(revision);
        // Our own commit notification can precede its HTTP acknowledgement. Let
        // queued commands adopt that response before deciding whether to fetch.
        await c.queue.catch(() => {});
        if (revision <= c.state.revision) { if (!c.hasPendingCommand()) c.saved('Saved', false, c.state.revision); return; }
        try {
          const response = await c.api('/api/state');
          const unchanged = update.taskResultsUnchanged === true && revision === c.state.revision + 1 && response.state.revision === revision;
          if (unchanged) c.rememberUnchangedTaskRevisions(c.state.revision, revision);
          const reuse = unchanged
            && c.result?.stateRevision === c.state.revision ? c.result : undefined;
          c.adopt(response.state, response.pools, reuse);
          if (!c.hasPendingCommand()) c.saved('Saved', false, c.state.revision);
        } catch (error) { c.saved(c.pendingCommandPaused?.() ? 'Save not confirmed' : 'Sync failed', true); c.showError(error); }
      });
      events.addEventListener('error', () => {
        c.saved(c.pendingCommandPaused?.() ? 'Save not confirmed' : 'Reconnecting…', true);
        // The browser retries a dropped stream itself, but an error response while
        // the picker restarts (an update) closes it for good. Reopen it here.
        if (events.readyState !== 2 /* CLOSED */) return;
        setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(5, attempts++)) + Math.floor(Math.random() * 500));
      });
      events.addEventListener('open', () => {
        attempts = 0;
        if (c.pendingCommandPaused?.()) c.saved('Save not confirmed', true);
        else c.saved(c.hasPendingCommand() ? 'Confirming pending save…' : 'Syncing…');
        void c.duoCoordination?.refresh();
        void c.gamePlugin?.refresh();
      });
      events.addEventListener('game-plugin', () => void c.gamePlugin?.refresh());
      events.addEventListener('worker', event => c.workerStatus(JSON.parse(event.data)));
      events.addEventListener('task-ready', async event => {
        if (c.canWrite()) return;
        const value = JSON.parse(event.data), revision = value.revision ?? value.stateRevision;
        if (revision !== c.state.revision || !c.state.members.some(owner => owner.id === value.memberId)) return;
        await c.refreshDuoInspection?.(revision);
        const key = `${revision}:${value.memberId}`;
        if (ready.has(key)) return;
        if (ready.size > c.state.members.length * 2) ready.clear();
        ready.add(key);
        if (value.memberId === c.memberId) { await c.foregroundTaskLoad?.promise.catch(() => {}); if (revision === c.state.revision && value.memberId === c.memberId && c.result?.stateRevision !== revision) void c.loadTasks(); }
        else if (c.duoEnabled()) { await c.duoLoading?.promise?.catch(() => {}); if (revision === c.state.revision && c.duoEnabled()) { c.duoLoadError = undefined; c.renderTasks(); } }
      });
      events.addEventListener('version', event => { try { c.updates?.seen(JSON.parse(event.data).version); } catch {} });
    }
  }

  Object.assign(c, { connectEvents });
}
