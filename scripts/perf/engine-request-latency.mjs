// Serial request-type A/B probe. Private bundles stay under /tmp; only numeric
// measurements and hashes enter reports. Each pair starts fresh calculators.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { deserialize, serialize } from 'node:v8';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCorpus, randomFor, sample } from '../../tools/calc-check/corpus.mjs';
import { Calculator } from '../../tools/calc-check/client.mjs';
import { hash } from '../../tools/calc-check/compare.mjs';
const { values: o } = parseArgs({ options: {
  reference: { type: 'string' }, candidate: { type: 'string' }, 'data-dir': { type: 'string' },
  output: { type: 'string' }, positions: { type: 'string', default: '0,3,7' },
  runs: { type: 'string', default: '5' }, trial: { type: 'string' }, 'app-dir': { type: 'string' },
  'stop-after': { type: 'string' }, 'stop-scenario': { type: 'string' },
  inputs: { type: 'string' }, prepare: { type: 'boolean' }, detailed: { type: 'boolean' }, 'member-slot': { type: 'string' },
} });
const appSourceHash = async dir => hash((await Promise.all(['worker.mjs','engine.mjs','snapshot-cache.mjs','eligibility-cache.mjs','chunk-planning-index.mjs'].map(name =>
  readFile(path.join(dir, 'app/tasks', name), 'utf8').catch(error => { if (name === 'snapshot-cache.mjs' && error.code === 'ENOENT') return ''; throw error; })))).join('\0'));
const summarize = values => {
  const sorted = [...values].sort((a,b) => a-b), n = sorted.length;
  return { count: n, median: (sorted[Math.floor((n-1)/2)] + sorted[Math.ceil((n-1)/2)]) / 2, min: sorted[0], max: sorted.at(-1) };
};
if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw new Error('NodeVersionError');
for (const p of [o.output, o.inputs, o.trial].filter(Boolean)) if (!path.resolve(p).startsWith('/tmp/')) throw new Error('OutputLocationError');
if (o.trial) {
  const { bundle, state, requests: originalRequests } = deserialize(await readFile(o.trial));
  // Exercise an ordinary draft followed by first and repeated detailed requests.
  // Request parameters remain private; scenario labels contain no input data.
  const requests = o.detailed ? originalRequests.map(rows => rows.flatMap(fields => {
    if (fields.type !== 'sandbox') return [fields];
    const chunkId = fields.draft.changes.unlockChunks[0];
    if (chunkId === undefined) throw new Error('DetailedInputError');
    const detailed = { ...fields, draft: { ...fields.draft, previewChunkId: chunkId, planningChunkId: chunkId } };
    return [{ ...fields, scenario: 'ordinary' }, { ...detailed, scenario: 'detail-first' },
      { ...detailed, scenario: 'detail-repeat' }, { ...fields, scenario: 'ordinary-after' }];
  })) : originalRequests;
  const input = hash(JSON.stringify(state)), memberIds = state.members.map(m => m.id);
  const calculator = new Calculator(`${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(o['app-dir'], 'calculator/reference/main.mjs'))}`);
  const rows = [];
  try {
    await calculator.init(bundle);
    const base = { pickerId: 'legacy-shared', revision: state.revision, input, snapshotKey: JSON.stringify([state.revision, input]), memberIds };
    const send = async (fields, body, scenario) => {
      const start = performance.now();
      const reply = await calculator.request({ ...base, state: body ? 'body' : 'ref', ...fields }, body ? state : undefined).promise;
      if (reply.header.type === 'error') throw new Error(`RequestError:${fields.type}:${scenario ?? 'base'}:${reply.header.error?.kind}`);
      rows.push({ kind: fields.type, scenario, member: memberIds.indexOf(fields.memberId), view: fields.view,
        wallMs: performance.now() - start, evaluationMs: reply.header.evaluationMs, timingMs: reply.header.timingMs, cache: reply.header.cache });
    };
    await send({ type: 'prepare-rules' }, true);
    const selected = o['member-slot'] === undefined ? memberIds.map((_, i) => i) : [Number(o['member-slot'])];
    if (selected.some(i => !Number.isSafeInteger(i) || i < 0 || i >= memberIds.length)) throw new Error('MemberSlotError');
    for (const member of selected) {
      const memberId = memberIds[member];
      for (const view of ['play-v1', 'full']) await send({ type: 'evaluate', memberId, view, projections: ['duo', 'duo-sidebar'] });
      for (const { scenario, ...fields } of requests[member]) {
        await send({ ...fields, memberId }, false, scenario);
        if (fields.type === o['stop-after'] || scenario !== undefined && scenario === o['stop-scenario']) break;
      }
    }
    await calculator.sampleMemory();
  } finally { await calculator.close(); }
  await writeFile(o.output, JSON.stringify({ rows, peakRSSBytes: calculator.peakRSSBytes }));
} else {
  await mkdir(o.inputs, { recursive: true });
  const manifestPath = path.join(o.inputs, 'request-manifest.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!manifest) {
    const corpus = await buildCorpus({ save: { dataDir: o['data-dir'] }, limits: { save: 8 } }, 17);
    try {
      const entries = corpus.groups.flatMap(group => group.states.map(entry => ({ group, entry })));
      manifest = { manifestHash: corpus.manifestHash, states: [] };
      for (const position of o.positions.split(',').map(Number)) {
        const { group, entry } = entries[position], state = await entry.load(), random = randomFor(17 + position);
        const requests = state.members.map(member => {
          const chunkIds = sample([...group.world.chunks.keys()], 2, random);
          const future = sample([...group.world.surface ?? group.world.chunks.keys()].filter(id => !member.unlocked.includes(id)), 1, random);
          return [...chunkIds.map(chunkId => ({ type: 'chunk-planning', chunkId })),
            { type: 'sandbox', draft: { changes: { unlockChunks: future, lockChunks: sample(member.unlocked, 1, random), doneTasks: sample(state.tasks.map(task => task.id), 1, random) } } },
            { type: 'area-check', draft: { chunkIds: future, asMembers: random() < .5 } }];
        });
        await writeFile(path.join(o.inputs, `input-${position}`), serialize({ bundle: group.bundle, state, requests }));
        manifest.states.push({ position, stateHash: hash(JSON.stringify(state)), bytes: Buffer.byteLength(JSON.stringify(state)) });
      }
      await writeFile(manifestPath, JSON.stringify(manifest));
    } finally { await corpus.close(); }
  }
  if (o.prepare) process.exit(0);
  const runs = Number(o.runs);
  if (!Number.isSafeInteger(runs) || runs < 5) throw new Error('OptionsError');
  const appSources = Object.fromEntries(await Promise.all(['reference','candidate'].map(async side => [side, await appSourceHash(o[side])])));
  const report = { node: process.version, ...manifest, runs, appSources, trials: [], summary: {} };
  for (const { position, stateHash } of manifest.states) for (let run = 0; run < runs; run++) {
    for (const side of run % 2 ? ['candidate', 'reference'] : ['reference', 'candidate']) {
      if (await appSourceHash(o[side]) !== appSources[side]) throw new Error('SourceChangedError');
      const output = path.join(o.inputs, 'trial.json');
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--trial', path.join(o.inputs, `input-${position}`), '--app-dir', o[side], '--output', output], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('TrialError')));
      });
      if (await appSourceHash(o[side]) !== appSources[side]) throw new Error('SourceChangedError');
      const trial = JSON.parse(await readFile(output, 'utf8'));
      report.trials.push({ position, stateHash, run, side, ...trial });
      for (const p of manifest.states.map(s => s.position)) report.summary[p] = Object.fromEntries(['reference','candidate'].map(name => {
        const selected = report.trials.filter(t => t.position === p && t.side === name);
        return [name, { peakRSSBytes: summarize(selected.map(t => t.peakRSSBytes)), ...Object.fromEntries(['evaluate','chunk-planning','sandbox','area-check'].map(kind => [kind,
          summarize(selected.map(t => summarize(t.rows.filter(r => r.kind === kind).map(r => r.wallMs)).median))])) }];
      }));
      await writeFile(o.output, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ position, run, side, peakRSSBytes: trial.peakRSSBytes }));
    }
  }
}
