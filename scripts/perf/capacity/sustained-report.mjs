import { diagnosticMarkdown } from './report.mjs';
import { distribution } from './driver.mjs';

export const everydayActions = ['state','history','task-view','group-task-view','how','why','note','tick','undo','session'];
export const heavyActions = ['task-miss','preview','roll-accept','pool-undo'];
const terminalFailures = row => Object.entries(row.statuses).reduce((n,[status,count])=>n+(status==='200'?0:count),0);
function speed(rows, actions, limitMs) {
  const selected = rows.filter(row=>actions.includes(row.action));
  const missing = actions.filter(action=>!selected.some(row=>row.action===action&&row.latency.count));
  return {status:missing.length?'fail':selected.some(row=>row.latency.p95Ms>=limitMs||terminalFailures(row))?'fail':'pass',
    p95LimitMs:limitMs,missing,failures:selected.reduce((n,row)=>n+terminalFailures(row),0),
    scope:'Scheduled arrival to full HTTP completion, including dispatch, preflights, cooldown/backoff and terminal failures; no browser render time.'};
}
export function evaluateSustained(result) {
  const {load,profile} = result, measured = load.operations.filter(row=>profile.stages[row.stage]?.measured);
  const activeGroups = profile.stages.at(-1).activeGroups, users = profile.stages.at(-1).users;
  const restart = load.restarts[0], groups = load.recovery.groups;
  const firstHTTPRecoveryMs = groups.length===activeGroups ? Math.max(...groups.map(row=>row.elapsedMs)) : null;
  const restartElapsedMs = restart?.startedAt - load.workloadStart;
  // First successful visits alone could bless an evict/reopen loop. Require a
  // post-restart sample showing the entire active cohort resident together.
  const resident = (result.samples??[]).find(sample=>sample.generation===1&&sample.server?.health?.service?.openContexts>=activeGroups+1&&
    firstHTTPRecoveryMs!==null&&sample.elapsedMs-restartElapsedMs>=firstHTTPRecoveryMs&&sample.elapsedMs-restartElapsedMs<profile.sustained.recoveryDeadlineSeconds*1000);
  const recoveryMs = resident ? resident.elapsedMs-restartElapsedMs : null;
  const cold = load.operations.filter(row=>row.action==='cold-open');
  const coldCount = cold.reduce((n,row)=>n+row.latency.count,0);
  const coldGate = speed(cold,['cold-open'],2000);
  if(coldCount!==activeGroups)coldGate.status='fail';
  const drops = load.stats.clientDrops, misses = measured.filter(row=>row.action==='task-miss').reduce((n,row)=>n+row.cacheMisses,0);
  const heavyCount = measured.filter(row=>row.action==='task-miss').reduce((n,row)=>n+row.latency.count,0);
  const invalid = drops||result.telemetryErrors||result.shutdown?.forced||result.shutdown?.exitCode!=null&&result.shutdown.exitCode!==0||load.restarts.some(row=>row.shutdown?.forced||row.shutdown?.exitCode!=null&&row.shutdown.exitCode!==0);
  return {
    everyday:speed(measured,everydayActions,300), heavy:speed(measured,heavyActions,3000),coldOpen:{...coldGate,groups:coldCount},
    restartRecovery:{status:load.restarts.length===1&&restart?.serverReadyMs!=null&&recoveryMs!==null&&recoveryMs<profile.sustained.recoveryDeadlineSeconds*1000?'pass':'fail',
      readyGroups:groups.length,expectedGroups:activeGroups,recoveryMs,firstHTTPRecoveryMs,allActiveResident:!!resident,limitMs:profile.sustained.recoveryDeadlineSeconds*1000,
      scope:'Every active group must return authenticated state and tasks, with a subsequent sample showing the active cohort resident together. Dormant groups stay dormant; no restore/durability proof.'},
    streamRecovery:{status:load.recovery.streams.length===users&&load.recovery.streams.every(row=>row.elapsedMs<profile.sustained.recoveryDeadlineSeconds*1000)?'pass':'fail',
      reopened:load.recovery.streams.length,expected:users,latency:distribution(load.recovery.streams.map(row=>row.elapsedMs))},
    generator:{status:invalid?'fail':'pass',droppedArrivals:drops,telemetryErrors:result.telemetryErrors,forcedShutdown:!!(result.shutdown?.forced||load.restarts.some(row=>row.shutdown?.forced))},
    calculationMissCoverage:{status:heavyCount&&misses>=heavyCount?'pass':'fail',misses,offeredTaskMisses:heavyCount},
    refusalHeaders:{status:measured.some(row=>row.rejectsWithoutRetryAfter)||(load.stageStreams??[]).some(row=>row.rejectsWithoutRetryAfter)?'fail':'pass'},
    format2Serving:{status:'blocked',reason:'HTTP format-2 activation and pinned catalogue preparation are not implemented (slice 7c).'},
    characterSwitch:{status:'blocked',offered:measured.filter(row=>row.action==='switch').reduce((n,row)=>n+row.latency.count,0),reason:'No durable character entity or authorized character switch API; offered switches are unsupported.'},
  };
}
const n = value => Number.isFinite(value)?value.toFixed(1):'n/a';
export function sustainedMarkdown(result) {
  const {load,gates,profile} = result;
  const failures = Object.entries(gates).filter(([,value])=>value.status==='fail').map(([name])=>name);
  return `# Sustained HTTP capacity run\n\nSource: \`${result.sourceCommit}\`; source tree: \`${result.sourceTreeDigest}\`; Node ${result.node}; **${result.format}**; seed \`${profile.seed}\`.\n\n`+
    `Result: **${failures.length?'FAIL':'BLOCKED'}**. Failed measured gates: ${failures.join(', ')||'none'}. Format 2 and character switching remain blocked; this run cannot approve launch. Smoke-sized results do not prove capacity.\n\n`+
    `${result.fixture.groups} resident disk groups plus one legacy context; ${profile.stages.at(-1).activeGroups} active groups and ${profile.stages.at(-1).users} online clients. Setup ${n(result.setupSeconds)} s; total ${n(result.elapsedSeconds)} s.\n\n`+
    `Open-loop arrivals ${load.stats.offered}; completed ${load.stats.completed}; already-ready recovery probes skipped ${load.stats.recoveryProbesSkipped??0}; HTTP requests ${load.stats.httpRequests}; refusals ${load.stats.rejects}; timeouts ${load.stats.timeouts}; unsupported ${load.stats.unsupported}; client drops ${load.stats.clientDrops}.\n\n`+
    `| Speed / coverage bar | Verdict | Detail |\n| --- | --- | --- |\n`+
    Object.entries(gates).map(([name,value])=>`| ${name} | ${value.status.toUpperCase()} | ${value.p95LimitMs?`p95 < ${value.p95LimitMs} ms; missing: ${value.missing.join(', ')||'none'}`:value.recoveryMs!==undefined?`${value.readyGroups}/${value.expectedGroups}; ${n(value.recoveryMs)} ms`:value.reason??''} |`).join('\n')+'\n\n'+
    `## Arrival-to-completion latency\n\nIncludes failed/refused actions. Percentiles are per class and phase; warm-up/cold opens are separate from sustained phases. HTTP attempts and raw Retry-After values are in events.jsonl, including intermediate refusals hidden by a successful retry.\n\n`+
    `| Phase / action | Count | p50 / p95 / p99 ms | Terminal statuses | HTTP attempts by status | Refusal Retry-After counts | Cache hit / miss |\n| --- | --- | --- | --- | --- | --- | --- |\n`+
    load.operations.map(row=>`| ${row.phase??profile.stages[row.stage].name} / ${row.action} | ${row.latency.count} | ${['p50Ms','p95Ms','p99Ms'].map(key=>n(row.latency[key])).join(' / ')} | ${JSON.stringify(row.statuses)} | ${JSON.stringify(row.httpStatuses)} | ${JSON.stringify(row.retryAfterValues)} | ${row.cacheHits} / ${row.cacheMisses} |`).join('\n')+'\n\n'+
    `## SSE handshakes\n\nHandshake timing starts at the connection attempt; reconnect backoff remains in restart-to-reconnect timing. Long-lived bodies are consumed until closure, never counted as an unfinished HTTP action.\n\n`+
    `${JSON.stringify({latency:distribution((load.streamHandshakes??[]).map(row=>row.latencyMs)),stages:load.stageStreams},null,2)}\n\n`+
    `## Restart and recovery\n\n${JSON.stringify({restarts:load.restarts,recovery:gates.restartRecovery,streams:gates.streamRecovery},null,2)}\n\n`+
    `## Time series\n\nEvery sample in samples.jsonl includes server RSS, heapUsed, heapTotal, external and arrayBuffers; event-loop delay/utilization; diagnostics (calculator queues and routing residency); cold-open queue depth; process-tree memory/CPU on Linux; and generator active requests/CPU/memory. Admission transitions and open phases are also retained in results.json with server generation and run-relative receipt time. Missing/restart samples are explicit.\n\n`+
    diagnosticMarkdown(result)+`## Limits\n\n${result.fixture.gaps.map(gap=>'- '+gap).join('\n')}\n\nNo application behavior or admission limit is changed. Runtime defaults may refuse this target. Same-group revision races are visible as 409 outcomes and are never blindly retried. Safe reads use bounded retry/backoff; commands remain single-dispatch.\n`;
}
