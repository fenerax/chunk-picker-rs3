// Startup preparation uses the existing worker warm queues. It admits one phase
// at a time after foreground quiet, and never changes saves or worker idle use.
export function createStartupWarmup({ worker, snapshot, busy, clock = { setTimeout, clearTimeout }, delayMs = 1000 }) {
  const phases = ['tasks', 'preview'];
  let timer, closed = false, phase = 0, input, rounds = 0;
  const progress = { status: 'pending', phase: phases[0], queued: 0 };
  function schedule() {
    if (closed || phase >= phases.length) return;
    clock.clearTimeout(timer);
    timer = clock.setTimeout(tick, delayMs); timer.unref?.();
  }
  function tick() {
    if (closed) return;
    const health = worker.getHealth();
    if (health.status === 'sleeping' || health.restartRequired) { progress.status = health.status === 'sleeping' ? 'sleeping' : 'unavailable'; return; }
    if (busy() || !health.ready) { schedule(); return; }
    try {
      const captured = snapshot();
      if (input !== captured.input) { input = captured.input; phase = 0; rounds = 0; }
      const prediction = phase === 1;
      const diagnostics = worker.getDiagnostics();
      const lane = prediction ? diagnostics.predictionLane : diagnostics;
      if (['sleeping', 'waking', 'restarting', 'restart-required', 'closed'].includes(lane?.worker?.status)
        || worker.canPrewarmTasks?.(prediction) === false) {
        progress.status = lane?.worker?.status === 'sleeping' ? 'sleeping' : 'unavailable'; return;
      }
      if (lane?.queue?.active || lane?.queue?.depth || lane?.prewarm?.pending || lane?.prewarm?.active) { schedule(); return; }
      // Cache hits are skipped, and cancelled queued work can be re-admitted
      // after an interactive request. Bound retries on calculator failures.
      const state = captured.metadata ?? captured.state;
      const admitted = worker.prewarmTasks(state, captured.input, state.members.map(member => member.id),
        { resultView: prediction ? 'play-v1' : 'full', prediction, stateInput: captured.stateInput });
      progress.queued += admitted.queued;
      if (admitted.queued) {
        progress.status = 'running'; progress.phase = phases[phase];
        if (++rounds > 8) { progress.status = 'unavailable'; return; }
      } else {
        phase++; rounds = 0;
        progress.phase = phases[phase] ?? 'complete';
        progress.status = phase === phases.length ? 'ready' : 'pending';
      }
    } catch { progress.status = 'unavailable'; return; }
    schedule();
  }
  schedule();
  return { diagnostics: () => ({ ...progress }), close() { closed = true; clock.clearTimeout(timer); } };
}
