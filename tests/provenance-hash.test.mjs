import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

test('repository provenance hashes use LF for CRLF and mixed working copies', () => {
  const lf = Buffer.from('Player 1\n{"source":"retained"}\n');
  assert.equal(sha256RepositoryText(lf), sha256(lf));
  assert.equal(sha256RepositoryText('Player 1\r\n{"source":"retained"}\r\n'), sha256(lf));
  assert.equal(sha256RepositoryText('Player 1\r\n{"source":"retained"}\n'), sha256(lf));
  assert.notEqual(sha256RepositoryText('Player 1\n{"source":"changed"}\n'), sha256(lf));
});

test('text normalization preserves lone CRs, BOMs and bytes outside CRLF pairs', () => {
  const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0xa9, 13, 0, 13, 10, 10, 13]);
  const lf = Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0xa9, 13, 0, 10, 10, 13]);
  assert.equal(sha256RepositoryText(bytes), sha256(lf));
  assert.deepEqual(bytes, Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0xa9, 13, 0, 13, 10, 10, 13]));
});

test('external and binary provenance hashes retain exact raw bytes', () => {
  const bytes = Buffer.from([0, 0xff, 13, 10, 0x80]);
  assert.equal(sha256(bytes), '672098eecaca353d3dee05da38b00e81d3dede461ea74c33d9d3cea60ae9a500');
  assert.notEqual(sha256(bytes), sha256RepositoryText(bytes));
});
