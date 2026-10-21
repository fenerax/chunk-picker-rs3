# Independent game verification — 2026-10-13

Milestone 3 adds `open-starter`, contract 1: a fresh 30-cell grid, five activities,
two seeded manual goals, generic players and authored rules. It uses the shared
application, workers, command system, storage and authentication.

See [the launch and capability guide](../independent-game.md). Start with
`npm run start:open`, on port 8950 with `.local/open-starter` storage. No live save,
repository art, legacy value file or permanent legacy ID changed.

## Isolation and gameplay

`scripts/check-independent-game.mjs` passed under the heavy lock. Its disposable
candidate contained none of the 112 paths listed below. Runtime guards covered
7 server/worker process and thread isolates, including worker replacement.
15 guard probes passed: forbidden reads, imports, network access, shells and
stripped-environment child processes failed as expected. One permitted system
query reads OS process start time for the existing store lock. It reads no
project or save data.

The real HTTP client made 306 requests. It created the normal fresh game, owned
and selected cells, completed an activity and seeded/new manual tasks, wrote a
note, reloaded, used Undo, took/restored backups twice, and created player and
viewer links. Foreign or missing dataset identity was refused on restoration.
Viewer writes returned 403; unsupported operations returned 422.

The module/resource graph fetched 260 routes, including literal lazy imports,
with zero missing routes or external resource edges. No forbidden read, failed
import or outside network call occurred during gameplay. The server closed and
the candidate was deleted.

Detailed local report: `.local/independent-game/latest.json`.

## Private parity

`scripts/dataset-parity.mjs` passed under the heavy lock on a fresh disposable
copy of the private save. `differences` was empty. Selection metadata checks,
read-only invariance and Undo restoration passed in both profiles. Copies and
disposable packs were deleted.

Maximum RSS was 2,112,304 / 2,065,996 KiB. Sampled summed process-tree working
set was 3,097,587,712 / 2,947,768,320 bytes. These describe this parity run;
they are not a timing benchmark.

Detailed local report: `.local/independent-game/parity.json`.

## Browser and screenshots

One final light-locked session used one guarded candidate, server and browser
for both viewports and nine supported lazy dialogs. All 444 requests stayed
local, with zero 404s or browser errors. Neither viewport overflowed
horizontally. The viewer had no write launchers or enabled task checkboxes;
all three attempted writes returned 403. The browser/server stopped and
the candidate was deleted.

- [Desktop, 1440 × 900](open-starter-desktop-1440.png)
- [Phone, 390 × 844](open-starter-phone-390.png)

Matching screenshots and the browser report are in `.local/screens/open-starter/`.

## Tests

New quick tests cover provider selection, permanent IDs and aliases, real cell
references, valid rolls, authored provenance, seeded manual goals, display
defaults, storage binding refusal and capability switches. Every new test file
is classified in `scripts/test-selection.mjs`.

The affected screen fixtures passed 248 tests; startup/task-dialog fixtures
passed 11; icon wrappers passed 7. The fixtures now supply the selected dataset
and capability helpers explicitly, matching the production module seam.

After extracting private configuration, 115 provider/capture/state tests,
30 storage/invite tests and 40 map/invite tests passed. Default private names,
map IDs, administrator labels and colours retain their existing behavior.

The final quick suite passed all 1,341 tests across 136 files, with no failures,
skips or unclassified files.

The first full-suite run returned exit 1. Its PowerShell logging wrapper treated
an npm stderr notice as an error and discarded the output. Total counts and
failure diagnostics could not be recovered. The reviewed fixture failures were
fixed and their targeted tests passed. A full-suite pass remains unverified;
no additional full run has been made under the brief's one-run limit.

## Bounds of this result

The starter intentionally has a small authored world and no RuneScape service,
training, equipment, cache or Wiki catalogues. This verifies its execution
profile. F2P batches, public export/allowlists, a public repository, licensing
clearance and publication belong to later milestones.

## Paths absent from the candidate

The copy builder excluded these paths and verified their absence. Paths already
absent in the source are included. Physical `app/data` JSON values are excluded;
shared algorithm modules stay available. Similarly named compatibility
responses are generated from the fresh provider in memory. The runtime guard
also denies the physical paths.

```text
.git
.local
app/cli.mjs
app/data/archaeology-task-corrections.2026-10-08.v1.json
app/data/cache-archaeology.2026-10-08.v1.json
app/data/cache-component-policy.2026-10-07.v1.json
app/data/cache-divination.2026-10-13.v1.json
app/data/cache-interiors.2026-10-08.v1.json
app/data/cache-interiors.2026-10-08.v2.json
app/data/cache-npcs.2026-10-08.v1.json
app/data/cache-resource-selectors.2026-10-08.v1.json
app/data/cache-resources.2026-10-08.v1.json
app/data/cache-selector-evidence.2026-10-07.v1.json
app/data/cache-shops.2026-10-08.v1.json
app/data/cache-surface-corrections.2026-10-08.v1.json
app/data/cache-walkability.2026-10-07.v1.json
app/data/changelog.json
app/data/combat-level-formula.2026-10-09.v1.json
app/data/divination.2026-10-13.v1.json
app/data/equipment-corrections.2026-10-08.v1.json
app/data/equipment-permanence.2026-10-08.v1.json
app/data/equipment-weights.2026-10-08.v1.json
app/data/item-icons.2026-10-08.v1.json
app/data/item-icons.2026-10-09.v1.json
app/data/item-icons.2026-10-12.v1.json
app/data/item-membership-aliases.2026-10-08.v1.json
app/data/item-membership-flags.2026-10-08.v1.json
app/data/item-membership-review.2026-10-12.v1.json
app/data/item-membership.2026-10-08.v1.json
app/data/legacy-dataset-values.2026-10-13.v1.json
app/data/legacy-rules-text-values.2026-10-13.v1.json
app/data/legacy-task-history.json
app/data/map-connections.2026-10-09.v1.json
app/data/map-pin-details.2026-10-08.v2.json
app/data/map-pin-details.inputs.2026-10-08.v1.json
app/data/map-pin-details.wiki.2026-10-08.v1.json
app/data/members-start-banks.2026-10-12.v1.json
app/data/metadata-corrections.2026-10-08.v1.json
app/data/monster-membership-review.2026-10-12.v1.json
app/data/npc-metadata-corrections.2026-10-08.v1.json
app/data/original-data.2026-09-28.v1.json
app/data/original-data.2026-10-13.v1.json
app/data/original-rules-ui.2026-10-08.v1.json
app/data/picker-entities.2026-10-08.v1.json
app/data/place-labels.2026-10-13.v1.json
app/data/poh-storage.2026-10-08.v1.json
app/data/retained-entry-corrections.2026-10-12.v2.json
app/data/retained-task-corrections.2026-10-09.v1.json
app/data/retained-unsupported-corrections.2026-10-13.v1.json
app/data/retained-wording-corrections.2026-10-12.v1.json
app/data/roadmap.json
app/data/skill-guides.2026-10-08.v1.json
app/data/skill-icons.2026-10-08.v1.json
app/data/skillguide-combat-corrections.2026-10-08.v1.json
app/data/source-incidental-outputs.2026-10-08.v1.json
app/data/source-membership.2026-10-08.v1.json
app/data/source-method-requirements.2026-10-08.v1.json
app/data/source-row-membership.2026-10-08.v1.json
app/data/training/banking-fishing-spots.v1.json
app/data/training/banking-masks.v1.json
app/data/training/death-woodcutting-guide.v1.json
app/data/training/f2p-expansion.2026-10-13.v1.json
app/data/training/fishing-rates.v1.json
app/data/training/ge-prices.2026-10-08.json
app/data/training/methods.f2p.json
app/data/training/mining-rates.v1.json
app/data/training/woodcutting-rates.v1.json
app/data/transport-access-anchors.2026-10-08.v1.json
app/data/transport-components.2026-10-08.v1.json
app/data/transport-components.automatic-teleports.2026-10-09.v1.json
app/data/transport-components.desert-anachronia.2026-10-09.v1.json
app/data/transport-roll-destinations.automatic-teleports.2026-10-09.v1.json
app/data/transport-routes.2026-10-08.v1.json
app/data/transport-routes.2026-10-09.v1.json
app/data/transport-routes.2026-10-09.v2.json
app/data/transport-routes.automatic-teleports.2026-10-09.v1.json
app/data/transport-routes.desert-anachronia.2026-10-09.v1.json
app/data/transport-routes.f2p.2026-10-08.v1.json
app/data/transport-routes.interiors-members.2026-10-08.v1.json
app/data/transport-routes.ships.2026-10-08.v1.json
app/legacy-dataset-metadata.mjs
app/legacy-game-defaults.mjs
app/web/gallery-capture.mjs
app/web/gallery-catalogue.mjs
app/web/gallery-dialog-coverage.json
app/web/gallery-fixture-data.json
app/web/gallery-fixtures.mjs
app/web/gallery-preview.mjs
app/web/gallery-safety.mjs
app/web/gallery-usage-fixture.mjs
app/web/gallery-usage.mjs
app/web/gallery.css
app/web/gallery.html
app/web/gallery.mjs
app/web/task-item-artwork.2026-10-09.v1
archive
archives
docs/research
local-game
local-game/chunk-sections.cache-audit-2026-10-07-v4-v1/manifest.json
local-game/chunk-sections.cache-audit-2026-10-07-v4-v1/sections.v1.json.gz
local-map
local-map/manifest.cache-2026-10-08-05932552f7af-v1.json
local-map/manifest.json
local-map/pins.cache-2026-10-08-05932552f7af-v1.json
local-map/pins.normalized.json
node_modules
reference
reference/original-picker/tasksMap.json
resources
rs3-chunkpicker-chunkinfo-export.json
tests
```
