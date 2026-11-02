// Diagnostic stage partition; no result or state values leave the worker.
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/tasks/worker.mjs')) return result;
  let source = String(result.source);
  const replace = (from, to) => { if (!source.includes(from)) throw Error('ProbeAnchorError'); source = source.replace(from, to); };
  replace("const { snapshot } = snapshotFor(state, memberId, timingMs, input, type !== 'predict' && type !== 'chunk-planning' && !compact, pickerId);",
    "const { snapshot } = timed(timingMs, 'baselineMs', () => snapshotFor(state, memberId, timingMs, input, type !== 'predict' && type !== 'chunk-planning' && !compact, pickerId));");
  replace('evaluateFull(input, member, { includeViews: false, timingMs })', "timed(timingMs, 'hypotheticalMs', () => evaluateFull(input, member, { includeViews: false, timingMs }))");
  replace('evaluateFull(prediction.state, partner.id, { includeViews: false, timingMs })', "timed(timingMs, 'partnerMs', () => evaluateFull(prediction.state, partner.id, { includeViews: false, timingMs }))");
  replace('const play = mapPlayResult(prediction.result);', "const play = timed(timingMs, 'projectionMs', () => mapPlayResult(prediction.result));");
  replace('const peerPlay = mapPlayResult(peer);', "const peerPlay = timed(timingMs, 'projectionMs', () => mapPlayResult(peer));");
  replace('function sharedJSON(value) {', "let previewTiming;\nfunction sharedJSON(value) { return timed(previewTiming, 'serializationMs', () => rawSharedJSON(value)); }\nfunction rawSharedJSON(value) {");
  replace('if (reportProgress) progressRequests.set(timingMs,', 'previewTiming = timingMs;\n  if (reportProgress) progressRequests.set(timingMs,');
  replace("type: 'prediction-prepared', unlockReuse", "type: 'prediction-prepared', timingMs: { ...timingMs }, unlockReuse");
  return { ...result, source };
} });
