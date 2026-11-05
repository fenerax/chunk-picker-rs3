import path from 'node:path';
import { copyFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { assertSameRelease } from './runtime.mjs';
import { copyTree, encode, exists, inventory, noLinks, outside, sha } from './files.mjs';

export const recoveryUnits = Object.freeze(['chunk-picker.service', 'chunk-picker-backup.service', 'chunk-picker-backup.timer',
  'chunk-picker-health.service', 'chunk-picker-health.timer', 'chunk-picker-monitor.service', 'chunk-picker-monitor.timer',
  'chunk-picker-notify@.service', 'chunk-picker-offhost.service', 'chunk-picker-offhost.timer']);
function within(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Recovery allowlist refused.');
}
export async function recoveryBundle({ settings, release, output, roots = { etc: '/etc/chunk-picker', units: '/etc/systemd/system',
  releases: '/opt/chunk-picker/releases', packs: '/opt/chunk-picker/packs', tools: '/opt/chunk-picker/tools' } }) {
  const selected = path.dirname(release.pointer.config.path);
  within(roots.releases, selected); within(selected, release.config.coreRoot);
  for (const source of [roots.etc, roots.units, roots.releases, roots.packs, roots.tools, settings.backupDir]) outside(source, output);
  await mkdir(output, { mode: 0o700 });
  // Explicit roots only; no /etc-wide backup or traversal supplied by config.
  await copyTree(roots.etc, path.join(output, 'etc'));
  await copyTree(selected, path.join(output, 'release'));
  await mkdir(path.join(output, 'units'), { mode: 0o700 });
  for (const unit of recoveryUnits) {
    const source = path.join(roots.units, unit); await noLinks(source);
    await copyFile(source, path.join(output, 'units', unit), 1);
    if (await exists(source + '.d')) await copyTree(source + '.d', path.join(output, 'units', unit + '.d'));
  }
  await copyFile(settings.current, path.join(output, 'current.json'), 1);
  const inputs = [release.config.selection, release.config.profile, release.config.addons, ...Object.values(release.config.packs ?? {})].filter(Boolean);
  await mkdir(path.join(output, 'pins'), { mode: 0o700 });
  const pins = [];
  for (const [index, pin] of inputs.entries()) {
    // A pin can live inside the selected release, or the dedicated pack root.
    if (!path.relative(selected, pin.path).startsWith('..') && !path.isAbsolute(path.relative(selected, pin.path))) within(selected, pin.path);
    else within(roots.packs, pin.path);
    await noLinks(pin.path);
    const name = String(index); await copyFile(pin.path, path.join(output, 'pins', name), 1);
    if ((await inventory(path.join(output, 'pins'))).find(row => row.path === name)?.sha256 !== pin.sha256) throw Error('Recovery input pin differs.');
    pins.push({ path: pin.path, file: 'pins/' + name, sha256: pin.sha256 });
  }
  // The atomic tools pointer is the sole allowed symlink; copy its real,
  // immutable version, then let inventory reject links anywhere inside it.
  const tools = await realpath(roots.tools); await noLinks(tools);
  await copyTree(tools, path.join(output, 'tools'));
  await assertSameRelease(release);
  const body = { format: 'picker-rebuild-v1', selected, tools, pins, files: await inventory(output) };
  await writeFile(path.join(output, 'rebuild-manifest.json'), encode({ ...body, sha256: sha(encode(body)) }), { flag: 'wx', mode: 0o600 });
  return body;
}
