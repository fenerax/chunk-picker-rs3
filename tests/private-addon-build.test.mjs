import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { linkPrivateModule } from '../scripts/build-private-addon.mjs';
import { privateCompanionSource } from '../scripts/build-private-companion.mjs';

test('companion source never shadows shared files or public templates and retains private test scenarios', () => {
  const rules = { entries: [{ path: 'app/shared.mjs' }, { path: 'tests/shared.test.mjs' }], deniedPaths: [],
    overrides: { 'README.md': 'scripts/public-export/templates/README.md', 'scripts/test.mjs': 'scripts/public-export/templates/test.mjs', 'scripts/test-selection.mjs': 'scripts/public-export/templates/test-selection.mjs' } };
  assert.equal(privateCompanionSource('README.md', rules), false);
  assert.equal(privateCompanionSource('app/shared.mjs', rules), false);
  for (const name of ['app/private.mjs', 'tests/shared.test.mjs', 'tests/private.test.mjs', 'scripts/test-selection.mjs', 'scripts/test.mjs']) assert.equal(privateCompanionSource(name, rules), true);
  assert.equal(privateCompanionSource('reference/picture.png', rules), false);
});

test('private linker accepts only the reviewed imports and blocks new executable dependencies', () => {
  const linked = linkPrivateModule("import { selectedDataset } from '../dataset-runtime.mjs';\nexport const value = selectedDataset;\n", 'fixture');
  assert.match(linked.body, /const \{ selectedDataset \} = core.datasetRuntime/);
  assert.match(linked.body, /return \{ value \}/);
  assert.throws(() => linkPrivateModule("import { run } from './unknown.mjs';\nexport const value = run();", 'fixture'));
  assert.throws(() => linkPrivateModule("export const value = import('./unknown.mjs');", 'fixture'));
  assert.throws(() => linkPrivateModule("import './unknown.mjs';\nexport const value = 1;", 'fixture'));
});

test('independent defaults clear every private profile and executable add-on selection before imports', async () => {
  const source = await readFile(new URL('../scripts/start-independent-game.mjs', import.meta.url), 'utf8');
  const [before] = source.split("const { startServer } = await import('../app/server.mjs')");
  for (const key of ['RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256']) assert.ok(before.includes(`'${key}'`));
  assert.match(before, /delete process\.env\[key\]/);
});

test('private sync bundle is self-contained and preserves original entry exports', async () => {
  const rows = [];
  for (const [filename, name] of [['../app/integrations/original-local-changes.mjs', 'localChanges'],
    ['../app/integrations/original-tasks.mjs', 'taskReview'], ['../app/capture-maps.mjs', 'captureMaps'],
    ['../app/integrations/original-sync.mjs', 'sync']]) rows.push(linkPrivateModule(await readFile(new URL(filename, import.meta.url), 'utf8'), name));
  const source = [...new Set(rows.flatMap(row => row.builtins))].join('\n') + '\nexport function createIntegration(core) {\n' + rows.map(row => row.body).join('\n') + '\nreturn sync;\n}';
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.doesNotMatch(source, /from ['"]\./);
  const { createIntegration } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const integration = createIntegration({ datasetRuntime: { selectedDataset: { gameDefaults: { members: [] } } }, migration: {}, collection: {}, settings: {}, identity: {} });
  for (const name of ['createOriginalSyncClient', 'previewOriginalSync', 'originalSyncCommand']) assert.equal(typeof integration[name], 'function');
});
