// Synthetic large-backup memory envelope. Run under the shared heavy lock.
// Separate from the scaled calculator run so its RSS high-water mark is useful.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
if (process.platform !== 'linux') throw new Error('Run this synthetic memory probe on Linux under the shared heavy lock.');
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') && !key.startsWith('RS3_HEAVY_LOCK_')) delete process.env[key];
process.env.RS3_DATASET = 'open-f2p';
const [{ createGroupState, exportBackup }, { openStore }, { runImportJob }] = await Promise.all([
  import('../../app/core/state.mjs'), import('../../app/storage/store.mjs'), import('../../app/import-jobs.mjs'),
]);
const dataDir = path.resolve(process.argv[2] ?? '.local/import-memory-synthetic');
// Refuse every pre-existing path, including an accidentally supplied store.
await mkdir(dataDir, { recursive: false });
const state = createGroupState([{ id: 'one', name: 'Explorer 1' }, { id: 'two', name: 'Explorer 2' }]);
state.tasks = Array.from({ length: 20000 }, (_, i) => ({ id: `custom:${i}`, label: `Synthetic task ${i}`, category: 'Custom' }));
for (const member of state.members) {
  member.completedTasks = state.tasks.map(task => task.id);
  member.notes = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(10000 + i), 'synthetic note '.repeat(2400)]));
}
const backup = exportBackup(state), bytes = Buffer.from(JSON.stringify({ backup }));
// The parser takes ownership of the buffer, detaching it in this coordinator.
const backupMiB = bytes.length / 1048576;
const marks = [], mark = stage => marks.push({ stage, peakRssMiB: process.resourceUsage().maxRSS / 1024, heapMiB: process.memoryUsage().heapUsed / 1048576 });
try {
  const store = await openStore({ dataDir, initialState: state, retention: false }); await store.close();
  mark('fixture');
  await runImportJob({ kind: 'parse', chunks: [bytes], headers: { 'content-type': 'application/json' } }); mark('parse');
  await runImportJob({ kind: 'backup', dataDir, retention: false }); mark('backup');
  await runImportJob({ kind: 'export', dataDir, retention: false, gzip: true }); mark('export');
  await runImportJob({ kind: 'replacement', dataDir, retention: false, document: backup, baseRevision: state.revision }); mark('replacement');
} finally {
  console.log(JSON.stringify({ node: process.version, backupMiB, tasks: state.tasks.length, completed: marks.length === 5, marks }, null, 2));
}
