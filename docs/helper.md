# RuneScape Helper

The top bar's **Helper** opens an accompanying page inside the signed-in picker.
It keeps the current player and has its own Player 1/Player 2 selector, which also
switches the picker's viewer. **Back to picker** or Escape returns to the map.
Mining pickaxe/attention, Woodcutting hatchet, Drop/Bank and owned-box choices save personal preferences through the normal
revision-checked command, with History and Undo. The planning tools do not change
account progress or check a task. View-only links never offer these controls.
The existing administrator and invitation rules apply to every data request.

## Tools

**Grind planner** uses `/api/training-catalogue` and the existing authenticated
`/api/training-plan` endpoint. Its starting level and exact XP come from the
selected member's current-account RuneMetrics observation. A renamed account or
missing observation asks for a temporary level; this is never saved. Choose an
active task's level or enter a target. The plan uses that player's quests and
admitted source access, including the partner's connected chunks under the
confirmed return-route rule. Shared task checks do not become personal XP or
quest completion.

The planner shows the fastest reviewed route, usable methods, the next faster
method that the catalogue knows about, and what blocks it. All methods and targets
respect F2P caps; available members-skill trials are explicitly labelled. There
are no Grand Exchange prices or purchase/sale routes. Resource totals describe
consumption, not items owned. Gather inputs or obtain them from reachable shops;
supplies can come from this duo's group bank or partner. Processing time excludes
gathering and travel unless the method's notes include them. Unknown rates,
variable yields, burn chances and missing supply times stay unknown. Actions/hour
is estimated XP/hour divided by reviewed XP/action only when both are known.
Recipe intervals alone do not invent a measured rate.

Mining uses the generated offline table in
`app/data/training/mining-rates.v1.json` for all ten supported F2P ores: copper, tin,
iron, coal, silver, mithril, adamantite, luminite, gold and runite. XP/hour and
ore/hour are separate estimates. Saved Mining and Strength levels choose the
rate; missing Strength is explicitly assumed to be level 1. Without a saved
Mining observation, the existing temporary starting-level field still works.
Time to a target adds each level's XP gap divided by that level's rate, keeping
the current exact XP when known. Woodcutting and Fishing also use level curves; skills
without a curve keep their reviewed fixed rates.

Settings → **Time estimates** and the Helper's Mining view share the selected
player's **Mining pickaxe** and **Mining attention** preferences. The automatic
choice assumes the best F2P pickaxe allowed by Mining level, including upgrades;
it improves as the plan levels up. This is an estimate assumption, not a claim
that the player owns the tool. Choosing a specific pickaxe keeps it throughout
the plan. Active keeps stamina full. Occasional assumes partial stamina (90%
damage). AFK assumes stamina has already run out (20% damage), excluding the
short initial full-stamina period. Below Mining 15, stamina has not unlocked and
all three profiles use full damage.

Drop rates use the at-rock curve. Bank rates add the walking cycle described
below. Rockertunities, stone spirits and extra XP/equipment bonuses are
excluded. Advanced mode adds expected damage per swing, swings per
ore, stamina factor and pinned source revisions. Ore is never estimated by
dividing XP/hour by the catalogue's old XP/action value. The sourced rules,
generation and comparison with the wiki calculator are documented in
[Step 1: Mining](research/gathering-calculator.md#step-1-mining).

Woodcutting uses `app/data/training/woodcutting-rates.v1.json` for normal, oak,
willow, teak, maple, acadia and yew trees. Saved Woodcutting and the player's
**Woodcutting hatchet** preference choose the rate. Settings → **Time estimates**
and the Helper's Woodcutting view share that preference, with History and Undo.
The default assumes the best F2P hatchet allowed at each level, through rune;
choosing a specific hatchet keeps it throughout the plan. An under-level hatchet
choice asks for a usable hatchet. Tool assumptions do not prove ownership.

Four-tick attempts use the pinned wiki calculator's scaled, separately floored
success interpolation and denominator 2,560,000. XP/hour equals logs/hour times
the tree's base XP/log. Time adds each level's exact remaining XP divided by that
level's rate, including automatic hatchet upgrades. Expected log totals use
the same curve. Rates display as whole numbers.

The drop curve waits for one
tree's full respawn after it falls, then resumes immediately. Its expected
seconds per log are `2.4 / chopChance + fellingChance * respawnSeconds`. Normal
trees use provisional depletion data and an assumed midpoint respawn of 47.1
seconds. Bank rates add walking and owned wood-box storage. Nearby-tree switching, click delays, nests, spirits,
boosts and extra XP/log bonuses are excluded. Current hatchet powers already
include the April 2026 aura overhaul. There is no attention control because no
documented Woodcutting attention schedule is modelled. Advanced adds chop chance,
attempts per log, felling/respawn downtime and pinned source revisions. View-only
links show no preference controls.

Six F2P Daemonheim tree types use dungeon-only hatchets and finite, non-respawning
nodes. Their coverage records retain known XP/unlocks but mark hourly rates
unknown because the pinned sources do not supply success parameters. They are
outside the overworld training catalogue. See
[Step 2: Woodcutting](research/gathering-calculator.md#step-2-woodcutting)
for source fixtures, rounding differences and validation results.

Fishing uses `app/data/training/fishing-rates.v1.json` for small-net shrimp and
anchovies, crayfish, baited sardine and herring, fly-fished trout and salmon,
pike, lobster, harpooned tuna and swordfish, and Ashdale/Davendale minnows. Tools select
the method; there is no tool-tier or attention setting. Bait and feathers must
have a reachable source, and their expected consumption follows successful
catches. The original drop/keep method IDs remain compatible. **Finish each
backpack → Bank** adds walking routes and keeps every eligible caught species.

Each attempt rolls the eligible species in the pinned calculator's order:
anchovies before shrimp, herring before sardine, salmon before trout, swordfish
before tuna. Later rolls run only after earlier rolls fail. Locked species have
zero output until their unlock. Attempts take four ticks, or five for harpooning.
The Helper shows whole XP/hour and fish/hour, each species for mixed catches,
and expected catch totals. Time to a target sums each level's exact XP gap over
that level's rate; bait and each species accumulate over the same intervals.
Methods without curves retain their existing behavior.

Drop rates exclude travel and handling; Bank rates add the walking cycle.
Boosts, urns, outfits and other bonuses are excluded. No relocation timer is
invented. Advanced shows attempt timing, raw roll chances, conditional catch
chances, their order and pinned source revisions. These are calculator-based
estimates, not measured elapsed rates. Special Daemonheim, puzzle and monthly
Giant Oyster catches are recorded separately as unknown hourly rates. See
[Step 3: Fishing](research/gathering-calculator.md#step-3-fishing)
for the source snapshots, numerical validation and coverage limits.

**Drop or bank** compares XP/hour and resources/hour at each reviewed physical
spot. Bank selects the nearest reviewed usable surface bank, deposit box or
eligible Stiles fish-noting point inside the player's admitted chunks. Walking
uses exact copied-cache collision, walls and conservative diagonal steps,
including the return trip. F2P players use free tiles and free services only.
No reachable bank and missing route evidence have different messages. Extra
spots remain available under **More spots**.

**Finish each backpack**, **Ore box owned** and **Wood box owned** are personal
choices in Helper and Settings → Time estimates. Defaults are Drop and None;
obtainability never grants ownership. Bank target times use the fastest usable
spot at each level. A box takes one backpack slot and shares contents with its
duplicates; supported ores/logs each get their own capacity. Fishing reserves
one bait/feather slot when needed. Stiles notes only tuna, lobster and swordfish
at (2851,3143), and repeated trips reserve each retained noted stack.

Settings → Advanced reveals coordinates, chunks, capacity, handling and an
energy-aware running scenario. Walking remains the plan default. Handling
assumes three seconds at the destination and 1.2 seconds per box fill/empty;
these are estimates. Drop assumes immediate dropping. Tools are equipped or on
the tool belt, with no other carried items. Running assumes low weight and
uncertain 0.7% drain per tick / 0.8% recovery per second, carrying energy through
gathering, both legs and handling across repeated cycles. It never resets energy
for each trip.

Coverage is conservative: closed doors may hide actual routes. Untyped normal
trees, unlocated minnows, unreviewed services and upstairs/interior banks remain
unknown. Fishing uses sourced possible map positions; active spots and moving
times were not observed. Lodestones, Surge, metal-bank routes and processing
cycles are left for separately verified variants. See
[Step 4: Banking](research/gathering-calculator.md#step-4-banking).

The death estimator retains its previous guide profiles and handling allowance
in `app/data/training/death-woodcutting-guide.v1.json` for its existing
self-supplied log routes. It does not substitute Helper's at-tree rate for a
route that previously included handling. Updating those supply routes with
banking and personal tools remains a later step.

**Our chunk goals** reads only task results already loaded by the picker, using
the existing presentation, completion families and personal task scope. It
compares saved levels with each skill's highest active target and offers grinds
that meet more level goals. It deliberately says “meets level goals”, rather than
claiming training finishes quests, obtains items, or completes whole tasks. A
compact task result retains the main skill level and a small `skillRequirements`
map of numeric cross-skill gates. Full task details also work. It never fetches a full
task result, starts a worker, or runs a second calculation for the graph. If the
player's results are still loading, it waits for the normal picker request.
An SVG graph is paired with a captioned table, and expandable task names explain
the counts. **Plan Mining to 30**, for example, carries the target into the planner.

**Drop chances** accepts 1/N and separate player/partner kill counts. It computes
`P(at least one) = 1 - (1 - 1/N)^kills` with stable `log1p`/`expm1` arithmetic.
For 50%, 90% and 99%, it rounds up the log-ratio to whole kills and shows how many
more are needed from the entered total. Guaranteed drops and zero kills have
explicit boundaries; counts beyond safe integer precision stay unknown.
Combining kills assumes identical, independent rates. It does not model bad luck
protection, special loot rolls, or claim that previous kills increase next-kill
odds. The curve has a table with the same kill/chance data.

The authenticated `/api/helper-drops?memberId=…` projects only admitted item drop
sources from the existing task evaluation. It uses the existing scheduler/cache
and creates no new worker or resident cache. Item/source membership and reachable
chunks have already been checked by that evaluation. Reachability does not prove
combat readiness or stock ownership. Unknown/zero/malformed rates are omitted,
and duplicate location evidence is collapsed. Separate loot rolls are explicitly
labelled: they are not blindly added into an unverified overall item chance.
If an item appears in several rolls, use a verified overall rate for its any-drop
chance. If the picker uses members rules,
the chunk list is hidden; manual rates remain usable. Search limits the dropdown
to 100 matches to avoid thousands of resident option nodes.

**XP & combat** includes standard XP-to-level and level-to-XP lookup through level
120, excluding Invention's different curve, plus the existing F2P combat formula.
Combat fields begin with saved personal levels; missing fields visibly start at
1. The formula ignores Summoning and caps Necromancy at 20 in F2P. Temporary
changes never alter saved levels. The saved-level table makes missing observations
visible. These small tools answer common level and combat questions without
another account sync or a trip to a separate calculator.

**Progress** reads `/api/helper-progress` without a task evaluation or worker.
It compares saved totals for every player and the duo: unlocked chunks, personally
checked/completed tasks, actual quest points, total level and combat level. Duo
chunks and completion families are unions; quest points and levels sum the accounts.
Challenge ticks do not grant quest points or skill levels. Missing or renamed-account
skill observations remain unknown, and an incomplete skill set never becomes a
fabricated total. Combat uses the existing formula and current F2P rule.

Four SVGs show weekly net chunk/task changes and quest-point/total-level counts.
Each has an accessible captioned table. Weeks start Monday in UTC. History is
reconstructed backwards from validated undo evidence, including selective Undo;
unsupported evidence, restore and catalogue changes create an explicit boundary.
The first count is a baseline, not progress earned that week. Saved/synced dates
are not claimed as play dates. Current-account RuneMetrics observations can add
earlier skill or quest-point totals only when their complete same-time evidence
supports an account total. Missing totals break the graph line.

The store records `progressSnapshots` at startup and normal durable saves, outside
commands and without changing revision or History. One latest numeric tuple per
UTC day stores five counts per player plus the duo counts. It contains no task
lists, XP or daily identity trees; member IDs appear once. Up to 3,660 observed
days (about ten years) fit below 400 KB for the duo and survive portable backups,
restore and restart. A visible notice marks retention when that cap is reached.
No timer wakes the server for a daily write; days without saves have no new row.
The automatic record is independent of opening Helper; the Progress read itself
does not write. Snapshots stay outside map responses, calculation inputs and
gameplay fingerprints. Line graphs draw a bounded number of points; weekly bars
remain exact. Large tables are created only while their disclosure is open.

The short recap is plain text suitable for a stream or Discord, for example
“This week: 3 chunks, 41 tasks, +6 quest points.” It reports net saved changes;
partial weeks and missing quest counts are labelled in the text.

## Sources and pinned revisions

No new live Wiki request is needed. Training reuses the reviewed, pinned snapshots
in `app/data/training/methods.f2p.json` (schema 2), with the full source
and assumption record in [training helper research](research/training-helper.md).
The UI links each used source to its retained `oldid` and lists its revision.
Representative rate sources:

| Source | Wiki revision |
| --- | ---: |
| F2P Woodcutting training | 37158607 |
| Bonfire | 37199967 |
| Acadia logs | 37161702 |
| F2P Mining training | 37176494 |
| F2P Smithing training | 37075358 |
| F2P Fishing training | 37189069 |
| Bowstring | 37198222 |
| F2P Crafting training | 37052646 |
| F2P Prayer training | 37157797 |

The combat formula reuses `app/core/combat-level.mjs` and its provenance in
`app/data/combat-level-formula.2026-10-09.v1.json`: **Combat level** revision
37182070 and **Module:Calculator/Combat level** revision 37009630. The standard
XP curve reuses `app/core/experience.mjs`. Drop rates retain the picker's imported
drop evidence and composed source probabilities; they are labelled saved picker
data, not newly verified current Wiki rates. Existing dataset provenance/hashes
and LF rules are unchanged.

## Extension and memory

`app/web/helper.mjs` owns the shell and a small `helperSections` registry. Each
section exports a renderer returning a disposal function. **Progress** lives in
`helper-progress.mjs`, with pure dated graph/recap projections in
`helper-progress-model.mjs`. New browser files must be added to the server's static
allow-list. The main integration is one import and one initialization line; each
test harness that executes it stubs that initialization.

Optional `dispose.getDraft()` returns only temporary input values, kept separately
for each player and section while Helper is open. `dispose.refreshResult()` lets
the planner refresh task targets without resetting a pending plan or typed levels.
New task results do not remount the drop or XP calculators. Save revisions use
fresh personal observations while retaining explicit temporary inputs; closing
Helper clears all drafts. No drafts are written to storage or to the save.

Only the shell loads with the map. CSS and section modules load on opening Helper;
the training catalogue and drop list are requested only in their sections. Player
changes, save revisions, section changes and closing dispose pending reads. Plans
and drop responses must match the locally displayed save revision.
The shell checks the existing result pointer while visible and holds no timer
while closed. Charts are small hand-authored SVGs with text labels and accessible
tables; they use the existing warm-ledger palette in dark, gray and light themes.
No runtime dependencies, extra background workers, or persistent data caches are
added.

Mining rules and table generation add no background work. The table covers
Mining 1–110 and Strength 1–120, preserving the catalogue's existing F2P caps
while supplying all requested levels 1–99. The estimate preferences are saved;
temporary target/start fields remain drafts. Existing viewer permissions still
prevent new training-plan calculations.

## Copied-save verification — October 12

Progress was also checked on an isolated revision-97 copy. All saved gameplay,
provenance and revision remained unchanged; only the automatic daily-count row
was added at startup. Opening Progress sent no commands and made no writes.
Personal graphs, duo graphs, all four accessible tables, and the recap were
checked. Before and after totals were identical:

| Saved total | Player 1 before → after | Player 2 before → after | Duo before → after |
| --- | ---: | ---: | ---: |
| Chunks unlocked | 158 → 158 | 114 → 114 | 163 → 163 |
| Tasks completed | 119 → 119 | 285 → 285 | 394 → 394 |
| Recorded quest points | 19 → 19 | 0 → 0 | 19 → 19 |
| Total level | 976 → 976 | Unknown → unknown | Unknown → unknown |
| Combat level | 78 → 78 | Unknown → unknown | Unknown → unknown |

Player 2's zero is the picker's recorded personal quest-point sum, not a claim about
his current in-game account. His unsynced levels stay unknown. Retained History
has 64 usable count points beginning October 9 at the latest restore/catalogue
boundary; daily counts begin October 12. The copied save's current Monday recap
is “This week: 0 chunks, 0 tasks, +0 quest points.” The preceding partial week
shows four new distinct duo chunks and 12 net task checks.

All six desktop (1440px) and narrow (390px) dark/gray/light layouts fit without
page-width overflow. An independent screenshot review confirmed the final
numeric alignment and chart label size. Captures are under
`.local/screenshots/progress-{desktop,390px}-{dark,gray,light}.png`; the compact
report is `.local/progress-browser-report.json`. The exported backup includes the
165-byte daily row. [Performance](performance.md#helper-progress--october-12)
records serial measurements and their limits.

Progress's final `npm test -- --test-concurrency=1`: **2,400 tests**, **2,399
passed**, zero failures/cancellations and one existing generated-PNG skip, in
**752.30 seconds**. The restart/no-write regression passes. Owned browser and
performance processes are closed; private save copies and the archived baseline
have been deleted. Local captures and reports remain ignored in this worktree.

An isolated copy of the real duo save was checked through the normal signed-in
browser and APIs. Its state file SHA-256 and the complete play-state response
stayed unchanged; the browser sent no save commands and reported no exceptions.
Player 1's saved Firemaking stayed **65 → 65**, and Player 2's unsynced Firemaking
stayed **unknown → unknown**. Their active task lists stayed **25 → 25** and
**26 → 26**, respectively.

- Player 1, Firemaking 65 → 70: **282,995.3 XP**, **2,696 willow bonfire logs**,
  about **3.9 hours** of estimated processing.
- Player 2, temporary Firemaking 42 → 60: **228,213 XP**, **2,174 willow bonfire logs**,
  about **3.2 hours** of estimated processing. Level 42 is an input for this example,
  not a saved observation.

Both estimates exclude gathering and travel. The browser also checked the goals
chart/table, combined drop odds, XP/combat tools and retention of unsent values
between sections. Desktop gray (1440px) and mobile light (390px) captures have
no page-width overflow. Reports and screenshots remain ignored under
`.local/helper-verification.json` and `.local/screenshots/helper-*.png`.
Performance measurements and their limits are in [performance.md](performance.md#helper--october-12).

Final `npm test -- --test-concurrency=1`: **2,379 tests**, **2,378 passed**, zero
failures/cancellations, one existing generated-PNG check skipped, in **773.68s**.
Helper tests cover personal/alias scope, trial caps, XP and drop boundaries,
authenticated reads, stale/aborted responses, target refresh and temporary drafts.
All owned scratch servers and Chrome processes closed; the private save copy and
archived baseline source were deleted after verification. Prediction goldens and
data provenance hashes are unchanged.
