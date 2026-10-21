import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createGunzip, gzipSync } from 'node:zlib';
import { createServer } from '../app/server.mjs';
import { createGroupState, exportBackup } from '../app/core/state.mjs';
import { parseJSONStream } from '../app/storage/json-stream.mjs';
import { MAX_UPLOAD_BYTES, readBackupRequest } from '../app/backup-transfer.mjs';
import { createBackupUpload } from '../app/web/backup-transfer.mjs';

const definitions = { chunks: { '100': {}, '101': {}, '102': {} }, walkableChunks: ['100', '101', '102'], walkableChunksF2P: ['100', '101', '102'] };
const state = () => createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['100'] }, { id: 'player2', name: 'Player 2', unlocked: ['101'] }]);
const backupFile = backup => new File([JSON.stringify(backup)], 'synthetic-backup.json', { type: 'application/json' });

async function fixture(t, initialState = state()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-backup-import-'));
  const webRoot = path.join(directory, 'web');
  await mkdir(webRoot);
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><p>Synthetic backup test</p>');
  const application = await createServer({ dataset: fixtureDataset, dataDir: path.join(directory, 'data'), webRoot, definitions, taskMap: {},
    initialState, port: 0, predictionPrewarm: false, shutdownDeadlineMs: 500 });
  t.after(async () => { try { await application.close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await application.listen();
  const origin = `http://127.0.0.1:${application.address().port}`;
  const join = async link => {
    const response = await fetch(link, { redirect: 'manual' });
    assert.equal(response.status, 303);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await join(application.inviteUrl);
  const request = (route, init = {}, credential = cookie) => fetch(`${origin}${route}`, {
    ...init, headers: { ...(credential ? { Cookie: credential } : {}), ...(init.method === 'POST' ? { Origin: origin } : {}), ...init.headers } });
  const json = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upload = async (route, file, metadata = {}, credential = cookie) => request(route, await createBackupUpload(file, metadata).toBackupRequest(), credential);
  const invite = async properties => {
    const response = await json('/api/invites', { label: 'Synthetic test invitation', ...properties });
    assert.equal(response.status, 201);
    return join((await response.json()).link);
  };
  return { application, origin, cookie, request, json, upload, invite };
}

test('browser file upload previews and applies a full backup above 32 MiB, with streamed gzip download', async t => {
  const f = await fixture(t);
  const incoming = state(); incoming.members[0].unlocked = ['102'];
  const base = JSON.stringify(exportBackup(incoming));
  // Many bounded leaves exercise the document-size path without one giant token.
  const rowCount = 17000, evidence = 'synthetic provenance '.padEnd(2048, 'x');
  const parts = [base.slice(0, -2), ',"provenance":{"syntheticRows":['];
  for (let index = 0; index < rowCount; index++) parts.push(`${index ? ',' : ''}${JSON.stringify({ index, evidence })}`);
  parts.push(']}}}');
  const file = new File(parts, 'synthetic-large-backup.json');
  assert.ok(file.size > 32 * 1024 * 1024);
  parts.length = 0;
  const upload = createBackupUpload(file);
  const prepared = await upload.toBackupRequest();

  // Observe the transport parser separately: schema validation has its own
  // cloning boundary, while transport must never JSON.parse the whole file.
  const originalParse = JSON.parse;
  let largestToken = 0, parsed;
  JSON.parse = function (text, ...rest) {
    largestToken = Math.max(largestToken, String(text).length);
    assert.ok(String(text).length <= 4096, 'The upload parser parses only bounded primitive tokens.');
    return originalParse.call(this, text, ...rest);
  };
  try {
    const input = Readable.fromWeb(prepared.body.stream());
    input.headers = Object.fromEntries(Object.entries(prepared.headers).map(([key, value]) => [key.toLowerCase(), value]));
    parsed = await readBackupRequest(input);
    assert.equal(parsed.body.backup.state.provenance.syntheticRows.length, rowCount);
  } finally { JSON.parse = originalParse; parsed = undefined; }
  assert.ok(largestToken >= evidence.length);

  const previewResponse = await f.request('/api/restore/preview?view=play-v1', prepared);
  assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
  const preview = await previewResponse.json();
  assert.equal(preview.preview.currentRevision, 0);
  assert.deepEqual(preview.state.members[0].unlocked, ['102']);
  assert.equal(preview.state.provenance, undefined);
  assert.equal(f.application.store.getInfo().revision, 0);
  assert.deepEqual(f.application.store.getState().members[0].unlocked, ['100']);

  const applied = await f.request('/api/restore?view=play-v1', await ({ ...upload, expectedRevision: preview.preview.currentRevision }).toBackupRequest());
  assert.equal(applied.status, 200, await applied.clone().text());
  const result = await applied.json();
  assert.equal(result.format, 'play-v1');
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.state.members[0].unlocked, ['102']);
  assert.equal(result.state.provenance, undefined);

  const download = await f.request('/api/backup?download=gzip');
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /application\/gzip/);
  assert.match(download.headers.get('content-disposition'), /\.json\.gz/);
  assert.equal(download.headers.get('content-encoding'), null);
  const document = await parseJSONStream(Readable.fromWeb(download.body).pipe(createGunzip()));
  assert.equal(document.format, 'rs3-chunk-picker');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.state.revision, 1);
  assert.deepEqual(document.state.members[0].unlocked, ['102']);
  const rows = document.state.provenance.restore.incomingProvenance.syntheticRows;
  assert.equal(rows.length, rowCount);
  assert.deepEqual(rows[0], { index: 0, evidence });
  assert.deepEqual(rows.at(-1), { index: rowCount - 1, evidence });
});

test('gzip file roundtrip and ordinary gzip JSON restore retain revision conflict protection', async t => {
  const f = await fixture(t);
  const downloaded = await f.request('/api/backup?download=gzip');
  const file = new File([await downloaded.blob()], 'synthetic-roundtrip.json.gz');
  const upload = createBackupUpload(file);
  const preview = await f.request('/api/restore/preview?view=play-v1', await upload.toBackupRequest());
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).preview.currentRevision, 0);
  const apply = await f.request('/api/restore?view=play-v1', await ({ ...upload, expectedRevision: 0 }).toBackupRequest());
  assert.equal(apply.status, 200);
  assert.equal((await apply.json()).state.revision, 1);
  const before = await f.application.store.backup();
  const stale = await f.request('/api/restore?view=play-v1', await ({ ...upload, expectedRevision: 0 }).toBackupRequest());
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).state.revision, 1);
  assert.deepEqual(await f.application.store.backup(), before);
  const ordinary = await f.request('/api/restore?view=play-v1', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    body: gzipSync(JSON.stringify({ backup: exportBackup(state()), expectedRevision: 1 })) });
  assert.equal(ordinary.status, 200, await ordinary.clone().text());
  assert.equal((await ordinary.json()).state.revision, 2);
});

test('corrupt gzip, invalid JSON and invalid backup schema leave the durable save unchanged', async t => {
  const f = await fixture(t), before = await f.application.store.backup();
  const corrupt = await f.request('/api/restore?view=play-v1', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: Buffer.from('not a gzip stream') });
  assert.equal(corrupt.status, 400);
  assert.match((await corrupt.json()).message, /gzip.*corrupt|corrupt.*gzip/i);
  const malformed = await f.upload('/api/restore/preview?view=play-v1', new File(['{"format":'], 'malformed.json'));
  assert.equal(malformed.status, 400);
  const invalid = exportBackup(state()); invalid.state.members[0].unlocked = ['100', '100'];
  for (const route of ['/api/restore/preview?view=play-v1', '/api/restore?view=play-v1']) {
    const response = await f.upload(route, backupFile(invalid), { expectedRevision: 0 });
    assert.equal(response.status, 400, route);
    assert.deepEqual(await f.application.store.backup(), before);
    const rawState = await f.json(route, { backup: state(), expectedRevision: 0 });
    assert.equal(rawState.status, 400, 'Public restore requires the backup format envelope.');
    assert.deepEqual(await f.application.store.backup(), before);
  }
  assert.deepEqual(await f.application.store.backup(), before);
});

test('compressed imports enforce authentication, origin, administrator, viewer and player scopes', async t => {
  const f = await fixture(t), before = await f.application.store.backup();
  const incoming = state(); incoming.members[0].unlocked = ['102']; incoming.members[1].unlocked = ['102'];
  const file = backupFile(exportBackup(incoming));
  const init = await createBackupUpload(file, { expectedRevision: 0 }).toBackupRequest();
  assert.equal(init.headers['Content-Encoding'], 'gzip');
  assert.equal((await f.request('/api/restore?view=play-v1', init, null)).status, 401);
  const foreign = await f.request('/api/restore?view=play-v1', { ...init, headers: { ...init.headers, Origin: 'https://foreign.example' } });
  assert.equal(foreign.status, 403);
  const missing = await fetch(`${f.origin}/api/restore?view=play-v1`, { ...init, headers: { ...init.headers, Cookie: f.cookie } });
  assert.equal(missing.status, 403);
  const memberCookie = await f.invite({ memberId: 'player1' });
  const viewerCookie = await f.invite({ viewer: true });
  for (const route of ['/api/restore/preview?view=play-v1', '/api/restore?view=play-v1']) {
    assert.equal((await f.request(route, init, memberCookie)).status, 403);
    assert.equal((await f.request(route, init, viewerCookie)).status, 403);
  }
  const own = await createBackupUpload(file, { memberId: 'player1', expectedRevision: 0 }).toBackupRequest();
  assert.equal((await f.request('/api/member-restore/preview?view=play-v1', own, viewerCookie)).status, 403);
  assert.equal((await f.upload('/api/member-restore?view=play-v1', file, { memberId: 'player2', expectedRevision: 0 }, memberCookie)).status, 403);
  assert.deepEqual(await f.application.store.backup(), before);
  const preview = await f.request('/api/member-restore/preview?view=play-v1', own, memberCookie);
  assert.equal(preview.status, 200);
  assert.equal(f.application.store.getInfo().revision, 0);
  const applied = await f.request('/api/member-restore?view=play-v1', own, memberCookie);
  assert.equal(applied.status, 200, await applied.clone().text());
  const after = await f.application.store.backup();
  assert.equal(after.state.revision, 1);
  assert.deepEqual(after.state.members[0].unlocked, ['102']);
  assert.deepEqual(after.state.members[1], before.state.members[1]);
  assert.deepEqual(after.state.rules, before.state.rules);
});

test('an oversized declared compressed upload is rejected before reading its body', async t => {
  const f = await fixture(t), before = await f.application.store.backup();
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${f.origin}/api/restore?view=play-v1`, { method: 'POST', headers: {
      Cookie: f.cookie, Origin: f.origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': MAX_UPLOAD_BYTES + 1,
    } }, response => { response.resume(); response.on('end', () => { resolve(response.statusCode); request.destroy(); }); });
    request.on('error', reject);
    request.flushHeaders();
  });
  assert.equal(status, 413);
  assert.deepEqual(await f.application.store.backup(), before);
});

test('an invalid unfinished request returns an error and releases the import admission', async t => {
  const f = await fixture(t), before = await f.application.store.backup();
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${f.origin}/api/restore/preview?view=play-v1`, { method: 'POST', headers: {
      Cookie: f.cookie, Origin: f.origin, 'Content-Type': 'application/json',
    } }, response => {
      response.resume();
      response.on('end', () => { resolve(response.statusCode); request.destroy(); });
    });
    t.after(() => request.destroy());
    request.on('error', reject);
    request.setTimeout(5000, () => { request.destroy(); reject(new Error('Invalid unfinished JSON did not receive an error response.')); });
    // Never end the body: a parse error must not wait for a sender to finish.
    request.write('}');
  });
  assert.equal(status, 400);
  const second = await f.upload('/api/restore/preview?view=play-v1', backupFile(exportBackup(state())));
  assert.equal(second.status, 200, await second.clone().text());
  assert.deepEqual(await f.application.store.backup(), before);
});

test('undo stops at a full restore while commands saved afterwards remain reversible', async t => {
  const f = await fixture(t);
  const command = { type: 'set-rule', ruleId: 'content.f2p', value: false };
  assert.equal((await f.json('/api/command?view=play-v1', { expectedRevision: 0, command })).status, 200);
  const restored = await f.upload('/api/restore?view=play-v1', backupFile(exportBackup(state())), { expectedRevision: 1 });
  assert.equal(restored.status, 200);
  const restoredState = (await restored.json()).state;
  assert.equal(restoredState.revision, 2);
  const boundary = await f.application.store.backup();
  const rejected = await f.json('/api/command?view=play-v1', { expectedRevision: 2, command: { type: 'undo' } });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await f.application.store.backup(), boundary);
  const after = await f.json('/api/command?view=play-v1', { expectedRevision: 2, command });
  assert.equal(after.status, 200);
  assert.equal((await after.json()).state.revision, 3);
  const undo = await f.json('/api/command?view=play-v1', { expectedRevision: 3, command: { type: 'undo' } });
  assert.equal(undo.status, 200);
  const undone = (await undo.json()).state;
  assert.equal(undone.revision, 4);
  assert.deepEqual(undone.members, restoredState.members);
  assert.deepEqual(undone.rules, boundary.state.rules);
  assert.equal((await f.json('/api/command?view=play-v1', { expectedRevision: 4, command: { type: 'undo' } })).status, 400);
  assert.equal(f.application.store.getInfo().revision, 4);
});

test('a legacy map file uses the browser restore flow and returns a compact import preview', async t => {
  const f = await fixture(t);
  const randomLoot = Array.from({ length: 2000 }, (_, index) => ({ index, source: 'synthetic original-picker evidence'.padEnd(512, 'x') }));
  const document = { maps: {
    qxa: { chunks: { unlocked: { '102': '102' }, selected: {} }, randomLoot },
    qxb: { chunks: { unlocked: { '101': '101' }, selected: {} } },
  } };
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'qxa' }, { id: 'player2', name: 'Player 2', mapId: 'qxb' }];
  const file = new File([JSON.stringify(document)], 'synthetic-legacy-map.json');
  assert.ok(file.size > 1024 * 1024);
  const upload = createBackupUpload(file, { members });
  const response = await f.request('/api/restore/preview?view=play-v1', await upload.toBackupRequest());
  assert.equal(response.status, 200, await response.clone().text());
  const bytes = await response.text();
  assert.ok(Buffer.byteLength(bytes) < 32 * 1024, 'The preview omits the full saved original-map copy.');
  const preview = JSON.parse(bytes);
  assert.equal(preview.format, 'play-v1');
  assert.deepEqual(preview.state.members[0].unlocked, ['102']);
  assert.equal(preview.state.legacy, undefined);
  assert.equal(preview.state.provenance, undefined);
  assert.equal(f.application.store.getInfo().revision, 0);
  const applied = await f.request('/api/restore?view=play-v1', await ({ ...upload, expectedRevision: 0 }).toBackupRequest());
  assert.equal(applied.status, 200, await applied.clone().text());
  assert.equal((await applied.json()).state.revision, 1);
  const saved = await f.application.store.backup();
  assert.equal(saved.state.members[0].sourceMapId, 'qxa');
  assert.deepEqual(saved.state.legacy.maps.qxa.randomLoot, randomLoot);
});
