// Dependency-free transport helper: safe to upload alone beside the archive.
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, chown, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const encode = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
// Git Bash's GNU tar reads "C:\..." as a remote host; Windows' own tar does not.
const windowsTar = () => process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
async function hash(file) {
  const h = createHash('sha256');
  for await (const bytes of createReadStream(file)) h.update(bytes);
  return h.digest('hex');
}
async function regular(file) {
  for (let at = path.resolve(file); ; at = path.dirname(at)) {
    const s = await lstat(at);
    if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1) throw new Error('Linked input refused.');
    if (at === path.dirname(at)) break;
  }
}
async function inventory(root) {
  await regular(root);
  const rows = [];
  async function walk(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      if (/[\r\n\\]/.test(name)) throw new Error('Invalid release filename.');
      const rel = relative ? relative + '/' + name : name, file = path.join(root, rel);
      await regular(file);
      const s = await lstat(file);
      if (s.isDirectory()) { rows.push({ path: rel, directory: true }); await walk(rel); }
      else if (s.isFile()) rows.push({ path: rel, bytes: s.size, sha256: await hash(file) });
      else throw new Error('Nonregular release input.');
    }
  }
  await walk(); return rows;
}
const pins = config => [config.selection, config.profile, config.addons, ...Object.values(config.packs ?? {})].filter(Boolean);
function relativePin(root, file) {
  const relative = path.win32.relative(root, file).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || relative === '..' || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error('Pin outside release.');
  return relative;
}
export async function prepareBundle(source, output) {
  source = path.resolve(source); output = path.resolve(output);
  if (!path.relative(source, output).startsWith('..')) throw new Error('Output must be outside the release.');
  await regular(source);
  const configBytes = await readFile(path.join(source, 'config.json')), config = JSON.parse(configBytes);
  let savedIdentityAdditions;
  try { savedIdentityAdditions = (await json(path.join(source, 'quick-build.json'))).savedIdentityAdditions; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sourceRoot = path.win32.dirname(config.coreRoot);
  const rows = [];
  for (const name of ['core', 'packs', 'profile.json', 'addons']) {
    const file = path.join(source, name); await regular(file);
    const s = await lstat(file);
    rows.push(s.isDirectory() ? { path: name, directory: true } : { path: name, bytes: s.size, sha256: await hash(file) });
    if (s.isDirectory()) rows.push(...(await inventory(file)).map(row => ({ ...row, path: name + '/' + row.path })));
  }
  // Runtime files and secret stores must never enter a release transport.
  if (rows.some(row => /(^|\/)(?:\.git|\.local|var|node_modules|access-token|store\.lock|picker-paused)(\/|$)/i.test(row.path))) throw new Error('Runtime state in release tree.');
  for (const pin of pins(config)) if (rows.find(row => row.path === relativePin(sourceRoot, pin.path))?.sha256 !== pin.sha256) throw new Error('Source pin mismatch.');
  await mkdir(output, { mode: 0o700 });
  execFileSync(windowsTar(), ['-cf', path.join(output, 'release.tar'), '-C', source, 'core', 'packs', 'profile.json', 'addons'], { stdio: 'ignore', windowsHide: true });
  await writeFile(path.join(output, 'source-config.json'), configBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(output, 'release-manifest.json'), encode({ sourceRoot, configSha256: sha(configBytes), rows, savedIdentityAdditions }), { flag: 'wx', mode: 0o600 });
  const transfer = {};
  for (const name of ['release.tar', 'source-config.json', 'release-manifest.json']) transfer[name] = await hash(path.join(output, name));
  await writeFile(path.join(output, 'transfer.json'), encode(transfer), { flag: 'wx', mode: 0o600 });
}
// Windows tar records 0777 modes and root extraction keeps them. A release must
// stay immutable to the service account: root-owned, its group may only read.
export async function lockRelease(root, gid, fs = { chmod, chown }) {
  const lock = async (file, directory) => { await fs.chown(file, 0, gid); await fs.chmod(file, directory ? 0o750 : 0o640); };
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() && !entry.isDirectory()) throw new Error('Unsafe release entry.');
      await lock(path.join(dir, entry.name), entry.isDirectory());
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
    }
  };
  await lock(root, true); await walk(root);
}
export async function rebaseBundle(upload, target, operatorFile, toolsRoot) {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Rebase requires Linux root.');
  const transfer = await json(path.join(upload, 'transfer.json'));
  if (Object.keys(transfer).sort().join() !== 'release-manifest.json,release.tar,source-config.json') throw new Error('Invalid transfer manifest.');
  for (const [name, digest] of Object.entries(transfer)) {
    await regular(path.join(upload, name));
    if (await hash(path.join(upload, name)) !== digest) throw new Error('Transfer mismatch.');
  }
  const manifest = await json(path.join(upload, 'release-manifest.json'));
  const expected = new Set(manifest.rows.map(row => row.path));
  if ([...expected].some(name => !/^(core|packs|addons)(\/[^\r\n]+)?$|^profile\.json$/.test(name) || name.split('/').some(part => part === '..' || part === '.'))) throw new Error('Invalid archive paths.');
  const archive = path.join(upload, 'release.tar');
  const names = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n').map(name => name.replace(/\/$/, ''));
  const types = execFileSync('tar', ['-tvf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
  if (names.length !== expected.size || names.some(name => !expected.has(name)) || types.some(line => !/^[-d]/.test(line))) throw new Error('Unsafe archive entries.');
  await mkdir(target, { mode: 0o755 }); // exclusive new candidate; never extract over a release
  execFileSync('tar', ['-xf', archive, '-C', target, '--no-same-owner'], { stdio: 'ignore' });
  const sort = rows => rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (encode(sort(await inventory(target))) !== encode(sort(manifest.rows))) throw new Error('Release tree mismatch.');
  const sourceBytes = await readFile(path.join(upload, 'source-config.json'));
  if (sha(sourceBytes) !== manifest.configSha256) throw new Error('Config mismatch.');
  const source = JSON.parse(sourceBytes), settings = await json(operatorFile);
  const { readRelease } = await import(pathToFileURL(path.join(toolsRoot, 'scripts/linux/runtime.mjs')).href);
  const current = await readRelease(settings.current, settings.dataDir);
  for (const pin of pins(source)) {
    pin.path = path.join(target, relativePin(manifest.sourceRoot, pin.path));
    if (await hash(pin.path) !== pin.sha256) throw new Error('Candidate pin mismatch.');
  }
  const config = { ...source, coreRoot: path.join(target, 'core'), packsDir: path.join(target, 'packs'),
    dataDir: settings.dataDir, host: current.config.host, port: current.config.port, loopbackPort: current.config.loopbackPort,
    publicOriginFile: current.config.publicOriginFile, nodePath: process.execPath,
    runtimeOptions: { ...source.runtimeOptions, taskWorkerMode: 'process' } };
  const configPath = path.join(target, 'config.json'), bytes = encode(config);
  await writeFile(configPath, bytes, { flag: 'wx', mode: 0o644 });
  const pointer = path.join(target, 'pointer.json');
  await writeFile(pointer, encode({ config: { path: configPath, sha256: sha(bytes) } }), { flag: 'wx', mode: 0o644 });
  // Same owner and modes as the installed releases beside it.
  await lockRelease(target, (await stat(path.dirname(target))).gid);
  const candidate = await readRelease(pointer, settings.dataDir);
  await writeFile(path.join(upload, 'verified.json'), encode({ candidateIdentity: candidate.identity,
    previousPointerSha256: sha(current.pointerBytes), pointer,
    // PC additions describe the PC save. The VPS must derive and accept its own.
    additionsReviewRequired: true }), { flag: 'wx', mode: 0o600 });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command !== 'rebase' || args.length !== 4) throw new Error();
    await rebaseBundle(...args); process.stdout.write('Candidate upload verified and rebased; not activated.\n');
  } catch { process.stderr.write('Candidate preparation refused; inspect private staging evidence.\n'); process.exitCode = 1; }
}
