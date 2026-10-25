// Full-output oracle on the same large public fixture as the Chromium profile.
// node --expose-gc --max-old-space-size=3072 scripts/perf/group-filter-check.mjs --companion /tmp/scale400 --base <START>
// Hash every property and row in order, in bounded batches to avoid making a
// second giant response string. No saved or private inputs, network or server.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { groupFilterFixture } from './group-filter-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const option = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const base = option('base');
if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('Pass --base <full START SHA>');
const companion = option('companion');
if (!companion) throw new Error('Pass --companion <generated scale-dataset output>');
const versions = await readdir(path.join(companion, 'packs/duo-data'));
if (versions.length !== 1) throw new Error('Choose one generated companion');
const definitions = JSON.parse(await readFile(path.join(companion, 'packs/duo-data', versions[0], 'app/data/original-definitions.synthetic.v1.json'), 'utf8'));
const fixture = groupFilterFixture(definitions);
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256']) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p';
const file = 'app/web/duo-tasks.mjs', moduleUrl = pathToFileURL(path.join(root, file));
const source = execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' })
  .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, moduleUrl).href}'`);
const before = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).selectDuoTasks;
const after = (await import(moduleUrl)).selectDuoTasks;
const registry = { resolve: rules => ({ 'tasks.completion': 'any', ...rules }) };
function digest(selection) {
  const hash = createHash('sha256');
  for (const [key, value] of Object.entries(selection)) {
    hash.update(JSON.stringify(key));
    if (Array.isArray(value)) {
      hash.update('[');
      for (let i = 0; i < value.length; i += 500) hash.update(JSON.stringify(value.slice(i, i + 500)));
      hash.update(']');
    } else hash.update(JSON.stringify(value));
  }
  return { hash: hash.digest('hex'), rows: selection.rows.length, counts: selection.counts };
}
let checked = 0;
for (const selectedMemberId of ['one', 'two']) for (const personalFilter of ['group', 'not-done', 'only-player']) {
  const args = { ...fixture, registry, selectedMemberId, personalFilter };
  const baseline = digest(before(args)); globalThis.gc?.();
  const candidate = digest(after(args)); globalThis.gc?.();
  assert.deepEqual(candidate, baseline, `${selectedMemberId}:${personalFilter}`);
  console.log(JSON.stringify({ selectedMemberId, personalFilter, ...candidate })); checked++;
}
console.log(JSON.stringify({ base, tasks: fixture.state.tasks.length, fullResponsesEqual: checked, peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
