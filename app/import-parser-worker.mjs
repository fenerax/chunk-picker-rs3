// Keep upload parsing independent of dataset/catalogue initialization.
import { parentPort, workerData } from 'node:worker_threads';
import { serialize } from 'node:v8';
import { Readable } from 'node:stream';
import { readBackupRequest } from './backup-transfer.mjs';
import { transferDigest } from './save-transfer.mjs';
import { displayText } from './import-output.mjs';
import { encodeImportBytes, decodeImportBytes } from './import-bytes.mjs';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
async function run(job) {
  const request = Object.assign(job.chunks ? Readable.from(job.chunks.map(chunk => Buffer.from(chunk))) : new Readable({ read() {} }), { headers: job.headers, complete: Boolean(job.chunks) });
  if (!job.chunks) parentPort.on('message', message => {
    if (message.end) { request.complete = true; request.push(null); }
    else request.push(Buffer.from(message.chunk));
  });
  const imported = await readBackupRequest(request, job.options);
  if (!job.defer) return imported;
  const body = imported.body, selectors = new Set();
  const pending = [body];
  while (pending.length) {
    const item = pending.pop();
    for (const [key, value] of Object.entries(item)) {
      if (key === 'picker' || key === 'pickerId') {
        if (typeof value !== 'string' || value.length > 128) fail(403, 'Picker access denied.');
        selectors.add(value);
        if (selectors.size > 1) fail(403, 'Picker access denied.');
      } else if (value && typeof value === 'object') pending.push(value);
    }
  }
  for (const key of ['memberId', 'sourceMemberId', 'previewToken']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 128)) fail(400, 'Invalid backup import options.');
  if (body.expectedRevision !== undefined && !Number.isSafeInteger(body.expectedRevision)) fail(400, 'Invalid expected revision.');
  const transferHash = transferDigest({ backup: body.backup, backupId: body.backupId, document: body.document,
    members: body.members, memberId: body.memberId, sourceMemberId: body.sourceMemberId, rosterMapping: body.rosterMapping });
  return { uploaded: imported.uploaded, input: serialize(body),
    body: { expectedRevision: body.expectedRevision, memberId: body.memberId, previewToken: body.previewToken, transferHash,
      selectors: [...selectors].map(pickerId => ({ pickerId })) } };
}
async function send(value) {
  const bytes = await encodeImportBytes(value);
  parentPort.postMessage(bytes, bytes.buffers);
}
try { await send({ result: await run(await decodeImportBytes(workerData)) }); }
catch (error) { await send({ error: { message: displayText(error.message), status: error.status } }); }
