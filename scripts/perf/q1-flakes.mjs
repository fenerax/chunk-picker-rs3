// Public-only load reproduction. Logs and summaries stay outside the checkout.
// node scripts/perf/q1-flakes.mjs /tmp/q1-before [runs=20] [burners=1]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw new Error('Node 24.20+ required');
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const [output, runs = '20', burnerCount = '1'] = process.argv.slice(2);
if (!output || !path.isAbsolute(output) || path.resolve(output).startsWith(cwd) || !/^\d+$/.test(runs) || Number(runs) < 20 || !/^\d+$/.test(burnerCount)) throw new Error('Supply an absolute output directory outside the checkout, at least 20 runs, and a burner count');
await mkdir(output);
const files = ['setup-guide-browser', 'chunk-planning', 'linux-lock-recovery', 'postmerge-retry-policy'];
const burners = Array.from({ length: Number(burnerCount) }, () => spawn(process.execPath, ['-e', 'for (;;) Math.sqrt(Math.random());'], { stdio: 'ignore' }));
const burnerExits = burners.map(child => new Promise(resolve => child.once('close', resolve)));
const stop = () => { for (const child of burners) child.kill('SIGKILL'); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const results = {};
try {
  await Promise.all(files.map(async name => {
    const attempts = [];
    for (let run = 1; run <= Number(runs); run++) {
      const started = performance.now();
      const child = spawn(process.execPath, ['--test', '--test-concurrency=4', '--test-reporter=tap', ...(name === 'setup-guide-browser' ? ['--test-name-pattern=2 member.*pointer'] : name === 'postmerge-retry-policy' ? ['--test-name-pattern=postmerge retry recovers'] : []), `tests/${name}.test.mjs`], { cwd, env: { ...process.env, RS3_DATASET: 'open-f2p' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      const logFile = path.join(output, `${name}-${run}.tap`);
      let writing = Promise.resolve();
      const capture = bytes => { log += bytes; writing = writing.then(() => appendFile(logFile, bytes)); };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      await writing;
      const number = label => Number(log.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? 0);
      const attempt = { run, code, ms: performance.now() - started, pass: number('pass'), fail: number('fail'), cancelled: number('cancelled'), flakyMessages: log.match(/FLAKY: initial failure passed once in isolation/g)?.length ?? 0, failures: log.split('\n').filter(line => /^not ok |^  error:|^  failureType:|^# Assertion failed/.test(line)) };
      attempts.push(attempt);
      console.log(JSON.stringify({ name, ...attempt }));
    }
    const times = attempts.map(item => item.ms).sort((a, b) => a - b);
    results[name] = { failures: attempts.filter(item => item.code !== 0).length, runs: attempts.length, medianMs: (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2, minMs: times[0], maxMs: times.at(-1), flakyMessages: attempts.reduce((sum, item) => sum + item.flakyMessages, 0), pass: attempts.reduce((sum, item) => sum + item.pass, 0), fail: attempts.reduce((sum, item) => sum + item.fail, 0), attempts };
  }));
} finally { stop(); await Promise.all(burnerExits); }
await writeFile(path.join(output, 'summary.json'), JSON.stringify({ node: process.version, burners: Number(burnerCount), results }, null, 2) + '\n');
console.log(JSON.stringify({ summary: results }, (key, value) => key === 'attempts' ? undefined : value));
