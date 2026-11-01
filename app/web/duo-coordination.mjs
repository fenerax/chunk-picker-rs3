import { describeHistoryEvent } from './history-text.mjs';

export function viewerOwnsEvent(event, viewer = {}) {
  const actor = event?.actor, own = viewer.actor ?? viewer;
  if (!actor) return false;
  if (actor.kind === 'master') return own.kind === 'master';
  if (actor.inviteId && actor.inviteId === own.inviteId) return true;
  if (actor.memberId && viewer.memberId) return actor.memberId === viewer.memberId;
  return !actor.inviteId && !actor.memberId && !!actor.label && actor.label === (viewer.label ?? own.label);
}

export function otherPlayerChanges(history, viewer, since, through = Infinity) {
  return history.filter(event => event.actor && event.revision > since && event.revision <= through && !viewerOwnsEvent(event, viewer));
}

// Tick bursts share a sentence, but a different action or author starts a new one.
export function changeSentences(events, lookups = {}, burstMs = 3000) {
  const groups = [];
  for (const event of events) {
    const actor = event.actor, prior = groups.at(-1);
    const tick = event.type === 'set-task-status' && event.command?.challengeCompleted === true &&
      Object.keys(event.command).every(key => ['type', 'memberId', 'taskId', 'taskLabel', 'requestedTaskId', 'category', 'challengeCompleted'].includes(key));
    const author = actor?.memberId ?? actor?.inviteId ?? `${actor?.kind}:${actor?.label}`;
    const target = event.command?.memberId;
    const time = Date.parse(event.at);
    if (tick && prior?.tick && prior.author === author && prior.target === target && time >= prior.time && time - prior.time <= burstMs) {
      prior.tasks.add(event.command.taskId); prior.time = time;
      prior.text = `${actor.label} ticked ${prior.tasks.size} ${prior.tasks.size === 1 ? 'task' : 'tasks'}${prior.forWho}`;
      continue;
    }
    const description = describeHistoryEvent(event, lookups);
    // History describes the action; keep its personal target when it differs from the author.
    const ownName = actor?.memberId ? lookups.memberName?.(actor.memberId) : actor?.label;
    const suffix = ownName ? ` for ${ownName}` : '';
    const action = suffix && description.endsWith(suffix) ? description.slice(0, -suffix.length) : description;
    const namedClaim = event.type === 'claim-task' || event.type === 'clear-task-claim';
    const text = namedClaim ? description : `${actor?.label ?? 'Your partner'} ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
    const targetName = target ? lookups.memberName?.(target) ?? target : '';
    const forWho = targetName && targetName !== ownName ? ` for ${targetName}` : '';
    groups.push({ text, tick, author, target, forWho, time, tasks: new Set(tick ? [event.command.taskId] : []) });
  }
  return groups.map(group => group.text);
}

export function catchUpChanges(history, viewer, since, lookups, limit = 5, through) {
  if (!Number.isSafeInteger(since) || since < 0) return { lines: [], more: false };
  const lines = changeSentences(otherPlayerChanges(history, viewer, since, through), lookups);
  return { lines: lines.slice(-limit), more: lines.length > limit };
}

export function seenRevisionKey(viewer = {}, members = []) {
  const own = viewer.actor ?? viewer;
  return `picker.last-seen:${members.map(member => member.id).sort().join(',')}:${viewer.memberId ?? own.inviteId ?? own.kind ?? viewer.label ?? 'viewer'}`;
}
export function readSeenRevision(storage, key) {
  try { const value = storage?.getItem(key); return value !== null && value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; } catch { return null; }
}
export function writeSeenRevision(storage, key, revision) { try { storage?.setItem(key, String(revision)); } catch {} }

export function createDuoCoordination({ canWrite = () => true, api, viewer, getState, lookups, el, button, openDialog, closeDialog, command, openHistory, undoButton, undoFocusFallback = () => undefined, ownHost, catchUpHost, liveHost, storage,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  const key = seenRevisionKey(viewer, getState().members), lastVisit = readSeenRevision(storage, key), openedRevision = getState().revision;
  let snapshot, processedRevision, loading, requested = false, initialized = false, liveEvents = [], liveTime = 0, liveTimer, metadataFailed = false;
  const document = undoButton.ownerDocument, view = document?.defaultView;
  let undoFocusPending = false;
  const cancelUndoFocus = () => { undoFocusPending = false; };
  const focusEvents = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'focusin'];
  for (const type of focusEvents) document?.addEventListener(type, cancelUndoFocus, true);
  view?.addEventListener('blur', cancelUndoFocus);
  const visible = node => node?.isConnected && !node.hidden && node.checkVisibility?.() !== false;
  function restoreUndoFocus() {
    if (!undoFocusPending) return;
    const active = document.activeElement;
    if (active && active !== undoButton && active !== document.body && active !== document.documentElement && active.isConnected !== false) { cancelUndoFocus(); return; }
    if (!canWrite() || getState().sandboxActive || !visible(undoButton)) { cancelUndoFocus(); return; }
    if (!current() && !metadataFailed) return;
    const target = undoButton.disabled ? undoFocusFallback() : undoButton;
    cancelUndoFocus();
    if (visible(target) && !target.disabled) target.focus({ preventScroll: true });
  }
  const current = () => snapshot?.stateRevision === getState().revision;
  const describe = event => describeHistoryEvent(event, lookups());
  const undoLabel = event => event ? `Undo: ${describe(event)}${event.actor?.label ? ` · by ${event.actor.label}` : ''}` : 'Undo';
  function historyLink() {
    const link = el('a', 'Open History'); link.href = '#history';
    link.addEventListener('click', event => { event.preventDefault(); openHistory(); }); return link;
  }
  function render() {
    const latest = snapshot?.latestUndo;
    const retry = metadataFailed && !current();
    undoButton.textContent = retry ? 'Retry Undo' : 'Undo';
    undoButton.hidden = !canWrite();
    // Capture before native disabling blurs the button. Revision protection stays intact.
    if (!current() && !metadataFailed && !undoButton.disabled && document?.activeElement === undoButton) undoFocusPending = true;
    undoButton.disabled = !canWrite() || getState().sandboxActive || (!current() ? !metadataFailed : !latest?.canUndo);
    // A short word in the toolbar; what it would undo is in the tooltip and the confirmation.
    undoButton.title = latest?.reason ? undoReason(latest.reason) : retry ? 'Retry Undo' : undoLabel(latest?.event);
    restoreUndoFocus();
    ownHost?.replaceChildren();
    const own = snapshot?.ownUndo, revision = snapshot?.stateRevision;
    if (canWrite() && current() && own?.canUndo && !getState().sandboxActive) ownHost?.append(button('Undo my last change', () => undo(own, revision), 'undo-own-action'));
  }
  function undoControl(onApplied) {
    if (!canWrite()) return el('span');
    const target = snapshot?.latestUndo, revision = snapshot?.stateRevision;
    const control = button(undoLabel(target?.event), async () => { if (await undo(target, revision)) { await refresh(); await onApplied?.(); } });
    control.disabled = !current() || getState().sandboxActive || !target?.canUndo;
    return control;
  }
  function ownControls(onApplied) {
    const host = el('div', undefined, 'duo-undo-options');
    const own = snapshot?.ownUndo, revision = snapshot?.stateRevision;
    if (canWrite() && current() && own) {
      if (own.canUndo) host.append(el('p', `Or undo your own last change instead: ${describe(own.event)}.`, 'status-detail'), button('Undo my last change', async () => { if (await undo(own, revision)) { await refresh(); await onApplied?.(); } }, 'undo-own-instead'));
      else host.append(el('p', `Your last change can’t be undone here. ${undoReason(own.reason)}`, 'status-detail'));
    }
    return host;
  }
  async function undo(target = snapshot?.latestUndo, reviewedRevision = snapshot?.stateRevision) {
    if (!canWrite()) return;
    if (!current() && arguments.length === 0) { await refresh(); return; }
    if (reviewedRevision !== getState().revision) throw new Error('Another change arrived. Review Undo again.');
    if (!current() || !target?.canUndo) { await refresh(); return; }
    const revision = snapshot.stateRevision, event = target.event;
    const apply = async () => {
      if (getState().revision !== revision) throw new Error('Another change arrived. Review Undo again.');
      await command({ type: 'undo', undoRevision: target.undoRevision }, revision);
    };
    if (event?.actor && !viewerOwnsEvent(event, viewer)) {
      const author = event.actor.label;
      let generation;
      const actions = el('div', undefined, 'duo-undo-actions');
      actions.append(button(`Undo ${author}’s change`, async () => { await apply(); closeDialog(generation); }, 'duo-undo-confirm'), button('Cancel', () => closeDialog(generation)));
      generation = openDialog(`Undo ${author}’s change?`, el('p', `${author} made this change: ${describe(event)}.`), actions, ownControls(() => closeDialog(generation)));
      return;
    }
    await apply(); return true;
  }
  function showCatchUp(value) {
    if (!catchUpHost || !value.lines.length) return;
    const heading = el('div', undefined, 'duo-catchup-heading');
    heading.append(el('h2', 'Since you were last here'), button('Dismiss', () => { catchUpHost.hidden = true; }));
    const list = el('ul'); for (const line of value.lines) list.append(el('li', line));
    catchUpHost.replaceChildren(heading, list, historyLink()); catchUpHost.hidden = false;
  }
  function showLive(events) {
    if (!liveHost || !events.length) return;
    const time = now();
    liveEvents = time - liveTime <= 3000 ? [...liveEvents, ...events].slice(-30) : events.slice(-30); liveTime = time;
    clearTimer(liveTimer);
    const text = changeSentences(liveEvents, lookups()).slice(-3).join(' · ');
    liveHost.replaceChildren(el('span', text), historyLink(), button('Dismiss', () => { liveHost.hidden = true; })); liveHost.hidden = false;
    liveTimer = setTimer(() => { liveHost.hidden = true; liveEvents = []; }, 10000);
  }
  function accept(value) {
    if (value.stateRevision !== getState().revision) return;
    snapshot = value; metadataFailed = false;
    if (!initialized) {
      showCatchUp(catchUpChanges(value.history, viewer, lastVisit, lookups(), 5, openedRevision));
      showLive(otherPlayerChanges(value.history, viewer, openedRevision, value.stateRevision)); initialized = true;
    } else if (value.stateRevision > processedRevision) {
      showLive(otherPlayerChanges(value.history, viewer, processedRevision, value.stateRevision));
    }
    processedRevision = value.stateRevision;
    writeSeenRevision(storage, key, value.stateRevision); render();
  }
  async function refresh() {
    requested = true;
    if (loading) return loading;
    loading = (async () => {
      while (requested) { requested = false; const value = await api('/api/coordination'); accept(value); }
    })().catch(() => { metadataFailed = true; render(); /* Retry Undo stays available without interrupting play. */ }).finally(() => { loading = undefined; });
    return loading;
  }
  function changed() { render(); if (!current()) void refresh(); }
  return { refresh, changed, render, undo, undoControl, ownControls, undoLabel, dispose() { clearTimer(liveTimer); cancelUndoFocus(); for (const type of focusEvents) document?.removeEventListener(type, cancelUndoFocus, true); view?.removeEventListener('blur', cancelUndoFocus); } };
}

function undoReason(reason = '') {
  if (/No reversible command/.test(reason)) return 'There’s no saved change to undo.';
  if (/guarded personal changes/.test(reason)) return 'Undo the newer change first to bring this one back.';
  if (/same player snapshot/.test(reason)) return 'A newer change replaced this player’s map.';
  if (/same saved value|Undo conflict/.test(reason)) return 'A newer change affects the same part of the save.';
  if (/active history/.test(reason)) return 'This change is no longer in recent History.';
  return 'A newer change affects the same part of the save.';
}
