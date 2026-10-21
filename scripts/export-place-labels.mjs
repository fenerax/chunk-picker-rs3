#!/usr/bin/env node
// Export already decoded cache text anchors. The cache/extraction is read-only.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PICKER_CROP, inCrop } from './cache/surface.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const levels = ['place', 'town', 'region'];

/** Preserve line breaks as word boundaries; the advisory extraction removed them. */
export function placeLabelText(text) {
  return String(text ?? '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

export function buildPlaceLabels({ places, manifest, placesBytes, manifestBytes }) {
  const declared = manifest.outputs?.find(row => basename(row.path) === 'places.v1.json');
  if (!declared || declared.sha256 !== sha256(placesBytes) || declared.bytes !== placesBytes.length)
    throw new Error('places.v1.json differs from its extraction manifest');
  if (places.schemaVersion !== 1 || manifest.schemaVersion !== 1)
    throw new Error('Unsupported place extraction schema');
  const raw = new Map(places.rawPlacements.map(row => [`${row.mapId}:${row.index}:${row.elementId}`, row]));
  const labels = places.placements.filter(row => row.mapId === 28 && row.plane === 0
    && row.label && inCrop(row.x, row.y)).map(row => {
    const record = raw.get(`${row.mapId}:${row.source.index}:${row.elementId}`);
    if (!record) throw new Error(`Missing raw placement ${row.source.index}`);
    const name = placeLabelText(record.rawElement.text);
    const size = record.rawElement.font_size ?? 0;
    if (!name || !levels[size] || !Number.isSafeInteger(row.x) || !Number.isSafeInteger(row.y))
      throw new Error(`Invalid text anchor ${row.source.index}`);
    const source = row.source, transform = row.transform;
    if (source.x + transform.x !== row.x || source.y + transform.y !== row.y
      || source.plane + transform.plane !== row.plane)
      throw new Error(`Invalid source/display transform ${source.index}`);
    const chunkId = String(Math.floor(row.x / 64) * 256 + Math.floor(row.y / 64));
    if (row.region !== chunkId) throw new Error(`Invalid display region ${source.index}`);
    return {
      id: `cache-label:28:${source.index}:${row.elementId}`,
      name, x: row.x, y: row.y, level: levels[size], priority: (size + 1) * 100,
      mapId: 28, plane: 0, chunkId, elementId: row.elementId, fontSize: size,
      source: { ...source }, transform: { ...transform },
      conditional: record.conditional, conditions: record.conditions,
    };
  }).sort((a, b) => b.priority - a.priority || a.source.index - b.source.index
    || a.x - b.x || a.y - b.y);
  if (new Set(labels.map(row => row.id)).size !== labels.length)
    throw new Error('Duplicate surface label identity');
  const archives = manifest.archives.filter(row => (row.major === 2 && row.minor === 36)
    || (row.major === 23 && [0, 1].includes(row.minor)) || (row.major === 42 && row.minor === 28))
    .map(({ major, minor, sha256, hashScope, version }) => ({ major, minor, sha256, hashScope, version }));
  return {
    schemaVersion: 1, id: 'place-labels:2026-10-13:v1', generatedAt: '2026-10-13',
    provenance: {
      sourceSnapshot: 'places-2026-10-08-v3',
      sourceGeneratedAt: manifest.generatedAt,
      sourceFiles: [
        { file: 'places.v1.json', bytes: placesBytes.length, sha256: sha256(placesBytes) },
        { file: 'manifest.v1.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
      ],
      decoder: places.provenance.decoder,
      cacheSources: manifest.sources.filter(row => [2, 23, 42].includes(row.major)),
      archives,
      exporter: 'scripts/export-place-labels.mjs',
    },
    coordinateSystem: { mapId: 28, plane: 0, units: 'display tiles', crop: PICKER_CROP,
      projection: 'gridX=(x-1856)/64; gridY=(4608-y)/64; north is up' },
    method: 'All nonempty map-28 plane-0 text anchors within the picker crop. Exact cache paste translations and raw resolved text are retained. Cache font sizes 2, 1, 0 become visual region, town, place levels with priorities 300, 200, 100.',
    limits: [
      'Labels are display anchors, not town boundaries, gameplay access, or transport destinations.',
      'Levels follow cache typography; town also includes some mountains, swamps and regional features.',
      'Conditional and duplicate label variants remain available; no personal varbit state is inferred.',
      'Static copied-cache snapshot from October 2026; inferred schema build is not independently verified.',
    ],
    summary: { labels: labels.length,
      regions: new Set(labels.map(row => row.chunkId)).size,
      levels: Object.fromEntries([...levels].reverse().map(level => [level, labels.filter(row => row.level === level).length])),
      conditionalLabels: labels.filter(row => row.conditional || row.conditions.length).length },
    labels,
  };
}

export function exportPlaceLabels({ input, output }) {
  if (!input || !output) throw new Error('Supply --input extracted directory --output NEW.json');
  const directory = resolve(input), target = resolve(output), inside = relative(directory, target);
  if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))
    throw new Error('Output must be outside the read-only extraction directory');
  const placesBytes = readFileSync(join(directory, 'places.v1.json'));
  const manifestBytes = readFileSync(join(directory, 'manifest.v1.json'));
  const result = buildPlaceLabels({ places: JSON.parse(placesBytes), manifest: JSON.parse(manifestBytes),
    placesBytes, manifestBytes });
  writeFileSync(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (!['--input', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Use --input DIRECTORY --output NEW.json');
      options[args[i].slice(2)] = args[i + 1];
    }
    console.log(JSON.stringify(exportPlaceLabels(options).summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
