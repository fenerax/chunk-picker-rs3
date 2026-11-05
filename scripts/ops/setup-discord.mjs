// PC entrypoint; validates the whole webhook before any SSH or publication.
import { isMain } from '../release/vps/entrypoint.mjs';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { installSecrets, run } from './setup-common.mjs';
export async function setupDiscord({ keyFile, alias, rotate = false }, { execute = run, identityFile } = {}) {
  const value = (await readFile(keyFile, 'utf8')).trim();
  installSecrets(alias, { 'discord-webhook': value }, execute, { rotate: rotate ? ['discord-webhook'] : [], identityFile });
}
if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'key-file': { type: 'string' }, ssh: { type: 'string' }, rotate: { type: 'boolean' } } });
    await setupDiscord({ keyFile: values['key-file'], alias: values.ssh, rotate: values.rotate });
    process.stdout.write('Webhook installed; verify notification delivery.\n');
  } catch { process.stderr.write('Webhook setup refused; existing credential retained.\n'); process.exitCode = 1; }
}
