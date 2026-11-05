import assert from 'node:assert/strict';

// Run every sample, including the cold path. Any gap at the hard ceiling fails;
// the best gap absorbs smaller scheduler/GC pauses. Return every result so
// callers can validate correctness for every execution outside the timing window.
export async function responsiveSample(work, { maxGapMs, hardGapMs, attempts = 3, label = 'main-thread', beforeEach }) {
  assert.ok(Number.isInteger(attempts) && attempts > 0);
  assert.ok(maxGapMs > 0 && hardGapMs >= maxGapMs, 'A finite hard ceiling must cover the tight bound');
  assert.ok(Number.isFinite(hardGapMs));
  const gaps = [], results = [];
  let ms;
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
      results.push(await work(input));
      // Include synchronous work at both ends, even when no interval fired.
      await new Promise(resolve => setTimeout(resolve, 5));
      gap = Math.max(gap, performance.now() - last);
      ms = performance.now() - start;
      gaps.push(gap);
      assert.ok(gap < hardGapMs, `${label} sample ${attempt + 1} gap ${gap.toFixed(1)} ms exceeded hard ceiling ${hardGapMs} ms`);
    } finally { clearInterval(timer); }
  }
  const gap = Math.min(...gaps);
  assert.ok(gap < maxGapMs, `${label} gaps [${gaps.map(gap => gap.toFixed(1)).join(', ')}] ms; best sample exceeded ${maxGapMs} ms`);
  return { results, gap, ms, gaps };
}
