# Group Active Task filters

Show blocked and All possible tasks now inspect each player's own catalogue in
Group view. Owner, search, skill, readiness and pin filters must match the same
player, and the displayed task details follow that player. Blocked rows name
their player and retain the first reason shown in the personal list. Saved
imported tasks without an engine result retain their existing review reason.

The secondary filter uses the selected map player. Not done by Player 1/Player 2
includes personally unfinished available tasks and quests even when the partner
has satisfied the group challenge. Only Player 1/Player 2 can do further excludes
tasks available on the partner's map. Partner completion or backlog does not
make an otherwise available task unique. Availability uses the existing task
evidence, including reachable training ceilings and observed custom-task levels.

The choice is stored per viewer in browser storage. It sends no command and
changes no gameplay fingerprint or History. Redundant completion, inspection
and readiness controls look disabled and explain why. Their checked choices
remain intact when returning to normal Group or personal mode.

## On-demand data

`/api/tasks?memberId=…&view=play-v1&projection=duo-inspection-v1&revision=…`
returns complete existing play bytes with an inspection marker and optional
NeverShow exclusions. The server caches these optional bytes within the existing
32 MiB budget and drops them before ordinary lists under pressure. Default
worker calculations, projections and task payloads are unchanged. Current
saved-result reads bypass evaluation; viewers can only read existing results.

The browser loads both inspection catalogues only when a switch, search or
secondary filter needs them. It deduplicates requests, caches by revision,
discards obsolete responses, and recovers after a Sandbox transition or a
viewer's task-ready notification. Counts describe the filtered rows; category
pagination and folds retain the existing rendering limits.

## Verification — October 13, 2026

The copied-save browser review passes on Node 24.20.0 and Chrome 154. The frozen
state SHA-256 is
`a1f281dc442d2ef91ad2895b08e6235ce3bfea1bf05f1cc4dd0c823c72ab0c3e`.
Normal Group shows 19 rows, All possible 1,089, and Show blocked 5,501.
Player 1's not-done/unique filters show 1,276/54; Player 2's show 1,125/31.
Owner and search scopes, blocker attribution, counts, revision-cache reuse,
reload persistence and unchanged personal-mode results pass. Desktop 1440 px
and phone 390 px captures have no horizontal overflow and were visually inspected.

The native page-load harness compares archived base `235458b` with the final
application, three fresh-server runs each, on the same frozen save. Group is on,
Player 1 unlocks the same scratch choice, prediction warming and Preview are off,
and both current task lists must settle. Every browser, timing and full-suite
run uses `.local/with-heavy.ps1`; disposable servers/debugging use 9021/9022.

| Group task milestone | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Cold page | 14.921 s | 15.596 s | +4.5% |
| Reload | 1.332 s | 1.228 s | −7.8% |
| Fresh unlock | 4.436 s | 4.273 s | −3.7% |

Default task responses remain about 599/602 kB for the two players, differing
only by a few runtime-timing digits. No inspection requests occur on the normal
page. UI code adds one small preference module. Final source manifest
`3a4d086249cdfba9be5aa53bc0c7c5dd2c59adf16dab6ff6f6da45ecd1cf9e63`
matches every current app/reference file. Reports are under `.local/perf/`;
the concise comparison is `groupfilters-summary.json`.

The local harness adapter handles normal search labels and waits for search
readiness. It also adapts the fixed debugging port. Initial setup failures and
the missing static preference-module route were corrected; partial reports
remain local and are excluded from the final comparison. Two legacy fixture
assumptions found by the first full run were corrected; their 10 targeted tests
pass. New regressions use existing classified test files.

Final full `npm test`: **3,236 passed, zero failures/cancellations, one optional
skill-icon asset check skipped**, 484.57 seconds. The final run includes the
personal-completion union and completed-player claim guards, fixed readiness
controls, Sandbox recovery and viewer task-ready recovery.

These are headless localhost measurements, including a 390 px desktop viewport.
Player 2's unlock and prepared predictions were not separately timed. Screenshots
and browser checks are `.local/screens/groupfilters-{desktop-1440,phone-390}.png`
and `groupfilters-checks.json`. Owned processes and scratch copies close in
`finally`; the frozen private copy is removed after final verification.
