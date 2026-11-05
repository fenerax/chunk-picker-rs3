import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { installSecrets, request, run, verifyDeployment } from './setup-common.mjs';
import { privateEndpoint } from '../linux/ops-status.mjs';
export const checks = Object.freeze([
  { name: 'chunk-picker-health', period: 600, grace: 1800 },
  { name: 'chunk-picker-backup', period: 86400, grace: 43200 },
  { name: 'chunk-picker-offhost', period: 86400, grace: 43200 },
]);
export async function setupHealthchecks({ keyFile, alias }, { fetchImpl = fetch, execute = run, identityFile } = {}) {
  verifyDeployment(alias, execute, identityFile);
  const key = (await readFile(keyFile, 'utf8')).trim(); if (!key) throw Error('API key file required.');
  const base = 'https://healthchecks.io/api/v3/checks/';
  const headers = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  const existing = await request(base, { headers }, fetchImpl), secrets = {};
  for (const check of checks) {
    const matches = existing.checks.filter(row => row.name === check.name);
    if (matches.length > 1) throw Error('Duplicate check names require reconciliation.');
    let url = base;
    if (matches.length) {
      const candidate = new URL(matches[0].update_url);
      if (candidate.origin !== new URL(base).origin || !candidate.pathname.startsWith('/api/v3/checks/')) throw Error('Check update URL refused.');
      url = candidate.href;
    }
    const result = await request(url, { method: 'POST', headers, body: JSON.stringify({ ...check, tags: 'chunk-picker', ...(!matches.length ? { unique: ['name'] } : {}) }) }, fetchImpl);
    privateEndpoint(result.ping_url, 'healthchecks');
    secrets[check.name.replace('chunk-picker-', '') + '-ping'] = result.ping_url;
  }
  installSecrets(alias, secrets, execute, { identityFile });
  return { checks: checks.length }; // No ping, webhook or management URLs.
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'key-file': { type: 'string' }, ssh: { type: 'string' } } });
    await setupHealthchecks({ keyFile: values['key-file'], alias: values.ssh });
    process.stdout.write('Three dead-man checks configured; recipients still need a receipt test.\n');
  } catch { process.stderr.write('Healthchecks setup refused; no credentials printed.\n'); process.exitCode = 1; }
}
