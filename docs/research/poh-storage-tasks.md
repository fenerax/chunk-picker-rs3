# Current RS3 house storage tasks

Research date: 2026-10-08. Catalogue: `app/data/poh-storage.2026-10-08.v1.json` (schema 1). The rule is exactly **House storage tasks**, boolean, default **off**. Existing `Costume Room` and historical `Fill Costume Room` settings do not enable it.

## Housing changed in July 2026

RS3 reworked player-owned housing on 13 July 2026. The historical costume room and furniture hotspots were removed. Current furniture is constructed at the Rimmington furniture workbench, deposited in furniture storage, and placed freely in a house. Players obtain housing through **There's No Place Like Home...**. Cape racks became **cape stores**. The current catalogue follows the replacement furniture, including Eternal tiers; it does not use historical recipes or OSRS pages. [Pinned housing page](https://runescape.wiki/w/Player-owned_house?oldid=37187278), [pinned workbench page](https://runescape.wiki/w/Furniture_workbench?oldid=37199289).

F2P housing exists and F2P Construction reaches level 20. The **wooden bookcase** has an explicitly F2P level-6 creation recipe, but it automatically offers unlocked books; there is no deposit or fill objective. All six catalogued deposit-storage families and the three display recipes require membership. A F2P mask, holiday item, or Treasure Trails cosmetic does not make its house storage available to F2P players. Enabling the rule with `content.f2p` still produces no goals. [Pinned wooden bookcase recipe](https://runescape.wiki/w/Wooden_bookcase?oldid=37117814), [pinned bookcase behavior](https://runescape.wiki/w/Bookcase?oldid=37178070).

The current storage pages report that access **from the bank interface** is temporarily disabled after the rework. This is a limitation of that access route, not evidence that current placed furniture has been removed. Goals refer to the furniture in the house and do not promise bank-interface access. [Pinned armour-case page](https://runescape.wiki/w/Armour_case?oldid=37188248).

## Catalogue coverage

The catalogue records 39 current furniture variants, 75 representative slots (67 supported objectives and eight catalogue-only golden Barrows sets) and 122 individual item records. Every item has a checked membership flag and pinned Wiki revision. Each furniture recipe and slot points to a pinned source record. Sources were retrieved through Tavily advanced extraction; page `oldid` links were taken from the returned Wiki footer. Item components from the fancy-dress and treasure tables were checked against their individual item pages. The JSON is reviewed factual data, not a copied Wiki page or executable reference code.

| Family | Current Construction levels | Representative objectives |
| --- | --- | --- |
| Armour case | 46, 64, 82, 87, 103, 110 | Mask of Dragith Nurn, helmet of trials, Void helms, individual obsidian pieces; eight golden Barrows reference sets |
| Cape store (historical name: cape rack) | 54, 63, 72, 81, 90, 99 | Fire cape, obsidian cape, god capes, Ava devices, Ardougne cloak 4 |
| Magic wardrobe | 42, 60, 78, 87, 96, 105, 114 | Complete Ghostly and Dagon'hai robes, lightbulb hat |
| Toy box | 50, 68, 86, 101 | Cornucopia, rubber chicken, snow globe, bunny ears, yo-yo |
| Fancy dress box | 44, 62, 80, 102 | Complete Mime, Zombie and Lederhosen outfits |
| Treasure chest | 48, 66, 84, 101 | 18 easy slots plus four medium/hard/elite amulets; trimmed wizard/studded sets, berets and Bob shirts |
| Automatic bookcase | 6, 29, 40, 64, 100 | Catalogue only; no fill tasks |
| Verified displays | Silverlight 42; anti-dragon shield 47; mahogany gilded cape stand 85 | Silverlight, anti-dragon shield and fire cape display |

Recipe levels and material quantities come from the current family pages: [armour cases](https://runescape.wiki/w/Armour_case?oldid=37188248), [cape stores](https://runescape.wiki/w/Cape_rack?oldid=37133926), [magic wardrobes](https://runescape.wiki/w/Magic_wardrobe?oldid=37181907), [toy boxes](https://runescape.wiki/w/Toy_box?oldid=37118681), [fancy dress boxes](https://runescape.wiki/w/Fancy_dress_box?oldid=37118679), [treasure chests](https://runescape.wiki/w/Treasure_chest?oldid=37118701). Display recipes come from [Silverlight](https://runescape.wiki/w/Silverlight_(furniture)?oldid=37131264), [anti-dragon shield](https://runescape.wiki/w/Anti-dragon_shield_(furniture)?oldid=37131257), and [cape stand](https://runescape.wiki/w/Mahogany_gilded_cape_stand?oldid=37188731).

Ordinary Barrows armour sets are absent from the checked current armour-case list, so ordinary Ahrim/Dharok/Guthan/Karil/Torag/Verac/Akrisae/Linza drop sets are not advertised as storable. The list instead contains eight **golden Barrows** variants. They require personal event eligibility and a fully repaired complete set. These eight are retained as explicitly disabled catalogue references; normal chunk drops cannot prove their raffle entitlement or repair state. Their individual components and membership flags were checked, and their set pages identify Leonard's Lucky Dip/Balthazar's Big Raffle as the source. [Pinned golden Ahrim set](https://runescape.wiki/w/Golden_Ahrim_the_Blighted's_equipment?oldid=37042570), [current storage list](https://runescape.wiki/w/Armour_case?oldid=37188248).

Neck-slot examples include **Amulet of magic (t)** (easy), **Strength amulet (t)** (medium), **Amulet of glory (t)** and **Amulet of fury (t)** (hard), and **Amulet of fury (or)** (elite). The current chest-tier table determines which furniture can hold each reward; an oak chest cannot admit a medium necklace. A plain amulet, soul necklace, or other unlisted jewellery item is not inferred to be storable from its equipment slot. [Pinned treasure list and tiers](https://runescape.wiki/w/Treasure_chest?oldid=37118701).

## Generation and progress

The task engine registers stable `rs3:goal:house-storage:<slot-id>` identities in its catalogue. It emits no house-storage rows until the rule is enabled. It then requires members mode, admitted access to **Furniture workbench** and **Furniture storage**, and an available whole completion task or personal completion evidence for the current housing tutorial.

Every component must have an admitted item source in the engine's existing capability map. A complete set uses AND between components and OR inside a component's alternatives. Rare-drop policy, member-source exclusions, locked chunks and partner connections are inherited from the ordinary engine; the helper never invents a source, a shop purchase, or a quest reward. An item being tradeable does not establish obtainability.

A compatible **current** furniture recipe must have all its materials obtainable and its Construction level reachable under the member's training and level caps. Treasure tiers must match. The lowest buildable compatible variant is selected. An old flatpack or an unchecked installed-furniture claim does not bypass these gates. Levels represent accessible future training, like ordinary chunk tasks; they do not assert the account has already reached that level. Declared primary methods and personal observations retain their ordinary meanings. Temporary boosts are not independently assumed for these recipes.

Recipe quantities are recorded for review. As in the existing item-set evaluator, admitted sources prove repeatable obtainability, not current inventory quantities or bank stock. Standard hammer/saw requirements remain implicit in the ordinary Construction recipe model; this helper does not claim to inspect the tool belt. Housing quest availability is a future planning gate, not a claim that a character has already completed it.

Own-map workbench/storage access and the housing quest's own-map obligation determine duty; connected partners can supply components and materials. A goal available only through partner facilities remains a hidden convenience row. Personal completion, any/all/personal challenge scope, and backlog state use existing progress semantics. Changing the furniture tier does not change the goal ID. Goals produce no XP, items, training methods, travel edges or chunk unlocks.

Toy-box goals describe item **retrieval availability**. The toy box shares Diango's interface and automatically includes qualifying reclaimed or destroyed items; it does not require a separate deposit. [Pinned toy-box behavior](https://runescape.wiki/w/Toy_box?oldid=37118681).

## Limits

This is a substantial representative catalogue, not an exhaustive inventory of every storable reward, cape, armour set, holiday item, book or furniture display. It includes all variants listed for the six selected storage families. Skillcape/mastercape storage, most medium/hard/elite rewards and all master reward slots, other display types, legacy discontinued-event entitlement proofs, degradation/repair state and furniture already installed on an account remain outside the implemented objective set.

Objectives describe individual storage slots. They do not claim that every optional goal can remain stored simultaneously in a low-capacity variant, or certify that the entire historical costume room is filled. Furniture capacity is preserved as review metadata. There is no global capacity-allocation solver or inferred inventory/entitlement state. Full sets are checked for obtainable components, not for actual ownership or repaired condition. Automatic bookcases are catalogue-only.

## Verification

`tests/house-storage.test.mjs` imports pure modules only and writes no files or account state. Fixtures check default-off behavior, F2P exclusion, current recipe thresholds, sources and materials, housing quest/facility gates, complete sets and alternatives, historical fail-closed behavior, display recipes, shared toy retrieval, stable progress IDs, backlog, completion scope and pinned provenance. These are automated model checks; no personal account storage action or live game validation was performed.

`tests/house-storage-server.test.mjs` uses an authenticated fixture on an ephemeral port with data inside this worktree. It verifies default-off sparse saves, rule activation, presentation, registering only a checked goal, exact undo and disabling. The worker exposes these potential objectives through its existing dynamic catalogue, stripping display-only slot metadata at the saved-task boundary. No scheduling, planning or performance algorithm changed. The full `npm test` run passed 1,205 tests on 2026-10-08.
