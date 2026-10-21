// Read-only HTTP proof against one disposable picker. Picker writes stay in
// the new scratch directory; an optional report has its own explicit path.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupCounts } from './scrub-save.mjs';

const refuse = category => { throw Object.assign(new Error('Load proof refused.'), { category }); };
export async function proveLoad({ save, compare, scratch, port, report }) {
  if (!path.isAbsolute(save ?? '') || !path.isAbsolute(scratch ?? '') || !Number.isInteger(port) || port < 8900 || port > 8999) refuse('usage');
  if (!process.env.RS3_PACK_SELECTION || !process.env.RS3_PACKS_DIR || process.env.RS3_DATASET !== 'duo-legacy') refuse('explicit-public-packs-required');
  // Refuse an existing directory, including any existing game storage.
  await mkdir(scratch, { recursive: false });
  const expected = backupCounts(JSON.parse(await readFile(save, 'utf8')));
  if (compare) {
    const rawCounts = backupCounts(JSON.parse(await readFile(compare, 'utf8')));
    if (JSON.stringify(rawCounts) !== JSON.stringify(expected)) refuse('source-counts-differ');
  }
  for (const name of Object.keys(process.env)) if (name.startsWith('RS3_')
    && !['RS3_DATASET','RS3_PACKS_DIR','RS3_PACK_SELECTION'].includes(name)) delete process.env[name];
  process.env.RS3_TASK_WORKER_MODE = 'thread';
  for (const name of ['RS3_MAP_ASSETS_DIR','RS3_TERRAIN_ASSETS_DIR','RS3_ICON_ASSETS_DIR','RS3_GAME_DATA_DIR']) process.env[name] = path.join(scratch, 'absent-assets');
  const { createServer } = await import('../../app/server.mjs');
  let app, result;
  try {
    app = await createServer({ dataDir: path.join(scratch, 'data'), host: '127.0.0.1', port,
      initialImport: save, predictionPrewarm: false });
    await app.listen();
    // Never print the invitation, token, cookie, or any endpoint payload.
    const joined = await fetch(app.inviteUrl, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const cookie = joined.headers.get('set-cookie')?.split(';')[0];
    await joined.body?.cancel();
    if (joined.status !== 303 || !cookie) refuse('scratch-authentication-failed');
    const base = `http://127.0.0.1:${port}`;
    const endpoints = {};
    async function get(route) {
      const response = await fetch(base + route, { headers: { cookie }, signal: AbortSignal.timeout(120000) });
      if (response.status !== 200) { await response.body?.cancel(); refuse('scratch-endpoint-failed'); }
      const payload = await response.json(); endpoints[route.split('?')[0]] = response.status; return payload;
    }
    const health = await get('/api/health');
    if (!health.savesReady) refuse('scratch-not-ready');
    await get('/api/session');
    const snapshot = await get('/api/state');
    const actual = backupCounts({ format: 'rs3-chunk-picker', schemaVersion: 1, state: snapshot.state });
    // Initial import adds an import event. Gameplay counts must match exactly.
    const gameplay = ({ history, ...counts }) => counts;
    if (JSON.stringify(gameplay(actual)) !== JSON.stringify(gameplay(expected))) refuse('loaded-counts-differ');
    const evaluatedTasks = [];
    for (const member of snapshot.state.members) {
      const tasks = await get(`/api/tasks?memberId=${encodeURIComponent(member.id)}`);
      if (!Array.isArray(tasks.tasks)) refuse('invalid-task-response');
      evaluatedTasks.push(tasks.tasks.length);
    }
    if (!(await get('/api/health')).ready) refuse('scratch-worker-not-ready');
    result = { schema: 'rs3-save-copy-load-proof-v1', passed: true, port, endpoints,
      expected, actual, evaluatedTasks, serverStopped: false };
  } finally { if (app) await app.close(); }
  result.serverStopped = true;
  if (report) await writeFile(report, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = {};
  try {
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
      if (!['--save','--compare','--scratch','--port','--report'].includes(args[index]) || !args[index + 1]) refuse('usage');
      options[args[index].slice(2)] = args[index] === '--port' ? Number(args[index + 1]) : args[index + 1];
    }
    console.log(JSON.stringify(await proveLoad(options)));
  } catch (error) { console.error(JSON.stringify({ error: error.category ?? 'load-proof-failed' })); process.exitCode = 1; }
}
