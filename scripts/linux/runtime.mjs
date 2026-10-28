import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isPrivateClient } from '../../app/security/request.mjs';
import { sanitizeExecutionEnvironment } from '../private-companion/release-identity.mjs';
import { encode, inventory, json, noLinks, sha } from './files.mjs';

export async function readRelease(pointerFile, dataDir) {
  await noLinks(pointerFile);
  return inspectRelease(await readFile(pointerFile), dataDir, pointerFile);
}
async function inspectRelease(bytes, dataDir, pointerFile) {
  const pointer = JSON.parse(bytes);
  await noLinks(pointer.config.path);
  const configBytes = await readFile(pointer.config.path);
  if (sha(configBytes) !== pointer.config.sha256) throw new Error('Release configuration pin changed.');
  const config = JSON.parse(configBytes);
  if (path.resolve(config.dataDir) !== path.resolve(dataDir)) throw new Error('Release names another store.');
  if (!path.isAbsolute(config.coreRoot)) throw new Error('Release root must be absolute.');
  for (const pin of [config.selection, config.profile, config.addons, ...Object.values(config.packs ?? {})].filter(Boolean)) {
    await noLinks(pin.path);
    if (sha(await readFile(pin.path)) !== pin.sha256) throw new Error('Release input pin changed.');
  }
  // The digest is checked again after probes. Releases must be immutable and
  // owned by an account other than the application service account.
  const tree = await inventory(config.coreRoot, { ignoreRoot: ['.git', '.local', 'var', 'node_modules'] });
  return { pointerFile, pointer, pointerBytes: bytes, config, identity: sha(encode(tree) + sha(bytes)) };
}
export async function assertSameRelease(release) {
  if ((await inspectRelease(release.pointerBytes, release.config.dataDir, release.pointerFile)).identity !== release.identity) throw new Error('Release changed during the operation.');
}
export function runtimeEnvironment(config, { probe = false } = {}) {
  const overrides = { RS3_DATASET: config.datasetId ?? 'duo-legacy', RS3_TASK_WORKER_MODE: 'process' };
  const assign = (key, value) => { if (value !== undefined && value !== null) overrides[key] = String(value); };
  assign('RS3_PACKS_DIR', config.packsDir);
  assign('RS3_PACK_SELECTION', config.selection?.path);
  assign('RS3_DATASET_PROFILE', config.profile?.path); assign('RS3_DATASET_PROFILE_SHA256', config.profile?.sha256);
  assign('RS3_PRIVATE_ADDON', config.addons?.path); assign('RS3_PRIVATE_ADDON_SHA256', config.addons?.sha256);
  assign('RS3_WORKER_IDLE_MS', config.runtimeOptions?.workerIdleMs);
  if (!probe) {
    for (const [key, value] of Object.entries(process.env)) if (/^RS3_(?:SIGNIN|(?:DISCORD|GOOGLE)_CLIENT_(?:ID|SECRET_FILE))$/.test(key)) assign(key, value);
    // The public listener must have an explicit public role, independent of headers.
    overrides.RS3_LOOPBACK_ROLE = 'public';
  } else overrides.RS3_SIGNIN = 'off';
  return sanitizeExecutionEnvironment(process.env, { overrides });
}
export async function openApplication(config, dataDir, { probe = false } = {}) {
  if (!probe && (!isPrivateClient(config.host) || !Number.isInteger(config.port) || !Number.isInteger(config.loopbackPort)
    || config.port === config.loopbackPort)) throw new Error('Distinct explicit private and public listener configuration is required.');
  const environment = runtimeEnvironment(config, { probe });
  if (!probe) environment.RS3_PUBLIC_ORIGIN = (await readFile(config.publicOriginFile, 'utf8')).trim();
  for (const key of Object.keys(process.env)) if (/^RS3_|^NODE_(?:OPTIONS|PATH)$/.test(key)) delete process.env[key];
  Object.assign(process.env, environment);
  const server = await import(pathToFileURL(path.join(config.coreRoot, 'app/server.mjs')).href);
  const options = { dataDir, host: config.host, port: config.port, loopbackPort: probe ? undefined : config.loopbackPort,
    loopbackRole: 'public', predictionPrewarm: !probe,
    retention: Object.fromEntries(Object.entries({ backupDays: config.runtimeOptions?.backupDays, historyEntries: config.runtimeOptions?.historyEntries }).filter(([, value]) => value != null)) };
  if (probe) {
    options.runeMetrics = options.originalSync = { fetchImpl: async () => { throw new Error('Offline recovery probe.'); } };
    return server.createServer(options);
  }
  return server.startServer(options);
}
export async function operatorSettings() {
  const file = process.env.RS3_OPERATOR_CONFIG;
  if (!file || !path.isAbsolute(file)) throw new Error('Set an absolute operator configuration path.');
  await noLinks(file);
  const settings = await json(file);
  for (const key of ['current', 'dataDir', 'controlDir', 'scratchRoot', 'backupDir']) if (!path.isAbsolute(settings[key] ?? '')) throw new Error('Operator paths must be absolute.');
  if (settings.service !== 'chunk-picker.service') throw new Error('Unexpected service identity.');
  return settings;
}
