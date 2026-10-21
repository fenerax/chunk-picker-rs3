# F2P membership audit October 2026

Historical October 8 baseline: the [October 12 item decisions](membership-item-review-2026-10-12.md) resolve its 23 obtainable unknown labels and five cache/Wiki disagreements. The [monster follow-up](monster-membership-review-2026-10-12.md) records the later exact-source review. Counts and residual descriptions below describe the original dated audit.

The picker now checks membership independently of geographic access. With `content.f2p` enabled, a reachable shop, monster, object or manually declared supply cannot admit a verified members-only item or method. Free activities keep their valid free alternatives, and members-only incidental rewards are filtered without banning the underlying free action.

This audit covers Player 1 and Player 2's copied revision 32 save, the decoded October 8 item cache, retained source/task definitions, and pinned RuneScape Wiki evidence. The [complete task and equipment ledger](f2p-membership-audit.2026-10-08.v1.json) contains every detected direct, transitive and optional member dependency, each removed task, source reduction, presented-task change, and named BiS recommendation/loadout/upgrade reference. The [source review](source-membership-audit.2026-10-08.v1.md) records source identity safeguards and remaining evidence limits.

## Copied save results

| F2P result | Player 1 before | Player 1 after | Player 2 before | Player 2 after |
| --- | ---: | ---: | ---: | ---: |
| All possible tasks including partner support | 1,650 | 1,577 | 1,705 | 1,634 |
| Possible obligations in the player's own map | 1,615 | 1,543 | 1,646 | 1,584 |
| Active presented tasks | 29 | 28 | 54 | 53 |
| Obtainable item or currency names | 1,930 | 1,597 | 1,931 | 1,601 |
| Eligible equipment | 515 | 511 | 508 | 506 |
| BiS recommendation slots | 45 | 45 | 47 | 47 |
| Combat loadouts | 5 | 5 | 5 | 5 |
| Upgrade comparison paths | 50 | 50 | 50 | 50 |

Player 1 loses 72 possible own obligations and Player 2 loses 62. Across all possible tasks, 73 and 71 disappear; no new possible task is added. Both Active Tasks lists lose only **(Furniture Plans) Unlock furniture plans: Altar of War**. Onyx engraving and the other named regression cases are policy tests; the ledger identifies precisely which were exposed in this copied save rather than implying that every named example was active.

| Classification scope | Player 1 | Player 2 |
| --- | ---: | ---: |
| a — removed own member activities, products or equipment goals | 49 | 46 |
| b — removed own obligations losing member supplies or routes | 23 | 16 |
| a — removed tasks across all possible rows | 50 | 53 |
| b — removed tasks across all possible rows | 23 | 18 |
| b — surviving capability tasks with fewer sources | 378 | 370 |
| Removed item-source rows | 922 | 899 |
| c — finite item/source/currency/quest/method safeguard probes | 41 | 44 |
| c — false-positive task removals after review | 0 | 0 |
| Known surviving membership violations | 0 | 0 |

These scopes overlap: a free task can retain an alternative and also lose a member source. The ledger records optional and transitive evidence separately from necessary dependencies. Its finite false-positive checks cover the cases described below; zero known violations refers to the verified catalogue, with unresolved evidence retained as a review queue.

The complete baseline dependency ledger has **968 rows for Player 1 and 1,044 for Player 2**. It classifies 50/53 as **a** and 918/991 as **b**. Within b, 23/18 disappear, 403/395 retain availability with fewer input or output sources, and 492/578 retain valid alternatives to their optional member paths. The 41/44 c probes are separate checks and are not added to that row population. All 11/14 previously available free-quest probes remain available.

The equipment items becoming completely unobtainable are **Adamant dart, Off-hand adamant dart, Bronze dart and Bronze knife** for Player 1, and **Bronze dart and Bronze knife** for Player 2. They lose member source routes; the report does not relabel free items as intrinsically members-only. Another 84 and 80 equipment records retain eligibility with changed evidence, mostly fewer sources. Recommendation/loadout/path counts stay stable; their named choices, alternatives and steps are compared in the ledger.

No best recommendation, tie or selected combat loadout changes. Nine of Player 1's 50 upgrade paths and six of Player 2's change: obsolete dart/knife steps and other restricted alternatives disappear. Player 1's affected comparisons span Melee, Ranged and Prayer one-handed, dual-wield and shield paths; Player 2's span Ranged and Prayer. Recorded obtained-item facts remain empty for both players and saved facts are unchanged.

F2P-off results are deeply equal for both players, excluding only elapsed/evaluation/timing counters. This comparison covers complete results, presentation, equipment planning and current BiS rather than counts alone.

## Item evidence

The authoritative raw field is **`raw.definition.members`**, decoded from item opcode **`0x10`**. Presence means true; an absent flag means false. It is not a guessed membership parameter from `params`. The versioned [raw flag table](../../app/data/item-membership-flags.2026-10-08.v1.json) preserves all **63,798 decoded IDs**: 26,797 true and 37,001 default false.

Raw bits and ordinary item identity have different purposes. The 19,317 unnamed IDs include 13,797 note/loan/bind/combine template IDs. Their raw bits do not establish an inherited, usable inventory item's membership. Ordinary name lookup therefore uses 44,481 named ordinary IDs in 34,630 name groups; the complete raw table retains excluded IDs and their reasons for audit.

The [ordinary catalogue](../../app/data/item-membership.2026-10-08.v1.json) records 13,817 unanimously free groups, 19,786 unanimously member groups and 1,027 mixed groups. All 544 mixed groups used by retained picker names were cross-checked, alongside a deterministic 120-name sample and targeted names. The pinned collection covers 807 Wiki titles in 43 bounded API batches. Explicit Wiki IDs resolve 521 mixed groups; five cache/Wiki disagreements remain unknown rather than being forced to either answer.

The follow-up [alias catalogue](../../app/data/item-membership-aliases.2026-10-08.v1.json) reviews 112 obtainable unmatched names using 96 titles in five batches of at most 20. It resolves 52 free names and 21 member names, retaining 39 unknown reviews. Charged, inventory, legacy and New Varrock variants are selected by explicit Wiki IDs and matching cache flags. Ordinary Games necklace IDs 3853–3867 remain free; compacted ID 41070 remains members-only.

`Slayer points` is a reviewed virtual Currency entity in the picker, distinct from physical cache token 50250. The [entity catalogue](../../app/data/picker-entities.2026-10-08.v1.json) preserves that distinction: the physical token retains its true raw member flag, while the canonical gameplay currency is free and obtainable through Jacquelyn. [Pinned currency evidence](https://runescape.wiki/w/Special:PermanentLink/37162661).

## Sources and methods

The source catalogue reviews 11,402 exact retained labels across NPCs, monsters, shops, objects, areas and quest/spell/prayer methods. It uses 7,893 main Wiki titles plus bounded follow-ups, for 203 sequential API calls without retries. The source review gives counts by kind and explains why generic scenery, mixed rooms, unsupported infoboxes and ambiguous aliases remain unresolved.

Stock rows and drop-table branches are checked independently of their parent source. For example, [King Black Dragon](https://runescape.wiki/w/Special:PermanentLink/37188001) is free, but its Magic logs drop belongs to the members table. Nested Gem-to-Rare-table branches are filtered for monster drops, object loot and task output. Existing room policies still apply, including the member portion of Edgeville Dungeon.

The separate row catalogue contains 536 restrictions: 155 shop-stock rows, 364 monster/table drop rows, four Shaft recipes, ten advanced Slayer methods, two Demon Boss aliases and one reviewed shop alias. **Sir Renitee's Construction Supplies** inherits verified member-source eligibility from its uniquely identified supplier and explicit crest/painting/map service evidence. This removes the shop's 16 unresolved heraldry names through their source, without inventing physical item flags. [Pinned Sir Renitee revision](https://runescape.wiki/w/Special:PermanentLink/37179191).

Existing skill/trial caps and authored `Not F2P` requirements remain in force. Pinned method policies supplement them, including four member Shaft recipes and ten advanced Slayer assignment methods. Turael and Jacquelyn remain free masters; an accessible advanced-master NPC does not make its assignments free. [Pinned Slayer evidence](https://runescape.wiki/w/Special:PermanentLink/37197819).

Member area flags are withheld when exact retained locations contradict a pinned free quest path. This preserves Violet is Blue, Violet is Blue Too and Death Plateau routes while retaining individual source and room restrictions. [Land of Snow and Sabbot's Cave details](source-membership-audit.2026-10-08.v1.md).

## Named examples and false positives

| Case | Classification and resulting behavior |
| --- | --- |
| Onyx engraving | **b:** engraving itself is free. The retained task omitted its Onyx amulet input; guarded F2P metadata supplies that requirement, and the ordinary item gate blocks the unavailable member supply. [Gunnar's Ground](https://runescape.wiki/w/Special:PermanentLink/37177980), [Onyx amulet](https://runescape.wiki/w/Special:PermanentLink/37027868). |
| Magic logs | **c for the item flag, b for member sources:** logs are free. Magic trees, member KBD/Rare-table rows and the magic-log Shaft recipe are restricted. A genuinely admitted free log supply still permits ordinary fire-making. [Magic tree](https://runescape.wiki/w/Special:PermanentLink/37158111), [Shaft recipes](https://runescape.wiki/w/Special:PermanentLink/37171926). |
| Magic bows, unstrung bows, stock, planks and frames | **a:** member products are rejected generically by their cache/Wiki identity. Free logs do not make those products free. |
| Saradomin, Guthix and Zamorak staffs | **a:** member items 2415, 2416 and 2417 are excluded from supplies, wield tasks, equipment choices, alternatives, loadouts and upgrades. |
| Amulet of glory | **a:** the ordinary Wiki ID 1704 resolves the same-name free placeholder conflict; the member item is excluded. [Pinned glory revision](https://runescape.wiki/w/Special:PermanentLink/37164357). |
| Acadia burning and Wendlewick cutting | **c for banning the action:** both free actions survive exact guarded incidental-output policies. Bee/amber loot and Oaken keys remain filtered. Required items, locations and method gates still apply. [Acadia logs](https://runescape.wiki/w/Special:PermanentLink/37161702), [Oaken key](https://runescape.wiki/w/Special:PermanentLink/37178543). |
| Ordinary Games necklace and cats | **c:** explicitly matched ordinary inventory IDs are free. Other compacted or unrelated variants cannot change that result. |
| Rune Essence mine | **c:** the mine and ordinary free entrances survive. Mixed rune/pure rock evidence does not justify a blanket rock ban; the retained pure-essence method is already restricted. [Pinned mine revision](https://runescape.wiki/w/Special:PermanentLink/37180851). |
| Free dragons, Chaos Elemental and King Black Dragon | **c:** their free intrinsic flags are preserved; member drop rows and location-specific restrictions are handled separately. |
| Wicked hood | **a:** Tam McGrubor is free, but the item and acquisition are members-only. [Pinned Tam revision](https://runescape.wiki/w/Special:PermanentLink/37124239). |

The class labels describe obligations: **a** means an intrinsically member activity, member product activity or member equipment goal; **b** means a free action loses a member supply/source/method and survives only when a valid free alternative remains; **c** means the suspected blanket ban is a false positive. Optional member graph paths are recorded as supporting evidence, not treated as proof that every dependent task must disappear.

## Eligibility behavior

Item membership is checked when admitting base sources, mandatory task inputs, products and equipment. Mixed random tables retain free outcomes. Item aliases preserve OR semantics and counted choices. Free quest rewards can lose member items while the quest remains available. Historical completions and manual source overrides remain saved facts but cannot generate member products or revive a currently restricted activity.

The same eligibility rules cover combat gear, shields, ammunition, specialist comparisons, current recorded BiS, alternatives and upgrade paths. Diagnostics identify the actual restriction, such as `members-only-item`, a member source, member stock row or member method. With F2P disabled, the new gates return no restriction and guarded F2P metadata does not alter all-mode task definitions.

## Remaining choices and evidence limits

The current policy evaluates obtainable supplies for the duo's challenge. It does not infer possession from a tradeable free item or a saved manual selection. If Player 1 wants a separate rule for manually supplied items that F2P may hold/use but cannot obtain or make, that should be an explicit supply rule; it should not weaken the member-source gates. Magic logs and the intrinsically free engraving action illustrate this distinction.

Unknown identity remains unknown. Of the 39 unresolved alias reviews, 16 heraldry names disappear through Sir Renitee's verified member shop. The remaining **23 obtainable unknown names per player** include virtual progress markers, ceremonial swords, historical event items, a Timepiece aggregate, a Gold amulet spelling and Topiary hedge stock. Source evidence still has 4,192 and 4,184 unmatched source-row references respectively; these are repeated item/source/provenance references, not that many distinct NPCs or shops.

Garden Centre's Topiary hedge stock was removed in July 2026; Racing boots and Starting horn were removed in 2014, and Super large egg in February 2026. Those are stale-content decisions rather than membership bans. Ceremonial-sword creation is members-only, while the reward shop expressly permits free purchases with restrictions on use; its aggregate stock name cannot justify a blanket member purchase ban. Timepiece describes a family of item states. The [source review](source-membership-audit.2026-10-08.v1.md) records their pinned evidence. These cases remain unchanged pending separate identity or stale-content cleanup.

Five ordinary cache/Wiki disagreements—Medium XP lamp, Sneakerpeeper, Wingsuit v1, Wingsuit v2 and Herbert—remain unresolved. Mixed scenery, generic object labels and unverified NPC metadata are review queues. The decoded NPC export has no verified membership flags; object member-action candidates alone cannot certify a whole source. The zero-known-violation check covers verified rules; unresolved sources still require evidence.

## Changed files and provenance

Runtime changes are confined to `app/tasks/access.mjs`, `engine.mjs`, `equipment.mjs`, `presentation.mjs`, the new `membership.mjs`, and versioned membership data/loaders in `app/data`. New gather/build/review scripts and the copied-save audit script reproduce the evidence. Tests cover generic gates, named regressions, false positives, F2P-off controls and provenance. Existing synthetic fixtures now use unique names where names such as Seed, Coin or Tooth collide with real cache items; member-equipment fixtures explicitly request F2P off.

No state commands, original-picker sync, web task-row UI, main-checkout tracked files, live picker, game client or Tailscale settings were changed. `.gitattributes` is unchanged. Repository text hashes use `sha256RepositoryText` from `scripts/lib/provenance-hash.mjs`; external exports, saved Wiki snapshots and copied-save bytes use exact SHA-256. The ledger records the immutable baseline's original raw-working-tree hash convention and the final LF-normalized convention separately.

Five F2P prediction goldens changed because the fixture's real cache members-only Seed (39702) and Coin (34335), their dependent paths and new membership diagnostics are now correctly excluded. The members-inclusive prediction golden is unchanged. This is an intentional eligibility change, not a formatting refresh.

## Top 50 removed obligations by category

These are 50 distinct own obligations from the complete removal ledger, sorted by category and label rather than ranked by impact. M means Player 1; R means Player 2. Classifications use the verified dependency ledger.

### Cooking

| Removed obligation | Players | Class |
| --- | --- | --- |
| Brew Chef's delight | M, R | a |
| Brew Moonlight mead | M, R | a |
| Cook a cooked undead chicken | M, R | a |
| Cook barley malt | M, R | a |
| Cook cooked sweetcorn | M, R | a |
| Cut orange chunks | M, R | a |
| Cut orange slices | M, R | a |
| Cut pineapple chunks | M | a |
| Cut pineapple rings | M | a |
| Grind ground crab meat | M | a |
| Make a pineapple pizza | M | a |
| Make a potato with cheese | M, R | a |
| Make chocolatey milk | M, R | a |

### Crafting

| Removed obligation | Players | Class |
| --- | --- | --- |
| Craft a jade necklace | M, R | a |
| Craft an opal bracelet | M, R | a |

### Defence

| Removed obligation | Players | Class |
| --- | --- | --- |
| Wear a piece of elite black armour | M | b |

### Extra

| Removed obligation | Players | Class |
| --- | --- | --- |
| (Furniture Plans) Unlock furniture plans: Altar of War | M, R | b |

### Farming

| Removed obligation | Players | Class |
| --- | --- | --- |
| Apply supercompost to a farming patch | M, R | b |
| Fill supercompost from a bin | M, R | a |

### Firemaking

| Removed obligation | Players | Class |
| --- | --- | --- |
| Craft acadia incense sticks | M, R | a |
| Craft accursed acadia incense sticks | M, R | a |
| Light a bullseye lantern (oil) | M, R | a |

### Fletching

| Removed obligation | Players | Class |
| --- | --- | --- |
| Create an enhanced grappling hook | M, R | a |
| Fletch a adamant crossbow (unstrung) | M, R | b |
| String a adamant crossbow | M, R | b |

### Herblore

| Removed obligation | Players | Class |
| --- | --- | --- |
| Grind a crushed nest | M, R | a |
| Grind anchovy paste | M, R | a |
| Make imp repellent | M, R | a |
| Make neem oil | M, R | a |

### Magic

| Removed obligation | Players | Class |
| --- | --- | --- |
| Train Magic in New Varrock | M | b |

### Nonskill

| Removed obligation | Players | Class |
| --- | --- | --- |
| Access the cosmic rune temple with a talisman | M, R | b |
| Black Knights' Fortress Entry (elite black armour) | M | b |
| Buy Ale yeast from Malt | M, R | a |
| Fill a bucket of sap | M, R | a |
| Fill a bucket with sand | M, R | a |
| Gather a bucket of wax | M, R | a |
| Get a bullseye lantern from your lorehound | M, R | a |
| Get a polar camo top made | M, R | a |
| Get polar camo legs made | M, R | a |
| Loot a seed bird nest+ | M, R | a |
| Loot Raz's stash | M, R | b |
| Make a hangover cure | M, R | a |
| Make acadia planks | M, R | a |
| Make an impling jar | M, R | a |
| Make anchovy oil | M, R | a |

### Ranged

| Removed obligation | Players | Class |
| --- | --- | --- |
| Wield a bronze dart | M, R | b |
| Wield a bronze knife | M, R | b |
| Wield an adamant dart | M | b |
| Wield an off-hand adamant dart | M | b |

### Slayer

| Removed obligation | Players | Class |
| --- | --- | --- |
| Receive a slayer assignment from Vannaka | M, R | a |

## Validation and evidence hashes

Full `npm test`: **1,729 tests, 1,728 passed, one skipped, zero failures**. The focused membership suites pass **49/49**. The full run completed after the final runtime/data changes. Independent review checked variant identity, source identity, generic gates, F2P-off behavior, provenance and LF bytes.

F2P-off values are identical before and after:

| Player | Own possible | Active | Equipment | Recommendations | Loadouts | Upgrade paths |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Player 1 | 5529 | 341 | 758 | 53 | 5 | 55 |
| Player 2 | 5218 | 349 | 753 | 53 | 5 | 55 |

| Evidence | Exact byte SHA-256 |
| --- | --- |
| Copied save revision 32 | `c023a0bdcc49bf007e200aad35108d58ba6dd8612935564cdca88100c0b6a2b0` |
| Baseline result capture | `43f2b4b897ee57fa1303ed4fb6d825d48b2e58296eae8a27b5aa1e1f14a65a63` |
| Final result capture | `0263075ab9cc2ae2966fdfdacfdf1af83d7967b070fc9c50decaf7d4a38f744d` |
| Published JSON ledger | `b9d334a63221dad6ce6b19bd02dc91dd1812ccbcc113c1ab0aeb129c642f9940` |

Pinned research snapshots remain under the worktree `.local/game-data`; their manifests and hashes are recorded in the versioned datasets. Raw copied-save content is excluded from Git.

The copied duo directory and all ten private result/delta captures were deleted after validating the published ledger. Only bounded task-name summaries, test logs and research snapshots remain locally; none are committed.

## Complete changed file inventory

- [app/data/item-membership-aliases.2026-10-08.v1.json](../../app/data/item-membership-aliases.2026-10-08.v1.json)
- [app/data/item-membership-aliases.mjs](../../app/data/item-membership-aliases.mjs)
- [app/data/item-membership-flags.2026-10-08.v1.json](../../app/data/item-membership-flags.2026-10-08.v1.json)
- [app/data/item-membership-flags.mjs](../../app/data/item-membership-flags.mjs)
- [app/data/item-membership-index.mjs](../../app/data/item-membership-index.mjs)
- [app/data/item-membership.2026-10-08.v1.json](../../app/data/item-membership.2026-10-08.v1.json)
- [app/data/item-membership.mjs](../../app/data/item-membership.mjs)
- [app/data/picker-entities.2026-10-08.v1.json](../../app/data/picker-entities.2026-10-08.v1.json)
- [app/data/source-incidental-outputs.2026-10-08.v1.json](../../app/data/source-incidental-outputs.2026-10-08.v1.json)
- [app/data/source-membership.2026-10-08.v1.json](../../app/data/source-membership.2026-10-08.v1.json)
- [app/data/source-membership.mjs](../../app/data/source-membership.mjs)
- [app/data/source-method-requirements.2026-10-08.v1.json](../../app/data/source-method-requirements.2026-10-08.v1.json)
- [app/data/source-row-membership.2026-10-08.v1.json](../../app/data/source-row-membership.2026-10-08.v1.json)
- [app/tasks/access.mjs](../../app/tasks/access.mjs)
- [app/tasks/engine.mjs](../../app/tasks/engine.mjs)
- [app/tasks/equipment.mjs](../../app/tasks/equipment.mjs)
- [app/tasks/membership.mjs](../../app/tasks/membership.mjs)
- [app/tasks/presentation.mjs](../../app/tasks/presentation.mjs)
- [docs/research/f2p-membership-audit.2026-10-08.v1.json](../../docs/research/f2p-membership-audit.2026-10-08.v1.json)
- [docs/research/f2p-membership-audit.2026-10-08.v1.md](../../docs/research/f2p-membership-audit.2026-10-08.v1.md)
- [docs/research/source-membership-audit.2026-10-08.v1.md](../../docs/research/source-membership-audit.2026-10-08.v1.md)
- [scripts/audit-f2p-membership.2026-10-08.v1.mjs](../../scripts/audit-f2p-membership.2026-10-08.v1.mjs)
- [scripts/build-item-membership-aliases.2026-10-08.v1.mjs](../../scripts/build-item-membership-aliases.2026-10-08.v1.mjs)
- [scripts/build-item-membership-flags.2026-10-08.v1.mjs](../../scripts/build-item-membership-flags.2026-10-08.v1.mjs)
- [scripts/build-item-membership.mjs](../../scripts/build-item-membership.mjs)
- [scripts/build-picker-entities.2026-10-08.v1.mjs](../../scripts/build-picker-entities.2026-10-08.v1.mjs)
- [scripts/gather-current-item-membership.2026-10-08.v1.mjs](../../scripts/gather-current-item-membership.2026-10-08.v1.mjs)
- [scripts/gather-item-membership-wiki.mjs](../../scripts/gather-item-membership-wiki.mjs)
- [scripts/lib/item-membership-alias-evidence.mjs](../../scripts/lib/item-membership-alias-evidence.mjs)
- [scripts/lib/item-membership-evidence.mjs](../../scripts/lib/item-membership-evidence.mjs)
- [scripts/lib/source-membership-evidence.mjs](../../scripts/lib/source-membership-evidence.mjs)
- [scripts/review-source-drop-membership.mjs](../../scripts/review-source-drop-membership.mjs)
- [scripts/review-source-membership.mjs](../../scripts/review-source-membership.mjs)
- [tests/access.test.mjs](../../tests/access.test.mjs)
- [tests/cache-archaeology-application.test.mjs](../../tests/cache-archaeology-application.test.mjs)
- [tests/cache-shop-f2p-membership.test.mjs](../../tests/cache-shop-f2p-membership.test.mjs)
- [tests/cache-unresolved-access.test.mjs](../../tests/cache-unresolved-access.test.mjs)
- [tests/equipment-permanence-rule.test.mjs](../../tests/equipment-permanence-rule.test.mjs)
- [tests/equipment-permanence-worker.test.mjs](../../tests/equipment-permanence-worker.test.mjs)
- [tests/f2p-equipment-membership.test.mjs](../../tests/f2p-equipment-membership.test.mjs)
- [tests/f2p-task-membership.test.mjs](../../tests/f2p-task-membership.test.mjs)
- [tests/item-membership-aliases.test.mjs](../../tests/item-membership-aliases.test.mjs)
- [tests/item-membership-data.test.mjs](../../tests/item-membership-data.test.mjs)
- [tests/item-membership-flags.test.mjs](../../tests/item-membership-flags.test.mjs)
- [tests/partner.test.mjs](../../tests/partner.test.mjs)
- [tests/prediction-output.test.mjs](../../tests/prediction-output.test.mjs)
- [tests/presentation.test.mjs](../../tests/presentation.test.mjs)
- [tests/rules-fixes.test.mjs](../../tests/rules-fixes.test.mjs)
- [tests/source-membership.test.mjs](../../tests/source-membership.test.mjs)
- [tests/tasks.test.mjs](../../tests/tasks.test.mjs)
