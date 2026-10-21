# Initial-pass verification record

The October 7 review and subsequent changes are recorded in [followup-verification.md](followup-verification.md). Its evidence supersedes the initial readiness claim and test count below; this file retains the earlier measurements for comparison.

This document separates component evidence, captured-map comparisons and browser acceptance for the
private picker. Runs used Node.js v24.19.0 on the Windows desktop on October 7, 2026.

## Final acceptance status

| Check | Required evidence | Status |
| --- | --- | --- |
| Full npm suite | `npm test` with Node v24.19.0 | Passed: 215 tests, zero failures/skips, 5.085 seconds. Includes sparse/legacy undo, capture provenance, gzip negotiation and frontend module-route regressions. |
| Inspection and benchmark | `node app/cli.mjs inspect --snapshot .local/imports/maps-2026-10-07T12-25-51Z.json` and equivalent `benchmark` | Passed; backup round trip, 250 roll-pool iterations, median 4.96 ms / p95 7.74 ms / maximum 19.85 ms for both members together. This excludes task calculation and rendering. |
| Desktop browser | Map switching, contents/search, notes, tasks, both roll modes, undo, backup and reviewed replacement/profile | Passed in isolated Chromium sessions. Two simultaneous editors produced one 200 and one 409, and the second browser received the committed revision. |
| Mobile/responsive browser | Map controls, dialogs, task list, focus recovery and no blocking overflow | Passed at 390 × 844; keyboard search focused its input and restored canvas focus on Escape. Zoom/pan changed the artwork; no horizontal page overflow. Desktop inspected at 1440 × 900. |
| Production helper | Start/stop scripts, durable restart, private invitation and server log | Passed. Hidden server binds `<tailscale-ip>:8788`; stop/start preserved the identical state SHA-256 and invitation. Final clean store is revision 1, with original gameplay and no acceptance-test edits. |
| Second-device private access | Existing Tailscale policy, invitation reachability and two-editor conflict recovery | The private HTTP address worked from Chromium on this desktop, including custom task/teleport UUID fallback. Actual Player 2-device access awaits Player 1's Tailscale grant and has not been tested. |

The second-device limitation is explicit: two browser contexts prove conflict handling, while a
same-desktop Tailscale-address request does not prove Player 2's network access.

## Retained implementation evidence

The authored application includes the private local server, atomic revisioned storage, import and
restore preview, map and content UI, rolling workflows, history/undo, task evaluation and
presentation, search, notes/backlogs, rule profiles, teleport confirmations, prediction and equipment
recommendations. [operator-guide.md](operator-guide.md) describes the intended two-player operation.

The October 7 public capture completed through scoped read-only GETs for QXA and QXB. It recorded:

| Map | Unlocked | Selected |
| --- | ---: | ---: |
| QXA / Player 1 | 136 | 13 |
| QXB / Player 2 | 113 | 20 |

The refreshed ignored snapshot is `.local/imports/maps-2026-10-07T12-25-51Z.json`, captured at
`2026-10-07T12:25:53.021Z`. Its maps-payload SHA-256 is
`dc9b118b23c27705a1f20b3edc32eacd8139a9d271e6c5f072734f191be39347`; the complete file SHA-256 is
`828d3bb5640e3a142083b8dfe2a2439fc449f8b154d6d2f705e039930463d484`. The map payload is unchanged
from the earlier same-day capture; reported source version is 6.9.39.1. This is a dated migration
input rather than a continuing account feed. Capture performs no Firebase write.

The latest retained authored evaluation of that migrated state produced:

| Member | Personal available | Shared available | Personal bases/sections/areas | Shared bases/sections/areas | Unsupported |
| --- | ---: | ---: | --- | --- | ---: |
| Player 1 / QXA | 1,183 | 1,384 | 136 / 162 / 68 | 153 / 187 / 84 | 34 |
| Player 2 / QXB | 1,362 | 1,429 | 113 / 156 / 77 | 153 / 190 / 83 | 34 |

These totals include intermediate/source tasks and are not UI goal counts or evidence of completed
gameplay. Unsupported hard requirements fail closed and remain visible with reasons.

The final private browser showed 25 active goals for Player 1 and 59 for Player 2 with completed goals hidden. It retained 260
unique Player 1 challenge checks and 277 Player 2 checks. The migration report counts 545 converted source
records; multiple original records can address the same authored task. Actual personal game
completions remained zero rather than being inferred from these checks. Thirteen unmatched source
records remain visible in migration provenance.

The authored worker's private-server calculation took 1,279 ms in a measured view; a repeat request
hit the revision cache (0.10 ms retrieval before JSON encoding, compression, transfer and browser
rendering). These are calculation-stage measurements, not end-to-end page load times. Browser task
completion lookup over 23,926 records took 42 ms for index construction and three passes in the
isolated check, versus 5,927 ms for one previous repeated-scan pass.

The final state response transferred 506,856 bytes with negotiated gzip versus 3,684,703 bytes plain
(about 86% less). Plain/gzip decoding produced identical state at revision 1. Large save, conflict,
import, restore and backup responses use the same negotiated compression; `gzip;q=0` stays plain.

## Persistence growth and real-data acceptance

Sparse undo records retain changed member fields/dictionary entries and individual task rows.
Legacy full-member/catalogue undo records remain readable. All history and retained server backups
remain present; there is no automatic pruning.

An in-memory projection using the captured maps and 23,926-row catalogue measured a full pretty JSON
backup after 1,000 checkbox edits at 5,814,379 bytes, versus 58,417,879 bytes with full-member undo.
Validation/import took approximately 207/208 ms in that run. Six new custom tasks added about 5 KB,
instead of six additional full catalogues. This is a projection with generated valid history,
rather than 1,000 physical disk writes.

The final real-data HTTP integration initialized a separate ignored store, added six custom tasks,
undid all six, changed/undid a challenge note, and restarted. All original members, rules, catalogue
and raw legacy maps matched the baseline. Its portable backup after six custom tasks was 4,801,178
bytes; 15 retained snapshots remained. Six measured save round trips ranged from 1,268 to 1,720 ms,
including HTTP response decoding and an extra cloned-response check in the test harness. Those
measurements are distinct from worker calculation or disk-write timings.

Acceptance stores and screenshots are ignored under `out/` and `.local/`. Before creating the clean
final store, gameplay was compared with its initial migrated snapshot and confirmed unchanged.
The prior acceptance store remains archived locally, so the final user store has no synthetic task,
teleport or note history. The Impeccable detector was degraded because parser dependencies were
unavailable; desktop/mobile screenshots were inspected directly. The incumbent-style sidebar
divider was retained intentionally.

## Offline reference comparison

The retained original `reference/original-picker/worker.js` ran once in a Node VM against the October 6 QXA payload. `fetch`,
`XMLHttpRequest` and `WebSocket` were blocked; the lodash CDN `importScripts` request was recorded and
not executed. The baseline completed in 12.657 seconds without contacting Firebase. The authored
four-view evaluation took 0.78–1.00 seconds per uncached view in the latest local comparison. These
are observed runs, not a controlled whole-application benchmark.

The original selected four ordinary skill goals: corrupt dragon weapon, corrupt dragon armour,
infernal yew incense sticks and Falador's crumbling wall. All four match authored normalized labels
and are available, visible and unblocked. After imported challenge-completion suppression, the
original Quest/Diary/Extra result is empty and the authored result has seven rows.

All seven differences have exact original frontier evidence:

| Authored-only rows | Original blocker | Authored policy |
| --- | --- | --- |
| Damage Without Consequences; Poltergeist Pen Pal | `F2P` at Necromancy 13/20 | Necromancy trial ceiling is 20 |
| Command Skeleton Warrior ability | `F2P` at Necromancy 20 | Necromancy trial ceiling is 20 |
| Steel mattock | `F2P` on the Archaeology 20 source | Archaeology trial ceiling is 20 |
| Breaking the Seal; Prison Break completions | Barracks prerequisite `Clear the fort debris outside Kharid-et`, Archaeology 12, has `nonValids=["F2P"]` | Archaeology trial ceiling admits the declared entrance and source chain |
| Altar of War furniture plan | War's Retreat prerequisite, Combat 60, has `nonValids=["F2P"]` | Combat is a progression aggregate rather than a members trial skill |

This proves why the retained worker differs and documents the intentional compatibility correction.
It does not independently validate the underlying game data. Only QXA personal access has an
original-worker payload; QXB and shared-access totals have no direct original baseline. Full details
are in [reference-output-comparison.md](reference-output-comparison.md).

## Known limits for acceptance

- The compiler reports 34 unsupported hard-reference records per current member view; they fail
  closed rather than being guessed.
- Equipment recommendations use declared tier/stat/source information. There is no target-specific
  DPS model, and bespoke set bonuses plus full skilling/relic scoring remain incomplete.
- Some dynamic generators, specialist processing interactions and discretionary XP-choice workflows
  remain outside complete upstream parity.
- Private sharing trusts possession of the invitation. Per-user authentication and view-only links
  are not implemented.
- The server depends on the desktop remaining awake and reachable. Tailscale access is governed by
  the existing tailnet policy, outside this application.
- The root upstream files remain a retained reference and must not be served as the authored app.

Browser screenshots/logs and captured gameplay remain outside Git. The final private server uses
the same authored code that passed this suite and remains running after verification.
