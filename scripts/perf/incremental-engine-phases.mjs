// Diagnostic-only source instrumentation. Anchor drift refuses the profile.
// No state, definition values, identities or result contents are recorded.
export function instrumentEngine(source) {
  const replace = (from, to) => {
    if (source.split(from).length !== 2) throw new Error('IncrementalProfileAnchorError');
    source = source.replace(from, to);
  };
  const recorder = "globalThis[Symbol.for('rs3.incremental.profile')]";
  replace('function createCompiledTaskEngine(', 'function rawCreateCompiledTaskEngine(');
  source += `\nfunction createCompiledTaskEngine(...args) { return ${recorder}.compile(() => rawCreateCompiledTaskEngine(...args)); }\n`;
  replace('  function prepareEvaluation() {', `  function prepareEvaluation() { return ${recorder}.prepare(rawPrepareEvaluation); }\n  function rawPrepareEvaluation() {`);
  replace('    const started = performance.now();\n    const sourceMembershipBlocker', `    const __iePhase = ${recorder}.pass();\n    const started = performance.now();\n    const sourceMembershipBlocker`);
  replace('    let processing, setWinners;\n    while (true) {', "    let processing, setWinners;\n    __iePhase('fixedPointMs');\n    while (true) {");
  replace('      updatePoints();\n      setWinners = new Map();', "      __iePhase('processingSelectionMs');\n      updatePoints();\n      setWinners = new Map();");
  replace('      const continuation = yield processing;', "      __iePhase(null);\n      const continuation = yield processing;\n      __iePhase('fixedPointMs');");
  replace('    let disconnectedDetail;', "    __iePhase('projectionMs');\n    let disconnectedDetail;");
  replace('    return result;\n  }\n  function computeEligibility', '    __iePhase(null);\n    return result;\n  }\n  function computeEligibility');
  replace('  function evaluate(state, memberId, options) {', `  function evaluate(state, memberId, options) {\n    const __ieEnd = ${recorder}.evaluation();\n    try {`);
  replace('    return result;\n  }\n  function how', '    __ieEnd(result);\n    return result;\n    } finally { __ieEnd(); }\n  }\n  function how');
  return source;
}

export function createPhaseRecorder(now = () => performance.now(), limit = 64) {
  let rows = [], stack = [], compileMs = 0, dropped = 0;
  const timed = (operation, record) => {
    const start = now();
    try { return operation(); } finally { record(now() - start); }
  };
  return {
    compile(operation) { return timed(operation, ms => { compileMs += ms; }); },
    prepare(operation) {
      const row = stack.at(-1);
      return timed(operation, ms => { if (row) row.prepareMs = (row.prepareMs ?? 0) + ms; });
    },
    evaluation() {
      const start = now(), row = { depth: stack.length, phases: {}, passes: 0 };
      stack.push(row);
      let ended = false;
      return result => {
        if (ended) return;
        ended = true;
        if (stack.pop() !== row) throw new Error('IncrementalProfileStackError');
        row.wallMs = now() - start;
        row.cacheHit = result?.metrics?.eligibilityCacheHit === true;
        for (const key of ['catalogueCount', 'checks', 'dependencyChecks', 'passes', 'accessPasses', 'processingPasses',
          'processingIncrementalPasses', 'processingFallbacks', 'processingRawAccessEvaluations']) {
          const value = result?.metrics?.[key];
          if (typeof value === 'number') (row.counters ??= {})[key] = value;
        }
        if (rows.length < limit) rows.push(row); else dropped++;
      };
    },
    pass() {
      const row = stack.at(-1);
      if (!row) return () => {}; // Direct How replay is outside evaluate().
      row.passes++;
      let phase = 'setupMs', start = now();
      return next => {
        const end = now();
        if (phase) row.phases[phase] = (row.phases[phase] ?? 0) + end - start;
        phase = next; start = end;
      };
    },
    drain() {
      if (stack.length) throw new Error('IncrementalProfileActiveError');
      const result = { compileMs, evaluations: rows, dropped };
      rows = []; compileMs = 0; dropped = 0;
      return result;
    },
  };
}
