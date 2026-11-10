import { openStore } from '../../app/storage/store.mjs';
import { options, now } from './owned-format2-fixture.mjs';
const [dataDir, catalogueRoot, seam] = process.argv.slice(2);
const ownedFormat2 = { ...options(catalogueRoot), crash: point => { if (point === seam) process.exit(71); } };
const store = await openStore({ dataDir, ownedFormat2, now, retention: false, completionCodec: false });
await store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0);
await store.close();
throw new Error('Synthetic crash seam was not reached.');
