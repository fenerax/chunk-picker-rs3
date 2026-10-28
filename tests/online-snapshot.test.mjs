import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { releaseVps } from '../scripts/release/vps/release.mjs';
import { prepareBundle } from '../scripts/release/vps/bundle.mjs';
import { execFileSync } from 'node:child_process';
import { snapshotStore, snapshotPath, withStoreWrite } from '../app/storage/snapshot.mjs';
import { atomic as linuxAtomic, inventory } from '../scripts/linux/files.mjs';
import { createRequestReader } from '../app/web/live-swap-client.mjs';
import { startEarlyServer } from '../app/startup.mjs';

process.env.RS3_DATASET = 'open-starter';
const { createServer } = await import('../app/server.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

async function atomic(file, bytes) {
  for (let attempt = 0; ; attempt++) {
    try { return await linuxAtomic(file, bytes); }
    catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM' || attempt >= 6) throw error; await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt)); }
  }
}
async function fixture(t) {
  const root = path.resolve('.local/online-snapshot-tests'); await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(path.join(root, 'run-'));
  t.after(async () => { assert(path.resolve(scratch).startsWith(root + path.sep)); await rm(scratch, { recursive: true, force: true }); });
  return { scratch, dataDir: path.join(scratch, 'game') };
}
test('concurrent real commands and sidecar writes yield a consistent full snapshot and keep accepting writes', async t => {
  const { dataDir } = await fixture(t);
  const store = await openStore({ dataDir, initialState: createGroupState([{ id: 'one', name: 'Explorer' }]), retention: false });
  t.after(() => store.close());
  await writeFile(dataDir + '.dataset.json', '{"synthetic":true}\n');
  const id = randomUUID();
  // A transaction spans two files, while a real store write shares the barrier.
  const transaction = withStoreWrite(dataDir, async () => {
    await atomic(path.join(dataDir, 'sidecar-a.json'), 'before');
    await new Promise(resolve => setTimeout(resolve, 20));
    await atomic(path.join(dataDir, 'sidecar-b.json'), 'before');
  });
  const snapshot = snapshotStore(dataDir, id, { maxHoldMs: 30000 });
  await assert.rejects(snapshotStore(dataDir, randomUUID()), /already being captured/);
  const command = store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0);
  const next = withStoreWrite(dataDir, async () => {
    await atomic(path.join(dataDir, 'sidecar-a.json'), 'after');
    await atomic(path.join(dataDir, 'sidecar-b.json'), 'after');
  });
  const result = await snapshot;
  await transaction; await command; await next;
  const copy = path.join(snapshotPath(dataDir, id), 'store');
  assert.equal(await readFile(path.join(copy, 'sidecar-a.json'), 'utf8'), 'before');
  assert.equal(await readFile(path.join(copy, 'sidecar-b.json'), 'utf8'), 'before');
  assert.equal(JSON.parse(await readFile(path.join(copy, 'state.json'))).state.revision, 0);
  assert.equal(store.getInfo().revision, 1);
  assert(!(await inventory(copy)).some(row => row.path.startsWith('store.lock')));
  assert(result.heldMs < 30000);
});

test('snapshot timeout/invalid ID releases writes and never removes existing snapshots', async t => {
  const { dataDir } = await fixture(t); await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'state.json'), '{}'); await writeFile(dataDir + '.dataset.json', '{}');
  await assert.rejects(snapshotStore(dataDir, '../bad'), /ID/);
  let finish; const writing = withStoreWrite(dataDir, () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(snapshotStore(dataDir, randomUUID(), { maxHoldMs: 5 }), /timed out/);
  finish(); await writing;
  const id = randomUUID(); await snapshotStore(dataDir, id);
  await assert.rejects(snapshotStore(dataDir, id), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(snapshotPath(dataDir, id), 'store/state.json'), 'utf8'), '{}');
  await withStoreWrite(dataDir, async () => {});
});

test('snapshot is available only to the private master operator; public role refuses', async t => {
  const { dataDir } = await fixture(t);
  const app = await createServer({ dataDir, host: '127.0.0.1', port: 0, loopbackPort: 0, loopbackRole: 'public', predictionPrewarm: false });
  await app.listen(); t.after(() => app.close());
  const token = app.store.getAccessToken();
  const privateOrigin = `http://127.0.0.1:${app.address().port}`;
  const publicOrigin = `http://127.0.0.1:${app.loopbackAddress().port}`;
  const id = randomUUID();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let response = await fetch(publicOrigin + '/api/operator/snapshot', { method: 'POST', headers, body: JSON.stringify({ id }) });
  assert.equal(response.status, 403);
  response = await fetch(privateOrigin + '/api/operator/snapshot', { method: 'POST', headers: { Cookie: 'duo_access=' + token, 'Content-Type': 'application/json', Origin: privateOrigin }, body: JSON.stringify({ id }) });
  assert.equal(response.status, 403);
  response = await fetch(privateOrigin + '/api/operator/snapshot', { method: 'POST', headers, body: JSON.stringify({ id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, id);
});

test('warm-up navigation gets a self-retrying HTML page while API responses remain 503 JSON', async t => {
  const { dataDir } = await fixture(t);
  let finish;
  const app = await startEarlyServer({ dataDir, host: '127.0.0.1', port: 0 }, async options => {
    await new Promise(resolve => { finish = resolve; });
    return { listen: async () => {}, close: async () => { options.httpServer.closeAllConnections(); await new Promise(resolve => options.httpServer.close(resolve)); } };
  });
  // No real application and no secret are needed to exercise the early listener.
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  t.after(async () => { finish(); await app.ready; await app.close(); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  let response = await fetch(origin, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /http-equiv="refresh" content="2"/);
  response = await fetch(new URL('/api/state', origin));
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'PICKER_WARMING');
});

test('reads retry only restart answers; busy, refusal, mutations and aborts are never blindly replayed', async () => {
  let calls = 0;
  const read = createRequestReader({ sleep: async () => {}, fetch: async () => {
    calls++;
    if (calls === 1) return { status: 503, ok: false, json: async () => ({ code: 'PICKER_WARMING' }) };
    if (calls === 2) return { status: 503, ok: false, json: async () => ({ code: 'PICKER_UPDATING' }) };
    return { status: 200, ok: true, json: async () => ({ revision: 1 }) };
  } });
  assert.deepEqual((await read('/api/state')).value, { revision: 1 }); assert.equal(calls, 3);
  calls = 0; assert.equal((await createRequestReader({ sleep: async () => {}, fetch: async () => { calls++; return { status: 503, ok: false, json: async () => ({}) }; } })('/api/state')).response.status, 503);
  assert.equal(calls, 1, 'a busy 503 stays single-dispatch');
  calls = 0; await assert.rejects(createRequestReader({ sleep: async () => {}, fetch: async () => { calls++; throw new TypeError('refused'); } })('/api/state'), /Check your internet/);
  assert.equal(calls, 1, 'a refused connection stays single-dispatch');
  calls = 0; assert.equal((await createRequestReader({ sleep: async () => {}, fetch: async () => { calls++; return { status: 503, ok: false, json: async () => ({ code: 'PICKER_WARMING' }) }; } })('/api/anything', { method: 'POST' })).response.status, 503);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read('/api/state', { signal: controller.signal }), { name: 'AbortError' });
});

test('PC go-live refuses the VPS pause before loading a candidate or stopping anything', async t => {
  const { scratch } = await fixture(t), operator = path.join(scratch, 'operator'), local = path.join(scratch, 'local');
  await mkdir(operator); await mkdir(local); await writeFile(path.join(local, 'picker-paused'), 'synthetic');
  // Minimal operator seams: running this test cannot control a real picker.
  await writeFile(path.join(operator, 'Operator-Common.ps1'), `function Assert-OperatorPath { param($p) return $p }\n`);
  await writeFile(path.join(operator, 'ReleaseV2-Common.ps1'), `function Read-ReleaseV2Pointer { param($p, [switch]$ForStop) return [pscustomobject]@{ pointer=[pscustomobject]@{ releaseId='old' }; context=[pscustomobject]@{ localDir='${local.replaceAll("'", "''")}' } } }\n`);
  const config = path.join(scratch, 'config.json');
  await writeFile(config, JSON.stringify({ Repo: scratch, Current: 'synthetic', Releases: scratch, Operator: operator, WatchdogLog: 'synthetic' }));
  if (process.platform !== 'win32') { t.skip('Windows PowerShell guard is exercised by Windows CI'); return; }
  assert.throws(() => execFileSync('powershell', ['-NoProfile', '-File', path.resolve('scripts/release/pc/Quick-Release.ps1'), '-GoLive', '-ReleaseDir', scratch, '-ExpectLive', 'old', '-Config', config], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }), error => /PC picker is paused for VPS hosting/.test(error.stderr));
});

test('nested and deferred maintenance cannot escape the snapshot barrier', async t => {
  const { dataDir } = await fixture(t); await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'state.json'), '{}'); await writeFile(dataDir + '.dataset.json', '{}');
  let maintenance;
  await withStoreWrite(dataDir, async () => {
    maintenance = withStoreWrite(dataDir, async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      await atomic(path.join(dataDir, 'maintenance.json'), 'complete');
    });
  });
  const id = randomUUID(); await snapshotStore(dataDir, id); await maintenance;
  assert.equal(await readFile(path.join(snapshotPath(dataDir, id), 'store/maintenance.json'), 'utf8'), 'complete');
});

test('release staging has no activation by default and explicit activation binds the reviewed receipt', async t => {
  const { scratch } = await fixture(t);
  for (const name of ['release.tar', 'source-config.json', 'release-manifest.json', 'transfer.json', 'bundle.mjs']) await writeFile(path.join(scratch, name), '{}');
  const calls = [], options = { out: scratch, host: 'synthetic-alias', upload: '/var/tmp/new-upload', target: '/opt/picker/releases/new', 'operator-config': '/etc/picker/operator.json', 'tools-root': '/opt/picker/tools', node: '/opt/node/bin/node' };
  const execute = (file, args) => { calls.push({ file, args }); };
  await releaseVps('stage', options, execute);
  assert.equal(calls.filter(call => call.file === 'scp').length, 5);
  assert(!calls.some(call => call.args.some(arg => arg.includes('operator.mjs'))));
  calls.length = 0;
  await assert.rejects(releaseVps('activate', options, execute), /explicit/);
  assert.equal(calls.length, 0);
  await releaseVps('activate', { ...options, 'go-live': true }, execute);
  assert.equal(calls.length, 1); assert.match(calls[0].args.at(-1), /operator.mjs.*deploy.*verified.json/);
  await assert.rejects(releaseVps('stage', { ...options, upload: '/tmp/../unsafe' }, execute), /safe absolute/);
});

test('release bundle pins and manifest verify every uploaded file without copying a store', async t => {
  const { scratch } = await fixture(t), source = path.join(scratch, 'release'), out = path.join(scratch, 'bundle');
  for (const name of ['core', 'packs', 'addons']) await mkdir(path.join(source, name), { recursive: true });
  await writeFile(path.join(source, 'core/app.mjs'), 'export {};');
  const profile = path.join(source, 'profile.json'); await writeFile(profile, '{}');
  const { sha } = await import('../scripts/linux/files.mjs');
  await writeFile(path.join(source, 'config.json'), JSON.stringify({ coreRoot: path.join(source, 'core'), profile: { path: profile, sha256: sha('{}') } }));
  await prepareBundle(source, out);
  const manifest = JSON.parse(await readFile(path.join(out, 'release-manifest.json')));
  assert(manifest.rows.some(row => row.path === 'core/app.mjs'));
  assert(!manifest.rows.some(row => row.path.includes('state.json')));
  await writeFile(profile, 'changed');
  await assert.rejects(prepareBundle(source, path.join(scratch, 'bad-bundle')), /pin mismatch/);
});

test('read retries cover a fifteen-second warm-up and remain bounded', async () => {
  let at = 0, calls = 0;
  const read = createRequestReader({ now: () => at, sleep: async ms => { at += ms; }, fetch: async () => {
    calls++;
    return { status: calls <= 15 ? 503 : 200, ok: calls > 15, headers: { get: () => '1' }, json: async () => (calls <= 15 ? { code: 'PICKER_WARMING' } : {}) };
  } });
  assert.equal((await read('/api/state')).response.status, 200);
  assert.equal(at, 15000); assert.equal(calls, 16);
  calls = 0; at = 0;
  const bounded = createRequestReader({ maxReadAttempts: 3, now: () => at, sleep: async ms => { at += ms; }, fetch: async () => {
    calls++; return { status: 503, ok: false, json: async () => ({ code: 'PICKER_WARMING' }) };
  } });
  assert.equal((await bounded('/api/state')).response.status, 503); assert.equal(calls, 3);
});
