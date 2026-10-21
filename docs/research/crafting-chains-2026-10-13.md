# Crafting chain source review — 2026-10-13

H5 fixes two source-selection errors in `app/tasks/processing.mjs`. Every required ingredient must have an ordinary, allowed acquisition path before a recipe publishes ordinary supplies. An independent bowstring can no longer promote a conditional unstrung bow. Hide Partial Products now affects goal presentation while usable intermediate products remain available to later recipes.

The [comparison evidence](crafting-chain-save-comparison.2026-10-13.v1.json) records nine Wiki revision pins, source-code hashes, the copied-save hash, exact rule commands and before/after task deltas. Wiki facts establish materials and facilities; the picker’s processing rules determine which potential recipes count as ordinary supplies. These checks do not establish in-game completion.

## Early supplies

A retained-definition fixture uses `001027` shortbow (unstrung), `001030` longbow (unstrung), `001031` String longbow and `000818` Spin flax. With Highest Level off and Multi Step Processing on, the lower shortbow recipe should win the log input. Before the fix, ordinary Bowstring independently selected String longbow. Its level-5 frontier then promoted the excluded longbow producer, turning both outputs into ordinary primary supplies.

After the fix, both longbow stages keep conditional source evidence. They cannot seed ordinary owned supplies or active goals. Independent unstrung-bow supplies, Highest Level and supported personal completion still admit the legitimate chain. The [longbow revision](https://runescape.wiki/w/Special:PermanentLink/37163571) requires level 5 Fletching for both stages; the [bowstring revision](https://runescape.wiki/w/Special:PermanentLink/37198222) records flax and a spinning wheel.

## Late supplies on the copied save

The read-only comparison used revision 110 from a disposable copy of `.local/duo`, excluding `store.lock` and `access-token`. The copied state hash stayed `a1099ade82a40ab9c4c403a5d14eb3c7258fccad1fb0bfc3f246202ced80df49`. Each rule variant starts from that same state and uses revision-checked `set-task-rule` commands for both players. No live state or original invitation was changed.

With Hide Partial Products temporarily enabled, Player 2’s accessible acadia chain previously lost its intermediate supplies:

| Task | Before | After |
| --- | --- | --- |
| `001092` Fletch an acadia stock | Recipe available, output excluded | Ordinary stock source admitted |
| `001093` Fletch a rune crossbow (unstrung) | Blocked: missing Acadia stock | Available with admitted output |
| `001094` String a rune crossbow | Blocked: missing unstrung crossbow | Available |
| `001096` Fletch an acadia longbow (unstrung) | Recipe available, output excluded | Ordinary intermediate admitted |
| `001097` String an acadia longbow | Recipe available, output excluded | Ordinary crafted source admitted |

The fix adds Acadia stock, Acadia longbow (unstrung) and Rune crossbow (unstrung) to the item catalogue in this variant. It restores crafted routes for Acadia longbow and main-hand, off-hand and two-handed rune crossbows; those finished item names already had other sources. The [stock](https://runescape.wiki/w/Special:PermanentLink/37180167) and [unstrung crossbow](https://runescape.wiki/w/Special:PermanentLink/37181834) revisions confirm acadia logs → stock → stock plus rune limbs at Fletching 53.

Both players’ normal saved configuration has identical crafting task availability, chain training, item sources and presented goals before and after H5. The temporary Multi Step variant also has no copied-save gameplay changes. Player 1’s Hide Partial variant is unchanged. Player 2’s Hide Partial variant gains the five task/source changes above; his existing presented goal list and training ceilings remain unchanged. Sparse synthetic fixtures expose the early longbow error; it was not observed in this copied save.

## Other chains and verification

Focused tests retain ore → bronze bar → equipment, cowhide → leather → armour, flax → bowstring → bow, and clay → soft clay → unfired pottery → fired pottery. Missing tin, furnace, anvil, tanner, water, wheel or oven blocks the appropriate stage. Independent sources, counted alternatives, unique case-only aliases and allowed-source restrictions remain covered.

A second retained fixture confirms Hide Partial can no longer suppress the level-8 unfired-bowl source needed for firing. The [unfired bowl](https://runescape.wiki/w/Special:PermanentLink/36499196) and [bowl](https://runescape.wiki/w/Special:PermanentLink/37132004) revisions require soft clay, a wheel and an oven at Crafting 8. The [bronze bar](https://runescape.wiki/w/Special:PermanentLink/37012046), [leather](https://runescape.wiki/w/Special:PermanentLink/37171846) and [soft clay](https://runescape.wiki/w/Special:PermanentLink/37179488) revisions support the other material stages.

`tests/processing-chains.test.mjs` adds nine focused regressions. Existing processing parity tests also pass. All six complete prediction-output fingerprints remain unchanged; no golden hash was replaced. H4’s separate completion guard keeps unsupported saved tasks from publishing supplies or inferring levels while preserving their personal checkmarks. Full-suite results and screenshots are reported with the final local commit.
