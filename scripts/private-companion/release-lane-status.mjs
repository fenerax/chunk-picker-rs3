import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const clean = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
export function laneStatusRows(gates) {
  return (gates.timings ?? []).filter(row => Number.isInteger(row.fresh) && Number.isInteger(row.reused)).map(row => ({
    phase: row.stage, fresh: row.fresh, reused: row.reused,
    status: row.fresh === 0 ? 'reused' : row.reused === 0 ? 'fresh' : 'mixed',
    sourceRunIds: row.fileDetails ? [...new Set(row.fileDetails.filter(file => file.disposition === 'reused').map(file => file.sourceRunId).filter(Boolean))] : row.sourceRunIds ?? [],
    fileDetails: row.fileDetails ?? [], flaky: row.flaky ?? (row.fileDetails ?? []).filter(file => file.flaky).map(file => file.file),
    seconds: row.seconds, passed: row.passed,
  }));
}
export function releaseLaneReport(gates) {
  const rows=laneStatusRows(gates), flakes=[...new Set(rows.flatMap(row=>row.flaky))];
  const lines=['# Release check report','',`Gates: ${gates.passed===true?'passed':'incomplete'}. Isolation retry: ${gates.flakeRetryEnabled===true?'enabled':'off'}.`,''];
  if(flakes.length)lines.push('**FLAKY FILES: '+flakes.map(clean).join(', ')+'**','These files failed their first run and passed one fresh run in isolation.','');
  lines.push('| Lane / phase | Files fresh | Files reused | Source run IDs | Seconds |','| --- | ---: | ---: | --- | ---: |');
  for(const row of rows)lines.push(`| ${clean(row.phase)} | ${row.fresh} | ${row.reused} | ${row.sourceRunIds.map(clean).join(', ')||'—'} | ${Number(row.seconds??0).toFixed(2)} |`);
  for(const row of rows){
    lines.push('',`## ${clean(row.phase)}`,'');
    for(const file of row.fileDetails)lines.push(`- ${clean(file.file)}: ${file.disposition==='reused'?'reused from '+clean(file.sourceRunId):'fresh; '+clean(file.reason??'no acceptable observation')}${file.flaky?' **FLAKY**':''}.`);
  }
  return lines.join('\n')+'\n';
}
export async function writeReleaseLaneReport(release,gates) {
  const rows=laneStatusRows(gates);
  await writeFile(path.join(release,'release-gate/lane-status.json'),JSON.stringify({passed:gates.passed===true,flakeRetryEnabled:gates.flakeRetryEnabled===true,phases:rows},null,2)+'\n');
  await writeFile(path.join(release,'release-gate/REPORT.md'),releaseLaneReport(gates));
}
