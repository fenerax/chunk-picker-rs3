import { stageOwnedRebase, reconcileOwnedRebase } from '../../app/storage/owned-rebase.mjs';
import { rebaseOptions } from './owned-rebase-fixture.mjs';
const [dataDir, catalogueRoot, operation, seam] = process.argv.slice(2);
const { source: ownedFormat2, target } = rebaseOptions(catalogueRoot);
await (operation === 'stage' ? stageOwnedRebase : reconcileOwnedRebase)({ dataDir, ownedFormat2, target,
  crash(point) { if (point === seam) process.exit(72); } });
process.exit(73);
