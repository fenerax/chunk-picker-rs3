import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const SOURCE_COMMIT = '6f22fefa782747790e2eaefa01e4e5ea7b557323';
export function parseContext(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--authorized-full-public') { assert.equal(result.authorized, undefined); result.authorized = true; continue; }
    assert.ok(['--source', '--scratch', '--source-lock'].includes(key), 'unknown argument');
    assert.equal(result[key], undefined, 'duplicate argument');
    assert.ok(argv[i + 1] && !argv[i + 1].startsWith('--'), 'missing argument');
    result[key] = argv[++i];
  }
  assert.equal(result.authorized, true, 'authorization required');
  assert.equal(result['--source'], '/source');
  assert.equal(result['--scratch'], '/scratch');
  assert.equal(result['--source-lock'], '/scratch/source-lock.json');
  return { source: '/source', scratch: '/scratch', sourceLock: '/scratch/source-lock.json', sourceURL: name => new URL(name, 'file:///source/') };
}

export function isolatePublic(context) {
  for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') || key.startsWith('NODE_TEST') || key.startsWith('NODE_CHANNEL_') || ['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'].includes(key)) delete process.env[key];
  const absent = path.join(context.scratch, 'r127-absent');
  assert.equal(existsSync(absent), false, 'absent path sandbox already exists');
  const defaults = new URL('./fixtures/defaults.json', import.meta.url);
  Object.assign(process.env, {
    RS3_DATASET: 'duo-legacy', RS3_GAME_DEFAULTS_FILE: defaults.pathname,
    RS3_PACKS_DIR: path.join(absent, 'packs'), RS3_PACK_SELECTION: path.join(absent, 'selection.json'),
    RS3_GAME_DATA_DIR: path.join(absent, 'game-data'), RS3_MAP_ASSETS_DIR: path.join(absent, 'map-assets'),
    RS3_TERRAIN_ASSETS_DIR: path.join(absent, 'terrain'), RS3_ICON_ASSETS_DIR: path.join(absent, 'icons'),
  });
  return { root: context.source, absent, defaults };
}
