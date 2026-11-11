import { createRequestReader, requestError, retryAfterMs } from '../../../app/web/live-swap-client.mjs';

// Reuse the browser's route cooldowns and bounded, read-only restart retries.
// The caller owns one instance per login, preserving cooldowns across actions.
export function createBrowserClient({ request, now, sleep, maxReadAttempts, maxReadRetryMs }) {
  const read = createRequestReader({ fetch: request, now, sleep, maxReadAttempts, maxReadRetryMs });
  return async (route, body, extra) => {
    const { response, value } = await read(route, { method: body === undefined ? 'GET' : 'POST', body, extra });
    if (!response.ok) throw requestError(response, value);
    return value;
  };
}

export const reconnectDelay = (attempt, rng) => Math.min(30000, 1000 * 2 ** Math.min(5, attempt)) + Math.floor(rng() * 500);

export async function reconnectStream({ connect, signal, sleep, rng, spreadMs = 0 }) {
  if (spreadMs) await sleep(Math.floor(rng() * spreadMs), signal);
  for (let attempt = 0; !signal.aborted; attempt++) {
    const result = await connect();
    if (signal.aborted) return;
    // A successful handshake restarts the browser's error backoff sequence.
    if (result?.opened) attempt = 0;
    await sleep(Math.max(reconnectDelay(attempt, rng), result?.retryAfterMs ?? 0), signal);
  }
}

export function pause(ms, signal) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
}

export { retryAfterMs };

// A sustained client keeps its scheduled arrival while retrying safe reads.
// Writes are single-dispatch: a lost acknowledgement is not proof of failure.
export async function retryRead(operation, {safe,deadlineMs,now=()=>performance.now(),sleep=pause,rng=Math.random} = {}) {
  const started = now();
  for (let attempt=0;;attempt++) {
    try {return await operation();}
    catch(error) {
      if(!safe||attempt>=5||error.status&&!([429,503].includes(error.status)))throw error;
      const waitMs=Math.max(error.retryAfterMs??0,Math.min(5000,250*2**attempt)+Math.floor(rng()*250));
      if(now()-started+waitMs>=deadlineMs)throw error;
      await sleep(waitMs);
    }
  }
}
