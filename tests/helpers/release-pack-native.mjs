// Authentic packed server/store/worker startup, separate from the tiny protocol
// adapters. Each release has its own entrypoints; pack payloads are
// generated synthetic data, never downloaded or taken from an operator save.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { bindingBytes, checkPackTransition, saveIdentity } from '../../scripts/private-companion/release-pack-check.mjs';
import { hashTree } from '../../scripts/private-companion/release-identity.mjs';
import { put, pin, hash, cleanupFixture, retainFixture } from './release-pack-fixture.mjs';

export async function assertNativePackedStartup(t, target) {
  const started = performance.now();
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-native-owned-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url)), data = path.join(root, 'store');
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  t.after(async () => { await completed; await cleanupFixture(t, root); });
  try {
    const { writeScaledCompanion } = await import('../../scripts/perf/scale-dataset.mjs');
    const { createGroupState } = await import('../../app/core/state.mjs');
    const { openStore } = await import('../../app/storage/store.mjs');
    const initialState = createGroupState([{ id: 'one', name: 'Synthetic explorer', notes: { '12850': 'Synthetic latest progress' } }]);
    initialState.revision = 17;
    const store = await openStore({ dataDir: data, initialState, retention: false });
    try { assert.equal(store.getState().members[0].id, 'one'); } finally { await store.close(); }
    const before = await saveIdentity(data), configs = [], descriptors = [];
    for (const name of ['old', 'new']) {
      const release = path.join(root, name), core = path.join(release, 'core');
      const made = await writeScaledCompanion(path.join(release, 'inputs'), { scale: 1, seed: 1, version: '1.0.0-' + name });
      // Production code is read-only within this owned checkout. Each probe has
      // a fresh module process and a unique release/pack root; no factories,
      // storage or scheduler behavior are substituted by these re-exports.
      for (const module of ['server.mjs', 'dataset-bootstrap.mjs', 'dataset-pipeline.mjs', 'tasks/identity.mjs', 'plugin-items.mjs']) {
        const url = JSON.stringify(pathToFileURL(path.join(repo, 'app', module)).href);
        await put(path.join(core, 'app', module), module === 'server.mjs' ? `
import assert from 'node:assert/strict';
import {createServer as actual} from ${url};
export async function createServer(options) {
  const app=await actual(options);
  try {
    const state=app.store.getState();
    assert.ok(state.revision>=17,'latest revision was not loaded');
    assert.equal(state.members.find(member=>member.id==='one')?.notes['12850'],'Synthetic latest progress');
    return app;
  } catch(error) { await app.close(); throw error; }
}` : `export * from ${url};`);
      }
      const selection = JSON.parse(await readFile(made.environment.RS3_PACK_SELECTION));
      const descriptor = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: made.digest };
      descriptors.push({ ...descriptor, bindingSha256: hash(bindingBytes(descriptor)) });
      const packs = Object.fromEntries(await Promise.all(Object.entries(selection).filter(([key]) => key !== 'schemaVersion').map(async ([key, value]) =>
        [key, await pin(path.join(made.environment.RS3_PACKS_DIR, value.id, value.version, 'pack.json'))])));
      const config = path.join(release, 'config.json'); configs.push(config);
      await put(config, { coreRoot: core, dataDir: data, nodePath: process.execPath, packsDir: made.environment.RS3_PACKS_DIR,
        selection: await pin(made.environment.RS3_PACK_SELECTION), profile: await pin(made.environment.RS3_DATASET_PROFILE),
        addons: { path: '', sha256: '' }, packs });
    }
    await put(data + '.dataset.json', bindingBytes(descriptors[0]));
    const sourceBinding = await readFile(data + '.dataset.json');
    const selected = target === 'old' ? 0 : 1, other = 1 - selected;
    const plan = { schemaVersion: 1, old: descriptors[selected], new: descriptors[other], oldConfig: await pin(configs[selected]), newConfig: await pin(configs[other]),
      oldBindingBase64: bindingBytes(descriptors[selected]).toString('base64'), newBindingBase64: bindingBytes(descriptors[other]).toString('base64') };
    const frozen = await Promise.all(['old', 'new'].map(name => hashTree(path.join(root, name))));
    const prepared = performance.now();
    const result = await checkPackTransition({ fromConfig: configs[other], toConfig: configs[selected], transition: plan, signal:t.signal });
    if (result.retainedScratchDirectory) retainFixture(root);
    assert.equal(result.rollbackTargetOpened, true);
    assert.equal(result.probes.length, 1);
    assert.ok(result.probes.every(report => report.tasksServed && report.taskCount > 0));
    assert.deepEqual(await saveIdentity(data), before);
    assert.deepEqual(await readFile(data + '.dataset.json'), sourceBinding);
    assert.deepEqual(await Promise.all(['old', 'new'].map(name => hashTree(path.join(root, name)))), frozen);
    t.diagnostic(JSON.stringify({ target, preparationMs: Math.round(prepared-started), startupProbeCloseMs: Math.round(performance.now()-prepared) }));
  } catch (error) {
    if (error.retainScratch) retainFixture(root);
    throw error;
  } finally { finish(); }
}
