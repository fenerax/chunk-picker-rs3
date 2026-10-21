// Resolve once at an entrypoint, then pass this boolean to execution and its
// receipt identity. Ambient environment never overrides an explicit policy.
export const retryPolicyIdentity = 'retry-once-in-fresh-isolation-default-on-v1';

export function resolveRetryPolicy(options = {}, manifest = {}) {
  const read = value => {
    const selected = ['retry-once-in-isolation', 'retryOnceInIsolation']
      .filter(key => value?.[key] !== undefined).map(key => value[key]);
    if (selected.some(item => typeof item !== 'boolean')) throw TypeError('Isolation retry policy must be boolean.');
    if (new Set(selected).size > 1) throw Error('Conflicting isolation retry policy.');
    const disabled = value?.['no-retry-once-in-isolation'];
    if (disabled !== undefined && typeof disabled !== 'boolean') throw TypeError('Diagnostic isolation retry override must be boolean.');
    if (disabled === true && selected[0] === true) throw Error('Conflicting isolation retry policy.');
    return disabled === true ? false : selected[0];
  };
  const explicit = read(options), configured = read(manifest);
  return explicit ?? configured ?? true;
}
