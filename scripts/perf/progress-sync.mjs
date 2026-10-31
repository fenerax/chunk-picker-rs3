// Synthetic-only byte comparison and small sync-path timing harness.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function syncFixture(root, fixture) {
  const load = file => import(pathToFileURL(path.join(root, file)));
  const [{ createGroupState, applyCommand }, { createQuestMapping }, { createProgressSources, previewProgress }] = await Promise.all([
    load('app/core/state.mjs'), load('app/integrations/quest-mapping.mjs'), load('app/integrations/progress-sources.mjs')]);
  const mapping = createQuestMapping(fixture.definitions);
  const results = [];
  for (const saved of [false, true]) {
    let state = createGroupState([{ id: 'player-x', name: 'Player x', runescapeName: 'Player x' }]);
    state.members[0].runescapeName = 'Player x';
    state.tasks = [...mapping.values()].flat().map(row => ({ id: row.taskId, label: row.label, category: 'Quest' }));
    if (saved) state = applyCommand(state, { type: 'apply-runemetrics', memberId: 'player-x', runescapeName: 'Player x',
      fetchedAt: fixture.fetchedAt, skills: [{ skill: 'Attack', level: 6, xp: 600 }], quests: [] }, { now: () => fixture.fetchedAt });
    const client = createProgressSources({ clock: () => Date.parse(fixture.fetchedAt), runeMetrics: {
      fetchImpl: async url => new Response(JSON.stringify(url.pathname.endsWith('/quests') ? fixture.quests : fixture.profile)) } });
    try {
      const proposal = previewProgress(state, 'player-x', await client.snapshot(state.members[0]), mapping);
      const applied = applyCommand(state, proposal.command, { now: () => fixture.fetchedAt });
      results.push({ proposal, members: applied.members, history: applied.history });
    } finally { client.close(); }
  }
  return JSON.stringify(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2] ?? '.');
  const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/progress/player-x.json', import.meta.url)));
  const times = []; let bytes;
  for (let i = 0; i < 8; i++) {
    const start = performance.now(); bytes = await syncFixture(root, fixture);
    if (i) times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  if (process.argv[3]) await writeFile(process.argv[3], bytes);
  console.log(JSON.stringify({ cases: 2, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex'),
    medianMs: times[3], minMs: times[0], maxMs: times.at(-1), peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
}
