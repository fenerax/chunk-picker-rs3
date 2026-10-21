import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import threads from 'node:worker_threads';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { promisify } from 'node:util';

// This is an execution check, not a publication or content-leak gate. Record
// every denial before throwing so a tolerant loader cannot hide an attempt.
if (!globalThis[Symbol.for('rs3.independentGuard')]) {
  globalThis[Symbol.for('rs3.independentGuard')] = true;
  const candidate = path.resolve(process.env.RS3_INDEPENDENT_ROOT);
  const audit = path.join(candidate, '.scratch', 'audit.ndjson');
  const policy = JSON.parse(fs.readFileSync(path.join(candidate, '.scratch', 'policy.json'), 'utf8'));
  const originalAppend = fs.appendFileSync.bind(fs);
  const originalRealpath = fs.realpathSync.bind(fs);
  const preload = import.meta.url;
  const normalized = value => path.resolve(value).replaceAll('\\', '/').toLowerCase();
  const base = normalized(candidate);
  const denied = policy.deniedPaths.map(value => value.toLowerCase().replace(/\/$/, ''));
  const deniedPrefixes = (policy.deniedPrefixes ?? []).map(value => value.toLowerCase());
  function record(row) { originalAppend(audit, JSON.stringify({ pid: process.pid, threadId: threads.threadId, ...row }) + '\n'); }
  function reject(operation, target) {
    const relative = typeof target === 'string' && normalized(target).startsWith(base + '/')
      ? path.relative(candidate, target).replaceAll('\\', '/') : '[outside-candidate]';
    record({ kind: 'denied', operation, path: relative });
    throw Object.assign(new Error(`Independent runtime denied ${operation}: ${relative}`), { code: 'INDEPENDENT_FORBIDDEN' });
  }
  function check(value, operation = 'read') {
    if (typeof value === 'number') return; // Only handles opened through guarded open methods.
    if (value instanceof URL) {
      if (value.protocol !== 'file:') return;
      value = fileURLToPath(value);
    }
    if (Buffer.isBuffer(value)) value = value.toString();
    if (typeof value !== 'string') return;
    const absolute = path.resolve(value), key = normalized(absolute);
    // Storage's no-symlink validation checks parent-directory metadata from
    // the drive root down. Permit metadata only for these exact ancestors;
    // their content, files, imports and directory enumeration remain denied.
    if (/^(?:l?stat|realpath)(?:Sync)?$/.test(operation) && base.startsWith(key.replace(/\/$/, '') + '/')) return;
    if (key !== base && !key.startsWith(base + '/')) reject(operation, absolute);
    const relative = key.slice(base.length + 1);
    if (denied.some(item => relative === item || relative.startsWith(item + '/'))
      || deniedPrefixes.some(prefix => relative.startsWith(prefix))
      || /^app\/data\/.*\.json(?:\.gz)?$/.test(relative)) reject(operation, absolute);
    // An existing symlink cannot be used to escape the disposable tree.
    let ancestor = absolute;
    for (;;) {
      try {
        const canonical = normalized(originalRealpath(ancestor));
        if (canonical !== base && !canonical.startsWith(base + '/')) reject(operation, absolute);
        break;
      } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
  }
  const methods = ['readFile', 'open', 'readdir', 'stat', 'lstat', 'realpath', 'access', 'readlink', 'opendir', 'createReadStream', 'exists'];
  for (const object of [fs, fsp]) for (const name of methods) {
    if (typeof object[name] === 'function') {
      const original = object[name]; object[name] = function (...args) { check(args[0], name); return Reflect.apply(original, this, args); };
    }
    if (object === fs && typeof object[name + 'Sync'] === 'function') {
      const original = object[name + 'Sync']; object[name + 'Sync'] = function (...args) { check(args[0], name + 'Sync'); return Reflect.apply(original, this, args); };
    }
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('file:') || specifier.startsWith('.') || path.isAbsolute(specifier)) {
        const url = specifier.startsWith('file:') ? new URL(specifier) : new URL(specifier, context.parentURL ?? preload);
        check(url, 'import');
      }
      let result;
      try { result = nextResolve(specifier, context); }
      catch (error) {
        record({ kind: 'module-resolution-failed', specifier: specifier.startsWith('file:') ? path.basename(fileURLToPath(specifier)) : specifier,
          parent: path.basename(context.parentURL ?? ''), code: error.code });
        throw error;
      }
      if (result.url.startsWith('file:')) check(new URL(result.url), 'import');
      return result;
    },
    load(url, context, nextLoad) { if (url.startsWith('file:')) check(new URL(url), 'module-load'); return nextLoad(url, context); },
  });
  const forcedArgs = args => [...(args ?? []).filter((arg, index, list) => !(arg === '--import' && list[index + 1] === preload) && !(index > 0 && list[index - 1] === '--import' && arg === preload)), '--import', preload];
  const NativeWorker = threads.Worker;
  threads.Worker = class GuardedWorker extends NativeWorker {
    constructor(filename, options = {}) {
      if (options.eval) reject('eval-worker', candidate);
      check(filename, 'worker-entry');
      record({ kind: 'worker-created', entry: path.basename(String(filename)), mode: 'thread' });
      super(filename, { ...options, env: options.env === threads.SHARE_ENV ? options.env : { ...process.env, ...options.env,
        RS3_INDEPENDENT_ROOT: candidate }, execArgv: forcedArgs(options.execArgv ?? process.execArgv) });
    }
    postMessage(message, ...args) {
      if (typeof message?.type === 'string') record({ kind: 'worker-message', type: message.type });
      return super.postMessage(message, ...args);
    }
  };
  const nativeFork = childProcess.fork;
  childProcess.fork = function (modulePath, args, options) {
    if (!Array.isArray(args)) { options = args; args = []; }
    options ??= {}; check(modulePath, 'process-entry');
    record({ kind: 'worker-created', entry: path.basename(String(modulePath)), mode: 'process' });
    return nativeFork(modulePath, args, { ...options, execArgv: forcedArgs(options.execArgv ?? process.execArgv),
      execPath: process.execPath, env: { ...process.env, ...options.env, RS3_INDEPENDENT_ROOT: candidate } });
  };
  function processOptions(command, args = [], options = {}) {
    if (normalized(command) !== normalized(process.execPath) || options.shell) reject('unapproved-executable', candidate);
    return { args: ['--import', preload, ...args], options: { ...options,
      env: { ...process.env, ...options.env, NODE_OPTIONS: '', RS3_INDEPENDENT_ROOT: candidate } } };
  }
  const metadataProbe = (command, args, options) => command === 'powershell.exe' && args.length === 4
    && args[0] === '-NoProfile' && args[1] === '-NonInteractive' && args[2] === '-Command'
    && /^\(Get-Process -Id [1-9]\d* -ErrorAction Stop\)\.StartTime\.ToUniversalTime\(\)\.ToString\('o'\)$/.test(args[3])
    && options.windowsHide === true && Number.isFinite(options.timeout) && options.timeout > 0 && options.timeout <= 3000 && !options.shell;
  for (const name of ['spawn', 'spawnSync']) {
    const original = childProcess[name];
    childProcess[name] = function (command, args, options) {
      if (!Array.isArray(args)) { options = args; args = []; }
      const guarded = processOptions(command, args, options);
      record({ kind: 'worker-created', entry: 'node-subprocess', mode: 'subprocess' });
      return Reflect.apply(original, this, [command, guarded.args, guarded.options]);
    };
  }
  for (const name of ['execFile', 'execFileSync']) {
    const original = childProcess[name];
    childProcess[name] = function (command, args, options, callback) {
      if (!Array.isArray(args)) { callback = options; options = args; args = []; }
      if (typeof options === 'function') { callback = options; options = {}; }
      options ??= {};
      if (metadataProbe(command, args, options)) {
        record({ kind: 'system-metadata-probe', operation: 'process-start-time' });
        return Reflect.apply(original, this, [command, args, options, ...(callback ? [callback] : [])]);
      }
      const guarded = processOptions(command, args, options);
      return Reflect.apply(original, this, [command, guarded.args, guarded.options, ...(callback ? [callback] : [])]);
    };
    if (name === 'execFile') {
      const wrapped = childProcess[name];
      wrapped[promisify.custom] = (...args) => new Promise((resolve, reject) => wrapped(...args,
        (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr })));
    }
  }
  for (const name of ['exec', 'execSync']) childProcess[name] = function () { reject('shell-execution', candidate); };
  function network(value) {
    const url = value instanceof URL ? value : typeof value === 'string' ? new URL(value)
      : new URL(`${value?.protocol ?? 'http:'}//${value?.hostname ?? value?.host ?? 'localhost'}:${value?.port ?? 80}${value?.path ?? '/'}`);
    if (url.origin !== process.env.RS3_INDEPENDENT_ORIGIN) {
      record({ kind: 'denied', operation: 'network', path: '[outside-test-origin]' });
      throw Object.assign(new Error('Independent runtime denied external network request.'), { code: 'INDEPENDENT_FORBIDDEN' });
    }
  }
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = function (input, ...args) { network(input instanceof Request ? input.url : input); return nativeFetch(input, ...args); };
  for (const object of [http, https]) for (const name of ['request', 'get']) {
    const original = object[name]; object[name] = function (...args) { network(args[0]); return Reflect.apply(original, this, args); };
  }
  const nativeConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Internal Node callers may pass a pre-normalized [options, callback] pair.
    const input = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof input === 'object' ? input : typeof input === 'number'
      ? { port: input, host: typeof args[1] === 'string' ? args[1] : 'localhost' } : { path: input };
    if (options?.path) {
      record({ kind: 'denied', operation: 'network', path: '[unapproved-socket]' });
      throw Object.assign(new Error('Independent runtime denied socket connection.'), { code: 'INDEPENDENT_FORBIDDEN' });
    }
    network({ hostname: options.hostname ?? options.host ?? 'localhost', port: options.port, protocol: 'http:' });
    return Reflect.apply(nativeConnect, this, args);
  };
  const nativeTLSConnect = tls.connect;
  tls.connect = function (...args) { network('https://example.invalid/'); return Reflect.apply(nativeTLSConnect, this, args); };
  syncBuiltinESMExports();
  record({ kind: 'guard-installed' });
}
