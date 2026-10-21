// Read-only JSON bytes held once per process. The Buffer view answers HTTP
// requests while its SharedArrayBuffer reaches native task workers uncopied.
export function sharedJSONBytes(value) {
  const text = JSON.stringify(value);
  const bytes = Buffer.from(new SharedArrayBuffer(Buffer.byteLength(text)));
  bytes.write(text);
  return bytes;
}

// The backing store of a whole-buffer shared view, or a shared copy.
export function sharedBuffer(bytes) {
  if (bytes.buffer instanceof SharedArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  const shared = new SharedArrayBuffer(bytes.byteLength);
  new Uint8Array(shared).set(bytes);
  return shared;
}
