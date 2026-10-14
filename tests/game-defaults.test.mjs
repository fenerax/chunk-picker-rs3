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
