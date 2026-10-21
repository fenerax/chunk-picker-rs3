import { readFile } from 'node:fs/promises';

// Summarize a V8 .heapsnapshot by self size: node type/constructor groups and
// the largest single objects. Output holds sizes and names only, never values.
//   node scripts/perf/heap-summary.mjs <file.heapsnapshot> [top=25]
export function summarizeHeapSnapshot(snapshot, top = 25) {
  const { meta } = snapshot.snapshot, fields = meta.node_fields, width = fields.length;
  const typeField = fields.indexOf('type'), nameField = fields.indexOf('name'), sizeField = fields.indexOf('self_size');
  const types = meta.node_types[typeField], nodes = snapshot.nodes, strings = snapshot.strings;
  const groups = new Map(), largest = [];
  let total = 0;
  for (let index = 0; index < nodes.length; index += width) {
    const type = types[nodes[index + typeField]], size = nodes[index + sizeField];
    const name = ['object', 'closure', 'native', 'hidden', 'array'].includes(type) ? strings[nodes[index + nameField]] : '';
    const key = `${type}${name ? `:${name.slice(0, 60)}` : ''}`;
    const group = groups.get(key) ?? { key, count: 0, bytes: 0 };
    group.count++; group.bytes += size; groups.set(key, group); total += size;
    if (size >= 1024 * 1024) largest.push({ type, name: type === 'string' ? `(string, ${size} bytes)` : name.slice(0, 80), bytes: size });
  }
  return { totalBytes: total, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top),
    largest: largest.sort((a, b) => b.bytes - a.bytes).slice(0, top) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [file, top = '25'] = process.argv.slice(2);
  const summary = summarizeHeapSnapshot(JSON.parse(await readFile(file, 'utf8')), Number(top));
  const mib = bytes => (bytes / 1024 ** 2).toFixed(1).padStart(8);
  console.log(`total self size ${mib(summary.totalBytes)} MiB`);
  for (const row of summary.groups) console.log(`${mib(row.bytes)} MiB ${String(row.count).padStart(9)}  ${row.key}`);
  console.log('largest objects:');
  for (const row of summary.largest) console.log(`${mib(row.bytes)} MiB  ${row.type} ${row.name}`);
}
