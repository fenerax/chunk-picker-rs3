# Repository provenance hashes

Repository text identities use SHA-256 after replacing CRLF pairs with LF.
`scripts/lib/provenance-hash.mjs` provides `sha256RepositoryText` for these
inputs and `sha256` for exact bytes. Lone CRs, BOMs and all other bytes remain
unchanged. Callers choose the scope explicitly; filename extensions alone do
not identify a repository input.

The October 8, 2026 audit covers every current repository-file identity found
in `app/data/**` and `docs`. Its JSON pointers and source files are retained in
[the test inventory](../tests/helpers/repository-provenance.mjs). The full
suite checks 159 hashes across 32 JSON artifacts, repeated transport witnesses, the entry
policy constant, and current resource/walkability documentation hashes.

The equipment-permanence bundle adds the reference, builder, Wiki parser and
classification loader to this inventory. Its copied-cache and pinned Wiki
snapshot hashes retain exact external bytes.

| Recorded inputs | Hash scope |
| --- | --- |
| Retained export, generators, classification code, committed corrections, catalogues, pin inputs, category reports and reproduction sources | Repository text, canonical LF |
| `.local` JSON exports/manifests, copied cache databases, compressed exports, archives, decoder/schema sources, Wiki responses/snapshots/content, PNGs and downloaded map assets | Exact external bytes; unchanged |
| Pin `inputSha256`/`wikiSha256`, merged pin `transportRoutesSha256`, equipment row fingerprints, resource morph-branch fingerprints | Existing `JSON.stringify` or subtree semantics; unchanged |
| Source snapshots in `reference-comparison.md` and `research/map-data-audit.md` | Historical inspected bytes; unchanged |
| Recorded saved-game/captured-payload fingerprints | Existing payload identities; unchanged |

Three original identities came from CRLF copies: the surface-corrections
JSON and the F2P/interiors transport segment JSON. Their consumers now bind
the LF content. The source data itself did not change.

The original hash audit changed only hash values in the following files. The
[archive layout](archive-layout.md) records later file relocations; archived
connections and pin-details v1 now live under `archive/data/`.

| File (under `app/data/` unless qualified) | Reason |
| --- | --- |
| `cache-resources.2026-10-08.v1.json` | LF surface-corrections identity and updated generator identity |
| `cache-resource-selectors.2026-10-08.v1.json` | Updated resource catalogue identity |
| `map-pin-details.inputs.2026-10-08.v1.json` | Updated resource catalogue identity |
| `map-pin-details.2026-10-08.v1.json` | Updated resource source, structured input fingerprint and generator identity |
| `map-connections.2026-10-08.v1.json` | LF corrections identity, updated pin details and generator identities |
| `transport-routes.2026-10-08.v1.json` | LF F2P/interiors segment identities |
| `map-connections.2026-10-08.v2.json` | Updated baseline and transport identities |
| `map-pin-details.2026-10-08.v2.json` | Updated baseline identities and structured transport fingerprint |
| `docs/research/cache-equipment-corrections.2026-10-08.v1.json` | Updated equipment generator identity |
| `equipment-corrections.2026-10-08.v1.json` | Updated equipment review identity |
| `item-icons.2026-10-08.v1.json` | Updated equipment review identity |
| `docs/research/cache-game-data.2026-10-08.v1.json` | Updated importer, shared game-data code and report generator identities |
| `docs/research/cache-resources-application.md` | Updated catalogue and selector identities |

Rebuild order was resources → selectors → captured pin inputs → pin details
v1 → map connections v1; components → transport routes → connections/pins v2.
The existing generators reproduced these datasets. Historical map-input path
labels were retained while reading this worktree's files. Transport components
regenerated identically and required no changes. The aggregate game-data
generator also reproduced its report with the original timestamp retained.

The retained equipment review's implementation hash was refreshed directly,
then its bundle and icon-manifest consumers were updated. Repeating that
research/export workflow would require its out-of-scope Wiki snapshot and
would refresh research timestamps or download assets. No research decisions,
external identities, timestamps, coordinates, routes, counts or source labels
were changed. The metadata bundle generator reproduced its unchanged output.

Verification against base commit `83a8428` recursively removed only keys
containing `sha256` from JSON before deep comparison. Existing Markdown was
compared after replacing its 64-digit SHA-256 values. Both comparisons showed
zero other differences. The changed JSON contains 26 updated hash fields;
the resource documentation contains two updated hashes. Every changed JSON
hash also matches the inventory or an explicitly retained dependent object
fingerprint; no external or unclassified hash changed.

The CRLF verification uses a detached temporary worktree inside the dedicated
worktree's `.local/lfhash/`. Its attributes are replaced with `* text=auto`,
then its staged snapshot is checked out using `core.autocrlf=true` and
`core.eol=crlf`. Both checkouts run the full `npm test`; the temporary worktree
is removed after verification. The main checkout and running pickers are
outside this workflow.

| Checkout | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| LF | 1,326 | 1,325 | 0 | 1 |
| CRLF (410 files verified CRLF; no `eol=lf` rules) | 1,326 | 1,325 | 0 | 1 |

Both runs retained the existing optional native-PNG verification skip. Logs,
the checked line-ending inventory and the data comparison proof are under
this worktree's ignored `.local/lfhash/` directory.
