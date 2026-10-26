// Reproducible source/transfer-size comparison; never executes either app tree.
// Usage: node scripts/perf/cleanup-size.mjs <START commit>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root });
const revision = process.argv[2];
if (!revision || !/^[a-f\d]{40}$/.test(revision)) throw new Error('Supply the full START commit SHA');
const files = git('diff', '--name-only', revision, '--', 'app/').toString().trim().split('\n')
  .filter(file => /\.(?:mjs|css|html)$/.test(file));
if (!files.length) throw new Error('No changed app source files');
const before = new Map(files.map(file => [file, git('show', `${revision}:${file}`)]));
const after = new Map(files.map(file => [file, readFileSync(path.join(root, file))]));
const measure = sources => {
  const rows = [...sources].map(([file, bytes]) => ({ file, lines: [...bytes.toString().matchAll(/\n/g)].length,
    raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length }));
  const total = rows.reduce((sum, row) => Object.fromEntries(['lines', 'raw', 'gzip', 'brotli'].map(key => [key, sum[key] + row[key]])),
    { lines: 0, raw: 0, gzip: 0, brotli: 0 });
  return { rows, total };
};
// Six paired runs, with within-pair ordering reversed each time: AB BA AB BA AB BA.
// Byte sizes are deterministic; repetitions verify that fact, not runtime speed.
const runs = [];
for (let pair = 0; pair < 6; pair++) for (const label of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
  runs.push({ pair: pair + 1, label, ...measure(label === 'before' ? before : after) });
}
const spread = values => {
  const sorted = values.toSorted((a, b) => a - b), middle = sorted.length / 2;
  return { median: (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted.at(-1) };
};
const summaries = Object.fromEntries(['before', 'after'].map(label => [label,
  Object.fromEntries(['lines', 'raw', 'gzip', 'brotli'].map(key => [key, spread(runs.filter(run => run.label === label).map(run => run.total[key]))]))]));
console.log(JSON.stringify({ revision, node: process.version, order: runs.map(({ pair, label }) => `${pair}:${label}`),
  files: files.map(file => ({ file, before: runs[0].rows.find(row => row.file === file), after: runs[1].rows.find(row => row.file === file) })),
  summaries, note: 'Per-file compression with Node defaults, summed across changed files. No latency or application-memory claim.' }, null, 2));
