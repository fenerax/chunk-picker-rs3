import { buildWhyChain } from './tasks/why-chain.mjs';
import { taskWhyDisplay, WRITER_WHY_BUDGET } from './tasks/task-why-display.mjs';
export { createSavedWhyEvidence, forgetSavedWhyChain } from './saved-why-evidence.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
const unavailable = message => Object.assign(failure(409, message), { code: 'TASK_WHY_UNAVAILABLE' });

export function validateWhyDisplay(query, { revision, members }) {
  const allowed = new Set(['view', 'memberId', 'revision', 'taskId']);
  if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)
    || query.get('view') !== 'display-v1' || !query.get('taskId') || query.get('taskId').length > 512) throw failure(400, 'Choose one task to explain.');
  if (!members.has(query.get('memberId'))) throw failure(400, 'Choose a known player.');
  if (query.get('revision') !== String(revision)) throw failure(409, 'The saved map changed. Open Why again.');
}

// Reuse the existing saved-evidence owner/parse when available. The derived
// display is request-local and adds no retained bytes to saved list responses.
export async function savedWhyDisplay(query, { revision, entry, currentRevision, evidence }) {
  if (entry?.revision !== revision || !entry.fullGzip) return undefined;
  const result = await evidence?.read(entry, revision, { rawLimit: 256 * 1024 });
  if (currentRevision() !== revision) throw failure(409, 'The saved map changed. Open Why again.');
  return taskWhyDisplay(result, query.get('taskId'), query.get('memberId'), revision, { limits: WRITER_WHY_BUDGET });
}

// Saved evidence only, including for viewers. Never wake a calculation worker.
export async function savedWhyChain(query, { revision, members, entry, definitions, currentRevision, evidence }) {
  const allowed = new Set(['memberId', 'revision', 'taskId', 'master', 'assignment']);
  if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)) throw failure(400, 'Choose one task to explain.');
  const memberId = query.get('memberId');
  if (!members.has(memberId)) throw failure(400, 'Choose a known player.');
  if (query.get('revision') !== String(revision)) throw failure(409, 'The saved map changed. Open Why not? again.');
  const taskId = query.get('taskId'), master = query.get('master'), assignment = query.get('assignment');
  if (taskId ? master !== null || assignment !== null : !master || !assignment) throw failure(400, 'Choose one task or assignment to explain.');
  if (entry?.revision !== revision || !entry.fullGzip) throw unavailable('Saved task details are still loading.');
  const result = await evidence?.read(entry, revision);
  if (currentRevision() !== revision) throw failure(409, 'The saved map changed. Open Why not? again.');
  if (!result || result.tasks?.length > 2048) throw unavailable('Saved evidence exceeds the explanation budget.');
  return { ...buildWhyChain(result, definitions, { taskId, master, assignment }), memberId, stateRevision: revision };
}
