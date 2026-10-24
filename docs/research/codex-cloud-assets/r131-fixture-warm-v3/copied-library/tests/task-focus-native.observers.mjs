// Test-only observers. No application imports, focus changes, or fabricated results.
export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Pinned observation seam missing/ambiguous: ${before.slice(0, 90)}`);
  return source.replace(before, after);
}

export function instrumentLoading(source) {
  let text = replaceOnce(source, 'export function createScreenLoading(c) {', 'export function createScreenLoading(c) {\n  const r109 = window.r109;');
  text = replaceOnce(text,
    '      const path = c.savedTaskPath(id, revision, peerFor ? undefined : attempt.projection, peerFor);',
    '      const path = c.savedTaskPath(id, revision, peerFor ? undefined : attempt.projection, peerFor);\n      const r109Initiation = r109.snapshot(c, c.taskRequest, id, revision, peerFor ? undefined : attempt.projection, peerFor, "early-initiate");');
  text = replaceOnce(text,
    "        if (value.memberId !== id || value.stateRevision !== revision) throw Object.assign(new Error('Your saved map changed while loading tasks.'), { status: 409 });\n        return value;",
    "        if (value.memberId !== id || value.stateRevision !== revision) throw Object.assign(new Error('Your saved map changed while loading tasks.'), { status: 409 });\n        r109.initiated(value, r109Initiation);\n        return value;");
  const start = text.indexOf('  function fetchSavedTasks('), end = text.indexOf('\n  function foregroundSettled()', start);
  if (start < 0 || end < 0) throw new Error('Pinned fetchSavedTasks extent missing');
  let fetch = text.slice(start, end);
  fetch = replaceOnce(fetch, '  function fetchSavedTasks(memberId, revision, projection, signal, peerFor) {',
    '  function fetchSavedTasks(memberId, revision, projection, signal, peerFor) {\n    const r109Claim = r109.snapshot(c, c.taskRequest, memberId, revision, projection, peerFor, "claim");');
  fetch = replaceOnce(fetch,
    'projection !== record.attempt.projection)) return c.api(path, undefined, signal);',
    'projection !== record.attempt.projection)) return r109.ordinary(r109Claim, () => c.api(path, undefined, signal));');
  fetch = replaceOnce(fetch, '      return value;\n    }).catch(error => {', '      r109.claimed(value, r109Claim, "early-claim");\n      return value;\n    }).catch(error => {');
  fetch = replaceOnce(fetch, '      return c.api(path, undefined, signal);', '      return r109.ordinary(r109Claim, () => c.api(path, undefined, signal));');
  text = text.slice(0, start) + fetch + text.slice(end);
  text = replaceOnce(text, '    const request = ++c.taskRequest, requestedMember = c.memberId;',
    '    const request = ++c.taskRequest, requestedMember = c.memberId;\n    const r109Request = r109.snapshot(c, request, requestedMember, c.state.revision, projection, undefined, "runTaskLoad");');
  text = replaceOnce(text, '    const requestId = ++c.taskRequest;',
    '    const requestId = ++c.taskRequest;\n    const r109Request = r109.snapshot(c, requestId, requestedMember, revision, request.projection, undefined, "ensureResult");');
  if (text.split('const value = await foregroundResponse;').length !== 3) throw new Error('Two exact foreground consumers required');
  text = text.replaceAll('const value = await foregroundResponse;', 'const value = await foregroundResponse; r109.consumed(value, r109Request);');
  return replaceOnce(text, '    const timingMs = Object.fromEntries',
    '    r109.accept(c, value, rendering, painted);\n    const timingMs = Object.fromEntries');
}

export function instrumentTasks(source) {
  let text = replaceOnce(source, 'export function createScreenTasks(c) {', 'export function createScreenTasks(c) {\n  const r109 = window.r109;');
  text = replaceOnce(text, '          const next = index + 1;',
    '          const next = index + 1; r109.slice(generation, next, jobs.length);');
  text = replaceOnce(text, '        jobs[index]();', '        jobs[index](); r109.row(generation, index);');
  const view = "    const view = c.result ?? (typeof c.shownResult !== 'undefined' && c.shownResult?.memberId === c.memberId ? c.shownResult : undefined);";
  text = replaceOnce(text, view, view + '\n    const r109Entry = r109.renderEntry(c, generation, view, !c.result && view === c.shownResult ? "shown-result-cache" : c.result ? "current-result" : "empty");');
  return replaceOnce(text,
    '      return painted;\n    });\n  }\n\n  // View-only links',
    '      return painted;\n    });\n    const r109Done = c.taskRenderDone;\n    void r109Done.then(painted => r109.renderDone(c, r109Entry, r109Done, painted), error => r109.error("render rejection: " + error.message));\n  }\n\n  // View-only links');
}

// This function is serialized as an init script. It must be closure-free.
export function installBrowserObservers(targetTaskId) {
  const responseValues = new WeakMap(), initiations = new WeakMap(), claims = new WeakMap(), consumers = new WeakMap();
  let sequence = 0, currentContext;
  const api = window.r109 = { targetTaskId, accepted: [], renders: [], slices: [], rows: [], errors: [], windowBlur: [] };
  const push = (rows, value) => { if (rows.length < 8192) rows.push(Object.freeze(value)); else api.error('observer output cap'); };
  api.error = message => { if (api.errors.length < 32) api.errors.push(String(message)); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const frozen = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); } return value; };
  api.snapshot = (c, generation, memberId, revision, projection, peerFor, kind) => frozen({
    id: ++sequence, kind, generation, at: performance.now(), input: {
      memberId, revision, projection: projection ?? null, peerFor: peerFor ?? null,
      selectedMember: c.memberId, stateRevision: c.state.revision, sandbox: c.sandbox.signature(),
      foregroundProjection: c.foregroundProjection() ?? null, memberIds: c.state.members.map(member => member.id),
    },
  });
  const meta = value => responseValues.get(value);
  api.initiated = (value, input) => { if (meta(value)) initiations.set(value, input); else api.error('initiating body lacks HTTP provenance'); };
  api.claimed = (value, input, kind) => {
    if (!meta(value) || !initiations.has(value)) api.error('claim lacks exact body/initiation provenance');
    else claims.set(value, frozen({ ...input, kind, claimedAt: performance.now() }));
  };
  api.ordinary = (input, action) => {
    const initiating = frozen({ ...input, kind: 'ordinary-initiate' });
    return action().then(value => { api.initiated(value, initiating); api.claimed(value, input, 'ordinary-claim'); return value; });
  };
  api.consumed = (value, input) => {
    if (!meta(value) || !claims.has(value)) api.error('consumer lacks exact claimed body provenance');
    else consumers.set(value, frozen({ ...input, consumedAt: performance.now() }));
  };
  api.renderEntry = (c, generation, view, provenance) => frozen({
    generation, provenance, startedAt: performance.now(), memberId: c.memberId, stateRevision: c.state.revision,
    viewMember: view?.memberId ?? null, viewRevision: view?.stateRevision ?? null,
    responseId: meta(view)?.id ?? null, bodySHA256: meta(view)?.rawSHA256 ?? null,
    resultAbsent: !c.result, group: c.duoEnabled(),
  });
  api.renderDone = (c, entry, promise, painted) => {
    const taskCount = c.$('task-count').textContent;
    push(api.renders, { ...entry, completeAt: performance.now(), painted: painted === true,
      promiseStillCurrent: promise === c.taskRenderDone, generationStillCurrent: entry.generation === c.taskRenderGeneration,
      currentMember: c.memberId, currentRevision: c.state.revision,
      busyText: /previous counts?, updating/.test(taskCount), taskCount,
      calculationStatus: c.$('calculation-status')?.textContent ?? '', engineStatus: c.$('task-engine-status')?.textContent ?? '',
    });
  };
  api.accept = (c, value, rendering, painted) => {
    currentContext = c;
    push(api.accepted, { response: clone(meta(value) ?? null), initiating: clone(initiations.get(value) ?? null),
      claim: clone(claims.get(value) ?? null), consumer: clone(consumers.get(value) ?? null),
      memberId: value.memberId, stateRevision: value.stateRevision, controllerGeneration: c.taskRequest,
      controllerInput: { memberId: c.memberId, revision: c.state.revision, projection: c.foregroundProjection() ?? null,
        memberIds: c.state.members.map(member => member.id), sandbox: c.sandbox.signature() },
      renderGeneration: c.taskRenderGeneration, renderComplete: painted === true && rendering === c.taskRenderDone,
      resultStillCurrent: c.result === value, at: performance.now() });
  };
  api.live = () => currentContext ? { memberId: currentContext.memberId, revision: currentContext.state.revision,
    requestGeneration: currentContext.taskRequest, renderGeneration: currentContext.taskRenderGeneration,
    responseId: meta(currentContext.result)?.id ?? null, projection: currentContext.foregroundProjection() ?? null,
    sandbox: currentContext.sandbox.signature(), memberIds: currentContext.state.members.map(member => member.id) } : null;
  api.slice = (generation, next, total) => push(api.slices, { generation, next, total, at: performance.now() });
  api.row = (generation, index) => push(api.rows, { generation, index, at: performance.now(),
    bPresent: !!document.querySelector(`#active-tasks [data-task-id="${targetTaskId}"] > input[type=checkbox]`) });
  addEventListener('blur', event => push(api.windowBlur, { trusted: event.isTrusted, at: performance.now() }));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args), header = response.headers.get('x-r109-observation');
    if (header) {
      const observation = frozen(JSON.parse(header)), originalJSON = response.json.bind(response);
      Object.defineProperty(response, 'json', { value: async () => {
        const raw = await response.clone().text();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        const observedSHA256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const value = await originalJSON();
        if (observedSHA256 !== observation.rawSHA256) api.error('HTTP body digest differs from transport observation');
        responseValues.set(value, frozen({ ...observation, observedSHA256, parsedAt: performance.now() }));
        return value;
      } });
    }
    return response;
  };
}

// Pure acceptance oracle; the exact function also runs in the browser.
export function pickCachedRender(observations, criteria) {
  return observations.renders.find(render => render.provenance === 'shown-result-cache'
    && render.memberId === criteria.owner && render.viewMember === criteria.owner
    && render.stateRevision === criteria.revision && render.viewRevision < criteria.revision
    && render.resultAbsent && render.responseId && /^[a-f0-9]{64}$/.test(render.bodySHA256)
    && render.painted && render.promiseStillCurrent && render.generationStillCurrent
    && render.currentMember === criteria.owner && render.currentRevision === criteria.revision && render.busyText
    && criteria.responses.some(response => response.id === render.responseId && response.rawSHA256 === render.bodySHA256
      && response.memberId === criteria.owner && response.requestedMember === criteria.owner && response.status === 200
      && response.stateRevision === render.viewRevision)) ?? null;
}

export function pickWitness(observations, criteria) {
  if (observations.errors.length) return null;
  const cached = observations.renders.find(render => render.generation === criteria.cachedGeneration);
  if (!cached || !pickCachedRender({ renders: [cached] }, criteria)) return null;
  for (const accepted of observations.accepted) {
    const { response, initiating, claim, consumer, controllerInput: current } = accepted;
    if (!response || !initiating || !claim || !consumer || !current) continue;
    const body = criteria.responses.find(row => row.id === response.id);
    if (!body || body.rawSHA256 !== response.rawSHA256 || response.observedSHA256 !== response.rawSHA256) continue;
    if (response.status !== 200 || response.requestedMember !== criteria.owner || response.memberId !== criteria.owner
      || response.stateRevision !== criteria.revision || response.fetchedAtNode < criteria.receiptAtNode
      || !criteria.releasedResponseIds.includes(response.id)) continue;
    if (accepted.memberId !== criteria.owner || accepted.stateRevision !== criteria.revision
      || current.memberId !== criteria.owner || current.revision !== criteria.revision
      || !accepted.renderComplete || !accepted.resultStillCurrent) continue;
    if (typeof observations.live === 'function') {
      const live = observations.live();
      if (!live || live.memberId !== criteria.owner || live.revision !== criteria.revision
        || live.requestGeneration !== accepted.controllerGeneration || live.renderGeneration !== accepted.renderGeneration
        || live.responseId !== response.id || live.projection !== current.projection || live.sandbox !== current.sandbox
        || JSON.stringify(live.memberIds) !== JSON.stringify(current.memberIds)) continue;
    }
    const inputs = [initiating.input, claim.input, consumer.input];
    if (inputs.some(input => !input || input.memberId !== criteria.owner || input.revision !== criteria.revision
      || input.selectedMember !== criteria.owner || input.peerFor !== null || input.projection !== current.projection
      || input.foregroundProjection !== current.projection || input.sandbox !== current.sandbox
      || JSON.stringify(input.memberIds) !== JSON.stringify(current.memberIds))) continue;
    if (!Number.isSafeInteger(initiating.generation) || initiating.generation <= 0
      || !Number.isSafeInteger(claim.generation) || claim.generation !== consumer.generation
      || consumer.generation !== accepted.controllerGeneration || initiating.generation > claim.generation) continue;
    if (!['early-initiate', 'ordinary-initiate'].includes(initiating.kind)
      || !['early-claim', 'ordinary-claim'].includes(claim.kind)
      || !['runTaskLoad', 'ensureResult'].includes(consumer.kind)) continue;
    const early = initiating.kind === 'early-initiate';
    if ((early ? 'early-claim' : 'ordinary-claim') !== claim.kind
      || initiating.input.stateRevision !== criteria.revision - (early ? 1 : 0)
      || claim.input.stateRevision !== criteria.revision || consumer.input.stateRevision !== criteria.revision) continue;
    const render = observations.renders.find(row => row.generation === accepted.renderGeneration
      && row.provenance === 'current-result' && row.responseId === response.id && row.bodySHA256 === response.rawSHA256
      && row.memberId === criteria.owner && row.viewMember === criteria.owner
      && row.stateRevision === criteria.revision && row.viewRevision === criteria.revision
      && row.painted && row.promiseStillCurrent && row.generationStillCurrent
      && row.currentMember === criteria.owner && row.currentRevision === criteria.revision);
    if (!render || cached.completeAt >= render.startedAt || cached.generation >= render.generation) continue;
    const times = [initiating.at, claim.claimedAt, consumer.consumedAt, render.startedAt, render.completeAt, accepted.at];
    if (!times.every(Number.isFinite) || times.some((at, index) => index > 0 && at < times[index - 1])) continue;
    const row = observations.rows.find(item => item.generation === render.generation && item.bPresent);
    const slice = observations.slices.find(item => item.generation === render.generation && row
      && item.next <= row.index && item.at < row.at && item.next < item.total);
    if (!row || !slice) continue;
    return { accepted, cached, render, row, slice };
  }
  return null;
}

export function browserInitSource(targetTaskId) {
  return `(${installBrowserObservers.toString()})(${JSON.stringify(targetTaskId)});\n{ const pickCachedRender = ${pickCachedRender.toString()}; const pickWitness = ${pickWitness.toString()}; window.r109.pickCachedRender = pickCachedRender; window.r109.pickWitness = pickWitness; }`;
}
