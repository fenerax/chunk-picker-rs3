# Access and adjacency

The picker distinguishes ownership, possible roll destinations, accessible sources and task eligibility. Surface walking uses the copied-cache components and witnessed cardinal boundaries. Saved section IDs and declarative resource/interior requirements remain separate. The app does not inspect a logged-in character. See [cache application policy](research/cache-walkability-application.md) for exact mappings, conservative gate handling and retained fallback locations.

## Current defaults

- Obligations come from the focused member’s own reachable map. With `access.shared` enabled, connected partner territory can supply capability: training, resources, shops, supplies and voluntarily doable activities. It never creates the focused member’s chunk obligations. Selected or pending chunks are not unlocked access. Roll generation always starts from the rolling member’s own unlocked chunks/sections; partner territory cannot widen adjacency or frontier candidates.
- Automatic rolls inspect four orthogonal surface neighbours. The default `accessible` mode requires a witnessed walking boundary from a reachable, personally unlocked component into an unblocked destination component. One reachable tile is sufficient; no minimum component area applies. Walking never visits an unclaimed intermediate. Transport and unresolved nonlocal dependencies remain typed non-walking routes. Missing/empty plane-0 coverage uses the documented retained fallback.
- `frontier` is an optional geometric-neighbour rule, using cache-derived walkable terrain where covered. `manual` uses selected candidates. Accessible mode requires actual component boundaries.
- F2P generated roll destinations require a qualifying free destination component. Fully free or members cache masks settle component membership; mixed/unknown components use supported Wiki section corrections and otherwise fail closed. Source traversal is also restricted to free components. Temple of Amascut 12592 is members-only. Whole-chunk flags do not establish that every resource, room or dungeon within one is free.
- Explicitly selected candidates intentionally bypass the generated walkability/F2P filters. They still cannot be unknown, outside the surface grid, personally unlocked, pending or personally blacklisted. Partner-owned chunks remain valid personal candidates, including random-start rolls and automatic manual-neighbor markings. A pending offer survives a partner unlock; accepting it records personal ownership. Selection is a manual house-rule override.
- A manually confirmed usable teleport adds a locked destination to the roll pool without unlocking it or supplying locked resources. A personal teleport can also establish a leg to already-unlocked partner territory. Consumable teleports are excluded by default. The optional group teleport setting affects roll candidates; partner connectivity always uses the focused member’s confirmations. A generated teleport destination still receives F2P and ordinary candidate exclusions.
- Teleport confirmation is a declaration, not automatic verification of a character's spell level, quest unlocks, item charges, membership or lodestone activation.
- The `content.f2p` mode is currently a shared rule, not a separately detected subscription status per player.

## Map corrections

Applied October 7, 2026 from the [map-data audit](research/map-data-audit.md). `app/data/map-corrections.mjs` overlays the archival export inside `buildWorld`, records previous/new values, URL, confidence and date, and exposes applied provenance as `world.mapCorrections`. The retained JSON and player saves remain unchanged.

- Added walkable members terrain: `15905`, `9772`, `12844`, `8244`, `14902`, `15406`, `15407`. The optional ship and coast checks used [The Adventurous](https://runescape.wiki/w/The_Adventurous), [Mos Le’Harmless scan coordinates](https://runescape.wiki/w/Clue_scroll_(elite)_-_Mos_Le%27Harmless) and [Hooded pirate](https://runescape.wiki/w/Hooded_pirate).
- Added F2P terrain: `13118`, `13374`, `13628` (also walkable), `13629`, `13630`, `9769`. Added raw-overlay W for `17456`; removed the likely `9722` typo without creating an off-map record. Restored only the missing `13883` terrain record: raw W/F, its reciprocal `13882-2`/`13627` boundaries and the [free Daemonheim coast](https://runescape.wiki/w/Daemonheim) support the inference. No resources were invented.
- Restored `11315→11059-2` and `13629→13628`; replaced `13374-2→13318-2` with `13118-2`. Fishing Platform section 1 remains disconnected from its Crandor fragment. Mudskipper’s tiny land and Musa Point’s mainland/island separation remain valid.

Mixed section policy:

| Base | Free sections | Members sections | Unclassified |
| --- | --- | --- | --- |
| Havenhythe bridge `17460` | 2, 3 | 1 | — |
| Havenhythe waterfall `17461` | 1, 2, 3 | 4, 5, 6 | — |
| Paterdomus `13622` | 1 | 2 | — |
| Death Plateau `11320` | 3, 4 | 1, 2, 5 | — |
| Catherby `11317` | 2, 4, 5 | 1, 3 | — |
| Nature Grotto `13620` | 4 | 1, 2 | 3 (Polypore island) |

Unknown sections in these mixed chunks fail closed for generated F2P entry. A confirmed teleport without a qualifying free landing section cannot certify a mixed destination. Explicit selections retain their manual override. Frontier remains the optional geometric house rule; for known mixed chunks it also checks the boundary component’s membership, without proving that the source component is reachable. This roll policy does not replace the task engine’s separate source/interior restrictions. The membership overlay leaves free terrain untinted, hatches members terrain and uses a subtle grey texture with a **Not walkable** legend for defined terrain absent the walkable list.

All thirteen audited nonlocal dependencies are classified in the overlay:

| Original directed dependency | Classification / correction |
| --- | --- |
| `8752-2→9009-1` | Unresolved diagonal dependency; excluded from walking |
| `9532-3→9275` | Typo → `9531-2` |
| `10029-0→10286` | Typo → `10285` |
| `10030-0→10287-2`, `10287-2→10030` | [Toban island tunnel](https://runescape.wiki/w/Gu%27Tanoth); conditional underground transport |
| `10545-0→10290` | Typo → `10289` |
| `12082-1→11825-2` | [Captain Tobias sailing to Musa Point](https://runescape.wiki/w/Captain_Tobias) |
| `12082-1→16179-2`, `16179-2→12082-1` | [Captain Lorris sailing to/from Havenhythe](https://runescape.wiki/w/Captain_Lorris) |
| `12329-4→13097-2`, `13097-2→12329-4` | [Portmaster Kags ferry](https://runescape.wiki/w/Portmaster_Kags) to/from Crondis’s pyramid south of Sophanem |
| `12857-0→12602` | Typo → `12601` |
| `14386-3→14131` | Typo → `14130-1` |

The five additional typo replacements are medium-high structural inferences: the orthogonal replacement already records the exact reciprocal section in the retained export. Transport classification does not authorize travel or create a new transport roll rule.

Pending in-game checks:

- `10540` Oo’glog ship deck and unresolved resource/section geometry still need independent entry evidence. The later [cache application](research/cache-walkability-application.md) settles 8495 coast walkability and 12592 membership; other cache component classifications and conservative limits are recorded there.
- Missing records `9515`, `9771`, `12334`, `13353`, `15149`, `6769` remain unresolved. Do not infer usable terrain or create their resources from list membership alone.
- `8752-2→9009-1` needs an exact boundary/route identification. `13620-3` needs a free/member tile check around the Polypore entrance; a members-only cave does not prove the island’s terrain membership.
- Recheck modern Wilderness volcano crossings and the five inferred typo boundaries against current collision. Further-east Havenhythe coverage and conditional Crandor dungeon transit require their own evidence and house-rule decisions.

## Source and task checks

The task engine uses cache surface traversal and stable retained resource/interior declarations from personally claimed bases. It applies the focused member's section/area blocks, task-gated entries and source unlocks. Unknown explicit hard conditions fail closed. Access to a base alone does not automatically seed every disconnected component. Partner sharing does not copy personal progress. Each owner's exact reached components bound territory; the focused member's blocks still apply to capability access.

Accessible sources feed monster drops, shops, spawns, object yields and declared processing tasks. The engine checks task-level `Not F2P`, F2P skill/trial caps, source requirements, reachable training and dependencies. Personal completion evidence and duo challenge checkmarks remain separate.

## Own obligations and connected capability — October 7, 2026

`calculateAccess` collects one member’s reachable map by default. The same collector accepts an explicit admitted territory (`bases` and `sections`), so source policies, gates, interiors and manual controls have one implementation. `createTaskEngine.evaluate` maintains one capability fixed point and projects two results:

- `obligationAccess`: the member’s own reached locations and sources. Spatial requirements (chunks/areas, monsters, objects, NPCs and shops) define obligations here. When a task has a defining location, its input supplies can come from capability access. Location-free item goals inherit own source lineage, including blocked own recipes; source-kind, NonShop, AllowedSources and wield restrictions remain in force. Location-free dependency aggregates inherit the defining tasks’ own provenance. Cycles without an own origin do not establish relevance.
- `access`: own access plus partner sections admitted by a round trip, used for task feasibility, item production, potential levels and training. Valid partner methods can support an own goal without becoming obligations. Potential rewards from a personally doable voluntary activity can contribute to planning; another player’s completed quests, achievements, skills or teleport declarations never seed personal evidence. Actual saved progress is unchanged. Either member can still satisfy a duo challenge under the existing completion rule.

Rows retain an explicit `obligation` flag. Presentation, active/backlog/completed views, ordinary/specialist BiS, collections, Activity Info task lists and prediction task deltas use own obligations. Activity Info may show connected partner training methods as capability, marked with that flag. Partner ammunition can support an own weapon comparison without generating an ammunition goal. Saved known BiS/collection checks remain durable but receive hidden diagnostic rows when their defining source leaves the own map; the unresolved-import fallback cannot resurrect them. Saved own goals remain visible as blocked when current equip requirements, rules or backlog prevent regeneration. Only saved-status item origins are queried, rather than evaluating every possible gear goal again. Current BiS retains recorded personal acquisition facts.

Training evidence distinguishes own methods from partner support. An own goal can say “Smithing training available via Player 2's connected chunks.” A blocked level requirement includes the disconnected owner and the missing route. Generated BiS equip requirements carry the same training explanation. Planning never changes recorded skill levels or completion.

The access index and declared output-producer index compile once per worker. Each fixed-point pass collects own access and, only when sharing is relevant, partner geometry without source collection. A cache keyed by reached sections and newly valid numeric walking connectors avoids rebuilding an unchanged travel graph. Source locations carry own provenance, avoiding a second own item-source traversal. Capability collection reuses own access when no partner sections are admitted. The worker projects personal BiS from this result instead of running the full engine again.

Task timing on the small synthetic duo fixture used 100 warm-ups and 1,000 interleaved uncached evaluations per implementation, comparing the working evaluator with `HEAD` engine/access modules loaded read-only via `git show`. Connected: median 0.491 → 0.994 ms, p95 1.543 → 2.706 ms (three new passes). Disconnected: median 0.387 → 0.459 ms, p95 0.949 → 1.188 ms (two new passes). The added directed graph/provenance checks cost about 0.5 ms median in the connected fixture. These measurements exclude compilation, worker transport, equipment rendering and real-map scale, and compare intentionally different semantics. `npm run benchmark` measures rolls and was not used as task-performance evidence.

## Pure round-trip travel

`evaluatePartnerConnections` in `app/core/territory.mjs` accepts immutable world/state inputs, each owner’s reached sections, optional valid walking routes and the lodestone table. It returns admitted bases/sections, partner regions and per-chunk `{connected, out, back, reason}` evidence. `reachableSections` remains personal. The map uses the same pure travel evaluator for an immediate topology preview, then the worker’s task-gated result replaces it.

Walking uses witnessed cache component boundaries and the explicitly documented retained fallback for missing/empty surface coverage. Adjacency does not create an edge and an unclaimed intermediate never becomes a graph node. Task-gated numeric `Connect` and `ConnectsSections` declarations can retain exact resource/landing semantics after their personal gates pass; they do not manufacture a missing cache walking boundary. Nonlocal transports and named interiors cannot become surface walking shortcuts.

Outbound reachability starts at the personal reached map and usable personal teleport destinations inside the unlocked graph. Return reachability is evaluated separately by reverse walking paths to personal territory, or a personally usable teleport/lodestone landing that has such a path. A teleport into an island with no return is excluded. Evidence records both legs, for example `out: walking via 12850; back: Lumbridge lodestone`. A bare teleport destination in a split chunk lands in its admitted section 1; a specific section destination uses that section. It cannot seed every disconnected section. Focused explicit blocks apply before traversal.

Partner regions are weak components of their reached walking graph. Directed boundaries can leave only part of a region safe: capability admits only sections with both legs; a region is fully connected only when all its sections are safe. Chunk tabs report the reachable admitted portion and otherwise dim the partner tab with a reason such as “Player 2's chunk, not connected for Player 1: no route back.” Ownership colours and saved maps are preserved.

### Lodestone locations and activation assumption

The retained `challenges.Diary` lodestone achievements contain authored surface selectors; `app/data/lodestones.mjs` maintains a small explicit table. All 28 scenery pages were retrieved through the current RuneScape Wiki API on October 8, 2026; their coordinates and ordinary membership variants are recorded in the [versioned correction review](research/cache-lodestone-corrections.2026-10-08.v1.json). There are 28 supported permanent surface destinations (12 F2P, 16 members). City of Um is an underground destination and remains outside this table.

| Lodestone | Runtime chunk/section | F2P |
| --- | --- | --- |
| Lumbridge | 12850-1 | Yes |
| Burthorpe | 11575-1 | Yes |
| Taverley | 11317-2 | Yes |
| Al Kharid | 13105 | Yes |
| Varrock | 12852 | Yes |
| Edgeville | 12086 | Yes |
| Falador | 11829-1 | Yes |
| Port Sarim | 12082-1 | Yes |
| Draynor Village | 12339 | Yes |
| Wilderness Crater | 12600 | Yes |
| Ashdale | 9770 | Yes |
| Wendlewick | 16691-1 | Yes |
| Lunar Isle | 8253-2 | No |
| Bandit Camp | 12846-1 | No |
| Fort Forinthry | 13111 | No |
| Ardougne | 10548 | No |
| Catherby | 11061 | No |
| Yanille | 10032-1 | No |
| Seers' Village | 10806-1 | No |
| Eagles' Peak | 9270 | No |
| Tirannwn | 9009-1 | No |
| Oo'glog | 10028 | No |
| Karamja | 11057 | No |
| Canifis | 13878-1 | No |
| Fremennik Province | 10809-1 | No |
| Prifddinas | 8756-1 | No |
| Menaphos | 12842 | No |
| Anachronia | 15426 | No |

The region calculation is `(x >> 6) * 256 + (y >> 6)`. All 28 current Wiki scenery anchors corroborate their runtime base regions. Anachronia's [current revision 37122513](https://runescape.wiki/w/Special:PermanentLink/37122513) places scenery at (3894,4258), region 15426; cache structs 24324 and 33446 project the adjacent landing to (3895,4259), also 15426. The retained `15683-1` is corrected to bare `15426`; no authored section suffix or collision component is inferred. The existing cache landing resolver therefore remains conservative until a precise correspondence is certified. Existing section suffixes for other stones remain authored selectors, not tile-level audits.

Ashdale's cache destination encodes plane 2 at (2474,2709), and Prifddinas encodes plane 1 at (2208,3361); neither has a map-28 plane-0 projection. Wiki scenery supports their retained bases 9770 and 8756, with Prifddinas explicitly on plane 0, but does not resolve the encoded landing planes. City of Um's Wiki coordinate (1083,1768), plane 1, matches both cache variants, which project onto Underworld map 742 rather than the surface. The Wiki marks Um F2P; cache membership candidates conflict (0 and 1). Its activation, underground map policy and personal access remain separate and no new Um route is added.

Lumbridge is the current new-account default. Burthorpe is F2P and can be activated after reaching it; it is no longer the universal default. The [November 17, 2025 update](https://runescape.wiki/w/Update:Going_Home_to_Lumbridge_%26_Amascut_4k_Enrage_-_This_Week_In_RuneScape?action=raw) changed Tutorial Island/Davendale to unlock Lumbridge; Group Ironmen retain the Iron Enclave portal to Lumbridge. The [Wendlewick lodestone](https://runescape.wiki/w/Wendlewick_lodestone?action=raw) is F2P, added March 23, 2026 and built during Visions of Havenhythe; the network’s introductory prose omits it, but its table includes it.

For this house rule, reaching a lodestone’s admitted chunk (its actual reached section when split) satisfies activation, and that destination becomes usable from anywhere. Activation is derived, with no new saved flags or migration. Neither a locked destination nor an unreached island stone can activate itself through circular travel. A default Lumbridge teleport does not grant access to a locked Lumbridge chunk. Members-only stones are excluded in F2P mode. This intentionally abstracts real quest/build gates at stones such as Lunar Isle, Bandit Camp, Fort Forinthry, Prifddinas, Menaphos, Wendlewick and Anachronia; the Wiki table documents those gates, but this requested reach-equals-activation assumption does not enforce them separately. Wilderness combat/teleport restrictions and collision-level obstacles are also outside the declared travel model.

## Drop rates and cutoff boundaries

`app/tasks/rates.mjs` parses every source rate and compares both cutoffs. `Always` is case-insensitive and means 1. It removes approximation marks (`~`), thousands commas and a trailing `*`; numeric slash components divide through (`1/65536/640`). `1/Infinity` is known zero. Labels (including Common, Uncommon, Rare, Very rare, Random, Once, Unknown, Varies and Never), blank values, bare numbers, missing numerators (`/59256`), ranges and multiplication expressions are explicitly unknown (`null`). Unknown sources pass rarity filtering but never become primary training. Evidence carries `unknownRate` and the raw label; source panels show, for example, “Rate unknown (Very rare)”.

Bare amounts always mean denominators: X > 0 gives 1/X, including 2.5 → 1/2.5 and 0.5 → 1/0.5 = 2. The latter threshold admits no ordinary known rate at or below 1. Use an explicit a/b to enter a probability. Zero, including the retained `1/0` setting, includes every known rate; unknown rates still cannot be primary. Invalid saved settings remain preserved and diagnosed, while evaluation uses defaults. Rare Drop Inclusive defaults off (strictly more common); Secondary Primary Inclusive defaults on (exactly at the cutoff qualifies). Both checkboxes sit under their amounts and use defaults when absent. Equality includes a four-machine-epsilon relative tolerance to keep rounded products such as 1/10 × 1/10 equal to 1/100.

Known probabilities multiply through nested monster and skill-output tables for rarity and primary checks; any unknown component makes the whole path unknown. Materialized task sources retain rates, quantities, table paths and declared source kind, and distinct paths remain separate evidence. This deliberately replaces the original NaN bypasses, opaque-rate/fractionless or >50-denominator primary promotion, inconsistent annotations and path-dependent primary boundaries described in the rules audit. Lowercase Always is now guaranteed, and zero truly includes everything rather than using the original tiny positive sentinel. Source/access/task gates continue to apply.

`Boss` means exactly: boss drops from the picker’s boss list count as item sources; turning it off removes those drops as sources but does not stop killing or training on bosses, Kill X Boss goals or boss collection-log tasks. Classification remains exact membership in the retained boss dictionary. Independent category, source, access and Kill X Boss gates still apply; lost item sources can indirectly block an item requirement.

These checks can reject a recorded requirement. They cannot discover an omitted members-only gate. The chunk information panel displays retained raw contents as well as derived planning evidence; a raw content listing is not proof that the focused player can use that source.

## Verified Edgeville correction — October 7, 2026

The following deployment evidence predates the own-obligation/round-trip follow-up above; this task did not restart or deploy the picker.

Player 1 reported thugs behind the members-only gate. The current RS3 Wiki marks [Thug](https://runescape.wiki/w/Thug) as members-only and says the Wilderness portion of [Edgeville Dungeon](https://runescape.wiki/w/Edgeville_Dungeon) requires a members server. Both pages were retrieved through their raw wiki source on October 7; OSRS and Classic sources were not used for the correction.

The retained dataset combines free and members sources under the named `Edgeville Dungeon` record. Its unlock task does not carry membership requirements for that subarea. Numeric dungeon records are aliases of that combined area, so they do not preserve the boundary in the access engine.

Before correction, an isolated F2P player with only Edgeville `12342` unlocked and section `12342-1` entered could obtain a steel hatchet through Thug drops and receive its gear/training goals. This reproduced the type of inconsistency Player 1 described; the exact historical original-picker grind remains unconfirmed.

`app/data/access-policy.mjs` supplements the retained export with dated, evidence-backed source restrictions. It does not modify the original data or the saved maps:

| Scope | Blocked source in F2P | Evidence |
| --- | --- | --- |
| Any location, including manual additions | Thug | [RS3 Thug](https://runescape.wiki/w/Thug) |
| Any location | Chaos druid | [RS3 Chaos druid](https://runescape.wiki/w/Chaos_druid) |
| Any location | Earth warrior | [RS3 Earth warrior](https://runescape.wiki/w/Earth_warrior) |
| Any location | Black demon | [RS3 Black demon](https://runescape.wiki/w/Black_demon) |
| Edgeville Dungeon only | Deadly red spider; red spiders' eggs spawn | [RS3 dungeon Wilderness features](https://runescape.wiki/w/Edgeville_Dungeon) |

A confirmed restriction removes the source before drops, item goals, collections and training are calculated. Diagnostic records retain the reason, evidence URL and verification date. F2P spider/egg sources at other locations remain admissible. Members mode retains the original source admission, subject to all ordinary location/task gates. Free dungeon monsters and mining sources remain available.

These six policies are a targeted verified correction, not a complete independent membership audit. Mixed-membership monster variants, other dungeon subareas, shortcut conditions and erroneous overland topology still require case-by-case verification. Adding a verified source restriction means adding a policy with its exact scope and evidence, plus a regression proving that legitimate free alternatives remain available.

The complete automated suite passed 328 tests with no failures or skips. Regression checks use the retained Edgeville data to verify the F2P steel-hatchet goal is blocked, the same member-mode goal remains available, free monsters/ore remain available and neither definitions nor player state are mutated. A separate source-scoping check preserves free spider/egg sources elsewhere and rejects a manually added Thug in F2P mode.

After a managed restart without import, read-only browser/API acceptance passed for both live player views. Both exclude the four verified global member monsters and their drops, retain free hill giants, and report the Edgeville Thug restriction with its evidence URL. Current BiS and Activity Info still open without JavaScript errors. The saved maps remain revision 1 with Player 1's 136 and Player 2's 113 unlocked chunks; the state-file checksum is unchanged from before deployment. The reported available-task counts are now 1,619 and 1,668 respectively, reflecting corrected source admission rather than saved-progress changes.
