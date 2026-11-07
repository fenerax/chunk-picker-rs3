import path from 'node:path';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
const output = args['--output'], receipt = JSON.parse(await readFile(args['--receipt']));
const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
switch (args['--lane']) {
  case 'addon': {
    await mkdir(output);
    const files = [];
    for (const row of receipt.textOverrides) {
      const bytes = await readFile(row.source), file = path.join(output, row.path);
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: 'wx' });
      files.push({ path: row.path, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await writeFile(path.join(output, 'addon.json'), JSON.stringify({ schemaVersion: 1, features: { projectUpdates: true }, files }));
    break;
  }
  case 'profile': {
    const selection = JSON.parse(await readFile(path.join(kit, 'packs/selection.json'))), pack = selection.data;
    const manifest = JSON.parse(await readFile(path.join(kit, 'packs', pack.id, pack.version, 'pack.json')));
    await writeFile(output, JSON.stringify({ datasetId: manifest.requires.datasetId, datasetDigest: manifest.datasetDigest, ruleContractHash: manifest.ruleContractHash }));
    break;
  }
  case 'prepare':
    await cp(args['--core'], output, { recursive: true, errorOnExist: true, force: false });
    await mkdir(path.join(output, '.local/game-data'), { recursive: true });
    await mkdir(path.join(output, '.local/map-assets'), { recursive: true });
    break;
  default: throw Error('Unknown synthetic assembly stage');
}
