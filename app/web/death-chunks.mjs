import { resolveDeathSettings } from '../core/death-settings.mjs';

/** Only the active member's current candidates can receive advisory skulls. */
export function deathMarkersFor({ state, memberId, candidateIds = [], estimates = [], compatibleRevision = revision => revision === state?.revision }) {
  const owner = state?.members?.find(member => member.id === memberId);
  if (!owner || !resolveDeathSettings(owner).showDeathChunks) return new Map();
  const { deathThresholdHours } = resolveDeathSettings(owner);
  const excluded = new Set([...owner.unlocked, ...owner.blacklisted, ...owner.pendingRoll]);
  const candidates = new Set(candidateIds.map(String));
  return new Map(estimates.filter(estimate => candidates.has(String(estimate.chunkId)) && !excluded.has(String(estimate.chunkId))
    && estimate.memberId === memberId && compatibleRevision(estimate.stateRevision)
    && estimate.death === true && Number.isFinite(estimate.hours) && estimate.hours > deathThresholdHours)
    .map(estimate => [String(estimate.chunkId), { ...estimate, thresholdHours: deathThresholdHours }]));
}

export function estimateHoursLabel(hours) {
  if (!Number.isFinite(hours)) return 'unknown';
  if (hours === 0) return '0 h';
  if (hours < 1) return 'less than 1 h';
  return `about ${Math.round(hours).toLocaleString()} h`;
}

const taskLabel = row => row?.label ?? row?.obligation?.label ?? row?.task?.label ?? 'Task with unknown time';

function plainEstimateText(value) {
  return String(value ?? '').replaceAll('No supported positive numeric drop probability is recorded.', 'The drop rate is unknown.')
    .replaceAll('No numeric probability.', 'The drop rate is unknown.')
    .replaceAll('No valid effective seconds per kill is recorded.', 'Time per kill is unknown.')
    .replaceAll('This probability is outside the finite numeric range of the estimator.', 'The drop rate is too small for a reliable time estimate.')
    .replaceAll('has no supported acquisition-time model.', 'has no known time to obtain the item.')
    .replaceAll('The reachable log supply cannot be bootstrapped from this personal starting-progress scenario.', 'No timed route to the Woodcutting level needed to gather these logs is known from your starting level.')
    .replaceAll('This action, prerequisite chain, or already-required skill target has no additional completion-time model in version 1.', 'The time for this task and its requirements is unknown.')
    .replaceAll('Explicit member backlog defers this obligation.', 'This task is in your backlog, so it is left out of the time estimate.')
    .replaceAll('The current membership rule defers this duty; membership progression is never assumed.', 'This task is left out while your current free-to-play rules apply.')
    .replaceAll('The threshold compares the single slowest added or raised obligation, using unrounded hours.', 'The limit applies to the slowest new or increased task, using its full time estimate.')
    .replaceAll('Active person-hours for the selected member’s solo route; partner territory supplies capability, never personal obligations.', 'Time is for this player training alone. Your partner’s chunks can supply methods, but only your own chunks create tasks.')
    .replaceAll('Estimates are advisory scenarios. Unknown duties and unpriced alternatives may change the conclusion; drop percentiles are not a guarantee.', 'These estimates are advice. Tasks and routes with unknown times can change the result; drop chances are not a guarantee.')
    .replaceAll('Standalone prerequisite skill times are added; cross-skill overlap is unresolved.', 'Required skill times are added separately. Training that helps several skills may reduce the total.')
    .replace(/Acquisition time for consumed (.+?) is not covered by a reachable curated gathering method\./g, 'Time to gather the $1 you use is unknown in your chunks.')
    .replace(/The (.+?) source needs Woodcutting (\d+); no verified starting level or priced bootstrap source is available in this supply route\./g, 'Gathering $1 needs Woodcutting $2. Your starting level or time to reach it is unknown.')
    .replace(/has? no curated XP\/action and full-cycle time data/g, 'has unknown XP per action or time to train and gather supplies')
    .replaceAll('with the reachable curated methods', 'with the timed methods known in your chunks')
    .replaceAll('needs a dedicated progression model.', 'has no time estimate for training yet.')
    .replaceAll('This own-map duty is blocked:', 'This task from your chunks is blocked:')
    .replaceAll('effective seconds per kill', 'seconds per kill')
    .replaceAll('Unsupported requirements.', 'Some requirements are unknown.')
    .replaceAll('have no curated XP/action and full-cycle time data.', 'have unknown XP per action or time to train and gather supplies.')
    .replaceAll('deferred by current rules', 'left out by current rules')
    .replaceAll('No newly added priced obligations.', 'No new tasks with known times.')
    .replaceAll('Estimating new obligations', 'Estimating new tasks')
    .replaceAll('No priced duty exceeds the limit', 'No task with a known time exceeds the limit')
    .replaceAll('Largest priced new duty:', 'Longest new task with a known time:')
    .replaceAll('largest new duty', 'longest new task')
    .replaceAll('Slowest priced obligation:', 'Longest task with a known time:')
    .replaceAll('Best priced route:', 'Fastest route with a known time:')
    .replaceAll('Own qualifying locations:', 'Locations in your own chunks:')
    .replaceAll('Permitted source comparison', 'Other allowed sources')
    .replaceAll('New obligations', 'New tasks')
    .replaceAll('Unpriced duties or alternative routes can change this conclusion.', 'Tasks or routes with unknown times can change this result.')
    .replace(/\bduties\b/g, 'tasks').replace(/\bduty\b/g, 'task');
}

/** Background requests are isolated from map drawing and guarded by revision/member. */
export function createDeathChunks(ctx) {
  const advanced = () => ctx.advanced?.() ?? ctx.preferences?.()?.advanced === true;
  const el = (tag, text, cls) => ctx.el(tag, text === undefined ? undefined : plainEstimateText(text), cls);
  const details = (title, ...nodes) => ctx.details(plainEstimateText(title), ...nodes);
  const list = rows => ctx.list(rows.map(plainEstimateText));
  const locationName = id => { const name = ctx.world?.()?.chunks?.get(String(id))?.name; return name ? `${ctx.plain?.(name) ?? name}${advanced() ? ` · Chunk ${id}` : ''}` : id; };
  const schedule = ctx.setTimeout ?? globalThis.setTimeout;
  const cancel = ctx.clearTimeout ?? globalThis.clearTimeout;
  let key, timer, controller, generation = 0, batch, batchScheduled = false;
  const cache = new Map(), pending = new Map();
  const localCandidates = () => [...new Set([...(ctx.pool()?.eligible ?? []).map(row => typeof row === 'string' ? row : row.id),
    ...(ctx.state()?.members.find(member => member.id === ctx.memberId())?.selected ?? [])])];
  // Display saves such as chunk notes keep the task epoch. Estimates read the
  // same inputs, so they key on that epoch plus what the estimate shows: the
  // candidates and death settings. A burst of notes then sends no new batches.
  const scope = () => {
    const revision = ctx.state()?.revision, memberId = ctx.memberId(), owner = ctx.state()?.members.find(member => member.id === memberId);
    return { revision, memberId, epoch: JSON.stringify([ctx.canonicalTaskRevision?.(revision) ?? revision, memberId,
      localCandidates(), owner ? resolveDeathSettings(owner) : null]) };
  };
  const scopeKey = value => value.epoch;
  const current = value => scopeKey(scope()) === scopeKey(value);
  const compatible = (revision, requested) => revision === requested.revision || !!ctx.compatibleTaskRevision?.(revision);
  const applyMarkers = () => {
    const candidates = new Set(localCandidates());
    const ids = batch?.candidateIds?.filter(id => candidates.has(id)) ?? [];
    const state = ctx.state();
    ctx.map()?.setDeathMarkers?.(deathMarkersFor({ state, memberId: ctx.memberId(), candidateIds: ids, estimates: batch?.estimates,
      compatibleRevision: revision => revision === state?.revision || !!ctx.compatibleTaskRevision?.(revision) }));
    ctx.onMarkersChanged?.();
  };
  const accept = (value, requested) => {
    if (!current(requested) || value.memberId !== requested.memberId || !compatible(value.stateRevision, requested)) return false;
    for (const estimate of value.estimates ?? []) cache.set(String(estimate.chunkId), estimate);
    return true;
  };
  async function loadBatch(requested, requestGeneration) {
    controller = new AbortController();
    try {
      const value = await ctx.api(`/api/death-estimates?memberId=${encodeURIComponent(requested.memberId)}`, undefined, controller.signal);
      if (requestGeneration !== generation || !accept(value, requested)) return;
      batch = value; applyMarkers();
    } catch (error) {
      // A failed advisory estimate never blocks the map or changes roll eligibility.
      if (requestGeneration === generation && error.name !== 'AbortError') batch = undefined;
    }
  }
  function refresh() {
    const requested = scope(), next = scopeKey(requested);
    if (key !== next) {
      key = next; generation++; cancel(timer); controller?.abort(); cache.clear(); pending.clear(); batch = undefined; batchScheduled = false;
    }
    const owner = ctx.state()?.members.find(member => member.id === requested.memberId);
    if (!batchScheduled && owner && resolveDeathSettings(owner).showDeathChunks && (ctx.isForegroundReady?.() ?? true)) {
      batchScheduled = true;
      const requestGeneration = generation;
      timer = schedule(() => loadBatch(requested, requestGeneration), 120);
    }
    applyMarkers();
  }
  async function estimateChunk(chunkId) {
    refresh();
    const requested = scope(), id = String(chunkId);
    if (cache.has(id)) return cache.get(id);
    if (!pending.has(id)) {
      const request = ctx.api(`/api/death-estimates?memberId=${encodeURIComponent(requested.memberId)}&chunkId=${encodeURIComponent(id)}`)
        .then(value => accept(value, requested) ? cache.get(id) : undefined)
        .finally(() => { if (pending.get(id) === request) pending.delete(id); });
      pending.set(id, request);
    }
    return pending.get(id);
  }
  function sourceLinks(row) {
    const sources = row.provenance ?? row.sources ?? row.method?.provenance ?? [];
    const links = [];
    for (const source of Array.isArray(sources) ? sources : [sources]) {
      const url = source?.url ?? source?.canonicalUrl ?? source?.permanentUrl;
      if (!/^https?:\/\//i.test(url ?? '')) continue;
      const link = el('a', source.title ?? source.label ?? 'Rate evidence'); link.href = url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; links.push(link);
    }
    if (!links.length) return null;
    const node = el('p', undefined, 'status-detail');
    links.forEach((link, index) => { if (index) node.append(' · '); node.append(link); });
    return node;
  }
  function breakdownRow(row) {
    const node = el('li', undefined, 'death-obligation');
    node.append(el('strong', `${taskLabel(row)} · ${row.status === 'deferred' ? 'deferred by current rules' : estimateHoursLabel(row.hours)}`));
    const method = row.method?.label ?? row.method?.name ?? (typeof row.method === 'string' ? row.method : undefined);
    const source = row.source?.source ?? row.source?.name ?? (typeof row.source === 'string' ? row.source : undefined);
    if (method || source) node.append(el('p', `Best priced route: ${method ?? source}`, 'status-detail'));
    if (row.qualifyingLocations?.length) node.append(el('p', `Own qualifying locations: ${row.qualifyingLocations.map(locationName).join(', ')}`, 'status-detail'));
    const probability = row.probability ?? row.source?.probability;
    if (Number.isFinite(probability) && probability > 0 && probability <= 1) node.append(el('p', `Drop probability per kill: ${probability.toPrecision(4)}.`, 'status-detail'));
    if (Number.isFinite(row.expectedKills)) node.append(el('p', `${Math.ceil(row.expectedKills).toLocaleString()} expected kills${Number.isFinite(row.secondsPerKill) ? ` · ${row.secondsPerKill} effective seconds per kill` : ''}`, 'status-detail'));
    const hours95 = row.acquisition95Hours ?? row.hours95 ?? row.acquisition95?.hours;
    if (Number.isFinite(hours95)) node.append(el('p', `95% chance to have the drop by: ${estimateHoursLabel(hours95)}${Number.isFinite(row.kills95) ? ` (${row.kills95.toLocaleString()} kills)` : ''}. This is a chance, not a guaranteed time.`, 'status-detail'));
    if (Number.isFinite(row.actions)) node.append(el('p', `${Math.ceil(row.actions).toLocaleString()} actions${Number.isFinite(row.xpPerAction) ? ` · ${row.xpPerAction} XP per action` : ''}`, 'status-detail'));
    if (row.targetLevel) node.append(el('p', `${row.skill} target level ${row.targetLevel}${Number.isFinite(row.startingXp) ? ` · starting XP ${Math.round(row.startingXp).toLocaleString()}` : ''}`, 'status-detail'));
    if (row.route?.length) {
      const routes = el('ul');
      for (const segment of row.route) {
        const route = el('li', undefined, 'status-detail');
        route.append(`${segment.label} · ${Math.ceil(segment.actions).toLocaleString()} actions at ${segment.xpPerAction} XP each · ${estimateHoursLabel(segment.hours)}${segment.viaPartner ? ' · uses connected partner territory' : ''}`);
        if (Number.isFinite(segment.processingSeconds) && Number.isFinite(segment.supplySeconds)) route.append(el('p', `Processing ${estimateHoursLabel(segment.processingSeconds / 3600)}; gathering supplies ${estimateHoursLabel(segment.supplySeconds / 3600)}.`, 'status-detail'));
        routes.append(route);
      }
      node.append(routes);
    }
    if (row.parts?.length) {
      const parts = el('ul', undefined, 'death-breakdown');
      row.parts.forEach(part => parts.append(breakdownRow({ ...part, label: part.label ?? `${part.skill} target level ${part.targetLevel}` })));
      node.append(details('Prerequisite skill estimates', parts));
    }
    if (row.alternatives?.length && (row.alternatives.length > 1 || !row.source)) node.append(details('Permitted source comparison', list(row.alternatives.map(alternative =>
      `${alternative.source?.source ?? alternative.source?.name ?? (advanced() ? alternative.source?.kind : undefined) ?? 'Source'} · ${estimateHoursLabel(alternative.hours)}${alternative.unknown?.length ? ` · ${alternative.unknown.map(value => value.detail).join(' ')}` : ''}`))));
    if (row.reason || row.detail) node.append(el('p', row.reason ?? row.detail, 'status-detail'));
    if (row.unknown?.length) node.append(list(row.unknown.map(unknown => unknown.detail ?? (typeof unknown === 'string' ? unknown : 'Part of this time estimate is unknown.'))));
    if (row.assumptions?.length) node.append(list(row.assumptions));
    const links = sourceLinks(row); if (links) node.append(links);
    if (advanced()) {
      const diagnostics = ctx.details('Task estimate diagnostics');
      if (row.id) diagnostics.append(ctx.el('p', `Task ID: ${row.id}`));
      if (row.code) diagnostics.append(ctx.el('p', `${row.code}: ${row.detail ?? ''}`));
      for (const issue of row.unknown ?? []) diagnostics.append(ctx.el('p', typeof issue === 'string' ? issue : `${issue.code ?? 'unknown'}: ${issue.detail ?? ''}`));
      if (row.reason || row.detail) diagnostics.append(ctx.el('p', row.reason ?? row.detail));
      if (row.assumptions?.length) diagnostics.append(ctx.list(row.assumptions));
      node.append(diagnostics);
    }
    return node;
  }
  function renderEstimate(node, estimate, ownerName) {
    if (!estimate) { node.replaceChildren(el('h3', 'Death-chunk estimate'), el('p', 'The map changed while estimating. Reopen this chunk for the current estimate.', 'status-detail')); return; }
    const unknown = estimate.unknown ?? [];
    const count = new Set(unknown.map((row, index) => typeof row === 'string' ? row : row.id ?? row.label ?? index)).size;
    const summary = estimate.death ? `Estimated death chunk · largest new duty ${estimateHoursLabel(estimate.hours)}`
      : count ? `No priced duty exceeds the limit; ${count} ${count === 1 ? 'duty has missing data' : 'duties have missing data'}`
        : `Largest priced new duty: ${estimateHoursLabel(estimate.hours)}`;
    node.replaceChildren(el('h3', 'Death-chunk estimate'), el('p', `${ownerName}’s hypothetical unlock · ${summary} · limit ${estimate.thresholdHours.toLocaleString()} h`, 'death-summary'));
    if (estimate.slowest) node.append(el('p', `Slowest priced obligation: ${taskLabel(estimate.slowest)}.`, 'status-detail'));
    node.append(details('How estimates are calculated', el('p', 'Times count this player’s active play using the fastest known route in reachable chunks. Your partner’s chunks can supply training methods, while your own map creates tasks. Drop averages are uncertain; the default 60 seconds per kill is a placeholder. Gathering, banking and recipes can change the time. Missing rates stay unknown.', 'status-detail')));
    if (estimate.breakdown?.length) {
      const rows = el('ul', undefined, 'death-breakdown'); estimate.breakdown.forEach(row => rows.append(breakdownRow(row)));
      node.append(details(`New obligations (${estimate.breakdown.length})`, rows));
    } else node.append(el('p', 'No newly added priced obligations.', 'status-detail'));
    if (count) {
      const rows = el('ul', undefined, 'death-breakdown');
      unknown.forEach(row => rows.append(typeof row === 'string' ? el('li', row) : breakdownRow(row)));
      const section = details(`Unknown estimates (${count} ${count === 1 ? 'duty' : 'duties'}; ${unknown.length} ${unknown.length === 1 ? 'detail' : 'details'})`, rows); section.open = true; node.append(section);
      node.append(el('p', 'Unpriced duties or alternative routes can change this conclusion. This estimate does not establish that the chunk is safe.', 'status-detail'));
    }
    if (estimate.assumptions?.length) node.append(details('Estimate assumptions', list(estimate.assumptions)));
    if (advanced()) node.append(ctx.details('Calculation diagnostics', ctx.el('p', `Chunk ID: ${estimate.chunkId} · Catalogue: ${estimate.catalogueVersion ?? 'unknown'} · Saved revision: ${estimate.stateRevision}`)));
  }
  function panel(chunkId) {
    const node = el('section', undefined, 'death-estimate'), requested = scope();
    const owner = ctx.state().members.find(member => member.id === requested.memberId);
    node.setAttribute('aria-label', `${owner.name}’s death-chunk estimate`);
    node.setAttribute('aria-live', 'polite');
    if (owner.unlocked.includes(String(chunkId))) {
      node.append(el('h3', 'Death-chunk estimate'), el('p', 'This chunk is already on this player’s map. Death-chunk estimates describe duties added by a future unlock.', 'status-detail')); return node;
    }
    node.append(el('h3', 'Death-chunk estimate'), el('p', 'Estimating new obligations in the background…', 'status-detail'));
    estimateChunk(chunkId).then(estimate => {
      if (node.isConnected && current(requested) && ctx.selectedChunkId() === chunkId && ctx.isChunkOpen()) renderEstimate(node, estimate, owner.name);
    }).catch(error => {
      if (node.isConnected && current(requested) && ctx.selectedChunkId() === chunkId && ctx.isChunkOpen()) node.replaceChildren(el('h3', 'Death-chunk estimate'), el('p', `Estimate unavailable: ${error.message}`, 'status-detail'));
    });
    return node;
  }
  return { refresh, panel, estimateChunk, dispose() { generation++; cancel(timer); controller?.abort(); cache.clear(); pending.clear(); } };
}
