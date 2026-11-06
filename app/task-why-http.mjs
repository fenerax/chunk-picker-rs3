import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { buildWhyChain } from './tasks/why-chain.mjs';
import { taskWhyDisplay } from './tasks/task-why-display.mjs';

const unzip = promisify(gunzip);
const failure = (status, message) => Object.assign(new Error(message), { status });
// One parse (including concurrent clicks) per retained saved entry. Weak keys
// release the graph on entry replacement/eviction; revision rebinding drops it.
const parsedResults = new WeakMap(), IDLE_MS = 120_000;
export function forgetSavedWhyChain(entry) { parsedResults.delete(entry); }
function parsedResult(entry, revision) {
  let cached = parsedResults.get(entry);
  if (!cached || cached.revision !== revision || cached.gzip !== entry.fullGzip) {
    cached = { revision, gzip: entry.fullGzip };
    cached.promise = unzip(entry.fullGzip, { maxOutputLength: 128 * 1024 * 1024 })
      .then(bytes => JSON.parse(bytes.toString('utf8'))).catch(error => {
        if (parsedResults.get(entry) === cached) parsedResults.delete(entry);
        throw error;
      });
    parsedResults.set(entry, cached);
  }
  // A parsed full result is large; keep it only while explanations are being opened.
  clearTimeout(cached.timer);
  cached.timer = setTimeout(() => { if (parsedResults.get(entry) === cached) parsedResults.delete(entry); }, IDLE_MS);
  cached.timer.unref?.();
  return cached.promise;
}

export function validateWhyDisplay(query, { revision, members }) {
  const allowed = new Set(['view', 'memberId', 'revision', 'taskId']);
  if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)
    || query.get('view') !== 'display-v1' || !query.get('taskId') || query.get('taskId').length > 512) throw failure(400, 'Choose one task to explain.');
  if (!members.has(query.get('memberId'))) throw failure(400, 'Choose a known player.');
  if (query.get('revision') !== String(revision)) throw failure(409, 'The saved map changed. Open Why again.');
}

// Reuse the existing saved-evidence owner/parse when available. The derived
// display is request-local and adds no retained bytes to saved list responses.
export async function savedWhyDisplay(query, { revision, entry, currentRevision }) {
  if (entry?.revision !== revision || !entry.fullGzip) return undefined;
  const result = await parsedResult(entry, revision);
  if (currentRevision() !== revision) throw failure(409, 'The saved map changed. Open Why again.');
  return taskWhyDisplay(result, query.get('taskId'), query.get('memberId'), revision);
}

// Saved evidence only, including for viewers. Never wake a calculation worker.
export async function savedWhyChain(query, { revision, members, entry, definitions, currentRevision }) {
  const allowed = new Set(['memberId', 'revision', 'taskId', 'master', 'assignment']);
  if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)) throw failure(400, 'Choose one task to explain.');
  const memberId = query.get('memberId');
  if (!members.has(memberId)) throw failure(400, 'Choose a known player.');
  if (query.get('revision') !== String(revision)) throw failure(409, 'The saved map changed. Open Why not? again.');
  const taskId = query.get('taskId'), master = query.get('master'), assignment = query.get('assignment');
  if (taskId ? master !== null || assignment !== null : !master || !assignment) throw failure(400, 'Choose one task or assignment to explain.');
  if (entry?.revision !== revision || !entry.fullGzip) throw failure(409, 'Saved task details are still loading. Retry after opening task details.');
  const result = await parsedResult(entry, revision);
  if (currentRevision() !== revision) throw failure(409, 'The saved map changed. Open Why not? again.');
  return { ...buildWhyChain(result, definitions, { taskId, master, assignment }), memberId, stateRevision: revision };
}
