// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { releaseFixture } from './helpers/owned-serving-release-fixture.mjs';
import { retainOwnedServingRelease, verifyOwnedServingConfiguration, selectOwnedServingPicker } from '../app/storage/owned-serving.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { openStore } from '../app/storage/store.mjs';

const seams = ['release-bytes-temporary-synced', 'release-bytes-durable', 'release-manifest-temporary-synced', 'release-manifest-durable', 'serving-pin-selected'];
for (const failure of ['exit', 'throw']) for (const seam of seams) test(`${failure} at ${seam} cannot publish a broken serving save`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-serving-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { release, migrateState } = await releaseFixture();
  await writeFile(path.join(root, 'seed.json'), JSON.stringify({ dataset: release.dataset, manifest: release.manifest }));
  await writeFile(path.join(root, 'seed-base.json'), release.releaseBytes);
  let before;
  if (seam === 'serving-pin-selected') {
    const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [path.join(root, 'group')] });
    const state = createGroupState([{ id: 'owner', name: 'Synthetic' }]); state.provenance = { dataset: release.dataset };
    const store = await openStore({ dataDir: path.join(root, 'group'), initialState: migrateState(state, {}), ownedFormat2: { ...config, pickerId: 'synthetic-picker' }, retention: false, completionCodec: false });
    await store.close(); before = await readFile(path.join(root, 'group', 'state.json'));
  }
  const child = fork(fileURLToPath(new URL('./helpers/owned-serving-crash-child.mjs', import.meta.url)), [root, seam, failure], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
  let diagnostic = ''; child.stderr.on('data', bytes => { diagnostic += bytes; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, failure === 'exit' ? 71 : 72, diagnostic);
  if (before) assert.deepEqual(await readFile(path.join(root, 'group', 'state.json')), before);
  else assert(!(await readdir(root)).includes('group'));
  // Explicit offline re-preparation is safe after interruption. Startup never
  // infers trust from a partial publication or creates a substitute manifest.
  const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [path.join(root, 'group')] });
  const verified = await verifyOwnedServingConfiguration(config, { dataset: selectedDataset, deletionRoots: [path.join(root, 'group')] });
  const selected = await selectOwnedServingPicker(verified, 'synthetic-picker', path.join(root, 'group'));
  assert.deepEqual(selected.base.dataset, release.dataset);
  if (before) assert.deepEqual(await readFile(path.join(root, 'group', 'state.json')), before);
});
