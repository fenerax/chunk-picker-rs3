// Streaming JSON syntax check for pack inputs. It accepts exactly the byte
// sequences that JSON.parse(buffer.toString('utf8')) accepts, without building
// a string or a value tree. UTF-8 decoding never turns a byte >= 0x80 into an
// ASCII character, so non-ASCII bytes are ordinary string content and are
// invalid everywhere else (as their decoded characters are to JSON.parse).
// Checked in tests/dataset-json-check.test.mjs against JSON.parse itself.

const VALUE = 0, AFTER_VALUE = 1, KEY_OR_END = 2, KEY = 3, COLON = 4, VALUE_OR_END = 5,
  STRING = 6, ESCAPE = 7, UNICODE = 8, NUMBER = 9, LITERAL = 10, DONE = 11;
// Number sub-states.
const N_SIGN = 0, N_ZERO = 1, N_INT = 2, N_DOT = 3, N_FRACTION = 4, N_EXP = 5, N_EXP_SIGN = 6, N_EXP_DIGITS = 7;
const ARRAY = 1, OBJECT = 2;
const literals = [Buffer.from('true'), Buffer.from('false'), Buffer.from('null')];
const digit = byte => byte >= 0x30 && byte <= 0x39;
const hex = byte => digit(byte) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66);
const invalid = () => { throw new SyntaxError('Invalid JSON.'); };
const numberEnds = number => number === N_ZERO || number === N_INT || number === N_FRACTION || number === N_EXP_DIGITS;
function push(stack, depth, kind) {
  if (depth === stack.length) { const grown = new Uint8Array(stack.length * 2); grown.set(stack); stack = grown; }
  stack[depth] = kind;
  return stack;
}

export function createJsonSyntaxCheck() {
  let state = VALUE, stack = new Uint8Array(64), depth = 0, stringIsKey = false;
  let numberState = 0, literal = null, literalIndex = 0, unicodeLeft = 0, finished = false;
  function feed(bytes) {
    if (finished) invalid();
    // Hot loop state lives in locals; it is written back once per chunk.
    let current = state, level = depth, key = stringIsKey, number = numberState, word = literal, letter = literalIndex, hexLeft = unicodeLeft;
    const length = bytes.length;
    for (let index = 0; index < length; index++) {
      let byte = bytes[index];
      if (current === STRING) {
        // Ordinary string content: anything but a quote, backslash or control byte.
        while (byte !== 0x22 && byte !== 0x5c && byte >= 0x20) { if (++index === length) break; byte = bytes[index]; }
        if (index === length) break;
        if (byte === 0x22) current = key ? COLON : level ? AFTER_VALUE : DONE;
        else if (byte === 0x5c) current = ESCAPE;
        else invalid();
        continue;
      }
      // Insignificant whitespace between tokens.
      if ((byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) && current !== NUMBER && current !== LITERAL
        && current !== ESCAPE && current !== UNICODE) continue;
      switch (current) {
        case ESCAPE:
          if (byte === 0x75) { current = UNICODE; hexLeft = 4; }
          else if (byte === 0x22 || byte === 0x5c || byte === 0x2f || byte === 0x62 || byte === 0x66
            || byte === 0x6e || byte === 0x72 || byte === 0x74) current = STRING;
          else invalid();
          break;
        case UNICODE:
          if (!hex(byte)) invalid();
          if (--hexLeft === 0) current = STRING;
          break;
        case NUMBER:
          if (digit(byte)) {
            if (number === N_SIGN) number = byte === 0x30 ? N_ZERO : N_INT;
            else if (number === N_ZERO) invalid();
            else if (number === N_DOT) number = N_FRACTION;
            else if (number === N_EXP || number === N_EXP_SIGN) number = N_EXP_DIGITS;
            break;
          }
          if (byte === 0x2e && (number === N_ZERO || number === N_INT)) { number = N_DOT; break; }
          if ((byte === 0x65 || byte === 0x45) && (number === N_ZERO || number === N_INT || number === N_FRACTION)) { number = N_EXP; break; }
          if ((byte === 0x2b || byte === 0x2d) && number === N_EXP) { number = N_EXP_SIGN; break; }
          if (!numberEnds(number)) invalid();
          current = level ? AFTER_VALUE : DONE; index--; // Re-read the delimiter in the following state.
          break;
        case LITERAL:
          if (byte !== word[letter++]) invalid();
          if (letter === word.length) current = level ? AFTER_VALUE : DONE;
          break;
        case VALUE: case VALUE_OR_END:
          if (byte === 0x22) { current = STRING; key = false; }
          else if (byte === 0x7b) { stack = push(stack, level++, OBJECT); current = KEY_OR_END; }
          else if (byte === 0x5b) { stack = push(stack, level++, ARRAY); current = VALUE_OR_END; }
          else if (byte === 0x2d || digit(byte)) { current = NUMBER; number = byte === 0x2d ? N_SIGN : byte === 0x30 ? N_ZERO : N_INT; }
          else if (byte === 0x74 || byte === 0x66 || byte === 0x6e) { word = literals[byte === 0x74 ? 0 : byte === 0x66 ? 1 : 2]; letter = 1; current = LITERAL; }
          else if (byte === 0x5d && current === VALUE_OR_END) { level--; current = level ? AFTER_VALUE : DONE; }
          else invalid();
          break;
        case AFTER_VALUE:
          if (byte === 0x2c) current = stack[level - 1] === OBJECT ? KEY : VALUE;
          else if (byte === (stack[level - 1] === OBJECT ? 0x7d : 0x5d)) { level--; current = level ? AFTER_VALUE : DONE; }
          else invalid();
          break;
        case KEY_OR_END: case KEY:
          if (byte === 0x22) { current = STRING; key = true; }
          else if (byte === 0x7d && current === KEY_OR_END) { level--; current = level ? AFTER_VALUE : DONE; }
          else invalid();
          break;
        case COLON:
          if (byte !== 0x3a) invalid();
          current = VALUE;
          break;
        default: invalid(); // DONE: only whitespace may follow the value.
      }
    }
    state = current; depth = level; stringIsKey = key; numberState = number; literal = word; literalIndex = letter; unicodeLeft = hexLeft;
  }
  function end() {
    if (finished) invalid();
    finished = true;
    if (state === NUMBER && depth === 0 && numberEnds(numberState)) return;
    if (state !== DONE) invalid();
  }
  return { feed, end };
}

/** Throws SyntaxError exactly when JSON.parse(bytes.toString('utf8')) would. */
export function checkJsonSyntax(bytes) {
  const check = createJsonSyntaxCheck();
  check.feed(bytes); check.end();
}
