// Files stay as streams/Blobs: never parse or stringify a full save in the browser.
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_UPLOAD_BYTES = MAX_BACKUP_BYTES + 1024 * 1024;
export const BACKUP_UPLOAD_TYPE = 'application/vnd.rs3-backup-upload+json';
const encoder = new TextEncoder();

function bounded(stream, maximum, message) {
  let bytes = 0;
  return stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > maximum) throw new Error(message);
    controller.enqueue(chunk);
  } }));
}

export function createBackupUpload(file, metadata = {}, { onStage = () => {} } = {}) {
  if (!file) throw new Error('Choose a .json or .json.gz backup.');
  const compressed = /\.gz$/i.test(file.name ?? '');
  if (file.size > (compressed ? MAX_UPLOAD_BYTES : MAX_BACKUP_BYTES)) throw new Error('This backup is too large. The limit is 256 MiB after decompression.');
  let prepared;
  const prepare = async signal => {
    signal?.throwIfAborted();
    onStage('Preparing backup…');
    let input = file.stream();
    if (compressed) {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open gzip backups. Unzip the file and choose the .json backup.');
      input = input.pipeThrough(new DecompressionStream('gzip'));
    }
    input = bounded(input, MAX_BACKUP_BYTES, 'This backup is too large. The limit is 256 MiB after decompression.');
    if (signal) input = input.pipeThrough(new TransformStream(), { signal });
    const reader = input.getReader();
    let phase = 'prefix';
    const wrapped = new ReadableStream({ async pull(controller) {
      try {
        if (phase === 'prefix') { phase = 'file'; controller.enqueue(encoder.encode('{"file":')); return; }
        const { done, value } = await reader.read();
        if (!done) { controller.enqueue(value); return; }
        controller.enqueue(encoder.encode('}')); controller.close(); reader.releaseLock();
      } catch (error) { controller.error(error); await reader.cancel(error).catch(() => {}); reader.releaseLock(); }
    }, async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); } });
    const gzip = typeof CompressionStream === 'function';
    try {
      return { blob: await new Response(bounded(gzip ? wrapped.pipeThrough(new CompressionStream('gzip')) : wrapped,
        MAX_UPLOAD_BYTES, 'This compressed backup is too large to upload.')).blob(), gzip };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (/too large|cannot open gzip/.test(error.message)) throw error;
      throw new Error(compressed ? 'This gzip backup is corrupt or incomplete. Choose another backup.' : 'The backup could not be read. Choose it again.');
    }
  };
  return { ...metadata, async toBackupRequest({ signal } = {}) {
    signal?.throwIfAborted();
    prepared ??= prepare(signal);
    const { blob, gzip } = await prepared;
    signal?.throwIfAborted();
    // Metadata stays small and separate, so Apply reuses the compressed file.
    return { method: 'POST', headers: { 'Content-Type': BACKUP_UPLOAD_TYPE, ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
      'X-RS3-Import': JSON.stringify({ ...metadata, ...(this.expectedRevision !== undefined ? { expectedRevision: this.expectedRevision } : {}) }) }, body: blob };
  }, async sendBackupRequest(path, signal, fetchRequest = fetch) {
    const request = await this.toBackupRequest({ signal });
    onStage('Uploading…');
    const response = await uploadBackup(path, request, signal, () => onStage('Checking replacement…'), fetchRequest);
    let value;
    try { value = await response.json(); }
    catch { if (response.ok) throw new Error('The response was interrupted or unreadable. Try again.'); value = {}; }
    if (!value || typeof value !== 'object') { if (response.ok) throw new Error('The response was unreadable. Try again.'); value = {}; }
    return { response, value };
  } };
}

// XHR exposes the end of the upload separately from server-side validation.
async function uploadBackup(path, request, signal, uploaded, fetchRequest) {
  if (typeof XMLHttpRequest !== 'function') {
    const response = fetchRequest(path, { ...request, signal }); uploaded(); return response;
  }
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = action => { signal?.removeEventListener('abort', abort); action(); };
    xhr.open(request.method, path);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onload = uploaded;
    xhr.onload = () => finish(() => resolve(new Response(xhr.responseText, { status: xhr.status, headers: { 'Content-Type': 'application/json' } })));
    xhr.onerror = () => finish(() => reject(new Error('Could not reach the picker. Check your internet connection, then try again.')));
    xhr.onabort = () => finish(() => reject(signal?.reason ?? new DOMException('Request abandoned.', 'AbortError')));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(request.body);
  });
}

export async function downloadFullBackup(name) {
  const response = await fetch('/api/backup?download=gzip');
  if (!response.ok) { const value = await response.json(); throw new Error(value.message || 'The backup could not be downloaded.'); }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
