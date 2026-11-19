import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

/** Closed, disposable synthetic fixtures only; represents an older release. */
export async function writeOlderLifecycleFixture(options, version = 4) {
  const file = path.join(options.registryDir, 'registry.json'), ledgerFile = path.join(options.tombstoneDir, 'ledger.json');
  const doc = JSON.parse(await readFile(file)), ledger = JSON.parse(await readFile(ledgerFile));
  if ((doc.deletions?.length ?? 0) || (ledger.characters?.length ?? 0) || version < 4 && ((doc.departures?.length ?? 0) || (doc.pastMaps?.length ?? 0))) throw new Error('Fixture already contains retirement history; keep it authoritative.');
  doc.schemaVersion = version; delete doc.deletions;
  if (version < 4) { delete doc.handovers; delete doc.departures; delete doc.pastMaps; }
  ledger.schemaVersion = 2; ledger.characters = []; delete ledger.slots; delete ledger.deletions;
  for (const name of ['retirement-migration.json', 'registry.pre-retirements-v4.json', 'ledger.pre-retirements-v2.json', ...(version < 4 ? ['registry.pre-handovers-v3.json'] : [])]) {
    await rm(path.join(options.registryDir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
  await writeFile(file, JSON.stringify(doc) + '\n'); await writeFile(ledgerFile, JSON.stringify(ledger) + '\n');
}
