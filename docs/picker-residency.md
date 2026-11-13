# Picker residency and opening

The router reserves an entry per owned picker in a short global bookkeeping
operation. Opening entries count against residency capacity; published entries
alone count as open contexts in service health. The context factory runs outside
that global queue under the existing cold-start admission permits. Authorized
requests for the same picker share its factory and one cold permit, including
requests from other accounts. Each request keeps its existing pending charge
and deadline. Joining does not consume another factory permit.

A cancelled or expired request detaches from the opening. Other waiters keep it
alive. When an unpublished opening's last waiter leaves, that generation is
fenced until its factory and late close settle. Started cold permits remain
held through that drain.
Initialization and publication enter the directory's checkpoint barrier
separately, so a checkpoint arriving during initialization completes before
publication. Publication rechecks shutdown, lifecycle and deletion fences.
Disconnecting after publication leaves a usable idle resident under the normal
idle-close policy.

Optional rule preparation starts after publication and outside the opening and
checkpoint barriers. Requests can use the context while preparation waits or
fails. Its context still tracks preparation through close, retaining the store's
writer lock until accepted work and sidecars drain. Capacity eviction, idle
close, deletion and shutdown reserve/fence their entries before draining outside
the global queue. An entry whose close fails remains fenced.

## Open diagnostics

The optional `multiPicker.onContextOpen` observer receives separate receipts
for `phase: factory`, `prepare` and `close`, correlated by `pickerId` and a
process-local `openId`. `completed`/`failed` remain factory statuses;
`prepared`/`prepare-failed` and `closed`/`close-failed` identify later phases.
Count factories by phase rather than the number of observer calls. A successful
factory receipt precedes router publication and does not prove that a waiter
ultimately acquired the context.

`totalMs` measures the receipt's phase. `timingMs` is a snapshot of accumulated
subphase measurements. Factory receipts add `factoryMs` to the existing dataset,
store, retention, sidecar and fingerprint fields. Preparation adds `prepareMs`,
`rulePrepMs` and, when enabled, `stateResponsePrepMs`. Close adds `closeMs`,
`closeStoreDrainMs`, `closeRequestsMs`, `closeMutationsMs`,
`closePreparationMs`, `closeSidecarsMs`, `closeJobsMs` and `closeStoreMs`.
`closeStoreMs` includes storage drain and final unlock, excluding the context's
`beforeUnlock` callback. Memory deltas remain relative to the factory's initial
probe and describe the shared process, including overlapping work and GC.
