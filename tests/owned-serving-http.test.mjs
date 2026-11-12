// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { servingFixture, servingServer, servingRequest, stableResult, profile } from './helpers/owned-serving-fixture.mjs';
import { catalogue } from '../scripts/perf/capacity/model.mjs';
import { loadCapacityOwnedRelease } from '../scripts/perf/capacity/owned-release.mjs';
import { verifyFixture, copyFixture, sealFixture } from '../scripts/perf/capacity/fixture-cache.mjs';
import { buildOwnedBase, verifyOwnedBaseBytes } from '../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../app/storage/owned-base-schema.mjs';
import { retainOwnedServingRelease, verifyOwnedServingConfiguration, selectOwnedServingPicker } from '../app/storage/owned-serving.mjs';
import { createOwnedStorage } from '../app/storage/owned-storage.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';

const cleanups = new WeakMap();
const cleanup = (t, callback) => cleanups.get(t).push(callback);
async function scratch(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'owned-serving-http-'));
  cleanups.set(t, []);
  t.after(async () => {
    try { for (const callback of cleanups.get(t)) await callback(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  return directory;
}
const stateFile = f => path.join(f.directory, 'pickers', f.group.pickerId, 'state.json');
test('tiny real HTTP format-2 commands and plugin 1.0.0 reads equal format 1 across restart', async t => {
  const root = await scratch(t), fixtures = [];
  for (const format of ['format1', 'format2']) {
    const directory = path.join(root, format); await mkdir(directory);
    fixtures.push(await servingFixture(directory, format));
  }
  const apps = [];
  cleanup(t, async () => { for (const app of apps) await app.close(); });
  const request = async (index, route, body, plugin) => {
    const reply = await servingRequest(apps[index], fixtures[index].group, route, body, plugin);
    assert.equal(reply.status, 200, JSON.stringify(reply.value)); return reply.value;
  };
  for (const f of fixtures) { const app = await servingServer(f); apps.push(app); await app.listen(); }
  const equalStates = async () => {
    const states = await Promise.all(apps.map((_, i) => request(i, '/api/state')));
    assert.deepEqual(stableResult(states[1].state), stableResult(states[0].state)); assert.deepEqual(states[1].pools, states[0].pools);
    const play = await Promise.all(apps.map((_, i) => request(i, '/api/state?view=play-v1')));
    assert.deepEqual(stableResult(play[1].state), stableResult(play[0].state));
    return states[0].state;
  };
  let state = await equalStates();
  const commands = [
    { type: 'set-note', memberId: 'owner', chunkId: Object.keys(catalogue(profile.catalogue).chunks)[0], note: 'Synthetic HTTP durable note' },
    { type: 'tick-active-tasks', memberId: 'owner', taskIds: ['rs3:task:capacity-0'] },
    { type: 'undo' },
  ];
  for (const command of commands) {
    const replies = await Promise.all(apps.map((_, i) => request(i, '/api/command', { command, expectedRevision: state.revision })));
    assert.deepEqual(stableResult(replies[1].state), stableResult(replies[0].state));
    state = await equalStates();
  }
  for (const route of ['/api/tasks?memberId=owner', '/api/tasks?memberId=owner&view=play-v1', '/api/history', '/api/plugin/v1/status', '/api/plugin/v1/tasks']) {
    const replies = await Promise.all(apps.map((_, i) => request(i, route, undefined, route.startsWith('/api/plugin/'))));
    assert.deepEqual(stableResult(replies[1]), stableResult(replies[0]), route);
  }
  const report = { v: 1, seq: 1, sentAt: '2026-11-11T12:00:00Z', world: { id: 1, beta: false },
    position: { x: 20, z: 20, floor: 0 }, skills: { MINING: { level: 20, xp: 4470 } } };
  const reports = await Promise.all(apps.map((_, i) => request(i, '/api/plugin/v1/report', report, true)));
  assert.deepEqual(stableResult(reports[1]), stableResult(reports[0]));
  state = await equalStates();
  for (const [i] of fixtures.entries()) {
    const backup = await request(i, '/api/backup');
    const foreign = structuredClone(backup); foreign.state.provenance.dataset.digest = 'a'.repeat(64);
    assert.equal((await servingRequest(apps[i], fixtures[i].group, '/api/restore/preview', { backup: foreign })).status, 422);
    const preview = await request(i, '/api/restore/preview', { backup });
    await request(i, '/api/restore', { backup, expectedRevision: state.revision, previewToken: preview.previewToken });
  }
  state = await equalStates();
  const bytes = await readFile(stateFile(fixtures[1]));
  assert.equal(JSON.parse(bytes).storage.schemaVersion, 2);
  assert.equal(JSON.parse(await readFile(path.join(fixtures[1].directory, 'legacy', 'state.json'))).storage, undefined);
  assert.equal(JSON.parse(await readFile(stateFile(fixtures[0]))).storage, undefined);
  for (const [i, f] of fixtures.entries()) { await apps[i].close(); apps[i] = await servingServer(f); await apps[i].listen(); }
  assert.deepEqual(await equalStates(), state);
  assert.deepEqual(await readFile(stateFile(fixtures[1])), bytes, 'restart performs no normalization save');
  const after = await request(1, '/api/command', { command: { ...commands[0], note: 'Synthetic after restart' }, expectedRevision: state.revision });
  assert.equal(after.state.revision, state.revision + 1);
});

test('format-specific fixture seal refuses relabelling and copied format 2 opens from retained disk inputs', async t => {
  const root = await scratch(t), source = path.join(root, 'source'); await mkdir(source);
  const f = await servingFixture(source);
  assert.equal((await verifyFixture(source, f.profile, selectedDataset.digest)).storageFormat, 'format2');
  await assert.rejects(verifyFixture(source, { ...f.profile, storageFormat: 'format1' }, selectedDataset.digest), /digest mismatch/);
  const destination = path.join(root, 'copy');
  const manifest = await copyFixture(source, destination, f.profile, selectedDataset.digest);
  const app = await servingServer({ ...f, directory: destination, manifest });
  cleanup(t, () => app.close()); await app.listen();
  assert.equal((await servingRequest(app, f.group, '/api/state')).status, 200);
});

test('an existing format-1 owned save is refused when enabled without changing saved bytes', async t => {
  const root = await scratch(t), source = path.join(root, 'release'), flat = path.join(root, 'flat');
  await mkdir(source); await mkdir(flat);
  await servingFixture(source);
  const f = await servingFixture(flat, 'format1'), bytes = await readFile(stateFile(f));
  await assert.rejects(sealFixture(flat, { ...f.manifest, storageFormat: 'format2' }), /physical storage format mismatch/);
  const app = await servingServer(f, { ownedFormat2: await loadCapacityOwnedRelease(source) });
  cleanup(t, () => app.close()); await app.listen();
  assert.equal((await servingRequest(app, f.group, '/api/state')).status, 503);
  assert.deepEqual(await readFile(stateFile(f)), bytes);
});

test('older same-dataset base selects its independently retained manifest and survives HTTP restart', async t => {
  const root = await scratch(t), f = await servingFixture(root), config = await loadCapacityOwnedRelease(root);
  // Normalize the same progress snapshot as the format-1 startup before the
  // storage-only representation change. No revision or History is changed.
  const warm = await servingServer(f); cleanup(t, () => warm.close()); await warm.listen();
  assert.equal((await servingRequest(warm, f.group, '/api/state')).status, 200); await warm.close();
  const current = verifyOwnedBaseBytes(config.releaseBytes, config), old = buildOwnedBase({ dataset: current.dataset, identityRegistry: current.identityRegistry, tasks: [...current.tasks].reverse() });
  const oldRelease = { dataset: old.pin.dataset, manifest: createOwnedBaseManifest([old.pin]), releaseBytes: old.bytes };
  const retained = await retainOwnedServingRelease(oldRelease, { catalogueRoot: config.catalogueRoot, deletionRoots: [path.join(root, 'pickers')] });
  const dataDir = path.dirname(stateFile(f));
  await createOwnedStorage({ ...retained, pickerId: f.group.pickerId }, dataDir).ensurePublished();
  const document = JSON.parse(await readFile(stateFile(f)));
  const oldDocument = { ...document, ...ownedCodec(old.base, old.pin).encode(ownedCodec(current, config.manifest.bases[current.dataset.digest]).decode(document).state) };
  await writeFile(stateFile(f), JSON.stringify(oldDocument));
  config.retainedManifestPaths = [retained.manifestPath];
  const bytes = await readFile(stateFile(f));
  let app;
  cleanup(t, async () => app?.close());
  for (const phase of ['open', 'restart']) {
    app = await servingServer(f, { ownedFormat2: config }); await app.listen();
    const result = await servingRequest(app, f.group, '/api/state'); assert.equal(result.status, 200, phase);
    assert.equal(JSON.parse(await readFile(stateFile(f))).storage.base.sha256, old.pin.sha256);
    assert.deepEqual(await readFile(stateFile(f)), bytes);
    await app.close();
  }
  const verified = await verifyOwnedServingConfiguration({ ...config, retainedManifestPaths: [] }, { dataset: selectedDataset, deletionRoots: [path.join(root, 'pickers')] });
  await assert.rejects(selectOwnedServingPicker(verified, f.group.pickerId, dataDir), /no independently retained/);
});

test('the capacity process wrapper provisions format 2 and reopens durable HTTP commands after replacement', async t => {
  const root = await scratch(t), children = [], profileFile = path.join(root, 'profile.json');
  await writeFile(profileFile, JSON.stringify({ ...profile, storageFormat: 'format2', port: 0, upstreamScenarios: ['ok'] }));
  const launch = mode => {
    const child = fork(fileURLToPath(new URL('../scripts/perf/capacity/server.mjs', import.meta.url)), [root, profileFile, mode, '1', ''],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
    children.push(child); let diagnostic = '';
    child.stderr.on('data', bytes => { diagnostic += bytes; });
    const closed = new Promise(resolve => child.once('exit', code => resolve(code)));
    const ready = new Promise((resolve, reject) => {
      const fail = () => reject(new Error(diagnostic || 'Synthetic capacity server exited before readiness.'));
      child.once('error', reject); child.once('exit', fail);
      child.on('message', message => {
        if (message.type === 'ready' || message.type === 'generated') { child.off('exit', fail); resolve(message); }
        else if (message.type === 'failure') reject(new Error(message.message));
      });
    });
    return { child, ready, closed };
  };
  const stop = async server => {
    if (server.child.connected) server.child.send({ type: 'stop' });
    assert.equal(await server.closed, 0);
  };
  let server;
  cleanup(t, async () => { if (server) await stop(server); });
  const generation = launch('fixture'); await generation.ready; assert.equal(await generation.closed, 0);
  const manifest = JSON.parse(await readFile(path.join(root, 'fixture.json'), 'utf8'));
  assert.equal(manifest.storageFormat, 'format2');
  const fixture = { directory: root, group: manifest.groups[0] };
  const start = async () => {
    server = launch('serve'); const message = await server.ready;
    return { address: () => ({ port: Number(new URL(message.base).port) }) };
  };
  let app = await start();
  let response = await servingRequest(app, fixture.group, '/api/state'); assert.equal(response.status, 200);
  const command = { type: 'set-note', memberId: 'owner', chunkId: Object.keys(catalogue(profile.catalogue).chunks)[0], note: 'Synthetic process restart' };
  response = await servingRequest(app, fixture.group, '/api/command', { command, expectedRevision: response.value.state.revision });
  assert.equal(response.status, 200); const state = response.value.state;
  await stop(server); const bytes = await readFile(stateFile(fixture));
  app = await start();
  response = await servingRequest(app, fixture.group, '/api/state'); assert.equal(response.status, 200);
  assert.deepEqual(response.value.state, state);
  assert.equal((await servingRequest(app, fixture.group, '/api/tasks?memberId=owner')).status, 200);
  assert.equal((await servingRequest(app, fixture.group, '/api/plugin/v1/status', undefined, true)).status, 200);
  assert.equal((await readFile(stateFile(fixture))).equals(bytes), true);
  response = await servingRequest(app, fixture.group, '/api/command', { command: { ...command, note: 'Synthetic replacement writer' }, expectedRevision: state.revision });
  assert.equal(response.status, 200); assert.equal(response.value.state.revision, state.revision + 1);
});
test('enabled HTTP consumers use retirement and current names while stored rows and restored facts stay historical', async t => {
  const root = await scratch(t), f = await servingFixture(root);
  let app = await servingServer(f); cleanup(t, () => app.close()); await app.listen();
  const original = await servingRequest(app, f.group, '/api/state'); assert.equal(original.status, 200);
  await app.close();
  const id = f.manifest.groups[0].taskIds[0], metadata = { retiredIds: [id], names: { [id]: 'Current synthetic catalogue name' } };
  const document = JSON.parse(await readFile(stateFile(f))); document.state.provenance.ownedCatalogue = metadata;
  document.state.members[0].completedTasks = [id];
  await writeFile(stateFile(f), JSON.stringify(document));
  app = await servingServer(f); await app.listen();
  const tasks = await servingRequest(app, f.group, '/api/tasks?memberId=owner'); assert.equal(tasks.status, 200);
  const row = tasks.value.tasks.find(task => task.id === id);
  assert.equal(row.label, metadata.names[id]); assert.equal(row.obligation, false); assert.equal(row.hidden, true);
  const backup = await servingRequest(app, f.group, '/api/backup'); assert.equal(backup.status, 200);
  assert.deepEqual(backup.value.state.tasks, original.value.state.tasks);
  assert.deepEqual(backup.value.state.identityRegistry, original.value.state.identityRegistry);
  assert.deepEqual(backup.value.state.history, original.value.state.history);
  const get = await servingRequest(app, f.group, '/api/state?view=play-v1'); assert.equal(get.status, 200);
  const command = { type: 'set-note', memberId: 'owner', chunkId: Object.keys(catalogue(profile.catalogue).chunks)[0], note: 'Synthetic catalogue reply' };
  const changed = await servingRequest(app, f.group, '/api/command?view=play-v1', { command, expectedRevision: get.value.state.revision });
  assert.equal(changed.status, 200);
  const changedState = mergeCommandState(get.value.state, changed.value);
  assert.deepEqual(changedState.tasks, get.value.state.tasks);
  const conflict = await servingRequest(app, f.group, '/api/command?view=play-v1', { command, expectedRevision: get.value.state.revision });
  assert.equal(conflict.status, 409); assert.match(conflict.value.message, /Revision conflict/);
  assert.deepEqual(conflict.value.state, changedState, 'detached conflict state keeps current labels and retirement flags');
  assert.deepEqual((await servingRequest(app, f.group, '/api/state?view=play-v1')).value.state, changedState);
  const preview = await servingRequest(app, f.group, '/api/restore/preview', { backup: backup.value }); assert.equal(preview.status, 200);
  const restored = await servingRequest(app, f.group, '/api/restore?view=play-v1', { backup: backup.value, expectedRevision: changed.value.state.revision, previewToken: preview.value.previewToken });
  assert.equal(restored.status, 200);
  const restoredDisplay = restored.value.state.tasks.find(task => task.id === id);
  assert.equal(restoredDisplay.label, metadata.names[id]); assert.equal(restoredDisplay.obligation, false);
  const restoredFull = await servingRequest(app, f.group, '/api/state');
  assert.deepEqual(restoredFull.value.state.provenance.ownedCatalogue, metadata);
  await app.close(); app = await servingServer(f); await app.listen();
  assert.equal((await servingRequest(app, f.group, '/api/tasks?memberId=owner')).value.tasks.find(task => task.id === id).label, metadata.names[id]);
});

test('malformed owned metadata refuses HTTP preview and restore without changing bytes or subsequent replies', async t => {
  const root = await scratch(t), f = await servingFixture(root), app = await servingServer(f);
  cleanup(t, () => app.close()); await app.listen();
  const full = await servingRequest(app, f.group, '/api/state'); assert.equal(full.status, 200);
  const before = await readFile(stateFile(f)), play = await servingRequest(app, f.group, '/api/state?view=play-v1');
  const tasks = await servingRequest(app, f.group, '/api/tasks?memberId=owner'); assert.equal(tasks.status, 200);
  const taskFacts = value => { const { cache, ...facts } = value; return stableResult(facts); };
  const backup = await servingRequest(app, f.group, '/api/backup'); assert.equal(backup.status, 200);
  for (const metadata of [{ retiredIds: {} }, { names: { [f.manifest.groups[0].taskIds[0]]: false } }]) {
    const malformed = structuredClone(backup.value); malformed.state.provenance.ownedCatalogue = metadata;
    for (const route of ['/api/restore/preview', '/api/restore?view=play-v1']) {
      const refused = await servingRequest(app, f.group, route, { backup: malformed, expectedRevision: full.value.state.revision });
      assert.equal(refused.status, 422); assert.match(refused.value.message, /Invalid provenance\.ownedCatalogue/);
      assert.deepEqual(await readFile(stateFile(f)), before);
      assert.deepEqual((await servingRequest(app, f.group, '/api/state?view=play-v1')).value, play.value);
      assert.deepEqual(taskFacts((await servingRequest(app, f.group, '/api/tasks?memberId=owner')).value), taskFacts(tasks.value));
    }
  }
});

test('server refuses unverifiable configuration and incompatible codec before group preparation', async t => {
  const root = await scratch(t), f = await servingFixture(root), configuration = await loadCapacityOwnedRelease(root);
  const bytes = await readFile(stateFile(f));
  for (const ownedFormat2 of [true, { ...configuration, releaseBytes: Buffer.from('inconsistent') },
    { ...configuration, manifestPath: path.join(configuration.catalogueRoot, 'absent') }]) {
    await assert.rejects(servingServer(f, { ownedFormat2 }));
    assert.equal((await readFile(stateFile(f))).equals(bytes), true);
  }
  const previous = process.env.RS3_COMPLETION_CODEC; process.env.RS3_COMPLETION_CODEC = '1';
  try { await assert.rejects(servingServer(f), /completionCodec off/); }
  finally { if (previous === undefined) delete process.env.RS3_COMPLETION_CODEC; else process.env.RS3_COMPLETION_CODEC = previous; }
  const off = await servingServer(f, { ownedFormat2: undefined }); cleanup(t, () => off.close()); await off.listen();
  assert.equal((await servingRequest(off, f.group, '/api/state')).status, 503);
  assert.equal((await readFile(stateFile(f))).equals(bytes), true);
});
