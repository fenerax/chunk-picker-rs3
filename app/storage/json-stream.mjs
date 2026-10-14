const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const whitespace = character => character === ' ' || character === '\t' || character === '\r' || character === '\n';
const punctuation = character => '{}[]:,"'.includes(character);

function invalid(message) {
  const error = new SyntaxError(`Invalid JSON: ${message}`);
  error.status = 400;
  return error;
}

function tooLarge(message) {
  const error = new Error(message);
  error.status = 413;
  return error;
}

function limitLabel(bytes) {
  return bytes > 0 && bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MiB` : `${bytes} bytes`;
}

/**
 * Parse an iterable of UTF-8 byte chunks without buffering the document text.
 * The returned value has JSON.parse semantics; callers validate its schema.
 * Only the current primitive token and current chunk retain source text.
 * onProgress receives { bytesRead } after each consumed chunk and may be async.
 */
export async function parseJSONStream(chunks, {
  maxBytes = DEFAULT_MAX_BYTES,
  maxDepth = 128,
  maxTokenBytes = maxBytes,
  onProgress,
} = {}) {
  for (const [name, value] of Object.entries({ maxBytes, maxDepth, maxTokenBytes })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');

  // Preserve a leading BOM so it is rejected, as it is by JSON.parse.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const stack = [];
  let result, rootSeen = false, bytesRead = 0, token = null;

  function value(value) {
    const frame = stack.at(-1);
    if (!frame) {
      if (rootSeen) throw invalid('unexpected value after the root value');
      result = value;
      rootSeen = true;
      return;
    }
    if (frame.kind === 'array' && (frame.state === 'valueOrEnd' || frame.state === 'value')) {
      frame.value.push(value);
    } else if (frame.kind === 'object' && frame.state === 'value') {
      // JSON creates own properties without invoking inherited setters,
      // including the legacy __proto__ setter.
      Object.defineProperty(frame.value, frame.key, { value, enumerable: true, configurable: true, writable: true });
      frame.key = null;
    } else {
      throw invalid('unexpected value');
    }
    frame.state = 'commaOrEnd';
  }

  function appendToken(fragment) {
    if (!fragment) return;
    token.bytes += Buffer.byteLength(fragment, 'utf8');
    if (token.bytes > maxTokenBytes) throw tooLarge(`JSON token exceeds the ${limitLabel(maxTokenBytes)} token size limit.`);
    token.pending.push(fragment);
    // Batch tiny input fragments without repeatedly copying an ever-growing token.
    if (token.pending.length === 128) {
      token.parts.push(token.pending.join(''));
      token.pending = [];
    }
  }

  function finishToken() {
    const current = token;
    if (current.pending.length) current.parts.push(current.pending.join(''));
    token = null;
    let parsed;
    try {
      parsed = JSON.parse(current.parts.join(''));
    } catch {
      throw invalid(`malformed ${current.kind === 'string' ? 'string' : 'primitive'} token`);
    }
    const frame = stack.at(-1);
    if (current.kind === 'string' && frame?.kind === 'object' && (frame.state === 'keyOrEnd' || frame.state === 'key')) {
      frame.key = parsed;
      frame.state = 'colon';
    } else {
      value(parsed);
    }
  }

  function structural(character) {
    const frame = stack.at(-1);
    if (character === '{' || character === '[') {
      if (stack.length >= maxDepth) throw invalid(`nesting exceeds the ${maxDepth} level limit`);
      const container = character === '{' ? {} : [];
      value(container);
      stack.push({ kind: character === '{' ? 'object' : 'array', value: container, state: character === '{' ? 'keyOrEnd' : 'valueOrEnd', key: null });
    } else if (character === '}' || character === ']') {
      const kind = character === '}' ? 'object' : 'array';
      const emptyState = kind === 'object' ? 'keyOrEnd' : 'valueOrEnd';
      if (frame?.kind !== kind || (frame.state !== emptyState && frame.state !== 'commaOrEnd')) throw invalid('unexpected closing delimiter');
      stack.pop();
    } else if (character === ':') {
      if (frame?.kind !== 'object' || frame.state !== 'colon') throw invalid('unexpected colon');
      frame.state = 'value';
    } else if (character === ',') {
      if (!frame || frame.state !== 'commaOrEnd') throw invalid('unexpected comma');
      frame.state = frame.kind === 'object' ? 'key' : 'value';
    }
  }

  function consume(text) {
    let index = 0;
    while (index < text.length) {
      if (token?.kind === 'string') {
        const start = index;
        let closed = false;
        while (index < text.length) {
          const character = text[index++];
          if (token.escaped) token.escaped = false;
          else if (character === '\\') token.escaped = true;
          else if (character === '"') { closed = true; break; }
        }
        appendToken(text.slice(start, index));
        if (closed) finishToken();
      } else if (token) {
        const start = index;
        while (index < text.length && !whitespace(text[index]) && !punctuation(text[index])) index++;
        appendToken(text.slice(start, index));
        if (index < text.length) finishToken();
      } else {
        const character = text[index];
        if (whitespace(character)) index++;
        else if (character === '"') {
          token = { kind: 'string', escaped: false, parts: [], pending: [], bytes: 0 };
          appendToken('"');
          index++;
        } else if (punctuation(character)) {
          structural(character);
          index++;
        } else {
          token = { kind: 'primitive', parts: [], pending: [], bytes: 0 };
        }
      }
    }
  }

  function decode(bytes, options) {
    try {
      return decoder.decode(bytes, options);
    } catch {
      throw invalid('input is not valid UTF-8');
    }
  }

  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) throw new TypeError('JSON stream chunks must be Uint8Array byte chunks');
    bytesRead += chunk.byteLength;
    if (bytesRead > maxBytes) throw tooLarge(`JSON input exceeds the ${limitLabel(maxBytes)} size limit.`);
    consume(decode(chunk, { stream: true }));
    await onProgress?.({ bytesRead });
  }
  consume(decode());
  if (token?.kind === 'string') throw invalid('unterminated string');
  if (token) finishToken();
  if (!rootSeen || stack.length) throw invalid('incomplete document');
  return result;
}
