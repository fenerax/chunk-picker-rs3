# Applied copied-cache surface topology

`app/data/cache-walkability.2026-10-07.v1.json` now supplies surface component geometry and witnessed cardinal walking boundaries. The source remains the audited copied-cache snapshot described in [cache-walkability.md](cache-walkability.md), rather than a new read of the original game cache. The application does not open cache databases. The matched component membership counts and compatibility policy are committed in `cache-component-policy.2026-10-07.v1.json` with their source SHA-256.

The adapter adds 451 terrain-only surface records where the reference has no record. It invents no monsters, resources, interiors or tasks. Exact cache label coordinates identify Berylbrook 18228, Heathervein 18230 and Fenmoor 18482. Other new records use their region IDs until their names are verified. Existing reference names can be stale; cache geometry does not certify those labels or the resources attached to old interior aliases.

## Stable saved selectors and real components

The public `world.sectionTopology` remains the retained, corrected selector vocabulary used by saved state and resource/task declarations. It is **not** the walking authority for this dataset. `world.cacheWalking.topology` supplies walking sections, with suffix `1000000 + cache label`: cache `11825:1` is internal section `11825-1000001`. The namespace prevents cache scan-order labels from being confused with saved authored section numbers.

The committed mapping has an entry for every retained selector, including its boundary signature, candidates, accepted correspondence, method and resource uncertainty. It maps **689 of 1,062 selectors**; **373 remain unresolved**. The [spatial audit](cache-selector-mapping.md) examined all original 453 unresolved selectors and accepted 80 additional correspondences using exact declared-object placements and decoded footprint perimeters. Neither fragment size, nearest distance nor arbitrary candidate ordering chooses a component. Original mapping provenance remains attached to every added correspondence. Cache labels are version-specific, so a future snapshot needs a new mapping/version.

A walking correspondence does not certify every declared resource, task action or interior entrance. All 1,062 selectors are also audited for unlocated declarations; **981 have unresolved resource correspondence**, including shared aliases and mapped sections whose NPCs, spawns, task locations or entrances lack exact coordinates. Raw location aliases and declared task aliases are included. Their exact unlocated declarations and reasons remain in the policy. Structural projection is possible for 665 mappings, but the access evaluator keeps unresolved resources and task references behind their pre-cache access conditions.

The reviewed Musa Point/Port Sarim correspondence pairs the two different landmasses, including their reciprocal region/component boundaries:

| Saved selector | Cache component | Meaning |
| --- | --- | --- |
| 11825-1 | 11825:2 | Port Sarim mainland |
| 11825-2 | 11825:1 | Karamja pier fragment |
| 11569-1 | 11569:1 | Musa Point island |
| 11569-2 | 11569:5 | Mainland fragment |

Saved overrides, personal starting sections, task gates and challenge checks are not rewritten. A true unresolved legacy override can still grant that exact retained resource section, but cannot fan out a walking seed. A false override blocks its mapped component or all exact candidate correspondences conservatively. An unsplit saved `base-0:false` blocks every component of that base. One cache component shared by several legacy resource selectors does not automatically grant all their resources; personal overrides and retained task gates still select the exact resource section.

`surfaceReachability` is the shared traversal seam for rolling, task access and partner travel. It only visits claimed bases. Unsplit ownership seeds its certified primary correspondence, and split ownership supplies no arbitrary entry. A bare teleport/lodestone landing resolves the retained primary selector, never every disconnected component. An unresolved landing fails closed. Task access projects certified reached components into stable resource selectors. Retained named-interior entry conditions, underground declarations, source gates and personal task progress continue separately. A retained bare-base interior entrance can use an actually entered legacy surface section; its return marker cannot seed extra surface geometry.

Partner territory uses each owner's exact reached component set, then checks outbound and return legs separately. The focused member's blocks still apply. Capability collection cannot reseed an unadmitted partner component through bare ownership. Own obligations remain personal; partner access never expands personal walking roll origins.

## Closed doors, conditional routes and fallback

The current export has **zero evidenced openable placements**, 1,415 unverified doors/gates and 7,034 conditional morph placements. The import conservatively unions morph clipping. A name, an `Open` action, a task checkmark or an old edge does not prove an unobstructed boundary. No unverified door is promoted to walking. Newly supplied door-opening evidence must certify the placement and its requirements, regenerate collision/components and undergo the same portal validation before application.

Positive decoded regions use only cache boundaries. A missing decoded boundary does not recover an old connection, even when an old `ConnectsSections` task is satisfied. Such a task can retain its exact resource/landing semantics, but cannot manufacture partner surface transit through a closed cache gate. This is a deliberate conservative limit of this static snapshot.

Missing surface pastes or a plane-0 snapshot with no component cannot establish current walking terrain. Those bases retain typed walking dependencies from the corrected reference, bounded by orthogonal geometry and route classification. The 44 instantiated fallback component dependencies record reason `missing-or-empty-plane-0-coverage` and evidence `retained-section-topology`. The fallback bases with retained topology are:

`7727, 8244, 9279, 14660, 15428, 15430, 15943, 16199, 16454, 16455, 16710, 16960, 16961, 16962, 16963, 16964, 16965, 16966`.

Their complete status, including missing versus decoded-empty, is exposed in `world.cacheWalking.coverage`. Named interiors and upper-floor/transport requirements remain retained declarations because this surface export cannot speak about them. The retained thirteen audited nonlocal/typo dependencies keep their existing typed metadata. Boats, tunnels, unresolved diagonals and typos cannot establish surface walking edges.

Mapping uncertainty is a separate limit from missing cache coverage. An unambiguous cache portal may reach a component from another personally claimed region, but unresolved ownership alone does not choose a primary component. **Mapping uncertainty cannot remove retained access.** Exact resource and entrance coordinates are required before treating a walking correspondence as evidence about all attached sources.

## Resource correspondence

The access index retains a separate pre-cache evaluator. For each unresolved component or resource correspondence, it evaluates the same immutable state, personal overrides and valid task gates and preserves that reference's pre-cache resource/interior access. A match for three Stones, for example, does not locate Nature grotto's entrance. The policy also preserves shared aliases and declared-content conflicts such as the Abandoned Mine's cart tunnels.

Preserved references appear in `access.compatibilitySections` with `unresolved-selector-retained-access` diagnostics naming the selector, candidates and reason. They expose retained resources and gated interiors without seeding surface components, numeric transit or section connectors, including through interior return links and carried partner aliases. Saved false overrides and source backlogs remain effective. Fully members-only cache masks can positively block automatic F2P resources; an explicit saved resource override remains separate.

Partner resource compatibility evaluates retained outbound/return conditions but removes retained walking dependencies where both decoded regions positively have no cache boundary. If both complete walking correspondences are known, their exact component pair must have a witnessed boundary; a portal joining other fragments of those regions cannot substitute. A newly located object footprint with other unlocated declarations, or an original mapping contradicted by spatial contents, cannot certify the entire retained resource approach. Such references retain their broader resource entry conditions, bounded by region-level cache boundary evidence. An unqualified retained departure considers every decoded component of that region, because its retained semantics accept any already entered section; a primary landing cannot rule out another witnessed departure. Task-gated walking routes receive the same boundary check. Cache component travel and personal roll origins remain governed solely by cache walking. Every behavior difference is reviewed using the [complete comparison](../cache-comparison.md), rather than labeling uncertainty as proof of loss.

## Membership and accepted proposals

Fully free or fully members component masks settle component membership. Mixed/unknown masks use a consistent mapped Wiki section policy when one exists. Unclassified mixed components fail closed in F2P. Unknown masks without contrary known membership retain their supported base policy. F2P traversal and automatic landing require a free qualifying component, including a tiny one; destination-region F2P alone is insufficient. Explicit selected candidates retain their existing manual house-rule override.

12592 Temple of Amascut is members-only: all 39 walkable tiles have members masks. 8495 is walkable with the witnessed reciprocal 8751 boundary. 8751 itself has two disconnected cache components: its western 8495 edge and eastern 9007 edge do not become an invented internal crossing. The free 12-tile fragment in 13621 has no walking boundary in this snapshot; it changes the region's free-terrain classification without creating a roll from the neighbouring peninsula. Havenhythe 17460/17461 retain free western and members eastern component gating. East Havenhythe terrain/labels are present but do not become free roll destinations. Floor presence on disconnected Penguin Island does not create a walking roll; the optional geometric frontier rule and explicit manual selections remain separate house-rule choices.

## Reproduction and verification

Regenerate the companion policy after an intentional audited source/mapping change:

```powershell
node scripts/cache/build-runtime-topology.mjs C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/membership.v1.json
```

`buildWorld(definitions, {cacheWalking:false})` and `createTaskEngine(definitions, {cacheWalking:false})` expose the corrected retained overlay for independent comparisons. Automatic activation also checks the retained dataset's size and two shoreline identity sentinels; custom/synthetic worlds remain untouched and can explicitly select the adapter.

The application tests cover saved selector mapping, ambiguous and shared aliases, false blocks, free/member components, the two-tile Mudskipper landing, coast reciprocity, unclaimed intermediates, inlet routing, transport exclusion, exact owner component bounds, fallback landings and nodes, resource task gates, underground entrance compatibility and terrain-only eastern records. The full suite and isolated browser acceptance are reported with delivery. All test services use isolated state and ephemeral ports.

Delivery validation: the final `npm test` passed **879 tests**, with zero failures, cancellations or skips. Ocean fallback verification captured before/after fogged terrain at zoom 0.1 and 0.35 in isolated headless browser sessions; details and screenshot paths are in [cache terrain application](cache-terrain-application.md). The earlier pin acceptance for the parent revision used a fresh synthetic group on isolated port 56598: all 2,994 current pin placements loaded, all 291 sprite PNGs decoded, the seven legend totals matched, and Berylbrook/Heathervein/Fenmoor cache tiles rendered. Pan and zoom changed the canvas; there were no app JavaScript, console or HTTP errors. Two task requests were aborted during rerenders and subsequent requests succeeded. The browser and isolated server were stopped. Local evidence remains ignored at `.local/cacheapply/full-tests.log` and `.local/cacheapply/browser-evidence/acceptance-summary.json`.

The real-data comparison uses `scripts/compare-cache-access.mjs` with an explicitly named temporary private copy and ignored report destination. It starts no server, performs no migration and changes no save. Derived before/after reports stay ignored; the temporary state copy is deleted after comparison. The companion difference report lists every roll-pool addition/removal, accessible base/legacy-section/area difference, source and source-location difference, task status and presentation difference, backlog/completed visibility, and Activity Info ceiling or method difference. The comparison uses the production task, collection, equipment, presentation and Activity Info pipelines. Every access loss must cite a positive cache boundary or membership witness; unresolved correspondences retain their pre-cache result and remain explicit review items. See [comparison reproduction and privacy](../cache-comparison.md).
