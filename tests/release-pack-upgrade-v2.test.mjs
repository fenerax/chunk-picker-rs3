// Owned releases/stores; acknowledged native startup and controlled stage faults.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, rm, access } from 'node:fs/promises';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { bindingBytes, checkPackTransition, assertStableIdentities, assertPreserved, saveIdentity, runProbe, joinChild, stopChildTree } from '../scripts/private-companion/release-pack-check.mjs';
import { digestValue, writeSuccessReceipt } from '../scripts/private-companion/release-identity.mjs';
import { gateContract, lookupEvidence, verifyLocalEvidence } from '../scripts/private-companion/release-evidence.mjs';
import { packedFixture, fixture, put, hash, runStage, retainFixture } from './helpers/release-pack-fixture.mjs';
import { stageCases, assertStageRecovery } from './helpers/release-pack-stages.mjs';
import { assertNativePackedStartup } from './helpers/release-pack-native.mjs';
import { closeStageHost, stageFileController } from './helpers/release-pack-host.mjs';

// One catastrophic file guard, not a per-case performance assertion. Normal
// completion is acknowledged work plus exit; timestamps never decide success.
let emergency;
before(()=>{
  emergency=setTimeout(()=>stageFileController.abort(Error('Release-pack file emergency guard: 10 minutes without file completion')),10*60*1000);
  emergency.unref();
});
after(async()=>{try{await closeStageHost();}finally{clearTimeout(emergency);}});

// Register the owner join before any fixture cleanup. Even a failed test
// deadline cannot remove a store while its startup/probe operation is alive.
const owned = body => async t => {
  let finish;
  const closed = new Promise(resolve => { finish=resolve; });
  t.after(()=>closed);
  const signal=AbortSignal.any([t.signal,stageFileController.signal]);
  const context=new Proxy(t,{get(target,key){
    if(key==='signal')return signal;
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
  try { return await body(context); }
  catch(error) {
    // Native cancellation can replace the thrown error with a generic timeout.
    // stderr survives the stability runner's output transport in that case.
    console.error('Release-pack case '+t.name+': '+(error.stack??String(error)));
    throw error;
  }
  finally { finish(); }
};

for(const rollback of [false,true]) for(const {point,crash} of stageCases) {
  if(point.startsWith('pending-')&&!rollback) continue;
  test(`${rollback?'rollback':'upgrade'} ${crash?'process-exit':'interruption'} ${point}: reconcile under ownership, preserve current save`,
    {skip:process.platform!=='win32'},owned(t=>assertStageRecovery(t,{rollback,point,crash})));
}

test('compatibility uses separate packed startup processes, checks latest save both ways and refuses changed identity/binding', owned(async t=>{
  const forward=await packedFixture(t);
  const output=path.join(forward.root,'compatibility.json');
  const check=async(f,extra={})=>{
    const binding=await readFile(f.data+'.dataset.json');
    try {
      const result=await checkPackTransition({fromConfig:f.configs[0],toConfig:f.configs[1],transition:f.plan,signal:t.signal,...extra});
      if(result.retainedScratchDirectory)retainFixture(f.root);
      return result;
    }
    catch(error) { if(error.retainScratch)retainFixture(f.root);throw error; }
    finally { assert.deepEqual(await readFile(f.data+'.dataset.json'),binding,'compatibility changed the source binding'); }
  };
  const result=await check(forward,{output});
  assert.equal(result.bothDirections,true);
  assert.equal(result.forwardAfterRollback,true);
  assert.equal(result.progressPreserved,true);
  assert.equal(result.tasksServed,true);
  assert.equal(result.probes.length,4); // old → new → old → new
  assert.deepEqual([result.old,result.new],forward.descriptors);
  assert.equal(result.saveDigest,digestValue(await saveIdentity(forward.data)));
  const startup=(await readFile(path.join(forward.root,'startups.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const spawned=startup.filter(row=>row.phase==='spawned');
  assert.deepEqual(spawned.map(row=>row.pack),['old','new','old','new']);
  assert.equal(new Set(spawned.map(row=>row.pid)).size,4);
  for(const {pid,revision} of spawned){
    assert.equal(revision,9);
    assert.deepEqual(startup.filter(row=>row.pid===pid).map(row=>row.phase),['spawned','ready','probe','closed']);
  }
  const receipt=await readFile(output);
  // Never accept/overwrite a previous observation at an output evidence path.
  await assert.rejects(check(forward,{output}),{code:'EEXIST'});
  assert.deepEqual(await readFile(output),receipt);
  // Timestamp freshness is a separate gate from immutable output ownership.
  // Author a valid, exact-key success receipt with a deliberately old timestamp.
  const evidenceRoot=await fixture(t),contract=gateContract('public',{pack:forward.descriptors[0].digest},{digest:'a'.repeat(64)});
  const filename=path.join(evidenceRoot,contract.lane+'-'+contract.key+'.json');
  const record=await writeSuccessReceipt(filename,{key:contract.key,inputDigest:contract.inputDigest,executionDigest:contract.executionDigest,
    startedAt:'2000-01-01T00:00:00.000Z',completedAt:'2000-01-01T00:00:01.000Z',exitCode:0,cleanupVerified:true});
  await put(filename+'.identity.json',contract);
  assert.equal(await lookupEvidence(evidenceRoot,contract),null,'stale success cannot authorize an upgrade');
  await assert.rejects(verifyLocalEvidence({filename,record,contract},contract),/stale/);

  const rollback=await packedFixture(t,{failNew:true});
  const reverse=await check(rollback,{fromConfig:rollback.configs[1],toConfig:rollback.configs[0]});
  assert.equal(reverse.rollbackTargetOpened,true);
  assert.equal(reverse.probes.length,1); // retained old opens latest save even if new cannot start

  const mismatch=await packedFixture(t);
  const foreign={...mismatch.plan.new,digest:'3'.repeat(64)},foreignBytes=bindingBytes(foreign);
  foreign.bindingSha256=hash(foreignBytes);
  await assert.rejects(check(mismatch,{transition:{...mismatch.plan,new:foreign,newBindingBase64:foreignBytes.toString('base64')}}),/descriptor/);
  const binding=await packedFixture(t);
  await put(binding.data+'.dataset.json','unknown binding');
  await assert.rejects(check(binding),/binding differs/);
  const identities=await packedFixture(t,{changedIdentity:true});
  await assert.rejects(check(identities),/identities/);

  const latest=await packedFixture(t,{incompatible:true});
  await assert.rejects(check(latest),error=>{
    assert.match(error.message,/incompatible latest save revision 10/);
    assert.match(error.message,/INCOMPATIBLE_SAVE/);
    assert.match(error.message,/"exitCode":1/);
    assert.match(error.message,/"signal":null/);
    assert.match(error.message,/stderrTail/);
    return true;
  });
  // A second direction must also open the actual latest source, not a cached
  // forward observation. New code is deliberately unable to start here.
  const latestReverse=await packedFixture(t,{incompatible:true,failNew:true});
  await assert.rejects(check(latestReverse,{fromConfig:latestReverse.configs[1],toConfig:latestReverse.configs[0]}),/INCOMPATIBLE_SAVE/);
  assert.throws(()=>assertStableIdentities({authored:{id:1},saved:{}},{authored:{id:2},saved:{}}),/identities/);
}));

for(const target of ['old','new']) test(`owned synthetic ${target} pack opens the latest save through the actual server, store and process workers`,
  owned(t=>assertNativePackedStartup(t,target)));

test('packed child completion bounds stderr drain after exit and retains original failures', owned(async t=>{
  const root=await fixture(t),output=path.join(root,'probe.json');
  await put(output,{synthetic:'report'});
  const config={nodePath:process.execPath,packsDir:root,coreRoot:root,selection:{path:'synthetic'},profile:{path:'synthetic',sha256:'synthetic'},addons:{path:'',sha256:''}};
  const child=()=>Object.assign(new EventEmitter(),{stderr:new PassThrough(),send(message,callback){assert.deepEqual(message,{type:'probe'});callback();},kill(){throw Error('unexpected kill')}});
  const success=child();
  let readStarted=false;
  const pending=runProbe(config,root,output,{spawnImpl:()=>success,readReport:()=>{readStarted=true;return {synthetic:'report'};},
    setDrainTimer(_callback,ms){assert.equal(ms,100);return {};},clearDrainTimer(){}});
  success.emit('message',{type:'ready'});success.emit('message',{type:'probe'});success.emit('message',{type:'closed'});
  success.emit('exit',0,null);
  await setImmediate(); // controlled event ordering, not an assertion-condition wait
  assert.equal(readStarted,false,'exit must not release the store or read the report');
  success.emit('close',0,null);
  assert.deepEqual(await pending,{synthetic:'report'});
  for(const code of [0,7]) {
    const drained=child();drained.kill=()=>false;
    let drain,retained=false,reportRead=false,settlement='pending';
    const result=runProbe(config,root,output,{spawnImpl:()=>drained,
      setDrainTimer(callback,ms){assert.equal(ms,100);drain=callback;return {};},clearDrainTimer(){},
      onUnjoined(outcome){retained=true;assert.equal(outcome.closed,false);assert.equal(outcome.exited,true);assert.equal(outcome.drainExpired,true);},
      readReport(){reportRead=true;return {synthetic:'report'};}});
    const observed=code===0?result:assert.rejects(result,error=>{
      assert.equal(error.retainScratch,true);
      assert.match(error.message,/"exitCode":7/);assert.match(error.message,/stderr after exit without close/);return true;
    });
    result.then(()=>{settlement='resolved';},()=>{settlement='rejected';});
    for(const type of ['ready','probe','closed'])drained.emit('message',{type});
    drained.emit('exit',code,null);
    drained.stderr.write('stderr after exit without close');
    assert.equal(reportRead,false);
    drain();
    await setImmediate(); // one controlled event turn, never an assertion-condition poll
    assert.equal(settlement,code===0?'resolved':'rejected','exit drain must settle without close');
    await observed;
    assert.equal(reportRead,code===0);assert.equal(retained,true);assert.ok(drained.stderr.destroyed);
  }
  for(const [code,signal,original]of [[7,null,undefined],[null,'SIGTERM',undefined],[-2,null,Object.assign(Error('original spawn refusal'),{code:'ENOENT'})]]){
    const failure=child();
    const refused=assert.rejects(runProbe(config,root,output,{spawnImpl:()=>failure}),error=>{
      assert.ok(error.message.includes('"exitCode":'+JSON.stringify(code)));
      assert.ok(error.message.includes('"signal":'+JSON.stringify(signal)));
      assert.match(error.message,/before exit; original stderr after exit/);
      if(original){assert.equal(error.cause,original);assert.match(error.message,/original spawn refusal/);assert.match(error.message,/ENOENT/);}
      return true;
    });
    failure.stderr.write('before exit; ');
    if(original)failure.emit('error',original);
    failure.emit('exit',code,signal);
    failure.stderr.end('original stderr after exit');
    failure.emit('close',code,signal);
    await refused;
  }
}));

test('packed watchdog refuses without a subsequent close and retains exit diagnostics', async () => {
  const config={nodePath:process.execPath,coreRoot:'synthetic',packsDir:'synthetic',selection:{path:'synthetic'},profile:{path:'synthetic',sha256:'synthetic'},addons:{path:'',sha256:''}};
  for(const exit of [[0,null],[7,null],[null,'SIGTERM'],undefined]) for(const killThrows of [false,true]) {
    let watchdog,kills=0,reads=0,unrefs=0,disconnects=0,outcome='pending',failure;
    const timer={},stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
    const child=Object.assign(new EventEmitter(),{stdin,stdout,stderr,stdio:[stdin,stdout,stderr],connected:true,
      send(_message,callback){callback();},kill(){kills++;if(killThrows)throw Error('synthetic kill refusal');return false;},
      disconnect(){disconnects++;this.connected=false;},unref(){unrefs++;}});
    try {
      const pending=runProbe(config,'synthetic','synthetic',{spawnImpl:()=>child,readReport:()=>{reads++;return {};},
        setTimer(callback,delay){assert.equal(delay,180000);watchdog=callback;return timer;},
        clearTimer(handle){assert.equal(handle,timer);}});
      const handled=pending.then(()=>{outcome='resolved';},error=>{outcome='rejected';failure=error;});
      for(const type of ['ready','probe','closed'])child.emit('message',{type});
      stderr.write('original stderr before watchdog');
      if(exit)child.emit('exit',...exit);
      watchdog();
      await setImmediate(); // flush the controlled timeout's promise reactions
      assert.equal(outcome,'rejected','watchdog must reject without close');
      await handled;
      assert.equal(failure.code,'CHILD_CLOSE_TIMEOUT');
      assert.equal(failure.retainScratch,true);
      assert.match(failure.message,/timed out/);
      assert.ok(failure.message.includes('"exitCode":'+JSON.stringify(exit?.[0]??null)));
      assert.ok(failure.message.includes('"signal":'+JSON.stringify(exit?.[1]??null)));
      assert.match(failure.message,/original stderr before watchdog/);
      assert.match(failure.message,/"phases":\["spawned","ready","probe","closed"\]/);
      if(killThrows)assert.match(failure.message,/synthetic kill refusal/);
      assert.equal(kills,1);assert.equal(reads,0);assert.equal(unrefs,1);assert.equal(disconnects,1);
      assert.ok([stdin,stdout,stderr].every(stream=>stream.destroyed));
      child.emit('close',...(exit??[null,'SIGTERM']));
      await setImmediate();
      assert.equal(reads,0,'a late close must never authorize the timed-out report');
    } finally {
      child.emit('close',...(exit??[null,'SIGTERM']));
      for(const stream of [stdin,stdout,stderr])stream.destroy();
    }
  }
});

test('unjoined packed timeout preserves the scratch save and failure evidence', owned(async t=>{
  const f=await packedFixture(t),output=path.join(f.root,'compatibility.json');
  const before=await readFile(path.join(f.data,'state.json'));
  let scratch,child,fire,clears=0,reads=0;
  const timer={};
  try {
    await assert.rejects(checkPackTransition({fromConfig:f.configs[0],toConfig:f.configs[1],transition:f.plan,output,
      probeImpl:(config,data,report)=>{
        scratch=path.dirname(data);
        child=Object.assign(new EventEmitter(),{stderr:new PassThrough(),send(_message,callback){callback();},kill(){return false;},unref(){}});
        queueMicrotask(()=>{
          for(const type of ['ready','probe','closed'])child.emit('message',{type});
          child.emit('exit',0,null);fire();
        });
        return runProbe(config,data,report,{spawnImpl:()=>child,readReport:()=>{reads++;return {};},
          setTimer(callback,delay){assert.equal(delay,180000);fire=callback;return timer;},
          clearTimer(handle){assert.equal(handle,timer);clears++;}});
      } }),error=>{
      assert.equal(error.code,'CHILD_CLOSE_TIMEOUT');
      assert.equal(error.retainedScratchDirectory,scratch);
      assert.ok(error.message.includes('scratch retained at '+scratch));
      return true;
    });
    assert.equal(reads,0);assert.equal(clears,1);assert.ok(child.stderr.destroyed);
    assert.deepEqual(await readFile(path.join(scratch,'old/state.json')),before);
    assert.deepEqual(await readFile(path.join(f.data,'state.json')),before);
    const failure=JSON.parse(await readFile(output+'.failure.json'));
    assert.equal(failure.passed,false);assert.equal(failure.retainedScratchDirectory,scratch);
    await assert.rejects(access(output),{code:'ENOENT'});
  } finally {
    // This child is entirely controlled and never owned a real process/store.
    child?.emit('close',0,null);
    if(scratch)await rm(scratch,{recursive:true,force:true});
  }
}));

test('Windows watchdog terminates the owned descendant that holds stderr', {skip:process.platform!=='win32'}, owned(async t=>{
 for(const exitBeforeTimeout of [false,true]) {
  const root=await fixture(t), script=path.join(root,'tree.mjs'), observerScript=path.join(root,'observe.ps1');
  await put(script,`
import {spawn} from 'node:child_process';
if(process.argv[2]==='leaf') { process.send('ready'); setInterval(()=>{},1000); }
else {
  const leaf=spawn(process.execPath,[import.meta.filename,'leaf'],{windowsHide:true,detached:true,stdio:['ignore','ignore','inherit','ipc']});
  leaf.once('message',()=>process.send({leaf:leaf.pid}));
  process.once('message',()=>process.exit(0));
  setInterval(()=>{},1000);
}`);
  const child=spawn(process.execPath,[script],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
  // Windows may report pipe close when this root exits even while its leaf is
  // alive. Withhold that event explicitly for the exited-root variant; the OS
  // process and independent observer remain real, only close ordering is controlled.
  const endpoint=exitBeforeTimeout?Object.assign(new EventEmitter(),{
    pid:child.pid,stderr:child.stderr,stdio:child.stdio,
    kill:child.kill.bind(child),disconnect:child.disconnect.bind(child),unref:child.unref.bind(child),
  }):child;
  if(exitBeforeTimeout) {
    for(const key of ['exitCode','signalCode','connected','channel'])Object.defineProperty(endpoint,key,{get:()=>child[key]});
    child.on('exit',(...args)=>endpoint.emit('exit',...args));
    child.on('error',error=>endpoint.emit('error',error));
  }
  let observer, leaf, fire;
  const stop=()=>{
    if(child.exitCode===null&&child.signalCode===null)try{stopChildTree(child);}catch{}
    // The observer holds the leaf's process handle until it exits. This PID is
    // supplied by our own launched root, never discovered by a broad PID sweep.
    if(leaf)try{process.kill(leaf,'SIGKILL');}catch{}
    try{child.kill('SIGKILL');}catch{}
    try{observer?.kill('SIGKILL');}catch{}
  };
  t.signal.addEventListener('abort',stop,{once:true});
  const joined=joinChild(endpoint,{setTimer(callback,delay){assert.equal(delay,180000);fire=callback;return {};},clearTimer(){},
    setDrainTimer(_callback,delay){assert.equal(delay,100);return {};},clearDrainTimer(){}});
  // Install the refusal handler before firing the controlled production timer.
  const refused=assert.rejects(joined,error=>{
    assert.equal(error.code,'CHILD_CLOSE_TIMEOUT');
    assert.match(error.message,/taskkill \/T \/F/);
    const details=JSON.parse(error.message.split(' timed out: ')[1]);
    assert.equal(details.exited,exitBeforeTimeout);
    assert.equal(details.closed,false);
    if(details.diagnostics.descendantsAtFailure===null)assert.ok(details.diagnostics.queryError);
    else assert.ok(details.diagnostics.descendantsAtFailure.some(row=>row.pid===leaf),error.message);
    return true;
  });
  try {
    [{leaf}]=await once(child,'message',{signal:t.signal});
    assert.ok(Number.isSafeInteger(leaf)&&leaf>0);
    await put(observerScript,`$ErrorActionPreference='Stop'\n$p=Get-Process -Id ${leaf}\n$null=$p.Handle\n[Console]::Out.WriteLine('observing')\n$null=[Console]::In.ReadLine()\nif($p.HasExited){throw 'Owned leaf did not survive until the watchdog'}\n[Console]::Out.WriteLine('alive')\n$p.WaitForExit()\n[Console]::Out.WriteLine('exited')\n$p.Dispose()\n`);
    observer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',observerScript],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const observed=joinChild(observer,{setTimer:()=>undefined,signal:t.signal,label:'Owned descendant exit observer'});
    observed.catch(()=>{}); // retain the error for await, including during cancellation
    const [ready]=await once(observer.stdout,'data',{signal:t.signal});
    assert.match(ready.toString(),/observing/);
    if(exitBeforeTimeout) {
      const exited=once(child,'exit',{signal:t.signal});
      child.send('exit');
      await exited;
    }
    const alive=once(observer.stdout,'data',{signal:t.signal});
    observer.stdin.end('confirm\n');
    assert.match((await alive)[0].toString(),/alive/,'the leaf must be alive when the watchdog fires');
    fire();
    await refused;
    const result=await observed;
    assert.equal(result.exitCode,0,result.stderrTail);
    assert.match(result.stdout,/exited/,'the descendant must actually exit, not merely lose the parent pipe');
    leaf=undefined; // its held process handle has now been joined and closed
  } finally {
    stop();t.signal.removeEventListener('abort',stop);
  }
 }
}));

test('stage watchdog bounds an unjoined child and preserves its fixture at teardown', async()=>{
  const hooks=[],diagnostics=[],context={after:hook=>hooks.push(hook),diagnostic:message=>diagnostics.push(message)};
  const root=await fixture(context);
  let child,fire;
  const timer={};
  try {
    await put(path.join(root,'store/state.json'),{revision:41});
    await assert.rejects(runStage(root,'# synthetic controlled child',0,{
      spawnImpl:()=>{
        child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill(){return false;},unref(){}});
        queueMicrotask(()=>{child.emit('exit',75,null);child.stderr.write('stage stderr still open');fire();});
        return child;
      },
      setTimer(callback,delay){assert.equal(delay,180000);fire=callback;return timer;},
      clearTimer(handle){assert.equal(handle,timer);}
    }),error=>{
      assert.equal(error.code,'CHILD_CLOSE_TIMEOUT');assert.equal(error.retainScratch,true);
      assert.match(error.message,/"exitCode":75/);assert.match(error.message,/stage stderr still open/);
      return true;
    });
    assert.ok(child.stdout.destroyed&&child.stderr.destroyed);
    for(const hook of hooks)await hook();
    assert.deepEqual(JSON.parse(await readFile(path.join(root,'store/state.json'))),{revision:41});
    assert.ok(diagnostics.some(message=>message.includes(root)));
  } finally {
    child?.emit('close',75,null);
    await rm(root,{recursive:true,force:true});
  }
});

test('case cancellation refuses an unclosed stage with its name, pid and live-descendant diagnostics', async()=>{
  const hooks=[],context={after:hook=>hooks.push(hook),diagnostic(){}};
  const root=await fixture(context), controller=new AbortController();
  let child,cleared=0,killed=0,queries=0;
  try {
    await assert.rejects(runStage(root,'# controlled cancellation',0,{
      signal:controller.signal,stageName:'upgrade after-binding recovery',
      spawnImpl:()=>{
        // Zero cannot address a native process; the entire child is controlled.
        child=Object.assign(new EventEmitter(),{pid:0,stdout:new PassThrough(),stderr:new PassThrough(),kill(){killed++;return false;},unref(){}});
        queueMicrotask(()=>{child.emit('exit',75,null);controller.abort(Error('synthetic case deadline'));});
        return child;
      },
      setTimer(_callback,delay){assert.equal(delay,180000);return {};},clearTimer(){cleared++;},
      diagnose(endpoint){assert.equal(endpoint,child);queries++;return {descendantsAtFailure:[{pid:123,parentPid:0,name:'node.exe'}]};}
    }),error=>{
      assert.equal(error.code,'CHILD_ABORTED');assert.equal(error.retainScratch,true);
      assert.match(error.message,/upgrade after-binding recovery cancelled/);
      for(const text of ['"pid":0','"exitCode":75','"exited":true','"closed":false','descendantsAtFailure','"pid":123','node.exe'])assert.ok(error.message.includes(text),text);
      return true;
    });
    assert.equal(cleared,1);assert.equal(killed,1);assert.equal(queries,1);
    assert.ok(child.stdout.destroyed&&child.stderr.destroyed);
    for(const hook of hooks)await hook();
    await access(root);
  } finally {
    child?.emit('close',75,null);
    await rm(root,{recursive:true,force:true});
  }
});

test('declared saved identity additions are exact and newly dataset-authored', () => {
  const resolution = id => ({status:'resolved',id,candidates:[id]});
  const a = {authored:{ids:['old'],aliases:{}}, saved:{old:resolution('old')}, datasetAuthored:{old:'old'}};
  const b = {...a,saved:{...a.saved,new:resolution('new'),alias:resolution('new')},datasetAuthored:{old:'old',new:'new',alias:'new'}};
  const additions = [{key:'new',target:'new'},{key:'alias',target:'new'}];
  assert.doesNotThrow(()=>assertStableIdentities(a,b,additions));
  assert.throws(()=>assertStableIdentities(a,b),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,extra:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{old:a.saved.old,new:b.saved.new}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{...b.saved,old:resolution('new')}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,saved:{new:b.saved.new,alias:b.saved.alias}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,{...b,authored:{ids:['changed'],aliases:{}}},additions),/identities/);
  assert.throws(()=>assertStableIdentities(a,b,[...additions,additions[0]]),/addition/);
  assert.throws(()=>assertStableIdentities(a,{...b,datasetAuthored:a.datasetAuthored},additions),/addition/);
  assert.throws(()=>assertStableIdentities({...a,datasetAuthored:b.datasetAuthored},b,additions),/addition/);
  const authored={ids:['old','new'],aliases:{}};
  assert.throws(()=>assertStableIdentities({...a,authored},{...b,authored},additions),/addition/);
});

test('saved progress preservation allows only appended catalogue bookkeeping and retains every existing event', () => {
  const a={taskIds:['kept'],progressDigest:'same',progressFields:{members:'same'},historyEvents:['old'],historyTypes:['command'],migrationArchives:['archive'],migrationConversions:[],migrationConflicts:[]};
  const b={...a,taskIds:['kept','new'],historyEvents:['old','refresh'],historyTypes:['command','catalogue-refresh'],migrationArchives:['archive','new-archive']};
  assert.doesNotThrow(()=>assertPreserved(a,b));
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyEvents:['changed','refresh']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,historyTypes:['command','command']}),/history/);
  assert.throws(()=>assertPreserved(a,{...b,migrationArchives:[]}),/archive/);
  assert.throws(()=>assertPreserved(a,{...b,taskIds:['new']}),/progress/);
  assert.throws(()=>assertPreserved(a,{...b,progressDigest:'changed',progressFields:{members:'changed'}}),/progress/);
});

test('daily progress counts may recount only the latest day or start a new one; past days and real progress stay exact', () => {
  const history={historyEvents:[],historyTypes:[],migrationArchives:[],migrationConversions:[],migrationConflicts:[],taskIds:['kept']};
  const report=(rows,{members='same',meta='meta'}={})=>({...history,progressSnapshotRows:rows,progressSnapshotMeta:meta,
    progressDigest:'whole-'+JSON.stringify(rows)+members,progressFields:{members,progressSnapshots:'days-'+JSON.stringify(rows)}});
  const a=report([[100,'d100'],[101,'d101']]);
  assert.doesNotThrow(()=>assertPreserved(a,report([[100,'d100'],[101,'recounted']])));
  assert.doesNotThrow(()=>assertPreserved(a,report([[100,'d100'],[101,'d101'],[102,'d102']])));
  assert.doesNotThrow(()=>assertPreserved(report([],{meta:null}),report([[101,'d101']])));
  assert.throws(()=>assertPreserved(a,report([[100,'changed'],[101,'d101']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[101,'d101']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'d101'],[99,'d99']])),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'d101']],{meta:'other roster'})),/daily progress/);
  assert.throws(()=>assertPreserved(a,report([[100,'d100'],[101,'recounted']],{members:'changed'})),/fields=members/);
  // Older reports without day rows keep the whole-progress comparison.
  const {progressSnapshotRows,progressSnapshotMeta,...legacy}=a;
  assert.throws(()=>assertPreserved(legacy,{...legacy,progressDigest:'changed',progressFields:{...legacy.progressFields,progressSnapshots:'changed'}}),/progressSnapshots/);
});
