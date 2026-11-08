const cheap=['state','history','edit','session'];
const expensive=['task-view','group-task-view','how','why','task-miss','preview','roll-accept','pool-undo'];
function counts(rows) {
  const total={httpRequests:0,httpRejects:0,timeouts:0,unexpectedFailures:0,intentionalConflicts:0,unsupported:0,rejectsWithoutRetryAfter:0};
  for(const row of rows)for(const key of Object.keys(total))total[key]+=row[key]??0;
  return {...total,validHttpRequests:total.httpRequests-total.intentionalConflicts};
}
function latency(ops,actions,p95,p99) {
    const rows=ops.filter(row=>actions.includes(row.action)).map(row=>({...row,latency:row.validLatency??row.latency})).filter(row=>row.latency.count);
    return {status:!rows.length?'not-measured':rows.some(row=>row.unexpectedFailures||row.latency.p95Ms>p95||row.latency.p99Ms>p99)?'fail':'pass',p95LimitMs:p95,p99LimitMs:p99,
      unexpectedFailures:counts(rows).unexpectedFailures,
      samples:rows.reduce((n,row)=>n+row.latency.count,0),scope:'Valid HTTP product actions including queue/dispatch wait and terminal failures; intentional conflicts and unsupported actions excluded; no render time'};
}
function admission(ops,streams) {
  const total=counts(ops);
  return {status:total.unexpectedFailures||
    (total.httpRejects+total.timeouts)/Math.max(1,total.validHttpRequests)>=.001||streams.some(s=>s.rejected||s.unexpectedEnds)?'fail':!total.validHttpRequests?'not-measured':'pass',
    ...total,unexpectedRejects:total.httpRejects,limitFraction:.001};
}
export function evaluate(result) {
  const stages=result.profile.stages,stats=result.load.stats;
  const inClass=(stage,classification)=>stages[stage]?.measured&&stages[stage].classification===classification;
  const operations=classification=>result.load.operations.filter(row=>inClass(row.stage,classification));
  const streams=classification=>result.load.stageStreams.filter((_,i)=>inClass(i,classification));
  const ops=operations('nominal'),overload=operations('overload'),overloadStreams=streams('overload'),recovery=operations('recovery');
  const overloadCounts=counts(overload),recoveryAdmission=admission(recovery,streams('recovery'));
  const recoveryCheap=latency(recovery,cheap,1000,2000),recoveryExpensive=latency(recovery,expensive,3000,8000);
  const noCrash=result.shutdown&&!result.shutdown.forced&&result.shutdown.exitCode===0&&!result.shutdown.signal;
  const measured=result.samples.filter(row=>row.measured&&inClass(row.stage,'nominal')), cpu=measured.map(row=>row.treeCpuPercent).filter(Number.isFinite),
    peak=measured.reduce((n,row)=>Math.max(n,row.tree.rssBytes??row.server?.memory.rss??0),0),
    loop=measured.reduce((n,row)=>Math.max(n,row.server?.eventLoop.p99Ms??0),0);
  const gates={
    cheapWarm:latency(ops,cheap,1000,2000),
    expensiveWarm:latency(ops,expensive,3000,8000),
    cold:{status:'not-measured',reason:'No browser readiness or certified cold cache class; HTTP arrivals remain in action records.'},
    eventPropagation:{status:'not-measured',reason:'Streams are consumed and disconnects counted; no browser ack-to-render probe.'},
    nominalAdmission:admission(ops,streams('nominal')),
    cpu:{status:cpu.length?(cpu.reduce((a,b)=>a+b,0)/cpu.length<=65?'pass':'fail'):'not-measured',averagePercent:cpu.length?cpu.reduce((a,b)=>a+b,0)/cpu.length:null,limitPercent:65},
    eventLoop:{status:measured.some(row=>row.server)?(loop<=50?'pass':'fail'):'not-measured',worstWindowP99Ms:loop,limitMs:50},
    memory:{status:peak>=.8*(result.hardware.ramBytes-result.profile.osReserveBytes)?'fail':'not-measured',peakServiceRssBytes:peak,
      reason:'80% threshold after OS reserve checked for service; backup overlap, sustained swap, OOM and memory-guard audit still required.'},
    client:{status:stats.clientDrops||result.telemetryErrors||result.shutdown?.forced?'fail':'pass',droppedArrivals:stats.clientDrops,telemetryErrors:result.telemetryErrors,forcedShutdown:result.shutdown?.forced??false},
    isolationDurability:{status:'not-measured',reason:'Cross-tenant/fault/restart assertions belong to acceptance/recovery experiments.'},
    overloadObservations:{status:!overload.length?'not-measured':!noCrash||overloadCounts.unexpectedFailures||overloadCounts.timeouts||overloadCounts.rejectsWithoutRetryAfter||
      overloadStreams.some(s=>s.unexpectedEnds||s.unexpectedFailures||s.rejectsWithoutRetryAfter)?'fail':'pass',...overloadCounts,
      streams:overloadStreams,noCrash:noCrash??null,
      scope:'Observed HTTP/stream outcomes only: 429/503 require Retry-After; unexpected errors, timeouts and unplanned disconnects fail. Fairness and bounded resources are not established.'},
    recoveryHTTP:{status:!recovery.length?'not-measured':[recoveryAdmission,recoveryCheap,recoveryExpensive].some(g=>g.status==='fail')?'fail':
      [recoveryAdmission,recoveryCheap,recoveryExpensive].every(g=>g.status==='pass')?'pass':'not-measured',
      admission:recoveryAdmission,cheapWarm:recoveryCheap,expensiveWarm:recoveryExpensive,
      scope:'Nominal HTTP limits over the recovery stage only; not a time-to-recovery or durability proof.'},
    overloadRecovery:{status:'not-measured',reason:'Overload observations and recovery HTTP have separate verdicts; five-minute time-to-recovery, fairness and fault assertions require a separate trial.'},
    backupRecovery:{status:'not-measured',reason:'No off-site RPO, capture overlap or recovery rehearsal in this tools-only run.'},
    workloadCoverage:{status:'incomplete',unsupportedActions:stats.unsupported,reason:'See fixture gaps, graph calibration and three-trial/soak requirements.'},
  };
  return gates;
}
export function markdown(result) {
  const gates=result.gates,failed=Object.entries(gates).filter(([,v])=>v.status==='fail').map(([name])=>name);
  return `# Synthetic capacity run\n\nSource: \`${result.sourceCommit}\`; Node ${result.node}; seed \`${result.profile.seed}\`.\n\n`+
    `Result: **${failed.length?'FAIL':'INCOMPLETE'}**. Failed measured gates: ${failed.join(', ')||'none'}. Unmeasured gates prevent capacity acceptance.\n\n`+
    `${result.fixture.groups} groups, ${result.fixture.characters} roster slots, ${result.fixture.logins} logins, ${result.fixture.keys} stored keys; plus 1 synthetic legacy context with 2 unowned slots.\n\n`+
    `Offered ${result.load.stats.offered} actions; HTTP requests ${result.load.stats.httpRequests}; rejects ${result.load.stats.rejects}; timeouts ${result.load.stats.timeouts}; unsupported actions ${result.load.stats.unsupported}; client drops ${result.load.stats.clientDrops}.\n\n`+
    `| Gate | Status |\n| --- | --- |\n${Object.entries(gates).map(([name,value])=>`| ${name} | ${value.status} |`).join('\n')}\n\n`+
    `| Stage / class | Users / groups | Browser / plugin per s | HTTP requests / rejects / unexpected failures | Intentional conflicts / unsupported |\n| --- | --- | --- | --- | --- |\n${result.profile.stages.map((stage,i)=>{
      const total=counts(result.load.operations.filter(row=>row.stage===i));return `| ${stage.name} / ${stage.measured?stage.classification:'warm-up'} | ${stage.users} / ${stage.activeGroups} | ${stage.browserPerSecond} / ${stage.pluginPerSecond} | ${total.httpRequests} / ${total.httpRejects} / ${total.unexpectedFailures} | ${total.intentionalConflicts} / ${total.unsupported} |`;
    }).join('\n')}\n\n`+
    `Per-operation latency and status counts: results.json. Every arrival: events.jsonl. Time series: samples.jsonl. Synthetic local capabilities: fixture.json (do not publish).\n\n`+
    `## Gaps\n\n${result.fixture.gaps.map(g=>'- '+g).join('\n')}\n`;
}
