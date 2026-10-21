# Accessibility pass — 2026-10-13

Job `a11y`, branch `codex/a11y`, roadmap G8. The fixes keep the current layout,
palette, wording and command boundaries.

## Method and coverage

- Used a disposable copy of the duo save, excluding `store.lock` and
  `access-token`. The live picker and original save were not used for writes.
- Ran one successful locked browser session, with one picker on port 9241 and
  one disposable headless Chrome profile on port 9242. A failed initial Chrome
  connection was cleaned up before this session; it captured no screenshots.
- Captured Chrome's accessibility tree and sent real Tab, Enter, arrow and
  Escape key events. Pointer events were used to open the map context menu;
  its actions were then checked with the keyboard. No gameplay was changed.
- Checked 1440 × 900 desktop and 390 × 844 phone viewports in Dark and Light.
  Phone and a 1440 px touch laptop used touch emulation and reported
  `(hover: none)`. This is browser evidence, not a physical-device test.
- Inspected computed text colours against their containing backgrounds,
  enabled target bounds, focus outlines, action opacity and accessible names.
  Also checked 70 affected foreground/background pairs across all ten palettes:
  the lowest resulting text contrast was 4.505:1.
- Inspected the toolbar; personal and group Active Tasks; filters and backlog
  entry; chunk contents, tabs, menu and stickers; group-goal editor; Profile;
  all five Helper sections; History; all five normal Settings sections; shared
  dialogs; and phone tabs. A viewer invitation created only in the copy confirmed
  `readOnly: true`, `canWrite: false`, and no enabled gameplay write actions.

Evidence is local under `.local/screens/`: before/after PNGs, `*-ax.json`
accessibility trees, and observation JSON. The frozen frontend used for the
before captures allowed implementation work while the shared lock queued.

## Findings and fixes

Locations below refer to the final source. Each finding is fixed unless explicitly
identified as an existing passing behavior. Severity: P1 materially affects
access or contrast; P2 has a practical workaround.

| Finding | Evidence and impact | Source and result |
| --- | --- | --- |
| P1: faded backlog action | The enabled icon used 45% opacity on hover-capable desktops and 55% at rest on a wide touch device. Its colour was weakened independently of the readable theme tokens. | `app/web/style.css:796`, `app/web/style.css:797`: backlog stays fully visible; explicit no-hover rules keep all task icons and content actions visible. Existing Wiki/content row `:focus-within` reveal remains at `style.css:289` and `style.css:602`. |
| P1: focus lost after menu-launched dialogs | Profile, History and Settings closed on Escape but returned focus to `body`, in both themes and widths. The original opener was inside a now-closed Info or More menu. | `app/web/screen-dialogs.mjs:10`: return to the visible summary; retain the original opener when replacing Search with another tool; use task search, map or the selected phone tab when the opener disappears. Close-button, native cancel and backdrop closure use the same close lifecycle. |
| P2: focus lost when chunk information closes | Escape hid a focused chunk tab and left focus on `body`. | `app/web/screen-controls.mjs:31`: a close from inside Chunk Info returns focus to the map control. |
| P1: more than one surface could respond to Escape | The previous independent document handlers could close a chunk panel and top menu on one press. A synchronous dialog-close implementation also needed to avoid the later Helper handler closing its parent. | `app/web/screen-controls.mjs:6`, `app/web/helper.mjs:54`: one ordered handler dismisses the foremost surface; Helper respects an already-handled event. Verified a dialog over Helper closes first and Helper closes on the next press. |
| P1: incomplete chunk tab semantics and navigation | The tablist had no name, every tab was a Tab stop, tabs had no controlled-panel relationship, and ArrowRight did nothing. The outside focus outline clipped against the scrolling bar. | `app/web/screen-chunks.mjs:191`, `app/web/style.css:610`: named tablist, unique tab/panel IDs, labelled tabpanel, one selected stop, wrapped arrows and Home/End; the ring sits inside the tab. |
| P2: chunk menu arrows did nothing | ArrowDown stayed on “Chunk details”; this made the menu role less useful to keyboard users. | `app/web/screen-chunks.mjs:147`, `app/web/screen-chunks.mjs:347`: arrows/Home/End traverse enabled items, including the Wiki link; closure restores focus when the menu owns it and preserves outside focus. |
| P2: Skill menu and filters did not dismiss on Escape | Escape from the skill choices left the menu open. The phone Skill summary was only 36.9 px wide. | `app/web/task-filters.mjs:15`, `app/web/phone-layout.css:37`: first Escape closes Skill and focuses its summary; the next collapses Filter & sort and focuses its toggle. Phone summaries have a 44 px minimum width. |
| P2: backlog Cancel/Escape lost focus | Removing the focused reason form left focus on `body`. | `app/web/screen-tasks.mjs:36`: dismissal returns to the initiating action or an available row action and consumes Escape. No saved command is sent by dismissal. |
| P2: group-goal Cancel lost focus | Cancelling rebuilt the goal list, removing the focused control. The editor did not handle Escape. | `app/web/group-goals.mjs:82`: Cancel/Escape focus the newly rendered Edit or Add button, with a read-only fold fallback. Pending link results are invalidated; a save in progress remains protected. |
| P2: phone links below the requested 44 px target | Task Wiki links were 26 × 26; chunk-header Wiki links were 30 × 30; the map-menu Wiki link was 34 px tall. Button sizing already worked. | `app/web/phone-layout.css:36`: standalone icon/menu links now measure at least 44 × 44. This meets the requested target; 44 px is stricter than WCAG 2.2 AA's general 24 px target minimum. |
| P1: Helper Light contrast | Selected section text was 3.23:1 and the Progress duo column was 3.17:1, below 4.5:1 for normal text. Some other palettes also used page/panel foregrounds on surface backgrounds. | `app/web/helper.css:6`, `app/web/helper.css:24`, `app/web/helper.css:28`, `app/web/helper.css:41`: use the existing matching page/surface text and link tokens. No sampled Dark/Light Helper text failures remained. |
| P1: default placeholder contrast | Chrome's default task-search placeholder was 3.67:1 in Light and 4.03:1 in Dark. The persistent accessible label already existed, but the visible prompt was harder to read. | `app/web/style.css:23`: placeholders use the existing page-muted token at full opacity. The task-search placeholder now measures 6.10:1 in Light and 8.57:1 in Dark. |
| P1: inconsistent surface foregrounds in other palettes | Profile skill tiles inherited panel text, and primary menu/Feedback/backlog text used gold independently of their backgrounds. Source colour checks found failures in palettes such as Winter and Autumn. | `app/web/profile.css:21`, `app/web/profile.css:25`, `app/web/style.css:628`, `app/web/style.css:630`, `app/web/style.css:802`, `app/web/style.css:845`: use matching surface/panel/task tokens, including hovered primary menu text. Dark/Light browser checks passed; the other palettes were checked numerically. |
| P2: spoken task and note names | A task checkbox could expose retained label markup. “Note ●” communicated saved/draft status only through a glyph. | `app/web/screen-tasks.mjs:60`, `app/web/screen-chunks.mjs:139`: plain task names and explicit saved-note/unsaved-draft tab names. Existing icon buttons already had useful names. |
| P2: phone tab relationships | The tab buttons already wrapped with arrows, but their controlled sections retained desktop semantics without a tabpanel label. | `app/web/phone-layout.mjs:11`: phone panels use named tabpanel relationships and restore their original desktop roles/labels above the breakpoint. |

Relevant criteria are WCAG 1.4.3/1.4.11 (contrast), 2.1.1 (keyboard),
2.4.3/2.4.7 (focus order/visibility), and 4.1.2 (name, role, value). This is a
focused accessibility pass, not a complete conformance claim.

## Existing behavior verified

| Surface | Passing checks and source |
| --- | --- |
| Map toolbar | Zoom names and native control names exist in `app/web/index.html:115`; Tab traversal reaches toolbar buttons and the named map. Global rings exist at `app/web/style.css:35`. Search remains the accessible alternative to choosing a canvas chunk. |
| Active Tasks and filters | Hover-only Wiki/content actions already reveal on focus within their row at `app/web/style.css:289` and `app/web/style.css:602`; focused-row captures show opacity 1. Hidden filter checkbox inputs put their ring on the visible pill at `app/web/style.css:305`. |
| Group goals | Player and overall ticks are named and revision-checked at `app/web/group-goals.mjs:20`. The copied save had no goals, so progress/edit/remove states also use focused fixture tests. |
| Profile | Fields use the shared label helper at `app/web/screen-ui.mjs:44`; Profile selection and section controls have names. Browser samples in both themes had no remaining text failures. |
| Helper | Grind planner, Our chunk goals, Drop chances, XP & combat, and Progress are keyboard reachable; Back to picker returns focus to Helper at `app/web/helper.mjs:17`. |
| History | Search, player and change filters remain named; paging and read-only History are covered by `tests/history-dialog.test.mjs:34`. |
| Settings | Map, Rolling, Tasks, Panels and Time estimates were walked in both themes/viewports. All checked enabled targets met the phone target requirement and sampled text passed. Section navigation is named at `app/web/settings-panel.mjs:58`. |
| Dialogs and menus | Native dialog naming and close-button names exist at `app/web/index.html:195`; Search, task tools and menu-launched dialogs share the revised lifecycle. The existing sticker flyout correctly closes before its parent at `app/web/sticker-picker.mjs:235`; direct panel-picker focus return was added at `sticker-picker.mjs:30`. |
| Phone tabs | Existing arrows/Home/End work at `app/web/phone-layout.mjs:51`; buttons and checkbox labels already meet 44 px sizing at `app/web/phone-layout.css:34`. The Group view switch is visually 26 px tall but its clickable label is at least 44 px, so it is not a failed target. |
| View-only | The captured viewer tree has read controls without enabled roll, backlog, claim, goal-edit or import actions. Disabled progress ticks remain readable. Tests retain the command/write guard, including the plain-name task checkbox test. |

## Before/after screenshots

All paths are under this worktree's `.local/screens/`. The pairs cover the same
save and theme/viewport; map position can change during chunk navigation.

| Fix | Desktop 1440 Dark | Desktop 1440 Light | Phone 390 Dark | Phone 390 Light |
| --- | --- | --- | --- | --- |
| Task actions and targets | [Before](../../.local/screens/a11y-before-desktop-1440-dark-tasks.png) / [After](../../.local/screens/a11y-after-desktop-1440-dark-tasks.png) | [Before](../../.local/screens/a11y-before-desktop-1440-light-tasks.png) / [After](../../.local/screens/a11y-after-desktop-1440-light-tasks.png) | [Before](../../.local/screens/a11y-before-phone-390-dark-tasks.png) / [After](../../.local/screens/a11y-after-phone-390-dark-tasks.png) | [Before](../../.local/screens/a11y-before-phone-390-light-tasks.png) / [After](../../.local/screens/a11y-after-phone-390-light-tasks.png) |
| Chunk tabs and focus ring | [Before](../../.local/screens/a11y-before-desktop-1440-dark-chunk.png) / [After](../../.local/screens/a11y-after-desktop-1440-dark-chunk.png) | [Before](../../.local/screens/a11y-before-desktop-1440-light-chunk.png) / [After](../../.local/screens/a11y-after-desktop-1440-light-chunk.png) | [Before](../../.local/screens/a11y-before-phone-390-dark-chunk.png) / [After](../../.local/screens/a11y-after-phone-390-dark-chunk.png) | [Before](../../.local/screens/a11y-before-phone-390-light-chunk.png) / [After](../../.local/screens/a11y-after-phone-390-light-chunk.png) |
| Chunk menu targets | [Before](../../.local/screens/a11y-before-desktop-1440-dark-menu.png) / [After](../../.local/screens/a11y-after-desktop-1440-dark-menu.png) | [Before](../../.local/screens/a11y-before-desktop-1440-light-menu.png) / [After](../../.local/screens/a11y-after-desktop-1440-light-menu.png) | [Before](../../.local/screens/a11y-before-phone-390-dark-menu.png) / [After](../../.local/screens/a11y-after-phone-390-dark-menu.png) | [Before](../../.local/screens/a11y-before-phone-390-light-menu.png) / [After](../../.local/screens/a11y-after-phone-390-light-menu.png) |
| Helper contrast | [Before](../../.local/screens/a11y-before-desktop-1440-dark-helper.png) / [After](../../.local/screens/a11y-after-desktop-1440-dark-helper.png) | [Before](../../.local/screens/a11y-before-desktop-1440-light-helper.png) / [After](../../.local/screens/a11y-after-desktop-1440-light-helper.png) | [Before](../../.local/screens/a11y-before-phone-390-dark-helper.png) / [After](../../.local/screens/a11y-after-phone-390-dark-helper.png) | [Before](../../.local/screens/a11y-before-phone-390-light-helper.png) / [After](../../.local/screens/a11y-after-phone-390-light-helper.png) |
| Settings focus return | [Before](../../.local/screens/a11y-before-desktop-1440-dark-focus-return.png) / [After](../../.local/screens/a11y-after-desktop-1440-dark-focus-return.png) | [Before](../../.local/screens/a11y-before-desktop-1440-light-focus-return.png) / [After](../../.local/screens/a11y-after-desktop-1440-light-focus-return.png) | [Before](../../.local/screens/a11y-before-phone-390-dark-focus-return.png) / [After](../../.local/screens/a11y-after-phone-390-dark-focus-return.png) | [Before](../../.local/screens/a11y-before-phone-390-light-focus-return.png) / [After](../../.local/screens/a11y-after-phone-390-light-focus-return.png) |

The wide no-hover comparison is
[before](../../.local/screens/a11y-before-desktop-1440-light-touch.png) /
[after](../../.local/screens/a11y-after-desktop-1440-light-touch.png).

## Tests and limits

- Focused run: 348 passed, 0 failed across the changed behavior and related
  screen, Helper, Profile, History, phone, menu and sticker fixtures.
- Final `npm run test:quick`: 1,141 passed, 0 failed, 119 files.
- New `accessibility-focus.test.mjs` and `chunk-tabs.test.mjs` are classified as
  quick in `scripts/test-selection.mjs:15`.
- Full suite: not run (0 full-suite tests). This is UI-only work; no server,
  storage, engine, worker or `app/data` code changed, following the shared job
  rule to leave the merged-batch full run to the integrator.
- Automated focus tests cover dialog return, disconnected/hidden openers,
  nested Helper Escape, menu priority, tab relationships/arrows, backlog and
  group-goal dismissal, and named read-only task controls. Tests also cover
  in-flight saves and stale link results when a goal editor closes.
- No new dependencies, inline scripts/styles, palette redesign, save commands,
  lamp-choice logic, overlays, map-layer implementation, roadmap or changelog
  data were changed.
- Actual screen-reader speech, physical touch hardware, forced-colours mode,
  every retained Advanced setting, and exhaustive contrast for map imagery and
  user-selected custom colours remain outside this observed pass. Text scanning
  sampled the rendered viewport; it is not an exhaustive audit of every saved
  row or expanded data table.
