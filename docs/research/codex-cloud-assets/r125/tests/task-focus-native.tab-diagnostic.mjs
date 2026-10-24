// Pure, closed DOM observations; no application input or focus changes.
export const TAB_PHASES = Object.freeze(['before-command', 'after-pending', 'after-tab', 'failure']);
export const TAB_ACTIONS = Object.freeze(['pending', 'press', 'locate-b', 'check-enabled', 'check-save', 'exhausted']);
export const ACTIVE_KINDS = Object.freeze(['target-a', 'target-b', 'other-task-checkbox', 'show-more', 'body', 'filter', 'dialog', 'other', 'unknown']);
export const PHASES = TAB_PHASES;
export const ACTIONS = TAB_ACTIONS;
const COUNTS = ['aCount', 'bCount', 'activeCheckboxCount', 'moreCount', 'requestGeneration', 'renderGeneration'];
const FLAGS = ['bPresent', 'bVisible', 'bEnabled', 'documentFocused', 'hideCompleted', 'showBlocked', 'showAll',
  'group', 'filterEmpty', 'ownerMatches', 'scopeSame', 'liveObserved'];
const bounded = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
export function projectTabRecord(value) {
  if (!value || !TAB_PHASES.includes(value.phase) || !TAB_ACTIONS.includes(value.action) || !bounded(value.index)) return null;
  const out = { phase: value.phase, action: value.action, index: value.index };
  for (const key of COUNTS) if (bounded(value[key])) out[key] = value[key];
  for (const key of FLAGS) if (typeof value[key] === 'boolean') out[key] = value[key];
  if (ACTIVE_KINDS.includes(value.activeKind)) out.activeKind = value.activeKind;
  return out;
}
export function instrumentTabTasks(source, instrumentTasks) {
  const original = instrumentTasks(source);
  const change = (text, before, after) => {
    if (text.split(before).length !== 2) throw Error('exact tab diagnostic source seam missing');
    return text.replace(before, after);
  };
  let result = change(original, 'export function createScreenTasks(c) {',
    'export function createScreenTasks(c) {\n  window.r125TabLive = () => ({ selectedMember: c.memberId, requestGeneration: c.taskRequest, renderGeneration: c.taskRenderGeneration });');
  result = change(result, 'scope: () => JSON.stringify([', 'scope: window.r125TaskScope = () => JSON.stringify([');
  return result;
}
// Serialized by page.evaluate. Every returned value is projected again in Node.
export function browserTabSnapshot({ a, b, owner, phase, action, index }) {
  const allA = document.querySelectorAll(a), allB = document.querySelectorAll(b), target = allB[0];
  const host = document.querySelector('#active-tasks'), active = document.activeElement;
  const more = [...(host?.querySelectorAll('button') ?? [])].filter(node => /^Show more Custom tasks/.test(node.textContent ?? ''));
  const live = typeof window.r125TabLive === 'function' ? window.r125TabLive() : null;
  const scoped = typeof window.r125TaskScope === 'function';
  const scope = scoped ? window.r125TaskScope() : undefined;
  if (phase === 'before-command' && scoped) window.r125TabScopeBaseline = scope;
  let activeKind = active === document.body ? 'body' : allA.length && active === allA[0] ? 'target-a'
    : target && active === target ? 'target-b' : active?.id === 'task-filter' ? 'filter'
    : active?.closest('dialog[open]') ? 'dialog' : more.includes(active) ? 'show-more'
    : active?.matches('#active-tasks input[type=checkbox]') ? 'other-task-checkbox' : active ? 'other' : 'unknown';
  const out = { phase, action, index, aCount: allA.length, bCount: allB.length,
    activeCheckboxCount: host?.querySelectorAll('input[type=checkbox]').length ?? 0, moreCount: more.length,
    bPresent: !!target, documentFocused: document.hasFocus(), activeKind, liveObserved: !!live };
  if (target) {
    const style = getComputedStyle(target);
    out.bVisible = target.isConnected && target.getClientRects().length > 0 && style.visibility !== 'hidden'
      && style.display !== 'none' && !target.closest('[hidden], [inert], details:not([open]), dialog:not([open])');
    out.bEnabled = !target.disabled;
  }
  for (const [id, key] of [['hide-completed', 'hideCompleted'], ['show-blocked', 'showBlocked'], ['show-all', 'showAll'], ['group-view', 'group']]) {
    const node = document.getElementById(id); if (node) out[key] = node.checked;
  }
  const filter = document.getElementById('task-filter'); if (filter) out.filterEmpty = filter.value.trim() === '';
  if (live) { out.ownerMatches = live.selectedMember === owner; out.requestGeneration = live.requestGeneration; out.renderGeneration = live.renderGeneration; }
  if (scoped && Object.hasOwn(window, 'r125TabScopeBaseline')) out.scopeSame = scope === window.r125TabScopeBaseline;
  return out;
}
const emitted = new WeakMap();
export async function captureTabSnapshot(page, criteria, emit) {
  let timer;
  const minimal = projectTabRecord(criteria);
  if (!minimal) return;
  const n = emitted.get(page) ?? 0;
  const selected = criteria.phase !== 'after-tab' || criteria.index <= 16 || (criteria.index & (criteria.index - 1)) === 0;
  // Sample every requested step, but emit at most64 records including failure.
  let projected = minimal;
  try {
    const value = await Promise.race([page.evaluate(browserTabSnapshot, criteria),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('tab observation timeout')), 1000); })]);
    projected = projectTabRecord(value) ?? minimal;
  } catch {} finally { clearTimeout(timer); }
  if ((selected && n < 63) || (criteria.phase === 'failure' && n < 64)) {
    emitted.set(page, Math.min(64, n + 1));
    try { emit(projected); } catch {}
  }
}
