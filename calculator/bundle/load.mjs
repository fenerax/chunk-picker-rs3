import path from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decode } from './codec.mjs';

export const CONTRACT_VERSION = 1;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const fail = () => { throw new Error('Calculator bundle verification failed.'); };
export function relativeFile(file) {
  if (typeof file !== 'string' || !file || /[\\:\x00]/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) fail();
  return file;
}
async function safeRead(root, file, expectedBytes) {
  relativeFile(file);
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail();
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > (file === 'manifest.json' ? 8 : 128) * 1024 ** 2
    || expectedBytes !== undefined && info.size !== expectedBytes) fail();
  return readFile(current);
}
const contract = dataset => Object.fromEntries(['datasetId', 'datasetContractVersion', 'identityNamespace', 'coordinateSystem', 'corePackApi'].map(key => [key, dataset[key]]));
export function identityDigest(dataset, encodedValues) {
  if (dataset.datasetId === 'duo-legacy') {
    const files = dataset.files.filter(row => ['input', 'evidence'].includes(row.kind))
      .map(({ path, bytes, sha256, kind }) => ({ path, bytes, sha256, kind })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
    return sha256(JSON.stringify({ contract: contract(dataset), capabilities: dataset.capabilities, overlayOrder: dataset.overlayOrder, files,
      ...(dataset.definitionOverlays?.length ? { definitionOverlays: dataset.definitionOverlays } : {}) }));
  }
  if (dataset.datasetId === 'open-f2p') return sha256(JSON.stringify({ contract: contract(dataset), values: encodedValues,
    files: dataset.files, ruleContractHash: dataset.ruleContractHash, gameDefaults: dataset.gameDefaults }));
  fail();
}

/** All data is read, hashed and owned here before the provider becomes visible.
 * expectedManifestSha256 pins the bundle's provenance when crossing machines;
 * the dataset digest alone does not authenticate server-prepared definitions. */
export async function loadBundle(directory, { expectedDatasetDigest, expectedManifestSha256 } = {}) {
  try {
    const root = path.resolve(directory);
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) fail();
    const manifestBytes = await safeRead(root, 'manifest.json'), manifest = JSON.parse(manifestBytes);
    if (expectedManifestSha256 !== undefined && sha256(manifestBytes) !== expectedManifestSha256) fail();
    if (manifest.contractVersion !== CONTRACT_VERSION || !hex(manifest.datasetDigest)
      || manifest.datasetContractVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 10000
      || expectedDatasetDigest !== undefined && manifest.datasetDigest !== expectedDatasetDigest) fail();
    const files = new Map();
    let total = 0;
    for (const record of manifest.files) {
      relativeFile(record.file);
      if (record.file === 'manifest.json' || files.has(record.file) || !hex(record.sha256)
        || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > 128 * 1024 ** 2) fail();
      total += record.bytes; if (total > 1024 ** 3) fail();
      const data = await safeRead(root, record.file, record.bytes);
      if (data.length !== record.bytes || sha256(data) !== record.sha256) fail();
      files.set(record.file, data);
    }
    const json = key => { if (!files.has(key)) fail(); return JSON.parse(files.get(key)); };
    const dataset = json('dataset.json'), init = decode(json('init.json')), audit = json('audit.json');
    if (dataset.digest !== manifest.datasetDigest || init.datasetDigest !== dataset.digest
      || init.datasetSelection?.digest !== dataset.digest || dataset.datasetContractVersion !== manifest.datasetContractVersion
      || !Array.isArray(dataset.valueFiles) || !Array.isArray(dataset.jsonFiles)) fail();
    const values = {}, encodedValues = {};
    for (const key of dataset.valueFiles) {
      const document = json(key);
      if (document.schemaVersion !== 1 || !document.values || typeof document.values !== 'object') fail();
      for (const [name, value] of Object.entries(document.values)) {
        if (Object.hasOwn(encodedValues, name)) fail();
        Object.defineProperty(encodedValues, name, { value, enumerable: true });
        Object.defineProperty(values, name, { value: decode(value), enumerable: true });
      }
    }
    if (identityDigest(dataset, encodedValues) !== dataset.digest) fail();
    const jsonFiles = new Set(dataset.jsonFiles), cache = new Map();
    for (const key of new Set([...dataset.jsonFiles, ...dataset.valueFiles])) {
      const data = files.get(key), source = dataset.files.find(row => row.path === key && row.kind === 'input');
      if (!data || dataset.datasetId === 'duo-legacy' && (!source || source.bytes !== data.length || source.sha256 !== sha256(data))) fail();
      if (dataset.datasetId === 'open-f2p' && jsonFiles.has(key) && (!source || source.bytes !== data.length || source.sha256 !== sha256(data))) fail();
    }
    for (const input of audit.inputs) {
      if (input.kind === 'value' ? !Object.hasOwn(values, input.key) : !jsonFiles.has(input.key)) fail();
    }
    const unavailable = () => { throw new Error('Calculator bundle input unavailable.'); };
    const provider = Object.freeze({ ...dataset, status: () => dataset.status,
      value(key) { return Object.hasOwn(values, key) ? values[key] : unavailable(); },
      json(key) { if (!jsonFiles.has(key)) return unavailable(); if (!cache.has(key)) cache.set(key, json(key)); return cache.get(key); },
      bytes(key) { if (!jsonFiles.has(key)) return unavailable(); return Buffer.from(files.get(key)); },
      workerSelection: () => ({ datasetId: dataset.datasetId, digest: dataset.digest }),
      serialize: () => ({ datasetId: dataset.datasetId, digest: dataset.digest }),
    });
    return { init, provider, manifest, audit, manifestSha256: sha256(manifestBytes), bytes: total + manifestBytes.length };
  } catch { fail(); }
}
