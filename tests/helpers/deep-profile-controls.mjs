import { EventEmitter } from 'node:events';
import { createDeepProfiles } from '../../app/deep-profiles.mjs';
import { acknowledgement, checkpoint, manualClock, profile } from './process-lifecycle.mjs';

export { checkpoint, manualClock, profile };

// No global inspector or timer patches: every capture owns its controls.
export function inspectorControls(held = []) {
  const gates = Object.fromEntries(['Profiler.enable', 'Profiler.start', 'Profiler.stop'].map(method => {
    const gate = acknowledgement(method, method === 'Profiler.stop' ? { profile } : {});
    if (!held.includes(method)) gate.ack();
    return [method, gate];
  }));
  let disconnected = 0;
  return { gates, disconnected: () => disconnected,
    async openSession() {
      return { disconnect() { disconnected++; }, post(method, callback) {
        gates[method].issue().then(value => callback(null, value), error => callback(error));
      } };
    } };
}

// ProcessWorker IPC interprets deadlines in epoch milliseconds.
export function nativeClock() {
  const clock = manualClock(), epoch = Date.now() - clock.now();
  return { ...clock, now: () => epoch + clock.now() };
}

export async function controlledProfiles(dir, options = {}) {
  return createDeepProfiles(dir, { clock: manualClock(), openSession: inspectorControls().openSession, ...options });
}

export function dispatchedWorker(onDispatch = () => {}) {
  const worker = new EventEmitter(), messages = [];
  let dispatched = Promise.withResolvers();
  worker.postMessage = message => { if (message.id !== undefined) { messages.push(message); dispatched.resolve({ worker, message }); onDispatch({ worker, message }); dispatched = Promise.withResolvers(); } };
  worker.terminate = async () => { worker.terminated = true; worker.emit('exit', 0); };
  worker.nextDispatch = () => { return dispatched.promise; };
  worker.messages = messages;
  queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] }));
  return worker;
}
