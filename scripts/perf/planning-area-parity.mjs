// Full HTTP parity against START for public interiors. No saves or network data
// are imported. node scripts/perf/planning-area-parity.mjs --out REPORT.json
import { fork, spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const baseline = option('baseline', '33932ab3453dec9d6268504b83be80fd76438b13');
if (option('child')) {
  process.env.RS3_TASK_WORKER_MODE = 'process';
  for (const key of ['RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PACK_SELECTION', 'RS3_PACKS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR', 'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR']) delete process.env[key];
  process.env.RS3_DATASET = 'open-f2p';
  const { definitions, initialState, locations } = await import('../../tests/helpers/planning-areas.mjs');
  const { startServer } = await import(pathToFileURL(path.join(option('tree'), 'app/server.mjs')));
  const dir = await mkdtemp(path.join(tmpdir(), 'planning-area-parity-'));
  const app = await startServer({ dataDir: dir, host: '127.0.0.1', port: 0, loopbackPort: undefined, publicOrigin: undefined,
    definitions, taskMap: {}, initialState: initialState(), predictionPrewarm: false });
  try {
    await app.ready; const url = new URL(app.inviteUrl);
    const get = async route => { const response = await fetch(url.origin + route, { headers: { authorization: `Bearer ${url.pathname.slice(6)}` } }); assert.equal(response.status, 200, route); return response.json(); };
    const state = (await get('/api/state')).state, responses = {};
    for (const group of [false, true]) {
      for (const member of state.members) await get(`/api/tasks?memberId=${member.id}&view=play-v1${group ? `&projection=duo-sidebar-v1&revision=${state.revision}` : ''}`);
      for (const member of state.members) for (const chunkId of locations) for (let occurrence = 1; occurrence <= 2; occurrence++) {
        const { cache, ...body } = await get(`/api/chunk-planning?memberId=${member.id}&chunkId=${encodeURIComponent(chunkId)}`);
        responses[`${group}/${member.id}/${chunkId}/${occurrence}`] = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      }
    }
    process.send({ responses, locations, members: state.members.map(m => ({ id: m.id, unlocked: m.unlocked })), node: process.version });
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
} else {
  const root = process.cwd(), scratch = await mkdtemp(path.join(tmpdir(), 'planning-area-trees-')), results = {};
  try {
    for (const label of ['before', 'after']) {
      const tree = path.join(scratch, label); await mkdir(tree);
      if (label === 'before') await new Promise((resolve, reject) => {
        const archive = spawn('git', ['archive', baseline, 'app', 'scripts/lib', 'package.json'], { cwd: root }); const tar = spawn('tar', ['-x', '-C', tree]);
        archive.stdout.pipe(tar.stdin); archive.on('error', reject); tar.on('error', reject); tar.on('exit', code => code ? reject(Error('archive extraction')) : resolve());
      });
      else for (const entry of ['app', 'scripts/lib', 'package.json']) await cp(path.join(root, entry), path.join(tree, entry), { recursive: true });
      results[label] = await new Promise((resolve, reject) => {
        const child = fork(import.meta.filename, ['--child', 'yes', '--tree', tree], { execArgv: ['--max-old-space-size=3072'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        let result; child.on('message', value => { result = value; }); child.on('error', reject); child.on('exit', code => code === 0 && result ? resolve(result) : reject(Error(`area parity child ${code}`)));
      });
    }
    assert.deepEqual(results.after.responses, results.before.responses);
    const report = { baseline, method: 'Fresh production process-worker servers, public planning-areas fixture; every response field hashed except volatile cache metadata.', comparisons: Object.keys(results.before.responses).length, ...results };
    const output = path.resolve(option('out', '.local/planning-area-parity.json')); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.comparisons} full HTTP response comparisons passed, both members and group projections, surface chunks and named areas.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
