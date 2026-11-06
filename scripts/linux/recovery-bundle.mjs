import path from 'node:path';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { packRelative } from '../../app/packs.mjs';
import { assertSameRelease } from './runtime.mjs';
import { encode, exists, inventory, noLinks, outside, sha } from './files.mjs';
import { stagingBudget } from './staging.mjs';

export const recoveryUnits = Object.freeze(['chunk-picker.service', 'chunk-picker-backup.service', 'chunk-picker-backup.timer',
  'chunk-picker-health.service', 'chunk-picker-health.timer', 'chunk-picker-monitor.service', 'chunk-picker-monitor.timer',
  'chunk-picker-notify@.service', 'chunk-picker-offhost.service', 'chunk-picker-offhost.timer',
  'chunk-picker-offhost-check.service', 'chunk-picker-offhost-check.timer']);
function within(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('Recovery allowlist refused.');
}
export async function recoveryBundle({ settings, release, output, budgetOptions,
  roots = { etc: '/etc/chunk-picker', units: '/etc/systemd/system', releases: '/opt/chunk-picker/releases',
    packs: '/opt/chunk-picker/packs', tools: '/opt/chunk-picker/tools' } }) {
  const selected = path.dirname(release.pointer.config.path);
  within(roots.releases, selected); within(selected, release.config.coreRoot);
  for (const source of [roots.etc, roots.units, roots.releases, roots.packs, roots.tools, settings.backupDir]) outside(source, output);
  const plan = [], pins = [];
  const add = async (source, file, expected) => {
    await noLinks(source);
    const info = await stat(source), hash = createHash('sha256');
    if (!info.isFile()) throw Error('Recovery payload must be a file.');
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    const digest = hash.digest('hex');
    if (expected && (digest !== expected.sha256 || expected.bytes !== undefined && info.size !== expected.bytes)) throw Error('Recovery payload pin differs.');
    plan.push({ source, path: file, bytes: info.size, sha256: digest });
  };
  const tree = async (source, prefix) => {
    plan.push({ source, path: prefix, directory: true });
    for (const row of await inventory(source)) plan.push({ source: path.join(source, row.path), ...row, path: prefix + '/' + row.path });
  };
  await tree(roots.etc, 'etc'); await tree(selected, 'release');
  for (const unit of recoveryUnits) {
    const source = path.join(roots.units, unit); await add(source, 'units/' + unit);
    if (await exists(source + '.d')) await tree(source + '.d', 'units/' + unit + '.d');
  }
  await add(settings.current, 'current.json', { sha256: sha(release.pointerBytes) });
  const inputs = [[release.config.selection, false], [release.config.profile, false],
    [release.config.addons, true]].filter(([pin]) => pin);
  for (const pin of Object.values(release.config.packs ?? {})) {
    if (!pin) throw Error('Recovery pack pin missing.'); inputs.push([pin, true]);
  }
  for (const [index, [pin, payload]] of inputs.entries()) {
    if (!path.isAbsolute(pin.path ?? '') || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) throw Error('Recovery input pin invalid.');
    try { within(selected, pin.path); } catch { within(roots.packs, pin.path); }
    const prefix = 'pins/' + index, file = prefix + '/' + path.basename(pin.path);
    await add(pin.path, file, pin);
    if (payload) {
      const manifest = JSON.parse(await readFile(pin.path, 'utf8'));
      if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('Recovery payload closure missing.');
      const seen = new Set([path.basename(pin.path)]);
      for (const record of manifest.files) {
        packRelative(record.path);
        if (seen.has(record.path)
          || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw Error('Recovery payload closure invalid.');
        seen.add(record.path);
        const source = path.resolve(path.dirname(pin.path), record.path); within(path.dirname(pin.path), source);
        await add(source, prefix + '/' + record.path, record);
      }
    }
    pins.push({ path: pin.path, file, sha256: pin.sha256, payload });
  }
  // The immutable tools pointer is the sole allowed symlink.
  const tools = await realpath(roots.tools); await tree(tools, 'tools');
  const { budget, copy } = stagingBudget(path.dirname(output), settings.minFreeBytes, budgetOptions);
  await budget(plan.reduce((sum, row) => sum + (row.bytes ?? 0) + 8192, 0));
  await mkdir(output, { mode: 0o700 });
  for (const row of plan) {
    await noLinks(row.source);
    const target = path.join(output, row.path);
    await budget(8192);
    if (row.directory) await mkdir(target, { recursive: true, mode: 0o700 });
    else {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copy(row.source, target);
    }
  }
  const files = await inventory(output), byPath = new Map(files.map(row => [row.path, row]));
  for (const row of plan) if (byPath.get(row.path)?.directory !== row.directory || byPath.get(row.path)?.sha256 !== row.sha256 || byPath.get(row.path)?.bytes !== row.bytes) throw Error('Recovery copy differs.');
  await assertSameRelease(release);
  const body = { format: 'picker-rebuild-v1', selected, tools, pins, files };
  const bytes = encode({ ...body, sha256: sha(encode(body)) }); await budget(Buffer.byteLength(bytes));
  await writeFile(path.join(output, 'rebuild-manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
  return body;
}
