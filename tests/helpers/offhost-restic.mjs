// Synthetic local repositories only. Windows may opt into the pinned binary;
// Linux CI installs it at the ordinary reviewed path.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { offhostFixture } from './offhost.mjs';
import { offhostBackup } from '../../scripts/linux/offhost-backup.mjs';
import { executeRestic, guardedRestic, verifyRestic } from '../../scripts/linux/restic.mjs';

export const realResticAvailable = process.platform === 'linux' || !!process.env.RS3_TEST_RESTIC_BINARY;
export async function realOffhostFixture(t) {
  const binary = process.env.RS3_TEST_RESTIC_BINARY ?? '/usr/local/bin/restic';
  await verifyRestic(binary);
  const f = await offhostFixture(t), local = path.join(f.dir, 'local'); await mkdir(local);
  const repository = path.join(local, 'repository'), password = path.join(local, 'password');
  await writeFile(password, 'synthetic-local-only', { mode: 0o600 });
  const env = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: local, TZ: 'UTC', RESTIC_REPOSITORY: repository, RESTIC_PASSWORD_FILE: password };
  const run = (input, options = {}) => {
    const args = [...input];
    // Go on Windows ignores TZ. Translate only this fixture's backup time to
    // local wall time so the resulting instant matches the Linux UTC command.
    if (process.platform === 'win32' && args[0] === 'backup' && args.includes('--time')) {
      const index = args.indexOf('--time') + 1, instant = new Date(args[index].replace(' ', 'T') + 'Z');
      const pad = value => String(value).padStart(2, '0');
      args[index] = `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())} ${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}`;
    }
    return guardedRestic({ root: path.join(local, 'temp'), reserve: 0, binary, args, env,
      cacheDir: path.join(local, 'cache'), ...options,
      execute: (binary, input, options) => {
        const args = [...input], restore = args.indexOf('restore');
        if (process.platform === 'win32' && restore >= 0) {
          // Every file is below this staging root. Avoid restoring special
          // read-only attributes from Windows' synthetic C/Users ancestors;
          // Linux exercises the ordinary whole-snapshot restore unchanged.
          const stage = path.join(f.settings.scratchRoot, 'offhost-stage').replace(/^([A-Za-z]):/, '$1').replaceAll('\\', '/');
          args[restore + 1] += ':/' + stage;
        }
        return executeRestic(binary, args, options);
      } });
  };
  await run(['init']); await offhostBackup({ ...f, run, config: {}, ping: async () => false });
  const packOfType = async type => {
    for (const id of (await run(['list', 'index'])).trim().split(/\s+/)) {
      const index = JSON.parse(await run(['cat', 'index', id]));
      const pack = index.packs.find(pack => pack.blobs.length && pack.blobs.every(blob => blob.type === type));
      if (pack) {
        const file = path.resolve(repository, 'data', pack.id.slice(0, 2), pack.id);
        assert(file.startsWith(path.resolve(f.dir) + path.sep)); return file;
      }
    }
    throw Error('Synthetic pack not found.');
  };
  const rootTreeBlob = async snapshot => {
    const { tree } = JSON.parse(await run(['cat', 'snapshot', snapshot]));
    for (const id of (await run(['list', 'index'])).trim().split(/\s+/)) {
      const index = JSON.parse(await run(['cat', 'index', id]));
      for (const pack of index.packs) {
        const blob = pack.blobs.find(blob => blob.type === 'tree' && blob.id === tree);
        if (blob) {
          const file = path.resolve(repository, 'data', pack.id.slice(0, 2), pack.id);
          assert(file.startsWith(path.resolve(f.dir) + path.sep));
          return { file, offset: blob.offset };
        }
      }
    }
    throw Error('Synthetic root tree not found.');
  };
  return { ...f, run, packOfType, rootTreeBlob };
}
