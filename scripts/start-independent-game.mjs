import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = { host: '127.0.0.1' };
let datasetId = 'open-starter';
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!value) throw new TypeError(`Missing value for ${key}.`);
  if (key === '--data-dir') options.dataDir = path.resolve(value);
  else if (key === '--port') options.port = Number(value);
  else if (key === '--dataset') datasetId = value;
  else throw new TypeError(`Unknown option: ${key}.`);
}
if (!['open-starter', 'open-f2p'].includes(datasetId)) throw new TypeError('Choose open-starter or open-f2p.');
options.dataDir ??= path.join(root, '.local', datasetId);
options.port ??= datasetId === 'open-f2p' ? 8952 : 8950;
if (!Number.isInteger(options.port) || options.port < 8900 || options.port > 8999) throw new TypeError('Choose a separate port from 8900 through 8999.');
// Select before importing any rules, catalogues, workers or storage modules.
process.env.RS3_DATASET = datasetId;
for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_MAP_ASSETS_DIR', 'RS3_TERRAIN_ASSETS_DIR',
  'RS3_ICON_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT']) delete process.env[key];
const { startServer } = await import('../app/server.mjs');
let application;
try {
  application = await startServer(options);
  const stop = async () => { await application.close(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await application.ready;
  process.stdout.write(`${datasetId === 'open-f2p' ? 'F2P' : 'Starter'} game ready at http://127.0.0.1:${options.port}/.\nOpen the local administrator invitation described in the README.\n`);
} catch (error) {
  await application?.close();
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
}
