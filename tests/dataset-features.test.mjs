import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportsDatasetFeature, datasetFeatureControls, applyDatasetFeatureControls,
  datasetLaunchCopy, applyDatasetLaunchCopy } from '../app/web/dataset-features.mjs';

const features = Object.fromEntries(Object.keys(datasetFeatureControls).map(key => [key, false]));
const starter = { datasetId: 'invented-test-id', capabilities: { independent: true, features },
  status: () => ({ title: 'Sample grid', displayName: 'Sample dataset', description: 'Invented goals.' }) };

test('explicit capabilities hide and disable unsupported launchers without dataset ID matching', () => {
  const controls = new Map(Object.values(datasetFeatureControls).flat().map(id => [id, { hidden: false, disabled: false }]));
  controls.set('custom-task-open', { hidden: false, disabled: false });
  controls.set('history-open', { hidden: false, disabled: false });
  applyDatasetFeatureControls(starter, id => controls.get(id));
  for (const ids of Object.values(datasetFeatureControls)) for (const id of ids) assert.deepEqual(controls.get(id), { hidden: true, disabled: true }, id);
  for (const id of ['custom-task-open', 'history-open']) assert.deepEqual(controls.get(id), { hidden: false, disabled: false });
  assert.equal(supportsDatasetFeature({ capabilities: {} }, 'training'), true);
  assert.equal(supportsDatasetFeature({ capabilities: { features: { training: true } } }, 'training'), true);
});

test('feature gates preserve session-hidden controls and tolerate omitted controls', () => {
  const node = { hidden: true, disabled: true };
  applyDatasetFeatureControls({ capabilities: { features: { originalSync: true } } }, id => id === 'original-sync-open' ? node : null);
  assert.deepEqual(node, { hidden: true, disabled: true });
  applyDatasetFeatureControls(starter, () => null);
});

test('uifix: the Info Game heading follows its available entries', () => {
  const ids=['info-game-heading','bis-open','profile-open','finish-line-open','activity-open','teleports-open'];
  const nodes=new Map(ids.map(id=>[id,{hidden:false,disabled:false}]));
  applyDatasetFeatureControls(starter,id=>nodes.get(id));
  assert.equal(nodes.get('info-game-heading').hidden,true);
  nodes.get('bis-open').hidden=false;
  applyDatasetFeatureControls({capabilities:{}},id=>nodes.get(id));
  assert.equal(nodes.get('info-game-heading').hidden,false);
  nodes.get('bis-open').hidden=true;
  applyDatasetFeatureControls({capabilities:{}},id=>nodes.get(id));
  assert.equal(nodes.get('info-game-heading').hidden,true,'Session and preference visibility also count');
});

test('launch copy uses provider status values and independently declared capability', () => {
  const copy = datasetLaunchCopy(starter);
  assert.equal(copy.title, 'Sample grid'); assert.equal(copy.label, 'Sample dataset');
  assert.equal(copy.description, 'Invented goals.');
  assert.match(copy.instructions, /starting chunk/);
  assert.equal(datasetLaunchCopy({ datasetId: 'open-starter' }), null);
  assert.equal(datasetLaunchCopy({ capabilities: { independent: true } }).title, 'Grid challenge');
});

test('generic launch updates existing screen elements with text, retaining page structure', () => {
  const ids = ['dataset-brand', 'dataset-brand-tag', 'empty-map-title', 'empty-map-instructions', 'empty-import'];
  const nodes = new Map(ids.map(id => [id, {}])), meta = {};
  const document = { documentElement: { dataset: {} }, querySelector: () => meta, getElementById: id => nodes.get(id) };
  applyDatasetLaunchCopy(starter, document);
  assert.equal(document.title, 'Sample grid'); assert.equal(meta.content, 'Invented goals.');
  assert.equal(document.documentElement.dataset.independent, 'true');
  assert.equal(nodes.get('dataset-brand').textContent, 'Sample grid');
  assert.equal(nodes.get('empty-import').textContent, 'Restore backup');
});

test('independent icon glyph uses external CSS and a system symbol', async () => {
  const css = await readFile(new URL('../app/web/task-filters.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-independent=true\].*--font-icons:"Segoe UI Symbol"/);
  assert.match(css, /html\[data-independent=true\] \.task-pin-icon::before\{content:"★"\}/);
});
