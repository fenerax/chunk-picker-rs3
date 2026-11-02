// Calculator-only, serial before/after measurements. No store or server is opened.
// --checkout DIR --data-dir COPIED_SAVE --output /tmp/FILE [--runs 5] [--probe FILE]
// Private payloads remain in memory; output contains only counts, hashes and sizes/timings.
import { parseArgs } from 'node:util';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { values: o } = parseArgs({ options: Object.fromEntries(['checkout', 'data-dir', 'output', 'runs', 'probe'].map(k => [k, { type: 'string' }])) });
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('NodeVersionError');
if (!path.resolve(o.output ?? '').startsWith('/tmp/') || !path.resolve(o['data-dir'] ?? '').startsWith('/tmp/')) throw Error('ScratchLocationError');
const root = path.resolve(o.checkout), load = file => import(pathToFileURL(path.join(root, file)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (key, child) => key === 'elapsedMs' ? undefined : child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(name => [name, child[name]])) : child);
const digest = value => { const bytes = canonical(value); return { hash: sha(bytes), bytes: Buffer.byteLength(bytes) }; };
const { selectedDataset: dataset } = await load('app/dataset-runtime.mjs');
const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
const { verifyDatasetBinding } = await load('app/dataset-binding.mjs');
if (!(await verifyDatasetBinding(o['data-dir'], dataset)).bound) throw Error('DatasetBindingError');
const { prepareServerDefinitions, preparedDefinitionStages } = await load('app/dataset-pipeline.mjs');
const { buildWorld } = await load('app/data/world.mjs');
const { createRuleRegistry } = await load('app/core/rules.mjs');
const { validateOwnedState } = await load('app/core/state.mjs');
const { ProcessWorker } = await load('app/tasks/process-worker.mjs');
const { savedWhyChain, forgetSavedWhyChain } = await load('app/task-why-http.mjs');
const doc = JSON.parse(await readFile(path.join(o['data-dir'], 'state.json'), 'utf8'));
const rawState = doc.state;
for (const [key, ref] of Object.entries(doc.storage?.fields ?? {})) {
  if (!['tasks', 'identityRegistry', 'legacy', 'provenance'].includes(key) || !/^static-[a-f0-9]{64}\.json\.gz$/.test(ref.id)) throw Error('StaticReferenceError');
  const base = await realpath(path.join(o['data-dir'], 'static'));
  const file = await realpath(path.join(base, ref.id));
  if (path.dirname(file) !== base) throw Error('StaticPathError');
  const bytes = gunzipSync(await readFile(file));
  if (sha(bytes) !== ref.sha256) throw Error('StaticDigestError');
  rawState[key] = JSON.parse(bytes);
}
const state = validateOwnedState(rawState, createRuleRegistry());
const inputHash = digest(state).hash;
const input = await loadDatasetInputs(dataset, { loadTaskMap: false });
const definitions = prepareServerDefinitions(JSON.parse(input.definitionBytes), dataset);
const world = buildWorld(definitions, { dataset });
const bundle = { definitions, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
  preparedDatasetStages: preparedDefinitionStages(definitions), omitReadyCatalogue: true,
  world: { chunks: world.chunks, areas: world.areas, surface: world.surface }, extraRules: [] };
const report = { node: process.version, datasetHash: dataset.digest, inputHash, members: state.members.length, trials: [] };
for (let run = 0; run < Number(o.runs ?? 5); run++) {
  const worker = new ProcessWorker(bundle, { probeImport: o.probe });
  let nextId = 0, peakRSSBytes = 0, idleRSSBytes = 0, sentState = false;
  const sample = async () => {
    try { const status = await readFile(`/proc/${worker.pid}/status`, 'utf8'); const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
      peakRSSBytes = Math.max(peakRSSBytes, rss); idleRSSBytes = rss; } catch {}
  };
  const timer = setInterval(() => void sample(), 25);
  const request = message => new Promise((resolve, reject) => {
    const id = ++nextId, start = performance.now();
    const timeout = setTimeout(() => { worker.off('message', listener); reject(Error('WorkerTimeout')); }, 180000);
    const listener = reply => {
      if (reply.id !== id || reply.type === 'progress') return;
      worker.off('message', listener); clearTimeout(timeout);
      if (reply.error) reject(Error('WorkerRequestError'));
      else resolve({ ...reply, wallMs: performance.now() - start });
    };
    worker.on('message', listener);
    worker.postMessage({ id, ...(sentState ? {} : { state }), snapshotKey: JSON.stringify([state.revision, inputHash]), input: inputHash, memberId: state.members[0].id, ...message });
    sentState = true;
  });
  const trial = { run, rows: [] };
  try {
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    for (let member = 0; member < state.members.length; member++) {
      const memberId = state.members[member].id;
      // Warm the ordinary list snapshot before opening explanations.
      const evaluated = await request({ type: 'evaluate', memberId });
      const result = evaluated.result;
      const rows = result.tasks;
      trial.rows.push({ member, type: 'evaluate', count: rows.length, ...digest(result), wallMs: evaluated.wallMs, timingMs: evaluated.timingMs });
      const categories = [...new Set(rows.filter(row => row.status === 'available' && row.record && !row.personalCompleted).map(row => row.category))].sort();
      if (categories.length < 5) throw Error('SampleCategoriesError');
      const positions = Array.from({ length: 5 }, (_, i) => {
        const category = categories[Math.floor(i * (categories.length - 1) / 4)];
        const indices = rows.flatMap((row, index) => row.category === category && row.status === 'available' && row.record && !row.personalCompleted ? [index] : []);
        return indices[Math.floor(indices.length / 2)];
      });
      const entry = { revision: state.revision, fullGzip: gzipSync(JSON.stringify(result)) };
      for (const position of positions) {
        const row = rows[position], query = new URLSearchParams({ memberId, revision: String(state.revision), taskId: row.id });
        const how = await request({ type: 'how-task', chunkId: row.id, memberId });
        trial.rows.push({ member, position, type: 'how-task', count: Object.keys(how.result.nodes).length, ...digest(how.result), wallMs: how.wallMs, timingMs: how.timingMs });
        const repeat = await request({ type: 'how-task', chunkId: row.id, memberId });
        trial.rows.push({ member, position, type: 'how-repeat', ...digest(repeat.result), wallMs: repeat.wallMs });
        const start = performance.now();
        const why = await savedWhyChain(query, { revision: state.revision, members: new Set(state.members.map(m => m.id)), entry, definitions, currentRevision: () => state.revision });
        trial.rows.push({ member, position, type: 'why', count: why.nodeCount, ...digest(why), wallMs: performance.now() - start });
      }
      forgetSavedWhyChain(entry);
      await writeFile(o.output + '.partial', JSON.stringify({ run, rows: trial.rows }));
    }
    await sample();
    trial.peakRSSBytes = peakRSSBytes; trial.idleRSSBytes = idleRSSBytes;
    report.trials.push(trial);
    await writeFile(o.output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ run, rows: trial.rows.length, peakRSSBytes, idleRSSBytes }));
  } finally { clearInterval(timer); await worker.terminate(); }
}
