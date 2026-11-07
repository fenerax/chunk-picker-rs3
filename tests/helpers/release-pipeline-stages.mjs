import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtures = new Map();
async function environment(env, action) {
  const prior = { ...process.env };
  try { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, env); return await action(); }
  finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, prior); }
}
export async function pipelineApi(f) {
  if (f.api) return f.api;
  const api = await import(pathToFileURL(f.cli));
  const identity = await import(pathToFileURL(path.join(f.kit, 'tools/release-identity.mjs')));
  const events = [];
  const layer = f.layer = { powerShell: process.execPath, nodeIdentityPath: f.syntheticBinary, events,
    captureExecutables: components => identity.captureInputIdentity({ components: components.map(({ name }) => ({ name, file: f.syntheticBinary })) }),
    async run(command, args, options) {
    const fileIndex = args.indexOf('-File');
    if (fileIndex !== -1) {
      const wrapper = args[fileIndex + 1];
      if (path.basename(wrapper) === 'Managed-ReleaseV2.ps1') {
        assert.ok(args.includes('-DryRun'), 'freeze never activates a runtime');
        events.push({ stage: 'dry-run', rollback: args.includes('-Rollback') });
        await writeFile(path.join(f.kit, '.local/dry-runs.txt'), (args.includes('-Rollback') ? 'True' : 'False') + '\n', { flag: 'a' });
        return 0;
      }
      const heavy = path.basename(wrapper).startsWith('heavy') || path.basename(wrapper) === 'with-heavy.ps1';
      const owner = path.join(f.kit, '.local/fixture-owner'), token = randomUUID();
      if (heavy) {
        await mkdir(owner); await writeFile(path.join(owner, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
        events.push({ stage: 'owner-open', token });
      }
      try {
        return await environment({ ...options.env, ...(heavy ? { RS3_HEAVY_LOCK_PATH: owner, RS3_HEAVY_LOCK_PID: String(process.pid), RS3_HEAVY_LOCK_TOKEN: token } : {}) },
          () => layer.run(args[fileIndex + 2], args.slice(fileIndex + 3), options));
      } finally {
        if (heavy) { await rm(owner, { recursive: true }); events.push({ stage: 'owner-closed', token }); }
      }
    }
    const [entry, ...rest] = args, name = path.basename(entry);
    events.push({ stage: name, args: rest });
    await mkdir(path.dirname(options.log), { recursive: true });
    await writeFile(options.log, 'synthetic stage acknowledged\n', { flag: 'a' });
    if (name === 'companion-check.mjs') {
      if (layer.failBuild) throw Error('Release child exited with code 1.');
      const a = Object.fromEntries(Array.from({ length: rest.length / 2 }, (_, i) => [rest[i * 2], rest[i * 2 + 1]]));
      const output = a['--output'];
      if (a['--lane'] === 'addon') {
        await mkdir(output); const files = [];
        for (const row of (await json(a['--receipt'])).textOverrides) {
          const bytes = await readFile(row.source), target = path.join(output, row.path);
          await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
          files.push({ path: row.path, sha256: hash(bytes) });
        }
        await writeFile(path.join(output, 'addon.json'), JSON.stringify({ schemaVersion: 1, features: { projectUpdates: true }, files }));
      } else if (a['--lane'] === 'profile') {
        const selection = await json(path.join(f.kit, 'packs/selection.json'));
        const pack = await json(path.join(f.kit, 'packs', selection.data.id, selection.data.version, 'pack.json'));
        await writeFile(output, JSON.stringify(pack.requires ? { datasetId: pack.requires.datasetId, datasetDigest: pack.datasetDigest, ruleContractHash: pack.ruleContractHash } : {}));
      } else if (a['--lane'] === 'prepare') {
        await cp(a['--core'], output, { recursive: true });
        await mkdir(path.join(output, '.local/game-data'), { recursive: true }); await mkdir(path.join(output, '.local/map-assets'), { recursive: true });
      } else assert.fail('Unexpected fake build lane ' + a['--lane']);
    } else if (name === 'release-v2.mjs' && rest[0] === 'gates-worker') {
      const options = await api.parseArgs(rest.slice(1));
      await api.fullWorker(options.kit, options.release, options);
    } else if (name === 'release-early.mjs') {
      if (!layer.skipStartup) {
        const { syntheticStartup } = await import(pathToFileURL(path.join(f.kit, 'tools/release-early.mjs')));
        const a = Object.fromEntries(Array.from({ length: (rest.length - 1) / 2 }, (_, i) => [rest[i * 2 + 1].slice(2), rest[i * 2 + 2]]));
        await environment({ ...process.env }, () => syntheticStartup(a));
      }
    } else if (name === 'gallery-check.mjs') {
      // Retain the old native fixture's Chrome-home prerequisite assertion.
      if (process.platform === 'win32') for (const folder of ['Local', 'Roaming']) await access(path.join(options.env.USERPROFILE, 'AppData', folder));
    } else assert.equal(name, 'verify-install.mjs', 'Unexpected fake process ' + name);
    return 0;
  } };
  f.api = new Proxy(api, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => api.withReleaseStageLayer(layer, () => value(...args)) : value; } });
  fixtures.set(f.cli, f);
  return f.api;
}
export async function invokePipeline(file, args, env) {
  const f = fixtures.get(file); if (!f) return null;
  const api = await pipelineApi(f);
  try {
    const options = await api.parseArgs(args.slice(1));
    const action = { release: 'releaseCandidate', prepare: 'prepare', 'assert-identity': 'assertReleaseIdentity' }[args[0]];
    assert.ok(action, 'Unexpected pipeline command ' + args[0]);
    await environment({ ...env }, () => api[action](options)); return { code: 0, output: '' };
  } catch (error) { return { code: 1, output: error.message }; }
}
