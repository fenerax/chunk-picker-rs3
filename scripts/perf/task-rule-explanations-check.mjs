// Compare explanation-only work with an explicit untouched checkout.
// Uses the public compare-cache-access evaluator (collection, equipment,
// presentation, activity, training and sources) and the public roll-pool API.
// Only counts, hashes and measurements leave a child. Private saves must be
// copied outside both checkouts before --data-dir is supplied. No save writes.
// node scripts/perf/task-rule-explanations-check.mjs --baseline /tmp/start --candidate . --out /tmp/counts.json --runs 3
// With a copied save: set the documented dataset/packs/defaults/process env and --data-dir /tmp/copied-game.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: Object.fromEntries(['baseline', 'candidate', 'out', 'runs', 'data-dir', 'child'].map(key => [key, { type: 'string' }])) });
if (Number(process.versions.node.split('.')[0]) < 24 || Number(process.versions.node.split('.')[0]) === 24 && Number(process.versions.node.split('.')[1]) < 20) throw Error('Node 24.20+ required.');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row)).digest('hex');
const spread = values => { const sorted = values.toSorted((a,b) => a-b); return { median: sorted[Math.floor(sorted.length/2)], min: sorted[0], max: sorted.at(-1) }; };

// Only the documented text/evidence changes are normalized. Selection flags,
// all row/source ordering, blockers, goals, training and pools remain exact.
function semantic(result) {
  const tasks = new Map(result.tasks.map(row => [row.id, row]));
  const normalize = (value, field, owner) => {
    if (field === 'explanation' || field === 'sourcePolicyRejections' || field === 'sourceExclusion') return undefined;
    if (field === 'elapsedMs' && owner === result.metrics) return undefined;
    if (field === 'detail' && owner?.kind === 'unavailable-task-alternative') return undefined;
    if (field === 'hiddenReasons' && owner?.sourcePolicyRejections?.some(reason => reason.local)) return value.map(text => text === 'Local supplies do not meet this task’s source conditions.'
      ? 'This task is outside the member’s own reachable map; partner access is a convenience.' : text);
    if (field === 'suppressed' && value && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([id, reasons]) => [id, reasons.map(reason =>
      tasks.get(id)?.sourceExclusion?.detail === reason ? 'A lower-level processing method or its source frontier excludes this recipe.'
        : reason === 'Local supplies do not meet this task’s source conditions.' && tasks.get(id)?.sourcePolicyRejections?.some(evidence => evidence.local)
          ? 'Outside this member’s own obligation map.' : reason)]));
    if (Array.isArray(value)) return value.map(item => normalize(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child, key, value)]).filter(([,child]) => child !== undefined));
    return value;
  };
  return normalize(result);
}
async function child(config) {
  const load = file => import(pathToFileURL(path.join(config.root, file)));
  const { selectedDataset } = await load('app/dataset-runtime.mjs');
  const { prepareTaskDefinitions } = await load('app/dataset-pipeline.mjs');
  const { createComparisonEvaluator } = await load('scripts/compare-cache-access.mjs');
  const { buildWorld } = await load('app/data/world.mjs');
  const { evaluateRollPool } = await load('app/core/rules.mjs');
  let raw;
  if (config.store) {
    const { loadDatasetInputs } = await load('app/dataset-bootstrap.mjs');
    raw = JSON.parse((await loadDatasetInputs(selectedDataset)).definitionBytes.toString('utf8'));
  } else raw = JSON.parse(await readFile(path.join(config.root, 'rs3-chunkpicker-chunkinfo-export.json'), 'utf8'));
  const definitions = prepareTaskDefinitions(raw, selectedDataset);
  const states = [];
  if (config.store) {
    const { readCopiedState } = await load('scripts/research/local-parity-model.mjs');
    const { state } = await readCopiedState(config.store);
    states.push(state);
    // Eight fixed calculation-only states: saved state and seven individual
    // toggles. No private identity or gameplay content is authored into this tool.
    for (const rule of ['Highest Level', 'Multi Step Processing', 'Boosting', 'Wield Crafted Items', 'Non-permanent BiS', 'Primary Spawns', 'Show Nonskill Tasks']) {
      const copy = structuredClone(state);
      copy.members = copy.members.map(member => ({ ...member, taskRules: { ...member.taskRules,
        [rule]: ![true, 'true', 1].includes(member.taskRules?.[rule] ?? copy.taskRules?.[rule]) } }));
      states.push(copy);
    }
  } else {
    const { createGroupState } = await load('app/core/state.mjs');
    const { playerControlSkills } = await load('app/core/player-controls.mjs');
    const chunks = Object.keys(definitions.chunks).filter(key => /^\d+$/.test(key)).sort();
    for (let i = 0; i < 3; i++) {
      const state = createGroupState(Array.from({ length: i ? 2 : 1 }, (_, slot) => ({ id: `fixture-${slot}`, name: `Fixture ${slot}`,
        unlocked: chunks.filter((_, n) => i ? n % (17 + slot) === i : n === 0) })));
      state.rules['content.f2p'] = false; state.taskRules = { Boosting: i === 2 };
      for (const member of state.members) member.passiveLevels = Object.fromEntries(playerControlSkills.map(skill => [skill, i === 0 ? 1 : i === 1 ? 35 : 70]));
      states.push(state);
    }
  }
  const evaluate = createComparisonEvaluator(definitions, false, { reviewedOverlays: true });
  const world = buildWorld(definitions, { dataset: selectedDataset, cacheWalking: false, reviewedOverlays: true });
  const observations = [], durationsMs = [];
  for (const state of states) for (const member of state.members) {
    const before = hash(state), start = performance.now();
    const result = evaluate(state, member.id), pool = evaluateRollPool(world, state, member.id);
    durationsMs.push(performance.now() - start);
    const stable = semantic(result);
    observations.push({
      parts: Object.fromEntries(Object.entries({ tasks: stable.tasks, presentation: stable.presentation, training: stable.training,
        sources: stable.items, equipment: stable.equipment, activity: stable.activityInfo, pool,
        other: Object.fromEntries(Object.entries(stable).filter(([key]) => !['tasks','presentation','training','items','equipment','activityInfo'].includes(key))) }).map(([key,value]) => [key,hash(value)])),
      taskCount: result.tasks.length, selectedCount: result.presentation.tasks.length,
      explanationHash: hash(result.tasks.map(row => [row.explanation, row.hiddenReasons, row.sourcePolicyRejections, row.sourceExclusion])),
    });
    if (before !== hash(state)) throw Error('Evaluation mutated input.');
  }
  await writeFile(config.result, JSON.stringify({ observations, durationsMs, states: states.length, definitionHash: hash(definitions), peakRSSBytes: process.resourceUsage().maxRSS * 1024 }), { mode: 0o600 });
}
async function main() {
  if (values.child) return child(JSON.parse(await readFile(values.child, 'utf8')));
  if (!values.baseline || !values.candidate || !values.out) throw Error('Explicit baseline, candidate and out required.');
  const runs = Number(values.runs ?? 3), store = values['data-dir'] && path.resolve(values['data-dir']);
  if (!Number.isSafeInteger(runs) || runs < 1) throw Error('Invalid runs.');
  if (store && [values.baseline, values.candidate].some(root => !path.relative(path.resolve(root), store).startsWith('..'))) throw Error('Private save copy must be outside checkouts.');
  const sourceHash = store ? hash(await readFile(path.join(store,'state.json'))) : undefined;
  const scratch = await mkdtemp(path.join(tmpdir(),'task-rule-check-')), trials = [], differences = [];
  try {
    for (let run = 0; run < runs; run++) {
      const pair = [];
      for (const [slot, root] of [values.baseline, values.candidate].entries()) {
        const config = { root: path.resolve(root), store, result: path.join(scratch,`${run}-${slot}-result.json`) };
        const input = path.join(scratch,`${run}-${slot}.json`); await writeFile(input,JSON.stringify(config),{mode:0o600});
        const start = performance.now();
        await new Promise((resolve,reject) => {
          const env = {...process.env, RS3_DATASET:'duo-legacy', RS3_TASK_WORKER_MODE:'process'};
          if (!store) for (const key of ['RS3_PACKS_DIR','RS3_PACK_SELECTION','RS3_GAME_DEFAULTS_FILE','RS3_DATASET_PROFILE','RS3_DATASET_PROFILE_SHA256']) delete env[key];
          const child = spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',input],{cwd:config.root,env,stdio:['ignore','ignore','pipe']});
          let bytes = 0; child.stderr.on('data',data=>{bytes+=data.length;});
          child.once('error',reject); child.once('exit',code=>code===0?resolve():reject(Error(`Comparison child failed: ${code}; diagnostic bytes ${bytes}.`)));
        });
        pair.push({...JSON.parse(await readFile(config.result,'utf8')),wallMs:performance.now()-start});
      }
      const [a,b]=pair;
      assertSameCount(a.observations.length,b.observations.length);
      const diff = { definitions: Number(a.definitionHash !== b.definitionHash), semanticParts: 0, explanationEvaluations: 0 };
      a.observations.forEach((left,index)=>{
        const right=b.observations[index];
        for (const key of Object.keys(left.parts)) if(left.parts[key]!==right.parts[key]) diff.semanticParts++;
        if(left.explanationHash!==right.explanationHash) diff.explanationEvaluations++;
      });
      differences.push(diff); trials.push(pair.map(({wallMs,peakRSSBytes,durationsMs})=>({wallMs,peakRSSBytes,durationsMs})));
      console.log(JSON.stringify({run:run+1,states:a.states,evaluations:a.observations.length,...diff}));
    }
    const report={runs,sourceHash,differences,trials,before:{wallMs:spread(trials.map(t=>t[0].wallMs)),peakRSSBytes:spread(trials.map(t=>t[0].peakRSSBytes))},
      after:{wallMs:spread(trials.map(t=>t[1].wallMs)),peakRSSBytes:spread(trials.map(t=>t[1].peakRSSBytes))}};
    await writeFile(values.out,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({before:report.before,after:report.after}));
    if (differences.some(diff=>diff.definitions||diff.semanticParts)) process.exitCode=1;
    if (store && sourceHash!==hash(await readFile(path.join(store,'state.json')))) throw Error('Copied input changed.');
  } finally {await rm(scratch,{recursive:true,force:true});}
}
function assertSameCount(a,b) {if(a!==b) throw Error('Evaluation count mismatch.');}
main().catch(error=>{ console.error(values.child ? 'Comparison child failed.' : error.message); process.exitCode=1; });
