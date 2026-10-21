// Synthetic data only. This fixture uses real HTTP/auth/storage/receipt code;
// the task calculator is a tiny controlled worker, not the private catalogue.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { readFile, realpath } from 'node:fs/promises';
import { createRuntimeDiagnostics } from './fixture-diagnostics.mjs';
import os from 'node:os';
const diagnostics = createRuntimeDiagnostics();
process.once('exit', () => diagnostics.close());
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const stage = (process.env.RS3_LIVE_SWAP_TEST_ROOT || path.join(os.tmpdir(), 'rs3-live-swap-tests'));
const relative = path.relative(await realpath(stage), await realpath(config.dataDir));
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || config.synthetic !== true
  || !Number.isInteger(config.port) || config.port < 18700 || config.port > 18799) throw new Error('Synthetic staged fixture required.');
const { createServer } = await import(pathToFileURL(path.join(config.core, 'app/server.mjs')));
const { createGroupState } = await import(pathToFileURL(path.join(config.core, 'app/core/state.mjs')));
const ids = ['12341', '12342', '12343', '12597', '12598', '12599', '12853', '12854'];
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, {}])), walkableChunks: ids, walkableChunksF2P: ids };
const initialState = createGroupState([{ id: 'one', name: 'Synthetic One', unlocked: ['12341'], selected: ['12342', '12343'] }, { id: 'two', name: 'Synthetic Two', unlocked: ['12597'] }]);
initialState.rules = { 'roll.selected': true, 'roll.adjacent': false, 'roll.neighborMode': 'manual', 'roll.walkable': false };
if (config.historyRows) {
  if (!Number.isInteger(config.historyRows) || config.historyRows < 0 || config.historyRows > 10000) throw new Error('Invalid synthetic shape');
  initialState.revision = config.historyRows;
  initialState.history = Array.from({ length: config.historyRows }, (_, index) => ({ id: `revision-${index + 1}`, revision: index + 1,
    type: 'set-note', at: '2026-10-18T00:00:00.000Z', command: { type: 'set-note', memberId: 'one', chunkId: '12341', note: `Synthetic history ${index} ${'x'.repeat(1400)}` } }));
}
function workerFactory() {
  const worker = new EventEmitter();
  worker.postMessage = message => { if (message.type === 'prepare-rules') queueMicrotask(() => worker.emit('message', { id: message.id, result: { prepared: true } })); };
  worker.terminate = async () => worker.emit('exit', 0);
  queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], compileMs: 0 })); return worker;
}
let app, standby = false, serial = Promise.resolve();
async function start(readOnly, checkpoint) {
  standby = readOnly;
  app = await createServer({ dataDir: config.dataDir, definitions, taskMap: {}, initialState,
    host: '127.0.0.1', port: config.port, loopbackPort: undefined, publicOrigin: undefined,
    gameDataDir: path.join(config.dataDir, 'absent-game'), mapAssetsDir: path.join(config.dataDir, 'absent-map'),
    predictionPrewarm: false, retention: false, shutdownDeadlineMs: 500,
    taskWorkerOptions: { workerFactory, duoWorkerFactory: workerFactory },
    liveSwap: { standby: readOnly, strict: readOnly || Boolean(checkpoint), checkpoint, version: config.version, onActivationTiming: event => diagnostics.phase(event) },
  });
  await app.listen(); return { pid: process.pid, nonce: config.nonce, standby };
}
process.on('message', message => {
  serial = serial.then(async () => {
    try {
      let value;
      if (message.method === 'observe') value = { state: app ? 'owned' : 'stopped', standby, processIdentity: { pid: process.pid, nonce: config.nonce } };
      else if (message.method === 'start') value = await start(message.argument.standby, message.argument.checkpoint);
      else if (message.method === 'freeze') {
        if (config.freezeMaxSaveBytes !== undefined && message.argument?.maxSaveBytes !== config.freezeMaxSaveBytes) throw new Error('FIXTURE_FREEZE_CAP');
        value = await app.freeze(message.argument);
      }
      else if (message.method === 'close') { await app?.close(); app = undefined; value = { closed: true }; }
      else if (message.method === 'activate') {
        const warm = Boolean(app && standby && typeof app.activate === 'function');
        value = await diagnostics.capture('app.activate', async () => {
          if (warm) { await app.activate(message.argument); standby = false; return { pid: process.pid, nonce: config.nonce, standby }; }
          await app?.close(); app = undefined; return start(false, message.argument);
        }, { warm });
      }
      else if (message.method === 'diagnostics') value = diagnostics.snapshot();
      else if (message.method === 'exit') { await app?.close(); process.exit(0); }
      else throw new Error('Unknown fixture method');
      process.send?.({ id: message.id, value });
    } catch (error) { process.send?.({ id: message.id, error: error.code ?? error.message }); }
  });
});
// The persistent test supervisor owns this IPC channel, independently of the
// replaceable controller. Supervisor death closes fixtures rather than orphaning.
process.on('disconnect', () => { void app?.close().finally(() => process.exit()); if (!app) process.exit(); });
process.send?.({ booted: true, nonce: config.nonce });
