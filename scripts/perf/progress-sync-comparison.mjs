// Synthetic only. Compare the complete successful sync trace against a checkout.
// Usage: RS3_DATASET=open-f2p node scripts/perf/progress-sync-comparison.mjs /tmp/g15-main
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syncFixture } from './progress-sync.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createGroupState } from '../../app/core/state.mjs';
import { observedSkills } from '../../app/core/game-progress.mjs';

const reference = process.argv[2];
if (!reference) throw new Error('Pass the main checkout path.');
const fixture = {
  profile: { name: 'Player x', skillvalues: [{ id: 0, level: 5, xp: 4000 }, { id: 14, level: 6, xp: 6000 }] },
  quests: { quests: [{ title: 'Synthetic Quest', status: 'COMPLETED' }] },
  fetchedAt: '2026-10-31T12:00:00.000Z', cached: false,
};
const originalFixture = JSON.parse(await readFile(new URL('../../tests/fixtures/progress/player-x.json', import.meta.url)));
const clock = () => Date.parse(fixture.fetchedAt);
const load = async root => ({
  ...await import(pathToFileURL(resolve(root, 'app/integrations/progress-sources.mjs'))),
  ...await import(pathToFileURL(resolve(root, 'app/integrations/quest-mapping.mjs'))),
  ...await import(pathToFileURL(resolve(root, 'app/core/state.mjs'))),
});
const currentRoot = fileURLToPath(new URL('../..', import.meta.url));
const before = await load(reference), after = await load(currentRoot);
const definitions = { challenges: { Quest: { 'Synthetic Quest': { QuestPoints: 1 } } } };
const initial = createGroupState([{ id: 'player', name: 'Player x' }]);
initial.members[0].runescapeName = 'Player x';
initial.tasks = [...after.createQuestMapping(definitions).values()].flat().map(row => ({ id: row.taskId, label: row.label, category: 'Quest' }));
const full = { ...fixture.profile, skillvalues: observedSkills.map((skill, id) => ({ id, level: 10 + id, xp: 10000 + id })) };
const cases = [fixture, { ...fixture, profile: full }, { ...fixture, quests: { quests: [] } },
  { ...fixture, quests: { quests: [{ title: 'Unmapped Synthetic Quest', status: 'COMPLETED' }] } },
  { ...fixture, profile: { ...fixture.profile, skillvalues: [{ id: 14, level: 0, xp: 100 }, { id: 99, level: 5, xp: 100 }] } },
  { ...fixture, profile: { ...fixture.profile, skillvalues: [] } }];
const names = ['sparse skills', 'all skills', 'no quests', 'unmapped quest', 'invalid and unknown skills', 'no skills'];
async function corpus(api, root) {
  const traces = JSON.parse(await syncFixture(root, originalFixture))
    .map((trace, index) => ({ name: index ? 'saved observation decrease' : 'empty observations', ...trace }));
  for (const [index, recorded] of cases.entries()) {
    const client = api.createProgressSources({ clock, runeMetrics: { fetchImpl: async url =>
      new Response(JSON.stringify(url.pathname.endsWith('/quests') ? recorded.quests : recorded.profile)) } });
    try {
      const snapshot = await client.snapshot(initial.members[0]);
      const proposal = api.previewProgress(initial, 'player', snapshot, api.createQuestMapping(definitions));
      const applied = api.applyCommand(initial, proposal.command, { expectedRevision: initial.revision, now: fixture.fetchedAt });
      traces.push({ name: names[index], snapshot, proposal, applied });
    } finally { client.close(); }
  }
  return traces.map(trace => ({ name: trace.name, bytes: Buffer.from(JSON.stringify(trace)) }));
}
const baseline = await corpus(before, reference), result = await corpus(after, currentRoot);
const comparisons = result.map((row, index) => {
  const expected = baseline[index].bytes;
  let differences = Math.abs(row.bytes.length - expected.length);
  for (let i = 0; i < Math.min(row.bytes.length, expected.length); i++) if (row.bytes[i] !== expected[i]) differences++;
  return { name: row.name, beforeBytes: expected.length, afterBytes: row.bytes.length, differences };
});
console.log(JSON.stringify({ comparisons }, null, 2));
assert.deepEqual(result, baseline, 'Successful sync output differs from main');
const bytes = Buffer.concat(result.map(row => row.bytes));
const timing = async (api, root) => {
  const runs = [];
  for (let i = 0; i < 7; i++) {
    const started = performance.now(); await corpus(api, root); runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  return { medianMs: runs[3], minMs: runs[0], maxMs: runs.at(-1) };
};
console.log(JSON.stringify({ cases: result.length, differences: 0, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), before: await timing(before, reference), after: await timing(after, currentRoot),
  peakRssKiB: process.resourceUsage().maxRSS }, null, 2));
