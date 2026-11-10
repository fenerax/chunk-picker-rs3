# Owned format-1 inflater: slice 6 (flag off)

`scripts/linux/inflate-owned-format-1.mjs` exports `inflateOwnedFormat1` and is an
explicit Linux operator command. No startup path, production job, environment
switch or ordinary command invokes it. `ownedFormat2` remains off by default;
the frozen rollback pin remains `06e15939dbf73ecd1a0e7bc9c29088e0281ca11e`.

The operator supplies service settings and independently retained base manifests,
including all older pins. The tool requires a deliberately stopped service,
holds the operator/registry/deletion locks, and takes kernel ownership of every
initialized owned tree and the catalogue root. Existing store lock/recovery
markers refuse. It scans the entire owned picker root, including retained trees;
it never selects the separate `legacy-shared` directory for conversion. Unknown
entries and nonempty trees without a current save refuse rather than silently
omitting a store. Dataset binding siblings are preserved unchanged.

Current state, standalone retained documents and string/object packed preimages
pass through the slice-4 closure reader and the slice-1 hash/pin verifier. Static
fields and archived History are resolved before validation. Outputs are schema-1
envelopes with full task rows and identity dictionaries, preserving logical root,
row, dictionary and candidate order. Group static fields are embedded too;
storage-2 metadata is removed. Compatible private receipts, coordination, plugin
metadata, retention labels/pins, optional envelope evidence and every opaque
sidecar file remain retained. No base, History, static file or original snapshot
is deleted. Compression bytes are outside logical identity.

Before any live replacement, every document passes complete logical-state and
ordered History/Undo SHA-256 comparison and opens through the actual pinned
release in the shared exact-SHA Git-worktree harness. Its loaded revision,
portable logical hash and History hash must match. The harness requires the
commit locally even on a cache hit, refuses dirty caches and fetches only from
the local repository. It never silently skips or fetches a remote release.
Format-1 command differentials check emitted embedded JSON bytes as well as
command/Undo/error behavior. Runtime format-1 and legacy adapters are untouched.

`control/inflate-owned-format-1/progress.json` records each source/output tree
digest, proof hashes and retained staging directory. Installation begins only
after **all** owned stores and retained documents are verified. Every resume
rechecks both retained tree digests, base pins/dependencies, conversion bytes and
the frozen loader, and accepts live files only when they match the source or
verified output digest. Same-filesystem atomic file replacements preserve live
file mode/ownership and sync before journal advancement. Crash points cover
maintenance, journal creation, source/output staging, frozen proof, per-store/all
verification, install intent/temporary/rename/file/store completion, final
completion and maintenance removal.

The existing `maintenance.json` gate contains **DO NOT START THE OLD RELEASE**
until all stores are installed and the journal says `complete`. A partial run
keeps that marker and all pre-conversion/output copies. Rerun explicitly with
the same settings and trust anchors; changed source/output bytes refuse and need
operator inspection. Do not clear the gate or use an old release's own start
script during reconciliation. The tool neither changes a selected release
pointer nor starts/stops the service. Completion alone does not authorize a
deployment or a real-save migration.

Accepted limits: staging/control and stores must share a filesystem; only the
service's normal `p_<32 hex>` owned directory layout is supported. A 64 MiB disk
reserve plus source/output/probe space is required through injected `statfs`
admission before staging; installation additionally admits its temporary space.
Missing/corrupt/wrong-pin dependencies or initial space refusal never replace
live source files. An interruption after installation starts may leave a mixture
of source/output files behind the maintenance gate, with complete original
copies retained; explicit resume finishes the verified output. Staging evidence,
including interrupted attempts and disposable frozen probes, is kept. Working
memory is bounded to one store's document/conversion plan, not a new residency
claim. Documents have a 256 MiB compressed/decompressed admission limit. Windows
directory sync has slice 3's existing best-effort limitation; Linux sync failures
are strict. External/manual starts and filesystem writes must stay fenced by the
operator throughout. No repair or arbitrary forward-version lowering is added.

Portable export already materializes tasks, identities and hydrated History
through the slice-3 codec/import worker; no export/runtime edit is necessary.
Synthetic acceptance includes portable export/import, post-slice-5 storage-only
rebase, archived guards, generated/custom/assigned/deleted tasks, packed backups,
metadata, dependency/space/lock refusals, process death and resumable installation.

Slices 7–9 still own calculator digest transport and pinned-dataset preparation,
retirement/display consumers, cache audit and 50-group residency acceptance (7),
negotiated browser catalogue responses and additive plugin checks (8), and
exclusive lease-protected base/static GC with retention/tombstone closure (9).
Activation, production jobs and real-save migration remain outside this slice.
