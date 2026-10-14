import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJSONStream } from '../app/storage/json-stream.mjs';

async function* chunks(input, size = 7) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : input;
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}

test('matches native JSON values at arbitrary byte boundaries', async () => {
  const document = '{"empty":{},"array":[null,true,false,0,-0,-0.5,1e+23,1E-3,1e400],"text":"é🍁\\n\\t\\b\\f\\r\\\\\\\"\\/\\uD800\\udc00","escaped":"\\\\\\\"end","dup":1,"dup":2}';
  const expected = JSON.parse(document);
  for (const size of [1, 2, 3, 7, 31, document.length]) {
    assert.deepEqual(await parseJSONStream(chunks(document, size)), expected);
  }
  for (const document of ['null', 'true', 'false', '0', '-0', '123.4e-3', '"root"', '[]', '{}', ' \n\t\r{"x":1} \n']) {
    assert.deepEqual(await parseJSONStream(chunks(document, 1)), JSON.parse(document));
  }
});

test('preserves prototype-named own properties and duplicate keys', async () => {
  const document = '{"__proto__":{"polluted":true},"constructor":1,"toString":2,"__proto__":{"last":true}}';
  const parsed = await parseJSONStream(chunks(document, 1));
  assert.deepEqual(parsed, JSON.parse(document));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal({}.polluted, undefined);
});

test('rejects malformed, truncated and trailing JSON', async () => {
  const malformed = ['', ' ', '{', '[', '"a', '"a\\', '"\\u123"', '"\\x00"', '"a\nb"', 'nul', 'True', 'NaN', 'Infinity', '+1', '01', '-01', '1.', '.1', '1e', '1e+', '--1', '{}[]', 'true false', '{}null', '[1,]', '{"a":1,}', '{a:1}', '{1:2}', '{"a" 1}', '{"a":}', '[1 2]', '{"a":1 "b":2}', ']', '}', ':', ',', '\uFEFF{}', '{"a":1}}', '/* comment */{}'];
  for (const document of malformed) {
    await assert.rejects(parseJSONStream(chunks(document, 1)), error => error instanceof SyntaxError && error.status === 400, document);
  }
});

test('rejects invalid and incomplete UTF-8 without replacing bytes', async () => {
  for (const bytes of [[34, 0xff, 34], [34, 0xc0, 0xaf, 34], [34, 0xed, 0xa0, 0x80, 34], [34, 0xf4, 0x90, 0x80, 0x80, 34], [34, 0xe2, 0x82]]) {
    await assert.rejects(parseJSONStream(chunks(Buffer.from(bytes), 1)), /not valid UTF-8/);
  }
});

test('bounds document bytes, primitive token bytes and container depth', async () => {
  assert.deepEqual(await parseJSONStream(chunks('{"é":1}', 1), { maxBytes: 8 }), { é: 1 });
  await assert.rejects(parseJSONStream(chunks('{"é":1}', 1), { maxBytes: 7 }), error => error.status === 413 && /7 bytes size limit/.test(error.message));
  await assert.rejects(parseJSONStream(chunks('"éé"', 1), { maxTokenBytes: 5 }), error => error.status === 413 && /token size limit/.test(error.message));
  assert.equal(await parseJSONStream(chunks('"éé"', 1), { maxTokenBytes: 6 }), 'éé');
  assert.deepEqual(await parseJSONStream(chunks('[[{}]]'), { maxDepth: 3 }), [[{}]]);
  await assert.rejects(parseJSONStream(chunks('[[{}]]'), { maxDepth: 2 }), /nesting exceeds the 2 level limit/);
  assert.equal(await parseJSONStream(chunks('null'), { maxDepth: 0 }), null);
  await assert.rejects(parseJSONStream(chunks('{}'), { maxDepth: 0 }), /nesting/);
});

test('retains long tokens correctly across batches of tiny chunks', async () => {
  const text = 'é🍁\\"\n'.repeat(3000);
  assert.equal(await parseJSONStream(chunks(JSON.stringify(text), 1)), text);
});

test('reports byte progress and propagates input or callback failure', async () => {
  const progress = [];
  assert.deepEqual(await parseJSONStream(chunks('{"x":1}', 3), { onProgress: async value => progress.push(value.bytesRead) }), { x: 1 });
  assert.deepEqual(progress, [3, 6, 7]);
  const failure = new Error('source failed');
  async function* failed() { yield Buffer.from('{'); throw failure; }
  await assert.rejects(parseJSONStream(failed()), error => error === failure);
  await assert.rejects(parseJSONStream(chunks('{}'), { onProgress() { throw failure; } }), error => error === failure);
  await assert.rejects(parseJSONStream(chunks('{}'), { maxBytes: -1 }), /maxBytes/);
  await assert.rejects(parseJSONStream(['{}']), /Uint8Array/);
});

test('passes only primitive tokens to JSON.parse across a many-entry document', async () => {
  const count = 16000;
  const document = JSON.stringify(Array.from({ length: count }, (_, index) => ({ index, label: `entry-${index}`, selected: index % 2 === 0 })));
  const nativeParse = JSON.parse;
  let maxParseLength = 0, calls = 0;
  JSON.parse = text => { maxParseLength = Math.max(maxParseLength, text.length); calls++; return nativeParse(text); };
  try {
    const parsed = await parseJSONStream(chunks(document, 4096));
    assert.equal(parsed.length, count);
    assert.deepEqual(parsed.at(-1), { index: 15999, label: 'entry-15999', selected: false });
    assert.equal(calls, count * 6);
    assert.ok(maxParseLength <= 13, `largest JSON.parse input was ${maxParseLength}`);
    assert.ok(document.length > 512 * 1024 && document.length <= 1024 * 1024);
  } finally {
    JSON.parse = nativeParse;
  }
});
