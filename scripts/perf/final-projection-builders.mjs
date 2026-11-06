// Isolate-only diagnostic timings. Collect no state/result contents.
export function instrumentProjection(source) {
  const replace = (from, to) => {
    if (source.split(from).length !== 2) throw Error('ProjectionProfileAnchorError');
    source = source.replace(from, to);
  };
  replace('    let disconnectedDetail;', "    const __fp = globalThis[Symbol.for('rs3.final.projection')].start();\n    let disconnectedDetail;");
  replace('    const rows = (proofSubject ? [proofSubject] : compiled).map(task => {', "    const rows = (proofSubject ? [proofSubject] : compiled).map(task => {\n      __fp.mark('checksMs');");
  for (const [anchor,phase] of [
    ['      const taskSources = [];','sourcesMs'], ['      const sourcePolicyRejections = [];','sourcePoliciesMs'],
    ['      const filters = [];','obligationsMs'], ['      const partnerTraining = [], partnerSupplies = [], partnerItemNeeds = [];','partnersMs'],
    ['      const explanation = blockers.length ?', 'rowMs'], ['      if (sourcePolicyRejections.length) {','rewardsAndEvidenceMs'],
    ["      Object.defineProperty(row, 'processingPrimary',",'primaryMs'],
    ['    const equipment = [];','equipmentAndStorageMs'], ['    const diagnostics = [...compileDiagnostics,','processingAndSerializationMs'],
    ['    addUnknownDropWarnings(rows,','unknownDropsMs'],
  ]) replace(anchor, `${anchor.startsWith('      ') ? '      ' : '    '}__fp.mark('${phase}');\n${anchor}`);
  replace('    if (proofSubject) return { howProof:', "    if (proofSubject) { __fp.finish(); return { howProof:");
  replace('proof.finish(howRequest.taskId, { tasks: rows }, howRequest.context) };', 'proof.finish(howRequest.taskId, { tasks: rows }, howRequest.context) }; }');
  replace('    return result;\n  }\n  function computeEligibility', '    __fp.finish();\n    return result;\n  }\n  function computeEligibility');
  return source;
}
export function createProjectionRecorder(now = () => Number(process.hrtime.bigint()) / 1000) {
  let records = [];
  return {
    start() {
      const row = { start: now(), builders: {} }; let start = row.start, phase = 'setupMs';
      const mark = next => { const end = now(); if(phase) row.builders[phase] = (row.builders[phase] ?? 0) + (end-start)/1000; phase=next;start=end; };
      return { mark, finish() { mark(null); row.end=now(); if(records.length<64) records.push(row); } };
    },
    drain() { const out=records; records=[];return out; },
  };
}
