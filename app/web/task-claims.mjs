import { resolveSavedTaskId } from '../tasks/fact-projection.mjs';

export function taskClaim(state, taskId, category) {
  return state.taskClaims?.[resolveSavedTaskId(state.identityRegistry, taskId, category)];
}

export function claimAge(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

/** One page clock updates visible age labels without repainting tasks or fetching facts. */
export function createTaskClaimClock({ document, window = document.defaultView, now = Date.now,
  setInterval = window?.setInterval?.bind(window), clearInterval = window?.clearInterval?.bind(window) }) {
  let timer, paused = false, disposed = false;
  const refresh = () => {
    const time = now();
    for (const node of document.querySelectorAll?.('.task-claim-time') ?? []) {
      const text = claimAge(node.dateTime, time);
      if (node.textContent !== text) node.textContent = text;
    }
  };
  const stop = () => { if (timer !== undefined) { clearInterval?.(timer); timer = undefined; } };
  const resume = () => {
    if (disposed || paused || document.hidden) { stop(); return; }
    refresh();
    if (timer === undefined && typeof setInterval === 'function' && typeof clearInterval === 'function') timer = setInterval(refresh, 60000);
  };
  const hide = () => { paused = true; stop(); };
  const show = () => { paused = false; resume(); };
  document.addEventListener?.('visibilitychange', resume);
  window?.addEventListener?.('pagehide', hide);
  window?.addEventListener?.('pageshow', show);
  resume();
  return { refresh, dispose() {
    disposed = true; stop();
    document.removeEventListener?.('visibilitychange', resume);
    window?.removeEventListener?.('pagehide', hide);
    window?.removeEventListener?.('pageshow', show);
  } };
}

/** A visible row action, shared by Group view and the personal list. */
export function appendTaskClaim({ document, host, task, taskId = task.id, getState, getMemberId, command, showError,
  canEdit = () => true, readOnly = false, actingForMember = () => false, completed = false, now = Date.now }) {
  const state = getState(), revision = state.revision, memberId = getMemberId(), claim = taskClaim(state, taskId, task.category);
  if (completed && !claim) return;
  const canAct = () => !!memberId && canEdit() && (!completed || claim?.memberId === memberId);
  const owner = state.members.find(member => member.id === claim?.memberId);
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const actor = state.members.find(member => member.id === memberId);
  const explicitMember = actingForMember();
  const takeoverLabel = explicitMember ? `Take over for ${actor?.name ?? 'this player'}` : 'Take over';
  const claimLabel = explicitMember ? `Claim for ${actor?.name ?? 'this player'}` : 'I’m doing this';
  const line = el('div', undefined, 'task-claim-line'), action = el('button', claim ? claim.memberId === memberId ? 'Stop doing this' : takeoverLabel : claimLabel, 'task-claim-action');
  action.type = 'button'; action.disabled = !canAct();
  action.setAttribute('aria-label', `${action.textContent}: ${task.label}`);
  action.dataset.owned = String(claim?.memberId === memberId);
  // An unclaimed task keeps the action quiet so long lists stay easy to scan.
  action.dataset.claimed = String(!!claim);
  if (owner) {
    const name = el('span', `${owner.name} is doing this`, 'task-claim-name');
    const when = el('time', claimAge(claim.at, now()), 'task-claim-time');
    when.dateTime = claim.at; when.title = new Date(claim.at).toLocaleString();
    line.append(name, when);
  }
  if (!readOnly) line.append(action);
  if (line.children.length) host.append(line);
  const apply = async takeover => {
    if (!canAct() || getMemberId() !== memberId || getState().revision !== revision) throw new Error('The player or saved task list changed. Try this task again.');
    action.disabled = true;
    try { await command({ type: claim?.memberId === memberId ? 'clear-task-claim' : 'claim-task', memberId, taskId, ...(takeover ? { takeover: true } : {}) }, revision); }
    catch (error) { action.disabled = !canAct(); throw error; }
  };
  action.addEventListener('click', async () => {
    try {
      if (!canAct()) return;
      if (!claim || claim.memberId === memberId) return await apply(false);
      if (line.querySelector?.('.task-claim-confirm')) return;
      const confirm = el('div', undefined, 'task-claim-confirm');
      const take = el('button', takeoverLabel, 'primary-action'), cancel = el('button', 'Cancel'); take.type = cancel.type = 'button';
      confirm.append(el('span', `Take over from ${owner?.name ?? 'your partner'}${explicitMember ? ` for ${actor?.name ?? 'this player'}` : ''}?`), take, cancel);
      cancel.addEventListener('click', () => { confirm.remove(); action.focus?.(); });
      confirm.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); } });
      take.addEventListener('click', async () => { take.disabled = true; try { await apply(true); confirm.remove(); } catch (error) { take.disabled = false; showError(error); } });
      line.append(confirm); take.focus?.();
    } catch (error) { showError(error); }
  });
  return line;
}
