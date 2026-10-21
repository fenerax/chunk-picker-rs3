import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import data from '../app/data/place-labels.2026-10-13.v1.json' with { type: 'json' };
import { buildPlaceLabels, exportPlaceLabels } from '../scripts/export-place-labels.mjs';

test('versioned labels preserve exact surface anchors, cache provenance and readable names', () => {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.summary.labels, 312);
  assert.deepEqual(data.summary.levels, { region: 28, town: 58, place: 226 });
  assert.equal(data.labels.length, data.summary.labels);
  assert.equal(new Set(data.labels.map(row => row.id)).size, data.labels.length);
  assert.equal(data.provenance.sourceFiles[0].sha256,
    'dc88b9e37f0d638f9b63976bb358b76e7967e64e390d8310a12299abe8ce5312');
  assert.equal(data.provenance.decoder.commit, 'a92b8920b9b9842adde78822646ecad1a6f4fc15');
  assert.deepEqual(data.provenance.archives.map(row => [row.major, row.minor]), [[2, 36], [23, 0], [23, 1], [42, 28]]);
  const points = {
    Lumbridge: [3227, 3242], Havenhythe: [4337, 3311], Wendlewick: [4185, 3348],
    Amberfell: [4433, 3361], Heathervein: [4570, 3470], Berylbrook: [4563, 3348],
    'Linbog Village': [4599, 3255], 'Globin Village': [4679, 3178],
    Fenmoor: [4625, 3221], 'Shuruk-Ba': [4747, 3396],
  };
  for (const [name, point] of Object.entries(points)) {
    const row = data.labels.find(row => row.name === name);
    assert.ok(row, name);
    assert.deepEqual([row.x, row.y], point, name);
  }
  assert.ok(data.labels.some(row => row.name === 'Draynor Village'));
  assert.ok(data.labels.some(row => row.name === 'Kingdom of Misthalin'));
  for (const row of data.labels) {
    assert.equal(row.mapId, 28);
    assert.equal(row.plane, 0);
    assert.ok(!/[<>]/.test(row.name));
    assert.equal(row.x, row.source.x + row.transform.x);
    assert.equal(row.y, row.source.y + row.transform.y);
    assert.equal(row.chunkId, String(Math.floor(row.x / 64) * 256 + Math.floor(row.y / 64)));
    assert.ok(row.x >= 1856 && row.x < 4864 && row.y >= 1408 && row.y < 4608);
  }
  const amberfell = data.labels.find(row => row.name === 'Amberfell');
  assert.deepEqual(amberfell.transform, { x: 704, y: 1792, plane: 0 });
  assert.ok(data.labels.find(row => row.name === 'Gunnarsgrunn').conditions.length);
});

function fixture() {
  const source = { major: 42, minor: 28, index: 7, x: 3729, y: 1569, plane: 0 };
  const anchor = { mapId: 28, plane: 0, x: 4433, y: 3361, region: '17716', label: 'Amberfell',
    elementId: 5786, source, transform: { x: 704, y: 1792, plane: 0 } };
  const places = { schemaVersion: 1, provenance: { decoder: {} }, placements: [anchor,
    { ...anchor, mapId: 99 }, { ...anchor, plane: 1 }, { ...anchor, x: 4864 }],
    rawPlacements: [{ mapId: 28, index: 7, elementId: 5786, rawElement: { text: 'Amber<br>fell', font_size: 1 },
      conditional: true, conditions: [{ kind: 'toggle', varbit: 42 }] }] };
  const placesBytes = Buffer.from(JSON.stringify(places));
  const manifest = { schemaVersion: 1, generatedAt: '2026-10-08', sources: [], archives: [],
    outputs: [{ path: 'places.v1.json', bytes: placesBytes.length,
      sha256: createHash('sha256').update(placesBytes).digest('hex') }] };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return { places, placesBytes, manifest, manifestBytes };
}

test('export keeps translated text and conditions, excludes other maps/planes/crop, rejects hash drift', () => {
  const input = fixture();
  const result = buildPlaceLabels(input);
  assert.equal(result.labels.length, 1);
  assert.equal(result.labels[0].name, 'Amber fell');
  assert.equal(result.labels[0].level, 'town');
  assert.equal(result.summary.conditionalLabels, 1);
  input.placesBytes = Buffer.concat([input.placesBytes, Buffer.from(' ')]);
  assert.throws(() => buildPlaceLabels(input), /differs from its extraction manifest/);
});

test('export leaves source bytes intact and refuses source-directory writes or output overwrites', () => {
  const directory = mkdtempSync(join(tmpdir(), 'place-label-export-'));
  try {
    const input = join(directory, 'input'), output = join(directory, 'labels.json');
    mkdirSync(input);
    const { placesBytes, manifestBytes } = fixture();
    writeFileSync(join(input, 'places.v1.json'), placesBytes);
    writeFileSync(join(input, 'manifest.v1.json'), manifestBytes);
    const first = exportPlaceLabels({ input, output });
    assert.equal(first.labels[0].x, 4433);
    assert.deepEqual(readFileSync(join(input, 'places.v1.json')), placesBytes);
    assert.deepEqual(readFileSync(join(input, 'manifest.v1.json')), manifestBytes);
    assert.throws(() => exportPlaceLabels({ input, output }), /EEXIST/);
    assert.throws(() => exportPlaceLabels({ input, output: join(input, 'new.json') }), /read-only extraction/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
