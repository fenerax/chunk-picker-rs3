import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openStore } from '../../app/storage/store.mjs';
import { fixture, options, commands, now, world, taskCatalogue } from './owned-format2-fixture.mjs';

export const settingsForStore = { now, world, taskCatalogue, completionCodec: false, random: () => 0, retention: false };
export const stopped = { state: async () => ({ stopped: true }) };
export async function inflaterFixture(t, { populated = false, second = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-inflater-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'),
    multiPicker: { pickerRoot: path.join(root, 'pickers'), registryDir: path.join(root, 'registry'), tombstoneDir: path.join(root, 'tombstones') } };
  for (const dir of [settings.dataDir, settings.controlDir, ...Object.values(settings.multiPicker)]) await mkdir(dir);
  const ownedFormat2 = options(path.join(root, 'catalogue')), ids = ['p_' + '1'.repeat(32), ...(second ? ['p_' + '2'.repeat(32)] : [])];
  const stores = [], flatDir = path.join(root, 'flat');
  for (const dataDir of [flatDir, ...ids.map(id => path.join(settings.multiPicker.pickerRoot, id))]) {
    const owned = dataDir !== flatDir;
    const store = await openStore({ ...settingsForStore, dataDir, initialState: fixture().state,
      ownedFormat2: owned ? { ...ownedFormat2, pickerId: path.basename(dataDir) } : false });
    try {
      if (populated) for (const command of commands) await store.command(command, store.getInfo().revision);
      stores.push({ dataDir, state: (await store.backup()).state });
    } finally { await store.close(); }
  }
  await writeFile(path.join(settings.dataDir, 'state.json'), 'synthetic legacy sentinel\n');
  return { root, settings, ownedFormat2, stores: stores.slice(1), flatDir, controller: stopped };
}
export async function packAndArchive(dataDir) {
  const file = path.join(dataDir, 'state.json'), saved = JSON.parse(await readFile(file)), state = saved.state;
  const history = state.history, id = 'history-0000000000000001-0000000000000007-0000000000000001.json.gz';
  await mkdir(path.join(dataDir, 'history'), { recursive: true });
  await writeFile(path.join(dataDir, 'history', id), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events: history.slice(0, -1) })));
  state.history = history.slice(-1); state.provenance = { ...state.provenance, historyArchive: [{ id }] };
  // Both codecs preserve root key order; provenance already exists in these saves.
  if (saved.storage?.schemaVersion === 2 && !saved.storage.delta.keys.includes('provenance')) saved.storage.delta.keys.push('provenance');
  await writeFile(file, JSON.stringify(saved) + '\n');
  const backups = path.join(dataDir, 'backups'), names = (await readdir(backups)).filter(name => name.endsWith('.json.gz')).sort();
  const snapshots = [];
  for (const [index, name] of names.entries()) {
    const document = gunzipSync(await readFile(path.join(backups, name))).toString();
    snapshots.push({ id: name, document: index % 2 ? JSON.parse(document) : document });
  }
  await mkdir(path.join(backups, 'archives'), { recursive: true });
  await writeFile(path.join(backups, 'archives', 'synthetic.json.gz'), gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-retained-archive', snapshots })));
  // Keep standalone snapshots too: the inflater must visit both representations.
  return snapshots;
}
