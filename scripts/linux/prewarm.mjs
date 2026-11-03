// Online preparation from an explicitly captured copy. No server, store,
// listener, credentials, or writes to the copied gameplay inputs.
import path from 'node:path';
import { warmStoreAllowed } from '../../app/tasks/warm-store.mjs';
import { readFile, access, lstat, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { outside } from './files.mjs';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { getPriority, setPriority } from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const identityCommand = promisify(execFile);
export async function serviceIdentity(settings, query = identityCommand) {
  if (settings.service !== 'chunk-picker.service') throw Error('Unknown service.');
  // Query the root-managed unit, never the service-controlled data tree. Use
  // absolute tools and a fixed environment for both systemd and NSS lookups.
  const run = async (command, args) => (await query(command, args, { timeout: 5000, maxBuffer: 4096,
    windowsHide: true, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } })).stdout.trim();
  const rows = (await run('/usr/bin/systemctl', ['show', '--property=User,Group,DynamicUser', '--', settings.service])).split('\n');
  const fields = new Map();
  for (const row of rows) {
    const match = /^(User|Group|DynamicUser)=(.*)$/.exec(row);
    if (!match || fields.has(match[1])) throw Error('Ambiguous service identity.');
    fields.set(match[1], match[2]);
  }
  if (fields.size !== 3 || fields.get('DynamicUser') !== 'no') throw Error('Static service required.');
  let uid, gid;
  if (settings.serviceUid !== undefined || settings.serviceGid !== undefined) {
    ({ serviceUid: uid, serviceGid: gid } = settings);
  } else {
    const lookup = async (database, key, count) => {
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*\$?$/.test(key)) throw Error('Missing service account.');
      const row = (await run('/usr/bin/getent', [database, '--', key])).split(':');
      if (row.length !== count || row.some(value => /[\r\n]/.test(value))) throw Error('Ambiguous service account.');
      return row;
    };
    const account = await lookup('passwd', fields.get('User'), 7);
    uid = /^\d+$/.test(account[2]) ? Number(account[2]) : NaN;
    const group = fields.get('Group');
    const groupId = group ? (await lookup('group', group, 4))[2] : account[3];
    gid = /^\d+$/.test(groupId) ? Number(groupId) : NaN;
  }
  if (![uid, gid].every(id => Number.isSafeInteger(id) && id > 0)) throw Error('Dedicated service identity required.');
  return { uid, gid };
}
// Only the captured, root-created copy may have its permissions changed. Its
// ancestors must prevent replacement; a root-owned sticky ancestor (e.g. /tmp)
// is safe above the private parent. No live-store ownership is consulted.
async function readableSnapshot(settings, dataDir, gid, filesystem) {
  dataDir = path.resolve(dataDir);
  outside(settings.dataDir, dataDir); outside(dataDir, settings.dataDir);
  const parent = path.dirname(dataDir);
  for (let file = dataDir; ; file = path.dirname(file)) {
    const info = await filesystem.lstat(file);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0
      || (info.mode & 0o022) && !(file !== dataDir && file !== parent && (info.mode & 0o1000))) {
      throw Error('Protected root snapshot required.');
    }
    if (file === path.dirname(file)) break;
  }
  const root = await filesystem.open(dataDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  async function share(file, handle, directory) {
    const info = await handle.stat();
    if (info.uid !== 0 || (info.mode & 0o022) || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) {
      throw Error('Unsafe snapshot entry.');
    }
    if (directory) for (const entry of await filesystem.readdir(file, { withFileTypes: true })) {
      const child = path.join(file, entry.name), isDirectory = entry.isDirectory();
      const opened = await filesystem.open(child, constants.O_RDONLY | constants.O_NOFOLLOW | (isDirectory ? constants.O_DIRECTORY : constants.O_NONBLOCK));
      try { await share(child, opened, isDirectory); } finally { await opened.close(); }
    }
    // Descriptor operations only, inside the protected copy. The service never
    // gains write access, and the root-only parent stays inaccessible by path.
    await handle.chown(0, gid); await handle.chmod(directory ? 0o550 : 0o440);
  }
  try { await share(dataDir, root, true); return root; }
  catch (error) { await root.close(); throw error; }
}
export async function prewarmCandidate({ settings, candidate, dataDir, execute = spawn,
  filesystem = { lstat, open, readdir }, queryIdentity = identityCommand, timeoutMs = 180000 }) {
  let snapshot;
  // Old releases remain deployable. This optional preparation never extends
  // the writer pause and cannot turn a failed warm-up into a deployment failure.
  try {
    const script = path.join(candidate.config.coreRoot, 'scripts/linux/prewarm.mjs');
    await access(script);
    const { runtimeEnvironment } = await import('./runtime.mjs');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 180000) return false;
    const options = { env: runtimeEnvironment(candidate.config, { probe: true }), stdio: 'ignore', windowsHide: true,
      ...(process.platform === 'linux' ? { detached: true } : {}) };
    let input = dataDir, guard = [];
    if (process.getuid?.() === 0) {
      if (process.platform !== 'linux') return false;
      const { uid, gid } = await serviceIdentity(settings, queryIdentity);
      snapshot = await readableSnapshot(settings, dataDir, gid, filesystem);
      input = '/proc/self/fd/3';
      // Node/libuv's Unix spawn clears supplementary groups with setgroups(0,
      // NULL) before setgid/setuid. Also fail closed before candidate imports:
      // libuv tolerates EPERM from setgroups on capability-restricted systems.
      Object.assign(options, { uid, gid, stdio: ['ignore', 'ignore', 'ignore', snapshot.fd] });
      options.env.HOME = settings.dataDir;
      const check = `if (process.getuid() !== ${uid} || process.getgid() !== ${gid} || process.getgroups().some(group => group !== ${gid})) process.exit(1);`;
      guard = ['--import', 'data:text/javascript,' + encodeURIComponent(check)];
    }
    return await new Promise(resolve => {
      const child = execute(candidate.config.nodePath ?? process.execPath, [...guard, script, '--root', candidate.config.coreRoot,
        '--data-dir', input, '--warm-dir', path.join(settings.dataDir, 'warm-store')], options);
      try { if (Number.isSafeInteger(child.pid)) setPriority(child.pid, Math.max(10, getPriority(child.pid))); } catch { /* Best-effort OS priority; bounded calculator remains optional. */ }
      let timedOut = false, finished = false, terminationTimer, groupTimer;
      const hasGroup = options.detached && Number.isSafeInteger(child.pid) && child.pid > 0;
      const killTree = () => {
        try {
          if (hasGroup) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* Already exited or unavailable; still an optional miss. */ }
      };
      const finish = result => {
        if (finished) return;
        finished = true; clearTimeout(timer); clearTimeout(terminationTimer); clearTimeout(groupTimer); resolve(result);
      };
      // Reserve termination time inside the outer budget (175s work + 5s
      // cleanup by default). A stopped calculator cannot defer SIGKILL.
      const terminationMs = Math.min(5000, Math.floor(timeoutMs / 10));
      const timer = setTimeout(() => {
        timedOut = true;
        terminationTimer = setTimeout(() => finish(false), terminationMs);
        killTree();
      }, timeoutMs - terminationMs);
      child.once('error', () => {
        if (finished) return;
        timedOut = true;
        if (Number.isSafeInteger(child.pid) && child.pid > 0) killTree();
        finish(false);
      });
      child.once('close', code => {
        if (finished) return;
        // Also remove descendants left behind by an early parent exit.
        if (hasGroup) killTree();
        if (timedOut && hasGroup) {
          const waitForGroup = () => {
            try { process.kill(-child.pid, 0); }
            catch (error) { if (error.code === 'ESRCH') { finish(false); return; } }
            groupTimer = setTimeout(waitForGroup, 20);
          };
          waitForGroup();
        } else finish(!timedOut && code === 0);
      });
    });
  } catch { return false; }
  finally { try { await snapshot?.close(); } catch { /* Optional descriptor cleanup. */ } }
}

export async function prewarmCalculation({ root, dataDir, warmDirectory, maxMembers = 8 }) {
  if (!warmStoreAllowed()) return false;
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 1 || maxMembers > 8) throw Error('Invalid warm bound.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 20) throw Error('Unsupported Node.');
  const load = file => import(pathToFileURL(path.join(root, file)));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, rules, core, codec, { ProcessWorker }, preparation, reuse] = await Promise.all([
    load('app/dataset-runtime.mjs'), load('app/dataset-bootstrap.mjs'), load('app/dataset-pipeline.mjs'), load('app/data/world.mjs'),
    load('app/core/rules.mjs'), load('app/core/state.mjs'), load('app/storage/completion-codec.mjs'), load('app/tasks/process-worker.mjs'),
    load('app/tasks/prepared-collection.mjs'), load('app/tasks/unlock-reuse.mjs')]);
  const document = codec.decodeCompletionDocument(JSON.parse(await readFile(path.join(dataDir, 'state.json'))));
  for (const [key, reference] of Object.entries(document.storage?.fields ?? {})) {
    if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || Object.hasOwn(document.state, key)
      || !/^[a-f0-9]{64}$/.test(reference.sha256) || reference.id !== `static-${reference.sha256}.json.gz`) throw Error('Invalid copied reference.');
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'static', reference.id)));
    if (sha(bytes) !== reference.sha256) throw Error('Copied reference mismatch.');
    document.state[key] = JSON.parse(bytes);
  }
  const full = core.importBackup(document, rules.createRuleRegistry());
  const { provenance, history, taskClaims, progressSnapshots, finishLine, groupGoals, ruleReviews, ...state } = full;
  const randomStarts = full.members.filter(member => core.hasRandomStartChoices(full, member)).map(member => [member.id, member.pendingRoll]);
  state.history = randomStarts.length ? history : [];
  const fingerprint = reuse.createTaskReuseFingerprint()(state);
  const input = randomStarts.length ? sha(JSON.stringify([fingerprint, randomStarts])) : fingerprint;
  const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
  const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
  const world = buildWorld(definitions, { dataset, reviewedOverlays: true });
  const rollInput = rules.createRollPoolCache(world, rules.createRuleRegistry(), { inputKey: reuse.createTaskReuseFingerprint() }).input(state);
  const bytes = Buffer.from(JSON.stringify(definitions)), shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
  const data = { definitionBytes: shared, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions: { reviewedOverlays: true }, preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
    world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules: [], warmStoreDirectory: warmDirectory };
  const prepared = preparation.createWorkerPreparation(data, { persistentDirectory: warmDirectory });
  let worker, sequence = 0;
  const started = performance.now();
  const request = (type, memberId, extra = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { clean(); reject(Error('Warm timeout.')); }, 120000);
    function clean() { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); worker.off('exit', fail); }
    function fail() { clean(); reject(Error('Warm worker unavailable.')); }
    function receive(message) {
      if (message.id !== id || ['progress', 'prediction-prepared'].includes(message.type)) return;
      clean(); message.error ? reject(Error('Warm calculation unavailable.')) : resolve(message);
    }
    worker.on('message', receive); worker.once('error', fail); worker.once('exit', fail);
    worker.postMessage({ id, type, state, memberId, input: type === 'roll-pool' ? rollInput : input, ...extra });
  });
  try {
    worker = new ProcessWorker(prepared.input());
    const [ready] = await once(worker, 'message');
    if (ready.type !== 'ready') throw Error('Warm startup unavailable.');
    prepared.accept(ready); await prepared.settled();
    for (const member of state.members.slice(0, maxMembers)) {
      await request('evaluate', member.id, { resultTransport: 'json-shared-v1' });
      for (const projection of [{}, { duoSidebarProjection: true }, { duoProjection: true }]) await request('evaluate', member.id,
        { resultTransport: 'json-shared-v1', resultView: 'play-v1', ...projection });
      const pool = await request('roll-pool', member.id);
      const eligible = pool.result.pool.eligible.map(row => row.id);
      const chunkId = [...member.pendingRoll, ...member.selected, eligible[0]].find(id => eligible.includes(id));
      if (chunkId) await request('predict', member.id, { chunkId, predictionProgress: true, previewProgress: true });
    }
    return { members: Math.min(state.members.length, maxMembers), requests: sequence, durationMs: performance.now() - started };
  } finally { await worker?.terminate(); await prepared.clear(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    registerHooks({ load(url, context, next) {
      if (['/app/server.mjs', '/app/storage/store.mjs', '/app/picker-context.mjs'].some(suffix => url.endsWith(suffix))) throw Error('Forbidden warm import.');
      return next(url, context);
    } });
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'data-dir': { type: 'string' }, 'warm-dir': { type: 'string' } } });
    const result = await prewarmCalculation({ root: path.resolve(values.root), dataDir: path.resolve(values['data-dir']), warmDirectory: path.resolve(values['warm-dir']) });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch { process.stderr.write('Calculator preparation unavailable.\n'); process.exitCode = 1; }
}
