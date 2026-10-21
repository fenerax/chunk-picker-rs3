# Emulated phone sweep — 2026-10-15

The picker keeps its existing layout and visual language. Short touch landscape uses the existing phone tabs; iPad keeps the two-column workspace. Mouse and keyboard paths are retained.

| Priority | Observed problem | Engine | Repair |
| --- | --- | --- | --- |
| P1 | At 200% text, a 393 px phone acquired a 473 px layout viewport; tabs, Add goal and the save notice's Dismiss action became unreachable or clipped. | Chromium | Wrap headers and notices, and let the tab bar grow with text. |
| P1 | An update banner pushed 111.5 px of the workspace behind the fixed tabs. | Chromium, inset probe | Observe every screen bar, including updates. |
| P1 | Pan worked at 852 px but pinch left map zoom unchanged; iPad had the same width gate. | Chromium touch input | Track touch gestures at every width; retain phone-only, permission-checked holds. |
| P2 | Fields used 12.75–15 px text; landscape and tablet controls were small. | Chromium and WebKit | Reuse 44 px touch targets and apply a 16 px field minimum. |
| P2 | Top controls lacked notch padding; landscape dialogs extended into the reserved bottom area. | Chromium CDP insets | Include safe areas in controls, panels, tabs and dialog bounds. |

The reusable harness is outside the repository at `C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/phone/phone-sweep.mjs`. Run it from this worktree through `.local/with-light.ps1`. Positional origin/invite-file arguments match the existing gallery checker; that mode captures the gallery only. With no arguments it owns and removes a fresh scratch server and save copy. No dependency was added.

The matrix includes SE and iPhone 15 in both orientations, 15 Pro Max, Pixel 7, 360 px Android, 320 px folded screen, iPad Mini in both orientations, 390 px reference, short browser viewport and enlarged text. Both colour schemes, all 95 catalogue states, and fresh admin/member/viewer sessions are covered. Real gathering plans, menus, Invite/OBS panels, overlay widgets, landing and invalid joins supplement the catalogue. The save copy includes only state, history and static; credentials are generated afresh.

Verification: 57 focused checks passed. Private quick suite: 1,490 passed, one existing skip. The final browser run passed with 4,282 captures across 36 device/engine/theme appearances, zero application errors and all 26 touch pan/pinch checks passing. The original gallery checker passed 95/95 previews plain and framed. All 194 desktop comparisons stayed below the existing image-difference threshold. There were no unexpected viewport-width changes, short text fields, rendered-theme mismatches or real-session workspace/tab overlaps.

The full suite is skipped under the shared UI-only rule; no server, storage, game engine, worker or dataset code changed. The public test inventory was regenerated. The export scanner receipt is kept locally at `.local/public-export/latest.json` after checking the committed candidate.

Evidence: [worktree screenshots](../../.local/screens/phonesweep/index.html) and [full device sheets and before/after pairs](C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/evidence/phonesweep/index.html). Logs: `.local/phonesweep-focused.log` and `.local/phonesweep-quick.log`. Raw reports and the baseline audit retain early harness failures and explain corrected theme/viewport labels; the final report asserts every real session's rendered theme. Fixed-issue pairs use valid dark baseline captures.

Windows WebKit reported zero touch points while coarse-pointer queries and viewport widths applied. Chromium supplied gesture checks. Captures use DPR 1 to bound memory. Playwright's WebKit screenshot helper injects a stylesheet that strict CSP blocks; those messages are retained separately from application errors. Text enlargement doubles the root font from 15 to 30 px with text autosizing at 100%; toolbar movement is approximated by resizing one viewport between 652 and 852 px. Physical Safari, keyboard/browser chrome and actual notch behaviour remain G6.

For Claude: the unauthenticated response is a tiny plain-text 401 with a default 980 px layout viewport; inline reference links keep text-sized targets. Horizontal map toolbars and wide tables keep their existing scrolling. Screenshots for these choices are linked from the evidence index. No dedicated recovery or onboarding page exists in this checkout.
