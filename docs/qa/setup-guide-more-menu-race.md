# Fixed: More moved when calculation feedback cleared

This is a product layout defect, not an unfinished setup transition. Stability
run 42714338339, Windows job 129491960427, repetition 4, recorded a Settings
point passing its hit test but the native click reaching `group-goals`.

## Controlled reproduction

On `84f7f88`, a fresh synthetic two-player `open-starter` game at 1440 × 900
reproduced the same hit without changing application code or waiting a fixed
duration. CDP held real `/api/tasks` responses until the application's pending
calculation feedback appeared. After Skip setup saved and its native close
event fired, More was opened. Releasing the task responses cleared the feedback.

| Observation | Task response held | Task response released |
| --- | --- | --- |
| More open | true | true |
| Settings rectangle `(x, y, width, height)` | `(1001.1875, 128.0625, 216, 36)` | `(1136.203125, 128.0625, 216, 36)` |
| Status block width | 185.8125 | 50.796875 |
| Group goals rectangle | `(1076, 140.625, 349, 87.625)` | unchanged |
| Document scroll | `(0, 0)` | `(0, 0)` |

The original Settings center `(1109.1875, 146.0625)` then hit `group-goals`.
The menu moved 135.015625 CSS pixels right; it did not close.

## Source of the movement

- `app/web/screen-commands.mjs:40–46` adds calculation feedback to the header's
  `.connection-status` and clears/hides it when work completes.
- `app/web/calculation-feedback.mjs:5–12` shows pending work and clears it on
  completion; `app/web/screen-commands.mjs:119` ends feedback in `api()`'s finally.
- Before this fix, `app/web/style.css:268` gave the status block an intrinsic
  width. Navigation (`:294`) and More's relative/absolute anchor (`:297,301`)
  therefore moved when that width changed, even while the menu remained open.
- `app/web/setup-guide.mjs:47–54` waits for the preference save before closing,
  but task loading is independent (`app/web/screen-startup.mjs:118`). A player
  may legitimately open More while those requests finish.
- State adoption/rendering does not close More. Its relevant close paths are
  user actions (`app/web/screen-controls.mjs:28,74–86`) and responsive layout
  adaptation (`app/web/phone-layout.mjs:74–83`). Group-goals rendering replaces
  children of the sidebar section, not the header (`app/web/group-goals.mjs:174–224`).

## Implemented product fix and regression

`app/web/style.css:271` now reserves `.connection-status`'s existing `18rem`
maximum as a fixed, nonshrinking flex basis above 600px. It also reserves the
save line and two feedback lines, including the save label's vertical padding,
using the existing small type size and its computed line height. Content stays
vertically centered within that allocation. No other topbar rule changed, and
the phone composition at or below 600px retains its existing rules.

`tests/topbar-status-browser.test.mjs` holds real `/api/tasks` responses at CDP's
response stage, opens More with native input while feedback is visible, captures
the Settings point, releases the responses, and joins the feedback-cleared DOM
state, fonts and completed rendering frames. It checks that More stays open,
Settings still owns the **original** point, the summary's vertical anchor stays
fixed, and a native click there reaches Settings and opens its dialog. There
are no elapsed-time readiness checks, timing assertions or retries; the file
has one 300-second outer deadlock guard.

One- and two-player headers each cover ordinary feedback at 1440px and genuinely
wrapped player-name feedback at 1440px and 800px. The wrapped cases seed the saved
Personal view preference, which startup restores through
`app/web/task-view-preferences.mjs:18–23`. An initial fixture attempt unchecked
the element before startup restored it; its wrapping assertions caught that
mistake. That run is not the before/after proof below.

The existing setup-guide test still captures menu state, target geometry, scroll
and feedback at pointerdown and click, before the app's outside-click handler can
hide More. It gained no task-settlement wait.

## Local verification

Node v24.20.0, Windows, one worker, BelowNormal priority, sequential owned
synthetic servers and Chrome profiles:

| File / source | Result (includes parent test) |
| --- | --- |
| Topbar regression, corrected fixture without CSS fix | tests 7; pass 0; fail 7; cancelled 0; skipped 0 |
| Same topbar regression with CSS fix | tests 7; pass 7; fail 0; cancelled 0; skipped 0 |
| Setup-guide file with CSS fix | tests 5; pass 5; fail 0; cancelled 0; skipped 0 |

Each proof row is one file invocation, with no repetition loop or full suite.
Before the fix, all six cases reached the final layout/native-click assertion
and failed. Ordinary feedback moved Settings 135.015625px horizontally. Wrapped
feedback moved its vertical anchor by 8.75px at 1440px and by 34px or 66px at
800px. After the fix, each case kept the Settings rectangle and vertical anchor
identical across feedback clearing and opened Settings from the original point.
Hosted Stability and full CI remain required after publication.

## Gallery and screenshot impact

The catalogue covers this header in `main`, `topbar`, `topbar-info`,
`topbar-admin`, `topbar-more` and `badges`. A synthetic gallery comparison
rendered each direct preview with the new rule, then removed only that rule
from the same document for the old-layout capture. All twelve 1440px dark/light
pairs changed as expected: navigation and its menus move left to leave the
reserved status width. These two-player gallery fixtures already had a taller
header, so their header height stayed 76.875px. The one-player regression's
idle header grows to reserve the wrapped-feedback space.

All twelve 390px dark/light pairs had **zero changed pixels** and identical
header/control rectangles. The optional framed capture could not invoke the
capture-only theme hook; these comparison results cover direct previews.
The first gallery attempt used `open-starter`, which intentionally disables
gallery routes; the completed comparison used tracked `duo-legacy` catalogues
and built-in synthetic gallery fixtures, with an isolated tiny backend save.

Main map, Tasks, More, Helper, Search, Settings and History screenshots also
include the real topbar and can therefore show the expected desktop change.
Their full copied-save screenshot run was not performed. The screenshot
pipeline keeps ignored per-SHA captures and optional comparisons, rather than
checked-in golden images. No saved comparison set or historical QA screenshot
was regenerated.
