import { isMainThread } from 'node:worker_threads';

// Test-only heap exhaustion. A relay preload ignores its main thread.
if (!isMainThread) {
  const held = [];
  while (true) held.push(new Array(100000).fill(123));
}
