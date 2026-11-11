export function errorDetails(error) {
  return error ? { name: error.name ?? 'Error', code: error.code ?? error.status ?? null,
    message: error.message ?? String(error), stack: error.stack ?? null } : null;
}

export function trialFailure(mode, error) {
  return { mode, message: error.message, error: errorDetails(error), ...error.trialEvidence };
}

// Keep metadata only: never retain an endpoint, job state, worker or Error in
// the report. The same recorder is used by the trial and synthetic regressions.
export function calculatorEvidence({ context, diagnostics }) {
  const records = [], schedulerEvents = [], byWorker = new WeakMap(), exited = new Set();
  let sealed = false;
  function schedulerState() { try { return diagnostics() ?? null; } catch { return null; } }
  function onWorker(worker) {
    if (byWorker.has(worker)) return byWorker.get(worker);
    const record = { workerId: records.length + 1, pid: worker.pid ?? null,
      start: { ...context(), replacement: records.length > 0 }, events: [], errors: [], exit: null };
    records.push(record); byWorker.set(worker, record);
    worker.on('error', error => {
      if (!sealed || record.events.length || record.errors.length)
        record.errors.push({ ...context(), error: errorDetails(error), scheduler: schedulerState() });
    });
    worker.once('exit', code => {
      exited.add(worker);
      if (!sealed || record.events.length || record.errors.length)
        record.exit = { code: code ?? null, ...context(), scheduler: schedulerState() };
    });
    return record;
  }
  return { records, schedulerEvents, onWorker, get hasExited() { return exited.size > 0; },
    onLifecycle({ worker, error, ...event }) {
      if (sealed) return;
      const receipt = { ...context(), ...event, scheduler: event.scheduler ?? schedulerState(), error: errorDetails(error) };
      if (worker) onWorker(worker).events.push(receipt); else schedulerEvents.push(receipt);
    },
    // Normal teardown must not masquerade as the cause of an invalid trial.
    // Exit/error details for an already observed incident can still arrive.
    seal() { sealed = true; },
  };
}

export function lifecycleSummary(report) {
  const lines = [];
  for (const trial of [...report.results, ...report.failures]) {
    for (const event of trial.schedulerLifecycle ?? []) {
      const state = event.scheduler, job = state?.activeJob;
      lines.push(`${trial.mode} scheduler: ${event.initiator} (${event.reason}); `
        + `stage ${event.stage}, barrier ${event.barrier}, last complete ${event.lastCompletedBarrier}; no resident calculator; `
        + `queue ${state?.queue?.depth ?? 'unknown'}, active ${job?.kind ?? 'none'} age ${job?.ageMs ?? 'n/a'} ms, `
        + `deadline ${job?.deadlineMs ?? state?.queue?.deadlineMs ?? 'unknown'} ms.`
        + (event.error ? ` ${event.error.name}: ${event.error.message}` : ''));
    }
    for (const worker of trial.calculatorLifecycle ?? []) {
      for (const event of worker.events) {
        const state = event.scheduler, job = state?.activeJob;
        lines.push(`${trial.mode} calculator ${worker.workerId}: ${event.initiator} (${event.reason}); `
          + `stage ${event.stage}, barrier ${event.barrier}, last complete ${event.lastCompletedBarrier}; `
          + `queue ${state?.queue?.depth ?? 'unknown'}, active ${job?.kind ?? 'none'} age ${job?.ageMs ?? 'n/a'} ms, `
          + `deadline ${job?.deadlineMs ?? (event.reason === 'startup-deadline' ? state?.startupDeadlineMs : state?.queue?.deadlineMs) ?? 'unknown'} ms; `
          + `exit ${worker.exit?.code ?? 'not observed'}.`
          + (event.error ? ` ${event.error.name}: ${event.error.message}` : ''));
      }
      for (const failure of worker.errors) lines.push(`${trial.mode} calculator ${worker.workerId} worker error at `
        + `stage ${failure.stage}, barrier ${failure.barrier}: ${failure.error.code ?? failure.error.name}: ${failure.error.message}`);
      if (!worker.events.length && worker.exit) lines.push(`${trial.mode} calculator ${worker.workerId}: initiator unknown; `
        + `exit ${worker.exit.code}, stage ${worker.exit.stage}, barrier ${worker.exit.barrier}.`);
    }
  }
  return lines;
}
