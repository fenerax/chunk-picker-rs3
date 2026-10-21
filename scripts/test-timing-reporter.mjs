import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const redact = value => String(value).replace(/\/join\/[^\s"'<>]+/g, '/join/<token>')
  .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer <token>')
  .replace(/([#?&](?:key|(?:access|invite|master|overlay)[_-]?token|token)=)[^\s"'<>\]&]+/gi, '$1<token>')
  .replace(/(?<![a-z0-9_-])[a-z0-9_-]{43}(?![a-z0-9_-])/gi, '<token>');

// FileTest's complete event measures the entire child lifetime, including imports
// and teardown. Individual case durations omit both and must not be summed.
export default async function* timingReporter(source) {
  const files = [];
  const skippedCases = [];
  let summary;
  for await (const { type, data } of source) {
    if (type === 'test:complete' && !data.entryFile && data.name.endsWith('.test.mjs')) {
      files.push({ file: path.basename(data.name), wallMs: data.details.duration_ms, passed: data.details.passed });
      yield `${files.length}: ${path.basename(data.name)} ${(data.details.duration_ms / 1000).toFixed(2)}s\n`;
    } else if (type === 'test:fail') {
      const error = redact(data.details.error?.stack ?? data.details.error ?? '');
      yield `FAIL ${data.entryFile ?? data.file}: ${data.name}\n${error}\n`;
    } else if (type === 'test:stderr') {
      yield redact(data.message);
    } else if (type === 'test:summary' && !data.file) {
      summary = data;
    } else if (type === 'test:pass' && data.skip !== undefined) {
      skippedCases.push({ file: path.basename(data.entryFile ?? data.file), name: data.name, reason: data.skip });
    }
  }
  files.sort((a, b) => b.wallMs - a.wallMs);
  if (!summary || !files.length) throw new Error('Missing suite or per-file timing events');
  await writeFile(process.env.RS3_TEST_TIMING_REPORT, JSON.stringify({ summary, files, skippedCases }, null, 2) + '\n');
  yield `Summary: ${JSON.stringify(summary)}\n`;
}
