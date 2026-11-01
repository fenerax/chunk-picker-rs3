// Owned synthetic server. No save/source argument is accepted by this helper.
import { pathToFileURL } from 'node:url';
import { readFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
if (!process.send || !process.env.RS3_STACK_SCRATCH || process.env.RS3_DATASET !== 'open-f2p') throw new Error('Use profile-stack.mjs');
const root = process.env.RS3_STACK_ROOT;
const profile = process.env.RS3_PROFILE === '1' ? await import(pathToFileURL(path.join(root, 'app/profile-spans.mjs'))) : undefined;
if (profile) {
  const probe = path.join(process.env.RS3_STACK_SCRATCH, 'io-probe');
  const handle = await open(probe, 'wx');
  // Same FileHandle observer boundary used by server-routes: asynchronous write
  // and fsync waits, without collecting filenames, bytes or contents.
  profile.wrapMethods(Object.getPrototypeOf(handle), ['writeFile', 'write', 'sync', 'datasync'], 'save.io');
  await handle.close(); await unlink(probe);
}
const { createGroupState } = await import(pathToFileURL(path.join(root, 'app/core/state.mjs')));
const { createServer } = await import(pathToFileURL(path.join(root, 'app/server.mjs')));
const batch = JSON.parse(await readFile(path.join(root, 'app/datasets/open-f2p/wiki-derived/dataset.json')));
const start = batch.cells.find(cell => cell.name === 'Lumbridge').id;
const initialState = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: [start], preferences: { showTaskHow: true } },
  { id: 'player2', name: 'Player 2', unlocked: [start] }]);
let app;
try {
  app = await createServer({ initialState, dataDir: path.join(process.env.RS3_STACK_SCRATCH, 'save'), port: 0, host: '127.0.0.1',
    loopbackPort: undefined, publicOrigin: undefined, predictionPrewarm: false, random: () => 0.25 });
  await app.listen();
  process.send({ type: 'ready', inviteUrl: app.inviteUrl });
  process.on('message', async m => {
    try {
      if (m.action === 'revision') process.send({ reply: m.id, revision: app.store.getInfo().revision });
      else if (m.action === 'clock') process.send({ reply: m.id, clock: Number(process.hrtime.bigint()) / 1e6 });
      else if (m.action === 'stop-server') { await app.close(); process.send({ reply: m.id }, () => process.exit(0)); }
      else { await profile?.scenarioControl(m.action, m.scenario); process.send({ reply: m.id, rssBytes: process.memoryUsage().rss }); }
    } catch { process.send({ reply: m.id, error: 'Profile control failed' }); }
  });
  process.once('disconnect', async () => { await app.close(); process.exit(0); });
} catch (error) {
  // Synthetic-only errors; do not print invite URL or credentials.
  process.send({ type: 'error', message: error.code ?? error.name }); await app?.close(); process.exit(1);
}
