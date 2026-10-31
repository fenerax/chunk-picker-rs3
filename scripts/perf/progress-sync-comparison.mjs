// Synthetic only. Compare the complete successful sync trace against a checkout.
// Usage: node scripts/perf/progress-sync-comparison.mjs /tmp/g15-start
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createGroupState } from '../../app/core/state.mjs';
import { observedSkills } from '../../app/core/game-progress.mjs';

const reference = process.argv[2];
if (!reference) throw new Error('Pass the START checkout path.');
const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/progress-sources/runemetrics.json', import.meta.url), 'utf8'));
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
async function corpus(api) {
  const traces = [];
  for (const recorded of cases) {
    const client = api.createProgressSources({ clock, runeMetrics: { fetchImpl: async url =>
      new Response(JSON.stringify(url.pathname.endsWith('/quests') ? recorded.quests : recorded.profile)) } });
    try {
      const snapshot = await client.snapshot(initial.members[0]);
      const proposal = api.previewProgress(initial, 'player', snapshot, api.createQuestMapping(definitions));
      const applied = api.applyCommand(initial, proposal.command, { expectedRevision: initial.revision, now: fixture.fetchedAt });
      traces.push({ snapshot, proposal, applied });
    } finally { client.close(); }
  }
  return Buffer.from(JSON.stringify(traces));
}
const baseline = await corpus(before), result = await corpus(after);
assert.deepEqual(result, baseline, 'Successful sync output differs from START');
const timing = async api => {
  const runs = [];
  for (let i = 0; i < 7; i++) {
    const started = performance.now(); await corpus(api); runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  return { medianMs: runs[3], minMs: runs[0], maxMs: runs.at(-1) };
};
console.log(JSON.stringify({ cases: cases.length, differences: 0, bytes: result.length,
  sha256: createHash('sha256').update(result).digest('hex'), before: await timing(before), after: await timing(after),
  peakRssKiB: process.resourceUsage().maxRSS }, null, 2));
