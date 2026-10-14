// Shared declarations stay small so the screen does not load the identity
// catalogue before someone chooses a picker item.
export const groupGoalCommandKeys = new Map([
  ['add-group-goal', new Set(['type', 'goalId', 'text', 'completion', 'link'])],
  ['update-group-goal', new Set(['type', 'goalId', 'text', 'completion', 'link'])],
  ['move-group-goal', new Set(['type', 'goalId', 'index'])],
  ['set-group-goal-done', new Set(['type', 'goalId', 'memberId', 'done'])],
  ['remove-group-goal', new Set(['type', 'goalId'])],
]);
export const groupGoalCommandTypes = Object.freeze([...groupGoalCommandKeys.keys()]);
