// Feedback only: this never changes input availability or the command queue.
export function createCalculationFeedback({ show, delay = 1000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Set();
  function paint() { show([...pending].findLast(item => item.visible)?.label ?? ''); }
  return {
    begin(label) {
      if (!label) return () => {};
      const item = { label, visible: false };
      pending.add(item);
      const timer = setTimer(() => { if (pending.has(item)) { item.visible = true; paint(); } }, delay);
      return () => { clearTimer(timer); pending.delete(item); paint(); };
    },
  };
}

export function calculationLabel(path, payload, state, memberId, groupView) {
  const name = state?.members.find(owner => owner.id === (payload?.memberId ?? memberId))?.name ?? 'this player';
  if (/^\/api\/tasks(?:\?|$)/.test(path)) return groupView ? 'Updating tasks for both players…' : `Updating tasks for ${name}…`;
  if (path === '/api/predict') return `Calculating the chunk preview for ${name}…`;
  if (path === '/api/sandbox/evaluate') return 'Calculating Sandbox tasks…';
  if (path !== '/api/command') return '';
  if (['roll', 'random-start'].includes(payload?.type)) return `Calculating ${payload.count === 2 ? 'roll choices' : 'a roll'} for ${name}…`;
  if (['set-chunk', 'unlock-selection', 'unlock-both', 'pick-for-me', 'unpick'].includes(payload?.type)) return `Saving ${name}’s chunk and updating the roll pool…`;
  if (['set-rule', 'set-task-rule', 'reset-task-rule', 'set-profile'].includes(payload?.type)) return 'Saving rules and updating the roll pool…';
  if (payload?.type === 'set-task-status') return `Saving task progress for ${name}…`;
  if (payload?.type === 'undo') return 'Undoing the change and updating the picker…';
  return 'Saving changes and updating the picker…';
}
