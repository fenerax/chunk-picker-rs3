import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readBackupRequest, BACKUP_UPLOAD_TYPE, backupJSONChunks } from '../app/backup-transfer.mjs';
import { createBackupUpload, MAX_BACKUP_BYTES } from '../app/web/backup-transfer.mjs';
import { parseJSONStream } from '../app/storage/json-stream.mjs';

function request(bytes, headers = {}) {
  const stream = Readable.from([bytes]); stream.headers = { 'content-type': 'application/json', ...headers }; return stream;
}

test('browser upload caches its Blob and spread Apply metadata supplies the current revision', async () => {
  let streams = 0;
  const file = new File(['{"format":"rs3-chunk-picker","state":{}}'], 'backup.json');
  const stream = file.stream.bind(file); file.stream = () => { streams++; return stream(); };
  const upload = createBackupUpload(file, { memberId: 'actor1' });
  const preview = await upload.toBackupRequest();
  const apply = await ({ ...upload, expectedRevision: 19 }).toBackupRequest();
  assert.equal(streams, 1);
  assert.equal(apply.body, preview.body);
  assert.equal(apply.headers['Content-Type'], BACKUP_UPLOAD_TYPE);
  assert.deepEqual(JSON.parse(apply.headers['X-RS3-Import']), { memberId: 'actor1', expectedRevision: 19 });
  const decoded = await readBackupRequest(request(Buffer.from(await apply.body.arrayBuffer()),
    Object.fromEntries(Object.entries(apply.headers).map(([key, value]) => [key.toLowerCase(), value]))));
  assert.equal(decoded.uploaded, true);
  assert.equal(decoded.body.expectedRevision, 19);
  assert.equal(decoded.body.memberId, 'actor1');
  assert.equal(decoded.body.backup.format, 'rs3-chunk-picker');
});

test('gzip files and ordinary JSON remain valid through the browser transfer helper', async () => {
  const document = { format: 'rs3-chunk-picker', state: { label: 'Player 🎲', members: [] } };
  const upload = await createBackupUpload(new File([gzipSync(JSON.stringify(document))], 'BACKUP.JSON.GZ')).toBackupRequest();
  const body = Buffer.from(await upload.body.arrayBuffer());
  const wrapped = JSON.parse(upload.headers['Content-Encoding'] === 'gzip' ? gunzipSync(body) : body.toString());
  assert.deepEqual(wrapped, { file: document });
  assert.deepEqual(await readBackupRequest(request(Buffer.from(JSON.stringify({ backup: document, expectedRevision: 7 })))),
    { body: { backup: document, expectedRevision: 7 }, uploaded: false });
  assert.throws(() => createBackupUpload({ name: 'too-large.json', size: MAX_BACKUP_BYTES + 1 }), /too large/i);
  await assert.rejects(createBackupUpload(new File(['corrupt gzip'], 'bad.json.gz')).toBackupRequest(), /gzip.*corrupt|corrupt.*gzip/i);
});

test('small injected transfer bounds reject declared, actual and decompressed excess', async () => {
  const options = { maxBackupBytes: 64, maxUploadBytes: 128 };
  await assert.rejects(readBackupRequest(request(Buffer.from('{}'), { 'content-length': '129' }), options), { status: 413 });
  await assert.rejects(readBackupRequest(request(Buffer.from(' '.repeat(129))), options), { status: 413 });
  await assert.rejects(readBackupRequest(request(gzipSync(JSON.stringify({ large: 'x'.repeat(80) })),
    { 'content-encoding': 'gzip' }), options), { status: 413 });
  assert.deepEqual(await readBackupRequest(request(gzipSync('{"ok":true}'), { 'content-encoding': 'gzip' }), options),
    { body: { ok: true }, uploaded: false });
  await assert.rejects(parseJSONStream(Readable.from([Buffer.from('{"large":"123456789"}')]), { maxBytes: 64, maxTokenBytes: 8 }), { status: 413 });
});

test('streamed JSON leaves preserve array nulls, escaping and non-ASCII backup values', () => {
  const document = { text: 'Player 🎲\n"quoted"', array: [true, null, undefined, { omitted: undefined, number: 2.5 }] };
  assert.equal([...backupJSONChunks(document)].join(''), JSON.stringify(document));
});

test('browser upload uses a plain JSON wrapper when compression is unavailable', async () => {
  const compression = globalThis.CompressionStream;
  const document = { format: 'rs3-chunk-picker', state: { label: 'Player' } };
  try {
    globalThis.CompressionStream = undefined;
    for (const file of [new File([JSON.stringify(document)], 'backup.json'), new File([gzipSync(JSON.stringify(document))], 'backup.json.gz')]) {
      const upload = await createBackupUpload(file).toBackupRequest();
      assert.equal(upload.headers['Content-Encoding'], undefined);
      assert.equal(upload.headers['Content-Type'], BACKUP_UPLOAD_TYPE);
      assert.deepEqual(JSON.parse(await upload.body.text()), { file: document });
      const parsed = await readBackupRequest(request(Buffer.from(await upload.body.arrayBuffer()), { 'content-type': BACKUP_UPLOAD_TYPE }));
      assert.deepEqual(parsed.body.backup, document);
    }
  } finally { globalThis.CompressionStream = compression; }
});

test('CRC corruption and truncated gzip files are rejected by the browser and server readers', async () => {
  const valid = gzipSync('{"backup":{"format":"rs3-chunk-picker"}}');
  const corrupt = Buffer.from(valid); corrupt[corrupt.length - 8] ^= 0xff;
  for (const bytes of [corrupt, valid.subarray(0, valid.length - 4)]) {
    await assert.rejects(readBackupRequest(request(bytes, { 'content-encoding': 'gzip' })), error => error.status === 400 && /gzip.*corrupt|corrupt.*gzip/i.test(error.message));
    await assert.rejects(createBackupUpload(new File([bytes], 'bad.json.gz')).toBackupRequest(), /gzip.*corrupt|corrupt.*gzip/i);
  }
});
