import path from 'node:path';
export default async function* report(events) {
  const failed = new Set();
  for await (const event of events) {
    if (event.type === 'test:fail') {
      const file = path.basename(event.data.entryFile ?? event.data.file ?? 'unknown');
      if (!failed.has(file)) { failed.add(file); yield `${JSON.stringify({ file, failures: 1 })}\n`; }
    }
    if (event.type === 'test:summary') yield `${JSON.stringify({ total: !event.data.file && !event.data.entryFile, counts: event.data.counts, durationMs: event.data.duration_ms })}\n`;
  }
}
