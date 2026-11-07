import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function producePipelineOutputs(kit, args) {
  const a = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const output = a['--output'];
  if (a['--lane'] === 'addon') {
    await mkdir(output); const files = [];
    for (const row of (await json(a['--receipt'])).textOverrides) {
      const bytes = await readFile(row.source), target = path.join(output, row.path);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
      files.push({ path: row.path, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await writeFile(path.join(output, 'addon.json'), JSON.stringify({ schemaVersion: 1, features: { projectUpdates: true }, files }));
  } else if (a['--lane'] === 'profile') {
    const selection = await json(path.join(kit, 'packs/selection.json'));
    const pack = await json(path.join(kit, 'packs', selection.data.id, selection.data.version, 'pack.json'));
    await writeFile(output, JSON.stringify(pack.requires ? { datasetId: pack.requires.datasetId, datasetDigest: pack.datasetDigest, ruleContractHash: pack.ruleContractHash } : {}));
  } else if (a['--lane'] === 'prepare') {
    await cp(a['--core'], output, { recursive: true });
    await mkdir(path.join(output, '.local/game-data'), { recursive: true }); await mkdir(path.join(output, '.local/map-assets'), { recursive: true });
  } else assert.fail('Unexpected synthetic build lane ' + a['--lane']);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await producePipelineOutputs(process.argv[2], process.argv.slice(3));
  // Valid, durable outputs precede the nonzero process-exit acknowledgement.
  process.exitCode = 1;
}
