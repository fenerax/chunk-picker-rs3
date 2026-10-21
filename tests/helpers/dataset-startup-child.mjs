import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
let application;
try {
  // The parent supplies selection environment before importing any application
  // module. This process cannot reuse a tracked singleton from another test.
  const { createServer } = await import('../../app/server.mjs');
  const { createGroupState } = await import('../../app/core/state.mjs');
  const definitions = { chunks: { '100': {}, '101': {} }, sections: { '100': { 0: [] }, '101': { 0: [] } }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] };
  application = await createServer({ dataDir: config.dataDir, port: config.port ?? 0, definitions, taskMap: {},
    initialState: createGroupState([{ id: 'fixture', name: 'Synthetic member', unlocked: ['100'] }]),
    predictionPrewarm: false, loopbackPort: undefined, publicOrigin: undefined });
  if (config.mode === 'failure') {
    console.log(JSON.stringify({ failed: false }));
  } else {
    await application.listen();
    const invitation = new URL(application.inviteUrl), headers = { authorization: `Bearer ${invitation.pathname.split('/').at(-1)}` };
    const get = route => fetch(`${invitation.origin}${route}`, { headers });
    assert.equal((await fetch(`${invitation.origin}/api/dataset-runtime`)).status, 401);
    assert.equal((await fetch(`${invitation.origin}/api/training-catalogue`)).status, 401);
    const training = await get('/api/training-catalogue'); assert.equal(training.status, 200);
    assert.equal((await training.json()).version, config.sentinel);
    const raw = await get('/data/training/methods.f2p.json'); assert.equal(raw.status, 200);
    assert.deepEqual(Buffer.from(await raw.arrayBuffer()), await readFile(config.trainingPath));
    const retired = await get('/data/cache-interiors.2026-10-08.v1.json'); assert.equal(retired.status, 404);
    const unknown = await get('/data/not-selected-fixture.json'); assert.equal(unknown.status, 404);
    const runtime = await get('/dataset-runtime.mjs'); assert.equal(runtime.status, 200);
    assert.match(await runtime.text(), /data\/dataset-runtime\.json/);
    assert.equal(runtime.headers.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const payload = await get('/api/dataset-runtime'); assert.equal(payload.status, 200);
    const selected = await payload.json(); assert.equal(selected.dataset.digest, config.digest);
    const staticPayload = await get('/data/dataset-runtime.json'); assert.equal(staticPayload.status, 200);
    assert.deepEqual(await staticPayload.json(), selected);
    assert.equal((await get(`/data/training/methods.f2p.json?digest=${'0'.repeat(64)}`)).status, 409);
    const status = await get('/api/dataset-status'); assert.equal(status.status, 200);
    assert.equal((await status.json()).digest, config.digest);
    console.log(JSON.stringify({ ok: true, sentinel: config.sentinel, selectedDigest: config.digest }));
  }
} catch (error) {
  // Never write invitation credentials or process-local paths to test output.
  console.log(JSON.stringify({ failed: true, code: error.code ?? 'STARTUP_ERROR', name: error.name, ...(config.mode === 'browser' ? { message: error.message } : {}) }));
} finally { await application?.close(); }
