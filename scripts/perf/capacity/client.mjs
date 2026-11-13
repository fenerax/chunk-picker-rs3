import { createRequestReader, requestError, retryAfterMs } from '../../../app/web/live-swap-client.mjs';
import { failureOutcome } from './failures.mjs';

// Reuse the browser's route cooldowns and bounded, read-only restart retries.
// The caller owns one instance per login, preserving cooldowns across actions.
export function createBrowserClient({ request, now, sleep, maxReadAttempts, maxReadRetryMs }) {
  const cooldowns = new Map();
  const read = createRequestReader({ fetch: async (route, options) => {
    options.trace.dispatched = true;
    const response = await request(route, options);
    if ([429, 503].includes(response.status) && retryAfterMs(response, now?.() ?? Date.now()) > 0)
      cooldowns.set(route.split('?')[0], { inheritedCooldownId: `cooldown:${response.requestId}`, inheritedRequestId: response.requestId });
    return response;
  }, now, sleep, maxReadAttempts, maxReadRetryMs });
  return async (route, body, extra) => {
    const trace = {};
    try {
      const { response, value } = await read(route, { method: body === undefined ? 'GET' : 'POST', body, extra, trace });
      if (!response.ok) throw Object.assign(requestError(response, value), { requestId: response.requestId });
      return value;
    } catch (error) {
      if (!trace.dispatched && [429, 503].includes(error.status))
        throw Object.assign(new Error(error.message, { cause: error }), { status: error.status, retryAfterMs: error.retryAfterMs, ...cooldowns.get(route.split('?')[0]) });
      throw error;
    }
  };
}

export function createSessionChecks() {
  const pending = new Map(); let sequence = 0;
  return async (identity, client, read) => {
    let check = pending.get(identity); const coalesced = !!check;
    if (!check) {
      check = { id: `preflight:${++sequence}`, ownerActionId: client.actionId };
      check.promise = read().finally(() => pending.delete(identity));
      pending.set(identity, check);
    }
    (client.sharedPreflights ??= []).push({ id: check.id, ownerActionId: check.ownerActionId, coalesced });
    try {
      const value = await check.promise;
      return { value, coalesced };
    } catch (error) {
      const inherited = failureOutcome(error);
      // Retry eligibility uses HTTP status only; diagnostic labels are recovered
      // from the cause chain when recording the terminal failure.
      throw Object.assign(new Error(error.message, { cause: error }), {
        ...(typeof inherited.status === 'number' ? { status: inherited.status } : {}),
        retryAfterMs: error.retryAfterMs, inheritedPreflightId: check.id, inheritedRequestId: inherited.inheritedRequestId ?? inherited.requestId });
    }
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
