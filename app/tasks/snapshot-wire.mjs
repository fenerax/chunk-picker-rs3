// Internal LZ4 block encoding. Pure JS avoids native zlib handles: terminating
// a calculator between handle creation and initialization can abort its host.
// The five-byte header holds a raw/compressed flag and the exact native length.
export function releaseSnapshotScratch(bytes) {
  if (bytes.byteLength >= 65536 && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    try { bytes.buffer.transfer(0); } catch { /* Ordinary GC owns unsupported buffers. */ }
}
export function encodeSnapshotBytes(raw) {
  const output = Buffer.allocUnsafeSlow(raw.length + Math.ceil(raw.length / 255) + 16);
  const positions = new Int32Array(65536).fill(-1);
  let cursor = 0, anchor = 0, written = 0;
  const length = value => {
    while (value >= 255) { output[written++] = 255; value -= 255; }
    output[written++] = value;
  };
  while (cursor + 12 < raw.length) {
    const word = raw.readUInt32LE(cursor), hash = Math.imul(word, 0x9e3779b1) >>> 16;
    const previous = positions[hash]; positions[hash] = cursor;
    if (previous < 0 || cursor - previous > 65535 || raw.readUInt32LE(previous) !== word) { cursor++; continue; }
    let end = cursor + 4, source = previous + 4;
    while (end < raw.length - 5 && raw[end] === raw[source]) { end++; source++; }
    const literals = cursor - anchor, match = end - cursor - 4;
    output[written++] = (Math.min(literals, 15) << 4) | Math.min(match, 15);
    if (literals >= 15) length(literals - 15);
    raw.copy(output, written, anchor, cursor); written += literals;
    output.writeUInt16LE(cursor - previous, written); written += 2;
    if (match >= 15) length(match - 15);
    cursor = end; anchor = end;
  }
  const literals = raw.length - anchor;
  output[written++] = Math.min(literals, 15) << 4;
  if (literals >= 15) length(literals - 15);
  raw.copy(output, written, anchor); written += literals;
  const compressed = written < raw.length, bytes = Buffer.allocUnsafeSlow(5 + (compressed ? written : raw.length));
  bytes[0] = +compressed; bytes.writeUInt32LE(raw.length, 1);
  (compressed ? output : raw).copy(bytes, 5, 0, compressed ? written : raw.length);
  releaseSnapshotScratch(output); releaseSnapshotScratch(raw);
  return bytes;
}

export function decodeSnapshotBytes(bytes) {
  if (bytes.length < 5 || bytes[0] > 1) throw new TypeError('Invalid snapshot wire header.');
  const size = bytes.readUInt32LE(1);
  if (!bytes[0]) {
    if (size !== bytes.length - 5) throw new TypeError('Invalid raw snapshot length.');
    return bytes.subarray(5);
  }
  const output = Buffer.allocUnsafeSlow(size);
  let cursor = 5, written = 0;
  const length = initial => {
    let value = initial;
    if (initial === 15) {
      let part;
      do {
        if (cursor === bytes.length) throw new TypeError('Truncated snapshot length.');
        part = bytes[cursor++]; value += part;
      } while (part === 255);
    }
    return value;
  };
  try {
    while (cursor < bytes.length) {
      const token = bytes[cursor++], literals = length(token >>> 4);
      if (cursor + literals > bytes.length || written + literals > size) throw new TypeError('Invalid snapshot literals.');
      bytes.copy(output, written, cursor, cursor + literals); cursor += literals; written += literals;
      if (cursor === bytes.length) break;
      if (cursor + 2 > bytes.length) throw new TypeError('Truncated snapshot offset.');
      const offset = bytes.readUInt16LE(cursor); cursor += 2;
      const match = length(token & 15) + 4;
      if (!offset || offset > written || written + match > size) throw new TypeError('Invalid snapshot match.');
      let source = written - offset, end = written + match;
      // Forward copying deliberately supports overlapping LZ4 matches.
      while (written < end) output[written++] = output[source++];
    }
    if (written !== size) throw new TypeError('Incomplete snapshot block.');
    return output;
  } catch (error) { releaseSnapshotScratch(output); throw error; }
}
