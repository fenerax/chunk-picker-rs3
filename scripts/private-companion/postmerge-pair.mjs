// Pure test-context construction. This never stages or activates a release.
import path from 'node:path';
import { readdir, mkdir, cp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { digestValue } from './release-identity.mjs';
import { copyPreviousTextSource, applyTextEntries, validateReleaseTextInput } from './release-text.mjs';
import { regularInput } from './file-test-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function toolInputs(config) {
  const root = config.toolsSource ?? path.join(config.privateSource, 'scripts/private-companion');
  const names = (await readdir(root)).filter(name => name.endsWith('.mjs') || ['approved-workflows.json', 'approved-neutral-workflow.json'].includes(name)).sort();
  const files = new Map(await Promise.all(names.map(async name => [name, path.join(root, name)])));
  // Match stageReleaseKit's final override from the accepted kit.
  if (config.acceptedKit) files.set('gallery-browser-check.mjs', path.join(config.acceptedKit, 'tools/gallery-browser-check.mjs'));
  return files;
}
export async function toolDigest(config) {
  const files = await toolInputs(config);
  return digestValue(await Promise.all([...files].sort(([a], [b]) => a.localeCompare(b)).map(async ([name, file]) => ({ name, sha256: hash(await regularInput(file)) }))));
}
export async function copyTools(config, target) {
  await mkdir(target, { recursive: true });
  for (const [name, file] of await toolInputs(config)) await cp(file, path.join(target, name), { errorOnExist: true, force: false });
}
export async function copyOperators(config, target) {
  await mkdir(target, { recursive: true });
  const root = config.toolsSource ?? path.join(config.privateSource, 'scripts/private-companion');
  for (const name of (await readdir(root)).sort()) {
    if (name.endsWith('.ps1') || name === 'RELEASING.md') await cp(path.join(root, name), path.join(target, name), { errorOnExist: true, force: false });
  }
}
export async function operatorDigest(config) {
  const root = config.toolsSource ?? path.join(config.privateSource, 'scripts/private-companion');
  const files = (await readdir(root)).filter(name => name.endsWith('.ps1') || name === 'RELEASING.md').sort();
  return digestValue(await Promise.all(files.map(async name => ({ name, sha256: hash(await regularInput(path.join(root, name))) }))));
}
export async function textPins(config) {
  if (config.textFromReceipt) {
    if (config.request || config.current) throw Error('Choose explicit next request or frozen receipt text.');
    const receipt = JSON.parse(await regularInput(config.textFromReceipt));
    const files = receipt.textOverrides;
    if (!Array.isArray(files) || files.length !== 2 || new Set(files.map(file => file.path)).size !== 2) throw Error('Frozen receipt text inventory refused.');
    const text = [];
    for (const file of files) {
      if (!['app/data/changelog.json', 'app/data/roadmap.json'].includes(file.path) || !path.isAbsolute(file.source ?? '')) throw Error('Frozen receipt text path refused.');
      const sha256 = hash(await regularInput(file.source));
      if (sha256 !== file.sha256) throw Error('Frozen receipt text changed.');
      text.push({ path: file.path, sha256 });
    }
    return { available: true, mode: 'frozen-receipt', text: text.sort((a, b) => a.path.localeCompare(b.path)) };
  }
  if (!config.request && !config.current) return { available: false };
  if (!config.request || !config.current) throw Error('Postmerge request and current pointer must be supplied together.');
  const requestBytes = await regularInput(config.request), pointerBytes = await regularInput(config.current);
  const request = JSON.parse(requestBytes), pointer = JSON.parse(pointerBytes);
  validateReleaseTextInput({ changelog: request.changelog, roadmap: request.roadmap });
  if (pointer.schemaVersion !== 2 || !path.isAbsolute(pointer.config?.path ?? '')) throw Error('Postmerge current pointer refused.');
  const configBytes = await regularInput(pointer.config.path);
  if (hash(configBytes) !== pointer.config.sha256) throw Error('Postmerge previous config changed.');
  const previousConfig = JSON.parse(configBytes), addonBytes = await regularInput(previousConfig.addons.path);
  if (hash(addonBytes) !== previousConfig.addons.sha256) throw Error('Postmerge previous addon changed.');
  const addon = JSON.parse(addonBytes), text = [];
  for (const name of ['changelog.json', 'roadmap.json']) {
    const bytes = await regularInput(path.join(path.dirname(previousConfig.addons.path), 'app/data', name));
    const pin = addon.files.find(file => file.path === 'app/data/' + name)?.sha256;
    if (hash(bytes) !== pin) throw Error('Postmerge previous text changed.');
    text.push({ name, sha256: pin });
  }
  return { available: true, request: hash(requestBytes), pointer: hash(pointerBytes), previousConfig: hash(configBytes), addon: hash(addonBytes), text };
}
export async function buildText(config, release) {
  if (!(await textPins(config)).available) return [];
  if (config.textFromReceipt) {
    const receipt = JSON.parse(await regularInput(config.textFromReceipt));
    await mkdir(path.join(release, 'text'));
    const files = [];
    for (const item of receipt.textOverrides) {
      const source = path.join(release, 'text', path.basename(item.path));
      await cp(item.source, source, { errorOnExist: true, force: false });
      files.push({ path: item.path, source, sha256: hash(await regularInput(source)) });
    }
    return files;
  }
  const request = JSON.parse(await regularInput(config.request));
  const pointer = JSON.parse(await regularInput(config.current));
  const previousConfig = JSON.parse(await regularInput(pointer.config.path));
  const root = path.join(release, '.local/text-source');
  await copyPreviousTextSource(root, previousConfig);
  await applyTextEntries(root, validateReleaseTextInput({ changelog: request.changelog, roadmap: request.roadmap }));
  const overrides = [];
  await mkdir(path.join(release, 'text'));
  for (const name of ['changelog.json', 'roadmap.json']) {
    const bytes = await regularInput(path.join(root, 'app/data', name)), source = path.join(release, 'text', name);
    await writeFile(source, bytes, { flag: 'wx' });
    overrides.push({ path: 'app/data/' + name, source, sha256: hash(bytes) });
  }
  return overrides;
}

export function pairProgress({ lane, completed = 0, total = null, active = 0, waitingFor = null, elapsedMs = null } = {}) {
  const remaining = total === null ? null : Math.max(0, total - completed);
  const canEstimate = completed >= 5 && remaining !== null && Number.isFinite(elapsedMs) && elapsedMs > 0 && !waitingFor;
  return { lane: lane ?? null, completed, total, active, remaining, waitingFor, elapsedMs,
    etaSeconds: canEstimate ? Math.ceil(remaining * elapsedMs / completed / 1000) : null,
    etaBasis: canEstimate ? 'rough observed average of this lane; excludes later lanes and queued pairs' : 'unknown; insufficient progress or waiting for resources' };
}
