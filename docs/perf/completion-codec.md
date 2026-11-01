# Opt-in completion-array persistence

`RS3_COMPLETION_CODEC=1` enables compact completion-array writes in every store
opened by that process. The default is off. An explicit `completionCodec` boolean
on `openStore` overrides the environment. Game commands, pools, exact ordered Undo
guards, and every exposed History record keep their existing representation.
This is a storage optimization; it does not remove full inverse arrays from the
live gameplay graph or claim a calculator or HTTP speedup.

## Format and compatibility

The gameplay schema stays at 1. Encoded **backup envelopes** use schema version 2
and `completionArrays: { version: 1, entries: [...] }`. Existing code rejects that
envelope with its existing unsupported-backup-schema error before interpreting
the state. A version-1 envelope must not contain codec metadata.

Only `value` patches at the exact member path `['completedTasks']` are encoded.
Their before/after values reference an integer `completionArray` table index.
The table contains full ordered anchors or ordered splices with an earlier base
index, offset, exact removed IDs, inserted IDs, resulting length and SHA-256 of
the resulting JSON array. Decoding checks all keys, types, unique IDs, indices,
removed sequences, lengths and hashes before ordinary authoritative validation
and its exact stale-Undo replay. Forward references and unknown codec versions
are errors. Small arrays can remain anchors when a splice would be larger.

Each document contains all its own anchors, even after a history cut. There are
no references to earlier backups, archive segments, revisions or sidecar files
in the completion table. Ordinary static-field sidecars retain their existing
independent contract. Old full-array patches, member snapshots, and compact
leaves can coexist. The decoder runs before static hydration, migration, hooks,
command execution or public import validation. Nothing projects History away
from a command or special-cases completion commands in gameplay.

History archive segments remain in their existing full-array format. Hydration
and archive streaming are unchanged; they never require a codec anchor from a
different file. Retained backups and backup archive packs preserve the actual
versioned disk document and use the same decoder when read or verified. The
existing write queue, synchronized temporary-file replacement, pre-commit backup,
retention queue, claims metadata and action receipts remain authoritative.

Expansion is bounded to 256 MiB of completion-array JSON, including repeated
references, and 256 MiB of allocated table arrays. The encoder leaves an oversized
document in its legacy form rather than writing a compact file it cannot read.
Caches retain immutable source arrays weakly and never persist across documents.
The shared codec has a synchronous browser-safe SHA-256 implementation for the
existing synchronous import API. Storage supplies native Node hashing and UTF-8
byte counts. Cross-runtime tests compare their complete encoded documents,
including Unicode, JSON escaping and SHA block boundaries.

## Migration and rollback

The codec does not perform an eager format-only rewrite. With the switch enabled,
the next successful persistence encodes eligible active History. Existing startup
observations can also persist; ordinary commands preserve the preceding durable
document as usual. Opening version 2 works even with the switch off;
the next write then uses version 1. Interrupted commits retain the old durable
document and may leave an extra valid retained backup, as before.

Portable downloads, `store.backup` and `store.readBackup` always return expanded
version-1 envelopes with complete hydrated History. `exportBackup` preserves the
supplied validated state's History in an expanded version-1 envelope. Public
imports, uploaded restore previews, restore, initial imports and operator imports
accept the new envelope through decoding and normal validation.

For a binary rollback, export a portable backup with this version and restore it
into a fresh directory using the older binary. Merely disabling the switch does
not convert existing version-2 retained backups or backup archive packs. Keep the
original directory until the restored save has been checked. There is no bulk
in-place migration or deletion of existing backups.

## Reproduction and measurement

Run with Node 24.20 or newer, using an untouched START checkout as baseline:

```sh
node scripts/perf/completion-codec.mjs --baseline /tmp/start \
  --candidate "$PWD" --pairs 5 --out /tmp/completion-codec.json
```

The harness alternates pair order, starts a fresh process and default-retention
store for each run, executes actual complete-task/tick-active-tasks pairs, and
checks full authoritative state and exposed History hashes at 100, 250, 500 and
1000 distinct completions. Timings include revision checks, command execution,
retained gzip backups, synchronized writes and play-view response serialization.
Checkpoint `pairMs` is the upper median of the last ten command pairs (the sixth
sorted observation); the report then
gives the median and min/max of those values across five independent runs.
`totalMs` sums all command-pair timings through the checkpoint. Reloads,
comparisons, directory-size scans and final selected Undo are measured separately.
Process peak RSS is the operating system high-water mark, including reload and
comparison allocations. This is a real-store measurement without HTTP routing
or calculator work, not a server latency estimate.

Optional `--source`, `--packs` and `--defaults` arguments measure eight evenly
spaced retained states. The harness first copies the source into a disposable
directory, opens only the copy, and emits only counts, sizes, hashes, durations
and difference counts. The private sample measures cold encoding, decoding and
full import validation separately from synthetic durable-store timings. It also
compares Undo eligibility and, where available, exact Undo against START, with
both command costs recorded. It does not run calculators.

On START `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`, 1000 public synthetic
complete-task commands retain 1,000,000 inverse ID references and produce a
13,237,644-byte active state. The paired harness also ticks every completion,
so its state includes additional task-status and History records.

## Validation

Node 24.21.0; branch `perf/w15-completion-codec`; baseline is START above.
Final affected-file checks pass 213/0, and the unchanged Linux recovery file
passes 54/0. This includes eleven new codec tests, the browser dependency graph,
backup uploads, static sidecars, retention packs, killed/pre-commit writers,
claims, pending choices, receipts, concurrent revisions and exact selected Undo.
An actual START loader refuses version 2 with its unsupported-backup-schema error;
the expanded version-1 export loads on START with zero differences.

The full quick run reports **3021 passed, 1 failed, 68 skipped** (3090 tests).
The failure is `rule-explanations.test.mjs`, in the selected catalogue coverage
check. A standalone rerun and untouched START each report 3 passed/1 failed on
the same inputs. That unrelated test and its data were not changed. A preliminary
quick run exposed the browser dependency issue; the shared browser-safe codec
and native storage adapter fix it, and the final browser check passes. The Linux
release-copy fixture requires new files to be staged because it uses `git
ls-files`; its unchanged standalone rerun passes after staging. Full `npm test`
was not run, as instructed. Calculator results code is unchanged.

## Eight-state measurements

Eight inputs, eight exact codec/import matches, eight matching Undo eligibility
checks, seven available exact Undo matches, zero compared differences. Across
all inputs, JSON grows by 1161 bytes and gzip grows by 1473 bytes: five JSON
growths, six gzip growths, one JSON reduction, two unchanged inputs. These inputs
do not establish a storage win.

Values below are median [minimum–maximum] **across different inputs**, not
repeated timing trials of one input:

| Measurement | Result |
| --- | ---: |
| JSON bytes, before | 38,266,233.5 [3,300,433–54,382,966] |
| JSON bytes, after | 38,266,494.5 [3,300,433–54,382,822] |
| Gzip bytes, before | 5,557,645 [459,679–7,914,217] |
| Gzip bytes, after | 5,557,820.5 [459,679–7,914,317] |
| Cold table construction, ms | 0.43 [0.25–0.77] |
| JSON parse and expansion, ms | 138.65 [6.71–237.04] |
| JSON parse and full import validation, ms | 781.77 [44.77–1095.49] |
| Original Undo, ms, seven inputs | 829.36 [767.61–1287.79] |
| Candidate Undo, ms, seven inputs | 910.65 [751.95–1128.29] |

Table construction excludes JSON serialization. Decode and import are separate
operations; their times should not be added. Peak process RSS across the sample
run is 2,502,496,256 bytes (2386.6 MiB), including both reference/candidate modules,
expanded graphs, comparisons and Undo. No baseline-only memory comparison was
made for these inputs. This is not a memory improvement claim or a measured
bulk migration. The feature remains off by default.

## Five interleaved default-store pairs

All five runs per side reached all four scales. Twenty checkpoint comparisons
match the complete state and exposed History; all five final selected Undo and
reload comparisons match. At 1000 completions, both sides still expose exactly
1,000,000 inverse ID references. The fixture has one synthetic member, 1000 custom
tasks and an empty synthetic world; it runs no calculator. Every command uses the
real store, default retention, retained backups and synchronized disk writes.

Values are median [minimum–maximum] across five fresh processes per side.
Command-pair latency is the last-ten-pair upper-median statistic defined above,
then the ordinary median across five independent runs. It is not a median over
all commands. The complete raw measurements are in
[`completion-codec-results.json`](completion-codec-results.json).

| Completions | Command pair before, ms | Command pair after, ms | Cumulative commands before, ms | Cumulative commands after, ms |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 7.56 [7.23–7.57] | 7.99 [7.81–8.47] | 676.12 [659.34–693.84] | 740.74 [700.02–801.73] |
| 250 | 20.32 [19.72–22.78] | 15.23 [14.47–15.54] | 2841.10 [2788.84–2895.14] | 2598.56 [2514.65–2666.95] |
| 500 | 64.69 [64.00–71.12] | 34.88 [33.80–37.35] | 13695.74 [13605.80–14245.63] | 9174.46 [9096.72–9560.92] |
| 1000 | 231.36 [210.59–235.28] | 109.15 [107.35–110.07] | 85442.91 [83855.58–89653.95] | 45822.29 [45322.39–46221.31] |

All size measurements below have identical minimum, median and maximum across
the five runs. Gzip uses level 1, matching ordinary retained backup compression.
Disk bytes sum all files in the active store, including retained backups.

| Completions | State bytes before → after | Gzip bytes before → after | Summed disk bytes before → after |
| ---: | ---: | ---: | ---: |
| 100 | 257,816 → 158,199 | 12,862 → 16,789 | 2,099,280 → 2,462,705 |
| 250 | 1,029,416 → 308,949 | 35,008 → 31,413 | 9,564,552 → 9,886,089 |
| 500 | 3,615,419 → 560,202 | 114,902 → 54,212 | 47,286,793 → 31,579,055 |
| 1000 | 13,664,419 → 1,064,704 | 482,598 → 100,476 | 328,623,118 → 109,717,375 |

| Completions | Reload before, ms | Reload after, ms |
| ---: | ---: | ---: |
| 100 | 21.49 [15.46–25.34] | 19.19 [18.55–22.27] |
| 250 | 46.30 [42.53–54.58] | 55.48 [46.99–61.03] |
| 500 | 120.58 [111.70–173.88] | 129.75 [122.02–137.28] |
| 1000 | 388.19 [383.93–393.16] | 337.10 [327.50–346.76] |

Final selected Undo costs 122.17 [118.10–123.85] ms before and
108.16 [91.68–117.75] ms after. Whole-trial process peak RSS, including expansion,
full-state/History comparisons, reloads and Undo, is 723.6 [650.1–745.0] MiB before
and 576.3 [533.5–668.2] MiB after. These are cumulative process high-water marks,
not isolated incremental Undo allocations or a production capacity estimate.

At 1000 completions the persisted state shrinks 92.2%, summed disk files shrink
66.6%, and the command-pair statistic improves 52.8%. At 100 completions gzip
grows 30.5%, disk files grow 17.3%, and the command-pair statistic regresses 5.8%.
At 250 completions summed disk files still grow 3.4%. Reloads also regress at
250 and 500 completions. Live History continues to contain full arrays, and
portable export remains expanded. No HTTP, calculator, full-pack server latency,
or general memory improvement is claimed. The useful large synthetic-store win
supports an opt-in implementation; it does not justify default activation.
