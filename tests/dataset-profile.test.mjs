import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDatasetProfile, datasetProfileSelection, loadDatasetProfile } from '../app/dataset-profile.mjs';
import { datasetDigest } from '../app/datasets.mjs';
import { selectedDataset, adoptLegacyMetadataProvider } from '../app/dataset-runtime.mjs';

const profile = () => ({ schemaVersion: 1, datasetId: 'duo-legacy', datasetDigest: 'a'.repeat(64), ruleContractHash: 'b'.repeat(64),
  catalogue: { inputs: ['catalogue/inputs.json'], sourceInputs: ['evidence/source.mjs'], valueKeys: ['catalogue/module.mjs#contract'],
    ruleTextValueKeys: ['catalogue/module.mjs#text'], ruleContractValueKeys: ['catalogue/module.mjs#contract'] },
  gameDefaults: { members: [{ id: 'player-a', name: 'Player A' }], masterLabel: 'Administrator' } });

test('installed profiles contain data only and freeze their catalogue and defaults', () => {
  const value = validateDatasetProfile(profile());
  assert.ok(Object.isFrozen(value.catalogue.inputs));
  assert.ok(Object.isFrozen(value.gameDefaults.members[0]));
  for (const change of [
    value => { value.hooks = ['run']; },
    value => { value.catalogue.inputs = ['../escape.json']; },
    value => { value.catalogue.sourceInputs = ['/absolute.mjs']; },
    value => { value.catalogue.ruleContractValueKeys = ['unlisted.mjs#contract']; },
    value => { value.gameDefaults.members.push({ ...value.gameDefaults.members[0] }); },
    value => { value.gameDefaults.compatibility = { worldImagesPath: ['..'] }; },
  ]) { const value = profile(); change(value); assert.throws(() => validateDatasetProfile(value)); }
});

test('profile selection requires both an absolute operator path and exact digest', () => {
  assert.equal(datasetProfileSelection({}, {}), null);
  assert.throws(() => datasetProfileSelection({}, { RS3_DATASET_PROFILE: 'relative.json' }));
  assert.throws(() => datasetProfileSelection({ profilePath: path.resolve('profile.json'), profileSha256: 'bad' }, {}));
});

test('profile-selected definition overlays must be unique listed JSON inputs', () => {
  const value = profile(); value.catalogue.definitionOverlays = ['catalogue/inputs.json'];
  assert.deepEqual(validateDatasetProfile(value).catalogue.definitionOverlays, ['catalogue/inputs.json']);
  for (const paths of [['unlisted.json'], ['catalogue/inputs.json', 'catalogue/inputs.json'], ['evidence/source.mjs']]) {
    const value = profile(); value.catalogue.definitionOverlays = paths;
    assert.throws(() => validateDatasetProfile(value));
  }
});

test('overlay selection changes the storage-binding digest even with identical files', () => {
  const files = [{ path: 'catalogue/review.json', bytes: 20, sha256: 'c'.repeat(64), kind: 'input' }];
  assert.notEqual(datasetDigest(files, {}), datasetDigest(files, {}, ['catalogue/review.json']));
});

test('metadata provider adoption refuses changed overlay selection after materialization', () => {
  const candidate = { ...selectedDataset, digest: 'f'.repeat(64), definitionOverlays: ['catalogue/review.json'] };
  assert.throws(() => adoptLegacyMetadataProvider(candidate), /restart/);
});

test('profile integrity fails closed before a changed default can be used', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dataset-profile-'));
  try {
    const profilePath = path.join(directory, 'installed.json'), bytes = JSON.stringify(profile());
    await writeFile(profilePath, bytes);
    const options = { profilePath, profileSha256: createHash('sha256').update(bytes).digest('hex') };
    const installed = await loadDatasetProfile(options);
    assert.deepEqual(installed.profile.gameDefaults, profile().gameDefaults);
    await writeFile(profilePath, bytes.replace('Player A', 'Player B'));
    await assert.rejects(loadDatasetProfile(options), /Invalid installed dataset profile/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
