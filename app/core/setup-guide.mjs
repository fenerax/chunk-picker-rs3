// First-time setup guide: when it is offered, and the saved per-player
// preference that keeps it dismissed once finished or skipped.
export const SETUP_GUIDE_PREFERENCE = 'setupGuide';
export const SETUP_START = 'setup-start';
export const setupGuideSettingDefinitions = Object.freeze([Object.freeze({
  id: SETUP_GUIDE_PREFERENCE, type: 'enum', options: Object.freeze(['open', 'finished', 'skipped']), default: 'open',
  label: 'First-time setup guide', description: 'Whether this player finished or skipped the setup guide.',
})]);

/** A save is new while nobody has an unlocked chunk or a roll waiting. */
export function isNewSave(state) {
  const members = state?.members ?? [];
  return members.length > 0 && members.every(member => !member.unlocked?.length && !member.pendingRoll?.length);
}

export function setupGuideDismissed(preferences) {
  return ['finished', 'skipped'].includes(preferences?.[SETUP_GUIDE_PREFERENCE]);
}

/** Only members of a new save see the guide by themselves; viewers never do. */
export function shouldOfferSetupGuide({ state, canWrite, sandbox = false, preferences }) {
  return canWrite === true && !sandbox && isNewSave(state) && !setupGuideDismissed(preferences);
}

/** Players who still need a start: an empty map and no roll waiting. */
export function membersNeedingStart(state) {
  return (state?.members ?? []).filter(member => !member.unlocked?.length && !member.pendingRoll?.length);
}

/** Each waiting player draws from the reviewed F2P starting-bank list. */
export function setupStartPools(data, state) {
  const banks = Array.isArray(data?.optionAF2PExtension) ? data.optionAF2PExtension : [];
  return membersNeedingStart(state).map(member => ({ memberId: member.id, banks }));
}
