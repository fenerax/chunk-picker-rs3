import assert from 'node:assert/strict';

// A shared runner can deschedule an otherwise responsive process. Retry only a
// missed timing ceiling, never an operation failure, and keep the original
// ceiling on every attempt. A repeatable stall must fail all three samples.
export async function responsiveSample(work, { maxGapMs, attempts = 3, label = 'main-thread', beforeEach }) {
  const gaps = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Worker transfers consume buffers. Rebuild independent input outside the
    // measured product operation, just as the original fixture setup did.
    const input = await beforeEach?.();
    let last = performance.now(), gap = 0;
    const timer = setInterval(() => {
      const now = performance.now(); gap = Math.max(gap, now - last); last = now;
    }, 5);
    const start = performance.now();
    try {
      const result = await work(input);
      // Include synchronous work at both ends, even when no interval fired.
      await new Promise(resolve => setTimeout(resolve, 5));
      gap = Math.max(gap, performance.now() - last);
      gaps.push(gap);
      if (gap < maxGapMs) return { result, gap, ms: performance.now() - start, gaps };
    } finally { clearInterval(timer); }
  }
  assert.fail(`${label} gaps [${gaps.map(gap => gap.toFixed(1)).join(', ')}] ms; every sample exceeded ${maxGapMs} ms`);
}
