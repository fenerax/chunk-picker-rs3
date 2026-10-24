delete process.env.PERF_STAGE_FD;
// R135 full-public normal HTTP child. Arm is selected only by the owned scratch source path.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {firstFailureRecorder} from './diagnostics.mjs';
const failures=firstFailureRecorder();let operationCode='r135-output-create';
function remember(error){const diagnostic=failures.capture(error,operationCode,null,0);try{process.send?.({kind:'r135-first-failure',diagnostic},()=>{});}catch{}return diagnostic;}

const entry = performance.now(), entryUtc = new Date().toISOString();
const [sourceArg, outArg] = process.argv.slice(2), base = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(sourceArg), out = path.resolve(outArg), absent = path.join(out, 'absent');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const redact = value => String(value).replace(/https?:\/\/\S+/g, '[redacted-url]');
const report = { source: '6f22fefa782747790e2eaefa01e4e5ea7b557323', entryUtc, entryMonotonic: entry,
  milestones: [], responses: [], warmupControl: { status: 'UNRUN' }, scope: 'normal startServer; owned A or exact R49 C; unshaped HTTP component; no speed claim' };
let early, app, cookie, closing, failed = false;
const abort = new AbortController();
const createOutput=()=>mkdir(out,{recursive:false});
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function milestone(name, fields = {}) { report.milestones.push({ name, sinceEntryMs: performance.now() - entry, ...fields }); await save(); }
const close = () => early ? (closing ??= Promise.resolve(early.close())) : Promise.resolve();
const timer = setTimeout(() => { operationCode='r135-child-deadline';remember(Object.assign(new Error('child deadline'),{code:'ETIMEDOUT'}));failed = true; report.deadline = '115s controller deadline'; abort.abort(); void close().catch(() => {}); }, 115000);
const stop = () => { operationCode='r135-child-signal';remember(Object.assign(new Error('child signal'),{code:'ABORT_ERR'}));failed = true; report.interrupted = true; abort.abort(); void close().catch(() => {}); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);

async function request(label, route, limit = 32 * 1024**2, timeout = 90000) {
  const started = performance.now(), cpuBefore=process.cpuUsage(), memoryBefore=process.memoryUsage();
  const response = await fetch(new URL(route, early.inviteUrl).origin + route,
    { headers: { cookie }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
  const headersAt = performance.now(), chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) throw new Error('response byte cap: ' + label); chunks.push(chunk); }
  const bodyAt = performance.now(), raw = Buffer.concat(chunks), body = JSON.parse(raw.toString('utf8'));
  await writeFile(path.join(out, label + '.json'), raw);
  const receipt = { label, route, status: response.status, headersMs: headersAt - started, bodyCompleteMs: bodyAt - started,
    sinceEntryMs: bodyAt - entry, bytes, rawSha256: sha(raw), orderedBodySha256: sha(JSON.stringify(body)),
    cpuDelta: process.cpuUsage(cpuBefore), memoryBefore, memoryAfter:process.memoryUsage(),
    contentType: response.headers.get('content-type'), contentEncoding: response.headers.get('content-encoding'),
    cache: body.cache ?? null };
  if (body.rows) { receipt.orderedRowsSha256 = sha(JSON.stringify(body.rows)); receipt.orderedRowBytes=Buffer.byteLength(JSON.stringify(body.rows)); }
  report.responses.push(receipt); await save();
  assert.equal(response.status, 200, label + ' HTTP status');
  return { body, receipt };
}

function planning(result, revision) {
  operationCode='r135-http-body-validation';
  const body = result.body;
  assert.equal(body.format, 'chunk-planning-v1'); assert.equal(body.memberId, 'alpha');
  assert.equal(String(body.chunkId), '12849'); assert.equal(body.stateRevision, revision);
  assert.ok(Array.isArray(body.rows));
  const logical = new Map(body.rows.map(row => [row.task.id, row]));
  assert.equal(logical.size,772);assert.equal(body.rows.length,772);assert.equal(result.receipt.orderedRowBytes,408272);assert.equal(result.receipt.orderedRowsSha256,'e4d73ab056534151b33dc98ef53da7326c025b3d5eb347cb50eaa0efeec58519');
  result.receipt.logicalRows = logical.size; result.receipt.rawRows = body.rows.length;
  result.receipt.available = [...logical.values()].filter(row => row.task.status === 'available').length;
  result.receipt.blocked = [...logical.values()].filter(row => row.task.status === 'blocked').length;
  result.receipt.observedHit = body.cache?.hit ?? null;
  // No baselineHit/indexHit inference; complete raw rows/body/cache remain retained.
}

try {
  await createOutput();operationCode='r135-child-admission';
  assert.equal(process.version, 'v24.19.0');
  assert.deepEqual(process.execArgv,['--max-old-space-size=768']);
  assert.ok(!process.env.NODE_OPTIONS && !process.env.RS3_WORKER_MEMORY_PROBE_IMPORT, 'no preloads/diagnostic hook');
  operationCode='r135-child-harness-verify';const manifest = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) assert.equal(sha(await readFile(path.join(base, file.path))), file.sha256, file.path);

  Object.assign(process.env, { RS3_DATASET: 'duo-legacy', RS3_TASK_WORKER_MODE: 'process',
    RS3_GAME_DEFAULTS_FILE: path.join(base, 'game-defaults.json'), RS3_PACKS_DIR: path.join(absent, 'packs'),
    RS3_PACK_SELECTION: path.join(absent, 'selection.json'), RS3_MAP_ASSETS_DIR: path.join(absent, 'map'),
    RS3_GAME_DATA_DIR: path.join(absent, 'game') });
  await milestone('entry-verified', { runtime: process.version, workerMode: 'process' });
  operationCode='r135-provider-load';const { resolveDataset } = await import(path.join(root, 'app/datasets.mjs'));
  const dataset = await resolveDataset({ root, datasetId: 'duo-legacy', packsDir: path.join(absent, 'packs'),
    selection: { schemaVersion: 1, data: null }, mapAssetsDir: path.join(absent, 'map'), gameDataDir: path.join(absent, 'game'),
    legacyMetadataFiles: {}, legacyMetadataMapAssetsDir: null });
  if (root.endsWith('/A')) assert.equal(dataset.digest,'3cbb39538d6d5c50cc04308a709771af2fbf23bd0da56499e076645b2be9a5c9');
  assert.equal(dataset.files.length, 94, 'public manifest input count');
  report.provider = { status: dataset.status(), capabilities: dataset.capabilities, files: dataset.files };
  await milestone('public-provider-verified');
  operationCode='r135-fixture-import';const { startServer } = await import(path.join(root, 'app/server.mjs'));
  const { importLegacyMaps } = await import(path.join(root, 'app/core/state.mjs'));
  const fixture = JSON.parse(await readFile(path.join(base, 'fixture.json'), 'utf8'));
  const initialState = importLegacyMaps(fixture.document, { members: fixture.members, capturedAt: '2026-01-01T00:00:00.000Z' }).state;
  initialState.rules = { ...initialState.rules, ...fixture.rules };
  operationCode='r135-server-create';const createAt=performance.now(),startupCPU=process.cpuUsage(),startupMemory=process.memoryUsage();
  early = await startServer({ dataset, dataDir: path.join(out, 'store'), initialState, host: '127.0.0.1', port: 0,
    mapAssetsDir: path.join(absent, 'map'), terrainAssetsDir: path.join(absent, 'terrain'), iconAssetsDir: path.join(absent, 'icons'),
    gameDataDir: path.join(absent, 'game'), worldImagesRoot: path.join(absent, 'world'), packsDir: path.join(absent, 'packs'),
    packSelection: path.join(absent, 'selection.json'), privateAddonOptions: {} });
  if (abort.signal.aborted) throw new Error('controller deadline/interruption before application readiness');
  assert.ok(early.server.listening); await milestone('normal-early-listener-bound');
  operationCode='r135-server-ready';app = await early.ready;report.createToReadyMs=performance.now()-createAt;report.startupCPU=process.cpuUsage(startupCPU);report.startupMemory={before:startupMemory,after:process.memoryUsage()};
  const state = app.store.getState(), revision = app.store.getInfo().revision;
  report.dimensions = { tasks: state.tasks.length, aliases: Object.keys(state.identityRegistry?.aliases ?? {}).length,
    worldChunks: app.world.chunks.size, migration: state.legacy?.gameplayMigration?.schemaVersion, members: state.members.length, revision };
  assert.deepEqual(report.dimensions, { tasks: 23935, aliases: 91471, worldChunks: 2594, migration: 2, members: 2, revision: 0 });
  report.startupTimingMs = app.getStartupTimingMs();
  await milestone('normal-application-ready');
  operationCode='r135-auth-request';const join = await fetch(early.inviteUrl, { redirect: 'manual', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
  await join.arrayBuffer(); assert.equal(join.status, 303); cookie = join.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  await milestone('auth-complete');
  const route = '/api/chunk-planning?memberId=alpha&chunkId=12849';
  operationCode='r135-first-request';const first = await request('first-planning', route); planning(first, revision);assert.equal(first.body.cache?.hit,false);
  await milestone('first-planning-body-complete', { revision });
  operationCode='r135-warm-readiness';const health = await request('health-after-first', '/api/health', 1024**2, 5000);
  assert.equal(health.body.ready, true, 'public health ready after actual first response');
  const warmDeadline = Math.min(entry + 110000, performance.now() + 20000); let diagnostic;
  for (let index = 0; ; index++) {
    diagnostic = (await request('diagnostics-' + index, '/api/diagnostics', 1024**2, 5000)).body;
    const status = diagnostic.startupWarmup?.status;
    if (status === 'ready') { report.warmupControl = { status: 'PROVEN-READY', diagnosticsIndex: index }; break; }
    if (!['pending', 'running'].includes(status) || performance.now() >= warmDeadline) {
      report.warmupControl = { status: 'SKIPPED', observedStatus: status ?? null, reason: 'completion not proven within frozen20s bound' }; break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (report.warmupControl.status === 'PROVEN-READY') {
    assert.equal(app.store.getInfo().revision, revision, 'same-input revision');
    operationCode='r135-warm-request';const control = await request('completed-warmup-planning', route); planning(control, revision);
    assert.equal(JSON.stringify(control.body.rows),JSON.stringify(first.body.rows));assert.equal(control.body.cache?.hit,true);
    report.warmupControl.responseCaptured = true;
  }
  await milestone('probe-complete');
} catch (error) { report.firstFailure=remember(error);failed = true; report.failure = redact(error.stack ?? error); }
finally {
  try { operationCode='r135-app-close';await close(); await milestone('normal-close-complete'); await new Promise(resolve => setTimeout(resolve, 1000)); await milestone('post-close-1s-outside-endpoint'); }
  catch (error) { report.firstFailure=remember(error);failed = true; report.cleanupFailure = redact(error.stack ?? error); }
  clearTimeout(timer); report.exitCPU=process.cpuUsage();report.exitMemory=process.memoryUsage();report.status = failed ? 'FAILED/INCONCLUSIVE' : 'FEASIBLE-HTTP-ONLY'; await save(); process.exitCode = failed ? 1 : 0;
}
