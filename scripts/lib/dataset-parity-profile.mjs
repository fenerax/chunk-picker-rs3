import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(normalize(value))).digest('hex');
let failureStage = 'initialization';
let safeFailure = {};
function normalize(value, parent = '') {
  if (Array.isArray(value)) return value.map(row => normalize(row));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !(parent === 'metrics' && key === 'elapsedMs') && key !== 'timingMs'
    && !(parent === 'cache' && ['evaluationMs', 'requestMs'].includes(key))).map(key => [key, normalize(value[key], key)]));
}
async function saveHashes(directory, relative = '') {
  const rows = {};
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    // Gameplay bytes only; authentication and operator telemetry are separate.
    if (!relative && ['access-token', 'store.lock', 'invites.json', 'usage.json', 'feedback.json'].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Scratch save has a link.');
    if (entry.isDirectory()) Object.assign(rows, await saveHashes(directory, name));
    else if (entry.isFile()) rows[name] = hash(await readFile(path.join(directory, name)));
  }
  return rows;
}
async function freePort() {
  for (let port = 8900; port <= 8999; port++) {
    const probe = net.createServer();
    const available = await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
    if (available) return port;
  }
  throw new Error('No free parity port in 8900–8999.');
}
async function main() {
  if (!process.env.RS3_HEAVY_LOCK_TOKEN) throw new Error('Heavy lock required.');
  const directory = process.argv[2], before = await saveHashes(directory);
  const diskBefore = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
  const stateBefore = diskBefore.state ?? diskBefore;
  const legacyReference = diskBefore.storage?.fields?.legacy;
  if (legacyReference) {
    if (!/^static-[a-f0-9]{64}\.json\.gz$/.test(legacyReference.id)) throw new Error('Invalid disposable static reference.');
    const bytes = gunzipSync(await readFile(path.join(directory, 'static', legacyReference.id)));
    if (hash(bytes) !== legacyReference.sha256) throw new Error('Invalid disposable static checksum.');
    stateBefore.legacy = JSON.parse(bytes);
  }
  const { createServer } = await import('../../app/server.mjs');
  const { createRuleRegistry, evaluateRollPool } = await import('../../app/core/rules.mjs');
  const { evaluateTransportRoutes } = await import('../../app/core/transport-access.mjs');
  const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
  let app;
  try {
    failureStage = 'server-startup';
    app = await createServer({ dataDir: directory, port: await freePort(), host: '127.0.0.1', predictionPrewarm: false,
      now: () => new Date(process.env.RS3_PARITY_INSTANT ?? '2026-10-13T12:00:00.000Z'), random: () => 0.375, idleMemoryOptions: { delayMs: 60000 } });
    await app.listen();
    const origin = `http://127.0.0.1:${app.address().port}`;
    const headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
    const request = async (route, body) => {
      let response;
      try {
        response = await fetch(origin + route, { headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch(error) {
        safeFailure = { code: 'FETCH_FAILURE', route: route.split('?')[0],
          ...(typeof error.cause?.code === 'string' && /^[A-Z_]+$/.test(error.cause.code) ? { causeCode: error.cause.code } : {}) };
        throw error;
      }
      if (!response.ok) {
        safeFailure = { code: 'HTTP_STATUS', route: route.split('?')[0], status: response.status };
        throw new Error('Parity request failed.');
      }
      try { return await response.json(); }
      catch(error) {
        safeFailure = { code: 'RESPONSE_BODY_FAILURE', route: route.split('?')[0],
          ...(typeof error.cause?.code === 'string' && /^[A-Z_]+$/.test(error.cause.code) ? { causeCode: error.cause.code } : {}) };
        throw error;
      }
    };
    const hashes = {}, counts = {};
    failureStage = 'task-and-access-comparison';
    const state = app.store.getState();
    hashes.aliases = hash(state.identityRegistry); hashes.savedRules = hash({ shared: state.rules, personal: state.members.map(member => member.taskRules) });
    const registry = createRuleRegistry();
    for (let position = 0; position < state.members.length; position++) {
      failureStage = 'task-http-request';
      const member = state.members[position], result = await request(`/api/tasks?memberId=${encodeURIComponent(member.id)}`);
      failureStage = 'task-and-access-comparison';
      hashes[`member${position}.fullTasks`] = hash(result);
      for (const key of ['access', 'obligationAccess', 'items', 'ownItems', 'ownItemOrigins', 'equipment', 'training', 'partnerConnections']) hashes[`member${position}.${key}`] = hash(result[key] ?? null);
      hashes[`member${position}.taskOrder`] = hash((result.tasks ?? []).map(task => [task.id, task.status]));
      hashes[`member${position}.rollPool`] = hash(evaluateRollPool(app.world, state, member.id, registry));
      hashes[`member${position}.transport`] = hash(evaluateTransportRoutes(app.world, state, member.id));
      counts[`member${position}.tasks`] = result.tasks?.length ?? 0;
      failureStage = 'training-plans';
      for (const skill of ['Mining', 'Woodcutting', 'Fishing']) {
        const query = new URLSearchParams({ memberId: member.id, skill, fromLevel: '1', targetLevel: '10', preference: 'best-xp' });
        hashes[`member${position}.plan.${skill}`] = hash(await request(`/api/training-plan?${query}`));
      }
      failureStage = 'task-and-access-comparison';
    }
    failureStage = 'api-catalogues';
    for (const route of ['/api/rules', '/api/definitions', '/api/task-map', '/api/map-info', '/api/npcs-and-shops', '/api/archaeology-catalogue', '/api/interior-maps', '/api/training-catalogue', '/api/house-storage-catalogue', '/api/skill-guide-catalogue']) hashes[route] = hash(await request(route));
    const runtime = await request('/api/dataset-runtime');
    hashes.browserRuntimeContract = hash({ schemaVersion: runtime.schemaVersion, capabilities: runtime.capabilities, values: runtime.values });
    const { version, ...commonStatus } = runtime.dataset;
    hashes.browserDatasetStatus = hash(commonStatus);
    failureStage = 'browser-catalogues';
    const browserRoutes = new Set(['/rules-model.mjs', '/data/settings.mjs', '/data/identity-registry.mjs', '/gallery-fixture-data.json',
      ...selectedDataset.files.filter(file => file.kind === 'input' && file.path.startsWith('app/data/') && file.path.endsWith('.json')).map(file => file.path.slice('app'.length)),
      ...selectedDataset.files.filter(file => file.path.startsWith('local-map/')).map(file => '/assets/map/' + file.path.slice('local-map/'.length)),
    ]);
    for (const route of browserRoutes) {
      const response = await fetch(origin + route, { headers });
      if (!response.ok) throw new Error('Browser catalogue request failed.');
      hashes[`browser:${route}`] = hash(Buffer.from(await response.arrayBuffer()));
    }
    failureStage = 'read-only-save-byte-check';
    const afterRead = await saveHashes(directory);
    const readOnlyChecks = { revisionBefore: stateBefore.revision, revisionAfter: app.store.getInfo().revision,
      gameplayMigrationBefore: hash(stateBefore.legacy?.gameplayMigration ?? null),
      gameplayMigrationAfter: hash(app.store.getState().legacy?.gameplayMigration ?? null) };
    const readOnlyUnchanged = hash(before) === hash(afterRead) && readOnlyChecks.revisionBefore === readOnlyChecks.revisionAfter
      && readOnlyChecks.gameplayMigrationBefore === readOnlyChecks.gameplayMigrationAfter;
    if (!readOnlyUnchanged) {
      safeFailure = { code: 'READ_ONLY_CHANGED', changedRelativeFiles: [...new Set([...Object.keys(before), ...Object.keys(afterRead)])]
        .filter(key => before[key] !== afterRead[key]).map(key => key.replaceAll('\\', '/')), readOnlyChecks };
      throw new Error('Read-only startup changed gameplay files, migration or revision.');
    }
    failureStage = 'command-history-undo';
    const member = state.members[0], chunkId = member.unlocked[0] ?? [...app.world.chunks.keys()][0], originalNote = member.notes?.[chunkId];
    hashes.commandResult = hash(await request('/api/command', { expectedRevision: state.revision, command: { type: 'set-note', memberId: member.id, chunkId, note: 'Dataset parity disposable note' } }));
    hashes.commandHistory = hash(await request('/api/history'));
    await request('/api/command', { expectedRevision: app.store.getInfo().revision, command: { type: 'undo' } });
    const afterUndo = app.store.getState(), undoRestored = afterUndo.members[0].notes?.[chunkId] === originalNote;
    hashes.undoHistory = hash(await request('/api/history'));
    hashes.undoGameplay = hash({ rules: afterUndo.rules, tasks: afterUndo.tasks, members: afterUndo.members, identityRegistry: afterUndo.identityRegistry });
    hashes.datasetInputs = hash([...selectedDataset.files].sort((a, b) => a.path.localeCompare(b.path, 'en')));
    process.stdout.write(JSON.stringify({ hashes, counts, readOnlyUnchanged, readOnlyChecks, undoRestored, browserDatasetStatus: runtime.dataset, dataset: { digest: selectedDataset.digest, packed: selectedDataset.packed }, memory: { maxRSS: process.resourceUsage().maxRSS } }) + '\n');
  } finally { await app?.close(); }
}
main().catch(error => { process.stdout.write(JSON.stringify({ failureStage, ...safeFailure,
  ...(typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? { errorName: error.name } : {}),
  frames: [...String(error.stack ?? '').matchAll(/[\\/]([A-Za-z0-9_.-]+\.(?:mjs|js)):(\d+):(\d+)/g)]
    .slice(0, 8).map(([, file, line, column]) => ({ file, line: Number(line), column: Number(column) })),
  ...(typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? { errorCode: error.code } : {}) }) + '\n'); process.exitCode = 1; });
