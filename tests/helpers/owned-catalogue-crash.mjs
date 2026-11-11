import assert from 'node:assert/strict';
import { openStore } from '../../app/storage/store.mjs';
import { ownedArtifactSource } from '../../app/storage/owned-storage.mjs';
import { fixture, options, now, world as fixtureWorld, taskCatalogue } from './owned-format2-fixture.mjs';
import { rebaseOptions } from './owned-rebase-fixture.mjs';
const [dataDir, catalogueRoot, seam, failure] = process.argv.slice(2);
let armed = false, store;
const ownedFormat2 = { ...(seam === 'catalogue-base-selected' ? rebaseOptions(catalogueRoot).source : options(catalogueRoot)), crash: phase => {
  if (!armed || phase !== seam || phase.endsWith('-releasing') && store.getInfo().revision !== 1) return;
  armed = false;
  if (failure === 'exit') process.exit(71);
  throw Error('Synthetic catalogue interruption');
} };
store = await openStore({ dataDir, ownedFormat2, now, world: { ...fixtureWorld, surface: new Set(fixtureWorld.chunks.keys()) }, taskCatalogue, retention: false, completionCodec: false });
armed = true;
try {
  const storage = ownedArtifactSource(dataDir);
  if (seam === 'catalogue-base-selected') {
    const { target } = rebaseOptions(catalogueRoot);
    await storage.select({ datasetDigest: target.pin.dataset.digest, sha256: target.pin.sha256 });
  } else {
    const work = () => store.command({ type: 'set-note', memberId: 'member-1', chunkId: '100', note: 'Synthetic boundary save' }, 0);
    if (seam.includes('-exclusive-')) await storage.withLease(work, { mode: 'exclusive' }); else await work();
  }
  throw Error('Synthetic crash seam was not reached');
} catch (error) {
  if (failure !== 'throw' || error.message !== 'Synthetic catalogue interruption') throw error;
  if (seam === 'catalogue-base-selected') assert.equal(ownedArtifactSource(dataDir).base.dataset.digest, fixture().pin.dataset.digest);
  await store.close(); process.exitCode = 72;
}
