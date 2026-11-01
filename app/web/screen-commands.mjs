import { createLiveSwapCommandClient, createRequestReader, requestError } from './live-swap-client.mjs';
import { mergeCommandState, projectChunkState, projectTaskState } from './command-state.mjs';
import { reviewedNoteRevision } from './info-panels.mjs';
import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';
import { createCalculationFeedback, calculationLabel } from './calculation-feedback.mjs';
import { createSaveRecovery } from './screen-save-recovery.mjs';

// Main-screen commands; shared values and callbacks live in the explicit screen context.
export function createScreenCommands(c) {
  const readRequest = createRequestReader({ fetch: (...args) => c.panelContext?.pickerSession ? c.panelContext?.pickerSession.fetch(...args) : fetch(...args) });
  let durableCommands, recoveredForm, connectionNoticeShown = false;
  const showSaveRetry = createSaveRecovery(c, {
    retry: () => {
      const task = c.queue.then(() => c.recoverPendingCommand({ retry: true }));
      c.queue = task.catch(error => {
        c.saved(error.retryPaused ? 'Save not confirmed' : 'Save confirmation needed', true);
        showSaveRetry(hasPendingCommand()); c.showError(error);
      });
      return c.queue;
    },
    discard: () => {
      if (!confirm('Check History first: this change may already be saved. Discard the pending save and start a fresh saving session?')) return;
      const task = c.queue.then(async () => {
        await commandClient().discard(); recoveredForm = undefined; showSaveRetry(false);
        if (!c.$('tool-dialog')?.open) c.$('history-open')?.focus();
        const response = await c.api('/api/state'); c.adopt(response.state, response.pools);
        c.saved('Pending save discarded', false, undefined, { resolved: true }); c.notice?.('Pending save discarded. Check History before repeating the change.');
      });
      c.queue = task.catch(error => { c.saved('Save failed', true); c.showError(error); });
      return c.queue;
    },
  });
  const commandClient = () => durableCommands ??= createLiveSwapCommandClient({ pickerId: c.panelContext?.pickerSession?.pickerId,
    fetch: (...args) => c.panelContext?.pickerSession ? c.panelContext?.pickerSession.fetch(...args) : fetch(...args), onRetry: event => {
    if (event?.status === 'paused') { c.saved('Save not confirmed', true); showSaveRetry(true); }
    else { showSaveRetry(false); if (event?.status !== 'confirmed') c.saved('Reconnecting… Confirming save', true); }
  } });
  c.panelContext?.pickerSession?.registerCommands({ pending: () => hasPendingCommand(), stop: () => { durableCommands?.stop(); recoveredForm = undefined; showSaveRetry(false); checks = []; } });
  const feedback = createCalculationFeedback({ show(text) {
    let node = c.$('calculation-status');
    if (!node && text) {
      node = c.el('span', undefined, 'status-detail'); node.id = 'calculation-status';
      node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
      document.querySelector('.connection-status').append(node);
    }
    if (node) { node.textContent = text; node.hidden = !text; }
  } });
  let checks = [], displayState, displaySource, displayChecks;
  function taskDisplayState() {
    if (displaySource !== c.state || displayChecks !== checks) {
      displaySource = c.state; displayChecks = checks;
      displayState = projectTaskState(c.state, checks);
    }
    return displayState;
  }
  function removeCheck(check) { checks = checks.filter(item => item !== check); }
  async function api(path, body, signal, commandOptions) {
    if (typeof c.panelContext !== 'undefined' && c.panelContext?.pickerSession?.stopped) throw Object.assign(new Error('The picker changed.'), { name: 'AbortError' });
    if (!c.canWrite() && (body !== undefined || /^\/api\/(?:predict|death-estimates|chunk-planning|training-plan|teleports)(?:[/?]|$)/.test(path))) throw new Error('This link is view only.');
    if (c.sandbox.active && body !== undefined && path !== '/api/sandbox/evaluate'
      && !(path === '/api/pool-ranking-intent' && body.visible === false)) throw new Error('Exit Sandbox before saving changes. Nothing here is saved.');
    const finishFeedback = feedback.begin(calculationLabel(path, body?.command, c.state, c.memberId, c.duoEnabled?.()));
    try {
    const baseline = c.state;
    // Any of these routes can return authoritative state, including conflicts
    // raised while preparing a review. Hydrated maps need its matching pool facts.
    const stateRoute = /^\/api\/(?:state|command|runemetrics\/(?:apply|preview)|original-sync\/preview|(?:restore|import|member-restore)(?:\/preview)?)$/.test(path);
    const requestPath = stateRoute ? `${path}?view=play-v1` : path;
    const durable = path === '/api/command' && body?.command?.type !== 'sync-original';
    const sent = durable ? await commandClient().send(body, { signal, ...commandOptions })
      : typeof body?.sendBackupRequest === 'function' ? await body.sendBackupRequest(requestPath, signal, (...args) => fetch(...args), (path, options, transport) => c.panelContext?.pickerSession
        ? c.panelContext.pickerSession.fetch(path, options, transport) : transport(path, options)).catch(error => {
        if (error.name !== 'AbortError' && !/\/preview$/.test(path) && !error.status) error.message = 'The save could not be confirmed. It may already have arrived. Check History before repeating the change.';
        throw error;
      }) : undefined;
    const { response, value } = sent ?? await readRequest(requestPath, body === undefined ? { signal } : typeof body.toBackupRequest === 'function'
      ? { ...await body.toBackupRequest(), signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }).catch(error => {
        // Reviewed imports and original-sync use one-shot preview tokens rather
        // than action receipts. Never encourage blind replay after a lost reply.
        if (body !== undefined && error.name !== 'AbortError' && !error.status
          && (/^\/api\/(?:runemetrics\/apply|restore|import|member-restore)$/.test(path) || path === '/api/command')) {
          error.message = 'The save could not be confirmed. It may already have arrived. Check History before repeating the change.';
        }
        throw error;
      });
    const provisionalTaskState = /^\/api\/tasks(?:\?|$)/.test(path) && typeof c.hasProvisionalTasks === 'function' && c.hasProvisionalTasks();
    if (!provisionalTaskState && path !== '/api/prediction-intent' && value.state && (response.status === 409 || /^\/api\/(?:state|command|runemetrics\/apply|restore|import|member-restore)$/.test(path))) c.stateIsPlayView = value.format === 'play-v1';
    if (!response.ok) {
      if (body !== undefined && [403, 409, 422].includes(response.status)
        && /^\/api\/(?:command|runemetrics\/apply|restore|import|member-restore)$/.test(path)) {
        c.saved('Change refused · review', true, undefined, { refused: true });
      }
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
      throw requestError(response, value);
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
    } finally { finishFeedback(); }
  }

  async function recoverPendingCommand({ retry = false } = {}) {
    try {
    const connectionMessage = commandClient().connectionMessage();
    if (connectionMessage && c.canWrite()) {
      c.saved('This address cannot save', true);
      if (!connectionNoticeShown) { c.notice?.(connectionMessage, true); connectionNoticeShown = true; }
      return;
    }
    const pending = commandClient().pending();
    if (!pending) { showSaveRetry(false); if (c.canWrite() && !c.sandbox.active) await commandClient().confirm({ lazy: true }); return; }
    if (commandClient().paused() && !retry) {
      c.saved('Save not confirmed', true); showSaveRetry(true);
      throw Object.assign(new Error('Your pending save is kept. Use Retry save to try again.'), { pendingCommand: true, retryPaused: true });
    }
    if (!c.canWrite() || c.sandbox.active) throw Object.assign(new Error('Restore save access and exit Sandbox to confirm the pending save.'), { pendingCommand: true });
    showSaveRetry(false);
    c.saved('Confirming pending save…');
    const response = await c.api('/api/command', pending, undefined, { retry });
    c.adopt(response.state, response.pools);
    c.saved('Saved', false, c.state.revision, { confirmed: true });
    const form = recoveredForm; recoveredForm = undefined;
    if (form?.requestId === pending.requestId) form.complete();
    if (retry) c.notice?.('Saved. Your pending change is confirmed.');
    } catch (error) { if (error.pendingCommand && !error.insecureConnection) showSaveRetry(true); throw error; }
  }
  function hasPendingCommand() { try { return Boolean(commandClient().pending()); } catch { return true; } }
  function pendingCommandPaused() { try { return commandClient().paused(); } catch { return false; } }

  function command(payload, reviewedRevision, reviewedNote, reviewCurrent, chunkPreview, onRecovered) {
    if (!c.canWrite()) return Promise.reject(new Error('This link is view only.'));
    if (c.sandbox.active) return c.sandbox.command(payload);
    const finishQueued = typeof c.panelContext !== 'undefined' ? c.panelContext?.pickerSession?.queueCommand() : undefined;
    c.lastSaveControl = document.activeElement;
    const check = payload.type === 'set-task-status' && typeof payload.challengeCompleted === 'boolean' ? { ...payload } : undefined;
    if (check) { checks = [...checks, check]; c.saved('Saving…'); c.renderTasks(); }
    const task = c.queue.then(async () => {
      if (typeof c.panelContext !== 'undefined' && c.panelContext?.pickerSession?.stopped) throw Object.assign(new Error('The picker changed.'), { name: 'AbortError' });
      await recoverPendingCommand();
      if (c.sandbox.active) throw new Error('Exit Sandbox before saving changes. Nothing here is saved.');
      if (reviewCurrent && !reviewCurrent()) throw Object.assign(new Error(reviewedNote !== undefined ? 'The note editor was closed or the selected player changed. Reopen the note before saving.' : 'The original-picker review was closed. Fetch and review again.'), { reviewAbandoned: true });
      const priorRevision = c.state.revision;
      const undoTarget = payload.type === 'undo' ? [...c.state.history].reverse().find(event => event.undo && !event.undoneRevision && (payload.undoRevision === undefined || event.revision === payload.undoRevision)) : null;
      // Chunk notes are outside task inputs, so the saving page keeps its list as for colours.
      const displayCommands = [...groupGoalCommandTypes, 'set-preference', 'set-chunk-colour', 'rename-chunk-colour', 'set-note', 'claim-task', 'clear-task-claim', 'prune-task-claims', 'set-rule-review', 'set-finish-line-item', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom'];
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
          if (error.pendingCommand && onRecovered) {
            const pending = commandClient().pending();
            if (pending) recoveredForm = { requestId: pending.requestId, complete: onRecovered };
          }
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
      c.saved(checks.length ? 'Saving…' : 'Saved', false, c.state.revision, { confirmed: true }); return response;
    }).finally(() => finishQueued?.()).catch(error => {
      if (typeof c.panelContext !== 'undefined' && c.panelContext?.pickerSession?.stopped) throw error;
      if (check) { removeCheck(check); c.renderTasks(); }
      if (chunkPreview) {
        c.removeChunkPreview(chunkPreview);
        c.renderMapState();
        error.message = error.insecureConnection ? error.message : error.pendingCommand
          ? `Chunk ${payload.chunkId} save needs confirmation. Its preview was reverted while the original request is retained. ${error.message}`
          : error.status === 409
          ? `Chunk ${payload.chunkId} was not saved because another save arrived first. The shared state is loaded; review the chunk and try again.`
          : `Chunk ${payload.chunkId} was not saved. Its preview was reverted. ${error.message}`;
      }
      throw error;
    });
    c.queue = task.catch(error => { if (typeof c.panelContext !== 'undefined' && c.panelContext?.pickerSession?.stopped || error.reviewAbandoned) return; if (error.pendingCommand && !error.insecureConnection) showSaveRetry(true); c.saved(error.insecureConnection ? 'This address cannot save' : error.retryPaused ? 'Save not confirmed' : error.pendingCommand ? 'Save confirmation needed' : 'Save failed', true, undefined, { refused: [403, 409, 422].includes(error.status) }); c.showError(error); });
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
    const finishQueued = typeof c.panelContext !== 'undefined' ? c.panelContext?.pickerSession?.queueCommand() : undefined;
    const reviewedMember = c.memberId, generation = c.dialogGeneration;
    const current = () => c.memberId === reviewedMember && c.dialogCurrent(generation);
    const task = c.queue.then(async () => {
      if (!current()) throw Object.assign(new Error('The RuneMetrics review was closed or the selected player changed. Open Activity Info and review a new preview.'), { reviewAbandoned: true });
      c.saved('Saving…');
      try {
        if (c.state.revision !== expectedRevision) throw Object.assign(new Error('Saved state changed.'), { status: 409 });
        const response = await c.api('/api/runemetrics/apply', { previewId, expectedRevision });
        c.adopt(response.state, response.pools);
        c.saved('Saved', false, c.state.revision, { confirmed: true });
        return response;
      } catch (error) {
        if (error.status === 409) error.message = 'Saved state changed. Fetch a new RuneMetrics preview and review it before applying.';
        throw error;
      }
    });
    const tracked = task.finally(() => finishQueued?.());
    c.queue = tracked.catch(error => { if (typeof c.panelContext !== 'undefined' && c.panelContext?.pickerSession?.stopped || error.reviewAbandoned) return; c.saved('Save failed', true); if (current()) c.showError(error); });
    return tracked;
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
    if (!c.compatibleTaskRevision(previousRevision)) c.planningResults.clear();
    if (!c.state.members.some(item => item.id === c.memberId)) c.memberId = c.state.members[0]?.id;
    if (previousMember !== c.memberId) { c.result = undefined; c.shownResult = undefined; c.closeDialog(); }
    if (reuseResult?.memberId === c.memberId) {
      clearTimeout(c.syncTimer); c.taskRequest++; c.taskController?.abort();
      c.result = { ...reuseResult, stateRevision: c.state.revision };
      c.$('task-engine-status').replaceChildren(c.el('span', `${c.taskEngineCount(c.result)}${c.advanced() ? ' · cached' : ''}`), ...(c.advanced() ? [c.button('Details', c.engineDetails)] : []));
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

  Object.assign(c, { api, readRequest, command, taskDisplayState, removeChunkPreview, toggleChunk, applyRuneMetrics, adopt, recoverPendingCommand, hasPendingCommand, pendingCommandPaused });
}
