// Warm HTTP measurements against a disposable save copy. No response contents or keys are logged.
// node scripts/perf/plugin-reads.mjs CHECKOUT SOURCE_SAVE (dataset env must already be set)
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [checkout, source] = process.argv.slice(2);
if (!checkout || !source) throw new Error('Pass checkout and source save paths.');
const scratch = await mkdtemp(path.join(tmpdir(), 'plugin-reads-perf-'));
let app;
try {
  const dataDir = path.join(scratch, 'game');
  await cp(source, dataDir, { recursive: true });
  await cp(`${source}.dataset.json`, `${dataDir}.dataset.json`);
  const { createServer } = await import(pathToFileURL(path.join(checkout, 'app/server.mjs')));
  app = await createServer({ dataDir, host: '127.0.0.1', port: 0, predictionPrewarm: false, log: () => {} });
  await app.listen();
  const base = `http://127.0.0.1:${app.address().port}`;
  const memberId = app.store.getCalculationSnapshot().members[0].id;
  const admin = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const created = await fetch(`${base}/api/game-plugin/keys`, { method: 'POST', headers: { ...admin, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId, label: 'Measurement' }) });
  if (created.status !== 201) throw new Error(`Key setup status ${created.status}`);
  const { key } = await created.json(), headers = { Authorization: `Bearer ${key}`, 'Accept-Encoding': 'identity' };
  const warm = await fetch(`${base}/api/tasks?memberId=${encodeURIComponent(memberId)}&view=play-v1`, { headers: admin });
  if (warm.status !== 200) throw new Error(`Task setup status ${warm.status}`);
  const evaluated = await warm.json();
  if (!Array.isArray(evaluated.tasks)) throw new Error('Task setup did not return saved rows.');
  const results = {};
  for (const route of ['status', 'tasks']) {
    for (let index = 0; index < 3; index++) {
      const response = await fetch(`${base}/api/plugin/v1/${route}`, { headers });
      if (response.status !== 200) throw new Error(`Warm status ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (route === 'tasks' && !JSON.parse(Buffer.from(bytes).toString()).ready) throw new Error('Saved list is not ready.');
      await delay(300);
    }
    await delay(1100);
    const times = [], sizes = [];
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      const response = await fetch(`${base}/api/plugin/v1/${route}`, { headers });
      const bytes = await response.arrayBuffer();
      times.push(performance.now() - start); sizes.push(bytes.byteLength);
      if (response.status !== 200) throw new Error(`Sample status ${response.status}`);
      await delay(300);
    }
    times.sort((a, b) => a - b);
    results[route] = { medianMs: times[2], minMs: times[0], maxMs: times[4], bytes: [...new Set(sizes)] };
  }
  console.log(JSON.stringify({ ...results, parentPeakRssKiB: process.resourceUsage().maxRSS }));
} finally {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
