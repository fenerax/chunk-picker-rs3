export function evaluate(result) {
  const ops=result.load.operations.filter(row=>result.profile.stages[row.stage].measured),stats=result.load.stats;
  const measuredCounts=ops.reduce((sum,row)=>({httpRequests:sum.httpRequests+row.httpRequests,rejects:sum.rejects+row.httpRejects,timeouts:sum.timeouts+row.timeouts}),{httpRequests:0,rejects:0,timeouts:0});
  const measuredStreams=result.load.stageStreams.filter((_,i)=>result.profile.stages[i].measured);
  const latency=(actions,p95,p99)=>{
    const rows=ops.filter(row=>actions.includes(row.action));
    return {status:!rows.length?'not-measured':rows.some(row=>row.latency.p95Ms>p95||row.latency.p99Ms>p99)?'fail':'pass',p95LimitMs:p95,p99LimitMs:p99,
      samples:rows.reduce((n,row)=>n+row.latency.count,0),scope:'HTTP product actions including queue/dispatch wait and terminal failures; no render time'};
  };
  const measured=result.samples.filter(row=>row.measured), cpu=measured.map(row=>row.treeCpuPercent).filter(Number.isFinite),
    peak=measured.reduce((n,row)=>Math.max(n,row.tree.rssBytes??row.server?.memory.rss??0),0),
    loop=measured.reduce((n,row)=>Math.max(n,row.server?.eventLoop.p99Ms??0),0);
  const gates={
    cheapWarm:latency(['state','history','edit','session'],1000,2000),
    expensiveWarm:latency(['task-view','group-task-view','how','why','task-miss','preview','roll-accept','pool-undo'],3000,8000),
    cold:{status:'not-measured',reason:'No browser readiness or certified cold cache class; HTTP arrivals remain in action records.'},
    eventPropagation:{status:'not-measured',reason:'Streams are consumed and disconnects counted; no browser ack-to-render probe.'},
    nominalAdmission:{status:(measuredCounts.rejects+measuredCounts.timeouts)/Math.max(1,measuredCounts.httpRequests)<.001&&!measuredStreams.some(s=>s.rejected||s.unexpectedEnds)?'pass':'fail',
      unexpectedRejects:measuredCounts.rejects,timeouts:measuredCounts.timeouts,httpRequests:measuredCounts.httpRequests,limitFraction:.001},
    cpu:{status:cpu.length?(cpu.reduce((a,b)=>a+b,0)/cpu.length<=65?'pass':'fail'):'not-measured',averagePercent:cpu.length?cpu.reduce((a,b)=>a+b,0)/cpu.length:null,limitPercent:65},
    eventLoop:{status:measured.some(row=>row.server)?(loop<=50?'pass':'fail'):'not-measured',worstWindowP99Ms:loop,limitMs:50},
    memory:{status:peak>=.8*(result.hardware.ramBytes-result.profile.osReserveBytes)?'fail':'not-measured',peakServiceRssBytes:peak,
      reason:'80% threshold after OS reserve checked for service; backup overlap, sustained swap, OOM and memory-guard audit still required.'},
    client:{status:stats.clientDrops||result.telemetryErrors||result.shutdown?.forced?'fail':'pass',droppedArrivals:stats.clientDrops,telemetryErrors:result.telemetryErrors,forcedShutdown:result.shutdown?.forced??false},
    isolationDurability:{status:'not-measured',reason:'Cross-tenant/fault/restart assertions belong to acceptance/recovery experiments.'},
    overloadRecovery:{status:'not-measured',reason:'Step-up records failure envelope; five-minute recovery/fairness/fault assertions require a separate trial.'},
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
    `| Stage | Users / groups | Browser / plugin per s | HTTP requests / rejects |\n| --- | --- | --- | --- |\n${result.profile.stages.map((stage,i)=>{
      const rows=result.load.operations.filter(row=>row.stage===i);return `| ${stage.name} | ${stage.users} / ${stage.activeGroups} | ${stage.browserPerSecond} / ${stage.pluginPerSecond} | ${rows.reduce((n,row)=>n+row.httpRequests,0)} / ${rows.reduce((n,row)=>n+row.httpRejects,0)} |`;
    }).join('\n')}\n\n`+
    `Per-operation latency and status counts: results.json. Every arrival: events.jsonl. Time series: samples.jsonl. Synthetic local capabilities: fixture.json (do not publish).\n\n`+
    `## Gaps\n\n${result.fixture.gaps.map(g=>'- '+g).join('\n')}\n`;
}
