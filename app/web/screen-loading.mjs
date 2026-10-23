// Main-screen loading; shared values and callbacks live in the explicit screen context.
export function createScreenLoading(c) {
  c.taskEngineCount = value => `${value.metrics.availableCount.toLocaleString()} possible tasks${c.duoEnabled?.() ? ` for ${c.member().name}` : ''}`;
  // Only the current gameplay epoch matters. A contiguous proof can span any
  // number of display saves without storing or forgetting individual edges.
  function rememberUnchangedTaskRevisions(from, to) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from !== c.state?.revision || to <= from) return;
    const current = c.unchangedTaskRevisions;
    c.unchangedTaskRevisions = { from: current?.to === from ? current.from : from, to };
  }

  function compatibleTaskRevision(revision, current = c.state?.revision) {
    if (revision === current) return true;
    const unchanged = c.unchangedTaskRevisions;
    return Number.isSafeInteger(revision) && unchanged?.to === current && revision >= unchanged.from && revision <= current;
  }

  function canonicalTaskRevision(revision = c.state?.revision) {
    return c.unchangedTaskRevisions?.to === revision ? c.unchangedTaskRevisions.from : revision;
  }

  Object.assign(c, { rememberUnchangedTaskRevisions, compatibleTaskRevision, canonicalTaskRevision });

  function foregroundProjection() { return c.duoEnabled() ? 'duo-sidebar-v1' : undefined; }

  function foregroundCompatible(load) { return !load?.projection || c.duoEnabled(); }

  function foregroundTaskPath(id, revision, projection) {
    return `/api/tasks?memberId=${encodeURIComponent(id)}&view=play-v1${projection ? `&projection=${projection}&revision=${revision}` : ''}`;
  }

  function scheduleTasks() { clearTimeout(c.syncTimer); if (c.hasProvisionalTasks()) { c.syncTimer = null; return; } c.syncTimer = setTimeout(() => { c.syncTimer = null; return c.loadTasks(); }, 0); }

  function earlyTaskScopeCurrent(record) {
    return c.latestEventRevision <= record.revision && !c.sandbox.active && c.memberId === record.attempt.memberId && c.foregroundProjection() === record.attempt.projection
      && c.state.revision === (record.acknowledged ? record.revision : record.attempt.expectedRevision)
      && c.state.members.length === record.attempt.memberIds.length && c.state.members.every((owner, index) => owner.id === record.attempt.memberIds[index]);
  }

  function discardEarlyTasks(attempt) {
    const record = c.earlyTaskLoad;
    if (!record || attempt && record.attempt !== attempt) return;
    c.earlyTaskLoad = undefined;
    for (const entry of record.requests.values()) entry.controller.abort();
  }

  function hasProvisionalTasks() {
    const attempt = c.pendingGameplayAttempt;
    return !!attempt && attempt.observedRevision > c.state.revision && !c.sandbox.active;
  }

  function beginGameplayAttempt(expectedRevision) {
    c.discardEarlyTasks();
    return c.pendingGameplayAttempt = { id: ++c.gameplayAttemptSequence, expectedRevision, revision: expectedRevision + 1,
      memberId: c.memberId, projection: c.foregroundProjection(), memberIds: c.state.members.map(owner => owner.id), observedRevision: Math.max(expectedRevision, c.latestEventRevision) };
  }

  function finishGameplayAttempt(attempt, revision) {
    if (c.pendingGameplayAttempt === attempt) c.pendingGameplayAttempt = undefined;
    const record = c.earlyTaskLoad;
    if (record?.attempt !== attempt) return;
    if (revision !== record.revision || !c.earlyTaskScopeCurrent(record)) { c.discardEarlyTasks(attempt); return; }
    // The caller immediately adopts the matching acknowledgement. Keep reads
    // alive until its ordinary foreground loaders claim these exact promises.
    record.acknowledged = true;
  }

  function clearClaimedEarlyTasks(record) {
    if (c.earlyTaskLoad === record && [...record.requests.values()].every(entry => entry.claimed && entry.settled)) c.earlyTaskLoad = undefined;
  }

  function savedTaskPath(memberId, revision, projection, peerFor) {
    return peerFor ? `/api/tasks?memberId=${encodeURIComponent(memberId)}&view=play-v1&lane=duo-v1&peerFor=${encodeURIComponent(peerFor)}&revision=${revision}`
      : c.foregroundTaskPath(memberId, revision, projection);
  }

  function primeSavedTasks(revision) {
    c.latestEventRevision = Math.max(c.latestEventRevision, revision);
    if (c.earlyTaskLoad && revision > c.earlyTaskLoad.revision) c.discardEarlyTasks();
    const attempt = c.pendingGameplayAttempt;
    if (!attempt) return;
    attempt.observedRevision = Math.max(attempt.observedRevision, revision);
    if (revision !== attempt.revision || attempt.observedRevision > attempt.revision || c.earlyTaskLoad?.attempt === attempt) return;
    const record = { attempt, revision, acknowledged: false, requests: new Map() };
    if (!c.earlyTaskScopeCurrent(record)) return;
    c.discardEarlyTasks(); c.earlyTaskLoad = record;
    // An older foreground response must not align itself by fetching state while
    // this command's captured baseline is waiting for its acknowledgement.
    clearTimeout(c.syncTimer); c.syncTimer = null; c.taskRequest++; c.taskController?.abort(); c.foregroundTaskLoad = undefined;
    const ids = attempt.projection ? [attempt.memberId, ...attempt.memberIds.filter(id => id !== attempt.memberId)] : [attempt.memberId];
    for (const id of ids) {
      const controller = new AbortController(), entry = { controller, claimed: false, settled: false };
      const peerFor = id === attempt.memberId ? undefined : attempt.memberId;
      const path = c.savedTaskPath(id, revision, peerFor ? undefined : attempt.projection, peerFor);
      // These provisional reads bypass api()'s conflict adoption and never call
      // alignTaskResult, acceptTaskResult, saved(), or any rendering callback.
      entry.promise = (async () => {
        const response = await fetch(path, { signal: controller.signal }), value = await response.json();
        if (controller.signal.aborted) throw Object.assign(new Error('Request abandoned.'), { name: 'AbortError' });
        if (!response.ok) throw Object.assign(new Error('Tasks could not be loaded.'), { status: response.status });
        if (value.memberId !== id || value.stateRevision !== revision) throw Object.assign(new Error('Your saved map changed while loading tasks.'), { status: 409 });
        return value;
      })().finally(() => { entry.settled = true; c.clearClaimedEarlyTasks(record); });
      entry.promise.catch(() => {}); record.requests.set(id, entry);
    }
  }

  function fetchSavedTasks(memberId, revision, projection, signal, peerFor) {
    if (c.earlyTaskLoad && !c.earlyTaskScopeCurrent(c.earlyTaskLoad)) c.discardEarlyTasks();
    const path = c.savedTaskPath(memberId, revision, projection, peerFor), record = c.earlyTaskLoad;
    const entry = record?.requests.get(memberId);
    if (!entry || !record.acknowledged || revision !== record.revision || !c.earlyTaskScopeCurrent(record)
      || (peerFor ? peerFor !== record.attempt.memberId : projection !== record.attempt.projection)) return c.api(path, undefined, signal);
    entry.claimed = true;
    const abort = () => entry.controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    c.clearClaimedEarlyTasks(record);
    return entry.promise.then(value => {
      if (signal?.aborted || !c.earlyTaskScopeCurrent(record)) throw Object.assign(new Error('Request abandoned.'), { name: 'AbortError' });
      return value;
    }).catch(error => {
      if (signal?.aborted || !c.earlyTaskScopeCurrent(record)) throw error;
      return c.api(path, undefined, signal);
    }).finally(() => signal?.removeEventListener('abort', abort));
  }

  function foregroundSettled() {
    if (c.hasProvisionalTasks()) return false;
    if (!c.state || !c.result || c.sandbox.active || c.result.memberId !== c.memberId || c.result.stateRevision !== c.state.revision) return false;
    if (!c.duoEnabled()) return true;
    const results = c.duoResults().results();
    return c.state.members.every(owner => results.get(owner.id)?.stateRevision === c.state.revision);
  }

  async function ensureForegroundSettled() {
    const memberId = c.memberId, revision = c.state.revision;
    await c.ensureResult();
    if (memberId !== c.memberId || revision !== c.state.revision) throw new Error('The selected map or saved state changed while loading.');
    if (c.duoEnabled()) await c.duoResults().ensure();
    if (memberId !== c.memberId || revision !== c.state.revision || !c.foregroundSettled()) throw new Error('The selected map or saved state changed while loading.');
    await c.taskRenderDone;
    if (memberId !== c.memberId || revision !== c.state.revision || !c.foregroundSettled()) throw new Error('The selected map or saved state changed while loading.');
    return c.result;
  }

  async function advisoryApi(path, body, signal) {
    const memberId = c.memberId, revision = c.state.revision;
    if (signal?.aborted) throw Object.assign(new Error('Request abandoned.'), { name: 'AbortError' });
    await c.ensureForegroundSettled();
    if (signal?.aborted) throw Object.assign(new Error('Request abandoned.'), { name: 'AbortError' });
    if (memberId !== c.memberId || revision !== c.state.revision) throw new Error('The selected map or saved state changed while loading.');
    return c.api(path, body, signal);
  }

  function workerStatus(health) {
    const previouslyReady = c.taskHealth?.ready;
    c.taskHealth = health;
    if (!c.canWrite()) return;
    if (health.ready) {
      // Advisory-worker events also carry foreground readiness. Only a recovery
      // transition or an otherwise unstarted foreground load needs another fetch.
      const loadingCurrent = c.foregroundTaskLoad?.memberId === c.memberId && c.foregroundTaskLoad.revision === c.state?.revision;
      if (!c.taskInFlight && !loadingCurrent && (previouslyReady === false || (!c.result && !c.syncTimer))) c.scheduleTasks();
      return;
    }
    if (health.status === 'sleeping') return;
    c.$('task-engine-status').textContent = ['waking', 'starting'].includes(health.status) ? 'Waking up the task calculator…'
      : health.restartRequired ? 'Task calculator needs a server restart. Saves remain available.' : 'Task calculator recovering… Saves remain available.';
  }

  async function alignTaskResult(value, requestedMember, current, signal) {
    if (!current() || requestedMember !== c.memberId) return false;
    if (value.stateRevision > c.state.revision) {
      const response = await c.api('/api/state', undefined, signal);
      if (!current() || requestedMember !== c.memberId) return false;
      const aligned = response.state.revision === value.stateRevision && response.state.revision >= c.state.revision;
      if (aligned) clearTimeout(c.syncTimer);
      c.adopt(response.state, response.pools, undefined, !aligned);
    }
    return current() && requestedMember === c.memberId && value.stateRevision === c.state.revision;
  }

  function reconcileForegroundMode() {
    if (c.earlyTaskLoad && !c.earlyTaskScopeCurrent(c.earlyTaskLoad)) c.discardEarlyTasks();
    if (c.state && !c.sandbox.active && !c.duoEnabled()) {
      const thinPending = c.foregroundTaskLoad?.projection && c.foregroundTaskLoad.memberId === c.memberId;
      const thinVisible = c.result?.projection || c.shownResult?.projection;
      if (thinPending) { c.taskRequest++; c.taskController?.abort(); c.foregroundTaskLoad = undefined; }
      if (thinVisible) {
        const normal = c.normalPlayResults.get(c.memberId);
        c.result = normal?.stateRevision === c.state.revision ? normal : undefined;
        c.shownResult = c.result; c.taskFactsCache = undefined;
      }
      // Keep cached Personal rows visible, but register the Personal request on
      // the server so an abandoned Group peer cannot hold its advisory gate.
      if (thinPending || thinVisible) void c.loadTasks();
    }
  }

  function loadTasks() {
    if (c.sandbox.active) return Promise.resolve(c.result);
    if (c.hasProvisionalTasks()) return c.queue.catch(() => {}).then(() => c.loadTasks());
    if (c.foregroundTaskLoad?.memberId === c.memberId && c.foregroundTaskLoad.revision === c.state.revision && c.foregroundCompatible(c.foregroundTaskLoad)) return c.foregroundTaskLoad.promise;
    const request = { memberId: c.memberId, revision: c.state.revision, projection: c.foregroundProjection() };
    request.promise = c.runTaskLoad(request.projection); c.foregroundTaskLoad = request;
    return request.promise.finally(() => { if (c.foregroundTaskLoad === request) c.foregroundTaskLoad = undefined; });
  }

  async function runTaskLoad(projection = c.foregroundProjection()) {
    c.taskController?.abort(); const controller = new AbortController(); c.taskController = controller;
    const request = ++c.taskRequest, requestedMember = c.memberId;
    c.taskInFlight = true;
    c.$('task-engine-status').textContent = !c.canWrite() ? 'Loading saved tasks…' : ['sleeping', 'waking', 'starting'].includes(c.taskHealth?.status)
      ? 'Waking up the task calculator…' : c.result ? 'Updating tasks…' : 'Calculating tasks…';
    try { const foregroundResponse = c.fetchSavedTasks(requestedMember, c.state.revision, projection, controller.signal); c.startDuoTaskLoad(true); const value = await foregroundResponse; if (!await c.alignTaskResult(value, requestedMember, () => request === c.taskRequest && (!projection || c.duoEnabled()), controller.signal)) { if (request === c.taskRequest && requestedMember === c.memberId) c.scheduleTasks(); return; } await c.acceptTaskResult(value); if (request !== c.taskRequest || requestedMember !== c.memberId || value.stateRevision !== c.state.revision) return; c.$('task-engine-status').replaceChildren(c.el('span', c.taskEngineCount(value)), ...(c.advanced() ? [c.button('Details', c.engineDetails)] : [])); if (c.taskHealth && !c.taskHealth.ready) c.workerStatus(c.taskHealth); } catch (error) { if (request === c.taskRequest && error.code === 'TASK_RESULTS_UNAVAILABLE') { c.$('task-engine-status').replaceChildren(c.el('span', c.viewerTaskWait())); return; } if (request === c.taskRequest && error.name !== 'AbortError') { c.$('task-engine-status').replaceChildren(c.el('span', error.message), c.button('Retry', c.loadTasks)); try { const health = await c.api('/api/health', undefined, controller.signal); if (request === c.taskRequest && !health.worker?.ready) c.workerStatus(health.worker ?? {}); } catch {} } }
    finally { if (c.taskController === controller) c.taskInFlight = false; }
  }

  async function ensureResult() {
    if (c.sandbox.active) return c.result;
    const waitingMember = c.memberId;
    if (c.hasProvisionalTasks()) await c.queue.catch(() => {});
    if (waitingMember !== c.memberId) throw new Error('The selected map changed while loading. Open the panel again.');
    c.reconcileForegroundMode();
    const requestedMember = c.memberId, revision = c.state.revision;
    if (c.foregroundTaskLoad?.memberId === requestedMember && c.foregroundTaskLoad.revision === revision && c.foregroundCompatible(c.foregroundTaskLoad)) await c.foregroundTaskLoad.promise;
    if (requestedMember !== c.memberId) throw new Error('The selected map changed while loading. Open the panel again.');
    if (c.result?.memberId === requestedMember && c.result.stateRevision === c.state.revision && (!c.result.projection || c.duoEnabled())) return c.result;
    clearTimeout(c.syncTimer); c.syncTimer = null;
    const request = { memberId: requestedMember, revision, projection: c.foregroundProjection() };
    c.taskController?.abort(); const controller = new AbortController(); c.taskController = controller;
    const requestId = ++c.taskRequest;
    request.promise = (async () => {
      const foregroundResponse = c.fetchSavedTasks(requestedMember, revision, request.projection, controller.signal);
      c.startDuoTaskLoad(true);
      const value = await foregroundResponse;
      if (!await c.alignTaskResult(value, requestedMember, () => requestId === c.taskRequest && requestedMember === c.memberId && c.foregroundCompatible(request), controller.signal)) throw new Error('The selected map changed while loading. Open the panel again.');
      await c.acceptTaskResult(value);
      if (requestedMember !== c.memberId || c.result?.memberId !== requestedMember || c.result.stateRevision !== c.state.revision) throw new Error('The selected map changed while loading. Open the panel again.');
      c.$('task-engine-status').replaceChildren(c.el('span', c.taskEngineCount(value)), ...(c.advanced() ? [c.button('Details', c.engineDetails)] : []));
      if (c.taskHealth && !c.taskHealth.ready) c.workerStatus(c.taskHealth);
      return c.result;
    })(); c.foregroundTaskLoad = request;
    return request.promise.finally(() => { if (c.foregroundTaskLoad === request) c.foregroundTaskLoad = undefined; });
  }

  async function ensurePlanningResult(id) {
    if (c.sandbox.active) return c.sandbox.ensurePlanningResult(id);
    const requestedMember = c.memberId, revision = c.state.revision, requestedChunk = String(id), sandboxScope = c.sandbox.signature();
    // Keyed by task inputs: a note save while this loads keeps the answer.
    const current = () => c.sandbox.signature() === sandboxScope && c.memberId === requestedMember && compatibleTaskRevision(revision) && String(c.chunkId) === requestedChunk && !c.$('chunk-info').hidden;
    const key = JSON.stringify([requestedMember, canonicalTaskRevision(revision), requestedChunk]);
    if (!current()) throw new Error('The viewed chunk or saved state changed. Reopen Chunk Info.');
    if (c.planningResults.has(key)) return c.planningResults.get(key);
    if (!c.planningRequests.has(key)) {
      const request = (async () => {
        await c.ensureForegroundSettled();
        if (!current()) throw new Error('The viewed chunk or saved state changed. Reopen Chunk Info.');
        return c.api(`/api/chunk-planning?memberId=${encodeURIComponent(requestedMember)}&chunkId=${encodeURIComponent(requestedChunk)}`);
      })();
      c.planningRequests.set(key, request);
      request.finally(() => { if (c.planningRequests.get(key) === request) c.planningRequests.delete(key); }).catch(() => {});
    }
    const value = await c.planningRequests.get(key);
    if (!current() || value.format !== 'chunk-planning-v1' || value.memberId !== requestedMember || !compatibleTaskRevision(value.stateRevision) || String(value.chunkId) !== requestedChunk) {
      throw new Error('The viewed chunk or saved state changed while loading location evidence. Reopen Chunk Info.');
    }
    if (c.planningResults.size >= 32) c.planningResults.delete(c.planningResults.keys().next().value);
    c.planningResults.set(key, value); return value;
  }

  async function ensureFullDefinitions() {
    if (c.definitionsAreFull) return c.definitions;
    if (!c.fullDefinitionsRequest) {
      c.fullDefinitionsRequest = c.api('/api/definitions').then(value => { c.definitions = value; c.definitionsAreFull = true; return value; })
        .finally(() => { c.fullDefinitionsRequest = undefined; });
    }
    return c.fullDefinitionsRequest;
  }

  async function ensureFullResult(guardDialog = true) {
    if (c.sandbox.active) { await c.ensureFullDefinitions(); return c.result; }
    const requestedMember = c.memberId, revision = c.state.revision, generation = c.dialogGeneration, sandboxScope = c.sandbox.signature();
    const current = () => c.sandbox.signature() === sandboxScope && requestedMember === c.memberId && revision === c.state.revision && (!guardDialog || generation === c.dialogGeneration);
    let taskResult;
    if (c.fullResult?.memberId === requestedMember && c.fullResult.stateRevision === revision) taskResult = Promise.resolve(c.fullResult);
    else if (c.result?.format !== 'play-v1' && c.result?.memberId === requestedMember && c.result.stateRevision === revision) taskResult = Promise.resolve(c.result);
    else {
      if (!c.fullResultRequest || c.fullResultRequest.memberId !== requestedMember || c.fullResultRequest.revision !== revision) {
        const request = { memberId: requestedMember, revision };
        request.promise = Promise.all([c.api(`/api/tasks?memberId=${encodeURIComponent(requestedMember)}`), c.ensureFullDefinitions()])
          .then(([value]) => value)
          .finally(() => { if (c.fullResultRequest === request) c.fullResultRequest = undefined; });
        c.fullResultRequest = request;
      }
      taskResult = c.fullResultRequest.promise;
    }
    const [value] = await Promise.all([taskResult, c.ensureFullDefinitions()]);
    if (!current() || value.memberId !== requestedMember || value.stateRevision !== revision) throw new Error('The selected map or saved state changed while loading. Open the panel again.');
    c.fullResult = value; return value;
  }

  async function ensureChunkSearch() {
    if (c.chunkSearch) return c.chunkSearch;
    if (!c.chunkSearchRequest) {
      const chunks = c.definitions.chunks, indexedWorld = c.world;
      c.chunkSearchRequest = (async () => {
        const entries = [], locations = (function* () { yield* indexedWorld.chunks; yield* indexedWorld.areas; })();
        let started = globalThis.performance?.now?.() ?? 0;
        for (const [id, record] of locations) {
          entries.push({ id, name: c.plain(record.name), search: `${id} ${record.name} ${JSON.stringify(chunks[id])}`.toLowerCase() });
          if ((globalThis.performance?.now?.() ?? 0) - started >= 8) {
            await new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(resolve) : setTimeout(resolve, 0));
            started = globalThis.performance?.now?.() ?? 0;
          }
        }
        c.chunkSearch = entries; return entries;
      })().finally(() => { c.chunkSearchRequest = undefined; });
    }
    return c.chunkSearchRequest;
  }

  async function acceptTaskResult(value) {
    if (value.projection && !c.duoEnabled()) return;
    if (!value.projection) {
      for (const [id, cached] of c.normalPlayResults) if (cached.stateRevision !== c.state.revision || !c.state.members.some(owner => owner.id === id)) c.normalPlayResults.delete(id);
      c.normalPlayResults.set(value.memberId, value);
    }
    c.duoResults().remember(value);
    c.result = value; c.renderTasks();
    let rendering, painted;
    do { rendering = c.taskRenderDone; painted = await rendering; } while (rendering !== c.taskRenderDone && c.result === value);
    if (!painted || c.result !== value || value.stateRevision !== c.state.revision || value.memberId !== c.memberId) return;
    const timingMs = Object.fromEntries(['engineMs', 'collectionMs', 'equipmentMs', 'presentationMs', 'currentBiSMs', 'activityMs', 'predictionMs', 'deathMs', 'totalMs']
      .filter(key => Number.isFinite(value.cache?.timingMs?.[key])).map(key => [key, value.cache.timingMs[key]]));
    c.perfMark('tasks-shown', { revision: value.stateRevision, memberId: value.memberId,
      cache: { hit: value.cache?.hit === true, ...(Number.isFinite(value.cache?.evaluationMs) ? { evaluationMs: value.cache.evaluationMs } : {}),
        ...(Number.isFinite(value.cache?.requestMs) ? { requestMs: value.cache.requestMs } : {}), timingMs } });
    c.deathChunks.refresh();
    if (c.chunkId && !c.$('chunk-info').hidden && !c.$('chunk-content').contains(document.activeElement)) c.showChunk(c.chunkId);
  }

  async function completedResult(owner) {
    const revision = c.state.revision;
    const cached = c.fullResult?.memberId === owner && c.fullResult.stateRevision === revision ? c.fullResult
      : c.normalPlayResults.get(owner) ?? (c.result?.memberId === owner && !c.result.projection ? c.result : undefined);
    if (cached?.stateRevision === revision) return cached;
    if (owner === c.memberId && !c.duoEnabled()) return c.ensureResult();
    // The review needs the whole catalogue, including its possible-task denominator.
    const value = await c.api(`/api/tasks?memberId=${encodeURIComponent(owner)}&view=play-v1`);
    if (c.state.revision !== revision || value.stateRevision !== revision || value.memberId !== owner || !c.state.members.some(member => member.id === owner)) throw new Error('The saved state changed while loading completed tasks. Try again.');
    for (const [id, entry] of c.normalPlayResults) if (entry.stateRevision !== revision || !c.state.members.some(member => member.id === id)) c.normalPlayResults.delete(id);
    c.normalPlayResults.set(owner, value);
    return value;
  }

  Object.assign(c, { foregroundProjection, foregroundCompatible, foregroundTaskPath, scheduleTasks, earlyTaskScopeCurrent, discardEarlyTasks, hasProvisionalTasks, beginGameplayAttempt, finishGameplayAttempt, clearClaimedEarlyTasks, savedTaskPath, primeSavedTasks, fetchSavedTasks, foregroundSettled, ensureForegroundSettled, advisoryApi, workerStatus, alignTaskResult, reconcileForegroundMode, loadTasks, runTaskLoad, ensureResult, ensurePlanningResult, ensureFullDefinitions, ensureFullResult, ensureChunkSearch, acceptTaskResult, completedResult });
}
