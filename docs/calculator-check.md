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
- Before any engine merge to `main`: the full private corpus runs as N parallel
  shards in separate private-data Cloud tasks. Merge all N reports; only complete
  coverage with zero differences and zero errors passes.
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
and compressed expected results stay in that private directory and are deleted
when the pair closes. Reports contain only counts, metadata and hashes. Private
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

For a timed diagnostic of the first six states in corpus order, use the profiler
with the same checker arguments and caps:

```sh
node scripts/perf/calc-check-profile.mjs \
  --profile /tmp/calc-profile.json --first-states 6 -- \
  --reference 'node calculator/reference/main.mjs' \
  --candidate 'node calculator/reference/main.mjs' \
  --corpus save --data-dir /tmp/game --seed 17 \
  --report /tmp/calc-profile-report.json --serial true
```

Use the matching copied save, binding, packs and defaults described above.
Omit `--first-states` to profile the complete corpus. A prefix is diagnostic
sampling, never the full gate. Selection happens after corpus preparation so
that the profile includes its entire cost. The normal checker is unchanged.

The profiler writes numeric checkpoints every 30 seconds under the system
temporary directory. It separates cold requests, reordered/warm requests,
sequence priming, cancellation and uncancelled reruns by calculator. Warm means
reordered, not a guaranteed cache hit. It also records corpus stages, result
hashing, initialization and serial replay. Replay includes candidate requests
and hashing; corpus stages nest; these rows must not be added together.

On Linux, an independent thread samples aggregate process-tree RSS every 250 ms
and retains process-tree CPU counters across calculator restarts. Descendant
CPU includes fixture-preparation children when those are requested. Per-request
CPU counters have the system clock-tick resolution; wrapper descendants use the client's
process discovery. CPU totals include garbage collection and helper threads.
Wall time less main-thread CPU measures checker waiting, including calculator
waits, I/O and pauses, rather than whole-machine idle time. The profiler's own
small measurement cost is included. Runtime hooks fail closed when their source
anchors change; they never edit files or add calculator protocol fields.

Before parallel trials, inspect available/cgroup memory and CPU quota. Compare
required calculator CPU-seconds with the four-hour core-second budget; removing
checker overhead cannot remove the required calculator computations. A sampled
extrapolation is a capacity estimate, not evidence that the full corpus passed.
Keep all private run artifacts outside the checkout.


### Full private gate with shards

Run one shard per Cloud task, using identical inputs, seed, caps, sequence bound,
commands and shard count. Parallelism is across Cloud machines; each task can use
`--serial true` to keep only one calculator resident. For example, task 3 of 40:

```sh
node tools/calc-check/main.mjs \
  --reference 'node calculator/reference/main.mjs' \
  --candidate 'node calculator/reference/main.mjs' \
  --corpus save --data-dir /tmp/game --seed 17 --serial true \
  --shard 3/40 --report /tmp/shard-03.json
```

After limits are applied, states are ordered exactly as in the full manifest.
For zero-based state position k, shard `(k mod N) + 1` owns that state. This
interleaves earlier and later snapshots. Limits remain diagnostic sampling;
production gate commands omit them. Each shard runs cold comparisons, reordered
sequence checks, snapshot references, supersession and cancellation checks inside
that shard. Sequence checks do not cross shard boundaries. The request random
stream restarts from the recorded seed in each shard, so hold N fixed when
reproducing request selection.

Pick N to keep the slowest shard under 60 minutes: measure interleaved shards,
project from calculation time per state, add preparation and startup costs, and
leave headroom for variation. Every task inventories source hashes, but only its
assigned retained snapshots are normalized and loaded. Parsed static inputs are
reused, and normalized snapshots have a bounded two-state memory cache plus
compressed replay storage. Missing history revisions still require verified
reconstruction anchors to establish the complete inventory; this dependency
work is recorded, never replaced with guessed states or silently skipped.

Manifest version 2 hashes the full ordered inventory and bundle identities.
Save identities cover gameplay source bytes, including static/history/archive
inputs, without opening every normalized snapshot. Reports contain that full
manifest, its hash, seed, i/N, completed state IDs, engine versions, configuration,
request counts and differences. State IDs are hashes, not private save names.
Source-manifest hashes differ from the older normalized-snapshot manifest format.

Collect all N reports outside the public checkout and merge them:

```sh
node tools/calc-check/main.mjs --merge-reports /tmp/shard-*.json
```

The merger rejects missing/duplicate shards, gaps, overlaps, wrong shard ownership,
altered manifests, mismatched seeds, engines, shard counts or configurations, and
inconsistent counts, differing exclusions, and empty/no-comparison corpora. It
prints combined states, comparisons, per-type requests,
differences, errors, summed wall time and maximum shard wall time. A valid merge
still exits nonzero if any shard reports differences or errors. There is no
`--allow-partial`: two diagnostic shards cannot become a full-corpus passing gate.
Do not rewrite their shard metadata to manufacture coverage.


### EN4 slice measurements

START `a36e3c35a7c6e42dfa62eb2a713a4bd917d1ca16`; seed 17; default request caps,
sequence 8, reference against reference, serial calculators. Each Cloud task has
a four-core quota and a 16 GiB memory limit. Peak RSS below includes the checker
and its calculator, sampled every 250 ms.

The earlier first-six-state baseline took 3579.045 s, including 995.226 s corpus
preparation (824.097 s snapshot loading) and 770.245 s result hashing. The new
inventory covers all 414 states without normalizing unassigned retained states.
Inventory plus assigned snapshot loading is the preparation total below.

| Shard | States | Comparisons | Differences / errors | Wall s | Inventory s | Snapshot loading s | Aggregate peak GiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1/40 | 11 | 324 | 0 / 0 | 2898.382 | 5.298 | 26.072 | 7.082 |
| 21/40 | 10 | 292 | 0 / 0 | 3063.546 | 5.860 | 27.535 | 7.090 |

These slice measurements are not the full private gate. All 40 reports must
cover the complete manifest exactly once and merge successfully.

Both reports have full manifest hash
`cdf50309f628d6b676044135fb6063b185fc9b0e0d213cbb4224dd8be40760ba`.
Their 21 covered state IDs are disjoint.
The public diagnostic keeps all 120 comparisons and the same deliberately wrong
candidate differences, including their exact paths and hashes.

The two observed wall times have median 49.68 minutes
[48.31, 51.06]. Request/startup timers leave
154.2 s and 157.0 s outside calculator requests and initialization; these totals
include inventory, snapshot loading, comparisons and spooling. Result hashing
is zero on these matching runs; structural comparisons take
39.4 s and 41.5 s. Request timers include protocol transport and decoding.

At the slower measured per-state rate, after separating preparation, N=40
projects to 56.1 minutes for the largest 11-state shard. This is a two-slice
projection, not a bound on unmeasured shards. N=48 gives at most nine states,
projecting 46.0 minutes, or 55.2 minutes with 20% planning headroom.
All reports in a gate must use the chosen N consistently.

For a one-off bridge from a legacy normalized-input manifest, use the same
corpus specification, seed (taken from the baseline report), packs and defaults:

```sh
node scripts/perf/calc-check-normalized-parity.mjs \
  --baseline /tmp/legacy-report.json --corpus save --data-dir /tmp/game \
  --output /tmp/normalized-parity.json
```

This independently recomputes the old normalized-input fingerprint across every
collected state. It intentionally normalizes the full corpus once and is not
part of shard preparation. Its output contains only counts, hashes and timing.

The one-off private verification checked all 414 normalized inputs in
1113.319 s and reproduced START's legacy fingerprint exactly:
`3dd790107b683a29587f8651ef281b01fa520122ff1f1d586bc47519eddb5572` (0 differences).
This verifies input equivalence for the new reader, not calculator coverage of
unrun shards. Final checker tests: 11 pass, 0 fail; profiler smoke cases: 4 pass,
0 fail; public normalized-input verifier smoke: 1 pass, 0 fail.
