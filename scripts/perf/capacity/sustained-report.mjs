import { diagnosticMarkdown, fixtureReuseMarkdown } from './report.mjs';
import { distribution } from './driver.mjs';
import { cleanExit } from './evidence.mjs';
import { assertMemoryProfile, memoryProfileMarkdown, evaluateMemoryProfile } from './memory-profile.mjs';
import { assertResidency, evaluateResidency, residencyMarkdown } from './residency.mjs';

// Both profiles must meet the same user-requested bars, evaluated separately.
export const profileSpeedBars = Object.freeze(Object.fromEntries(['default','budget-672'].map(name=>
  [name,Object.freeze({everydayMs:300,heavyMs:3000,coldOpenMs:2000})])));

export const everydayActions = ['state','history','task-view','group-task-view','how','why','note','tick','undo','session'];
export const heavyActions = ['task-miss','preview','roll-accept','pool-undo'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const time = value => Number.isFinite(value) && value >= 0;
const values = object => Object.values(object??{});
const total = object => values(object).reduce((n,value)=>n+value,0);
const slot = row => `${row.stage}:${row.phase}:${row.action}`;
const terminalFailures = row => Object.entries(row.statuses??{}).reduce((n,[status,value])=>n+(status==='200'?0:value),0);
const unique = (rows,size) => Array.isArray(rows)&&rows.length===size&&new Set(rows).size===size;
const sameMembers = (rows,expected) => unique(rows,expected.length)&&rows.every(id=>expected.includes(id));
function continuousSamples(samples,start,end,maxGapMs) {
  const last=samples.findIndex(row=>row.elapsedMs>=end);
  const window=last<0?[]:samples.slice(0,last+1).filter(row=>row.elapsedMs>=start);
  return window.length>0&&window[0].elapsedMs-start<=maxGapMs&&window.at(-1).elapsedMs-end<=maxGapMs&&
    window.every((row,index)=>index===0||row.elapsedMs-window[index-1].elapsedMs<=maxGapMs);
}
function completion(rows,actions,offered) {
  const selected = rows.filter(row=>actions.includes(row.action));
  const expected = (offered??[]).filter(row=>actions.includes(row.action));
  const missing = actions.filter(action=>!expected.some(row=>row.action===action&&row.count>0)||!selected.some(row=>row.action===action&&row.latency?.count>0));
  const valid = unique(expected.map(slot),expected.length)&&expected.every(row=>count(row.count)&&row.count>0&&
    selected.filter(actual=>slot(actual)===slot(row)).length===1&&selected.find(actual=>slot(actual)===slot(row)).latency?.count===row.count)&&
    selected.every(row=>expected.some(planned=>slot(planned)===slot(row))&&count(row.latency?.count)&&row.latency.count>0&&
      values(row.statuses).every(count)&&total(row.statuses)===row.latency.count&&row.statuses?.['200']===row.latency.count&&
      count(row.httpRequests)&&values(row.httpStatuses).every(count)&&total(row.httpStatuses)===row.httpRequests&&count(row.coalescedSessionChecks??0)&&
      (row.httpStatuses?.['200']??0)+(row.action==='session'?(row.coalescedSessionChecks??0):0)>=row.latency.count&&
      ['p50Ms','p95Ms','p99Ms'].every(key=>time(row.latency[key]))&&row.latency.p50Ms<=row.latency.p95Ms&&row.latency.p95Ms<=row.latency.p99Ms);
  return {status:!missing.length&&valid?'pass':'fail',missing,expected:expected.reduce((n,row)=>n+row.count,0),
    completed:selected.reduce((n,row)=>n+(row.latency?.count??0),0),failures:selected.reduce((n,row)=>n+terminalFailures(row),0),
    classes:actions.map(action=>({action,p95ByPhaseMs:selected.filter(row=>row.action===action).map(row=>({phase:row.phase,p95Ms:row.latency?.p95Ms??null}))}))};
}
function speed(rows,actions,limitMs,offered) {
  const gate=completion(rows,actions,offered);
  return {...gate,status:gate.status==='pass'&&!rows.some(row=>actions.includes(row.action)&&row.latency.p95Ms>=limitMs)?'pass':'fail',p95LimitMs:limitMs,
    scope:'Scheduled arrival to full HTTP completion, including dispatch, preflights, cooldown/backoff and terminal failures; no browser render time.'};
}
function proof(row,serverId,origin) {
  return !!serverId&&row.serverId===serverId&&row.stateServerId===serverId&&row.tasksServerId===serverId&&
    count(row.stateRevision)&&count(row.tasksRevision)&&row.tasksRevision>=row.stateRevision&&time(row.elapsedMs)&&
    time(row.stateReceivedAt)&&row.stateReceivedAt>=origin&&time(row.tasksReceivedAt)&&row.tasksReceivedAt>=row.stateReceivedAt&&
    row.elapsedMs===row.tasksReceivedAt-origin;
}
function liveRecoveryStream(lifetimes,client,{serverId,startedAt,deadlineAt,confirmedAt,throughAt,completedAt,sampleMs}) {
  const reasons=['unexpected','reconnect','server-restart','cohort-change','workload-end'];
  const connections=lifetimes.filter(row=>row.clientId===client.clientId&&row.group===client.group&&row.serverId===serverId&&
    time(row.openedAt)&&row.openedAt>=startedAt&&time(row.closedAt)&&row.closedAt>=row.openedAt&&row.closedAt<=completedAt&&reasons.includes(row.closeReason))
    .sort((a,b)=>a.openedAt-b.openedAt);
  // The fixed profile deliberately reconnects one client at the deadline.
  // Permit a bounded planned handoff, but require its replacement to be live
  // at confirmation. Unexpected ends and immediate handshakes cannot bridge it.
  const handoffMs=Math.max(sampleMs,1500);
  const index=connections.findIndex(row=>row.openedAt<deadlineAt&&row.closedAt-row.openedAt>=sampleMs&&
    (row.closedAt>deadlineAt||row.closeReason==='reconnect'&&row.closedAt>=deadlineAt-handoffMs));
  if(index<0)return null;
  const recovered=connections[index];
  const streamAt=until=>{
    let current=recovered;
    for(let next=index+1;current.closedAt<=until;next++) {
      if(until===throughAt&&current.closedAt===until&&current.closeReason==='workload-end')break;
      const replacement=connections[next];
      if(current.closeReason!=='reconnect'||!replacement||replacement.openedAt<current.closedAt||
        replacement.openedAt-current.closedAt>handoffMs||replacement.openedAt>until)return null;
      current=replacement;
    }
    return current;
  };
  const confirmation=streamAt(confirmedAt);
  return time(throughAt)&&throughAt>confirmedAt&&confirmation&&confirmation.closedAt-confirmation.openedAt>=sampleMs&&streamAt(throughAt)?recovered:null;
}
function headerEvidence(rows,stageStreams,tailStreams,stages) {
  if(!Array.isArray(stageStreams)||stageStreams.length!==stages.length||!tailStreams)return false;
  const streams=[...stageStreams,tailStreams];
  const histogram = (statuses,headers,missing) => values(statuses).every(count)&&values(headers).every(count)&&missing===0&&
    total(headers)===(statuses?.['429']??0)+(statuses?.['503']??0)&&Object.keys(headers??{}).every(value=>/^\d+(?:\.\d+)?$/.test(value)||Number.isFinite(Date.parse(value)));
  return rows.length>0&&rows.some(row=>row.httpRequests>0)&&rows.every(row=>count(row.httpRequests)&&count(row.httpRejects)&&total(row.httpStatuses)===row.httpRequests&&
    row.httpRejects===(row.httpStatuses?.['429']??0)+(row.httpStatuses?.['503']??0)&&histogram(row.httpStatuses,row.retryAfterValues,row.rejectsWithoutRetryAfter))&&
    streams.every(row=>count(row.attempted)&&count(row.handshakes)&&total(row.statuses)===row.handshakes&&histogram(row.statuses,row.retryAfterValues,row.rejectsWithoutRetryAfter))&&
    streams.reduce((n,row)=>n+row.handshakes,0)<=streams.reduce((n,row)=>n+row.attempted,0);
}
export function evaluateSustained(result) {
  assertResidency(result);
  const residencyVerification = result.requestedResidency === undefined ? null : evaluateResidency(result);
  const memoryProfile=assertMemoryProfile(result),bars=profileSpeedBars[memoryProfile],profileVerification=evaluateMemoryProfile(result);
  const {load,profile} = result, measured = load.operations.filter(row=>profile.stages[row.stage]?.measured);
  const activeGroups = profile.stages.at(-1).activeGroups, users = profile.stages.at(-1).users;
  const restart = load.restarts[0], groups = load.recovery.groups, cohort=load.cohort??{};
  const cohortValid=unique(cohort.groups,activeGroups)&&cohort.groups.every(count)&&unique(cohort.clients?.map(row=>row.clientId),users)&&
    cohort.clients.every(row=>typeof row.clientId==='string'&&row.clientId.startsWith(`${row.group}:`)&&row.clientId.length>`${row.group}:`.length&&cohort.groups.includes(row.group))&&
    sameMembers([...new Set(cohort.clients.map(row=>row.group))],cohort.groups);
  const replacement=load.restarts.length===1&&restart.generation===1&&typeof restart.serverId==='string'&&restart.serverId.length>0&&
    typeof load.initialServerId==='string'&&load.initialServerId.length>0&&restart.serverId!==load.initialServerId&&
    time(restart.startedAt)&&time(restart.serverReadyMs)&&cleanExit(restart.shutdown);
  const limitMs=profile.sustained.recoveryDeadlineSeconds*1000;
  const groupProof=cohortValid&&replacement&&sameMembers(groups.map(row=>row.group),cohort.groups)&&
    groups.every(row=>proof(row,restart.serverId,restart.startedAt)&&row.elapsedMs>=restart.serverReadyMs&&row.elapsedMs<limitMs);
  const firstHTTPRecoveryMs = groupProof ? Math.max(...groups.map(row=>row.elapsedMs)) : null;
  const restartElapsedMs = restart?.startedAt - load.workloadStart;
  const deadlineAt=restart?.startedAt+limitMs,deadlineElapsed=restartElapsedMs+limitMs;
  const samples=(result.samples??[]).filter(row=>time(row.elapsedMs)).sort((a,b)=>a.elapsedMs-b.elapsedMs);
  const receiptValid=row=>time(row?.receivedAt)&&time(row?.elapsedMs)&&row.receivedAt===load.workloadStart+row.elapsedMs;
  const healthSamples=samples.map(row=>({...row,elapsedMs:row.server?.healthObservation?.elapsedMs??row.elapsedMs})).sort((a,b)=>a.elapsedMs-b.elapsedMs);
  const healthy=sample=>sample.generation===1&&sample.server?.serverId===restart?.serverId&&sample.server?.health?.ready===true&&
    receiptValid(sample.server.healthObservation)&&sample.server.healthObservation.generation===1&&sample.server.healthObservation.serverId===restart.serverId&&
    sample.server.health.savesReady===true&&sample.server.health.worker?.ready===true&&sample.server.health.service?.registry==='ready'&&sample.server.health.service.openContexts>=activeGroups+1;
  // Confirm readiness through the deadline, rather than bless a transient open
  // count. A first post-deadline sample bounds how long the evidence can be stale.
  const confirmation=healthSamples.find(row=>row.elapsedMs>deadlineElapsed);
  const confirmed=confirmation&&confirmation.elapsedMs<=deadlineElapsed+2*profile.sampleSeconds*1000&&healthy(confirmation);
  const finalHealth=healthSamples.filter(row=>row.collectionPhase==='after').at(-1);
  const finalObserved=finalHealth&&receiptValid(finalHealth.server?.healthObservation)&&finalHealth.server.healthObservation.receivedAt>=load.workloadCompletedAt;
  // Recovery means timely readiness maintained through the final health
  // observation. A later unhealthy result invalidates an earlier confirmation.
  const resident=groupProof&&confirmed&&finalObserved&&healthSamples.find(sample=>sample.elapsedMs>=restartElapsedMs+firstHTTPRecoveryMs&&sample.elapsedMs<deadlineElapsed&&healthy(sample)&&
    healthSamples.filter(row=>row.elapsedMs>=sample.elapsedMs&&row.elapsedMs<=finalHealth.elapsedMs).every(healthy)&&
    continuousSamples(healthSamples,sample.elapsedMs,finalHealth.elapsedMs,2*profile.sampleSeconds*1000));
  const recoveryMs = resident ? resident.elapsedMs-restartElapsedMs : null;
  const cold = load.operations.filter(row=>row.action==='cold-open');
  const coldCount = cold.reduce((n,row)=>n+(row.latency?.count??0),0);
  const offered=load.offeredOperations,measuredOffered=(offered??[]).filter(row=>profile.stages[row.stage]?.measured);
  const coldGate = speed(cold,['cold-open'],bars.coldOpenMs,offered);
  const coldProof=cohortValid&&sameMembers(cohort.coldGroups??[],cohort.groups??[])&&sameMembers((load.coldOpens??[]).map(row=>row.group),cohort.groups??[])&&
    (load.coldOpens??[]).every(row=>proof(row,load.initialServerId,load.workloadStart))&&coldCount===activeGroups;
  if(!coldProof)coldGate.status='fail';
  const format2Serving=result.format==='format2'&&result.fixture?.storageFormat==='format2'
    &&coldProof&&completion(cold,['cold-open'],offered).status==='pass'&&groupProof;
  const drops = load.stats.clientDrops,missRows=measured.filter(row=>row.action==='task-miss');
  const misses=missRows.reduce((n,row)=>n+(row.successfulTaskMisses??0),0),heavyCount=missRows.reduce((n,row)=>n+(row.latency?.count??0),0);
  const sampleValid=row=>receiptValid(row)&&receiptValid(row.server)&&row.server.receivedAt===row.receivedAt&&
    row.server.serverId===(row.generation===0?load.initialServerId:row.generation===1?restart?.serverId:null)&&
    ['healthObservation','diagnosticsObservation'].every(key=>receiptValid(row.server[key])&&row.server[key].receivedAt<=row.server.receivedAt&&
      row.server[key].generation===row.generation&&row.server[key].serverId===row.server.serverId)&&
    ['rss','heapUsed','external'].every(key=>time(row.server.memory?.[key]))&&time(row.server.eventLoop?.p99Ms)&&count(row.server.diagnostics?.queue?.depth);
  const expectedTotal=(offered??[]).reduce((n,row)=>n+row.count,0),durationMs=profile.stages.reduce((n,row)=>n+row.seconds*1000,0);
  // Sampling is serialized and its IPC request has a five-second deadline.
  // A few isolated snapshots cannot stand in for the advertised time series.
  const telemetryWindowMs=2*Math.max(profile.sampleSeconds*1000,5000);
  const validGenerator=drops===0&&result.telemetryErrors===0&&cleanExit(result.shutdown)&&replacement&&
    Array.isArray(offered)&&offered.length>0&&unique(offered.map(slot),offered.length)&&offered.every(row=>count(row.count)&&row.count>0)&&
    offered.filter(row=>row.action==='restart').reduce((n,row)=>n+row.count,0)===1&&offered.filter(row=>row.action==='workload-end').reduce((n,row)=>n+row.count,0)===1&&
    count(load.stats.offered)&&load.stats.offered===expectedTotal&&count(load.stats.completed)&&count(load.stats.recoveryProbesSkipped??0)&&
    load.stats.completed+(load.stats.recoveryProbesSkipped??0)===load.stats.offered&&
    load.operations.reduce((n,row)=>n+(row.latency?.count??0),0)===load.stats.completed&&
    time(load.workloadStart)&&time(load.workloadCompletedAt)&&load.workloadCompletedAt-load.workloadStart>=durationMs&&
    time(load.streamShutdownAt)&&load.streamShutdownAt>=load.workloadCompletedAt&&time(load.completedAt)&&load.completedAt>=load.streamShutdownAt&&finalObserved&&
    continuousSamples(samples,0,load.workloadCompletedAt-load.workloadStart,telemetryWindowMs)&&
    ['healthObservation','diagnosticsObservation'].every(key=>continuousSamples(samples.map(row=>({elapsedMs:row.server?.[key]?.elapsedMs??row.elapsedMs}))
      .sort((a,b)=>a.elapsedMs-b.elapsedMs),0,load.workloadCompletedAt-load.workloadStart,telemetryWindowMs))&&
    samples.some(row=>row.generation===0&&sampleValid(row))&&samples.some(row=>row.generation===1&&sampleValid(row))&&
    samples.every(row=>row.restarting===true?row.elapsedMs>=restartElapsedMs&&row.elapsedMs<=restartElapsedMs+restart.serverReadyMs:sampleValid(row));
  const clients=cohort.clients??[],lifetimes=load.recovery.streams??[];
  const replacementStreams=lifetimes.filter(row=>typeof restart?.serverId==='string'&&restart.serverId!==load.initialServerId&&
    row.serverId===restart.serverId&&typeof row.clientId==='string'&&time(row.openedAt)&&row.openedAt>=restart.startedAt&&
    (row.closedAt===null||time(row.closedAt)&&row.closedAt>=row.openedAt));
  const distinct=rows=>[...new Set(rows.map(row=>row.clientId))].sort();
  const rawLive=distinct(replacementStreams.filter(row=>row.openedAt<=deadlineAt&&(row.closedAt===null||row.closedAt>deadlineAt))),
    rawEver=distinct(replacementStreams);
  const live=cohortValid&&replacement&&confirmed?clients.map(client=>liveRecoveryStream(lifetimes,client,{serverId:restart.serverId,
    startedAt:restart.startedAt,deadlineAt,confirmedAt:load.workloadStart+confirmation.elapsedMs,throughAt:load.streamShutdownAt,completedAt:load.completedAt,sampleMs:profile.sampleSeconds*1000})):[];
  const configuredPlugin=profile.stages.some(row=>row.measured&&row.pluginPerSecond>0),configuredSync=profile.stages.some(row=>row.measured&&row.syncPerMinute>0);
  const gates={
    ...(residencyVerification ? { residency: residencyVerification } : {}),
    memoryProfile:profileVerification,
    everyday:speed(measured,everydayActions,bars.everydayMs,measuredOffered),heavy:speed(measured,heavyActions,bars.heavyMs,measuredOffered),coldOpen:{...coldGate,groups:coldCount},
    pluginTraffic:configuredPlugin?completion(measured,['pluginReport','pluginStatus','pluginTasks'],measuredOffered):{status:'not-configured'},
    syncTraffic:configuredSync?completion(measured,['sync'],measuredOffered):{status:'not-configured'},
    restartRecovery:{status:recoveryMs!==null&&recoveryMs<limitMs?'pass':'fail',
      readyGroups:groups.length,expectedGroups:activeGroups,recoveryMs,firstHTTPRecoveryMs,allActiveResident:!!resident,limitMs:profile.sustained.recoveryDeadlineSeconds*1000,
      healthyThroughElapsedMs:finalHealth?.elapsedMs??null,
      scope:'Distinct active groups must return current replacement-process state/tasks before the deadline and remain healthy/resident through the final post-workload health receipt. Post-deadline confirmation uses its own health receipt; later unhealthy observations invalidate recovery.'},
    streamRecovery:{status:live.length===users&&live.every(Boolean)?'pass':'fail',reopened:live.filter(Boolean).length,expected:users,
      rawReplacementCoverage:{serverId:restart?.serverId??null,deadlineAt,liveAtDeadline:rawLive.length,everConnected:rawEver.length,
        liveAtDeadlineClientIds:rawLive,everConnectedClientIds:rawEver},
      latency:distribution(live.filter(Boolean).map(row=>row.openedAt-restart.startedAt)),scope:'Expected clients must hold established replacement-process SSE streams at the deadline and confirmation, maintained through workload stop. Bounded planned reconnect handoffs require live replacements; later unexpected ends invalidate recovery.'},
    generator:{status:validGenerator?'pass':'fail',droppedArrivals:drops,telemetryErrors:result.telemetryErrors,shutdownClean:cleanExit(result.shutdown),restartShutdownClean:cleanExit(restart?.shutdown)},
    calculationMissCoverage:{status:completion(measured,['task-miss'],measuredOffered).status==='pass'&&heavyCount>0&&missRows.every(row=>row.successfulTaskMisses===row.latency.count)?'pass':'fail',misses,offeredTaskMisses:heavyCount},
    refusalHeaders:{status:headerEvidence(load.operations,load.stageStreams,load.tailStreams,profile.stages)?'pass':'fail'},
    format2Serving:{status:format2Serving?'pass':'blocked',
      reason:format2Serving?'Synthetic owned format-2 cold opens and post-restart HTTP recovery with independently retained release inputs.':'This run supplies no complete format-2 HTTP/restart evidence.'},
    characterSwitch:{status:'blocked',offered:measured.filter(row=>row.action==='switch').reduce((n,row)=>n+row.latency.count,0),reason:'No durable character entity or authorized character switch API; offered switches are unsupported.'},
  };
  return Object.fromEntries(Object.entries(gates).map(([name,gate])=>[name,{...gate,memoryProfile:profileVerification.memoryProfile,
    ...(residencyVerification ? { residency: residencyVerification.residency,
      ...(residencyVerification.status !== 'pass' && gate.status === 'pass' ? { status: 'fail', reason: 'residency-unverified' } : {}) } : {}),
    ...(profileVerification.status==='fail'&&gate.status==='pass'?{status:'fail',reason:'memory-profile-unverified'}:{})}]));
}
const n = value => Number.isFinite(value)?value.toFixed(1):'n/a';
export function sustainedMarkdown(result) {
  const {load,profile} = result,gates=evaluateSustained(result);
  const failures = Object.entries(gates).filter(([,value])=>value.status==='fail').map(([name])=>name);
  return `# Sustained HTTP capacity run\n\nSource: \`${result.sourceCommit}\`; source tree: \`${result.sourceTreeDigest}\`; Node ${result.node}; **${result.format}**; seed \`${profile.seed}\`.\n\n`+
    fixtureReuseMarkdown(result)+
    memoryProfileMarkdown(result)+
    residencyMarkdown(result)+
    `Result: **${failures.length?'FAIL':'BLOCKED'}**. Failed measured gates: ${failures.join(', ')||'none'}. Activation and character switching remain blocked; this run cannot approve launch. Smoke-sized results do not prove capacity.\n\n`+
    `${result.fixture.groups} resident disk groups plus one legacy context; ${profile.stages.at(-1).activeGroups} active groups and ${profile.stages.at(-1).users} online clients. Setup ${n(result.setupSeconds)} s; total ${n(result.elapsedSeconds)} s.\n\n`+
    `Open-loop arrivals ${load.stats.offered}; completed ${load.stats.completed}; already-ready recovery probes skipped ${load.stats.recoveryProbesSkipped??0}; HTTP requests ${load.stats.httpRequests}; refusals ${load.stats.rejects}; timeouts ${load.stats.timeouts}; unsupported ${load.stats.unsupported}; client drops ${load.stats.clientDrops}.\n\n`+
    `| Speed / coverage bar | Verdict | Detail |\n| --- | --- | --- |\n`+
    Object.entries(gates).map(([name,value])=>`| ${name} | ${value.status.toUpperCase()} | ${value.p95LimitMs?`p95 < ${value.p95LimitMs} ms; missing: ${value.missing.join(', ')||'none'}`:value.recoveryMs!==undefined?`${value.readyGroups}/${value.expectedGroups}; ${n(value.recoveryMs)} ms`:value.reason??''} |`).join('\n')+'\n\n'+
    `## Arrival-to-completion latency\n\nIncludes failed/refused actions. Percentiles are per class and phase; warm-up/cold opens are separate from sustained phases. HTTP attempts and raw Retry-After values are in events.jsonl, including intermediate refusals hidden by a successful retry.\n\n`+
    `| Phase / action | Count | p50 / p95 / p99 ms | Terminal statuses | HTTP attempts by status | Refusal Retry-After counts | Cache hit / miss |\n| --- | --- | --- | --- | --- | --- | --- |\n`+
    load.operations.map(row=>`| ${row.phase??profile.stages[row.stage].name} / ${row.action} | ${row.latency.count} | ${['p50Ms','p95Ms','p99Ms'].map(key=>n(row.latency[key])).join(' / ')} | ${JSON.stringify(row.statuses)} | ${JSON.stringify(row.httpStatuses)} | ${JSON.stringify(row.retryAfterValues)} | ${row.cacheHits} / ${row.cacheMisses} |`).join('\n')+'\n\n'+
    `## SSE handshakes\n\nHandshake timing starts at the connection attempt; reconnect backoff remains in restart-to-reconnect timing. Long-lived bodies are consumed until closure, never counted as an unfinished HTTP action.\n\n`+
    `Raw replacement-stream coverage: ${gates.streamRecovery.rawReplacementCoverage.liveAtDeadline}/${gates.streamRecovery.expected} distinct clients live at the recovery deadline; ${gates.streamRecovery.rawReplacementCoverage.everConnected} ever connected. This observation is independent of the recovery gate's residency and continuity requirements.\n\n`+
    `${JSON.stringify({latency:distribution((load.streamHandshakes??[]).map(row=>row.latencyMs)),stages:load.stageStreams,outsideStages:load.tailStreams},null,2)}\n\n`+
    `## Restart and recovery\n\n${JSON.stringify({restarts:load.restarts,recovery:gates.restartRecovery,streams:gates.streamRecovery},null,2)}\n\n`+
    `## Time series\n\nEvery sample in samples.jsonl includes server RSS, heapUsed, heapTotal, external and arrayBuffers; event-loop delay/utilization; diagnostics (calculator queues and routing residency); cold-open queue depth; process-tree memory/CPU on Linux; and generator active requests/CPU/memory. Each source retains its own receivedAt/elapsedMs and phase/window; health and diagnostics have independent IPC receipts before heap probes. collectedAt is assembly time, never readiness or phase evidence. Admission transitions and open phases are also retained in results.json with server generation and run-relative receipt time. Missing/restart samples are explicit.\n\n`+
    diagnosticMarkdown(result)+`## Limits\n\n${result.fixture.gaps.map(gap=>'- '+gap).join('\n')}\n\nThe selected memory profile uses application support from this exact source; the harness does not implement new caps. Either profile may refuse this target. Same-group revision races are visible as 409 outcomes and are never blindly retried. Safe reads use bounded retry/backoff; commands remain single-dispatch.\n`;
}
