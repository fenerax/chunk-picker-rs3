import { openStore } from '../../app/storage/store.mjs';
import { acquireStoreFileLock } from '../../app/storage/store-lock.mjs';
import { createGroupState } from '../../app/core/state.mjs';

const store = await openStore({ dataDir: process.argv[2],
  initialState: createGroupState([{ id: 'owner', name: 'Explorer' }]), retention: false });
if (process.argv[3] === 'file-only') {
  await store.close();
  await acquireStoreFileLock(process.argv[2]);
}
process.send({ ready: true });
setInterval(() => {}, 60_000);
