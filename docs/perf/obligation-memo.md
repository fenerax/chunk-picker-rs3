# Conservative obligation memo

Each evaluation pass memoizes obligation booleans while capability evidence is
unchanged. A proof includes a 256-bit conservative fingerprint of every task
read below it, including failed cycle guards and reused child proofs. A caller
can reuse a proof only when its visiting path has no overlapping bits. A proof
is published only when its reads do not overlap its original caller path.
Hash collisions therefore decline reuse; they cannot hide a real intersection.

The cache keeps at most 4096 proofs and 32768 deterministic key masks. Evicting
a mask does not change its recomputed bit. The fingerprint payload is 256 bits;
Map entries, objects and BigInts have additional heap overhead. Source additions,
ownership/primary promotions, new owned task keys and access refresh rounds
clear proofs. Each evaluation/replay gets a new cache. `reuseObligations: false`
provides the cold oracle without changing the task/source model.

Three alternating single-worker trials reduced median cold evaluation from
3.52 to 3.22 seconds at one chunk and 2.60 to 2.24 seconds at ten chunks. At forty
chunks it was 1.85 versus 1.86 seconds, within the trial spread. In the worker CPU
profile, obligation computation fell from 2.805 to 1.836 seconds; the memo's own
bookkeeping remains a cost. Profiled timings are excluded from the trial medians.

An earlier exact-Set footprint prototype was rejected because its bookkeeping
slowed unlock. Tests compare this bounded fingerprint version with an uncached
graph, force collisions, retain cycles and shared producers, invalidate evidence,
and evict key masks while older proof footprints remain. Complete-calculation
oracles cover both owners, growth/retraction, source gates, completion and all
projections against a fresh engine with both reuse layers disabled.

After the transport and metadata changes, three alternating full-scenario trials
reduced median Rules preview from 6.88 to 5.76 seconds and unlock through both
refreshed lists from 3.86 to 3.51 seconds. The complete normalized responses match
the baseline. Memory is reported separately; these speed gains are not evidence
of lower RSS.
