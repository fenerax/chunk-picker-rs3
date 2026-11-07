import { setImmediate as nextTurn } from 'node:timers/promises';

// Observe an asynchronous acknowledgement without assigning the machine a
// time budget. Prefer fixture events when the producer exposes them.
export async function waitForCondition(predicate) {
  for (;;) {
    const value = await predicate();
    if (value) return value;
    await nextTurn();
  }
}
