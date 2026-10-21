import path from 'node:path';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeArtFile, packRelative } from './packs.mjs';

const digest = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new TypeError('Invalid installed dataset profile.'); };
const fingerprint = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const catalogueKeys = ['inputs', 'sourceInputs', 'valueKeys', 'ruleTextValueKeys', 'ruleContractValueKeys'];
const freeze = value => {
  if (value && typeof value === 'object') { for (const row of Object.values(value)) freeze(row); Object.freeze(value); }
  return value;
};

/** Operator-installed data only. It cannot provide modules, hooks or routes. */
export function validateDatasetProfile(value) {
  if (!plain(value) || value.schemaVersion !== 1 || value.datasetId !== 'duo-legacy'
    || !digest.test(value.datasetDigest ?? '') || !digest.test(value.ruleContractHash ?? '')
    || !plain(value.catalogue) || !plain(value.gameDefaults)) fail();
  if (Object.keys(value).some(key => !['schemaVersion', 'datasetId', 'datasetDigest', 'ruleContractHash', 'catalogue', 'gameDefaults'].includes(key))
    || Object.keys(value.catalogue).some(key => ![...catalogueKeys, 'definitionOverlays'].includes(key))) fail();
  for (const key of catalogueKeys) {
    const rows = value.catalogue[key];
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000 || rows.some(row => typeof row !== 'string' || row.length > 512)) fail();
    for (const row of rows) {
      const [filename, name, extra] = row.split('#');
      packRelative(filename);
      if (key.endsWith('Inputs') || key === 'inputs') { if (name !== undefined) fail(); }
      else if (!name || extra !== undefined || /[\u0000-\u001f\u007f]/u.test(name)) fail();
    }
  }
  const values = new Set([...value.catalogue.valueKeys, ...value.catalogue.ruleTextValueKeys]);
  if (value.catalogue.definitionOverlays !== undefined) {
    const overlays = value.catalogue.definitionOverlays;
    if (!Array.isArray(overlays) || overlays.length > 100 || new Set(overlays).size !== overlays.length
      || overlays.some(key => typeof key !== 'string' || !key.endsWith('.json') || !value.catalogue.inputs.includes(key))) fail();
  }
  if (value.catalogue.ruleContractValueKeys.some(key => !values.has(key))) fail();
  const defaults = value.gameDefaults;
  if (!Array.isArray(defaults.members) || !defaults.members.length || defaults.members.length > 32
    || typeof defaults.masterLabel !== 'string' || !defaults.masterLabel || defaults.masterLabel.length > 200) fail();
  const ids = new Set();
  for (const member of defaults.members) {
    if (!plain(member) || typeof member.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(member.id) || ids.has(member.id)
      || typeof member.name !== 'string' || !member.name || member.name.length > 200
      || (member.mapId !== undefined && (typeof member.mapId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(member.mapId)))
      || Object.keys(member).some(key => !['id', 'name', 'mapId'].includes(key))) fail();
    ids.add(member.id);
  }
  if (Object.keys(defaults).some(key => !['members', 'masterLabel', 'compatibility'].includes(key))) fail();
  if (defaults.compatibility !== undefined) {
    if (!plain(defaults.compatibility) || Object.keys(defaults.compatibility).some(key => !['worldImagesPath', 'notableExplorationTaskId'].includes(key))) fail();
    if (defaults.compatibility.worldImagesPath !== undefined) {
      if (!Array.isArray(defaults.compatibility.worldImagesPath) || !defaults.compatibility.worldImagesPath.length) fail();
      for (const part of defaults.compatibility.worldImagesPath) { packRelative(part); if (part.includes('/')) fail(); }
    }
    if (defaults.compatibility.notableExplorationTaskId !== undefined && (typeof defaults.compatibility.notableExplorationTaskId !== 'string'
      || defaults.compatibility.notableExplorationTaskId.length > 200)) fail();
  }
  return freeze(value);
}

export function datasetProfileSelection(options = {}, environment = process.env) {
  const profilePath = options.profilePath ?? environment.RS3_DATASET_PROFILE;
  const profileSha256 = options.profileSha256 ?? environment.RS3_DATASET_PROFILE_SHA256;
  if (!profilePath && !profileSha256) return null;
  if (typeof profilePath !== 'string' || !path.isAbsolute(profilePath) || !digest.test(profileSha256 ?? '')) fail();
  return Object.freeze({ profilePath: path.resolve(profilePath), profileSha256 });
}

export async function loadDatasetProfile(options = {}) {
  const selection = datasetProfileSelection(options);
  if (!selection) return null;
  try {
    const { profilePath, profileSha256 } = selection;
    await safeArtFile(path.dirname(profilePath), path.basename(profilePath));
    const handle = await open(profilePath, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 4 * 1024 ** 2) fail();
      const bytes = await handle.readFile();
      if (bytes.length !== before.size || createHash('sha256').update(bytes).digest('hex') !== profileSha256) fail();
      await safeArtFile(path.dirname(profilePath), path.basename(profilePath));
      if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await lstat(profilePath))) fail();
      return { ...selection, profile: validateDatasetProfile(JSON.parse(bytes.toString('utf8'))) };
    } finally { await handle.close(); }
  } catch { fail(); }
}
