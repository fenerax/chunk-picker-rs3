import { mergeCommandState, projectChunkState, projectTaskState } from './command-state.mjs';
import { reviewedNoteRevision } from './info-panels.mjs';
import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';

// Main-screen commands; shared values and callbacks live in the explicit screen context.
export function createScreenCommands(c) {
  let checks = [], displayState, displaySource, displayChecks;
  function taskDisplayState() {
    if (displaySource !== c.state || displayChecks !== checks) {
      displaySource = c.state; displayChecks = checks;
      displayState = projectTaskState(c.state, checks);
    }
    return displayState;
  }
  function removeCheck(check) { checks = checks.filter(item => item !== check); }
  async function api(path, body, signal) {
    if (!c.canWrite() && (body !== undefined || /^\/api\/(?:predict|death-estimates|chunk-planning|training-plan|teleports)(?:[/?]|$)/.test(path))) throw new Error('This link is view only.');
    if (c.sandbox.active && body !== undefined && path !== '/api/sandbox/evaluate'
      && !(path === '/api/pool-ranking-intent' && body.visible === false)) throw new Error('Exit Sandbox before saving changes. Nothing here is saved.');
    const baseline = c.state;
    // Any of these routes can return authoritative state, including conflicts
    // raised while preparing a review. Hydrated maps need its matching pool facts.
    const stateRoute = /^\/api\/(?:state|command|runemetrics\/(?:apply|preview)|original-sync\/preview|(?:restore|import|member-restore)(?:\/preview)?)$/.test(path);
    const requestPath = stateRoute ? `${path}?view=play-v1` : path;
    const response = await fetch(requestPath, body === undefined ? { signal } : typeof body.toBackupRequest === 'function'
      ? { ...await body.toBackupRequest(), signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const value = await response.json();
    const provisionalTaskState = /^\/api\/tasks(?:\?|$)/.test(path) && typeof c.hasProvisionalTasks === 'function' && c.hasProvisionalTasks();
    if (!provisionalTaskState && path !== '/api/prediction-intent' && value.state && (response.status === 409 || /^\/api\/(?:state|command|runemetrics\/apply|restore|import|member-restore)$/.test(path))) c.stateIsPlayView = value.format === 'play-v1';
    if (!response.ok) {
      if (!provisionalTaskState && response.status === 409 && value.state && !['/api/sandbox/evaluate', '/api/prediction-intent'].includes(path)) {
        if (path === '/api/command' && value.claimOnlyChanges === true && Number.isSafeInteger(body?.expectedRevision)
          && body.expectedRevision <= baseline.revision && c.state.revision === baseline.revision) {
          c.rememberUnchangedTaskRevisions(baseline.revision, value.state.revision);
        }
        c.adopt(value.state, value.pools);
        throw Object.assign(new Error('Another save arrived first. Your latest shared state is loaded; review your change and try again.'), {
          status: 409, claimOnlyChanges: value.claimOnlyChanges === true, stateRevision: value.state.revision,
        });
      }
      throw Object.assign(new Error(value.message || `Request failed (${response.status}).`), { status: response.status, code: value.code });
    }
    if (!c.canWrite() && /^\/api\/tasks(?:\?|$)/.test(path)) {
      // Saved task bytes stay reusable across display-only saves. The server
      // supplies their current revision without encoding the large body again.
      const header = response.headers?.get?.('X-RS3-State-Revision');
      const revision = typeof header === 'string' && /^(?:0|[1-9]\d*)$/.test(header) ? Number(header) : NaN;
      if (Number.isSafeInteger(revision) && (value.stateRevision === undefined || revision >= value.stateRevision)) value.stateRevision = revision;
    }
    if (path === '/api/command' && value.unchangedFields?.length) {
      const merged = mergeCommandState(baseline, value);
      if (!merged) return c.api('/api/state', undefined, signal);
      value.state = merged;
    }
    return value;
  }

  function command(payload, reviewedRevision, reviewedNote, reviewCurrent, chunkPreview) {
    if (!c.canWrite()) return Promise.reject(new Error('This link is view only.'));
    if (c.sandbox.active) return c.sandbox.command(payload);
    const check = payload.type === 'set-task-status' && typeof payload.challengeCompleted === 'boolean' ? { ...payload } : undefined;
    if (check) { checks = [...checks, check]; c.saved('Saving…'); c.renderTasks(); }
    const task = c.queue.then(async () => {
      if (c.sandbox.active) throw new Error('Exit Sandbox before saving changes. Nothing here is saved.');
      if (reviewCurrent && !reviewCurrent()) throw Object.assign(new Error(reviewedNote !== undefined ? 'The note editor was closed or the selected player changed. Reopen the note before saving.' : 'The original-picker review was closed. Fetch and review again.'), { reviewAbandoned: true });
      const priorRevision = c.state.revision;
      const undoTarget = payload.type === 'undo' ? [...c.state.history].reverse().find(event => event.undo && !event.undoneRevision && (payload.undoRevision === undefined || event.revision === payload.undoRevision)) : null;
      const displayCommands = [...groupGoalCommandTypes, 'set-preference', 'set-chunk-colour', 'rename-chunk-colour', 'claim-task', 'clear-task-claim', 'prune-task-claims', 'set-rule-review', 'set-finish-line-item', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom'];
      const displayOnly = displayCommands.includes(payload.type) || displayCommands.includes(undoTarget?.type);
      const displayResult = displayOnly && c.result?.memberId === c.memberId && c.result.stateRevision === priorRevision ? c.result : null;
      const requestCommand = JSON.parse(JSON.stringify(payload));
      const targetClaimCommand = ['claim-task', 'clear-task-claim'].includes(requestCommand.type);
      const alias = targetClaimCommand ? c.state.identityRegistry?.aliases?.[requestCommand.taskId] : undefined;
      const claimId = typeof alias === 'string' ? alias : Array.isArray(alias) && alias.length === 1 ? alias[0] : requestCommand.taskId;
      const originalClaim = c.state.taskClaims?.[claimId];
      const claimedMember = originalClaim?.memberId, claimedAt = originalClaim?.at;
      // A takeover confirms this particular claim. Even claim-only saves can
      // release it or replace it, so require the original owner and timestamp.
      const claimReviewCurrent = () => !targetClaimCommand || ((reviewedRevision === undefined || reviewedRevision === priorRevision)
        && (!Array.isArray(alias) || alias.length <= 1 || Object.hasOwn(c.state.taskClaims ?? {}, requestCommand.taskId))
        && c.state.taskClaims?.[claimId]?.memberId === claimedMember && c.state.taskClaims?.[claimId]?.at === claimedAt);
      const retryMemberId = c.memberId, retrySessionMember = c.sessionMember, retrySessionAdmin = c.sessionAdmin, retryReadOnly = c.sessionReadOnly;
      const retryGroupView = c.$('group-view')?.checked;
      const retryCurrent = () => c.canWrite() && !c.sandbox.active && c.memberId === retryMemberId && c.sessionMember === retrySessionMember
        && c.sessionAdmin === retrySessionAdmin && c.sessionReadOnly === retryReadOnly && c.$('group-view')?.checked === retryGroupView
        && (!reviewCurrent || reviewCurrent());
      // Reviews of imported gameplay and confirmed undo/unpick actions remain tied
      // to their original revision. Claim buttons and note field reviews are safe
      // to rebase only when their own guards still hold.
      const claimCommand = ['claim-task', 'clear-task-claim', 'prune-task-claims'].includes(payload.type);
      const canRetryClaims = !['sync-original', 'replace-member', 'restore', 'import', 'undo'].includes(payload.type)
        && !payload.previewId && (reviewedRevision === undefined || reviewedNote !== undefined || claimCommand);
      c.saved('Saving…');
      let response, claimRetryRevision, retriedClaims = false;
      for (let attempt = 0; ; attempt++) {
        const expectedRevision = reviewedNoteRevision(c.state, requestCommand, claimRetryRevision ?? reviewedRevision, reviewedNote);
        const gameplayAttempt = !displayOnly && typeof c.beginGameplayAttempt === 'function' ? c.beginGameplayAttempt(expectedRevision) : undefined;
        try {
          response = await c.api('/api/command', { expectedRevision, command: requestCommand });
          if (displayOnly && c.state.revision === expectedRevision && response.state.revision === expectedRevision + 1) {
            c.rememberUnchangedTaskRevisions(expectedRevision, response.state.revision);
          }
          if (gameplayAttempt) c.finishGameplayAttempt(gameplayAttempt, response.state.revision);
          break;
        }
        catch (error) {
          if (gameplayAttempt) c.finishGameplayAttempt(gameplayAttempt);
          if (error.status !== 409 || !retryCurrent()) throw error;
          if (error.claimOnlyChanges && canRetryClaims && claimReviewCurrent() && !retriedClaims && c.state.revision === error.stateRevision && error.stateRevision > expectedRevision) {
            reviewedNoteRevision(c.state, requestCommand, reviewedRevision, reviewedNote);
            retriedClaims = true; claimRetryRevision = error.stateRevision;
            continue;
          }
          if (retriedClaims || reviewedNote === undefined) throw error;
          reviewedNoteRevision(c.state, requestCommand, reviewedRevision, reviewedNote);
          if (attempt >= 2) throw error;
        }
      }
      const reuse = displayResult && c.result === displayResult && response.state.revision === priorRevision + 1 ? displayResult : null;
      if (chunkPreview) {
        c.removeChunkPreview(chunkPreview);
        if (response.state.revision < c.state.revision) c.renderMapState();
      }
      if (check) removeCheck(check);
      c.adopt(response.state, response.pools, reuse);
      c.saved(checks.length ? 'Saving…' : 'Saved', false, c.state.revision); return response;
    }).catch(error => {
      if (check) { removeCheck(check); c.renderTasks(); }
      if (chunkPreview) {
        c.removeChunkPreview(chunkPreview);
        c.renderMapState();
        error.message = error.status === 409
          ? `Chunk ${payload.chunkId} was not saved because another save arrived first. The shared state is loaded; review the chunk and try again.`
          : `Chunk ${payload.chunkId} was not saved. Its preview was reverted. ${error.message}`;
      }
      throw error;
    });
    c.queue = task.catch(error => { if (error.reviewAbandoned) return; c.saved('Save failed', true); c.showError(error); });
    return task;
  }

  function removeChunkPreview(preview) {
    const position = c.pendingChunkChanges.indexOf(preview);
    if (position !== -1) c.pendingChunkChanges.splice(position, 1);
  }

  function toggleChunk(id) {
    if (!c.canWrite()) return Promise.reject(new Error('This link is view only.'));
    if (c.sandbox.active) return c.sandbox.toggleChunk(id);
    const owner = projectChunkState(c.state, c.pendingChunkChanges).members.find(item => item.id === c.memberId);
    if (!owner) return Promise.reject(new Error('The selected player changed. Select a player and try again.'));
    const payload = { type: 'set-chunk', memberId: c.memberId, chunkId: id, status: owner.unlocked.includes(id) ? 'locked' : 'unlocked' };
    if (owner.pendingRoll.includes(id)) return c.command(payload);
    c.pendingChunkChanges.push(payload); c.renderMapState();
    return c.command(payload, undefined, undefined, undefined, payload);
  }

  function applyRuneMetrics(previewId, expectedRevision) {
    const reviewedMember = c.memberId, generation = c.dialogGeneration;
    const current = () => c.memberId === reviewedMember && c.dialogCurrent(generation);
    const task = c.queue.then(async () => {
      if (!current()) throw Object.assign(new Error('The RuneMetrics review was closed or the selected player changed. Open Activity Info and review a new preview.'), { reviewAbandoned: true });
      c.saved('Saving…');
      try {
        if (c.state.revision !== expectedRevision) throw Object.assign(new Error('Saved state changed.'), { status: 409 });
        const response = await c.api('/api/runemetrics/apply', { previewId, expectedRevision });
        c.adopt(response.state, response.pools);
        c.saved('Saved', false, c.state.revision);
        return response;
      } catch (error) {
        if (error.status === 409) error.message = 'Saved state changed. Fetch a new RuneMetrics preview and review it before applying.';
        throw error;
      }
    });
    c.queue = task.catch(error => { if (error.reviewAbandoned) return; c.saved('Save failed', true); if (current()) c.showError(error); });
    return task;
  }

  function adopt(next, pools, reuseResult, schedule = true) {
    if (c.sandbox.active && next.revision > c.state.revision) { c.sandbox.exit(); c.notice('The saved map changed. Sandbox closed; the latest saved view is loaded.'); }
    if (c.state && next.revision < c.state.revision) return;
    const reusedDuo = reuseResult && c.duoResultCache ? [...c.duoResultCache.results().values()] : [];
    const previousRevision = c.state?.revision;
    if (next.revision !== previousRevision && c.unchangedTaskRevisions?.to !== next.revision) c.unchangedTaskRevisions = undefined;
    if (reuseResult) for (const [id, value] of c.normalPlayResults) {
      if (value.stateRevision === previousRevision) c.normalPlayResults.set(id, { ...value, stateRevision: next.revision });
    }
    const previousMember = c.memberId; c.state = next; c.taskFactsCache = undefined; c.statePools = pools ?? {};
    c.duoLoadError = undefined; c.duoDetails.clear();
    for (const value of reusedDuo) c.duoResultCache.remember({ ...value, stateRevision: next.revision });
    c.planningResults.clear();
    if (!c.state.members.some(item => item.id === c.memberId)) c.memberId = c.state.members[0]?.id;
    if (previousMember !== c.memberId) { c.result = undefined; c.shownResult = undefined; c.closeDialog(); }
    if (reuseResult?.memberId === c.memberId) {
      clearTimeout(c.syncTimer); c.taskRequest++; c.taskController?.abort();
      c.result = { ...reuseResult, stateRevision: c.state.revision };
      c.$('task-engine-status').replaceChildren(c.el('span', `${c.result.metrics.availableCount.toLocaleString()} possible tasks${c.advanced() ? ' · cached' : ''}`), ...(c.advanced() ? [c.button('Details', c.engineDetails)] : []));
      if (c.taskHealth && !c.taskHealth.ready) c.workerStatus(c.taskHealth);
    }
    // A save makes the result stale; keep showing it (with the new ticks) until the recalculation lands, instead of emptying the list.
    if (c.result?.stateRevision !== c.state.revision) { if (c.result?.memberId === c.memberId) c.shownResult = c.result; c.result = undefined; }
    if (reuseResult && c.fullResult?.stateRevision === previousRevision) c.fullResult = { ...c.fullResult, stateRevision: next.revision };
    if (c.fullResult?.stateRevision !== c.state.revision || c.fullResult?.memberId !== c.memberId) c.fullResult = undefined;
    c.renderState();
    c.duoCoordination?.changed();
    c.completedView.refresh();
    c.journal?.refresh();
    c.perfMark('state-adopted', { revision: c.state.revision, memberId: c.memberId });
    if (schedule && (!reuseResult || reuseResult.memberId !== c.memberId)) c.scheduleTasks();
  }

  Object.assign(c, { api, command, taskDisplayState, removeChunkPreview, toggleChunk, applyRuneMetrics, adopt });
}
