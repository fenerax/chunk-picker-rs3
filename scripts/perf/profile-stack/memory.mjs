import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
// Numeric process metadata only. Some managed environments expose status but
// not /proc/PID/task/PID/children, so use ps for a complete owned-process tree.
// RSS counts shared pages per process and excludes Chrome and this runner.
export async function sampleMemoryTree(pid) {
  if (process.platform !== 'linux') return { rssBytes: 0, processes: 0, complete: false };
  try {
    const { stdout } = await run('ps', ['-e', '-o', 'pid=,ppid=,rss='], { maxBuffer: 4 * 1024 ** 2, timeout: 5000 });
    const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const queue = [pid], seen = new Set(); let rssBytes = 0, complete = true;
    while (queue.length) {
      const own = queue.pop(); if (seen.has(own)) continue; seen.add(own);
      const row = rows.find(r => r[0] === own); if (!row) { complete = false; continue; }
      rssBytes += row[2] * 1024;
      queue.push(...rows.filter(r => r[1] === own).map(r => r[0]));
    }
    return { rssBytes, processes: seen.size, complete };
  } catch { return { rssBytes: 0, processes: 0, complete: false }; }
}
