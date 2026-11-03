// Real-pack CPU-profile overhead, with no server/store or credentials. Inputs
// must be a /tmp copy; output contains numeric metadata and canonical hashes.
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { canonical } from '../../tools/calc-check/compare.mjs';
import { createDeepProfiles } from '../../app/deep-profiles.mjs';
const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, out: { type: 'string' }, trial: { type: 'string' } } });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw new Error('NodeVersionError');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shared = value => { const bytes = Buffer.from(JSON.stringify(value)), buffer = new SharedArrayBuffer(bytes.length); Buffer.from(buffer).set(bytes); return buffer; };
const memory = (pid, field) => Number(new RegExp(`^${field}:\\s+(\\d+)`, 'm').exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) * 1024;
registerHooks({ load(url, context, next) {
  if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw new Error('ForbiddenImport');
  return next(url, context);
} });
async function trial(mode) {
  const inputDir = await realpath(values['data-dir']);
  if (!inputDir.startsWith('/tmp/') || !values.out?.startsWith('/tmp/') || !['off', 'on'].includes(mode)) throw new Error('OptionsError');
  const outputDir = await realpath(values.out);
  if (!outputDir.startsWith('/tmp/') || outputDir === inputDir || outputDir.startsWith(inputDir + path.sep)) throw new Error('OptionsError');
  const [{ selectedDataset: dataset }, { loadDatasetInputs }, pipeline, { buildWorld }, { createRuleRegistry }, core, codec, { ProcessWorker }] = await Promise.all([
    import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'), import('../../app/data/world.mjs'),
    import('../../app/core/rules.mjs'), import('../../app/core/state.mjs'), import('../../app/storage/completion-codec.mjs'), import('../../app/tasks/process-worker.mjs'),
  ]);
  const source = await readFile(path.join(inputDir, 'state.json')), document = codec.decodeCompletionDocument(JSON.parse(source));
  if (document.storage) {
    if (document.storage.schemaVersion !== 1 || Object.keys(document.storage).some(key => !['schemaVersion', 'fields'].includes(key))) throw new Error('StorageError');
    const staticRoot = await realpath(path.join(inputDir, 'static'));
    for (const [key, ref] of Object.entries(document.storage.fields)) {
      if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key) || ref.id !== `static-${ref.sha256}.json.gz` || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error('ReferenceError');
      const file = await realpath(path.join(staticRoot, ref.id)); if (path.dirname(file) !== staticRoot) throw new Error('ReferenceError');
      const bytes = gunzipSync(await readFile(file)); if (sha(bytes) !== ref.sha256) throw new Error('ChecksumError'); document.state[key] = JSON.parse(bytes);
    }
  }
  const full = core.importBackup(document, createRuleRegistry());
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = full;
  state.history = full.members.some(member => core.hasRandomStartChoices(full, member)) ? history : [];
  const loaded = await loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset), world = buildWorld(definitions, { dataset });
  let worker, profiles, sequence = 0;
  function request(message) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('TimeoutError')); }, 180000);
      const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); };
      const fail = () => { cleanup(); reject(new Error('WorkerError')); };
      const receive = reply => { if (reply.id !== id || ['progress', 'prediction-prepared'].includes(reply.type)) return; cleanup(); reply.error ? reject(new Error('RequestError')) : resolve(reply); };
      worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail); worker.postMessage({ id, ...message });
    });
  }
  try {
    const started = performance.now();
    worker = new ProcessWorker({ definitionBytes: shared(definitions), datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
      preparedDatasetStages: pipeline.preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [] });
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const report = { mode, startupMs: performance.now() - started, sourceHash: sha(source), datasetHash: dataset.digest, requests: {}, resultHashes: {}, resultCounts: {} };
    if (mode === 'on') { profiles = await createDeepProfiles(values.out); profiles.attach(worker); await profiles.start(600); }
    const input = sha(JSON.stringify(state)), snapshotKey = JSON.stringify([state.revision, input]), stateJSON = shared(state);
    for (let member = 0; member < state.members.length; member++) for (const temperature of ['cold', 'warm']) {
      const message = { type: 'evaluate', memberId: state.members[member].id, input, snapshotKey, resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true,
        ...(sequence ? {} : { stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: stateJSON.byteLength, stateRevision: state.revision, stateMemberIds: state.members.map(owner => owner.id) }) };
      const start = performance.now(), reply = await request(message), key = `tasks-${member}-${temperature}`;
      report.requests[key] = { wallMs: performance.now() - start, evaluationMs: reply.evaluationMs };
      const decoded = {};
      for (const field of ['playJSON', 'duoJSON', 'duoSidebarJSON', 'resultJSON']) if (reply[field]) decoded[field] = JSON.parse(Buffer.from(reply[field]));
      report.resultHashes[key] = sha(JSON.stringify(canonical(decoded)));
      report.resultCounts[key] = Object.values(decoded).reduce((sum, result) => sum + (result.tasks?.length ?? 0), 0);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    report.idleRSS = { parent: memory(process.pid, 'VmRSS'), worker: memory(worker.pid, 'VmRSS') };
    report.peakRSS = { parent: memory(process.pid, 'VmHWM'), worker: memory(worker.pid, 'VmHWM') };
    await profiles?.close(); const files = await profiles?.list() ?? [];
    report.capture = { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), failures: profiles?.status().failures ?? 0 };
    return report;
  } finally { await profiles?.close(); await worker?.terminate(); }
}
try {
  if (values.trial) console.log(JSON.stringify(await trial(values.trial)));
  else {
    if (!values.out?.startsWith('/tmp/')) throw new Error('OptionsError'); await mkdir(values.out, { recursive: true });
    const outputRoot = await realpath(values.out), inputRoot = await realpath(values['data-dir']);
    if (!outputRoot.startsWith('/tmp/') || outputRoot === inputRoot || outputRoot.startsWith(inputRoot + path.sep)) throw new Error('OptionsError');
    const trials = [];
    for (let run = 0; run < 5; run++) for (const mode of ['off', 'on']) {
      const output = path.join(values.out, `${run}-${mode}`); await mkdir(output);
      const report = await new Promise((resolve, reject) => {
        const child = fork(new URL(import.meta.url), ['--trial', mode, '--data-dir', values['data-dir'], '--out', output], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        let stdout = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.resume(); child.once('error', reject);
        child.once('exit', code => { if (code !== 0) { reject(new Error('TrialError')); return; } try { resolve(JSON.parse(stdout)); } catch { reject(new Error('TrialError')); } });
      });
      trials.push(report); await writeFile(path.join(values.out, 'measurements.json'), JSON.stringify({ node: process.version, trials }, null, 2)); console.error(JSON.stringify({ completed: trials.length }));
    }
  }
} catch (error) { console.error(JSON.stringify({ error: error.name, code: ['OptionsError', 'StorageError', 'ReferenceError', 'ChecksumError', 'TimeoutError', 'WorkerError', 'RequestError', 'TrialError'].includes(error.message) ? error.message : 'ProfileMeasurementError' })); process.exitCode = 1; }
