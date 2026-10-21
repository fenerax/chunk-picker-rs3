import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

// Exercise the real dispatcher and shutdown queue without opening a listener.
async function request(handler, route, body, key) {
  const bytes = Buffer.from(JSON.stringify(body));
  const incoming = Readable.from([bytes]);
  Object.assign(incoming, { method: 'POST', url: route, socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8959', authorization: `Bearer ${key}`, 'content-type': 'application/json',
      'content-length': String(bytes.length), 'accept-encoding': 'identity' } });
  const chunks = [], headers = new Map();
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.getHeader = name => headers.get(name.toLowerCase());
  response.writeHead = (status, values = {}) => {
    response.statusCode = status; response.headersSent = true;
    for (const [name, value] of Object.entries(values)) response.setHeader(name, value);
    return response;
  };
  await handler(incoming, response);
  return { status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

test('server shutdown drains an accepted achievement command before flushing and closing its sidecar', { timeout: 15000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'picker-plugin-shutdown-'));
  const initialState = createGroupState([{ id: 'a', name: 'Explorer 1' }]);
  initialState.tasks = [{ id: 'diary:one', category: 'Diary', label: '~|Synthetic Achievements#Easy|~ First Task' }];
  let handler, app;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(async () => { release.resolve(); await app?.close(); await rm(dataDir, { recursive: true, force: true }); });
  app = await createServer({ dataDir, dataset: selectedDataset, initialState,
    definitions: { chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'] }, taskMap: {},
    predictionPrewarm: false, privateAddonOptions: { addonPath: '', addonSha256: '' },
    // Explicit isolated roots prevent optional metadata from reading .local.
    mapAssetsDir: path.join(dataDir, 'absent-map'), terrainAssetsDir: path.join(dataDir, 'absent-terrain'),
    iconAssetsDir: path.join(dataDir, 'absent-icons'), gameDataDir: path.join(dataDir, 'absent-game'),
    worldImagesRoot: path.join(dataDir, 'absent-world'), packsDir: path.join(dataDir, 'absent-packs'),
    onRequestHandler: value => { handler = value; },
  });
  assert.equal(app.address(), null);
  const created = await request(handler, '/api/game-plugin/keys', { memberId: 'a', label: 'Synthetic plugin' }, app.store.getAccessToken());
  assert.equal(created.status, 201);
  const command = app.store.command.bind(app.store);
  app.store.command = async (...args) => {
    const saved = await command(...args);
    entered.resolve(); await release.promise;
    return saved;
  };
  const reporting = request(handler, '/api/plugin/v1/report', {
    v: 1, seq: 1, sentAt: '2026-10-21T12:00:00.000Z', world: { id: 1, beta: false }, position: { x: 50, z: 50, floor: 0 },
    achievements: { snapshot: '0123456789abcdef', part: 1, parts: 1, complete: [[1, 'First Task', 0, 0]] },
  }, created.body.key);
  await Promise.race([entered.promise, reporting.then(result => {
    assert.fail(`Report returned before the held command: ${JSON.stringify(result)}`);
  })]);
  const closing = app.close();
  await nextTurn();
  release.resolve();
  assert.equal((await reporting).status, 200);
  await closing;
  assert.deepEqual(app.store.getState().members[0].completedTasks, ['diary:one']);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'plugin-achievements.json'), 'utf8')),
    { v: 1, players: { a: { handled: [1] } } });
});
