// Summarize calculator-only how-why.mjs runs; emit no payload contents.
// --before /tmp/FILE --after /tmp/FILE --output /tmp/FILE
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const { values: o } = parseArgs({ options: Object.fromEntries(['before', 'after', 'output'].map(key => [key, { type: 'string' }])) });
if (!path.resolve(o.output ?? '').startsWith('/tmp/')) throw Error('OutputLocationError');
const [before, after] = await Promise.all([o.before, o.after].map(async file => JSON.parse(await readFile(file, 'utf8'))));
if (before.inputHash !== after.inputHash || before.datasetHash !== after.datasetHash) throw Error('InputMismatch');
if (before.trials.length < 5 || after.trials.length < 5) throw Error('InsufficientRuns');
const stats = values => {
  const a = [...values].sort((a,b) => a-b), n = a.length;
  return { count: n, median: (a[Math.floor((n-1)/2)] + a[Math.ceil((n-1)/2)]) / 2, min: a[0], max: a.at(-1) };
};
const id = row => JSON.stringify([row.type, row.member, row.position]);
const expected = new Map(before.trials[0].rows.map(row => [id(row), row]));
let differences = 0, comparisons = 0;
for (const side of [before, after]) for (const trial of side.trials) {
  if (trial.rows.length !== expected.size) throw Error('RowCountMismatch');
  for (const row of trial.rows) { comparisons++; if (expected.get(id(row))?.hash !== row.hash || expected.get(id(row))?.count !== row.count) differences++; }
}
const timing = (side, type, member, position) => stats(side.trials.map(trial => trial.rows.find(row => row.type === type && row.member === member && row.position === position).wallMs));
const rows = before.trials[0].rows.map(row => ({ type: row.type, member: row.member, ...(row.position === undefined ? {} : { position: row.position }),
  count: row.count, hash: row.hash, before: timing(before, row.type, row.member, row.position), after: timing(after, row.type, row.member, row.position) }));
const summary = { node: before.node, inputHash: before.inputHash, datasetHash: before.datasetHash, comparisons, differences, rows,
  aggregate: Object.fromEntries(['evaluate', 'how-task', 'how-repeat', 'why'].map(type => [type, Object.fromEntries([['before', before], ['after', after]].map(([name, side]) => [name,
    stats(side.trials.map(trial => stats(trial.rows.filter(row => row.type === type).map(row => row.wallMs)).median))]))])),
  memory: Object.fromEntries([['before', before], ['after', after]].map(([name, side]) => [name, Object.fromEntries(['peakRSSBytes', 'idleRSSBytes'].map(key => [key, stats(side.trials.map(trial => trial[key]))]))])),
  hashes: Object.fromEntries(['evaluate', 'how-task', 'how-repeat', 'why'].map(type => [type, createHash('sha256').update(JSON.stringify(rows.filter(row => row.type === type).map(({ member, position, hash, count }) => ({ member, position, hash, count })))).digest('hex')])) };
await writeFile(o.output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ comparisons, differences, aggregate: summary.aggregate, memory: summary.memory, hashes: summary.hashes }));
