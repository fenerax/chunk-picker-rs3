export const scopes = Object.freeze({
  diagnostic: Object.freeze({ platforms: ['linux'], runs: [1], finalClaim: false }),
  full: Object.freeze({ platforms: ['linux', 'win32'], runs: [1, 2, 3, 4, 5], finalClaim: true }),
});
export function acceptanceScope(value = 'diagnostic') {
  if (!Object.hasOwn(scopes, value)) throw new Error(`Unknown acceptance scope: ${value}`);
  return scopes[value];
}
export function scopeDecision(decision, scope) {
  const policy = acceptanceScope(scope);
  return { ...decision, gatePassed: decision.acceptanceClaim,
    acceptanceClaim: policy.finalClaim && decision.acceptanceClaim };
}
