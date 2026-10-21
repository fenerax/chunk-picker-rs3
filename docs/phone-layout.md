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
Dialog content scrolls within the viewport.

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
