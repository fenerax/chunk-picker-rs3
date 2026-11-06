# Native overflow gate

Run `node --test tests/overflow-browser.test.mjs` with Node 24.20+ and Chromium.
In the rebuild sandbox, first set
`export PATH=/opt/codex/cua_node/bin:$PATH` and check `node --version`.
No npm dependencies, packs, app server, credentials or private save are needed.

The static host uses the public gallery fixtures, public independent catalogue
bootstrap, shipped CSS and real screen factories. Its synthetic additions live
in `overflow-fixture.mjs`; nothing is exposed by production pages. The native
shell retains the dock's width, unlike isolated gallery `.sample-region` views.
No new screen-context fields are introduced.

The 26 required steps cover both pointer entry routes to the seven-tab dock,
keyboard Arrow/Home/End navigation, two/three long member names, maximal context
menus and merged More menus at desktop and coarse-pointer landscape, 249/339 px
owner lists, a coarse-pointer phone chooser/Profile and three standalone link
surfaces at phone, landscape and tablet sizes. Complete tab, navigation,
menu-action, owner-option and link sets must exist before scanning. The final
step set is asserted independently. The landscape menu must scroll internally
without scrolling the page. Member controls retain full accessible names/titles
and stable IDs while showing at most 20 Unicode characters plus an ellipsis.

`overflow-detector.mjs` is the audit's unchanged base patch (Git blob
`961d7149fa9b49d5a7dfee13eeb81c9ff0a411c2`). The control gate rejects hidden groups,
clipped/occluded controls and touch targets below 44 px. Text-range whitespace,
mid-word text observations and visible ellipsis do not become control failures.
The detector excludes the safety badge and ordinary vertical pages. The gate
also recognizes a clipped one-pixel accessibility proxy and reachable vertical
paging at a scrolling boundary; horizontal clipping and hard ancestor clipping
remain failures. Every expected menu item is separately revealed and hit-tested.

The intentional exception list is currently empty. Any future entry needs an
exact detector selector, exact state, coarse/fine pointer, control kind, numeric
width/height bounds and a written reason. Wildcard and comma selectors are
rejected; surface-wide exemptions are not accepted.

PNG screenshots, complete detector observations, successful control geometry and
assertion failures go to `var/overflow-gate/` (override with
`RS3_OVERFLOW_OUTPUT`). Failures retain a viewport image before throwing. Capture
names use `DA2-0N__WIDTHxHEIGHT__before.png` / `__after.png`, with extra variants
for entry routes and individual affected surfaces. These are temporary review
artifacts and have no production references.

To reproduce against an untouched public commit, set `RS3_OVERFLOW_REF` to its
full 40-character SHA and `RS3_OVERFLOW_PHASE=before`. The static host reads app
sources with `git show`; it changes no checkout, index, branch or saved state.
The exact same tests run, including fixture completeness checks. R0's START
`e507848978f7e92e218f4d805a59efaec2f385a4` fails the desktop seven-tab gate with
425/336 px scroll/client width and zero visible pixels for Access, from both
entry routes. The failure output is retained as `gate__before.log` alongside the
measurements. Current-source runs default to the `after` phase.

The browser gate is classified as full-only; `member-display.test.mjs` is quick.
Run the gate directly for UI review, then the repository's required quick suite.

## Changed UI files

- `style.css`: wrapped chunk tabs, bounded member/navigation flex areas, menu
  scrolling and coarse-pointer link targets.
- `screen-chunks.mjs`: viewport and fixed-tab-aware menu placement.
- `duo-tasks.css`, `profile.css`: member selects surrender intrinsic width.
- `screen-dialogs.mjs`, `screen-task-dialogs.mjs`: standalone action links;
  task-detail owner navigation also uses compact member labels.
- `screen-ui.mjs`: display-only shortening and member-select helpers; ordinary
  task text and input creation are preserved.
- `screen-map.mjs`, `screen-roll.mjs`, `duo-task-view.mjs`,
  `duo-backlog-view.mjs`, `task-claims.mjs`, `completed-view.mjs`,
  `profile-view.mjs`, `lamp-choices.mjs`, `helper.mjs`, `helper-progress.mjs`,
  `bis-comparison-view.mjs`, `info-panels.mjs`, `invites.mjs`,
  `finish-line-view.mjs`, `chunk-colour-picker.mjs`: apply the display helpers at
  member bars, chips and chooser rendering sites, retaining full-text details.

The browser VM collaborator list and tiny DOM mocks follow the new imports and
native multiple-listener behavior. The existing long-claim regression uses wide
synthetic glyphs so it still rejects nowrap overflow with the 20-character cap.
No game rules, calculators, stored names or command payloads change.
