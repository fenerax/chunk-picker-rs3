/** Optional diagnostic recovery. The caller owns isolated scratch, admission,
 * abort and cleanup. runIsolated must execute exactly the supplied one-file
 * selection at concurrency 1; the options make that contract explicit.
 * Exceptions/incomplete or aborted observations cannot authorize a pass. */
export async function retryFailedFilesOnce({ result, enabled = false, runIsolated, onFlaky = async () => {} }) {
  if (enabled !== true) return result;
  if (!result || !Array.isArray(result.files) || result.aborted || result.passed === true || result.retryOnceInIsolation === true) return result;
  if (typeof runIsolated !== 'function') throw TypeError('Isolated retry adapter is required.');
  if (new Set(result.files.map(item => item.file)).size !== result.files.length) throw Error('Duplicate file observations refused.');
  const files = [], flakyFiles = [];
  let retryWallMs = 0, retryAborted = false;
  for (const original of result.files) {
    if (original.passed === true || original.attempts || original.flaky) { files.push(original); continue; }
    const retry = await runIsolated([original.file], { minConcurrency: 1, maxConcurrency: 1, retryOnceInIsolation: false });
    retryWallMs += Number.isFinite(retry?.wallMs) ? retry.wallMs : 0;
    retryAborted ||= retry?.aborted === true;
    const observation = retry?.files?.length === 1 && retry.files[0].file === original.file ? retry.files[0] : null;
    const passed = retry?.passed === true && retry.exitCode === 0 && !retry.aborted && observation?.passed === true;
    const file = { ...original, ...(passed ? observation : {}), passed, flaky: passed,
      attempts: [{ kind: 'initial', observation: original }, { kind: 'isolated-retry', concurrency: 1, passed, observation,
        exitCode: retry?.exitCode ?? null, aborted: retry?.aborted === true }] };
    files.push(file);
    if (passed) { flakyFiles.push(original.file); await onFlaky(file); }
  }
  // Preserve an unrelated controller failure even if every file happened to pass.
  const hadFileFailure = result.files.some(file => file.passed !== true);
  const passed = hadFileFailure && !retryAborted && files.every(file => file.passed === true);
  const counts = files.every(file => file.summary?.counts)
    ? Object.fromEntries([...new Set(files.flatMap(file => Object.keys(file.summary.counts)))].map(key =>
      [key, files.reduce((sum, file) => sum + (file.summary.counts[key] ?? 0), 0)])) : result.summary?.counts;
  return { ...result, passed, exitCode: passed ? 0 : 1, aborted: retryAborted || result.aborted, files,
    wallMs: (result.wallMs ?? 0) + retryWallMs, flaky: flakyFiles.length > 0, flakyFiles,
    retryOnceInIsolation: true, initialSummary: result.summary,
    summary: { ...result.summary, ...(counts ? { counts } : {}), success: passed,
      duration_ms: (result.wallMs ?? 0) + retryWallMs, flakyFiles, retryOnceInIsolation: true } };
}
