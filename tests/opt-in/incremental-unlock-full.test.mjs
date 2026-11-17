// Opt-in full-game proof; see docs/testing.md. Keep out of top-level discovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { loadDatasetInputs } from '../../app/dataset-bootstrap.mjs';
import { prepareServerDefinitions } from '../../app/dataset-pipeline.mjs';
import { createTaskEngine, taskId } from '../../app/tasks/engine.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { buildWorld } from '../../app/data/world.mjs';

const loaded = await loadDatasetInputs(selectedDataset, { loadTaskMap: false });
const prepared = prepareServerDefinitions(JSON.parse(loaded.definitionBytes), selectedDataset);
// Retain every full-game record, adding an isolated negative prerequisite to
// the same large closure. The independent bar appears on the first unlock,
// which neither member owns in the starting fixture.
const fixtureLabel = 'Smelt incremental fixture bar', fixtureOre = 'Incremental fixture ore', fixtureBar = 'Incremental fixture bar';
const fixtureId = taskId('Smithing', fixtureLabel);
const definitions = { ...prepared, challenges: { ...prepared.challenges,
  Nonskill: { ...prepared.challenges.Nonskill,
    'Collect incremental fixture ore*': { Chunks: ['12850'], Output: fixtureOre },
    'Collect independent incremental fixture bar*': { Chunks: ['13620'], Output: fixtureBar },
  }, Smithing: { ...prepared.challenges.Smithing,
  [fixtureLabel]: { Level: 1, Items: [fixtureOre], Output: fixtureBar, NoXp: true },
} } };
assert(Object.keys(definitions.chunks).length >= 2500, 'this differential requires the full game, not the F2P slice');
const world = buildWorld(definitions, { dataset: selectedDataset });
const candidate = createTaskEngine(definitions, { dataset: selectedDataset, incrementalUnlocks: true });
const reference = createTaskEngine(definitions, { dataset: selectedDataset, incrementalUnlocks: false });
const hash = result => createHash('sha256').update(JSON.stringify({ ...result, processing: result.processing },
  (key, value) => key === 'elapsedMs' ? undefined : value)).digest('hex');
function breadthFirst(start, size = 40) {
  const queue = [start], found = new Set();
  while (queue.length && found.size < size) {
    const chunk = queue.shift();
    if (found.has(chunk) || !world.surface.has(chunk)) continue;
    found.add(chunk);
    queue.push(...[...world.neighbors.get(chunk) ?? []].sort((a, b) => Number(a) - Number(b)));
  }
  assert.equal(found.size, size);
  return [...found];
}
const chunks = ['13620', '11570', '12341', '12342', '12343', '12080', '12086', '12087', '11569', '13365',
  '11827', '12598', '12085', '11831', '12855', '11828', '11830', '11829', '12084', '13110'];
for (const mode of ['personal', 'partner', 'alternating']) test(`full-game cold equivalence over ${mode} unlock sequence`, () => {
  const state = createGroupState([{ id: 'fixture-a', name: 'Fixture A' }, { id: 'fixture-b', name: 'Fixture B' }]);
  state.members[0].unlocked = breadthFirst('12850');
  state.members[1].unlocked = breadthFirst(mode === 'partner' ? '10806' : '12854');
  let incremental = 0, compared = 0, reused = 0;
  const sequence = mode === 'personal' ? chunks : chunks.slice(0, 8);
  for (const [index, chunk] of [null, ...sequence].entries()) {
    if (chunk) {
      const owner = mode === 'partner' ? 1 : mode === 'alternating' ? index % 2 : 0;
      if (!state.members[owner].unlocked.includes(chunk)) state.members[owner].unlocked.push(chunk);
    }
    for (const member of state.members) {
      const actual = candidate.evaluate(state, member.id);
      const expected = reference.evaluate(state, member.id, { reuseEligibility: false });
      assert.equal(hash(actual), hash(expected), `${mode}, step ${index}, ${member.id}`);
      if (mode === 'personal' && member === state.members[0]) {
        if (!chunk) assert(actual.processing.eligibleTaskIds.includes(fixtureId));
        if (chunk === '13620') assert.equal(actual.processing.sourceExclusions[fixtureId]?.kind, 'no-xp-duplicate-output');
      }
      // These nonenumerable counters also belong to the unchanged engine.
      for (const key of ['processingPasses', 'processingAccessEvaluations', 'processingBaseCollections',
        'processingFinalizations', 'processingIncrementalPasses', 'processingFallbacks', 'processingRawAccessEvaluations']) {
        assert.equal(actual.metrics[key], expected.metrics[key], key);
      }
      incremental += actual.metrics.unlockCalculation.path === 'incremental';
      reused += actual.metrics.unlockCalculation.reusedChecks;
      compared++;
    }
  }
  assert.equal(compared, 2 * (sequence.length + 1));
  assert(incremental > 0, 'the test must exercise incremental calculation');
  assert(reused > 0, 'the test must exercise dependency reuse');
});
