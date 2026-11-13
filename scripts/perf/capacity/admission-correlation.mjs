import { AsyncLocalStorage } from 'node:async_hooks';

export const REQUEST_ID_HEADER = 'x-capacity-request-id';
export const ADMISSION_ID_HEADER = 'x-capacity-admission-id';
export function observeAdmissionCorrelation(server, correlation) {
  const handlers = server.listeners('request');
  if (handlers.length !== 1) throw new Error('Scratch admission correlation requires one application handler.');
  const handler = handlers[0].bind(server);
  server.removeListener('request', handlers[0]);
  server.on('request', (request, response) => correlation.handle(request, response, handler));
}
export function createAdmissionCorrelation() {
  const requests = new AsyncLocalStorage(), admissions = new Map();
  return {
    handle(request, response, handler) {
      const raw = request.headers[REQUEST_ID_HEADER];
      return requests.run({ requestId: typeof raw === 'string' && /^action:\d+:request:\d+$/.test(raw) ? raw : null, response },
        () => handler(request, response));
    },
    observe(event) {
      const current = requests.getStore(), known = admissions.has(event.admissionId);
      const item = admissions.get(event.admissionId);
      const requestId = known ? item.requestId : current?.requestId ?? null;
      if (!known && event.transition === 'queued') {
        admissions.set(event.admissionId, { requestId, started: false });
      }
      if (!known && current?.response && !current.response.headersSent)
        current.response.setHeader(ADMISSION_ID_HEADER, String(event.admissionId));
      if (event.transition === 'started' && item) item.started = true;
      if (event.transition === 'released' || ['rejected', 'deadline'].includes(event.transition) && !item?.started) admissions.delete(event.admissionId);
      return { ...event, requestId };
    },
  };
}
