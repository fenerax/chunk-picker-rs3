import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { loadDatasetInputs, loadOriginalSyncIntegration } from '../app/dataset-bootstrap.mjs';
import { loadOriginalSyncPanel, mountOriginalSyncControl } from '../app/web/original-sync-loader.mjs';

const disabled = { capabilities: { independent: true, features: { originalSync: false } } };

test('disabled integration imports neither server client nor browser panel', async () => {
  let imports = 0;
  const load = () => { imports++; throw new Error('Private module is absent'); };
  assert.equal(await loadOriginalSyncIntegration(disabled, load), null);
  assert.equal(await loadOriginalSyncPanel(disabled, load), null);
  assert.equal(imports, 0);
});

test('legacy and explicitly enabled providers retain the original integration exports', async () => {
  const integration = { createOriginalSyncClient() {}, createOriginalSync() {} };
  for (const dataset of [{ capabilities: {} }, { capabilities: { features: { originalSync: true } } }]) {
    assert.equal(await loadOriginalSyncIntegration(dataset, async () => integration), integration);
    assert.equal(await loadOriginalSyncPanel(dataset, async () => integration), integration.createOriginalSync);
  }
});

function independentInputs() {
  const definitions = Buffer.from('{"chunks":{}}\n'), taskMap = Buffer.from('{}\n');
  const values = new Map([['independent/definitions.json', definitions], ['independent/tasks.json', taskMap]]);
  const input = path => ({ path, sha256: createHash('sha256').update(values.get(path)).digest('hex') });
  const selection = { definitions: input('independent/definitions.json'), taskMap: input('independent/tasks.json') };
  return { ...disabled, selection, values, json: async () => selection, bytes: path => values.get(path) };
}

test('independent bootstrap uses pinned provider bytes without a legacy loader', async () => {
  const provider = independentInputs();
  const result = await loadDatasetInputs(provider, {}, () => { throw new Error('Legacy loader is absent'); });
  assert.equal(result.selection, provider.selection);
  assert.equal(result.definitionBytes, provider.values.get('independent/definitions.json'));
  assert.equal(result.taskBytes, provider.values.get('independent/tasks.json'));
  const omitted = await loadDatasetInputs(provider, { loadDefinitions: false, loadTaskMap: false });
  assert.equal(omitted.definitionBytes, undefined); assert.equal(omitted.taskBytes, undefined);
});

test('independent bootstrap refuses malformed selections and changed bytes', async () => {
  const provider = independentInputs();
  provider.values.set('independent/definitions.json', Buffer.from('changed'));
  await assert.rejects(loadDatasetInputs(provider), /hash mismatch/);
  provider.selection.definitions.sha256 = 'bad';
  await assert.rejects(loadDatasetInputs(provider), /Invalid dataset input selection/);
});

test('private bootstrap delegates unchanged options to its existing loader', async () => {
  const dataset = { capabilities: {} }, output = {};
  let options;
  assert.equal(await loadDatasetInputs(dataset, { loadDefinitions: false }, async () => ({
    loadOriginalData(value) { options = value; return output; },
  })), output);
  assert.deepEqual(options, { dataset, loadDefinitions: false, loadTaskMap: true });
});

test('packed compatibility inputs retain canonical text hashes without the private loader', async () => {
  const provider = independentInputs();
  provider.packed = true;
  provider.capabilities = {};
  const bytes = Buffer.from('{"chunks":{}}\r\n');
  provider.values.set('independent/definitions.json', bytes);
  provider.selection.definitions.sha256 = sha256RepositoryText(bytes);
  provider.selection.taskMap.sha256 = sha256RepositoryText(provider.values.get('independent/tasks.json'));
  const result = await loadDatasetInputs(provider, {}, () => { throw new Error('Private loader absent'); });
  assert.equal(result.definitionBytes, bytes);
  provider.selection.definitions.path = '../escape.json';
  await assert.rejects(loadDatasetInputs(provider), /Invalid dataset input path/);
});

test('private sync control mounts at the existing menu position without duplicates', () => {
  let control, mounts = 0;
  const c = { $: id => id === 'original-sync-open' ? control : { before(node) { control = node; mounts++; } },
    el: (tag, textContent) => ({ tag, textContent }) };
  mountOriginalSyncControl(c); mountOriginalSyncControl(c);
  assert.deepEqual(control, { tag: 'button', textContent: 'Sync from original picker', id: 'original-sync-open' });
  assert.equal(mounts, 1);
});
