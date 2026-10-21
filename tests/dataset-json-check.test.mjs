import test from 'node:test';
import assert from 'node:assert/strict';
import { checkJsonSyntax, createJsonSyntaxCheck } from '../app/dataset-json-check.mjs';

const parses = bytes => { try { JSON.parse(bytes.toString('utf8')); return true; } catch { return false; } };
const checks = (bytes, splits = []) => {
  try {
    const check = createJsonSyntaxCheck();
    let offset = 0;
    for (const split of [...splits, bytes.length]) { check.feed(bytes.subarray(offset, split)); offset = split; }
    check.end(); return true;
  } catch (error) { if (!(error instanceof SyntaxError)) throw error; return false; }
};
function random(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

test('pack JSON check agrees with JSON.parse on edge cases', () => {
  const cases = ['', ' ', '0', '-0', '01', '-', '1.', '.5', '1.5e', '1e+', '1E-7', '+1', '1e400', '-1.25e-3', ' 7 ', '7 7',
    'true', 'tru', 'truee', 'false', 'null', 'nul', 'True', '""', '"', '"\\"', '"\\u00e9"', '"\\u00G9"', '"\\u12"', '"\\x"', '"\\/"',
    '"\t"', '"\u007f"', '" "', '[]', '[', ']', '[,]', '[1,]', '[1 2]', '[1,,2]', '{}', '{"a":1}', '{"a":1,}', '{"a" 1}',
    '{a:1}', '{"a":}', '{,}', '{"a":1 "b":2}', '{"__proto__":1}', '{"a":[{"b":[null,true,{"c":"d"}]}]}', '[1]x', '{}{}',
    ' {}', '{} ', '﻿{}', '\f{}', '\v1', '[-]', '[-01]', '[0.0e0]', '[1e1.5]', '"a\u0000b"', '[1]\n\r\t '];
  for (const text of cases) {
    const bytes = Buffer.from(text, 'utf8');
    assert.equal(checks(bytes), parses(bytes), JSON.stringify(text));
  }
  for (const bytes of [Buffer.from([0x22, 0xff, 0x22]), Buffer.from([0x22, 0xe2, 0x22]), Buffer.from([0xe2, 0x22, 0x22]),
    Buffer.from([0x22, 0xc3, 0x5c, 0x6e, 0x22]), Buffer.from([0x5b, 0x31, 0xc2, 0xa0, 0x5d]), Buffer.from([0xef, 0xbb, 0xbf, 0x31])]) {
    assert.equal(checks(bytes), parses(bytes), bytes.toString('hex'));
  }
  assert.equal(checks(Buffer.from('['.repeat(100000) + ']'.repeat(100000))), true);
  assert.throws(() => checkJsonSyntax(Buffer.from('{"a":')), SyntaxError);
});

test('pack JSON check agrees with JSON.parse on mutated documents split anywhere', () => {
  const next = random(0x5eed);
  const seeds = ['{"a":[1,2.5,-3e2,true,false,null],"b":{"c":"d\\n\\u00e9"},"é":"☃"}', '[[],{},"",0,-0.0,1E+2]',
    '{"chunks":{"12850":{"Nickname":"Cell","Object":{"Tree":true}}},"walk":["1","2"]}', '"text"', '12', 'null'];
  const alphabet = [...'{}[]",:\\/ -+.eE0123456789tfnulrsabx\t\r\n'].map(char => char.charCodeAt(0))
    .concat([0x00, 0x08, 0x0c, 0x1f, 0x7f, 0x80, 0xa0, 0xbf, 0xc2, 0xc3, 0xa9, 0xe2, 0xa8, 0xef, 0xbb, 0xff]);
  let accepted = 0;
  for (let round = 0; round < 20000; round++) {
    const bytes = [...Buffer.from(seeds[Math.floor(next() * seeds.length)], 'utf8')];
    for (let edit = Math.floor(next() * 4); edit > 0; edit--) {
      const at = Math.floor(next() * (bytes.length + 1)), byte = alphabet[Math.floor(next() * alphabet.length)], kind = next();
      if (kind < 0.34) bytes.splice(at, 0, byte); else if (kind < 0.67) bytes.splice(at, 1); else bytes.splice(at, 1, byte);
    }
    const buffer = Buffer.from(bytes);
    const splits = [...new Set(Array.from({ length: Math.floor(next() * 4) }, () => Math.floor(next() * (buffer.length + 1))))].sort((a, b) => a - b);
    const expected = parses(buffer);
    accepted += expected;
    assert.equal(checks(buffer, splits), expected, buffer.toString('hex'));
  }
  assert.ok(accepted > 1000, 'the corpus keeps both valid and invalid documents');
});
