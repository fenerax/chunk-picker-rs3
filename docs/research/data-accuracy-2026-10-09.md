# Data accuracy review — 2026-10-09

Implemented on `codex/dataacc`, based on deployed `10f75a6`. All checks use a
frozen copy of duo revision 41 inside this worktree. The copied state identity is
`f902ba633b02d1a7bcee5746faa984d3c4b7ce77dc2aa595875e873ec39154de`.
The main checkout, live picker, original save, game client and Tailscale were not
changed. Servers and fresh headless Chrome profiles use disposable localhost ports.

## 1. Informational skill-guide thresholds

Every generated `Skill guide unlock` was reviewed. There are exactly four:

| Milestone | Level | Cache struct | Pinned Wiki evidence |
| --- | ---: | ---: | --- |
| Standard no-burn shrimps | 34 | 33701 | [Shrimps 36950896](https://runescape.wiki/w/Special:PermanentLink/36950896) |
| Standard no-burn crayfish | 34 | 33702 | [Crayfish 36950894](https://runescape.wiki/w/Special:PermanentLink/36950894) |
| Standard no-burn trout | 49 | 33713 | [Trout 36953398](https://runescape.wiki/w/Special:PermanentLink/36953398) |
| Standard no-burn lobster | 74 | 33730 | [Lobster 36953382](https://runescape.wiki/w/Special:PermanentLink/36953382) |

Their exact ingredient/object selectors, entry IDs, cache provenance and Wiki
revisions remain in `skill-guides.2026-10-08.v1.json`. None produces an item,
reward or XP action. `tasks.cache-skill-guide` now admits productive guide actions;
these informational thresholds additionally require **Optional skill-guide
milestones** (`tasks.skill-guide-milestones`), which defaults off even when the
older cache-guide switch was already saved as true. The guide catalogue and its
authenticated information endpoint retain all entries and thresholds. Existing
IDs and saved completion facts survive. Toggling the new rule reverses the goals
without inventing item outputs or changing the actual cooking recipes.

| Player | Active guide milestones before | Active after | Possible guide obligations before → after |
| --- | --- | --- | ---: |
| Player 1 | Lobster, `rs3:task:skill-guide:cooking-no-burn:33730` | None | 4 → 0 |
| Player 2 | Lobster, `rs3:task:skill-guide:cooking-no-burn:33730` | None | 4 → 0 |

Shrimps, crayfish and trout were available obligations for both players but were
suppressed by the saved highest-level presentation rule. They were not active
rows. The four informational milestones are absent from ordinary capability
closure after the change; a productive synthetic guide action still enters with
the original task switch, preserving that switch's tested intent.

## 2. War's Retreat and the retained level audit

The current entry requirement is **Combat 60 OR total level 1,000**. Combat 60 is
a genuine alternative, rather than a recommendation. The separate teleport
requires **10 total boss kills** and unlocking it from War's Wares. There is no
five-distinct-boss requirement. [Entry 37178109](https://runescape.wiki/w/Special:PermanentLink/37178109),
[teleport 37177732](https://runescape.wiki/w/Special:PermanentLink/37177732),
[War's Wares 37136616](https://runescape.wiki/w/Special:PermanentLink/37136616).

`rs3:task:0003c5` retains its identity, label, chunk 12339, primary flag and priority.
Its neutral `Level:1` no longer imposes one mandatory skill gate; the reviewed
record instead contains `RequirementAlternatives:[{Skills:{Combat:60}},
{TotalLevelNeeded:1000}]` and explains entry versus the boss-kill teleport unlock.
The compact row omits that neutral level, and the presentation engine keeps the
entry goal independent of higher training milestones while respecting skill-task
display settings. Genuine levels on other alternative-requirement rows remain.
The engine evaluates OR between clauses and AND within each clause. Invalid
alternative metadata fails closed. This access task creates no boss-kill fact,
teleport confirmation or personal unlock.

Both copied-save players retain an **available personal obligation** for entry
before and after. Their record changes from the Combat-60-only gate to the true
alternatives and explanatory description. The engine now derives conservative
base Combat from known personal skills, so an observed Combat-60 character need
not have a currently reachable combat-training method to qualify. The formula
includes Necromancy, excludes virtual levels and uses the pinned calculator's
F2P handling. [Formula 37182070](https://runescape.wiki/w/Special:PermanentLink/37182070),
[calculator 37009630](https://runescape.wiki/w/Special:PermanentLink/37009630).
The formula artifact records the calculator/prose discrepancy for F2P Summoning.

The audit searched all **20,375 retained task rows** for recommendation wording
and independently reviewed all **41 numeric Combat-gated rows** against **31
pinned pages**. It found **zero confirmed recommendation-as-requirement cases**.
That is a bounded audit, not verification of every numeric field in every skill.
`On the Warpath` mentions a recommended level but its achievement explicitly
requires Combat 60. [Achievement 36637012](https://runescape.wiki/w/Special:PermanentLink/36637012).

Two adjacent issues are documented, without adding unrelated corrections:
Warriors' Guild tasks `000364`/`001c51` omit sum-130/level-99 entry alternatives;
Mandrith's Combat mirror `0003c3` says Slayer 85 while the current requirement and
canonical Slayer row say 95. See the [complete retained-task audit](retained-task-requirements-2026-10-09.md).

## 3. Shantay and Anachronia travel

| Requested route | Previous data | Change | F2P outcome |
| --- | --- | --- | --- |
| Shantay ↔ North Pollnivneach | Missing | Added carpet route | Hidden; members-only |
| Shantay ↔ South Pollnivneach | Missing | Added distinct station and route | Hidden; members-only |
| Shantay ↔ Menaphos | Missing | Added carpet route | Hidden; members-only; southern quest gate retained |
| Shantay ↔ Sophanem | Missing | Added carpet route | Hidden; members-only; southern quest gate retained |
| Anachronia Stormbreaker ship | Present | Preserved | Hidden as members travel; seeing a boat on a F2P world does not permit sailing |
| Anachronia lodestone | Present | Preserved | Hidden; members-only; typed route retains activation confirmation |
| Anachronia Teleport, three totem destinations | Missing | Added three personal destinations | Hidden; members-only |
| North-western Anachronia Teleport | Missing | Added spell destination | Hidden; members-only |
| Eastern Anachronia Teleport | Missing | Added spell destination | Hidden; members-only |
| Anachronia tablet to Player Lodge | Missing | Added destination and requirements | Hidden; members-only; cache plane remains unresolved |

Pollnivneach, Menaphos and Sophanem travel are members content. The requested
absence was therefore partly missing data and partly membership restriction.
The ten additions comprise four carpet
routes and six teleport records. The new catalogue has **237
routes** (51 free, 186 members). No requested route becomes usable for either
copied-save player. `/api/map-info` now projects known members-only connections
and teleport destinations out of the F2P response, with separate cached ETags
for free and members views. The immutable full catalogue remains available as
evidence. Reload the map after changing membership mode to refresh its separately
loaded reference payload. The ordinary surface-lodestone house rule derives
activation from reaching an admitted chunk; the explicit typed transport route
retains its personal confirmation gate.

All old connections and walking records survive the extension. Ten new exact
anchors have component-mask witnesses. The tablet's pinned map coordinate,
represented on plane 0, has a cache source-plane mismatch, so access fails closed
without a guessed nearby landing. Fares, spell levels, runes, quests and personal confirmations are
retained per route. The [route-by-route evidence report](transport-membership-audit.2026-10-09.v1.md)
links every Wiki revision and explains this bounded catalogue's limits.

## 4. Task item icons

All 50 Team cape images were already catalogued and their PNGs present. Rows
carrying `equipmentName` could already resolve them; their observed browser
absence is also explained by the withheld installed bundle described below.
Plain `Obtain a Team-1 cape` rows without that metadata bypassed the former
first-marker-only resolver. The shared resolver now
tries `equipmentName`, `item`, every complete `~|marked|~` item, and anchored
`Obtain X` labels before falling back to the skill icon. The compact play
projection retains an explicit `item` field. Unknown names still return no match.

All **63** retained tier-qualified Skull lantern, Death guard and Deathwarden
items were missing. Their Wiki page titles carry `(tier N)` while their infoboxes
use the short family name. The new exact-title/tier/state review adds tiers
10–90 for both weapons and all five armour slots, without stripping tiers or
guessing a bare-family identity. Every infobox state must agree on its inventory
image. Examples: [Skull lantern tier 10, 36962233](https://runescape.wiki/w/Special:PermanentLink/36962233),
[Death guard tier 10, 36962221](https://runescape.wiki/w/Special:PermanentLink/36962221).
The [binding review](item-icon-review.2026-10-09.v1.json) pins all 63 pages and
image revisions. Membership eligibility remains separate from artwork lookup.
When the catalogue arrives after task rows, a deferred painter now fills their
icons and category-heading icons directly. It preserves existing controls,
focus and drafts instead of repeating the complete task selection/render pass.
Failed loads and discarded rows release their pending references.

| Player | View | Catalogue item matches before | After | Skill fallback before → after | Iconless before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| Player 1 | Presented | 5 / 18 (27.8%) | 8 / 17 (47.1%) | 2 → 1 | 11 → 8 |
| Player 1 | Possible | 724 / 1,332 (54.4%) | 732 / 1,328 (55.1%) | 252 → 248 | 356 → 348 |
| Player 1 | All possible, hide completed | 586 / 1,010 (58.0%) | 593 / 1,006 (58.9%) | 208 → 204 | 216 → 209 |
| Player 2 | Presented | 5 / 17 (29.4%) | 8 / 16 (50.0%) | 2 → 1 | 10 → 7 |
| Player 2 | Possible | 716 / 1,319 (54.3%) | 724 / 1,315 (55.1%) | 250 → 246 | 353 → 345 |
| Player 2 | All possible, hide completed | 581 / 999 (58.2%) | 588 / 995 (59.1%) | 204 → 200 | 214 → 207 |

“Presented” counts available, visible personal rows selected by the presentation
engine; “possible” additionally includes suppressed methods. Counts include
completed rows, with separate active counts retained in the local summaries.
For this copied fixture, presented and active counts coincide. Item coverage is
measured on the actual compact row fields using the old and new resolvers.
Skill fallback and iconless rows are recorded separately; information tasks with
no named item are not assigned arbitrary item artwork.
“All possible, hide completed” additionally excludes completed groups and backlog,
matching that UI combination. The status-line engine count is broader and includes
available rows outside personal display eligibility: Player 1 1,590 → 1,586, Player 2
1,577 → 1,573. It is not the denominator for personal icon coverage.

The copied old item bundle also exposed an installation fault: its
`source.identityReviewSha256` was stale. Every other field, including all 8,240
item records, matched the tracked manifest. The server correctly withheld the
entire bundle. All **7,530 unique PNGs / 5,676,104 bytes** in the worktree copy
passed tracked SHA-256, byte-size and dimension checks. Only the copied installed
manifest was replaced with the exact tracked manifest. The source manifest and
main asset root remain untouched; strict manifest and PNG validation remain.
Catalogue coverage above measures resolver improvements independently of this
installation fault. Delivered coverage below additionally measures the original
manifest acceptance state. The original installed manifests were copied as
evidence before reading them.

| Player | View | Delivered item icons before | After |
| --- | --- | ---: | ---: |
| Player 1 | Presented | 0 / 18 | 8 / 17 |
| Player 1 | Possible | 0 / 1,332 | 732 / 1,328 |
| Player 1 | All possible, hide completed | 0 / 1,010 | 593 / 1,006 |
| Player 2 | Presented | 0 / 17 | 8 / 16 |
| Player 2 | Possible | 0 / 1,319 | 724 / 1,315 |
| Player 2 | All possible, hide completed | 0 / 999 | 588 / 995 |

Before delivery accepted only the unchanged skill bundle; after delivery accepts
both old bundles and the new item supplement. These counts use the browser's
compact name index and the corresponding old/new task resolver, with the server's
full-manifest acceptance rule. All PNG bytes were independently verified; the six
final screenshots demonstrate the presented artwork. Detailed fallback/iconless
counts and copied-manifest byte hashes remain in the local summaries.

The new immutable PNG bundle is
`.local/map-assets/icons-items.2026-10-09.v1/`: **63 PNGs, 41,602 bytes**, with its
tracked manifest `app/data/item-icons.2026-10-09.v1.json`. Previous manifests and
artwork remain unchanged. The new compact URL is
`/assets/map/icons.2026-10-09.v1.json`. Server checks used a separate
`iconAssetsDir` / `RS3_ICON_ASSETS_DIR` in this worktree. Integrating this branch
also requires installing that new asset folder in the chosen deployment icon
root, and synchronizing the older installed item manifest with the unchanged
tracked manifest after validating its PNGs. This job leaves the main root
untouched. [Icon details](icons.md).

## Verification and review artifacts

The final runtime is `88b1d8ff82ad8a981bb4c2fa7c826fa734bfa95c`
(`88b1d8f`). It adds deferred task/category icon painting to the data corrections
in `27f23977f0d41aca48ae918f72cd4d118bb457f6`: a late icon catalogue fills existing
image targets without rebuilding the task list. **69 focused tests passed**, and
the static dependency check passed. **Final full-suite result: 1,900 passed;
zero failures, cancellations or skipped tests; 213,933.064 ms.** The final suite
includes 37 new test cases. The earlier runtime passed 1,895 tests.
Full-suite evidence: [final test log](../../.local/dataacc-npm-test-complete.log).

All browser batches use the same copied save at revision 41, fingerprint
`f902ba633b02d1a7bcee5746faa984d3c4b7ce77dc2aa595875e873ec39154de`.
The deployed baseline is an archive of `10f75a6` within this worktree. Each batch
uses three independent fresh Chrome profiles and disposable servers, Chrome 154,
Node 24, unthrottled localhost and default prediction prewarming. Terrain and
game assets are unchanged. Candidate icon assets include the validated copied
old bundles and the new supplement. OS file caches are not flushed. No other
deliberate benchmark runs alongside the final batch. These are local headless
measurements; they do not establish Player 2's physical-phone or public-network
performance.

### Every completed browser batch

Times below are task-list milestones in milliseconds. Each cell retains all
three runs followed by its median; no completed batch is discarded.

| Batch and source | Reload runs → median | Unlock runs → median |
| --- | --- | --- |
| `dataacc-before`, `10f75a6` | 1,175.9 / 1,048.0 / 911.3 → **1,048.0** | 8,694.0 / 3,925.9 / 3,886.9 → **3,925.9** |
| `dataacc-after`, `27f2397` | 947.9 / 1,319.1 / 1,315.5 → **1,315.5** | 7,765.6 / 9,612.9 / 9,452.5 → **9,452.5** |
| `dataacc-main-current`, `10f75a6` | 1,063.0 / 1,144.9 / 873.0 → **1,063.0** | 3,448.4 / 3,133.9 / 4,442.4 → **3,448.4** |
| `dataacc-after-repeat`, `27f2397` | 996.4 / 971.6 / 848.8 → **971.6** | 4,124.2 / 4,052.4 / 3,506.2 → **4,052.4** |
| `dataacc-after-confirm`, `27f2397` | 1,644.9 / 1,540.1 / 1,066.3 → **1,540.1** | 5,823.2 / 5,544.8 / 5,712.5 → **5,712.5** |
| `dataacc-main-confirm`, `10f75a6` | 996.1 / 968.7 / 1,250.6 → **996.1** | 6,824.1 / 5,113.1 / 6,999.1 → **6,824.1** |
| `dataacc-final`, `88b1d8f` | 1,101.6 / 951.4 / 871.3 → **951.4** | 5,842.8 / 3,196.5 / 3,926.4 → **3,926.4** |

The complete reports, including Saved, terrain, network idle, transferred bytes,
worker timings and browser long tasks, are:

- [Original baseline](../../.local/perf/dataacc-before-2026-10-09T10-42-27-940Z.json)
- [First candidate](../../.local/perf/dataacc-after-2026-10-09T11-26-03-394Z.json)
- [Repeated baseline](../../.local/perf/dataacc-main-current-2026-10-09T11-31-52-171Z.json)
- [Repeated candidate](../../.local/perf/dataacc-after-repeat-2026-10-09T11-36-55-081Z.json)
- [Candidate confirmation](../../.local/perf/dataacc-after-confirm-2026-10-09T11-50-27-274Z.json)
- [Nearby baseline confirmation](../../.local/perf/dataacc-main-confirm-2026-10-09T11-57-03-701Z.json)
- [Final corrected candidate](../../.local/perf/dataacc-final-2026-10-09T12-10-32-918Z.json)

The [completed-batch summary](../../.local/dataacc-audit/performance-summary.json)
retains the exact values, revisions and common fixture hash. Matching Markdown
reports accompany each JSON file in `.local/perf/`.

### Acceptance and sensitivity

The final-runtime comparison uses the nearby three-run baseline confirmation,
without substituting an earlier faster or slower baseline after seeing the
candidate result. Original-baseline sensitivity is reported separately.

| Comparison | Reload median | Unlock median | Conclusion |
| --- | --- | --- | --- |
| Final `88b1d8f` vs nearby `10f75a6`, 3 vs 3 | 996.1 → 951.4 ms, −4.49% | 6,824.1 → 3,926.4 ms, −42.46% | **Both within 10%.** |
| Final `88b1d8f` vs original `10f75a6`, 3 vs 3 | 1,048.0 → 951.4 ms, −9.22% | 3,925.9 → 3,926.4 ms, +0.01% | **Both within 10%.** |
| Earlier preselected six-run confirmation, `27f2397` | 1,055.5 → 1,031.35 ms, **−2.29%** | 3,906.4 → 4,834.5 ms, **+23.76%** | **Unlock non-regression check failed.** |
| Every old completed run pooled, `27f2397`, 9 vs 9 | 1,048.0 → 1,066.3 ms, **+1.75%** | 4,442.4 → 5,712.5 ms, **+28.59%** | **Old runtime's pooled unlock result was slower.** |

For a 10% relative non-regression limit, the final comparison against the nearby
baseline permits at most **1,095.71 ms reload / 7,506.51 ms unlock**. The original
baseline sensitivity permits **1,152.80 ms / 4,318.49 ms** under the same limit.
The final medians meet both relative limits against both baselines. The
structural comparison is supporting evidence, separate from end-to-end acceptance.

The existing [local workflow targets](../performance.md#targets) are separate:
**reload tasks shown <2 s**, **Unlock to current tasks <3 s**. Final absolute
target result: **reload passes / Unlock misses**.
A result within 10% of a slow baseline can still miss the 3-second Unlock target.
The old batches and failed six-run check remain part of this report after the
final icon-painting fix; they are not measurements of `88b1d8f`.

### Interpretation and structural checks

Timing varies substantially without a source change, including slower candidate
confirmations and the nearby baseline's slower Unlock runs. An observation during
verification found approximately **3.1 GiB free of 31.9 GiB RAM**. This records low
headroom; it does not establish paging or identify the slowdown's cause. The
complete results do not justify excluding a batch as “host noise” or claiming
that an intrinsic regression is absent.

The candidate reload delivers **964,416 more decoded catalogue bytes** than the
baseline. The baseline's stale installed item-manifest review hash caused the
server to withhold its item bundle; the candidate accepts the validated full
bundle. Only **7,866 bytes** of the increase are new names. This deployment repair
changes delivered work and icon coverage, so the entire byte increase must not
be attributed to the new tier-item names. The final painter avoids the additional
full task-list render on late icon delivery; its performance effect is measured
by the final batch rather than inferred from the code change.

A separate sequential direct-engine comparison used the same guarded revision-41
copy and the harness's first selected numeric locked chunk, **13882**. It appended
that chunk to `unlocked` and removed it from `selected` in a structured clone only.
One initial pair and three warm pairs per source reproduced these counters:

| Counter | Archived `10f75a6` | Candidate `27f2397` |
| --- | ---: | ---: |
| Closure/access passes, before and after | 6 / 6 | 6 / 6 |
| Processing passes, before and after | 5 / 5 | 5 / 5 |
| Incremental processing passes, before and after | 4 / 4 | 4 / 4 |
| Checks, before → after | 112,287 → 112,117 | 112,280 → 112,110 |
| Dependency checks, before → after | 5,712 → 5,736 | 5,712 → 5,736 |
| Base collections, before → after | 8 → 10 | 8 → 10 |
| Raw access evaluations, before → after | 56 → 68 | 56 → 68 |
| Available tasks, before → after | 1,363 → 1,431 | 1,359 → 1,427 |

Processing access evaluations remain 10, finalizations 1, fallbacks 0 and
unsupported tasks 34 for both sources. The candidate catalogue contains four
fewer tasks and performs seven fewer checks; the Unlock availability delta is
identical at +68. This rules out additional closure passes in that comparison.
It does not rule out per-check cost, allocation, other worker phases, transfer
or browser rendering differences, and it does not establish their contribution
to the browser timing results. Direct-engine timing is secondary because the
sources ran sequentially and OS/host state was not held constant.

Counter evidence: [safe numeric results](../../.local/compare-dataacc-engines.results.json).
The copied state hash stayed unchanged throughout this check. Its retained
definition hash was
`9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`
under canonical LF hashing. No server, cache pool or live save participated.


Failed setup attempts produced no timing reports; disposable processes and
stores were cleaned before retrying. The full suite used
`SKILL_ICON_ASSET_ROOT=.local/map-assets/icons-skills.2026-10-08.v1` to include the
actual copied PNG checks. The final performance command was:

```powershell
$env:RS3_ICON_ASSETS_DIR = 'C:/Users/User/Projects/chunk-picker-rs3-wt/dataacc/.local/map-assets'
npm run perf -- --runs 3 --label dataacc-final --scenarios reload,unlock --source .local/dataacc-save --map-assets C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --game-data C:/Users/User/Projects/chunk-picker-rs3/.local/game-data --timeout 300000
```

Baseline commands additionally selected
`--server-entry .local/deployed-baseline/app/server.mjs --server-revision 10f75a6`
and cleared the separate icon-root setting. Long advisory prediction/death requests
remain included in network-idle metrics.

Desktop and 390px phone screenshots are under `.local/dataacc-review/`:
`desktop-tasks.png`, `phone-tasks.png`, `phone-light-tasks.png`,
`desktop-gray-tasks.png`, `desktop-war-entry.png`, and `phone-war-entry.png`.
They show the copied save, real local PNGs and existing dark/light/gray themes.
Screenshot diagnostics record loaded/broken task images and viewport width.
All six captures have zero broken images and no horizontal overflow. Task views
load nine task icons, including skill fallback; filtered War views load eight.

Tests preserve their intent: historical transport generation remains bound to
the historical artifact; interior preservation compares every old ID and field
by identity while admitting reviewed additions; full prediction goldens were
updated only after complete object comparisons against the deployed baseline.
The browser VM fixtures now inject the actual icon helper and painter when
removing module imports. Their existing assertions remain unchanged.

Local summaries/logs: `.local/dataacc-audit/{before,after}.json`,
`.local/dataacc-audit/prediction-diffs.json`, `.local/dataacc-npm-test-complete.log`,
and `.local/perf/dataacc-*.{json,md}`. Source state fingerprints
match before and after read-only audits. Disposable stores/profiles and the
frozen duo copy were removed after verification; summaries and screenshots remain.
All new data artifacts are versioned, repository text hashes use canonical LF,
external byte hashes retain their original scope, and `.gitattributes` is unchanged.

## Files changed

54 files across runtime/data, audit tools, evidence and tests. The web UI changes
are the icon catalogue URL, shared resolver/deferred painter wiring and neutral
level display guards; map and task layout ownership remains with the other jobs.

- `app/core/combat-level.mjs`
- `app/core/rules.mjs`
- `app/core/transport-access.mjs`
- `app/data/combat-level-formula.2026-10-09.v1.json`
- `app/data/icons.mjs`
- `app/data/item-icons.2026-10-09.v1.json`
- `app/data/map-connections.2026-10-09.v1.json`
- `app/data/map-connections.mjs`
- `app/data/retained-task-corrections.2026-10-09.v1.json`
- `app/data/retained-task-corrections.mjs`
- `app/data/skill-guide-rules.mjs`
- `app/data/skill-guides.mjs`
- `app/data/transport-components.desert-anachronia.2026-10-09.v1.json`
- `app/data/transport-routes.2026-10-09.v1.json`
- `app/data/transport-routes.desert-anachronia.2026-10-09.v1.json`
- `app/data/transport-routes.mjs`
- `app/play-view.mjs`
- `app/server.mjs`
- `app/tasks/engine.mjs`
- `app/tasks/presentation.mjs`
- `app/tasks/task-icons.mjs`
- `app/tasks/worker.mjs`
- `app/web/icons.mjs`
- `app/web/main.mjs`
- `app/web/task-icon-painter.mjs`
- `docs/performance.md`
- `docs/research/data-accuracy-2026-10-09.md`
- `docs/research/icons.md`
- `docs/research/item-icon-review.2026-10-09.v1.json`
- `docs/research/retained-task-requirements-2026-10-09.md`
- `docs/research/transport-membership-audit.2026-10-09.v1.md`
- `scripts/audit-data-accuracy.mjs`
- `scripts/build-transport-supplement.mjs`
- `scripts/export-tier-item-icons.mjs`
- `scripts/research/retained-task-requirements.mjs`
- `tests/combat-level.test.mjs`
- `tests/chunk-resource-ui.test.mjs`
- `tests/icons-server.test.mjs`
- `tests/icons.test.mjs`
- `tests/interiors-v2-server.test.mjs`
- `tests/map-info-server.test.mjs`
- `tests/map-overlay.test.mjs`
- `tests/prediction-output.test.mjs`
- `tests/progress.test.mjs`
- `tests/requirement-alternatives.test.mjs`
- `tests/retained-task-corrections.test.mjs`
- `tests/server.test.mjs`
- `tests/skill-guide-milestones.test.mjs`
- `tests/task-icon-painter.test.mjs`
- `tests/task-icons.test.mjs`
- `tests/tier-item-icons.test.mjs`
- `tests/transport-audit.test.mjs`
- `tests/transport-routes.test.mjs`
- `tests/web-browser.test.mjs`
