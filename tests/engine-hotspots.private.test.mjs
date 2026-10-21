import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { collectBaseItemSources } from '../app/tasks/access.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guide-rules.mjs';
import { datasetCapabilities } from '../app/datasets.mjs';

const state = () => ({ rules: { 'content.f2p': false }, taskRules: {}, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const options = overlay => ({ metadataCorrections: false, equipmentCorrections: false, skillGuideCorrectionOverlay: overlay,
  skillGuideCatalogue: { metadataCorrections: [], generatedTasks: [] } });

test('new variants retain constructor resource and archaeology modes when the environment changes', () => {
  const base = '12339', component = `${base}-1000002`, name = 'Synthetic resource';
  const definitions = { chunks: { [base]: { Object: {} } }, sections: { [base]: { 0: [] } },
    walkableChunks: [base], walkableChunksF2P: [base], challenges: { Extra: {} } };
  const catalogue = { coverage: [[base, 'decoded']], classes: [{ key: 'synthetic:resource', name, members: false, level: 1 }],
    placements: [{ id: 'synthetic:placement', objectId: 42, classKey: 'synthetic:resource', chunkId: base, components: [component] }],
    mappings: [{ name, classKeys: ['synthetic:resource'] }] };
  for (const mode of ['resources', 'archaeology']) for (const enabled of [false, true]) {
    const variable = mode === 'resources' ? 'RS3_RESOURCE_CONTENTS' : 'RS3_ARCHAEOLOGY_CONTENTS', previous = process.env[variable];
    try {
      process.env[variable] = enabled ? 'game-data' : 'retained';
      const capabilities = datasetCapabilities({ [variable]: process.env[variable] });
      const engine = createTaskEngine(definitions, { ...options(value => value), cacheWalking: true, lodestones: [],
        ...(mode === 'resources' ? { cacheResources: capabilities.cacheResources, cacheArchaeology: false, resourceCatalogue: catalogue, resourceSelectors: { mappings: catalogue.mappings } }
          : { cacheResources: false, cacheArchaeology: capabilities.cacheArchaeology, archaeologyCatalogue: catalogue }) });
      const input = state();
      input.members[0].unlocked = [base];
      input.members[0].sectionOverrides = { [component]: true };
      assert.equal(engine.evaluate(input, 'm').access.objects.includes(name), enabled, `${mode} constructor variant`);
      process.env[variable] = enabled ? 'retained' : 'game-data';
      input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
      assert.equal(engine.evaluate(input, 'm').access.objects.includes(name), enabled, `${mode} new variant`);
      input.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false;
      assert.equal(engine.evaluate(input, 'm').access.objects.includes(name), enabled, `${mode} restored variant`);
    } finally {
      if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    }
  }
});
