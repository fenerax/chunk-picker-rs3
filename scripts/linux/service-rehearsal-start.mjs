// Dedicated child: all roots and ports have been repinned by service-rehearsal.
import { openApplication } from './runtime.mjs';
import { exists, json } from './files.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
let app;
try {
  const config = await json(process.argv[2]);
  process.env.RS3_SIGNIN = 'off';
  app = await openApplication(config, config.dataDir); await app.ready;
  await app.close(); app = null;
  const { openPluginKeys } = await import(pathToFileURL(path.join(config.coreRoot, 'app/plugin-keys.mjs')).href);
  const document = await json(path.join(config.multiPicker.registryDir, 'registry.json'));
  let verifiedPickers = 0;
  for (const picker of document.pickers.filter(p => p.lifecycle === 'active')) {
    const dataDir = picker.kind === 'legacy-shared' ? config.dataDir : path.join(config.multiPicker.pickerRoot, picker.id);
    if (!await exists(path.join(dataDir, 'state.json'))) continue; // never create post-state sidecars on an uninitialized picker
    const keys = await openPluginKeys({ dataDir });
    try {
      if (keys.list().length) throw Error('Unexpected imported plugin keys.');
      const { key, record } = await keys.create(picker.memberIds[0], 'Synthetic restore rehearsal');
      const request = { headers: { authorization: 'Bearer ' + key } };
      if (keys.authenticate(request).id !== record.id) throw Error('Fresh key failed authentication.');
      await keys.revoke(record.id);
      let refused = false;
      try { keys.authenticate(request); } catch (error) { refused = error.status === 401; }
      if (!refused) throw Error('Revoked rehearsal key remains usable.');
      verifiedPickers++;
    } finally { await keys.close(); }
  }
  process.stdout.write(JSON.stringify({ ready: true, keys: { verifiedPickers, oldKeysAbsent: true, freshKeyRevocation: true } }));
} catch { process.exitCode = 1; }
finally { await app?.close(); }
