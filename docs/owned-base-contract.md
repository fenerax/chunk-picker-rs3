# Owned catalogue base: slice 1

`app/storage/owned-base.mjs` and `owned-base-schema.mjs` are standalone, inert
helpers. Nothing in startup, the store, imports or exports calls them. Existing
envelope/state and storage-1 behavior is unchanged; `legacy-shared` is untouched.
Storage schema **2** is reserved, with base reference `{datasetDigest,sha256}`.
Delta encoding, save decoding/writing and activation belong to later slices.

`buildOwnedBase` accepts only `{dataset:{id,contractVersion,digest},tasks,
identityRegistry}`: the catalogue projection of **fresh owned preparation from
pinned release inputs**, never a save or saved registry. Dataset-specific task
semantics remain the preparation caller's responsibility. No runtime provider,
clock, discovery, filesystem input or group state is consulted. Assignments,
custom task IDs, unresolved discoveries and extra projection/task fields refuse.
Potential generated goals remain outside the task array until registration.

Generator 1 writes the design's base-format-1 object as minified UTF-8 JSON,
without a newline. Root, dataset and registry header fields have fixed order.
Task order, task/entry property order, identity dictionary enumeration and alias
candidate order come verbatim from the ordered release projection. No sorting,
normalization or deduplication occurs. Inputs must be plain lossless JSON; the
returned base and pin are detached and deeply frozen. `bytes` is a caller-owned
Buffer. SHA-256 covers exactly those decompressed bytes, independently of gzip.

`createOwnedBaseManifest(pins)` returns `{schemaVersion:1,bases:{[datasetDigest]:
{dataset:{id,contractVersion,digest},sha256,generatorVersion}}}`. Duplicate digest
pins refuse, even when their hashes agree. A projection change needs a new
dataset digest. Retain this manifest independently with release inputs; a save
cannot supply its trust anchor. No production manifest or base is installed here.

`readOwnedBase` derives `catalogue-<sha256>.json.gz` from a manifest-matched base
reference, opens read-only/non-blocking (with no-follow where supported), checks
realpath containment and regular-file descriptor metadata, reads at most
32 MiB compressed plus one growth-detection byte, and bounds gunzip to 128 MiB.
It checks exact SHA-256, strict UTF-8, canonical bytes, schema, generator version
and all three dataset pins before returning a frozen base. Other bounds are
250,000 tasks, 500,000 identity entries, 1,000,000 aliases, JSON depth 32 and
4,000,000 JSON nodes (containers and scalar occurrences). Shape/cardinality
checks precede recursive walks; depth and remaining-node budgets bound each walk
and its key lists. The builder validates before its one detached copy; the verifier
freezes its validated parsed tree in place. Callers/tests may lower these limits,
never raise them. Special files, file changes, missing or corrupt bases refuse
with an exact-base repair diagnostic; nothing is rewritten
or repaired. There is no cache, publication, repair, lease or collection policy
in these helpers. Later storage slices own those operations and their fsyncs.

Synthetic tests cover deterministic bytes/order, immutable ownership, dataset
and release pin refusals, encoding/schema errors, bounded gzip reads and injected
containment/replacement failures. They read/write only owned scratch under `var/`.
