# F2P finish line

Open **Info → F2P finish line**, beside Profile. The list is explicitly a draft
for Player 1 and Player 2 to adjust together. It proposes the catalogue's whole F2P
quests and miniquests, 28 skill milestones, four durable combat-style gear sets,
and five notable achievements. [Research and target choices](research/f2p-finish-line.md)
explain the local evidence and catalogue limits.

Each player has a percentage and a count of finished goals. Every included goal
counts equally: a skill contributes its observed level divided by its target,
a gear set contributes its recorded slots, and other goals contribute zero or
one. Each duo goal uses the lower personal progress and finishes when both
players finish it. Missing observations count as unfinished and remain labelled
unknown; shared challenge credit does not become another player's account fact.
Percentages cannot reach 100 until every included goal is done.

Choose **Edit draft** to include or exclude any item, change a skill target, or
add a text goal with a manual tick for each player. Trial targets stay within
their F2P caps. Both linked players can edit the shared choices and tick their
own custom goals; an administrator can tick either player. View-only links can
read, refresh and copy the list without editing controls.

Changes use the existing revision-checked commands, live updates, History and
Undo. Shared finish-line changes appear in both players' History filters. Full
backups preserve the choices; older saves begin with the proposed defaults.
Editing the checklist does not change tasks, recorded levels, quests or gear and
does not require another task calculation. **Copy for Discord** produces a
bounded summary with unfinished goals and a selected-text clipboard fallback.

The finish line never enables membership automatically. **Settings → Ready for
members** remains the explicit switch. The optional members-dialog completion
message was left out to keep this feature separate from that dialog.

## Verification — 2026-10-13

The quick suite passed 894 tests. The single full run covered 3,452 tests:
3,203 passed, 248 failed, and one was skipped. The failures identified a missing
factory in the fake screen harness and an omitted static route for the new
validator. After those fixes, all 273 tests in the four affected files passed
with `node --test --test-timeout=120000`; the full suite was not repeated.
The skipped check covers optional generated PNG assets.

A final locked browser session passed 12 checks on an isolated copy of the local
duo at port 9091: target and inclusion edits, custom ticks, live Undo, clipboard
fallback, viewer write rejection, and no overflow at 1440 and 390 px. Screenshots
are in `.local/screens/finish-line-desktop-1440.png`,
`finish-line-phone-390.png`, and `finish-line-viewer-390.png`. The server and
browser stopped and the save copy was deleted. These screenshots show recorded
copy data; Player 2's copied save has no synced skill observations, so his unknown
levels remain unfinished rather than being guessed.
