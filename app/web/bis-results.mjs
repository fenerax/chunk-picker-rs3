// Reuse the full results already loaded by Group view, task details or other
// panels. The duo detail loader shares any in-flight request and saved API cache.
export async function loadBiSMemberResult(screen, memberId) {
  if (screen.sandbox?.active) throw new Error('Exit Sandbox to compare saved gear.');
  const revision = screen.state.revision;
  const candidates = [screen.fullResult, screen.result, screen.duoDetails?.get(`${revision}:${memberId}`), screen.normalPlayResults?.get(memberId), screen.duoResultCache?.results().get(memberId)];
  const cached = candidates.find(value => value?.memberId === memberId && value.stateRevision === revision && value.currentBiS);
  const result = cached ?? await screen.ensureDuoDetails(memberId, false, false);
  if (screen.state.revision !== revision || result?.memberId !== memberId || result.stateRevision !== revision || !screen.state.members.some(member => member.id === memberId)) throw new Error('The saved gear changed while loading. Refresh Current BiS and try again.');
  return result;
}
