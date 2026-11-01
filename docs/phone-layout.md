# Phone layout

At the existing 720 px mobile breakpoint, Map, Tasks and More replace the stacked
map and task list. Map uses the available height above the bottom tabs; its
toolbar, chunk information and roll choices stay over the map. Tasks uses the
existing sidebar. More receives the existing tools, Recent Chunks, counts and
legend. Resizing above the breakpoint returns those same elements to their
original positions, including any new Info-menu entries.

The selected tab is a device preference under `picker.phone-tab` in localStorage.
Blocked storage falls back to Map and does not prevent switching tabs. Arrow
keys, Home and End navigate the tabs. Opening a chunk from Search or another
panel, Map display, or screenshot mode reveals Map first. Dialogs remain outside
the tab panels.

Phone controls have at least 44 px targets. Checkboxes retain a smaller visible
box inside that target; the Group view switch uses its 44 px label as its target.
When the bars and notices leave less than 28 rem for the workspace, the
workspace keeps that minimum height and the document scrolls the bars away.
Document padding and native focus-scroll padding reserve the fixed bottom tabs.
At taller heights, the existing workspace allocation is unchanged. The backup
warning stays in the document and remains available by scrolling back up.

Open tool dialogs keep their wrapping header outside the body's scrollport.
Native keyboard focus scrolls the body without placing controls behind the title.
A focus helper also reveals the whole control after caret scrolling, progressive
detail loading, or a change in the body/header size.

A stationary phone touch held for 550 ms invokes the existing Unlock action,
including the existing pending-roll selection command. An owned chunk opens
information instead of being locked. A short tap always opens information,
including in Sandbox. Movement over 5 px, additional fingers, pan, zoom,
pointer cancellation, changed map state, hidden tabs and loss of page visibility
cancel the hold. Phone pinch zoom preserves its midpoint. Viewers retain chunk
information and local navigation without unlock controls or write callbacks.

The implementation lives in `phone-layout.mjs`, `screen-phone-layout.mjs`,
`phone-layout.css` and `chunk-long-press.mjs`, with narrow screen and map hooks.
Controller checks are `tests/phone-layout.test.mjs` and
`tests/chunk-long-press.test.mjs`, both in the quick suite. Browser evidence from
the copied duo save is kept locally in `.local/screens/phone-review.json` and
the accompanying 390×844 and 1440×900 screenshots.

## Verification (2026-10-13)

The focused controller/map/capture run passed 60 tests; the quick suite passed
880 tests. One shared-lock browser session used a copied duo save on port 9101.
It checked the three tabs, reload persistence, actual touch tap/pan/hold,
revision-command unlock and Undo, a view-only link, screenshot mode, and tablet
restoration at 768 px. Profile, Current BiS, History, Roll stats, Settings,
Ready for members and loaded Area check results fit at 390×844 with no horizontal
dialog overflow or measured controls below 44 px. Browser exceptions: none.

The 1440×900 comparison used `claude/redesign` commit
`340a137c1c758a31ac680b5add4cdee1e7181eb2` in the same server/browser session.
Measured toolbar/map/sidebar geometry and styles matched exactly. The final
raster comparison differed in 13 of 1,296,000 pixels, all in the unread-news
indicator; the rest matched. Screenshots and measurements are in
`.local/screens/phone-review.json`, `phone-extra-review.json` and
`phone-final-review.json`. The browser and server stopped, and the copied save
and browser profile were removed. This checks Chrome emulation; physical phones
and Safari remain untested.

The single locked full-suite run reported 3,433 passed, one skipped and one
failure among 3,435 tests. The failing hover-cost test uses a partial map fixture
without touch collaborators. Mouse hover now tolerates those absent collaborators;
the affected test and controller/map/capture checks passed on the 60-test retest.
The full suite was not repeated, following the one-run limit. Selected tab text
also meets 4.5:1 contrast in all current themes using the existing palette tokens.

## Short-height browser regression

`tests/short-height-browser.test.mjs` is a full-only, open-f2p browser test. It
auto-detects Chrome/Chromium and drives its DevTools Protocol without npm dependencies:

```sh
node --test tests/short-height-browser.test.mjs
```

The reusable `scripts/perf/short-height-browser.mjs` harness starts the production
server with fresh synthetic stores. It checks 320×240, 320×256 and 320×844 with the
fresh backup notice shown/hidden, normal browser fonts and enlarged browser font
preferences (24 px default/minimum). It measures settled native Tab and Shift+Tab
bounds and center hit ownership for Roll, Controls, roll results, task search,
task details, and confirmation/Cancel. A separate longer synthetic task checks a
wrapping dialog title. The harness never scrolls controls into view; production focus handling is included.
The test runs wherever Chrome is available and skips only when Chrome is not found.
Set `CHROME_PATH` to override browser discovery. Tab and Shift+Tab use real CDP
`Input.dispatchKeyEvent` events for every measured focus stop.

For three alternating START/candidate UI pairs at the critical height and JSON measurements:

```sh
node scripts/perf/short-height-browser.mjs --baseline START --height 240 --output /tmp/short-height.json
```

Replace `START` with the full checkout commit hash. Baseline failures are recorded;
candidate failures fail the command. `--measure-only` records candidate defects
without treating them as a passing regression test. These checks cover Chromium
layout viewports and actual browser font preferences. Genuine browser zoom,
physical magnification, screen readers and physical touch/IME remain untested.

### Verification (2026-11-01)

Node 24.21.0; START `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`.
All inputs were disposable synthetic stores. The actual Chromium test passed its
12 height/font/notice combinations. Final targeted tests: 408 passed, zero failed,
one existing skip. Final quick suite: 3,012 passed, zero failed, 68 skipped.

Three alternating pairs at 320×240 produced 24 flows: START recorded 188 failures
among 690 checks; the candidate passed all 666 checks with zero page errors.
Workspace and focused Roll visibility below are medians in pixels; every minimum
and maximum equalled its median across the three repeats (zero spread).

| Browser fonts | Backup notice | Workspace before → after | Roll visible height before → after | Roll center hits before → after |
| --- | --- | --- | --- | --- |
| Normal | Shown | 0 → 420 | 0 → 44 | 0/3 → 3/3 |
| Normal | Hidden | 89.75 → 420 | 44 → 44 | 0/3 → 3/3 |
| Enlarged | Shown | 0 → 420 | 0 → 44 | 0/3 → 3/3 |
| Enlarged | Hidden | 0 → 420 | 0 → 44 | 0/3 → 3/3 |

A separate normal-font 320×844 before/after control passed all 220 checks across
four flows. Workspace height was unchanged: 558.75 px with the notice, 693.75 px
without it. Together these comparisons passed all 776 candidate checks. These
are geometry measurements; no speed or memory improvement is claimed.
