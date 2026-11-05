import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {encode,exclusive,inventory,json,sha} from '../../scripts/linux/files.mjs';
import {recoveryBundle,recoveryUnits} from '../../scripts/linux/recovery-bundle.mjs';
const base = fileURLToPath(new URL('../../.local/offhost-tests/', import.meta.url));
export async function offhostFixture(t) {
  await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = { controlDir: path.join(dir, 'control'), dataDir: path.join(dir, 'data'), scratchRoot: path.join(dir, 'scratch'),
    backupDir: path.join(dir, 'backups'), current: path.join(dir, 'current.json') };
  const roots = Object.fromEntries(['etc', 'units', 'releases', 'packs', 'tools'].map(name => [name, path.join(dir, name)]));
  for (const directory of [settings.controlDir, settings.backupDir, ...Object.values(roots)]) await mkdir(directory);
  const selected = path.join(roots.releases, 'synthetic'); await mkdir(selected); await mkdir(path.join(selected, 'core'));
  await writeFile(path.join(selected, 'core', 'app.mjs'), 'export {};');
  await writeFile(path.join(roots.etc, 'synthetic-secret'), 'synthetic-only');
  await writeFile(path.join(roots.tools, 'tool.mjs'), 'export {};');
  for (const unit of recoveryUnits) await writeFile(path.join(roots.units, unit), '[Unit]\n');
  const config = encode({ coreRoot: path.join(selected, 'core'), dataDir: settings.dataDir, packs: {} });
  const configFile = path.join(selected, 'config.json'); await writeFile(configFile, config);
  const pointerBytes = encode({ config: { path: configFile, sha256: sha(config) } }); await writeFile(settings.current, pointerBytes);
  const snapshotAt = new Date(Date.now() - 49 * 3600000).toISOString();
  const backup = path.join(settings.backupDir, 'recovery-20261105T120000000Z-00000000-0000-4000-8000-000000000000');
  await mkdir(backup); await mkdir(path.join(backup, 'store'));
  await writeFile(path.join(backup, 'store/state.json'), '{}'); await writeFile(path.join(backup, 'store.dataset.json'), '{}');
  await writeFile(path.join(backup, 'portable.json'), encode({ format: 'rs3-chunk-picker', state: { members: [{}] } }));
  const manifest = { format: 'picker-recovery-v1', snapshotAt, createdAt: new Date().toISOString(), releasePointerSha256: sha(pointerBytes), files: await inventory(backup) };
  await writeFile(path.join(backup, 'manifest.json'), encode(manifest));
  const calls = [], id = 'a'.repeat(64);
  const run = async args => {
    assert.equal((await json(path.join(settings.controlDir, 'operation.lock'))).pid, process.pid);
    await assert.rejects(exclusive(path.join(settings.controlDir, 'operation.lock'), async () => {}), /busy/);
    calls.push(args);
    if (args[0] === 'backup') return JSON.stringify({ message_type: 'summary', snapshot_id: id }) + '\n';
    if (args[0] === 'snapshots') return encode([{ id, time: snapshotAt }]); return '';
  };
  return { dir, settings, roots, backup, manifest, snapshotAt, calls, run,
    bundle: options => recoveryBundle({ ...options, roots }) };
}
