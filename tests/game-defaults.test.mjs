import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadGameDefaults } from '../app/game-defaults.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('bundled defaults resolve without importing private compatibility defaults', () => {
  const source = `import { registerHooks } from 'node:module';
    registerHooks({resolve(specifier, context, next) {
      if (specifier.includes('legacy-game-defaults') || specifier.includes('capture-maps')) throw new Error('Private compatibility import refused');
      return next(specifier, context);
    }});
    const {loadGameDefaults}=await import('./app/game-defaults.mjs');
    for (const id of ['open-starter','open-f2p']) {
      const defaults=await loadGameDefaults(id);
      if (defaults.masterLabel!=='Administrator') throw new Error('Generic administrator required');
      if (defaults.members.length!==2 || defaults.members.some((member,index)=>member.name!=='Explorer '+(index+1))) throw new Error('Generic players required');
      if (defaults.compatibility!==undefined) throw new Error('Private compatibility metadata');
    }
    process.env.RS3_DATASET='open-f2p';
    const {selectedDataset}=await import('./app/dataset-runtime.mjs');
    const {loadOriginalSyncIntegration}=await import('./app/dataset-bootstrap.mjs');
    if (await loadOriginalSyncIntegration(selectedDataset)!==null) throw new Error('Independent original sync should be unavailable');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true, encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('unknown defaults cannot fall through to the private profile', async () => {
  await assert.rejects(loadGameDefaults('unreviewed-profile'), /Unknown dataset selection/);
});

test('the public entrypoint retains the independent port guard before app or storage imports', () => {
  const result = spawnSync(process.execPath, ['scripts/start-public-game.mjs', '--port', '8788'], {
    cwd: root, env: { ...process.env, NODE_OPTIONS: '', RS3_DATASET: 'duo-legacy' },
    windowsHide: true, encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Choose a separate port/);
});

// Synthetic values only: the override's real file is placed outside the repository at release time.
test('an untracked local file can replace the placeholder members without entering the repository', async t => {
  const { mkdtemp, writeFile, rm, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const scratchBase = path.join(root, '.local', 'game-defaults-tests');
  await mkdir(scratchBase, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchBase, 'override-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const read = file => {
    const env = { ...process.env, NODE_OPTIONS: '' };
    for (const name of ['RS3_GAME_DEFAULTS_FILE', 'RS3_DATASET', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256']) delete env[name];
    if (file !== undefined) env.RS3_GAME_DEFAULTS_FILE = file;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
      "const { legacyGameDefaults } = await import('./app/legacy-game-defaults.mjs'); process.stdout.write(JSON.stringify(legacyGameDefaults));"],
    { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    return result;
  };
  const value = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  const placeholder = value(read());
  assert.deepEqual(placeholder.members.map(member => member.id), ['player1', 'player2']);
  assert.equal(placeholder.masterLabel, 'Player 1');

  const synthetic = { members: [{ id: 'synthetic-a', name: 'Synthetic A', mapId: 'mapa' }, { id: 'synthetic-b', name: 'Synthetic B' }], masterLabel: 'Player A' };
  const good = path.join(scratch, 'good.json');
  await writeFile(good, '﻿' + JSON.stringify(synthetic));
  const overridden = value(read(good));
  assert.deepEqual(overridden.members, synthetic.members);
  assert.equal(overridden.masterLabel, 'Player A');
  assert.deepEqual(overridden.compatibility, placeholder.compatibility);

  const refused = (result, pattern) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stderr, /secret-marker/);
  };
  refused(read('relative/good.json'), /must be an absolute path/);
  refused(read(path.join(scratch, 'absent.json')), /could not be read/);
  const broken = path.join(scratch, 'broken.json');
  await writeFile(broken, '{"members": secret-marker');
  refused(read(broken), /not valid JSON/);
  for (const [name, bad] of Object.entries({
    extraKey: { ...synthetic, extra: 'secret-marker' },
    duplicateId: { ...synthetic, members: [synthetic.members[0], synthetic.members[0]] },
    unsafeId: { ...synthetic, members: [{ id: 'secret-marker/../x', name: 'x' }] },
    noMembers: { members: [], masterLabel: 'x' },
  })) {
    const file = path.join(scratch, name + '.json');
    await writeFile(file, JSON.stringify(bad));
    refused(read(file), /Invalid local game defaults/);
  }
});
