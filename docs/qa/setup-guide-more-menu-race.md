# More moves when calculation feedback clears

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
- `app/web/style.css:266–269,292,295,299` places the intrinsic-width status block
  beside flex navigation and anchors More's absolute menu to its summary.
  Changing status width therefore moves the menu while it remains open.
- `app/web/setup-guide.mjs:47–54` waits for the preference save before closing,
  but task loading is independent (`app/web/screen-startup.mjs:118`). A player
  may legitimately open More while those requests finish.
- State adoption/rendering does not close More. Its relevant close paths are
  user actions (`app/web/screen-controls.mjs:28,74–86`) and responsive layout
  adaptation (`app/web/phone-layout.mjs:74–83`). Group-goals rendering replaces
  children of the sidebar section, not the header (`app/web/group-goals.mjs:174–224`).

## Proposed product fix and regression

Reserve a stable desktop inline allocation for `.connection-status` instead of
letting its content size the space next to navigation. The smallest candidate
is a desktop-only fixed flex basis using its existing `18rem` maximum. Check
that feedback wrapping also leaves the menu's vertical anchor stable; preserve
the current phone composition rather than imposing a wide column there.

Add a deterministic browser regression that holds real task responses, opens
More while feedback is visible, captures the Settings point, releases the
responses, and joins the feedback-cleared DOM state plus rendering. Assert More
stays open and Settings still owns the **original** point, then dispatch native
input there. Do not recalculate the point after completion or wait for tasks to
finish before opening More. Cover both one- and two-player headers, and the
responsive breakpoint when choosing the final layout rule.

No product change or task-settlement wait is included in this investigation.
The existing test now captures menu state, target geometry, scroll and feedback
at pointerdown and click, before the app's outside-click handler can hide More.
