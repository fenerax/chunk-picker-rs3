# Owned backup closure: slice 4 (flag off)

No production caller or environment flag enables storage 2. Format-1 raw,
service, stopped backup, portable export and off-site paths retain their artifact
formats. A differential synthetic test compares raw captures, service captures
and stopped recovery trees byte for byte with `origin/main` (clocks fixed).

An opted-in artifact adds `catalogue/` and `owned-closure.json`. The latter binds
owned store paths/IDs to the retained release base manifest. Discovery visits
current state, standalone retained documents, exact string-valued or object-valued
packed preimages, static fields and referenced History segments. Every referenced
base is verified against its dataset/hash pin, copied once, reverified at the
destination and synced before closure/manifest/complete publication. Dependencies
missing from a snapshot are refusals, never substituted from a newer release.
Existing format-1 documents inside an owned artifact keep their original bytes.
Portable schema-1 exports already inflate the full catalogue and History.

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

Recovery verifies the artifact before probing scratch copies, verifies all base
pins against the explicitly supplied target release manifest, then installs bases
before group references. Existing corrupt target bases refuse without replacement.
Service restore retains MP5's existing live external tombstone ledger and repeats
its reconciliation on resume; the artifact never supplies deletion authority.
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

Local synthetic acceptance passes all ten cases, including actual missing-source
service refusal and owned hold-duration fields in both response/completion JSON.
Duration assertions check structure, presence and type without timing values.
The acceptance file passed after one fixture-directory fix and one rerun in the
completion round. The existing service regression file was not rerun locally;
its complete Linux/Windows CI receipts remain required before landing.
