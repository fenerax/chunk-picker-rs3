# Duo task view

## Call dibs on a task

Every unfinished active row has a visible **I’m doing this** button. One click
claims it for the signed-in player, even while viewing the partner's map.
The master link has no assigned player: its button explicitly says **Mark as
Player 1's** or **Mark as Player 2's**, following the player toggle. Viewer links
cannot mark or stop a task. The row shows **Player 1 is doing this** or **Player 2 is doing this**,
plus a short time such as **Player 2 · 2 h ago**, in Group view and both personal
lists wherever that task appears. Times refresh once a minute while the page is
visible, without fetching or recalculating tasks. The task name still opens its details.
**Stop doing this** clears your own claim; **Take over** first asks to confirm
taking the task from your partner. Cancel and Escape save nothing. Claim
controls are disabled in Sandbox and while the displayed task list is updating.
They are also disabled for tasks shown only through personal inspection switches.
With personal completion rules, a completed row still shows a partner's ongoing
claim; that completed player cannot take it over.

Claims are small records in the shared save, keyed by the task's permanent ID,
with the claiming player and a server timestamp. Claim, stop and takeover use
the ordinary revision guard, History and Undo. History uses plain lines such as
**Player 1 started “Mine 50 copper ore”** and **Player 2 took over “Mine 50 copper ore”
from Player 1**. Clearing dibs says **Player 2 is no longer doing “Mine 50 copper ore”**.
Labels are saved with the action so old
History and catch-up notes stay readable after the task leaves the list.
An older claim or stop can still be undone after an independent claim, preference,
note or pin. After a newer task or map change, undo that newer change first before
restoring an older claim; finished or removed tasks cannot regain inactive dibs.
Undo of completion or another map/task change restores that change and leaves
automatically cleared claims absent. Claims never block gameplay Undo. Undo of
an explicit claim, stop or takeover still restores its previous claim safely.
Assigned invites may only undo their own claim and stop actions. The master link
may undo either player's claim through the existing confirmation.
The existing live connection repaints a partner's claim without recalculating
tasks. Returning players see new partner claims in **Since you were last here**.

Completion clears the affected task or completion-family claims in the same
save, using saved task metadata and the trusted catalogue. It works after a
restart with no task results cached, after imported alias IDs, and when Undo
restores a completed task. New saved task rows do not duplicate completion
families already available in the trusted catalogue. Tasks that leave the active list, including
tasks backlogged by every owner, are tidied after both existing personal task
lists are available. No calculation starts just to check claims. Background
cleanup uses its own guarded revision and adds no History line; it never changes
an unrelated action's Undo. It strips cancelled claim inverses from recent
in-memory History and saves small private cancellation watermarks. Archived
History is adjusted lazily when actual Undo or export already needs it. Cleanup
does not load History archives, make another backup, or run retention work;
the authoritative state still uses an atomic write and existing static sidecars.
Search,
owner chips, folded headings and display filters never clear a claim.
Cleanup uses each player's own completion facts and the saved player order,
so either personal calculation can arrive first with the same result.

**Filter & sort** adds **Hide tasks my partner is doing** and **Only my claimed
tasks**, relative to the signed-in player, or the master link's chosen player.
Clear resets both. Claims are excluded from task inputs and cache fingerprints.
Task responses never await claim work. Background checks run after the response
finishes, only when claims exist and their task IDs or gameplay inputs changed.
They read the existing saved-result bytes and discard their temporary compact
projections before a cleanup write. No extra parsed full results stay resident.
Cleanup errors are logged without failing a task read. Claim-only saves preserve
prediction warming already scheduled by a task response; they start no new work.
Private saved metadata proves whether every revision since a conflicting request
changed only claims. The browser automatically tries the identical command once
when that proof holds, keeping a pending chunk unlock visible. Changed claim
reviews, player/session changes, a second conflict, or a gameplay change require
review. Reviewed Undo and import actions retain their original confirmation.

Run `node scripts/review-task-claims.mjs` with a frozen private copy at
`.local/dibs-save`. It creates one disposable loopback server and Chrome profile,
checks both personal lists, claim/stop/takeover, filters, History/Undo, live and
catch-up notes, completion and backlog cleanup, and desktop/390px light/gray
screenshots. Private copies and scratch processes are removed after verification.

## Second review verification, 2026-10-12

Merged `claude/redesign` at `ac7e378b6681d3714c64c6fa2f6524d0000f22a6`,
preserving Roadmap, the flag/chunk-ID fix, both changelog lists, and browser
harness stubs. Regression tests now keep the one-second prediction warm-up
through claim and background cleanup saves. A fresh server keeps its existing
startup delay; a claim does not start another prediction batch.

The API marks a conflict as claim-only only when private durable metadata proves
every intervening revision changed claims. Missing legacy proof, preferences,
gameplay, imports and mixed revision gaps require review. The client retries
once, preserves pending Unlock, and checks player, session, view and confirmation
guards. Task claims additionally compare the reviewed owner and timestamp;
renewed, released or replaced claims need a fresh click or confirmation.

Archived claim and release Undo is checked against the assigned invite after
History hydration inside the serialized store queue. Cleanup itself never reads
the archive, and its cancellation watermarks survive restart. Tests suspend the
archive directory during cleanup and verify unchanged static sidecars, archive
references, backup counts and preparation-call counts. Actual Undo/export later
projects the cancelled claim leaves. Undo re-completion and alias IDs from
original-picker sync or player restore clear related claims in the completing
save. Existing optional saved family metadata remains readable; new rows and
identity entries do not duplicate the trusted catalogue families.

The requested focused scope passes **257 tests**, including all **165** browser
checks with the final claim-review guards and the added original-sync alias case.
Task/collection checks pass **65**,
and a separate focused storage/state set passes **56**. The extracted original-
picker sync and browser set passes **183** after adding its session/view stubs
and avoiding captured-variable names that shadow the extractor's globals.

The frozen revision-97 copied save uses the same SHA-256 as the earlier review.
Player 1 stays **25 → 25** tasks and Player 2 **26 → 26**, with identical task ID hashes.
**Obtain a Brawler's hook necklace** passes takeover, quoted History, both claim
filters, assigned-player controls on the partner's map, viewer restrictions,
completion Undo and all-owner backlog cleanup. A Player 2 invite's live claim
appears in **265 ms**, with **zero extra task requests**. Cleanup adds a revision
without a History event, and undoing either backlog leaves the claim cleared.
Fresh captures are `.local/dibs-review-final/desktop-claim-gray.png` and
`.local/dibs-review-final/phone-claim-390-light.png`; both were inspected and have
no horizontal overflow. `.local/dibs-review-final/checks.json` records the
checks, identity hashes and removed scratch directory. Full-suite and final
performance results are in [performance.md](performance.md). The frozen private
copy is deleted. Full `npm test -- --test-concurrency=1` passes **2,582 tests**
with zero failures, cancellations or skips, in **749.29 seconds**. All 246
application/reference files still match the measured source hash. Prediction
goldens, provenance hashing and `.gitattributes` LF rules are unchanged.

## Review-fix verification, 2026-10-12

Merged `claude/redesign` at `2fda5bd3da51629443af03acc41197ef35afa9c5`,
preserving Helper Progress and viewer links. Claim and release have explicit
write permissions; automatic pruning remains internal. Assigned invites may
only claim or release as their signed-in player. The changing button labels
use native buttons without `aria-pressed`.

Nine core regressions fail against `2c2795f` and pass with the fixes. They cover
latest/older completion Undo, deterministic cold-store sibling completion,
unrelated cached saves, imported alias claims/inverse IDs, restart and archived
cleanup. The original direct command path already normalized known aliases;
the failing alias case was imported claim data and its Undo guards. Claim and
release now also explicitly use the canonical looked-up task ID.
Two server regressions reproduce unauthorized Player 2-as-Player 1 claims and blocked
task reads in the original commit, then pass after the fixes. Browser checks
cover session-versus-map selection, explicit master labels, viewer controls,
claim filters and 409 refresh/retry.

The new frozen revision-97 copy has state SHA-256
`8761c7e352db88b5e7fbf45995a5b1a2f6718d2868997315f7d6d803df8859c6`.
Player 1 stays **25 → 25** tasks; Player 2 **26 → 26**, with identical task identities.
Using **Obtain a Brawler's hook necklace**, one browser switches sequentially
between master, Player 2 and viewer links. Player 2 claims and clears his own task while
viewing Player 1's map; viewer controls remain disabled in personal and Group
lists. Master labels, takeover/cancel, both filters, explicit claim Undo, History
and catch-up notes pass. Completion Undo keeps the claim absent. All-owner
backlog cleanup gets a separate revision with no History event, and undoing
either backlog does not bring it back. The separate Player 2 API session's live
claim appears in **212 ms**, with **zero new task requests**.

Fresh captures are `.local/dibs-review-fixed/desktop-claim-gray.png` and
`.local/dibs-review-fixed/phone-claim-390-light.png`; both have no horizontal
overflow. `.local/dibs-review-fixed/checks.json` records the concise checks and
identity hashes. The frozen copy and scratch server/browser are removed after
verification. [Performance results](performance.md) compare the fixed source
against the merged base, retaining the initial slower batch and alternating
repeat. No prediction goldens or provenance data changed.

Full `npm test -- --test-concurrency=1` passes **2,533 tests** with zero
failures, cancellations or skips in **456.23 seconds**. Its isolated fixtures
use a temporary directory inside this worktree; `SKILL_ICON_ASSET_ROOT` points
to the read-only main manifest for PNG provenance checks. Source verification
confirms all **245** application/reference files match the performance reports.

## Initial dibs verification, 2c2795f (superseded by review fixes)

The frozen input is revision 97, state SHA-256
`7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
Player 1's personal list stays **25 → 25** tasks; Player 2's stays **26 → 26**, with
identical task identities before and after the scratch changes. The combined
list has 28 tasks, including **Obtain a Brawler's hook necklace**. Player 1 claims
that shared task, Player 2 sees her name, Cancel saves nothing, and Player 2 takes over.
Both filters, stopping, History, Undo, completion/backlog cleanup and the
return-to-picker notes pass. The final Player 2 invite claim appears in **891 ms**
from the compact command request starting, with **zero new task requests**.
This uses one desktop browser and a separate Player 2 invite API session; it does
not establish timing over Player 2's internet connection.

Desktop gray and 390px light captures are
`.local/dibs-review/desktop-claim-gray.png` and
`.local/dibs-review/phone-claim-390-light.png`. Both have no horizontal overflow.
`.local/dibs-review/checks.json` contains the concise checks and identity hashes.
All scratch saves, server and Chrome profile are removed, and the frozen input
hash is unchanged. Focused storage and server tests also cover cleanup landing
after a preference, another claim or a takeover. The review fixes above replace
that initial causal-amendment cleanup with a separate guarded revision.

The final full `npm test -- --test-concurrency=1` run passes **2,384 tests**,
with zero failures, cancellations or skips, in 643.44 seconds. The test runner
uses its ordinary isolated fixtures inside the worktree; only `SKILL_ICON_ASSET_ROOT`
points to the read-only main skill-icon manifest so PNG provenance checks run too.
Focused checks include **46 storage/server tests** and **141 browser tests**.
Prediction goldens and `.gitattributes` are unchanged.

## Group task list

Group view now combines the Active Tasks sidebar as well as the existing map.
It combines the two players’ displayed tasks, listing each task once.
Each row names Player 1, Player 2, or Both. All / Player 1 / Player 2 / Both chips filter the
rows; the header gives the union, each personal list’s contribution, and the
number shared. A Both row contributes to both personal counts and once to the
union. Text search applies before these counts; the owner chips preserve totals.

The [Active Task filters](private/task-filters.md) also apply to Group view. Skill,
Doable now, Pinned only and sorting work alongside the owner chips. A personal
chip checks that player's own task details and pins; All and Both accept any
named owner, with Doable now and Pinned only required on the same owner when
both are selected. Search uses the cached union. The separate hidden count
includes all display filters, and Clear returns the chips to All.

The list uses the same personal presentation selectors, including highest skill
goals, display rules, source access, alternatives and individual backlogs. Group
view off follows the existing personal sidebar path. All possible tasks and Show
blocked also inspect both players' Group lists. Extra catalogue rows load only
when an inspection switch, text search or personal filter needs them, and are
cached for the saved revision. Ordinary page loads retain their thin payloads.
Blocked rows name the player and show that player's first requirement reason;
the owner chips, search, skill, doable and pin choices apply together.

The compact secondary filter uses the player selected above the map:
**Not done by Player 1/Player 2** shows tasks and quests they can do now and have not
personally completed, even when the partner has satisfied the group challenge.
**Only Player 1/Player 2 can do** further excludes tasks available on the partner's
map, including tasks the partner has already done or backlogged. Both use the
existing availability evidence, which can include reachable training ceilings.
The browser remembers the choice separately for each viewer; it does not change
gameplay, History or calculation fingerprints. Clear restores normal Group tasks.
Redundant inspection/completion switches are visibly disabled in these personal
filters with a short explanation. Counts and category headings describe the
shown rows. Personal mode retains its existing choices and list.

Backlog and Completed Tasks also combine the personal catalogues, with
the same All / Player 1 / Player 2 / Both owner filter and owner badges. Section counts
describe the filtered union; a shared task counts once. Hide completed and the
Active skill/readiness filters do not narrow these disclosures. Backlog has its
own search. A shared task with different personal reasons appears under each
reason with that reason's owner. Restore buttons name the player and send one
revision-checked command for that player's matching tasks; each button is one
Undo step. Completed copy includes the displayed owners and “Done by …”.
Restore listed covers the owner-filtered catalogue, including tasks outside the
Backlog search; reason-group buttons use search matches. Hidden saved statuses
stay untouched by these scoped group commands.
Review all opens the named player's ledger for a personal owner filter, or the
combined ledger for All or Both; its own player switches remain independent.
Accessible Areas, rolls, History and Undo keep their existing selected-player
behavior. In Sandbox, the sidebar keeps the
selected player’s hypothetical calculation; it does not combine a hypothetical
map with an unmodified saved partner result.

## Personal tasks and shared resources

The duo view does not create tasks from a merged ownership map. This
follows PRODUCT.md’s confirmed rule: partner chunks supply connected training,
gathering and shopping access, while tasks come from each player’s own
chunks. Each personal calculation already includes its existing partner-connection
access. An item in Player 2’s connected chunk can therefore support Player 1’s own
task, without adding Player 2’s location-specific tasks to Player 1’s list.

No optional “Possible together” section is added. The two personal calculations
already account for authorized connected supplies, and a third merged-map
calculation could suggest tasks outside the house rules. Possible Tasks,
task sources and the personal access explanations remain available for planning.

## Commands and evidence

A single-owner row sends the existing command to that owner, regardless of the
selected map. A Both row first opens a small inline player chooser, defaulting
to the selected player. Completion and backlog actions wait for confirmation;
Cancel and Escape make no save. Backlog retains its optional reason form.
Updating rows disable these mutations until both current results are available.

Shared completion uses the existing task-facts index and completion families.
Checking either player satisfies the duo without copying personal quest, skill
or reward progress. With Hide completed off, completion-only suppressed tasks
can appear with “Done by …”; compact responses carry only their identity
references. Other presentation exclusions are not revived. A task popup and its
nested source-method links keep the row’s owner and evidence. Both popups allow
switching whose details are shown. Hover details load for that same owner.

## Merge with the redesigned task review, 2026-10-10

Group view’s combined Active Tasks and the redesigned Completed Tasks review
use the same owner-aware task details and source-method navigation. Opening
either review keeps the selected map unchanged. Both use “Done by …” for
completion attribution; Completed Tasks adds “(ticked)”, “(in-game)” or
“(in-game, RuneMetrics)” to explain the saved evidence.

The copied-save checks and performance evidence below predate this merge.
Their recorded sources, inputs and limits still apply; merged-tree verification
is separate.

The merged-tree browser review used a fresh frozen copy with state SHA-256
`1140d5ca54b4b530bc5aff098f84b80587d0c0965b5b78178a87384d213c9d66`.
It showed **27** combined tasks: **24** for Player 1, **26** for Player 2 and **23**
shared. The Completed review showed **368 / 367 / 392** done for
Player 1 / Player 2 / Both. Its three switches retained Player 1's selected map,
Group view and the sidebar's All filter. A shared Brawler's hook necklace
popup displayed each player's details; a completed Player 2 task loaded its full
details and returned to Player 2's review. Turning Group view off restored the
personal sidebar.

Run `node scripts/review-groupview-merge.mjs` with a private frozen copy at
`.local/groupview-merge-save`. It uses a disposable save and Chrome profile,
removes both after review, and writes concise checks and four screenshots to
`.local/groupview-merge-review`: desktop and 390px Group view, plus desktop
and 390px Duo task details. The screenshots cover dark, gray and light themes;
all four passed the horizontal-overflow checks. Delete the frozen input copy
after verification; no save data belongs in Git.

The merged implementation passes the full `npm test` suite: **2,217 tests**,
zero failures, cancellations or skips. Regression coverage includes review
switches independent of Group view, partner detail loading, the saved-details
guard, source and alternative navigation with Back, and canonical Duo commands.

## Caching and verification

The selected-player foreground path stays in place. A revision-scoped browser
cache remembers its results and requests a missing partner only while Group
view is enabled. The partner fetch starts alongside the selected foreground
request; the union becomes ready only when both current results exist. Explicit
peer requests use a bounded worker that starts only when Group view needs a
missing result, leaving the selected foreground queue free. Successful current
compact results enter the existing bounded foreground cache, so player switches
reuse them. Full details keep their existing on-demand calculation. The peer
worker remains resident until server shutdown; its response cache is limited to
four entries and 32 MiB, with two queued requests and a 30-second deadline.
Requests coalesce; repeated toggles reuse results. A single cached union skips
repeated selection for unchanged state, results and filters. Real changes
invalidate the union; display-only preferences can reuse both results. Late
responses and errors cannot publish across a changed
revision or an inactive group view. Full detail results are separate, loaded on
demand, and bounded by member count.

The facts catalogue keeps presented, completed and custom rows, saved identities,
all competing saved aliases, and the relevant completion-family evidence.
Regression tests compare those facts with the full catalogue, including any,
all and personal completion policies. A synthetic two-player, 40,000-row-per-
player benchmark reduced warm selection from approximately 381 ms to 82 ms;
these are helper timings, not end-to-end browser claims.

The peer worker generates an additional small display response. It retains
presented and completion-hidden rows, custom tasks and saved/alias/family
evidence; the normal member catalogue remains intact in the shared cache.
This keeps filtering and serialization off the HTTP thread and reduces the
copied-save peer body from 4.43 MB to approximately 577 KB. Tests compare the
thin projection with full-index facts, including families named only by the
foreground result. A partner arriving before the selected result waits for the
foreground loader without restarting empty peer requests.
It also waits without rebuilding incomplete rows. Successful pairs publish
once, while scoped errors render Retry; promise cleanup only clears loading.
Group mode skips the unused personal active-goal selection, preserving the
selected player's completed/backlog counts and the original Group-off path.

Group view also requests an explicit small foreground sidebar projection. The
worker selects all ordinary personal completed/backlogged rows using the full
facts index before narrowing, preserving those disclosures and their counts.
Both the small response and unchanged normal compact bytes share the existing
bounded cache. Group off generates no extra projection; existing normal-only
cache entries can serve their normal bytes without recalculation. A separate
revision-scoped browser cache retains normal member results. Turning Group view
off restores one or clears thin rows and loads the normal cached catalogue, so
All possible tasks and Show blocked never inspect a narrowed result. Late thin
responses cannot publish after that transition. Full task details still hydrate
on demand through the existing ordinary full result.

Run `node scripts/review-duo-tasks.mjs` after creating a frozen copy at
`.local/groupview-save` and an archived `c9d765b` tree at
`.local/groupview-baseline`. It creates and removes its own copies, launches
ephemeral loopback servers, checks both personal lists against the baseline,
exercises owner commands and Undo, and captures desktop/390px dark/light/gray
screenshots under `.local/groupview-review`. No credentials or save payloads are
printed. `checks.json` retains the input state hash and concise review evidence.

`npm run perf -- --group-view off` measures the original personal task milestone.
`--group-view on` waits for `duo-tasks-shown`, after both current personal results
have painted. The report records the view and milestone used. Both modes use the
same disposable-save harness and leave the live picker untouched.

## Copied-save review, 2026-10-10

The frozen revision-73 save has 151 unlocked chunks for Player 1 and 113 for Player 2.
Its state SHA256 is
`b7d0313182e16dd81897f62f0b29d5b22b0e8f49953e5409ed4a6954b032053e`.
The review compares the archived deployed `c9d765b` with this worktree using
separate disposable servers and profiles. Both personal labels and compact
presented identity lists match exactly with Group view off.

| View | Before | After |
| --- | ---: | ---: |
| Player 1 personal presented tasks | 6 | 6 |
| Player 2 personal presented tasks | 6 | 6 |
| Group sidebar | Selected player's 6 | 7 unique duo tasks |
| Tasks belonging to both | No owner tags | 5 |

Player 1’s unique row is **Missing, Presumed Death**; Player 2’s is **Dragon Slayer**.
**Explorer’s ring 4**, **Lumbridge Hard Achievements**, **Prison Break**,
**Gertrude’s Cat** and **Purple Cat** belong to Both. Filter results are All 7,
Player 1 6, Player 2 6 and Both 5. The shared ring check defaults to the selected Player 2,
updates only his challenge record, and displays “Done by Player 2”. A Player 1-only
backlog command targets her while Player 2’s map remains selected. Existing Undo
restores each scratch change. The frozen input hash stays unchanged.

Local captures for visual review are under `.local/groupview-review/`:

- `desktop-duo.png` and `desktop-duo-light.png`: 1440×1000, dark and light.
- `phone-duo.png` and `phone-duo-gray.png`: 390×1000, dark and gray.
- `desktop-partner-task.png`, `desktop-partner-hover.png` and
  `desktop-both-chooser.png`: owner details, hover evidence and confirmation.

All four main-view captures pass the page-width assertion. These are headless
desktop captures with a phone viewport, rather than measurements on Player 2’s device.
`checks.json` records the counts, identity comparison, command checks and widths.
See [performance evidence](performance.md) for the paired browser timings.

A separate fresh-server check exercises the optional foreground projection:
430 rows replace the 20,636-row compact catalogue while retaining all 368
personal completed rows and the empty backlog, with identical full-index facts
and sidebar counts. Turning Group view off with All possible tasks retained
restores 998 personal tasks. The existing category pagination initially paints
701 rows; header and category totals both retain all 998. The frozen hash stays
unchanged. This check uses its own third disposable server/profile.

The final `npm test` run passes all 2,116 tests with zero failures or skips
in 271.3 seconds. `SKILL_ICON_ASSET_ROOT` points to the existing read-only
`icons-skills.2026-10-08.v1` manifest under the main map-assets directory,
so the icon provenance checks run too. No prediction goldens or hashed data
change. The existing sandbox cache test caught a forced lazy parse introduced
while extracting shared cache insertion; the cancellation check now preserves
the sandbox byte path. The full rerun includes that correction.

The final 12-suite paired performance repeat meets the roughly 10% margin for
all reload/unlock medians in both modes; earlier varied-host failures remain
documented. The lazy peer worker adds about 1.21 GB RSS once used, with first
group-load conditioning around 5.1 → 10.5 seconds. All owned scratch servers,
browser processes and scratch stores close. The frozen private copy is removed
after rechecking its recorded hash; screenshots and scalar reports remain local.

## Changed files

- Sidebar: `app/web/duo-tasks.mjs`, `duo-task-view.mjs`, `duo-tasks.css`,
  `main.mjs` and `info-panels.mjs`.
- Projection and caching: `app/play-view.mjs`, `app/duo-play-view.mjs`,
  `app/server.mjs`, `app/tasks/scheduler.mjs` and `app/tasks/worker.mjs`.
- Checks: `scripts/review-duo-tasks.mjs`, `scripts/compare-cache-access.mjs`,
  `scripts/perf/page-load.mjs` and `scripts/perf/README.md`.
- New tests: `tests/duo-tasks.test.mjs`, `duo-web.test.mjs`,
  `duo-peer-view.test.mjs` and `duo-server.test.mjs`.
- Existing tests: `tests/info-panels.test.mjs`, `play-view.test.mjs`,
  `scheduler.test.mjs`, `task-ui-server.test.mjs`, `web-browser.test.mjs`,
  `web-personal.test.mjs` and `worker-timings.test.mjs`.
- Documentation: `README.md`, `docs/duo-task-view.md` and `docs/performance.md`.
