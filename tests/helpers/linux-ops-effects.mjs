// Test-only OS boundary. The installer, package verifier, permission gates and
// lock/recovery algorithms run unchanged; no command or socket reaches the OS.
import * as fs from 'node:fs/promises';
import * as syncFs from 'node:fs';
import * as childProcess from 'node:child_process';
import * as net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { promisify } from 'node:util';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { performance as nativePerformance } from 'node:perf_hooks';

const nativePlatform = process.platform;
const metadata = new Map(), sockets = new Set();
const boot = '00000000-0000-0000-0000-000000000001';
export const effects = {
  epoch: 1, crashed: false, hook: null, handles: new Set(), commands: [], children: new Set(), syncs: [], now: 0,
  restart() { this.crashed = false; this.hook = null; this.epoch++; },
};
const crash = () => Object.assign(Error('simulated process loss'), { code: 'TEST_PROCESS_LOST' });
async function boundary(operation, file, stage, args = []) {
  if (effects.crashed) throw crash();
  await effects.hook?.({ operation, file: String(file), stage, args });
  if (effects.crashed) throw crash();
}
const wrapped = name => async (...args) => {
  await boundary(name, args[0], 'before', args);
  const result = await fs[name](...args);
  await boundary(name, args[0], 'after', args);
  return result;
};
export * from 'node:fs/promises';
export * from 'node:child_process';
export * from 'node:net';
export * from 'node:perf_hooks';
export const performance = new Proxy(nativePerformance, { get(target, key) {
  return key === 'now' ? () => effects.now : typeof target[key] === 'function' ? target[key].bind(target) : target[key];
} });
export const statfs = async (_file, { bigint = false } = {}) => ({ bavail: bigint ? 1048576n : 1048576, bsize: bigint ? 4096n : 4096 });
export const rename = wrapped('rename'), rm = wrapped('rm'), unlink = wrapped('unlink');
export const mkdir = wrapped('mkdir'), writeFile = wrapped('writeFile');
export async function readFile(file, ...args) {
  await boundary('readFile', file, 'before');
  if (String(file) === '/proc/sys/kernel/random/boot_id') return boot + '\n';
  if (/^\/proc\/\d+\/stat$/.test(String(file))) {
    if (String(file) !== `/proc/${process.pid}/stat`) throw Object.assign(Error('synthetic dead owner'), { code: 'ENOENT' });
    return `${process.pid} (synthetic owner) ${Array(19).fill('0').join(' ')} ${effects.epoch} 0\n`;
  }
  return fs.readFile(file, ...args);
}
export async function lstat(file, ...args) {
  await boundary('lstat', file, 'before');
  const info = await fs.lstat(file, ...args), saved = metadata.get(path.resolve(String(file)));
  const value = number => typeof info.mode === 'bigint' ? BigInt(number) : number;
  return Object.assign(info, {
    uid: value(saved?.uid ?? 0), gid: value(saved?.gid ?? 0),
    mode: value((Number(info.mode) & ~0o777) | (saved?.mode ?? (nativePlatform === 'win32' ? info.isDirectory() ? 0o755 : 0o644 : Number(info.mode) & 0o777))),
  });
}
export async function chmod(file, mode) {
  await boundary('chmod', file, 'before');
  metadata.set(path.resolve(String(file)), { ...metadata.get(path.resolve(String(file))), mode });
  await fs.chmod(file, mode);
}
export async function chown(file, uid, gid) {
  await boundary('chown', file, 'before');
  metadata.set(path.resolve(String(file)), { ...metadata.get(path.resolve(String(file))), uid, gid });
}
export const symlink = (target, file, type) => fs.symlink(target, file, nativePlatform === 'win32' && type === 'dir' ? 'junction' : type);
export async function open(file, ...args) {
  await boundary('open', file, 'before');
  const directory = args[0] === 'r' && (await fs.lstat(file)).isDirectory();
  const handle = nativePlatform === 'win32' && directory ? null : await fs.open(file, ...args);
  const owned = { file: String(file) }; effects.handles.add(owned);
  return new Proxy(handle ?? {}, { get(target, key) {
    if (key === 'close') return async () => { effects.handles.delete(owned); await handle?.close(); };
    if (key === 'sync') return async () => {
      await boundary('sync', file, 'before'); effects.syncs.push(String(file)); await boundary('sync', file, 'after');
    };
    if (key === 'chmod') return mode => chmod(file, mode);
    if (key === 'chown') return (uid, gid) => chown(file, uid, gid);
    const value = target[key];
    if (key === 'createReadStream' || key === 'createWriteStream') return value.bind(target);
    return typeof value === 'function' ? async (...values) => {
      await boundary(String(key), file, 'before'); return value.apply(target, values);
    } : value;
  } });
}

async function permitted(file, uid, gid, bits) {
  const info = await lstat(file);
  const allowed = info.mode >> (info.uid === uid ? 6 : info.gid === gid ? 3 : 0) & 7;
  if ((allowed & bits) !== bits) throw Error('synthetic access refused');
}
async function readable(root, uid, gid) {
  for (let at = root; ; at = path.dirname(at)) {
    await permitted(at, uid, gid, 1); if (at === path.dirname(at)) break;
  }
  const walk = async file => {
    const info = await lstat(file);
    if (info.isDirectory()) {
      await permitted(file, uid, gid, 5);
      for (const name of await fs.readdir(file)) await walk(path.join(file, name));
    } else {
      if (!info.isFile() || info.nlink !== 1) throw Error('synthetic nonregular input');
      await permitted(file, uid, gid, 4); await fs.readFile(file);
    }
  };
  await walk(root);
}
const script = (source, file) => new Script(source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.resolve(file)).href)), { filename: file });
async function execute(command, args, options) {
  await boundary('execFile', command, 'before');
  effects.commands.push({ command, args, options });
  if (command !== '/usr/bin/python3' || args[0] !== '-c') throw Error('Unexpected external command');
  const source = args[1];
  if (source.includes('renameat2')) {
    const [first, second] = args.slice(2), temporary = first + '.test-exchange';
    await fs.rename(first, temporary); await fs.rename(second, first); await fs.rename(temporary, second);
    return { stdout: '', stderr: '' };
  }
  if (!source.includes('os.setgroups([]);os.setgid(gid);os.setuid(uid)')) throw Error('Privilege drop missing');
  const payload = JSON.parse(args[2]);
  if (payload.length === 5) {
    const [root, uid, gid, entries] = payload;
    await readable(root, uid, gid);
    for (const entry of entries) script(await fs.readFile(path.join(root, entry), 'utf8'), entry);
  } else if (payload.length === 8) {
    const [uid, gid, root, alias, , config, checks, linked] = payload;
    const settings = JSON.parse(await fs.readFile(config, 'utf8'));
    if (!syncFs.existsSync(path.join(settings.controlDir, 'maintenance.json'))) throw Error('Probe fence missing');
    for (const [entry, argv, diagnostic] of checks) {
      const invoked = path.join(linked && /^(scripts\/linux\/|scripts\/release\/vps\/)/.test(entry) ? alias : root, entry);
      await permitted(await fs.realpath(invoked), uid, gid, 4);
      const selected = await fs.realpath(invoked);
      let stdout = '', stderr = '';
      const process = { argv: ['synthetic-node', invoked, ...argv], exitCode: 0,
        stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } };
      script(await fs.readFile(selected, 'utf8'), selected).runInNewContext({
        process, URL, main: () => true, legacyMain: () => path.resolve(invoked) === selected,
      });
      if (process.exitCode !== 1 || stdout || !stderr.startsWith(diagnostic)) throw Error('Synthetic CLI contract refused');
    }
  } else throw Error('Unexpected Python probe');
  return { stdout: '', stderr: '' };
}
export const execFile = Object.assign(() => { throw Error('Use the promised exec boundary'); }, { [promisify.custom]: execute });
export function spawn(command, args, options) {
  if (command !== 'flock' || args.at(-1) !== '3' || !Number.isInteger(options.stdio[3])) throw Error('Unexpected spawned command');
  const child = new EventEmitter(); effects.children.add(child);
  queueMicrotask(() => { child.emit('exit', 0); child.emit('close', 0); effects.children.delete(child); });
  return child;
}
// Bundle transport still checks its real manifest and hashes. The archive is a
// tiny JSON transport in this harness, never a tar executable or large fixture.
export function execFileSync(command, args) {
  if (!/(?:^|[\\/])tar(?:\.exe)?$/.test(command)) throw Error('Unexpected synchronous command');
  const [operation, archive] = args;
  if (operation === '-cf') {
    const root = args[3], rows = [];
    const walk = relative => {
      const file = path.join(root, relative), info = syncFs.lstatSync(file);
      rows.push({ path: relative, directory: info.isDirectory(), bytes: info.isDirectory() ? null : syncFs.readFileSync(file).toString('base64') });
      if (info.isDirectory()) for (const name of syncFs.readdirSync(file).sort()) walk(relative + '/' + name);
    };
    for (const name of args.slice(4)) walk(name);
    syncFs.writeFileSync(archive, JSON.stringify(rows)); return;
  }
  const rows = JSON.parse(syncFs.readFileSync(archive, 'utf8'));
  if (operation === '-tf') return rows.map(row => row.path).join('\n') + '\n';
  if (operation === '-tvf') return rows.map(row => (row.directory ? 'd' : '-') + ' synthetic').join('\n') + '\n';
  if (operation !== '-xf') throw Error('Unexpected archive operation');
  for (const row of rows) {
    const file = path.join(args[3], row.path);
    if (row.directory) syncFs.mkdirSync(file); else syncFs.writeFileSync(file, Buffer.from(row.bytes, 'base64'));
  }
}
export function createServer() {
  const server = new EventEmitter(); let owned;
  server.listen = ({ path: name }, ready) => {
    queueMicrotask(() => {
      if (sockets.has(name)) server.emit('error', Object.assign(Error('synthetic lock busy'), { code: 'EADDRINUSE' }));
      else { sockets.add(name); owned = name; server.emit('listening'); ready?.(); }
    });
  };
  server.close = done => { sockets.delete(owned); done(); };
  return server;
}
export function installEffects() {
  const root = new URL('../../', import.meta.url).href, self = import.meta.url;
  const properties = new Map(['platform', 'getuid', 'kill'].map(key => [key, Object.getOwnPropertyDescriptor(process, key)]));
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
  Object.defineProperty(process, 'getuid', { configurable: true, value: () => 0 });
  Object.defineProperty(process, 'kill', { configurable: true, value: (pid, signal) => {
    if (signal !== 0) throw Error('Unexpected process signal');
    if (pid === process.pid) return true;
    throw Object.assign(Error('synthetic dead owner'), { code: 'ESRCH' });
  } });
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(root) && !context.parentURL.startsWith(new URL('../', import.meta.url).href)
      && ['node:fs/promises', 'node:child_process', 'node:net', 'node:perf_hooks'].includes(specifier)) return { url: self, shortCircuit: true };
    return next(specifier, context);
  } });
  return () => {
    hook.deregister();
    for (const [key, descriptor] of properties) {
      if (descriptor) Object.defineProperty(process, key, descriptor); else delete process[key];
    }
    if (effects.handles.size || effects.children.size || sockets.size) throw Error('Unreleased synthetic OS resource');
  };
}
export default { ...fs, ...childProcess, ...net, open, readFile, writeFile, mkdir, lstat, chmod, chown, symlink,
  rename, rm, unlink, statfs, execFile, execFileSync, spawn, createServer };
