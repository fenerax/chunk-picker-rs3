import assert from 'node:assert/strict';

// Record attempted calls as well as throwing: a provider may catch the error.
export function blockUnmockedFetch(t, allowedOrigins = new Set()) {
  const original = globalThis.fetch, unexpected = [];
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (allowedOrigins.has(url.origin)) return original(input, options);
    unexpected.push(String(url));
    throw new Error(`Unmocked fetch: ${url}`);
  });
  t.after(() => assert.deepEqual(unexpected, [], 'Every external fetch must use a fake transport'));
}
