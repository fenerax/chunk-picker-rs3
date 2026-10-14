// Test-only preload: explicit data files, exact output, and no discovery.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const normalize = value => {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString();
  if (typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const policy = JSON.parse(process.env.OPEN_F2P_BUILD_POLICY);
const data = new Set(policy.reads.map(normalize));
const modules = new Set(policy.modules.map(normalize));
const output = normalize(policy.output);
const directory = normalize(path.dirname(policy.output));
const audit = [];
globalThis[Symbol.for('open-f2p-build-audit')] = audit;
function check(operation, filename, kind = 'read') {
  const target = normalize(filename);
  const allowed = kind === 'read' ? data.has(target) || modules.has(target)
    : kind === 'write' ? target === output : kind === 'mkdir' && target === directory;
  audit.push({ operation, path: target, allowed, kind });
  if (!allowed) throw Object.assign(new Error(`Build access denied: ${operation}`), { code: 'OPEN_F2P_BUILD_FORBIDDEN' });
}
function patch(object, name, kind = 'read') {
  if (typeof object[name] !== 'function') return;
  const original = object[name];
  object[name] = function (filename, ...args) {
    if ((name === 'open' || name === 'openSync') && args[0] !== undefined && args[0] !== 'r') {
      check(name, filename, 'deny');
    }
    check(name, filename, kind);
    return Reflect.apply(original, this, [filename, ...args]);
  };
}
for (const object of [fs, promises]) {
  for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'stat', 'statSync',
    'lstat', 'lstatSync', 'access', 'accessSync', 'realpath', 'realpathSync']) patch(object, name);
  for (const name of ['readdir', 'readdirSync', 'opendir', 'opendirSync', 'readlink', 'readlinkSync',
    'unlink', 'unlinkSync', 'rm', 'rmSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync']) patch(object, name, 'deny');
  for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']) patch(object, name, 'write');
  for (const name of ['mkdir', 'mkdirSync']) patch(object, name, 'mkdir');
}
syncBuiltinESMExports();
globalThis.fetch = () => { throw Object.assign(new Error('Offline build cannot fetch.'), { code: 'OPEN_F2P_BUILD_FORBIDDEN' }); };
