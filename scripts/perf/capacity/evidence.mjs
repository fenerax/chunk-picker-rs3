import { randomUUID } from 'node:crypto';
import { sustainedAction, sustainedPhase } from './sustained.mjs';

export const SERVER_ID_HEADER = 'x-capacity-server-id';
// Scratch-only observation: every response identifies its serving process,
// including old responses completing after a replacement has started.
export function observeServerIdentity(server, serverId = randomUUID()) {
  server.prependListener('request', (_request, response) => response.setHeader(SERVER_ID_HEADER, serverId));
  return serverId;
}
export const clientIdentity = client => `${client.group}:${client.memberId}`;
export function plannedOperations(events, profile) {
  const counts = new Map();
  for (const event of events) {
    const action = sustainedAction(event), phase = sustainedPhase(profile,event.atMs);
    const key = `${event.stage}:${phase}:${action}`;
    const row = counts.get(key) ?? {stage:event.stage,phase,action,count:0};
    row.count++; counts.set(key,row);
  }
  return [...counts.values()];
}
export const cleanExit = receipt => receipt?.forced === false && receipt.exitCode === 0 && receipt.signal === null;
export function readinessProof({state,tasks,stateServerId,tasksServerId,expectedServerId,memberId}) {
  if (!expectedServerId || stateServerId !== expectedServerId || tasksServerId !== expectedServerId)
    throw Object.assign(new Error('Readiness did not come from the expected server process.'),{status:'stale-generation'});
  if (!state.state?.members?.some(row=>row.id===memberId) || !Number.isSafeInteger(state.state.revision) || state.state.revision<0 ||
    !Number.isSafeInteger(tasks.stateRevision) || tasks.stateRevision<state.state.revision || !Array.isArray(tasks.tasks))
    throw Object.assign(new Error('Readiness response is incomplete or stale.'),{status:'stale-readiness'});
  return {serverId:expectedServerId,stateServerId,tasksServerId,stateRevision:state.state.revision,tasksRevision:tasks.stateRevision};
}
