# Local data packs

Milestone 2 adds a packaging boundary for the existing `duo-legacy` dataset,
contract 1. It supplies the same definitions, overlays, identities, aliases,
rules, catalogues and provenance. The separate milestone 3
[independent starter game](independent-game.md) selects another provider at
startup. There is no public export, runtime dataset switch or pack-install
migration.

Private player/map defaults and the administrator label live in
`app/legacy-game-defaults.mjs`. Only the legacy provider or omitted legacy
storage configuration loads that module. Independent creation supplies fresh
defaults and the isolation check removes the private module entirely.
Its tracked members are placeholders. A real install sets
`RS3_GAME_DEFAULTS_FILE` to the absolute path of an untracked JSON file with
its own `members` (`id`, `name`, optional `mapId`) and `masterLabel`. Set it
for the profile build, release preflight and server alike, or the profile and
preflight disagree and the release stops.

With no data selection, the picker continues to use the tracked legacy inputs
and existing optional local metadata. An art-only selection keeps working.
Legacy map metadata follows the existing per-file order: explicit map root,
selected art pack, then tracked/local default. Once a **data** pack is selected,
its declared inputs own the metadata too; missing selected inputs never fall
back to tracked files or art-pack metadata.

In tracked mode, optional display metadata can still appear or be updated after
startup. Reads stay within the roots and art receipt chosen by that provider;
later environment or selection changes do not redirect them. The startup
digest, binding and builder snapshot stay fixed until restart. Packs freeze
both the bytes and the absence of optional metadata. A subsequent startup
recomputes the tracked digest if those metadata bytes changed.

## Build and select

Keep daily packs in an operator-owned directory outside the checkout. Use this
worktree's ignored `.local` only for disposable tests. Keep saves, invitations,
tokens and backups in their existing storage directory.

```powershell
node scripts/build-data-pack.mjs --source-root C:/path/to/private-checkout --packs-dir C:/path/to/picker-packs --version 1.0.0 --no-select
```

The builder creates both `duo-data/1.0.0/pack.json` and
`duo-rules-text/1.0.0/pack.json`. Every copied input retains its exact bytes,
including line endings. Existing canonical repository-text receipts remain
additional checks. Each manifest lists the byte count and SHA-256 of every
payload; `pack.json` is written last. Existing version directories are never
overwritten, including incomplete builds. Generated value indexes and
provenance are new JSON files, rather than normalized copies of source files.

Omit `--no-select` to build, validate and atomically select a new version:

```powershell
node scripts/build-data-pack.mjs --source-root C:/path/to/private-checkout --packs-dir C:/path/to/picker-packs --version 1.0.1
$env:RS3_PACKS_DIR = 'C:/path/to/picker-packs'
node app/server.mjs
```

`--selection C:/path/to/selection.json` chooses a custom receipt. Set
`RS3_PACK_SELECTION` to that same file in the server process. The default
receipt is `<packs-dir>/selection.json`; the default pack root is checkout-local
`.local/packs`. The receipt pins each selected manifest's exact hash:

```json
{
  "schemaVersion": 1,
  "data": { "id": "duo-data", "version": "1.0.1", "sha256": "<manifest hash>" },
  "rulesText": { "id": "duo-rules-text", "version": "1.0.1", "sha256": "<manifest hash>" }
}
```

Data and art builders preserve each other's selection fields. They retain exact
prior receipt bytes in `<selection>.previous`. Stop the server before changing
the selected receipt; restart and reload open pages afterwards. Installed
versions are never chosen by folder enumeration, dates or modification times.
There is no download, browser installer or folder watcher.

The builder freezes resource, Archaeology and shop switches from
`RS3_RESOURCE_CONTENTS`, `RS3_ARCHAEOLOGY_CONTENTS` and
`RS3_CACHE_SHOP_CONTENTS`. Selected packs use those frozen choices even if the
server's environment changes. `RS3_MAP_ASSETS_DIR` and `RS3_GAME_DATA_DIR` select
existing local metadata inputs when building. Absent optional pins or section
geometry are recorded as absent. Keep the input roots outside the output roots.

## Bind storage without changing a save

An operator receipt is a sibling of the storage directory:
`C:/path/to/duo.dataset.json` binds `C:/path/to/duo`. It contains only schema
`schemaVersion: 1`, `datasetId`, `datasetContractVersion` and `digest`. Binding
a selected pack also records `requiresPack: true`. It is outside the save,
command journal and backups.

```powershell
node scripts/bind-dataset.mjs --data-dir C:/path/to/duo --packs-dir C:/path/to/picker-packs
```

Add `--selection` for a custom selection receipt. This command validates the
selection, then creates the sibling binding. It does not open or read the save,
change its revision, migrate it, regenerate identities or change invitations.
An existing matching binding is retained. Explicitly binding a selected pack
promotes a matching four-field tracked binding atomically to `requiresPack: true`.
An existing different or malformed binding is refused. No receipt is created
or promoted automatically at normal startup. Existing four-field tracked
bindings remain valid; verification preserves their bytes.
A binding with `requiresPack: true` requires a selected data pack at startup,
even when tracked inputs have exactly the same ID, contract and digest. Losing
the selection receipt therefore cannot silently reopen that bound game with
tracked inputs; restore its pinned selection before starting the server.

A matching freshly built pack and tracked inputs have the same digest. The
digest includes input byte receipts, capabilities, contract and declared overlay
order; it excludes pack version, generated indexes and operator paths. Generated
indexes must also match their raw transcriptions. Back up the binding receipt
with the selected immutable packs and save backups. Moving storage requires
moving its sibling receipt too. Do not remove a binding to bypass a mismatch.
Linked storage folders, junctions and path aliases are rejected before opening
storage, so another path cannot bypass the physical folder's sibling binding.
Use the real storage directory when binding and starting the picker.

## Roll back and recover

After stopping the server, restore the prior selection deliberately:

```powershell
Copy-Item -LiteralPath 'C:/path/to/picker-packs/selection.json.previous' -Destination 'C:/path/to/picker-packs/selection.json'
node app/server.mjs
```

Retain both referenced pack directories and matching core code. A version with
different dataset bytes will also have a different binding digest. Restart with
the original pinned inputs to recover from a mismatch. Rebinding to different
gameplay data is a separate operator decision and migration design, outside
this milestone.

Selected data is validated before compiling worlds, creating workers or opening
and preparing storage. Missing payloads, bad pins/hashes, incompatible contracts,
invalid paths, malformed input JSON (including bounded gzip inputs), missing
required rules text or binding mismatches abort startup. Every selected input
is checked for JSON syntax before storage opens; parsed input trees remain lazy.
The data directory remains untouched. There is no silent alternate-catalogue
fallback. An absent receipt permits the tracked legacy provider, subject to any
existing storage binding. Missing artwork retains the art seam's fallbacks and
cannot change gameplay.

Settings → Advanced shows the data ID, version and integrity health beside the
art status. It shows no paths. Healthy means the selected bytes and compatibility
receipts passed validation; hashes do not establish authorship or redistribution
permission. Packs are immutable local inputs. Editing them while the picker is
running is unsupported.

## Implementation and verification

`app/datasets.mjs` is the provider boundary. `dataset-runtime.mjs` resolves one
core catalogue before dependent modules materialize their indexes; native,
process, lazy and restarted workers receive its pinned descriptor and digest.
Tracked descriptors carry a verified data-only snapshot of startup map
metadata, so later display updates or deletion do not redirect or prevent
worker restart. Builders still require the original startup files to be intact.
Each scheduler owns one dataset; its worker digest checks preserve that scope
while its existing request and warmup cache keys remain compatible.
Server constructor metadata overrides are accepted only when every non-local
core input and capability matches that bootstrap. To choose different core
inputs, set the selection before importing the application and restart.

`dataset-inputs.mjs` lists the complete legacy inputs. Former inline identities,
policies and rule values are exact transcriptions in the two
`legacy-*-values.2026-10-13.v1.json` files. No token was minted or registry row
renamed. Trusted algorithms remain in the app; copied `.mjs` files in a pack
are inert provenance evidence and are never imported, evaluated or served.
The three source snapshots in `docs/research/dataset-seam-source-2026-10-13`
preserve the bytes hashed by earlier immutable receipts. Those receipts keep
their original hashes; runtime values and behavior are checked separately.
Rule contracts/defaults/preset values belong to data. Captured wording and
presentation belong to rules text. Both must match the same rule-contract hash;
rules text cannot change defaults or preset values.
Rule parent links, scope and hierarchy also belong to the data contract.

`dataset-pipeline.mjs` declares the legacy preparation stages and avoids applying
already prepared base overlays again. Generic world/task constructors no longer
infer a provider from labels or counts, and generic engine defaults apply no
dataset overlays. Call them with the selected dataset for legacy behavior.
Authored parsers, mathematical formulas and generic RS3 skill/UI taxonomies
remain core algorithms, rather than copied catalogue inputs.

Run parity on the authorized disposable copy under the shared heavy lock:

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/dataset-parity.mjs
```

It builds a fresh test pack under this worktree's `.local`, runs tracked and
packed profiles sequentially, controls time/random inputs and compares task
order/status/IDs, aliases, sources, access and roll pools, BiS, transport,
training plans, rules and browser catalogue hashes. It exercises a normal
revision-checked command, History and Undo. Read-only startup must retain save
bytes, revision and gameplay migration. Scratch packs and save copies are
deleted in `finally`; the original save and its credentials are never changed.
The report includes sampled peak process-tree memory and lists the excluded
transient timing fields. No browser session is required for the Advanced line.

Both profiles start from the same frozen disposable capture. The expected
Advanced version change from `tracked` to the built pack version is asserted
separately, along with each profile's packed flag. Every other dataset status
field is compared.

The capture omits `store.lock`, `access-token` and aggregate `usage.json`.
Usage counts are operational telemetry whose event catalogue can differ
between parallel branches; the profiles use fresh usage storage. Gameplay
state, journal, static fields and backups retain their captured bytes. The
read-only byte check covers gameplay files; authentication files, invitations,
feedback and aggregate usage are separate operational storage. No gameplay
comparison field is excluded apart from the documented transient timings.

The completed milestone's parity, memory and test record is in
[dataset-seam-parity-2026-10-13.md](research/dataset-seam-parity-2026-10-13.md).
