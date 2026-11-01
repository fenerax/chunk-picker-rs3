# R4: timed progress and port skills

START: e431da314b682946c27f601ec78f17eab8a790eb. Node v24.21.0.

## Decisions and evidence

The tracked public declarations contain 96 Timegated rows. START already supplements
six more through activity-timing.mjs, giving 102 effective tags. R4 adds **77**:
31 farm upgrades, 42 port progression rows, three whole breeding-log completion goals, and one long breeding goal.
The resulting effective total is **179**. Existing DnD tags are preserved; R4
adds only Timegated, without making every farm or port task a DnD.

- Farm growth and breeding run on real time, and normal animal buyers reset on
  daily or longer intervals: [Player-owned farm, revision 37110514](https://runescape.wiki/w/Player-owned_farm?oldid=37110514).
  Bean-funded pen/deed progression, breeding upgrades, traits, noted produce,
  farm hands and the bank chest form the farm-upgrade group:
  [Farmers' Market, revision 37212772](https://runescape.wiki/w/Farmers%27_Market?oldid=37212772).
  This is an activity-level rule choice, not a claim that every purchase takes
  weeks: that revision lists the bank upgrade at only 300 beans. The brief
  explicitly includes that upgrade; other bean-funded permanent upgrades use
  the same treatment, including both skill copies of each pen task.
- Port resources, scroll fragments, ship/crew/region progression, equipment
  achievements and score titles depend on repeated voyages:
  [Player-owned port, revision 37218482](https://runescape.wiki/w/Player-owned_port?oldid=37218482).
  The four trio-story helpers and their achievement are included:
  [Trip to the East, revision 36928186](https://runescape.wiki/w/Trip_to_the_East?oldid=36928186).
  Rows already tagged for voyages, regions, ships, crew and titles keep those tags.
- The complete breeding-log title requires repeated breeding across the farm,
  rather than one short cycle: [Old Mc, revision 36470558](https://runescape.wiki/w/Old_Mc?oldid=36470558),
  together with the growth/breeding facts in revision 37110514 above. The matching
  whole-log achievements use the same exclusion:
  [E-I-E-I-O, revision 37000345](https://runescape.wiki/w/E-I-E-I-O?oldid=37000345) and
  [E-I-E-DI-NO, revision 36763452](https://runescape.wiki/w/E-I-E-DI-NO?oldid=36763452).
  This closes the duplicate achievement route to a whole-log goal.
- Royal-dragon breeding needs a particular combination of three parent traits
  and a rare black-dragon offspring: [Royal dragon, revision 37176090](https://runescape.wiki/w/Royal_dragon?oldid=37176090).
  Its achievement already carries Timegated in the public data; the matching
  collection-log goal now does too, closing that duplicate route.

### Left without new tags

- Farm access and its tutorial; ordinary crop growth and individual animal
  births, including ordinary single-breed log entries (the royal-dragon exception
  is reviewed above): these goals describe one
  cycle, not completion of a multi-week activity. The existing tags are left
  intact, including already-tagged farm achievements.
- Port entry, its tutorial achievement and the twelve skill-unlock rows: access
  and skill training do not themselves require repeated voyages. PortSkills
  remains independent of Timegated.
- Farm-sourced herbicide/seedicide ownership rows: they accept the item, not a
  specific timed acquisition route. Alternative acquisition must stay valid.
- Ordinary Farmers' Market item stock stays usable, including animals for a
  single breeding cycle. The tagged bank, breeding-ability and farmhand upgrades
  are separate goals, absent from the declared item stock, so All Shops cannot
  recreate those unlocks through bare stock.
- Anachronia base-camp tasks: although workers gather resources over time, active
  skilling can supply resource packs, so elapsed time is not the only route:
  [Anachronia base camp, revision 37174576](https://runescape.wiki/w/Anachronia_base_camp?oldid=37174576).
- Dahmaroc's statue and its plinth: the weekly restriction was removed in 2021:
  [Shattered Heart, revision 37114197](https://runescape.wiki/w/Shattered_Heart?oldid=37114197).
- Ordinary clue locations mentioning a farm and unrelated farming shops are
  location checks, not farm progression. Existing monthly/weekly activity tags
  and the pre-existing Sinkhole/Big Chinchompa overlays remain in place.

### Every added tag (public declarations only)

Reason keys refer to the groups above; no save-derived labels are used here.

| Category | Task | Reason |
| --- | --- | --- |
| Construction | Build a second small pen in your player-owned farm | farm-upgrades |
| Construction | Build a medium pen in your player-owned farm | farm-upgrades |
| Construction | Build a second medium pen in your player-owned farm | farm-upgrades |
| Construction | Build a small dinosaur pen in your Ranch out of Time | farm-upgrades |
| Construction | Build a dinosaur breeding pen in your Ranch out of Time | farm-upgrades |
| Construction | Build a large pen in your player-owned farm | farm-upgrades |
| Construction | Build a second large pen in your player-owned farm | farm-upgrades |
| Construction | Build a medium dinosaur pen in your Ranch out of Time | farm-upgrades |
| Construction | Build a large dinosaur pen in your Ranch out of Time | farm-upgrades |
| Construction | Build a second large dinosaur pen in your Ranch out of Time | farm-upgrades |
| Farming | Build a second small pen in your player-owned farm | farm-upgrades |
| Farming | Build a medium pen in your player-owned farm | farm-upgrades |
| Farming | Build a small dinosaur pen in your Ranch out of Time | farm-upgrades |
| Farming | Build a dinosaur breeding pen in your Ranch out of Time | farm-upgrades |
| Farming | Build a large pen in your player-owned farm | farm-upgrades |
| Farming | Build a second medium pen in your player-owned farm | farm-upgrades |
| Farming | Build a second large pen in your player-owned farm | farm-upgrades |
| Farming | Build a medium dinosaur pen in your Ranch out of Time | farm-upgrades |
| Farming | Build a large dinosaur pen in your Ranch out of Time | farm-upgrades |
| Farming | Build a second large dinosaur pen in your Ranch out of Time | farm-upgrades |
| Quest | Spiritual Enlightenment (miniquest) 1 | port-progression |
| Diary | Completionist achievements#Completionist Cape Trip to the East | port-progression |
| Diary | Completionist achievements#Completionist Cape Walking the Reef | port-progression |
| Diary | Completionist achievements#Trimmed Completionist Cape E-I-E-DI-NO | farm-log |
| Diary | Completionist achievements#Trimmed Completionist Cape E-I-E-I-O | farm-log |
| Diary | Completionist achievements#Trimmed Completionist Cape Sandy  | port-progression |
| Diary | Completionist achievements#Trimmed Completionist Cape Scrolling in the Deep | port-progression |
| Diary | Activities achievements#Player-Owned Port Death Lotus Assassin | port-progression |
| Diary | Activities achievements#Player-Owned Port Seasinger | port-progression |
| Diary | Activities achievements#Player-Owned Port Tetsu Warrior | port-progression |
| Diary | Activities achievements#Player-Owned Port Complete the Player-Owned Port achievements | port-progression |
| Extra | (Dragons) Breed a royal dragon | farm-breeding |
| Extra | (Tetsu) Obtain a tetsu helm scroll | port-progression |
| Extra | (Tetsu) Obtain a tetsu body scroll | port-progression |
| Extra | (Tetsu) Obtain a tetsu platelegs scroll | port-progression |
| Extra | (Tetsu) Obtain a tetsu swords scroll | port-progression |
| Extra | (Death Lotus) Obtain a Death Lotus hood scroll | port-progression |
| Extra | (Death Lotus) Obtain a Death Lotus chestplate scroll | port-progression |
| Extra | (Death Lotus) Obtain a Death Lotus chaps scroll | port-progression |
| Extra | (Death Lotus) Obtain a Death Lotus darts scroll | port-progression |
| Extra | (Seasinger's) Obtain a seasinger's hood scroll | port-progression |
| Extra | (Seasinger's) Obtain a seasinger's robe top scroll | port-progression |
| Extra | (Seasinger's) Obtain a seasinger's robe bottom scroll | port-progression |
| Extra | (Seasinger's) Obtain a seasinger's wand/orb scroll | port-progression |
| Extra | (Scrimshaw) Obtain a log-splitting scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a rock-crushing scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a tree-shaking scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a gem-finding scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a whopper-baiting scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a casket-salvaging scrimshaw scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of vampyrism scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of attack scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of the elements scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of magic scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of cruelty scroll | port-progression |
| Extra | (Scrimshaw) Obtain a scrimshaw of ranging scroll | port-progression |
| Extra | (Other) Obtain a eastern soups scroll | port-progression |
| Extra | (Other) Obtain a leviathan ring scroll | port-progression |
| Extra | (Other) Obtain a reefwalker's cape scroll | port-progression |
| Extra | Build both small pens in your Player-Owned Farm | farm-upgrades |
| Extra | Build both medium pens in your Player-Owned Farm | farm-upgrades |
| Extra | Build both large pens in your Player-Owned Farm | farm-upgrades |
| Extra | Unlock the bank chest (player-owned farm) | farm-upgrades |
| Extra | Unlock the ability for animals in your Player-Owned Farm to breed in small pens | farm-upgrades |
| Extra | Unlock the ability for animals in your Player-Owned Farm to breed in medium pens | farm-upgrades |
| Extra | Unlock the ability for animals in your Player-Owned Farm to breed in large pens | farm-upgrades |
| Extra | Unlock all boosts to multiple traits for animals in your Player-Owned Farm | farm-upgrades |
| Extra | Unlock noted produce in your Player-Owned Farm | farm-upgrades |
| Extra | Unlock all farmhands at your Player-Owned Farm | farm-upgrades |
| Extra | Build a dinosaur breeding pen in the Ranch out of Time | farm-upgrades |
| Extra | Obtain the Old Mc title | farm-log |
| Nonskill | Obtain ports resources* | port-progression |
| Nonskill | Complete Trip to the East#Quin | port-progression |
| Nonskill | Complete Trip to the East#Hyu-Ji | port-progression |
| Nonskill | Complete Trip to the East#Eastern Curiosities | port-progression |
| Nonskill | Complete Trip to the East#Guardians of the World | port-progression |
| Nonskill | Collect Ports scrolls | port-progression |

## Rolling and indirect goals

The browser's renderRollControls and the core roll command do **not** enforce
completion of chunk tasks. They check write/busy state, a pending offer and the
candidate pool. No roll code change is needed. Tests roll successfully with
unfinished tasks for both Timegated values and check both roll buttons.

The engine's category gate blocks disabled timed rows during capability closure;
presentation excludes blocked rows. Task dependencies and output items therefore
cannot revive those rows. Kill X and drop collections need a reachable monster;
shop collections need actual eligible item-source proof. Synthetic tests cover
all of these paths. The Ports Reward Shop had a bare-stock bypass: its supplies
could generate All Shops or equipment goals without a voyage task. Its source
now requires Timegated. Alternative ordinary sources remain eligible.

The authored automatic-default table treated Timegated as on when unset.
R4 makes its automatic value false, as specified in the brief. PortSkills keeps
its existing automatic value; only its all-twelve requirement changes. Explicit
saved on/off values and inheritance keep their existing precedence.

## PortSkills

Before the fix, the synthetic 1/12 and 11/12 cases admitted 1 and 11 port goals.
After the fix, both admit zero; 12/12 admits all twelve. A shared eligibility check now requires all twelve unboosted level-90
capabilities before a PortSkills row can become available, in addition to its
existing access and rule requirements. Each adventurer retains its original
in-game requirements and estimates; the grouped condition does not rewrite them. The roster is backed by the port revision
above. Saved level caps still apply; already-reached personal levels also count
as capability evidence. None of these rows can bootstrap training by itself.

## Measurement method

scripts/perf/r4-timegated.mjs compares task rows, active presentation rows and
roll-pool entries against an explicit START worktree. Every request sends the complete state hash as its input fingerprint, so
fresh games at the same revision cannot share capability results. The public run uses full
rows; the private run uses the production play-v1 task-fact projection. That
projection retains every task ID and status and the active list, while omitting
unrelated information panels and internal records. Active IDs are resolved back
to their projected fact rows before comparison. A second START
worktree has only the timing overlay/source gate and Timegated default; the
START-to-intermediate difference is attributed to Timegated, and the
intermediate-to-final difference to PortSkills. Row changes include metadata and
explanation changes as well as availability; active additions/removals measure
the chunk-task list. Each view is aggregated across members per numbered state.

The public corpus has seven generated states: fresh solo, sparse duo, a fixed spread
of bases plus the farm and port entry bases with twelve skills reachable and
Timegated off/on, the same spread with one skill capped at 89 and Timegated
off/on, and an automatic-rule case on that spread. Collections
are enabled to expose indirect goals. The private sample uses seven evenly
spaced earlier standalone backup revisions and the current copied state, without
editing the source checkout. All calculations use process workers, one at a time.
Three complete paired repetitions check deterministic difference counts. Peak
process-tree RSS is sampled every 50 ms from PPid/VmRSS status records and can
miss shorter peaks. It sums the evaluator and calculator, excluding the driver;
shared pages can be counted twice. The public measurements shared the host with the quick suite; private measurements
run after the suite.
Timing is observational; there is no performance claim or full calculator-protocol gate.

Commands (with Node 24.20+ selected in every shell):

```sh
node scripts/perf/r4-timegated.mjs --baseline /tmp/r4-start --timing /tmp/r4-timing --candidate . --out /tmp/r4-public.json --runs 3
# For private inputs, set the required dataset/packs/defaults/process environment,
# then add --data-dir pointing to the disposable copy under /tmp and --view play-v1.
```

## Validation

The five focused files passed **71/71**, including **14/14** in the new file:

- tests/timegated-port-skills.test.mjs
- tests/automatic-rule-defaults.test.mjs
- tests/achievement-rules.test.mjs
- tests/collection.test.mjs
- tests/rule-explanations.test.mjs

The final npm run test:quick passed **2,995**, failed **0**, and skipped **68**
(3,063 total; 366.28 seconds). No full npm test was run. An earlier quick run
reported 2,992 passed, 1 failed and 68 skipped. Its release-copy fixture failed
because its git ls-files input omitted the new,
then-untracked module. Staging the new files fixed that fixture without changing
release code; the focused retry and subsequent complete quick runs passed.
The final diff whitespace check passed.

## Public comparison results

Canonical definition input SHA-256: f22f388671e193498d6112db85f92e7472dfa11a495b138692faf0fc5cd32029.
Three repetitions produced identical difference counts. A/R/C means added,
removed and changed rows, matched by stable ID. Status changes are included in
changed rows. Counts below are per state, summed across its members.

| State | Members | All rows A/R/C | Status changes | Active rows A/R/C | Pool differences |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 0/0/89 | 0 | 0/0/0 | 0 |
| 2 | 2 | 0/0/178 | 0 | 0/0/0 | 0 |
| 3 | 1 | 0/0/147 | 80 | 2/33/0 | 0 |
| 4 | 1 | 0/0/77 | 0 | 0/0/38 | 0 |
| 5 | 1 | 0/0/159 | 90 | 5/39/0 | 0 |
| 6 | 1 | 0/0/94 | 19 | 4/11/37 | 0 |
| 7 | 1 | 0/23/476 | 226 | 2/161/1 | 0 |

Attribution uses the intermediate timing-only version described above. Phase
counts are not additive: the same ID can change in both stages, and presentation
replacements can overlap.

| Comparison | All rows A/R/C | Status changes | Active rows A/R/C | Pool differences |
| --- | --- | --- | --- | --- |
| total | 0/23/1220 | 415 | 13/244/76 | 0 |
| Timegated | 0/23/1155 | 385 | 6/227/77 | 0 |
| PortSkills | 0/0/70 | 30 | 8/18/0 | 0 |

The twelve-ready states have no PortSkills differences. The eleven-ready
states lose the individual port goals and dependent availability; presentation
can replace a removed highest-priority goal with another eligible goal. This
explains active additions even though this rule adds no declarations. Raw-row
changes also include the extra blocker explanation on already-blocked port goals.
Timing changes include the 77 new tags, their dependent capabilities and the
automatic-off correction. With Timegated explicitly on and all twelve skills
reachable, the observed active differences are tag metadata only. The final
explanation text is included in the candidate dataset digest; canonical source
definitions and sampled state hashes are checked independently for equality.

Durations cover the complete eight-member-evaluation sample, including startup
and roll-pool requests. Values are median [minimum, maximum] over three runs.
Evaluation duration summarizes the individual evaluate calls across those runs.

| Version | Sample wall seconds | Evaluate milliseconds | Peak tree RSS MiB |
| --- | --- | --- | --- |
| before | 43.94 [39.97, 51.20] | 3580.38 [2189.51, 4287.83] | 2399.72 [2371.57, 2431.93] |
| timingOnly | 43.67 [32.55, 45.38] | 3380.38 [2170.33, 4326.89] | 2419.91 [2320.70, 2464.43] |
| after | 40.31 [33.57, 48.68] | 3113.21 [2250.79, 4169.11] | 2409.64 [2403.07, 2427.34] |

## Private eight-state comparison results

Three repetitions produced identical counts. Each state contains two member
evaluations; the table sums both. Only counts, hashes, sizes and measurements
from private inputs are recorded here. A/R/C has the same meaning as above.

| State | All task facts A/R/C | Status changes | Active rows A/R/C | Pool differences |
| --- | --- | --- | --- | --- |
| 1 | 0/0/4 | 4 | 0/0/0 | 0 |
| 2 | 0/0/0 | 0 | 0/0/0 | 0 |
| 3 | 0/0/0 | 0 | 0/0/0 | 0 |
| 4 | 0/0/0 | 0 | 0/0/0 | 0 |
| 5 | 0/0/0 | 0 | 0/0/0 | 0 |
| 6 | 0/0/0 | 0 | 0/0/0 | 0 |
| 7 | 0/0/0 | 0 | 0/0/0 | 0 |
| 8 | 0/0/0 | 0 | 0/0/0 | 0 |

| Comparison | All task facts A/R/C | Status changes | Active rows A/R/C | Pool differences |
| --- | --- | --- | --- | --- |
| total | 0/0/4 | 4 | 0/0/0 | 0 |
| Timegated | 0/0/4 | 4 | 0/0/0 | 0 |
| PortSkills | 0/0/0 | 0 | 0/0/0 | 0 |

Canonical definition input SHA-256: f22f388671e193498d6112db85f92e7472dfa11a495b138692faf0fc5cd32029.
Source and disposable-copy state size: 766384 bytes each.
Source and disposable-copy state SHA-256: 64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc.
Final byte difference count: 0. Private checkout changed-path count: 0.

Whole-sample duration includes all sixteen member evaluations, startup and pool
requests. Values are median [minimum, maximum] over three runs. Evaluation
duration summarizes the individual evaluate calls across those runs.

| Version | Sample wall seconds | Evaluate milliseconds | Peak tree RSS MiB |
| --- | --- | --- | --- |
| before | 160.60 [140.31, 165.06] | 4829.37 [916.05, 8866.04] | 4547.48 [4092.50, 4832.18] |
| timingOnly | 144.09 [140.08, 149.89] | 4486.66 [754.19, 8227.84] | 4131.42 [3992.32, 4140.14] |
| after | 162.80 [146.22, 169.53] | 5053.06 [787.69, 8158.50] | 4688.19 [4555.46, 4950.29] |

The measured before/after ranges overlap; these are observational measurements,
with no speed or memory improvement claim. The RSS values cover a complete
multi-state run, not one production picker.

## Files and review limits

| File | Change |
| --- | --- |
| app/data/activity-timing.mjs | Supplements timing tags for the reviewed progression groups and gates Ports Reward Shop stock. |
| app/data/port-skills.mjs | Checks whether all twelve port skills can reach 90. |
| app/tasks/engine.mjs | Applies the shared port-skill eligibility check during capability evaluation. |
| app/tasks/rule-defaults.mjs | Makes the automatic Timegated value false; preserves the PortSkills default. |
| app/data/rule-explanations.2026-10-17.v1.json | Explains the timing exclusion and all-twelve condition in plain English, with pinned sources. |
| tests/timegated-port-skills.test.mjs | Adds fourteen synthetic regression tests. |
| scripts/test-selection.mjs | Classifies the new test file as quick. |
| scripts/perf/r4-timegated.mjs | Provides the sequential comparison and count-only private sampling harness. |
| docs/qa/r4-timegated.md | Records classification decisions, evidence, validation and measurements. |

The farm-upgrade group deliberately includes cheap deeds as well as expensive
unlocks, following the brief's explicit inclusion of the cheap bank upgrade.
Individual births and crop cycles are excluded from the added tags. New or
renamed pack records need another audit of these reviewed matches. Already
released rules-text packs retain their old explanations until rebuilt from the
updated tracked text. The comparison covers the stated corpus, not every possible
save or calculator request, or result ordering. Whole-sample RSS is not a per-picker deployment
estimate. No deployment or performance improvement is claimed.
