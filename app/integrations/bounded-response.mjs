export const MAX_PROGRESS_RESPONSE_BYTES = 1024 * 1024;

/** Bound downloaded bytes before UTF-8 decoding, even without Content-Length. */
export async function readProgressResponse(response) {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_PROGRESS_RESPONSE_BYTES) {
    // Do not wait for an upstream cancellation acknowledgement to reject.
    void response.body?.cancel().catch(() => {});
    throw new Error('Response too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROGRESS_RESPONSE_BYTES) throw new Error('Response too large');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
