# Remaining service residency gaps

The opt-in `budget-672` managed cache budget covers `createResponseCache` owners, scheduler results,
worker snapshot/eligibility caches, parsed engines and input snapshots. It is
not a hard bound on every allocation in the running service. History remains
unbounded for the reasons in [the History design note](f2-history-residency-design.md).
Saved viewer results still need a global bound before claiming a complete
production service budget or certificate. Installed bases are covered by the
opt-in input allocation below. The default profile preserves the existing live
caps; global responses and engine/input byte dimensions are report-only. See
the [profile cap table](owned-acceptance-contract.md).

## Saved viewer task results

`picker-context.mjs` retains `savedTaskResults` separately from
`createResponseCache`: at most eight results, 32 MiB of compact projections and
16 MiB of full gzip bytes per group. Those local caps do not consume the new
global response allocation. The plugin can also keep references to play bytes.

Ordinary pressure eviction is incompatible with the current viewer contract.
`readSavedTasks` returns `TASK_RESULTS_UNAVAILABLE` or `TASK_DETAILS_UNAVAILABLE`
with status 409 when these bytes disappear. Viewers deliberately do not wake a
calculator. The bytes also feed claim cleanup and plugin replies. Connecting
this Map to a global eviction callback would change replies and possibly claim
cleanup timing; this change does not do that.

A compatible follow-up needs a bounded resident byte cache over exact disk
preimages, preserving the existing read-only behavior, metadata, revision
rebinding, gzip identity, conditional headers and plugin consumers. It must
address disk failure and cleanup without silently converting ready replies to
409s or retaining uncapped fallback buffers. Its tests must compare every
affected reply, event and save with eviction disabled and forced.

These known local allowances add 48 MiB/group: 4,800 MiB at 100 groups and
24,000 MiB at 500 groups. Thus the identified bounded subtotal beyond the
synthetic harness is at least 5,472 MiB + B at 100 groups and 24,672 MiB + B at
500 groups. Other roots and unbounded History are additional. These are charge
allowances, not additive V8 heap attribution; plugin aliases must not be charged
again when the same backing is retained by both consumers.

## Installed calculator bases: included in the input allocation

`createOwnedCalculatorReceiver` keeps verified bases outside `stateSnapshots`.
In the budget profile it has its own two-entry and graph-byte cap: half of the input allocation,
with the other half reserved for snapshots. Both ledgers enter the census.
Oversized bases decode the current request without retention. Eviction hints
invalidate scheduler and physical-pool installation hints so a later request
resends its exact base. This root is no longer a missing ledger.

## Scope of the current evidence

The acceptance fixture retains stores and its own response caches; it does not
instantiate production picker contexts, viewer result Maps or plugin consumers.
Its numeric known subtotal is the managed 672 MiB plus fixed engine inputs B.
That is a scoped subtotal, not a complete production projection. History and
saved viewer results prevent a production certificate. No acceptance gate is waived.

Decision reference: owner decision, 2026-11-11.
