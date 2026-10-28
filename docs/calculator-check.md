# Calculator check

A faster calculator that gives different tasks is worse than a slow one. This
check decides whether a candidate calculator may replace the reference.

## What it compares

The checker starts two calculators over `docs/calculator-protocol.md`: the
**reference** (the JavaScript worker through its adapter, at a pinned `main`
commit) and the **candidate**. It sends both the same init bundle and the same
request sequence, then compares every result part.

Comparison is exact after canonicalising each JSON part:

- object keys sorted; array order kept (order is what players see);
- `timingMs`, `evaluationMs` and `cache` removed; nothing else is ignored;
- numbers compared as JavaScript prints them (shortest round-trip form). A
  candidate in another language must format numbers the same way.

Error replies must match by kind. `cancelled` results are not compared; the
checker reruns those requests uncancelled.

A difference is reported as request type, member slot, a path inside the part,
and hashes of both values. Reports about private saves never print the values.

## Corpus

1. **Real saves.** The live duo snapshot from the private data repository, and
   earlier revisions rebuilt from its history where the history allows it, so
   each real unlock and completion becomes its own test state.
2. **Generated games.** Fresh solo and duo starts, random unlock and completion
   sequences from a fixed seed, rule toggles (including every rule in the
   registry at least once), the members switch, and death settings.
3. **Test fixtures.** Every state already used by core tests.

For each state the checker sends: `evaluate` for every member in both views and
both duo projections; `predict` for every roll-pool candidate (capped per state,
chosen by seed); `death-estimates`; `chunk-planning` for a seeded sample of
chunks; seeded `sandbox` and `area-check` drafts; `roll-pool`; and
`prepare-rules` for each rule set seen.

It also runs a short **sequence** check: the same requests in a different order,
with `state: "ref"` reuse and supersession, must give the same results as the
cold run. That catches caches that leak between revisions or pickers.

## When it runs

- Every engine pull request: the generated corpus and fixtures, in public CI.
- Before any engine merge to `main`: the full corpus, real saves included, in
  the private-data Cloud environment or on the operator's machine.
- Multiplayer merges run it in duo mode, reference against reference before and
  after the change, to prove the shared duo is untouched.

The seed, corpus manifest hash, both engine versions and the difference count
are recorded with every run. Zero differences is the only passing result.
