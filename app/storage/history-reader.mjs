import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

// Durable segments are an envelope followed by an ascending events array.
// Keep only the envelope prefix and one JSON event, never the inflated segment.
// String/escape/depth tracking also handles nested undo records and UTF-8 split
// across compressed chunks (the stream decoder retains incomplete characters).
export async function* readHistoryEvents(file) {
  const input = createReadStream(file), decoded = input.pipe(createGunzip());
  decoded.setEncoding('utf8');
  const forwardError = error => decoded.destroy(error);
  input.on('error', forwardError);
  let phase = 'header', header = '', parts = [], depth = 0, string = false, escaped = false;
  let first = true, afterComma = false;
  try {
    for await (const chunk of decoded) {
      let start = phase === 'event' ? 0 : -1;
      for (let index = 0; index < chunk.length; index++) {
        const character = chunk[index];
        if (phase === 'header') {
          header += character;
          if (header.length > 1024) throw new TypeError('Invalid history archive envelope.');
          if (character === '[') {
            if (!/^\s*\{\s*"format"\s*:\s*"rs3-chunk-picker-history"\s*,\s*"events"\s*:\s*\[$/.test(header)) throw new TypeError('Invalid history archive envelope.');
            phase = 'between';
          }
          continue;
        }
        if (phase === 'between') {
          if (/\s/.test(character)) continue;
          if (character === ']' && !afterComma) { phase = 'close'; continue; }
          if (character === ',' && !first && !afterComma) { afterComma = true; continue; }
          if (character !== '{' || (!first && !afterComma)) throw new TypeError('Invalid history archive events.');
          phase = 'event'; start = index; depth = 1; string = false; escaped = false;
          continue;
        }
        if (phase === 'close') {
          if (/\s/.test(character)) continue;
          if (character !== '}') throw new TypeError('Invalid history archive envelope.');
          phase = 'done'; continue;
        }
        if (phase === 'done') {
          if (!/\s/.test(character)) throw new TypeError('Invalid history archive trailing data.');
          continue;
        }
        if (string) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') string = false;
        } else if (character === '"') string = true;
        else if (character === '{' || character === '[') depth++;
        else if (character === '}' || character === ']') depth--;
        if (depth === 0) {
          parts.push(chunk.slice(start, index + 1));
          const event = JSON.parse(parts.join(''));
          if (!Number.isSafeInteger(event.revision) || event.revision < 0 || typeof event.type !== 'string') throw new TypeError('Invalid history archive event.');
          parts = []; start = -1; phase = 'between'; first = false; afterComma = false;
          yield event;
        }
      }
      if (phase === 'event') parts.push(chunk.slice(start));
    }
    if (phase !== 'done') throw new TypeError('Incomplete history archive.');
  } finally {
    input.off('error', forwardError);
    input.destroy(); decoded.destroy();
  }
}
