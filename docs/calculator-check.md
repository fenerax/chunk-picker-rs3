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
- `timingMs`, `evaluationMs` and `cache` removed from result headers;
- inside parts, only the measurement fields named in
  `tools/calc-check/volatile.json` are removed. It starts with
  `metrics.elapsedMs` (wall-clock time, `app/tasks/engine.mjs`). Each entry
  names the source that makes it a timing or cache-state measurement. Nothing a
  player sees may be listed, and adding an entry is reviewed like a protocol
  change. Everything else is compared;
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

## How to run

Use Node 24.20 or newer. There are no dependencies to install. From the checkout
root, the small CI sample (including the deliberately wrong candidate) is:

```sh
node --test tests/calc-check.test.mjs
```

For a public generated game and the complete core unit-test fixture inventory,
save this specification outside the repository, for example in
`/tmp/calc-corpus.json`:

```json
{
  "generated": {
    "steps": 8,
    "definitionsFile": "tests/fixtures/transport/definitions.json"
  },
  "fixtures": {}
}
```

Then run:

```sh
npm run calc-check -- \
  --reference 'node calculator/reference/main.mjs' \
  --candidate 'node calculator/reference/main.mjs' \
  --corpus /tmp/calc-corpus.json --seed 17 --report /tmp/calc-report.json \
  --serial true
```

Replace the candidate command with the program being checked. Commands support
shell-style quoting but run without a shell; use an executable wrapper for
pipelines. The checker adds `--protocol 1`. The reference adapter accepts the
server's worker-data bundle; Map/Set values in the init world's topology can be
encoded as `{ "$calcType": "Map", "entries": [...] }` and
`{ "$calcType": "Set", "entries": [...] }`. States and result parts remain
ordinary JSON, including literal objects containing those keys.

`fixtures` discovers saved-state JSON recursively and harvests evaluator inputs,
validated states, command results and roll inputs from core unit tests. It uses
the repository's per-file dataset policy. Tests that require servers or workers
belong to integration coverage; their shared JSON fixtures are still discovered.
Missing fields in partial unit-test states receive empty saved-state defaults.
Global task-rule shorthand is applied to each member, and known task references
are registered from the matching catalogue. States without authored calculator
definitions receive a minimal world from their owned IDs. Getter/function test doubles are not serialized as pack data.
Capture runs every assertion in the selected test files and fails if a test
fails. Captured states load lazily and share definition bundles. The report
records inventory and state counts. For a repeatable local replay, `fixtures`
may name an existing `captureDir`; captured definitions and states are checked
against their SHA-256 hashes before use. Keep captures outside the public tree.

For a real save, select its packs and defaults before starting the checker:

```sh
export RS3_DATASET=duo-legacy
export RS3_PACKS_DIR=/absolute/path/to/packs
export RS3_GAME_DEFAULTS_FILE=/absolute/path/to/game-defaults.json
export RS3_TASK_WORKER_MODE=process
npm run calc-check -- \
  --reference 'node calculator/reference/main.mjs' \
  --candidate 'node calculator/reference/main.mjs' \
  --corpus save --data-dir /tmp/game --seed 17 \
  --report /tmp/calc-private-report.json --serial true
```

Supply the save's matching sibling dataset binding. The checker verifies the
binding and creates its own temporary gameplay-only copy before opening storage;
retention is disabled in that copy. It includes the current snapshot and retained
backup revisions, including archived backups. Missing history revisions are
rebuilt for deterministic leaf commands only when the recorded event matches;
a backwards reconstruction must also replay to the complete original snapshot.
Imports, random offers and unverifiable transitions remain reported gaps.
No authentication or operator files are copied. A JSON specification may combine
`save`, `generated` and `fixtures`; `save.gameDefaultsFile` can select the defaults
file instead of the environment variable.

For bounded diagnostics, a specification can include
`"limits": { "generated": 4, "fixtures": 2, "save": 2 }`. A capped save sample
always includes the current snapshot, then seeded earlier revisions. Such a
sample is not the full-corpus merge gate. Omitting limits checks every collected
state. Generated games exercise solo/duo starts, every registry rule value,
unlocks, completions, membership and death settings before sampling.

Request caps use `--cap-<request-type> N`:

| Type | Default | Meaning per state/member |
| --- | ---: | --- |
| `evaluate` | 2 | Both views, each with both duo projections |
| `predict` | 4 | Seeded eligible candidates |
| `death-estimates` | 8 | Candidates in one batch |
| `chunk-planning` | 2 | Seeded chunks |
| `sandbox` | 1 | Draft requests |
| `area-check` | 1 | Draft requests |
| `roll-pool` | 2 | Saved pool and draft pool |
| `prepare-rules` | 1 | Once for each distinct group rule set |

Zero omits a type from the corpus request mix; sequence priming still uses
`prepare-rules`. Prediction/death candidates come from the reference's pool; disabling pool requests leaves no candidate sample. `--sequence N`
(default 8) bounds reordered requests per batch; `--timeout-ms N` (default
180000) sets the progress watchdog.

`--serial true` runs one calculator at a time, recording the reference wire
sequence in a temporary directory and replaying the candidate. Request bodies
stay in that private directory; expected results contain only hashes. Private
and large-definition batches are bounded to two states, other batches to sixteen.
The default runs one calculator pair concurrently. Both modes resend missing
snapshots, rerun cancellations, exercise unrelated-picker supersession and
compare sequence results with cold results. Init requests omit the unused ready
catalogue to avoid materializing its large JSON representation.

Reports contain the seed, corpus manifest hash, advertised engine versions,
compared request counts, actual wire counts per calculator, differences, latency
medians/minima/maxima and sampled Linux peak RSS (including child processes).
Wire counts include priming and cancellation requests. Difference paths start with the part name; member slots
are zero-based. Dynamic dictionary keys are hashed in paths, while array indices
remain readable. Values never appear: SHA-256 value/tree hashes identify them.
Only the sourced entries in `volatile.json` are excluded; `cache.baselineSource`
stays compared. Exit status is zero only with no differences and no checker
errors. Keep private reports outside the public repository.
