import { arrivals } from '../capacity/scheduler.mjs';
import { random } from '../capacity/model.mjs';
import { pause } from '../capacity/client.mjs';

// A 24-hour soak must not retain millions of future arrival objects. Keep at
// most thirty seconds of schedule, while keeping a single in-flight admission
// set across windows. Completion never changes an event's scheduled timestamp.
export function* schedule(c, phases, cohorts, keyedClients) {
  let offset = 0;
  for (const [stage, phase] of phases.entries()) {
    yield { atMs: offset, kind: 'phase', stage };
    const counters = {}, streams = { product: phase.actions,
      pluginReport: keyedClients ? phase.plugins * .4 : 0, pluginStatus: keyedClients ? phase.plugins * .4 : 0,
      pluginTasks: keyedClients ? phase.plugins * .2 : 0, sync: c['sync-per-minute'] / 60, isolation: .1 };
    for (let from = 0; from < phase.seconds; from += 30) {
      const seconds = Math.min(30, phase.seconds - from);
      const events = arrivals([{ seconds }], `${c.seed}:${stage}:${from}`, () => streams).map(event => ({ ...event,
        atMs: offset + from * 1000 + event.atMs, stage, ordinal: counters[event.kind] = (counters[event.kind] ?? -1) + 1 }));
      for (const [clientIndex, client] of cohorts[stage].entries()) {
        const stagger = random(`${c.seed}:session:${client.login}`)() * 5000, start = offset + from * 1000;
        for (let atMs = stagger + Math.ceil((start - stagger) / 5000) * 5000; atMs < start + seconds * 1000; atMs += 5000)
          events.push({ atMs, kind: 'session', stage, clientIndex });
      }
      events.sort((a, b) => a.atMs - b.atMs);
      yield* events;
    }
    offset += phase.seconds * 1000;
  }
}

export async function dispatchSchedule(events, run, { startAt, maxInFlight, onDrop, now = () => performance.now(), sleep = pause }) {
  const pending = new Set(); let failure;
  for (const event of events) {
    while (startAt + event.atMs > now()) await sleep(Math.min(1000, startAt + event.atMs - now()));
    if (failure) break;
    const offered = { ...event, scheduledAt: startAt + event.atMs };
    if (event.kind !== 'phase' && pending.size >= maxInFlight) { onDrop(offered); continue; }
    const job = Promise.resolve().then(() => run(offered)); pending.add(job);
    job.then(() => pending.delete(job), error => { pending.delete(job); failure ??= error; });
  }
  await Promise.allSettled(pending); if (failure) throw failure;
}
