const MAX_CHUNKS = 40;
const MAX_DONE_TASKS = 500;
const compare = (a, b) => a.localeCompare(b);
const emptyChanges = () => ({ unlockChunks: [], lockChunks: [], doneTasks: [] });
const normalize = changes => ({
  unlockChunks: [...changes.unlockChunks].sort(compare),
  lockChunks: [...changes.lockChunks].sort(compare),
  doneTasks: [...changes.doneTasks].sort(compare),
  ...(Object.keys(changes.taskRules ?? {}).length ? { taskRules: Object.fromEntries(Object.entries(changes.taskRules).sort(([a], [b]) => compare(a, b))) } : {}),
});
const abandoned = () => Object.assign(new Error('The sandbox changed while this was calculating. Try again.'), { sandboxAbandoned: true });

/** Browser-only draft controller. Its only API route evaluates a draft; it never saves. */
export function createSandbox(context) {
  // "13882 · Rimmington" when the chunk has a name.
  const chunkLabel = id => { const name = context.chunkName?.(String(id)); return name && name !== String(id) ? `${id} · ${name}` : `Chunk ${id}`; };
  let active = false, entering = false, stale = false, busy = false, generation = 0;
  let saved, changes = emptyChanges(), steps = [], latest, requested = false, runner, controller;
  let chrome;
  const previews = new Map();
  const planning = new Map();
  const advisories = new Set();
  const snapshot = () => context.getSnapshot();
  const owner = () => saved?.state.members.find(row => row.id === saved.memberId);
  const signature = () => saved ? JSON.stringify([saved.memberId, saved.state.revision, normalize(changes)]) : '';
  const isCurrent = token => active && generation === token;
  const hasChanges = () => changes.unlockChunks.length + changes.lockChunks.length + changes.doneTasks.length + Object.keys(changes.taskRules ?? {}).length > 0;

  function project() {
    if (!hasChanges()) return saved.state;
    const baseline = owner(), unlocked = new Set([...baseline.unlocked, ...changes.unlockChunks]);
    for (const id of changes.lockChunks) unlocked.delete(id);
    const changed = new Set([...changes.unlockChunks, ...changes.lockChunks]);
    const pendingChanged = (baseline.pendingRoll ?? []).some(id => changed.has(id));
    const taskStatus = { ...baseline.taskStatus };
    for (const id of changes.doneTasks) taskStatus[id] = { ...taskStatus[id], challengeCompleted: true };
    const member = { ...baseline, unlocked: [...unlocked],
      selected: [...new Set([...(baseline.selected ?? []), ...(pendingChanged ? baseline.pendingRoll : [])])].filter(id => !changed.has(id) && !unlocked.has(id)),
      blacklisted: (baseline.blacklisted ?? []).filter(id => !changed.has(id)),
      pendingRoll: pendingChanged ? [] : baseline.pendingRoll, taskStatus,
      ...(changes.taskRules ? { taskRules: { ...baseline.taskRules, ...changes.taskRules } } : {}) };
    return { ...saved.state, members: saved.state.members.map(row => row.id === saved.memberId ? member : row) };
  }

  function display() {
    if (!active) return;
    if (!hasChanges()) { context.display(saved); refreshChrome(); return; }
    const value = latest?.signature === signature() ? latest.response : null;
    const current = snapshot();
    context.display({ ...saved, state: project(),
      statePools: value ? { ...saved.statePools, [saved.memberId]: value.rollPool } : current.statePools,
      result: value?.result ?? current.result, fullResult: undefined,
      shownResult: value?.result ?? current.shownResult });
    refreshChrome();
  }

  function assertActive() {
    if (!active) throw new Error('Enter sandbox before making hypothetical changes.');
    if (stale) throw new Error('This sandbox is stale. Reset to clear its draft, then Exit sandbox and enter again to use the latest saved map.');
  }
  function markStale(error) {
    if (error.status !== 409) return false;
    stale = true; requested = false;
    refreshChrome(); return true;
  }
  function requestBody(draft = changes) {
    return { memberId: saved.memberId, baseRevision: saved.state.revision, changes: normalize(draft) };
  }
  function validateResponse(response) {
    if (response.format !== 'sandbox-v1' || response.memberId !== saved.memberId || response.stateRevision !== saved.state.revision) {
      throw new Error('The Sandbox result is for a different player or an older save. Exit sandbox and enter again.');
    }
    return response;
  }
  function schedule() {
    requested = true;
    if (runner) return runner;
    const session = saved;
    busy = true; refreshChrome();
    // Defer one microtask so a burst of map clicks becomes one complete draft.
    const job = Promise.resolve().then(async () => {
      while (runner === job && active && saved === session && requested && !stale) {
        requested = false;
        const token = generation, key = signature(), body = requestBody();
        controller = new AbortController();
        try {
          const response = await context.api('/api/sandbox/evaluate', body, controller.signal);
          if (!isCurrent(token) || saved !== session) continue;
          validateResponse(response); latest = { signature: key, response }; display();
        } catch (error) {
          if (!isCurrent(token) || saved !== session) continue;
          if (error.name === 'AbortError') continue;
          markStale(error); throw error;
        }
      }
    }).finally(() => {
      if (runner !== job) return;
      runner = undefined; controller = undefined; busy = false; refreshChrome();
    });
    runner = job; return job;
  }
  function invalidate() {
    generation++; controller?.abort();
    for (const request of advisories) {
      if (request.cache.get(request.key) === request.promise) request.cache.delete(request.key);
      request.controller.abort();
    }
    advisories.clear();
  }
  function update(next, description) {
    assertActive(); next = normalize(next);
    if (JSON.stringify(next) === JSON.stringify(normalize(changes))) return Promise.resolve();
    if (next.unlockChunks.length + next.lockChunks.length > MAX_CHUNKS) throw new Error(`A sandbox can change at most ${MAX_CHUNKS} chunks. Undo a step or Reset to try another chunk.`);
    if (next.doneTasks.length > MAX_DONE_TASKS) throw new Error(`A sandbox can add at most ${MAX_DONE_TASKS} challenge checks.`);
    steps.push({ changes, description }); changes = next; invalidate(); latest = undefined;
    display();
    if (!hasChanges()) { requested = false; return Promise.resolve(); }
    return schedule();
  }

  let entered;
  function enter() {
    if (active) return Promise.resolve();
    if (entering && entered) return entered;
    return (entered = enterNow());
  }
  async function enterNow() {
    entering = true; const token = ++generation; refreshChrome();
    try {
      await context.ensureReady();
      if (token !== generation) return;
      const current = snapshot();
      if (!current?.state?.members.some(row => row.id === current.memberId)) throw new Error('Choose a member before entering sandbox.');
      saved = { ...current }; changes = emptyChanges(); steps = []; latest = undefined;
      active = true; stale = false; previews.clear(); planning.clear(); context.onModeChange?.(true); display();
    } finally { entering = false; refreshChrome(); }
  }
  function exit() {
    const restore = active ? saved : null;
    invalidate(); active = false; entering = false; stale = false; busy = false; requested = false;
    runner = undefined; controller = undefined; latest = undefined; previews.clear(); planning.clear();
    changes = emptyChanges(); steps = []; saved = undefined;
    if (restore) { context.display(restore); context.onModeChange?.(false); }
    refreshChrome();
  }
  function reset() {
    if (!active) return;
    invalidate(); requested = false; busy = false; runner = undefined; controller = undefined;
    changes = emptyChanges(); steps = []; latest = undefined;
    context.display(saved); refreshChrome();
  }
  function undo() {
    assertActive(); if (!steps.length) return Promise.resolve();
    const previous = steps.pop(); changes = previous.changes; invalidate(); latest = undefined; display();
    if (!hasChanges()) { requested = false; return Promise.resolve(); }
    return schedule();
  }
  function setChunk(id, unlocked) {
    assertActive(); id = String(id);
    if (!/^[1-9]\d*$/.test(id)) throw new Error('Sandbox chunk changes need a surface chunk ID.');
    const original = owner().unlocked.includes(id);
    const next = { ...changes, unlockChunks: changes.unlockChunks.filter(value => value !== id), lockChunks: changes.lockChunks.filter(value => value !== id) };
    if (unlocked !== original) next[unlocked ? 'unlockChunks' : 'lockChunks'].push(id);
    return update(next, `${unlocked ? 'Unlock' : 'Lock'} chunk ${id}`);
  }
  async function toggleChunk(id) {
    if (entering && entered) await entered;
    assertActive(); id = String(id);
    return setChunk(id, !project().members.find(row => row.id === saved.memberId).unlocked.includes(id));
  }
  async function command(payload) {
    assertActive();
    const reject = () => { throw new Error('Exit sandbox to save this change. Sandbox supports chunk locks, challenge checks and task rules for its selected member.'); };
    if (payload.memberId !== saved.memberId) return reject();
    const allowed = keys => Object.keys(payload).every(key => keys.includes(key));
    if (payload.type === 'set-chunk' && allowed(['type', 'memberId', 'chunkId', 'status']) && ['unlocked', 'locked'].includes(payload.status)) {
      return setChunk(payload.chunkId, payload.status === 'unlocked');
    }
    if (payload.type === 'set-task-status' && allowed(['type', 'memberId', 'taskId', 'challengeCompleted']) && typeof payload.challengeCompleted === 'boolean' && typeof payload.taskId === 'string') {
      if (!payload.challengeCompleted && owner().taskStatus?.[payload.taskId]?.challengeCompleted) throw new Error('This challenge check was already saved. Sandbox only adds hypothetical checks; Exit sandbox to change a saved check.');
      const doneTasks = changes.doneTasks.filter(id => id !== payload.taskId);
      if (payload.challengeCompleted && !owner().taskStatus?.[payload.taskId]?.challengeCompleted) doneTasks.push(payload.taskId);
      return update({ ...changes, doneTasks }, `${payload.challengeCompleted ? 'Check' : 'Uncheck'} challenge ${payload.taskId}`);
    }
    if (payload.type === 'set-task-rule' && allowed(['type', 'memberId', 'ruleId', 'value']) && typeof payload.ruleId === 'string' && !['__proto__', 'constructor', 'prototype'].includes(payload.ruleId)
      && (payload.value === null || typeof payload.value === 'boolean' || typeof payload.value === 'string' || (typeof payload.value === 'number' && Number.isFinite(payload.value)))) {
      const taskRules = { ...changes.taskRules };
      if (Object.is(owner().taskRules?.[payload.ruleId], payload.value)) delete taskRules[payload.ruleId];
      else taskRules[payload.ruleId] = payload.value;
      return update({ ...changes, taskRules }, `Rule ${payload.ruleId}: ${String(payload.value)}`);
    }
    return reject();
  }
  function predictUnlock(id) {
    assertActive(); id = String(id);
    const token = generation, key = `${signature()}:${id}`;
    if (previews.has(key)) return previews.get(key);
    const body = { ...requestBody(), previewChunkId: id };
    const request = { controller: new AbortController(), cache: previews, key };
    const promise = context.api('/api/sandbox/evaluate', body, request.controller.signal).then(response => {
      if (!isCurrent(token)) throw abandoned();
      validateResponse(response);
      if (!response.prediction) throw new Error('The Sandbox result has no preview for this chunk.');
      return { ...response.prediction, memberId: saved.memberId, stateRevision: saved.state.revision, sandboxSignature: signature() };
    }).catch(error => {
      if (previews.get(key) === promise) previews.delete(key);
      if (isCurrent(token)) markStale(error); throw error;
    }).finally(() => advisories.delete(request));
    request.promise = promise; advisories.add(request);
    if (previews.size >= 32) previews.delete(previews.keys().next().value);
    previews.set(key, promise); return promise;
  }
  function ensurePlanningResult(id) {
    assertActive(); id = String(id);
    const token = generation, key = `${signature()}:${id}`;
    if (planning.has(key)) return planning.get(key);
    const request = { controller: new AbortController(), cache: planning, key };
    const promise = context.api('/api/sandbox/evaluate', { ...requestBody(), planningChunkId: id }, request.controller.signal).then(response => {
      if (!isCurrent(token)) throw abandoned();
      validateResponse(response);
      if (response.planning?.format !== 'chunk-planning-v1' || response.planning.chunkId !== id) throw new Error('The Sandbox result has no location details for this chunk.');
      return { ...response.planning, memberId: saved.memberId, stateRevision: saved.state.revision, sandboxSignature: signature() };
    }).catch(error => {
      if (planning.get(key) === promise) planning.delete(key);
      if (isCurrent(token)) markStale(error); throw error;
    }).finally(() => advisories.delete(request));
    request.promise = promise; advisories.add(request);
    if (planning.size >= 24) planning.delete(planning.keys().next().value);
    planning.set(key, promise); return promise;
  }

  function mount() {
    if (chrome) return;
    const doc = context.document ?? globalThis.document;
    const banner = context.banner ?? doc?.getElementById('sandbox-banner'), toggle = context.toggle ?? doc?.getElementById('sandbox-toggle');
    if (!banner || !toggle) return;
    banner.className = 'sandbox-banner'; banner.setAttribute('aria-label', 'Hypothetical sandbox');
    const heading = context.el('strong', 'Sandbox: nothing here is saved', 'sandbox-title');
    const summary = context.el('p', '', 'sandbox-summary'), status = context.el('p', '', 'sandbox-help');
    summary.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
    const controls = context.el('div', undefined, 'sandbox-controls');
    const undoButton = context.button('Undo last step', undo), resetButton = context.button('Reset', reset), exitButton = context.button('Exit sandbox', exit, 'sandbox-exit');
    controls.append(undoButton, resetButton, exitButton);
    const stepsHost = context.el('div', undefined, 'sandbox-steps');
    banner.replaceChildren(heading, summary, controls, status, stepsHost);
    toggle.addEventListener('click', () => Promise.resolve().then(() => active ? exit() : enter()).catch(context.showError ?? (() => {})));
    chrome = { banner, toggle, summary, status, undoButton, resetButton, stepsHost };
    refreshChrome();
  }
  function refreshChrome() {
    if (!chrome) return;
    const { banner, toggle, summary, status, undoButton, resetButton, stepsHost } = chrome;
    banner.hidden = !active; toggle.disabled = entering;
    toggle.textContent = entering ? 'Opening sandbox…' : active ? 'Exit sandbox' : 'Sandbox';
    toggle.setAttribute('aria-pressed', String(active)); banner.setAttribute('aria-busy', String(busy));
    if (!active) return;
    const delta = latest?.signature === signature() ? latest.response.delta : null;
    const poolBefore = saved.statePools?.[saved.memberId]?.eligible?.length ?? 0;
    const poolAfter = latest?.signature === signature() ? latest.response.rollPool.eligible.length : poolBefore;
    summary.textContent = `${owner().name} · +${delta?.tasksAdded?.length ?? 0} tasks · −${delta?.tasksRemoved?.length ?? 0} tasks · ${poolAfter - poolBefore >= 0 ? '+' : '−'}${Math.abs(poolAfter - poolBefore)} roll pool`;
    status.textContent = stale ? 'The saved map has changed. This sandbox is stale. Reset clears the draft; Exit sandbox and enter again for the latest map.'
      : busy ? 'Calculating this hypothetical map…' : 'Click map chunks to lock or unlock them. Challenge checks and task rules stay in this sandbox.';
    banner.dataset.stale = String(stale); undoButton.disabled = !steps.length || stale; resetButton.disabled = !hasChanges() && !steps.length;
    const labels = [...changes.unlockChunks.map(id => `Unlock ${chunkLabel(id).replace(/^Chunk /, '')}`), ...changes.lockChunks.map(id => `Lock ${chunkLabel(id).replace(/^Chunk /, '')}`), ...(changes.doneTasks.length ? [`${changes.doneTasks.length} challenge checks`] : []), ...(Object.keys(changes.taskRules ?? {}).length ? [`${Object.keys(changes.taskRules).length} task rules`] : [])];
    stepsHost.replaceChildren(...labels.map(label => context.el('span', label, 'sandbox-step')));
  }
  return { get active() { return active; }, get stale() { return stale; }, get busy() { return busy; }, get generation() { return generation; },
    enter, exit, reset, undo, toggleChunk, command, predictUnlock, ensurePlanningResult, mount, refreshChrome, signature,
    markers: () => active ? { unlockChunks: [...changes.unlockChunks], lockChunks: [...changes.lockChunks] } : { unlockChunks: [], lockChunks: [] },
    isNewTask: id => active && latest?.signature === signature() && latest.response.delta.tasksAdded.some(row => row.id === id) === true };
}
