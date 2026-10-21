# Archived data layout

Before this organisation pass, `app/data` contained 106 files totalling
167,208,868 physical bytes. Four superseded map bundles moved to
`archive/data/<original filename>` without changes to their data content:

| File | Bytes |
| --- | ---: |
| `map-connections.2026-10-08.v1.json` | 6,479,765 |
| `map-connections.2026-10-08.v2.json` | 7,152,989 |
| `map-connections.2026-10-08.v3.json` | 17,454,534 |
| `map-pin-details.2026-10-08.v1.json` | 3,066,691 |
| Total | 34,153,979 |

After the moves and provenance path updates, `app/data` contains 102 files and
133,056,937 physical bytes (167.21 MB → 133.06 MB, using decimal MB). The net
reduction is 34,151,931 bytes; updated provenance path labels account for the
small difference from the moved files' original total.

Runtime loaders select connections `2026-10-09.v1` and pin details
`2026-10-08.v2`. None of the four archived files is imported by an application
module or exposed by the server's explicit static routes. Historical builders,
renderers, focused tests and the repository provenance inventory use the archive
paths. Historical builder output defaults also target the archive, so rerunning
them does not restore superseded files to the runtime data directory.

The following older files stay in `app/data` because they still have runtime
consumers:

| File | Bytes | Runtime consumer |
| --- | ---: | --- |
| `cache-interiors.2026-10-08.v1.json` | 7,088,815 | Explicit authenticated static route in `app/server.mjs` |
| `transport-routes.2026-10-08.v1.json` | 444,602 | Explicit authenticated static route in `app/server.mjs` |
| `transport-routes.2026-10-09.v1.json` | 465,656 | Explicit authenticated static route in `app/server.mjs` |
| `item-icons.2026-10-08.v1.json` | 13,296,275 | `ICON_BUNDLES` loads this base manifest alongside the October 9 supplement |

Exact filename searches covered application code, scripts, tests and docs.
Constructed references in `tests/helpers/repository-provenance.mjs` were checked
separately. Connections v1 feeds the transport merge; connections v2 feeds the
interior renderers; connections v3 feeds the transport supplement; pin details
v1 feeds map and transport builders. These archives remain reproducible inputs.

Recorded repository-relative paths identify the relocated files. Generator
identities and dependent repository hashes must follow any source-path changes
using the canonical LF scope described in [provenance-hashes.md](provenance-hashes.md).
Captured absolute paths into other worktrees, external cache exports and
historical audit snapshots retain their original meaning; they are evidence
labels, not instructions to operate on those locations. This pass does not
change the existing served URLs, cache assets or saved gameplay.

## Original picker files

The following root files moved to `reference/original-picker/<same filename>`:

- `index.html`, `index.css`, `index.js`, `modal.js`, `tooltip.js`, `worker.js`
- `tasksMap.json`
- `Background-chunk.PNG`, `runescape_world_map.png`, `login-blank.png`,
  `world-blank.png`, `source-chunk-avatar.png`, `source-chunk-avatar-hat.png`

The public repository no longer keeps the six page, script and stylesheet
files; they remain at upstream commit `98a3bdc`. Only `tasksMap.json` stays in
that folder, and the art pack installs the two map images there.

Their source content is unchanged. Migration, sync, CLI, generators, research
and performance scripts, tests and source citations use the new paths.
The server keeps `/assets/world.png`, `/assets/background.png` and the task-map
API at their existing URLs. Neither the new reference directory nor the archive
is exposed as a static directory. Shared `resources/` artwork and the chunk-info
export remain at the root; the export's provenance identities keep that path.
[Reference notes](../reference/original-picker/README.md) distinguish the retained
upstream scripts' historical URLs from current local read targets.

Verification compares changed JSON artifacts after normalizing only moved path
labels and SHA-256 values: no other content differs from the starting commit.
Reference text is compared using canonical LF; PNGs use exact bytes. Focused
tests exercise the moved task-map seed, unchanged image URLs and bytes, archive
isolation, generator provenance and both old and new pinned comparison layouts.
Existing test files retain their full-suite classifications.

The final full suite ran once through
`powershell -NoProfile -File .local/with-heavy.ps1 npm test`: 298 files,
3,177 tests, 3,176 passed, one skipped and zero failed. No browser session or
screenshots were needed for this filesystem-only change; the worktree's `.local`
files, live save and existing large archive were left untouched.
