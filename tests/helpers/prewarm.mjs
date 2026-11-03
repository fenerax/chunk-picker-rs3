import path from 'node:path';
import * as filesystem from 'node:fs/promises';

// Real reads with emulated root/service ownership; never require real root.
export function rootFilesystem(dataDir, { service = { uid: 1201, gid: 1202 }, changes = [], descriptors = [] } = {}) {
  return {
    async lstat(file) {
      const info = await filesystem.lstat(file);
      return Object.assign(info, path.resolve(file) === dataDir ? service : { uid: 0, gid: 0, mode: info.mode & ~0o022 });
    },
    readdir: filesystem.readdir,
    async open(file, flags) {
      const handle = await filesystem.open(file, flags); descriptors.push(handle);
      return { fd: handle.fd, close: () => handle.close(),
        stat: async () => Object.assign(await handle.stat(), { uid: 0 }),
        chown: async (...args) => { changes.push({ file, kind: 'chown', args }); },
        chmod: async (...args) => { changes.push({ file, kind: 'chmod', args }); } };
    },
  };
}
