# Task and Current BiS interface

Tasks now provide a compact preview and equipment evidence without expanding the
main list. Current BiS groups recommendations by combat style and keeps specialist
comparisons and personal obtain records behind disclosures. All views use the
existing warm ledger tokens, including light and gray schemes.

## Task previews

Active Tasks, Backlog and Completed rows share one hover controller. A preview
opens after 250 ms of pointer hover or keyboard focus, or a 500 ms touch hold on
the task label. Leaving the row, Escape, scrolling, resizing or opening a dialog
dismisses it. Touch dragging cancels the hold; a successful hold consumes its
synthetic click. Keyboard description ownership follows focus between controls.

The card shows the description, skill and level, doable state or first blocker,
up to three sources or locations, artwork and compact equipment stats when
available. For example, a task can explain “Defeat the Chaos Elemental 25 times.”
instead of repeating only its title. Generated BiS goals omit their synthetic
level one; actual equipment requirements remain visible.

Desktop cards prefer space beside the row. Narrow screens use space above or
below it with a bounded height. Full task details and definitions load lazily
through the existing coalesced cache. Repeated previews and the task popup reuse
that result for the current member and saved revision; row rendering makes no
detail request. Late responses cannot replace a newer preview or dialog.

## Equipment task details and methods

“Obtain a Team-1 cape” and “Obtain a Skull lantern (tier 10)” show item artwork,
style, slot, tier, equip requirements and declared equipment stats. Zero values
remain in the comparison model but are hidden in detail, previews and the Current
BiS table; missing values are not invented. The explanation uses the
picker's selected recommendation and ranking evidence. Hands and compatible
ammunition are compared as a loadout when the engine supplies one.

The popup shows a next lower-ranked obtainable choice, personally recorded choice
or equal-ranked alternative when supplied. Remaining comparisons expand lazily,
preventing a cape's many ties from filling the initial dialog. Numeric scores
round for display only; comparison identity retains exact values. Personal obtain
records describe recorded completion, rather than asserting current inventory.
Ranking formulas and components are under “How it’s ranked”; limitations are
under “Notes”. “Same stats” requires matching slots and complete declared field
coverage. Coupled comparisons identify changes to the selected partner item.

Alternative methods are grouped into doable methods and methods needing progress.
The active choice is highlighted. Six choices per group appear initially, with
more available in batches. Training and collection groups retain direct selection,
a small “Choose automatically” control and the existing revision guards. Legacy
saved preferences and an explicit automatic reset retain their established meaning.
Equipment alternatives remain navigable without adding a new selection command.

## Current BiS

Each combat style has a card with a semantic slot table, item names and artwork,
key stats and source. Coupled main hand, off-hand and ammunition appear in one row.
Recommendation evidence and alternative loadouts expand on demand. Compact search
and style controls filter the recommendations; specialist objectives and recorded
gear remain reachable in their tabs with collapsible sections. Existing record and
maintenance commands are preserved.

## Artwork provenance

The installed optional item-icon bundle differs from the tracked manifest in this
checkout. The normal icon helper still takes precedence. Two exact fallback images
are copied from the retained upstream equipment artwork at `98a3bdc`, with names,
source paths and SHA-256 hashes in `app/web/task-artwork.mjs`:

| Item | Retained source | SHA-256 |
| --- | --- | --- |
| Team-1 cape | `resources/equipment_icons/Team-1_cape.png` | `6d8c01870ff6f508d962b79d0008f37793b36726d957064b314a24e14b99ae40` |
| Skull lantern tier 10 | `resources/equipment_icons/Skull_lantern_(tier_10).png` | `a7c146e534035efd5e8f4a782391f911601ae054e356aa428e8a63bf5e72a665` |

The copies are in `app/web/task-item-artwork.2026-10-09.v1/`. The server exposes
only those exact hashed paths, through its existing authenticated static-file
handling. No cache exporter, icon manifest or advisory data is changed.

## Verification and visual review

DOM and route tests cover preview timing, focus, touch, cancellation, stale detail
responses, non-overlap positioning, source summaries, equipment comparisons,
method selection and paging, Current BiS tabs and filters, and authenticated asset
delivery. The full suite and counts are recorded in the final delivery.
The initial task interface delivery added forty tests. Its full `npm test` reported
**1,903 tests: 1,902 passed,
zero failed and one skipped**. The skipped check needs the optional generated
artwork bundle; the new fallback artwork and authenticated routes pass their
dedicated hash checks. The focused UI run passes 112 tests.

The readability follow-up to `b1ba742` adds seven regression tests and updates
assertions for hidden zeros, grouped recommendations and collapsed evidence.
Its focused task, BiS, hover and browser run passes 111 tests. Full `npm test`
reports **1,930 tests: 1,929 passed, zero failed and one opt-in skill-artwork check
skipped** because `SKILL_ICON_ASSET_ROOT` is unset.

Real-save checks use a disposable copy under this worktree's ignored `.local`,
without its lock or invitation sidecars. Servers bind to ephemeral localhost ports.
The original save, running picker and client are not used by these checks.
The copied save and archived baseline checkout are deleted after checking;
screenshots and timing reports remain for review.

Three-run performance medians from the initial task interface delivery compare
that implementation with an archived copy of deployed
`10f75a6`, using the same copied save and read-only game/map assets:

| Measured interaction | Baseline | Task interface | Change |
| --- | ---: | ---: | ---: |
| Reload to tasks shown | 1,258 ms | 994 ms | -21.0% |
| Unlock through refreshed tasks | 6,675 ms | 5,111 ms | -23.4% |

Both meet the within-10% regression requirement. These are shared-host timings;
the difference does not establish a backend optimization. Individual runs and
metadata are in `.local/perf/taskux-baseline-2026-10-09T10-38-59-578Z.{json,md}` and
`.local/perf/taskux-final-2026-10-09T10-58-15-522Z.{json,md}`.

Screenshots from the initial task interface delivery, before Claude's readability
pass, are under `.local/taskux-review/` in the `taskux` worktree.
`checks.json` records matching viewport/body widths and preview
non-overlap at 1440 px and 390 px. The captured dialogs have no horizontal overflow.

| Desktop 1440 px | Phone 390 px |
| --- | --- |
| `desktop-task-hover.png` | `phone-task-hover.png` |
| `desktop-team-1-cape.png` | — |
| `desktop-skull-lantern.png` | `phone-skull-lantern.png` |
| `desktop-methods.png` | — |
| `desktop-current-bis.png` | `phone-current-bis.png` |
| `desktop-current-bis-light.png` | `phone-current-bis-light.png` |
| — | `phone-current-bis-gray.png` |

## Changed files

- Task wiring: `app/web/main.mjs`, `app/web/index.html`.
- Task modules and styles: `task-hover.mjs`, `task-methods.mjs`,
  `task-equipment.mjs`, `task-artwork.mjs`, `task-ui.css` under `app/web/`, plus the
  two versioned artwork files above.
- Current BiS: `app/web/info-panels.mjs`, `app/web/bis-panel.css`.
- Authenticated static route wiring: `app/server.mjs`.
- Renderer parity harness wiring: `scripts/compare-cache-access.mjs`.
- Tests: `tests/web-browser.test.mjs`, `tests/info-panels.test.mjs`,
  `tests/web-personal.test.mjs`,
  `tests/task-hover.test.mjs`, `tests/task-equipment.test.mjs`,
  `tests/task-ui-server.test.mjs`.
- This interface handoff: `docs/task-ux.md`.
