// Internal LZ4 block encoding. Pure JS avoids native zlib handles: terminating
// a calculator between handle creation and initialization can abort its host.
// The five-byte header holds a raw/compressed flag and the exact native length.
export function releaseSnapshotScratch(bytes) {
  if (bytes.byteLength >= 65536 && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    try { bytes.buffer.transfer(0); } catch { /* Ordinary GC owns unsupported buffers. */ }
}
export function encodeSnapshotBytes(raw) {
  const len = raw.length;
  const maxOutput = len + Math.ceil(len / 255) + 16;
  let cap = Math.min(maxOutput, Math.max(65536, (len >>> 2) + 65536));
  let output = Buffer.allocUnsafeSlow(cap);
  const positions = new Int32Array(65536).fill(-1);
  let cursor = 0, anchor = 0, written = 0, miss = 64;
  const limit = len - 12, matchLimit = len - 5;
  // Keep length emission inline with local integer state rather than a closure
  // over `written` (avoids context-slot traffic and Maglev miscompilation).
  while (cursor < limit) {
    const b0 = raw[cursor], b1 = raw[cursor + 1], b2 = raw[cursor + 2], b3 = raw[cursor + 3];
    const word = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    const hash = Math.imul(word, 0x9e3779b1) >>> 16;
    const previous = positions[hash]; positions[hash] = cursor;
    if (previous < 0 || cursor - previous > 65535
      || raw[previous] !== b0 || raw[previous + 1] !== b1 || raw[previous + 2] !== b2 || raw[previous + 3] !== b3) {
      cursor += miss++ >>> 6; continue;
    }
    miss = 64;
    let end = cursor + 4, source = previous + 4;
    while (end + 4 <= matchLimit
      && raw[end] === raw[source] && raw[end + 1] === raw[source + 1]
      && raw[end + 2] === raw[source + 2] && raw[end + 3] === raw[source + 3]) { end += 4; source += 4; }
    while (end < matchLimit && raw[end] === raw[source]) { end++; source++; }
    const literals = cursor - anchor, match = end - cursor - 4;
    const need = literals + (literals >>> 8) + (match >>> 8) + 8;
    if (written + need > cap) {
      const nextCap = Math.min(maxOutput, Math.max(cap * 2, written + need + 65536));
      const next = Buffer.allocUnsafeSlow(nextCap);
      output.copy(next, 0, 0, written);
      releaseSnapshotScratch(output);
      output = next; cap = nextCap;
    }
    output[written++] = ((literals < 15 ? literals : 15) << 4) | (match < 15 ? match : 15);
    if (literals >= 15) {
      let extra = literals - 15;
      while (extra >= 255) { output[written++] = 255; extra -= 255; }
      output[written++] = extra;
    }
    if (literals <= 16) {
      for (let i = 0; i < literals; i++) output[written++] = raw[anchor + i];
    } else {
      raw.copy(output, written, anchor, cursor); written += literals;
    }
    const diff = cursor - previous;
    output[written++] = diff & 255;
    output[written++] = diff >>> 8;
    if (match >= 15) {
      let extra = match - 15;
      while (extra >= 255) { output[written++] = 255; extra -= 255; }
      output[written++] = extra;
    }
    cursor = end; anchor = end;
  }
  const literals = len - anchor;
  const tailNeed = literals + (literals >>> 8) + 4;
  if (written + tailNeed > cap) {
    const nextCap = Math.min(maxOutput, Math.max(cap * 2, written + tailNeed));
    const next = Buffer.allocUnsafeSlow(nextCap);
    output.copy(next, 0, 0, written);
    releaseSnapshotScratch(output);
    output = next; cap = nextCap;
  }
  output[written++] = (literals < 15 ? literals : 15) << 4;
  if (literals >= 15) {
    let extra = literals - 15;
    while (extra >= 255) { output[written++] = 255; extra -= 255; }
    output[written++] = extra;
  }
  raw.copy(output, written, anchor); written += literals;
  const compressed = written < len, bytes = Buffer.allocUnsafeSlow(5 + (compressed ? written : len));
  bytes[0] = +compressed; bytes.writeUInt32LE(len, 1);
  (compressed ? output : raw).copy(bytes, 5, 0, compressed ? written : len);
  releaseSnapshotScratch(output); releaseSnapshotScratch(raw);
  return bytes;
}

export function decodeSnapshotBytes(bytes) {
  const len = bytes.length;
  if (len < 5 || bytes[0] > 1) throw new TypeError('Invalid snapshot wire header.');
  const size = bytes.readUInt32LE(1);
  if (!bytes[0]) {
    if (size !== len - 5) throw new TypeError('Invalid raw snapshot length.');
    return bytes.subarray(5);
  }
  const output = Buffer.allocUnsafeSlow(size);
  let cursor = 5, written = 0;
  try {
    while (cursor < len) {
      const token = bytes[cursor++];
      let literals = token >>> 4;
      if (literals === 15) {
        let part;
        do {
          if (cursor === len) throw new TypeError('Truncated snapshot length.');
          part = bytes[cursor++]; literals += part;
        } while (part === 255);
      }
      if (cursor + literals > len || written + literals > size) throw new TypeError('Invalid snapshot literals.');
      if (literals <= 16) {
        for (let i = 0; i < literals; i++) output[written++] = bytes[cursor++];
      } else {
        bytes.copy(output, written, cursor, cursor + literals); cursor += literals; written += literals;
      }
      if (cursor === len) break;
      if (cursor + 2 > len) throw new TypeError('Truncated snapshot offset.');
      const offset = bytes[cursor] | (bytes[cursor + 1] << 8); cursor += 2;
      let match = token & 15;
      if (match === 15) {
        let part;
        do {
          if (cursor === len) throw new TypeError('Truncated snapshot length.');
          part = bytes[cursor++]; match += part;
        } while (part === 255);
      }
      match += 4;
      if (!offset || offset > written || written + match > size) throw new TypeError('Invalid snapshot match.');
      let source = written - offset, end = written + match;
      // Forward copying deliberately supports overlapping LZ4 matches.
      while (written < end) output[written++] = output[source++];
    }
    if (written !== size) throw new TypeError('Incomplete snapshot block.');
    return output;
  } catch (error) { releaseSnapshotScratch(output); throw error; }
}
