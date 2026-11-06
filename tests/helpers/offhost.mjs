import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {encode,exclusive,exists,inventory,json,sha} from '../../scripts/linux/files.mjs';
import {recoveryBundle,recoveryUnits} from '../../scripts/linux/recovery-bundle.mjs';
const base = fileURLToPath(new URL('../../.local/offhost-tests/', import.meta.url));
export async function offhostFixture(t) {
  await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = { controlDir: path.join(dir, 'control'), dataDir: path.join(dir, 'data'), scratchRoot: path.join(dir, 'scratch'),
    backupDir: path.join(dir, 'backups'), current: path.join(dir, 'current.json'), minFreeBytes: 0 };
  const roots = Object.fromEntries(['etc', 'units', 'releases', 'packs', 'tools'].map(name => [name, path.join(dir, name)]));
  for (const directory of [settings.controlDir, settings.backupDir, ...Object.values(roots)]) await mkdir(directory);
  const selected = path.join(roots.releases, 'synthetic'); await mkdir(selected); await mkdir(path.join(selected, 'core'));
  await writeFile(path.join(selected, 'core', 'app.mjs'), 'export {};');
  await writeFile(path.join(roots.etc, 'synthetic-secret'), 'synthetic-only');
  await writeFile(path.join(roots.tools, 'tool.mjs'), 'export {};');
  for (const unit of recoveryUnits) await writeFile(path.join(roots.units, unit), '[Unit]\n');
  const pack = async (name, addon = false) => {
    const root = path.join(roots.packs, name); await mkdir(path.join(root, 'payload'), { recursive: true });
    const files = [];
    for (const name of ['payload/first.json', 'payload/second.json', 'payload/third file.json']) {
      const bytes = encode({ synthetic: name }); await writeFile(path.join(root, name), bytes);
      files.push({ path: name, sha256: sha(bytes), ...(!addon ? { bytes: Buffer.byteLength(bytes) } : {}) });
    }
    const bytes = encode({ files }), file = path.join(root, addon ? 'addon.json' : 'pack.json');
    await writeFile(file, bytes); return { path: file, sha256: sha(bytes) };
  };
  const packs = {};
  for (const name of ['data', 'art', 'rules']) packs[name] = await pack(name);
  const config = encode({ coreRoot: path.join(selected, 'core'), dataDir: settings.dataDir, packs, addons: await pack('addons', true) });
  const configFile = path.join(selected, 'config.json'); await writeFile(configFile, config);
  const pointerBytes = encode({ config: { path: configFile, sha256: sha(config) } }); await writeFile(settings.current, pointerBytes);
  const snapshotAt = new Date(Date.now() - 49 * 3600000).toISOString();
  const backup = path.join(settings.backupDir, 'recovery-20261105T120000000Z-00000000-0000-4000-8000-000000000000');
  await mkdir(backup); await mkdir(path.join(backup, 'store'));
  await writeFile(path.join(backup, 'store/state.json'), '{}'); await writeFile(path.join(backup, 'store.dataset.json'), '{}');
  await writeFile(path.join(backup, 'portable.json'), encode({ format: 'rs3-chunk-picker', state: { members: [{}] } }));
  const manifest = { format: 'picker-recovery-v1', snapshotAt, createdAt: new Date().toISOString(), releasePointerSha256: sha(pointerBytes), files: await inventory(backup) };
  await writeFile(path.join(backup, 'manifest.json'), encode(manifest));
  const calls = [], remote = [];
  const run = async args => {
    assert.equal(await exists(path.join(settings.controlDir, 'operation.lock')), false);
    assert.equal((await json(path.join(settings.controlDir, 'offhost.lock'))).pid, process.pid);
    calls.push(args);
    if (args[0] === 'backup') {
      const id = (remote.length + 1).toString(16).padStart(64, 'a');
      const tags = args.flatMap((arg, index) => arg === '--tag' ? [args[index + 1]] : []);
      const manifest = await json(path.join(args.at(-2), 'manifest.json'));
      remote.push({ id, time: manifest.snapshotAt, tags });
      return JSON.stringify({ message_type: 'summary', snapshot_id: id }) + '\n';
    }
    if (args[0] === 'snapshots') return encode(args.includes('--tag')
      ? remote.filter(row => args[args.indexOf('--tag') + 1].split(',').every(tag => row.tags.includes(tag)))
      : remote.filter(row => row.id.startsWith(args.at(-1)))); return '';
  };
  return { dir, settings, roots, backup, manifest, snapshotAt, calls, run, remote,
    bundle: options => recoveryBundle({ ...options, roots }) };
}
export async function assertPayloadClosure(rebuild) {
  const manifest = await json(path.join(rebuild, 'rebuild-manifest.json'));
  assert.equal(manifest.pins.filter(pin => pin.payload).length, 4);
  for (const pin of manifest.pins) {
    const file = path.join(rebuild, pin.file);
    assert.equal(sha(await readFile(file)), pin.sha256);
    if (pin.payload) for (const row of (await json(file)).files) {
      const bytes = await readFile(path.join(path.dirname(file), row.path));
      assert.equal(sha(bytes), row.sha256); if (row.bytes !== undefined) assert.equal(bytes.length, row.bytes);
    }
  }
}
