// Preloaded into every traced test process and thread (NODE_OPTIONS --import).
// It records what the test could observe: file reads, listings and stats, module
// loads, writes, sockets and children. A file receipt is reusable only when this
// trace shows every observation was bound by the file's contract. Anything the
// trace cannot follow is recorded as a hazard, which makes the file run again.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import childProcess from 'node:child_process';
import net from 'node:net';
import dgram from 'node:dgram';
import { threadId } from 'node:worker_threads';

const directory = process.env.RS3_TEST_TRACE_DIR;
const tracer = import.meta.url;
export const traceEnabled = !!directory;

if (directory) {
  // Captured before wrapping. appendFileSync would re-enter the wrapped writeFileSync.
  fs.mkdirSync(directory, { recursive: true });
  const descriptor = fs.openSync(path.join(directory, `${process.pid}-${threadId}.jsonl`), 'a'), writeSync = fs.writeSync;
  const seen = new Set();
  const record = (kind, value) => {
    const key = kind + '\0' + value;
    if (seen.has(key)) return;
    seen.add(key);
    writeSync(descriptor, JSON.stringify([kind, value]) + '\n');
  };
  const hazard = reason => record('hazard', reason);
  // Builtins that read files or run code outside the wrappers below.
  const unobserved = name => /^(?:node:)?(?:inspector|sqlite|wasi)(?:\/|$)/.test(name);
  const toPath = value => {
    if (typeof value === 'string') return value.startsWith('file:') ? fileURLToPath(value) : path.resolve(value);
    if (value instanceof URL) return value.protocol === 'file:' ? fileURLToPath(value) : null;
    if (Buffer.isBuffer(value)) return path.resolve(value.toString());
    return null;
  };
  const note = (kind, value) => { const file = toPath(value); if (file) record(kind, file); else if (value != null && typeof value !== 'number') hazard('unrecognized fs path argument'); };
  const openKinds = flags => {
    if (flags === undefined || flags === null) return ['read'];
    if (typeof flags === 'number') {
      const { O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;
      const writes = flags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND);
      return flags & O_WRONLY ? ['write'] : writes ? ['read', 'write'] : ['read'];
    }
    const text = String(flags);
    return /[wa]/.test(text) && !text.includes('+') ? ['write'] : /[wa+]/.test(text) ? ['read', 'write'] : ['read'];
  };
  // Name → how its leading path arguments are observed.
  const reads = ['readFile', 'readFileSync', 'openAsBlob', 'readlink', 'readlinkSync', 'createReadStream', 'watch', 'watchFile'];
  const lists = ['readdir', 'readdirSync', 'opendir', 'opendirSync'];
  const stats = ['stat', 'statSync', 'lstat', 'lstatSync', 'statfs', 'statfsSync', 'exists', 'existsSync', 'access', 'accessSync', 'realpath', 'realpathSync'];
  // mkdir only creates; it never changes what already exists.
  const makes = ['mkdir', 'mkdirSync'];
  const writes = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync',
    'truncate', 'truncateSync', 'utimes', 'utimesSync', 'lutimes', 'lutimesSync', 'chmod', 'chmodSync', 'lchmod', 'lchmodSync', 'chown', 'chownSync', 'lchown', 'lchownSync',
    'createWriteStream', 'unwatchFile'];
  const pairs = { copyFile: ['read', 'write'], copyFileSync: ['read', 'write'], cp: ['tree', 'write'], cpSync: ['tree', 'write'], rename: ['write', 'write'], renameSync: ['write', 'write'],
    link: ['read', 'write'], linkSync: ['read', 'write'], symlink: [null, 'write'], symlinkSync: [null, 'write'] };
  const ignored = new Set(['constants', 'promises', 'Stats', 'Dirent', 'Dir', 'ReadStream', 'WriteStream', 'FileReadStream', 'FileWriteStream', 'F_OK', 'R_OK', 'W_OK', 'X_OK', '_toUnixTimestamp']);
  const observe = (name, args) => {
    if (reads.includes(name)) note('read', args[0]);
    else if (lists.includes(name)) note('list', args[0]);
    else if (stats.includes(name)) note('stat', args[0]);
    else if (makes.includes(name)) note('make', args[0]);
    else if (writes.includes(name)) note('write', args[0]);
    else if (name === 'open' || name === 'openSync') for (const kind of openKinds(args[1])) note(kind, args[0]);
    else if (name === 'mkdtemp' || name === 'mkdtempSync') note('make', String(args[0]) + '*');
    else if (pairs[name]) pairs[name].forEach((kind, index) => { if (kind) note(kind, args[index]); });
    else if (name === 'glob' || name === 'globSync') hazard('fs glob');
    else if (typeof args[0] !== 'number') note('read', args[0]); // An unlisted path API counts as a read.
  };
  const wrapAll = target => {
    for (const name of Object.keys(target)) {
      const original = target[name];
      if (typeof original !== 'function' || ignored.has(name) || /^[A-Z]/.test(name)) continue;
      const wrapped = function (...args) {
        observe(name, args);
        if (name === 'mkdtemp' && typeof args.at(-1) === 'function') {
          const callback = args.at(-1);
          args = [...args.slice(0, -1), function (error, made) { if (!error) record('make', path.resolve(String(made))); return Reflect.apply(callback, this, arguments); }];
        }
        const result = Reflect.apply(original, this, args);
        if (name === 'mkdtempSync' && typeof result === 'string') record('make', path.resolve(result));
        if (name === 'mkdtemp' && result && typeof result.then === 'function') result.then(made => record('make', path.resolve(String(made))), () => {});
        return result;
      };
      for (const key of Reflect.ownKeys(original)) if (!['length', 'name', 'prototype'].includes(key)) {
        const descriptor = Object.getOwnPropertyDescriptor(original, key);
        if (key === 'native' && typeof descriptor.value === 'function') descriptor.value = function (...args) { note('stat', args[0]); return Reflect.apply(original.native, this, args); };
        Object.defineProperty(wrapped, key, descriptor);
      }
      Object.defineProperty(wrapped, 'name', { value: original.name });
      Object.defineProperty(wrapped, 'length', { value: original.length });
      target[name] = wrapped;
    }
  };
  wrapAll(fs); wrapAll(fsp);
  module.syncBuiltinESMExports();

  module.registerHooks({
    resolve(specifier, context, next) {
      try { return next(specifier, context); } catch (error) {
        if (/^\.{0,2}\//.test(specifier) && context.parentURL?.startsWith('file:')) record('stat', fileURLToPath(new URL(specifier, context.parentURL)));
        else if (!specifier.startsWith('node:')) hazard('unresolved bare module');
        throw error;
      }
    },
    load(url, context, next) {
      if (url.startsWith('file:') && url.split(/[?#]/)[0] !== tracer) record('read', fileURLToPath(url.split(/[?#]/)[0]));
      else if (url.startsWith('node:') && unobserved(url)) hazard('builtin ' + url);
      else if (!/^(?:node|data):/.test(url)) hazard('module from ' + url.slice(0, url.indexOf(':')));
      return next(url, context);
    },
  });
  const originalRegister = module.register;
  if (typeof originalRegister === 'function') module.register = function (...args) { hazard('custom loader thread'); return Reflect.apply(originalRegister, this, args); };

  // Children: Node children inherit this trace; anything else is unobserved.
  // First, so a child's own preloads load after the hooks exist.
  const nodeOptions = value => (String(value ?? '').includes(tracer) ? String(value) : `--import=${tracer} ${value ?? ''}`.trim());
  const traceEnvironment = options => {
    const env = { ...(options?.env ?? process.env) };
    // A nested traced runner keeps its own directory; this trace cannot see that tree.
    if (env.RS3_TEST_TRACE_DIR && path.resolve(env.RS3_TEST_TRACE_DIR) !== path.resolve(directory)) { hazard('nested trace directory'); return options; }
    env.NODE_OPTIONS = nodeOptions(env.NODE_OPTIONS); env.RS3_TEST_TRACE_DIR = directory;
    return { ...(options ?? {}), env };
  };
  const isNode = file => {
    const resolved = String(file);
    const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    return same(path.resolve(resolved), process.execPath) || /^node(?:\.exe)?$/i.test(resolved);
  };
  const split = args => {
    let index = 1;
    const list = Array.isArray(args[index]) ? args[index++] : [];
    const options = args[index] && typeof args[index] === 'object' ? args[index++] : undefined;
    return { file: args[0], list, options, rest: args.slice(index) };
  };
  // Reviewed children that only query process state and read no files: the
  // store's process start-time probe. The whole argument list must match.
  const probes = [/^(?:powershell|pwsh)(?:\.exe)?\n-NoProfile\n-NonInteractive\n-Command\n\(Get-Process -Id \d+ -ErrorAction Stop\)\.StartTime\.ToUniversalTime\(\)\.ToString\('o'\)$/i];
  const probe = (file, list, options) => !options?.shell && Array.isArray(list) && list.every(arg => typeof arg === 'string')
    && probes.some(pattern => pattern.test([String(file), ...list].join('\n')));
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = childProcess[name];
    childProcess[name] = function (...args) {
      const { file, list, options, rest } = split(args);
      if (probe(file, list, options)) { record('child', 'probe'); return Reflect.apply(original, this, args); }
      if (options?.shell || !isNode(file)) { hazard('untraced child ' + path.basename(String(file))); return Reflect.apply(original, this, args); }
      record('child', 'node');
      return Reflect.apply(original, this, [file, list, traceEnvironment(options), ...rest]);
    };
  }
  const originalFork = childProcess.fork;
  childProcess.fork = function (...args) {
    const { file, list, options } = split(args);
    record('child', 'node');
    if (options?.execPath && !isNode(options.execPath)) hazard('untraced fork executable');
    return Reflect.apply(originalFork, this, [file, list, traceEnvironment(options)]);
  };
  for (const name of ['exec', 'execSync']) {
    const original = childProcess[name];
    childProcess[name] = function (...args) { hazard('untraced shell child'); return Reflect.apply(original, this, args); };
  }
  // Node's own promisified forms call the unwrapped functions; these go through
  // the wrappers and resolve to { stdout, stderr } the same way.
  for (const name of ['execFile', 'exec']) {
    const wrapped = childProcess[name];
    Object.defineProperty(wrapped, promisify.custom, { configurable: true, value: (...args) => {
      let child;
      const promise = new Promise((resolve, reject) => {
        child = Reflect.apply(wrapped, childProcess, [...args, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }))]);
      });
      promise.child = child;
      return promise;
    } });
  }
  module.syncBuiltinESMExports();

  // Sockets: only loopback peers listening inside this traced tree are bound.
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    this.once('listening', () => { const address = this.address(); record('listen', typeof address === 'string' ? address : String(address?.port)); });
    return Reflect.apply(listen, this, args);
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let options = args[0];
    if (Array.isArray(options)) options = options[0];
    if (typeof options === 'number' || typeof options === 'string' && /^\d+$/.test(options)) options = { port: options, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    else if (typeof options === 'string') options = { path: options };
    if (options?.path) record('connect', String(options.path));
    else record('connect', `${options?.host ?? 'localhost'}|${options?.port}`);
    return Reflect.apply(connect, this, args);
  };
  for (const method of ['send', 'connect']) {
    const original = dgram.Socket.prototype[method];
    dgram.Socket.prototype[method] = function (...args) { hazard('udp socket'); return Reflect.apply(original, this, args); };
  }
  // Native code and internals are outside the trace.
  const dlopen = process.dlopen;
  process.dlopen = function (...args) { hazard('native addon'); return Reflect.apply(dlopen, this, args); };
  const binding = process.binding;
  if (typeof binding === 'function') process.binding = function (...args) { hazard('process.binding'); return Reflect.apply(binding, this, args); };
  for (const flag of process.execArgv) if (/expose[-_]internals|^--inspect(?:-brk|-wait)?(?:=|$)/.test(flag)) hazard('internal or inspector flag ' + flag);
  // Off-thread loaders read modules where the hooks above cannot see.
  for (const flag of [...process.execArgv, ...String(process.env.NODE_OPTIONS ?? '').split(/\s+/)]) if (/^(?:--(?:experimental-)?loader|--require|-r)(?:=|$)/.test(flag)) hazard('loader or require flag ' + flag);
  const getBuiltin = process.getBuiltinModule;
  if (typeof getBuiltin === 'function') process.getBuiltinModule = function (name) {
    if (unobserved(String(name))) hazard('builtin ' + name);
    return Reflect.apply(getBuiltin, this, [name]);
  };
  module.syncBuiltinESMExports();
}
