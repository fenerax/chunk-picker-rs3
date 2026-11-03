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
        stat: async () => { const info = await handle.stat(); return Object.assign(info, { uid: 0, mode: info.mode & ~0o022 }); },
        chown: async (...args) => { changes.push({ file, kind: 'chown', args }); },
        chmod: async (...args) => { changes.push({ file, kind: 'chmod', args }); } };
    },
  };
}

// Synthetic root-trusted systemd/NSS replies; never query the host's accounts.
export function serviceQuery(service = { uid: 1201, gid: 1202 }, { user = 'prewarm-fixture', group = 'prewarm-fixture', dynamic = 'no' } = {}) {
  return async (command, args) => {
    if (command === '/usr/bin/systemctl') return { stdout: `User=${user}\nGroup=${group}\nDynamicUser=${dynamic}\n` };
    if (command === '/usr/bin/getent' && args[0] === 'passwd') return { stdout: `${user}:x:${service.uid}:${service.gid}::/:/sbin/nologin\n` };
    if (command === '/usr/bin/getent' && args[0] === 'group') return { stdout: `${group}:x:${service.gid}:\n` };
    throw Error('Unexpected identity command.');
  };
}
