// Disposable calculator artifacts never participate in persistent identity.
// Credentials, account/provider records, invitations and opaque sidecars do.
export const STORE_IDENTITY_EXCLUSIONS = Object.freeze(['warm-store']);
export const SNAPSHOT_EXCLUSIONS = Object.freeze(['store.lock', 'store.lock.recovery', ...STORE_IDENTITY_EXCLUSIONS]);
