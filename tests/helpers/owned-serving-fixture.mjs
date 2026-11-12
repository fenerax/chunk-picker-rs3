import path from 'node:path';
import { generate } from '../../scripts/perf/capacity/fixture.mjs';
import { catalogue, syntheticWorld } from '../../scripts/perf/capacity/model.mjs';
import { loadCapacityOwnedRelease } from '../../scripts/perf/capacity/owned-release.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { createServer } from '../../app/server.mjs';

export const profile = { name: 'smoke', seed: 'synthetic-serving', catalogue: { chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1, aliases: 100 },
  fixture: { groups: 1, rosterMix: [0, 1, 0, 0, 0], freshFraction: 1, unlockFraction: .5, historyEvents: 0, snapshots: 0, keysPerMember: 1 } };
export async function servingFixture(directory, format = 'format2') {
  const shape = { ...profile, storageFormat: format };
  const manifest = await generate(shape, directory, { workers: 1 });
  return { directory, profile: shape, manifest, group: manifest.groups[0] };
}
export async function servingServer(fixture, extra = {}) {
  const directory = fixture.directory, definitions = catalogue(profile.catalogue);
  return createServer({ dataDir: path.join(directory, 'legacy'), definitions, taskMap: {}, world: syntheticWorld(definitions, buildWorld),
    port: 0, loopbackPort: undefined, predictionPrewarm: false, now: () => Date.parse('2026-11-11T12:00:00Z'), random: () => .25,
    // Behavior fixtures own one tiny calculator, independent of unrelated host
    // pressure. The separate capacity-wrapper case keeps runtime defaults.
    taskWorkerOptions: { residency: false },
    progressSources: { clock: () => Date.parse('2026-11-11T12:00:00Z') },
    ...(fixture.profile.storageFormat === 'format2' ? { ownedFormat2: await loadCapacityOwnedRelease(directory) } : {}),
    multiPicker: { maxCalculators: 1, registryDir: path.join(directory, 'registry'), pickerRoot: path.join(directory, 'pickers'), tombstoneDir: path.join(directory, 'tombstones') },
    ...extra });
}
export async function servingRequest(app, group, route, body, plugin = false) {
  const origin = `http://127.0.0.1:${app.address().port}`;
  const response = await fetch(origin + route, { headers: { ...(plugin ? { Authorization: `Bearer ${group.members[0].key}` } : { Cookie: group.members[0].cookie }),
    ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const value = await response.json();
  return { status: response.status, value };
}
export function stableResult(value) {
  if (Array.isArray(value)) return value.map(stableResult);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['timingMs', 'evaluationMs', 'elapsedMs', 'processingMs', 'requestMs'].includes(key))
    .map(([key, child]) => [key, key === 'inviteId' ? 'synthetic-session-invite' : stableResult(child)]));
}
