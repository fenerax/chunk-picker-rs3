// Synthetic-only, isolated transfer/command benchmark. Run each size in a fresh
// process: node scripts/measure-transfer-followups.mjs [49|208]
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { createGameplayFingerprint } = await import('../app/storage/gameplay-fingerprint.mjs');
const roster = [{ id: 'one', name: 'Synthetic player' }, { id: 'two', name: 'Synthetic partner' }];
const world = { chunks: new Map([['100', { id: '100' }]]), neighbors: new Map(), walkable: new Set(['100']), f2p: new Set(['100']) };
const maximum = process.argv[2] === '208';
let state = createGroupState(roster);
state.tasks = Array.from({length: 20_503}, (_,i) => ({id: `rs3:task:synthetic-${i}`, category: 'Custom', label: `Synthetic objective ${i}`}));
for (const member of state.members) member.completedTasks = state.tasks.map(task => task.id);
state.revision = 2_000;
state.history = Array.from({length: 2_000}, (_,i) => ({id: `revision-${i+1}`, revision: i+1, type: 'edit-task', at:'2026-01-01T00:00:00.000Z'}));
state.identityRegistry = {schemaVersion:1, entries:{}, aliases:{}, unresolved:[]};
for (const [i,task] of state.tasks.entries()) {
  const aliases = Array.from({length:4}, (_,j)=>`Synthetic category ${j}: objective ${i} ${'synthetic description '.repeat(3)}`);
  state.identityRegistry.entries[task.id] = {...task, kind:'task', rawLabel:task.label, aliases};
  for (const alias of aliases) state.identityRegistry.aliases[alias]=task.id;
}
state.provenance = {taskIdentityMigration:{archives:[{tasks:state.tasks,members:state.members,identityRegistry:state.identityRegistry,history:state.history}]}};
if (maximum) {
  state.provenance.syntheticPadding=[];
  let remaining = 208*1024**2 - Buffer.byteLength(JSON.stringify({backup:{format:'rs3-chunk-picker',schemaVersion:1,state}}));
  while (remaining>4) {
    const text='x'.repeat(Math.min(64*1024, remaining-3));
    state.provenance.syntheticPadding.push(text); remaining-=text.length+3;
  }
}
const portableBytes = Buffer.byteLength(JSON.stringify({format:'rs3-chunk-picker',schemaVersion:1,state}));
let input=serialize({backup:{format:'rs3-chunk-picker',schemaVersion:1,state}}); state=undefined;
async function measure(work) {
  let last=performance.now(), gap=0;
  const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;},5);
  const start=performance.now();
  try { const result=await work(); await new Promise(resolve=>setTimeout(resolve,5)); gap=Math.max(gap,performance.now()-last); return {result,ms:performance.now()-start,gap}; }
  finally {clearInterval(timer);}
}
const directory=await mkdtemp(path.join(tmpdir(),'synthetic-transfer-followups-'));
let cloneable, hookCalls=0, commits=0;
const store=await openStore({dataDir:directory, initialState:createGroupState(roster), world, retention:false,
  prepareImportState(value) {
    hookCalls++;
    try { structuredClone(value.members); cloneable=true; } catch(error) {assert.equal(error.name,'DataCloneError');cloneable=false;}
    (value.members[0].notes ??= {})['100']='Synthetic hook note'; return value;
  },
  ...(process.argv[3] === 'no-commit-hook' ? {} : { beforeCommit(change) { commits++; assert.ok(change.state); } })
});
try {
  // Match the server subscriber, including its first gameplay/provenance digest.
  store.getGameplayFingerprint(); void store.getCalculationSnapshot().taskInputKey;
  store.subscribe(()=>{store.getGameplayFingerprint();void store.getCalculationSnapshot().taskInputKey;});
  const preview=await measure(()=>store.prepareTransfer(input,{route:'/api/restore/preview',dataset:{datasetId:'duo-legacy',capabilities:{}},world,responseView:'play-v1'})); input=undefined;
  const apply=await measure(()=>store.applyTransfer(preview.result.ticket,0));
  assert.equal(apply.result.state.members[0].notes['100'],'Synthetic hook note');
  assert.equal(store.getGameplayFingerprint(),createGameplayFingerprint()(apply.result.state));
  const edit=await measure(()=>store.commandSerialized({type:'set-note',memberId:'one',chunkId:'100',note:'Synthetic command note'},1,{view:'play-v1',omitUnchanged:true}));
  const undo=await measure(()=>store.commandSerialized({type:'undo'},2,{view:'play-v1',omitUnchanged:true}));
  assert.equal(store.getInfo().revision,3);
  const responseBytes=Buffer.byteLength(JSON.stringify({state:JSON.parse(edit.result.stateJSON),pools:edit.result.pools,baseRevision:edit.result.baseRevision,unchangedFields:edit.result.unchangedFields}));
  const fullCommand=await measure(()=>store.command({type:'set-note',memberId:'one',chunkId:'100',note:'Synthetic full-result note'},3));
  const smallCommand=await measure(()=>store.command({type:'set-note',memberId:'one',chunkId:'100',note:'Synthetic revision-result note'},4,{returnState:false}));
  const smallResultBytes=Buffer.byteLength(JSON.stringify(smallCommand.result));
  const summary = value=>({ms:+value.ms.toFixed(1),gapMs:+value.gap.toFixed(1)});
  console.log(JSON.stringify({maximum,portableBytes,cloneable,hookCalls,commits,preview:summary(preview),apply:summary(apply),edit:summary(edit),undo:summary(undo),responseBytes,
    fullCommand:summary(fullCommand),smallCommand:summary(smallCommand),smallResultBytes}));
  if (process.argv[3] === 'paired-results') {
    if (!global.gc) throw new Error('Run paired-results with node --expose-gc');
    // Release earlier response copies and collect outside each timed command.
    // Alternate order so the smaller result is not always measured second.
    for (const value of [preview, apply, edit, undo, fullCommand, smallCommand]) value.result = undefined;
    const samples = [];
    for (const [index, mode] of ['full', 'small', 'small', 'full', 'full', 'small'].entries()) {
      global.gc();
      const measured = await measure(() => store.command({ type: 'set-note', memberId: 'one', chunkId: '100', note: `Synthetic paired note ${index}` },
        store.getInfo().revision, { returnState: mode === 'full' }));
      samples.push({ mode, ...summary(measured), bytes: Buffer.byteLength(JSON.stringify(measured.result)) });
      measured.result = undefined;
    }
    const median = values => values.sort((a,b) => a-b)[Math.floor(values.length/2)];
    const grouped = mode => {
      const rows = samples.filter(row => row.mode === mode);
      return { ms: median(rows.map(row => row.ms)), gapMs: median(rows.map(row => row.gapMs)), bytes: median(rows.map(row => row.bytes)) };
    };
    console.log(JSON.stringify({ pairedResults: true, portableBytes, full: grouped('full'), small: grouped('small'), samples }));
  }
} finally {await store.close();await rm(directory,{recursive:true,force:true});}
