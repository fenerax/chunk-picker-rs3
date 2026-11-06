// Usage: node scripts/ci/update-test-timings.mjs <downloaded main ledger> [...]
// Only public filenames and durations are retained, never free-form test output.
import { readFile, writeFile } from 'node:fs/promises';
import { readFileLedger } from './file-ledger.mjs';

export function timingTable(ledgers) {
  const samples = new Map(), sources = [];
  for (const source of ledgers) {
    const header = readFileLedger(source), { receipts } = header;
    if (header.lane !== 'test') throw Error('Expected a main Linux test ledger');
    sources.push({ sha: header.sha, runId: header.runId, runAttempt: header.runAttempt });
    for (const row of receipts) {
      const attempt = row.firstAttempt;
      if (attempt.outcome !== 'pass' || !(attempt.processWallMs > 0)) continue;
      if (!samples.has(row.file)) samples.set(row.file, []);
      samples.get(row.file).push(attempt.processWallMs);
    }
  }
  // Use the slowest recent passing observation to avoid underweighting outliers.
  const files = Object.fromEntries([...samples].sort(([a], [b]) => a.localeCompare(b))
    .map(([file, values]) => [file, Math.ceil(Math.max(...values))]));
  if (!Object.keys(files).length) throw Error('No completed passing timings');
  const sorted = Object.values(files).sort((a, b) => a - b);
  return { schema: 'rs3-test-timings-v1', sources, defaultMs: sorted[Math.floor(sorted.length / 2)], files };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/update-test-timings.mjs')) {
  if (process.argv.length < 3) throw Error('Supply downloaded main ledgers');
  const table = timingTable(await Promise.all(process.argv.slice(2).map(file => readFile(file, 'utf8'))));
  await writeFile(new URL('./test-timings.json', import.meta.url), JSON.stringify(table, null, 2) + '\n');
  console.log(`Recorded ${Object.keys(table.files).length} timings; new-file default ${table.defaultMs}ms`);
}
