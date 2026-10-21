import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDatasetProfile, datasetProfileSelection, loadDatasetProfile } from '../app/dataset-profile.mjs';
import { buildDatasetProfile } from '../scripts/build-dataset-profile.mjs';

const profile = () => ({ schemaVersion: 1, datasetId: 'duo-legacy', datasetDigest: 'a'.repeat(64), ruleContractHash: 'b'.repeat(64),
  catalogue: { inputs: ['catalogue/inputs.json'], sourceInputs: ['evidence/source.mjs'], valueKeys: ['catalogue/module.mjs#contract'],
    ruleTextValueKeys: ['catalogue/module.mjs#text'], ruleContractValueKeys: ['catalogue/module.mjs#contract'] },
  gameDefaults: { members: [{ id: 'player-a', name: 'Player A' }], masterLabel: 'Administrator' } });

test('profile generation requires every non-optional input in the pinned data and rules-text packs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'profile-pack-compatibility-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source'), packsDir = path.join(root, 'packs');
  const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const catalogue = profile().catalogue;
  catalogue.inputs.push('catalogue/rules.json', 'local-map/optional.json');
  const exports = { DATASET_INPUTS: catalogue.inputs, DATASET_SOURCE_INPUTS: catalogue.sourceInputs,
    DATASET_VALUE_KEYS: catalogue.valueKeys, RULE_TEXT_VALUE_KEYS: catalogue.ruleTextValueKeys,
    DATASET_RULE_CONTRACT_VALUE_KEYS: catalogue.ruleContractValueKeys };
  await put(path.join(sourceRoot, 'app/dataset-inputs.mjs'), Object.entries(exports).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`).join('\n'));
  await put(path.join(sourceRoot, 'app/legacy-game-defaults.mjs'), `export const legacyGameDefaults = ${JSON.stringify(profile().gameDefaults)};`);
  const data = { schemaVersion: 1, id: 'duo-data', kind: 'data', version: '1.0.3', distribution: 'private-local',
    requires: { datasetId: 'duo-legacy' }, datasetDigest: profile().datasetDigest, ruleContractHash: profile().ruleContractHash,
    files: [{ path: 'catalogue/inputs.json', kind: 'input' }, { path: 'evidence/source.mjs', kind: 'evidence' }] };
  const text = { ...data, id: 'duo-rules-text', kind: 'rules-text', files: [{ path: 'catalogue/rules.json', kind: 'input' }] };
  const select = async () => {
    const selection = { schemaVersion: 1 };
    for (const [key, manifest] of [['data', data], ['rulesText', text]]) {
      const bytes = JSON.stringify(manifest);
      await put(path.join(packsDir, manifest.id, manifest.version, 'pack.json'), bytes);
      selection[key] = { id: manifest.id, version: manifest.version, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    await put(path.join(packsDir, 'selection.json'), selection);
  };
  await select();
  const output = path.join(root, 'valid.json');
  await buildDatasetProfile({ sourceRoot, packsDir, output });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).catalogue, catalogue);
  for (const [manifest, name] of [[data, 'data'], [text, 'text']]) {
    const saved = manifest.files; manifest.files = []; await select();
    const absent = path.join(root, name + '-rejected.json');
    await assert.rejects(buildDatasetProfile({ sourceRoot, packsDir, output: absent }), /lack a required profile input/);
    await assert.rejects(access(absent), { code: 'ENOENT' });
    manifest.files = saved;
  }
  await select();
  await put(path.join(packsDir, 'duo-rules-text/1.0.3/pack.json'), { ...text, files: [] });
  await assert.rejects(buildDatasetProfile({ sourceRoot, packsDir, output: path.join(root, 'tampered.json') }), /Invalid private dataset profile/);
});

