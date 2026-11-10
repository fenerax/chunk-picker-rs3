# Owned backup closure: slice 4 (flag off)

No production caller or environment flag enables storage 2. Format-1 raw,
service, stopped backup, portable export and off-site paths retain their artifact
formats. A differential synthetic test compares raw captures, service captures
and stopped recovery trees byte for byte with `origin/main` (clocks fixed).
Storage-schema admission scans bounded chunks without retaining state values.
Format-1 dependency guards never parse the whole state or retained documents;
legacy stores in mixed service captures also skip owned dependency discovery.

An opted-in artifact adds `catalogue/` and `owned-closure.json`. The latter binds
owned store paths/IDs to the retained release base manifest. Discovery visits
current state, standalone retained documents, exact string-valued or object-valued
packed preimages, static fields and referenced History segments. Every referenced
base is verified against its dataset/hash pin, copied once, reverified at the
destination and synced before closure/manifest/complete publication. Dependencies
missing from a snapshot are refusals, never substituted from a newer release.
Existing format-1 documents inside an owned artifact keep their original bytes.
Portable schema-1 exports already inflate the full catalogue and History.

Capture-time semantic validation runs in `scripts/linux/probe.mjs` under the
selected release's sanitized probe environment. The probe hydrates every current
and retained document's referenced History, including packed preimages, and uses
the existing loader import/Undo validators on the merged events. Live capture
uses the same probe helper with its already-loaded release validators and registry.
Stopped backup probes an exact scratch copy. Capture refuses without a release
validation callback; `validateOwnedCapture` supplies it for stopped service capture,
or explicit owned options may provide `validateCapture`. No completion is published
until validation succeeds.

Capture-time byte pins in `owned-closure.json.files` record each owned store file,
binding and catalogue dependency's path, size and sha256, including every History
segment and static field. Capture checks these same pins after the probe returns,
then seals the manifest with `validated: true` before completion publication. A
probe or concurrent mutation cannot silently replace the validated inputs.

Detached verifiers and off-site checks remain release-free. They require the
sealed manifest, exact dependency inventory, sizes and hashes, gzip integrity and
document/History envelopes. They do not import the state validator or prove
semantic validity independently: they prove "identical to what was validated"
against the capture-time manifest. After restore installation, normal store open
still performs full validation under the selected release; that boundary is
unchanged.

Live owned stores register their capture source until writer ownership closes;
stopped capture/backup accepts explicit `ownedFormat2` options. Detached raw
captures carry their own source so online copying and subsequent stopped backup
do not need the live catalogue. A storage-2 document without a source or closure
cannot be published as a complete raw/service recovery.

Owned captures drain group writers before catalogue admission and retain both
barriers and catalogue leases through complete publication. Nested store admission
tracks active ancestors across the catalogue lease. Commands enter group admission
before catalogue admission, preventing a gated writer from holding the lease a
capture needs. Injectable capture steps cover base copy, dependency sync, closure
manifest and complete publication. Initial owned capture holds its barriers while
copying; the format-1 descriptor capture and its budgets remain unchanged.
Owned service `heldMs` spans outer barrier admission through completion-record
publication admission; response and completion persist the same measurement.
`globalBarrierMs` retains its registry-only meaning and format-1 timings are
unchanged. Injectable clock observations test barrier scope without timing values.

Recovery verifies the artifact before probing scratch copies, verifies all base
pins against the explicitly supplied target release manifest, then installs bases
before group references. Existing corrupt target bases refuse without replacement.
Service restore retains MP5's existing live external tombstone ledger and repeats
its reconciliation on resume; the artifact never supplies deletion authority.
Base installation leases use the persistent restore work directory, so recovery
can resume after legacy staging cleanup or re-enter a completed restore. Owned
portable probes apply the sanitized release environment before loading the store.
Raw owned restore additionally requires `assertRestoreAllowed(pickerIds)` from the
target deletion authority, before probes and immediately before installation.
That assertion must throw for deleted scopes; callers must hold stopped-service
ownership and fence concurrent deletion through installation.

Format-2 service publication pins the selected release pointer and capture time.
Off-site service selection requires explicit `settings.ownedFormat2`; the old
format-1 service refusal remains. Each selected owned snapshot carries its bases.
After remote restore, off-site delivery verifies the restored artifact's inventory
and dependency closure against the selected manifest before recording success.

Synthetic tests cover archived History/Undo and packed retained preimages, clean
restore, missing/corrupt dependencies, in-flight writers, injected capture failure,
live tombstone precedence, remotely restored closure and format-1 byte identity.
No real saves or archives are read. No base/static deletion or GC is added.
Explicit rebases, storage-1 rollback inflation/frozen-loader replay, calculator
transport/residency, browser negotiation and GC remain slices 5–9. Activation and
real-save migration remain unauthorized; the flag stays off.

Review acceptance additionally exercises probe refusal of null/invalid History,
capture-time dependency pins, post-validation mutation refusal, resumed restore
after legacy cleanup, outer barrier clock scope and a cold probe with conflicting
inherited dataset settings. Duration assertions check structure and clock-call
phases without expected timing values. Complete Linux/Windows multi-picker CI
receipts remain required before landing; that file is not rerun locally.
