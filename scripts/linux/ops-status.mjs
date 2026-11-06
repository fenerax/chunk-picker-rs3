import path from 'node:path';
import { isMain } from '../release/vps/entrypoint.mjs';
import { readFile, stat } from 'node:fs/promises';
import { atomic, encode, json } from './files.mjs';

export const statusKinds = ['health', 'backup', 'offhost', 'operator'];
export async function recordStatus(controlDir, kind, update, now = Date.now()) {
  if (!statusKinds.includes(kind)) throw Error('Unknown status kind.');
  const file = path.join(controlDir, kind + '-status.json');
  let previous = {}; try { previous = await json(file); } catch {}
  // Only structured categories cross this boundary; never Error.message or paths.
  const result = update.result;
  if (!['running', 'success', 'failed', 'skipped'].includes(result)) throw Error('Unknown status result.');
  const at = new Date(now).toISOString();
  const value = { format: 'picker-ops-status-v1', result, at,
    startedAt: result === 'running' ? at : previous.startedAt ?? at,
    lastSuccessAt: result === 'success' ? at : previous.lastSuccessAt ?? null,
    snapshotAt: update.snapshotAt ?? previous.snapshotAt ?? null,
    faults: [...new Set(update.faults ?? [])].filter(x => ['disk-reserve', 'backup-stale', 'operation-failed', 'health-skipped'].includes(x)) };
  await atomic(file, encode(value)); return value;
}
export async function withStatus(controlDir, kind, action) {
  await recordStatus(controlDir, kind, { result: 'running' });
  try {
    const result = await action();
    await recordStatus(controlDir, kind, { result: result?.skipped ? 'skipped' : 'success',
      faults: result?.skipped ? ['health-skipped'] : (await json(path.join(controlDir, kind + '-status.json'))).faults });
    return result;
  } catch (error) {
    await recordStatus(controlDir, kind, { result: 'failed', faults: ['operation-failed'] }); throw error;
  }
}
const credentialNames = new Set(['discord-webhook', 'health-ping', 'backup-ping', 'offhost-ping', 'b2-account', 'b2-key', 'restic-password']);
export async function credential(name, directory = process.env.CREDENTIALS_DIRECTORY) {
  if (!credentialNames.has(name) || !directory || !path.isAbsolute(directory)) throw Error('Credential unavailable.');
  const file = path.join(directory, name), info = await stat(file);
  if (!info.isFile() || process.platform === 'linux' && (info.uid !== 0 || (info.mode & 0o077))) throw Error('Private credential required.');
  const value = (await readFile(file, 'utf8')).trim();
  if (!value) throw Error('Credential unavailable.'); return value;
}
export function privateEndpoint(value, kind) {
  const url = new URL(value);
  const host = kind === 'discord' ? 'discord.com' : 'hc-ping.com';
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash
    || !(kind === 'discord' ? /^\/api\/webhooks\/[^/]+\/[^/]+$/ : /^\/[a-f0-9-]{36}$/).test(url.pathname)) throw Error('Private endpoint refused.');
  return url;
}
export async function deadman(kind, { fetchImpl = fetch, read = credential } = {}) {
  try {
    if (!['health', 'backup', 'offhost'].includes(kind)) throw Error();
    const response = await fetchImpl(privateEndpoint(await read(kind + '-ping'), 'healthchecks'), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch { return false; } // Delivery failure must never fail the completed job.
}
if (isMain(import.meta.url)) {
  if (process.argv[2] === 'ping' && await deadman(process.argv[3])) process.stdout.write('Test ping accepted.\n');
  else { process.stderr.write('Test ping failed.\n'); process.exitCode = 1; }
}
