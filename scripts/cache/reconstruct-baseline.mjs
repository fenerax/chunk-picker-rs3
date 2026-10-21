#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePins, enumerateTerrainTiles, PIN_COMMIT } from '../../app/data/map-pins.mjs';
import { sha256 } from './cache-reader.mjs';
import { sha256RepositoryText } from '../lib/provenance-hash.mjs';

const repositoryAudit = resolve(import.meta.dirname, '../../docs/research/map-pin-exclusions.md');

// Reproduce the documented 2021 placement set without reading private assets.
// Synthetic coverage is explicit provenance, never evidence about live terrain.
export function reconstructBaseline({ rawDirectory, exclusionAudit = repositoryAudit }) {
  const inputs = [
    ['original_sprite_locations', 'original_sprite_locations-2021.json'],
    ['map_labels', 'map_labels-2021.json'],
    ['map_label_locations', 'map_label_locations-2021.json'],
  ].map(([name, file]) => {
    const bytes = readFileSync(join(rawDirectory, file));
    return { name, file, sha256: sha256(bytes), data: JSON.parse(bytes) };
  });
  const raw = Object.fromEntries(inputs.map(row => [row.name, row.data]));
  const audit = readFileSync(exclusionAudit, 'utf8');
  const excluded = new Set([...audit.matchAll(/^\|\s*(\d+)\s*\|[^\r\n]*\|\s*surface-unverified\s*\|/gm)].map(row => Number(row[1])));
  if (excluded.size !== 151) throw new Error(`Expected 151 documented excluded source indices, found ${excluded.size}`);
  const baseline = normalizePins(raw.original_sprite_locations, { labels: raw.map_labels,
    labelLocations: raw.map_label_locations, terrainTiles: enumerateTerrainTiles(2).map(row => ({ ...row, status: 'downloaded' })) });
  const rejected = baseline.pins.filter(pin => excluded.has(pin.source.index));
  if (rejected.length !== 151) throw new Error(`Expected 151 baseline exclusions, found ${rejected.length}`);
  baseline.pins = baseline.pins.filter(pin => !excluded.has(pin.source.index));
  baseline.exclusions.push(...rejected.map(pin => ({ ...pin, reason: 'surface-unverified', previouslyEligible: true,
    coverageStatus: 'synthetic-reconstruction-excluded', evidence: 'documented-source-index-exclusion' })));
  baseline.normalization.retainedPins = baseline.pins.length;
  baseline.normalization.excludedPins = baseline.exclusions.length;
  baseline.normalization.exclusionsByReason['surface-unverified'] = 151;
  baseline.normalization.previousEligibleExclusionsByReason['surface-unverified'] = 151;
  baseline.reconstruction = { method: 'Pinned public files normalized with synthetic complete coverage, then excluded documented surface-unverified source indices',
    commit: PIN_COMMIT, inputs: inputs.map(({ data, ...row }) => row), exclusionAuditSha256: resolve(exclusionAudit) === repositoryAudit ? sha256RepositoryText(audit) : sha256(audit),
    documentedIndices: [...excluded], syntheticTerrainCoverage: true, liveBaselineReadable: false,
    limits: ['Reproduces documented placement membership and counts, not unread live asset bytes or terrain metadata.'] };
  if (baseline.pins.length !== 2054 || baseline.exclusions.length !== 2803) throw new Error('Documented baseline counts disagree');
  return baseline;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [rawDirectory, output] = process.argv.slice(2);
  if (!rawDirectory || !output) throw new Error('Usage: node scripts/cache/reconstruct-baseline.mjs RAW_DIRECTORY NEW_OUTPUT');
  const baseline = reconstructBaseline({ rawDirectory });
  writeFileSync(output, JSON.stringify(baseline), { flag: 'wx' });
  console.log(JSON.stringify({ output, pins: baseline.pins.length, exclusions: baseline.exclusions.length }));
}
