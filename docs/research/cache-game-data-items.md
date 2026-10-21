# Copied-cache item definitions and picker comparison

This report describes the retained export and original extraction. [The equipment integration report](cache-equipment-corrections.md) documents the subsequent ID/variant review, sparse-field calibration, applied corrections and Wiki weights.

The offline extractor decoded **63,798 items and 9,498 parameter definitions with zero errors** from the copied snapshot. It compares every retained equipment row and inventories declared item names. No application behaviour, live picker, game client, private save or original-cache SQLite handle was changed.

The cache does **not** supply a validated weight field. All **3,550 picker equipment rows lack weights; zero weights can be replaced from this extraction**. Wiki sample weights are separate external evidence. In particular, [Boots of lightness, revision 37132350](https://runescape.wiki/w/Boots_of_lightness?oldid=37132350) distinguishes inventory ID 88 (0.34 kg) from worn ID 89 (-4.535 kg); a name-only weight assignment would be wrong.

## Reproduction and provenance

Run from this worktree with Node 24.19.0. The default extractor is offline; optional Wiki evidence is a previously fetched JSON response. Each run requires new output filenames.

```powershell
node --max-old-space-size=4096 scripts/cache/game-data-items.mjs `
  --workspace C:/Users/User/Projects/rs3-cache-work `
  --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-NEW-VERSION `
  --wiki-evidence C:/Users/User/Projects/rs3-cache-work/items-wiki-samples-2026-10-08-v1.json
node --test tests/cache-game-data-items.test.mjs
```

`openGameCache()` verifies pristine [rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). Schema build **950** is inferred, not an independently verified game-client build. Only copied `js5-19.jcache` and `js5-2.jcache` are opened read-only with `query_only`. Major 19 was obtained by plain `Copy-Item` from the original directory. Pinned constants specify items major 19, grouped in 256 IDs, and params major 2/minor 11. The snapshot lacks filename major 67, which could otherwise supply internal parameter names.

Final output directory: [items-2026-10-08-v2](C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-2026-10-08-v2). Its [manifest](C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-2026-10-08-v2/items.manifest.v1.json) records full database hashes, every consumed decompressed archive hash/version/subfile inventory, decoder/schema hashes, reference hash and output hashes. Manifest SHA-256: `7faac7f68d9483e4e5e9c1fe4408787b3286568d474f5e71902214ad77dd45a9`. The earlier v1 is superseded; its preliminary comparisons included incompatible off-hand damage and slot conventions.

Full local datasets are `items.raw.v1.json`, `items.v1.json`, `items.params.v1.json`, `items.comparison.v1.json` and `items.wiki-samples.v1.json`. The [committed compact report](cache-game-data-items.2026-10-08.v1.json) contains counts, hashes, all consensus disagreement rows, all unmatched equipment names, all ambiguous equipment IDs, eleven decoded samples and exact Wiki revision checks. Complete per-candidate disagreements and the 9,169-name item inventory remain in the full comparison.

## Interpretation and identity

Opcode-schema fields directly establish ID, name, members flag, primary/secondary equipment slots, stackability flags, value/raw big-value parts, explicit note/loan/bind/template links and raw parameters. `value` stays null where absent; the uncertain two-part `big_value` representation is preserved without guessing its arithmetic. Noted/template IDs are not silently merged with their base items.

Names use only the application's legacy-text decoding and NFC normalization, with no fuzzy matching, qualifier stripping, capitalization changes or guessed substitutions. None of the equipment names changed under normalization. All exact equippable candidates are retained; explicit templates and non-equippable conversion stubs are excluded from equipment identity. Thus the modern [Rune platebody, revision 37178499](https://runescape.wiki/w/Rune_platebody?oldid=37178499) is ID 45543, while ID 1127 is a conversion stub. Duplicate charged, worn, lent or quest-context names remain ambiguous even when their stats agree.

Numeric parameter meanings remain **inferred and sample calibrated**. Armour uses param 2870/10; prayer 2946; damage bonuses 641/643/965/8881 divided by ten; weapon accuracy 3267/4/3 for melee/ranged/magic. Requirements use ten consecutive STAT/level pairs beginning 749/750, checking param metadata type 17 when available. Sixty-seven item rows have incomplete or unsupported requirement pairs. Raw values and conflicting duplicate params remain visible; conflicting duplicates are withheld from projections.

Absent parameters are unknown, not zero. Raw damage on off-hand items and ammunition is withheld from displayed-auto-damage comparison because extra game formulas apply. Physical slot 5 includes both shields and off-hand weapons. Derived ability damage, tier, life points, speed, augmentation, charges, special attacks and complete quest/server equipability are unverified and not replaced. A decoded skill requirement does not prove there are no additional gates.

## Exhaustive comparison

| Measure | Rows |
| --- | ---: |
| Retained equipment | 3,550 |
| Unique exact equippable candidate | 2,474 |
| Ambiguous exact equippable candidates | 896 |
| No exact equippable candidate | 180 |
| At least one candidate disagrees on comparable fields | 226 |
| Every candidate agrees on a particular differing value | 142 |
| Missing picker weights / cache-replaceable weights | 3,550 / 0 |
| Declared item names / unique / ambiguous / unmatched | 9,169 / 6,058 / 1,890 / 1,221 |

The item-name inventory covers all names declared in equipment, shop stock, monster drops, object yields, skill-output tables and `itemsPlus` alternatives. It does not manufacture item identities from arbitrary prose or declare completeness for every task token/ground-spawn declaration. Item-name candidates include every named definition, including variants; equippable identity uses the narrower rules above. Source aliases, misspellings and table selectors stay unmatched rather than becoming invented items.

The 142 consensus disagreement rows include 28 main-hand auto-damage comparisons, 11 armour, 15 accuracy, 7 prayer and 72 declared-skill comparisons, plus 14 damage-bonus comparisons. Field totals overlap rows. They are review candidates, not proof that the picker is wrong: stale Wiki facts, snapshot changes and unverified formula semantics can all matter. Replacement scope is **2,474 uniquely named equipment candidates for review**, not 2,474 fully validated equipment records. No weight/rate/spawn/shop/drop/server data replacement is established.

## Validation

Fresh Wiki API revision responses for bronze platebody, rune platebody, mystic wand, bronze dagger, bronze 2h sword, amulet of glory, Torva platebody and boots of lightness produced **67 attempted ID/name/stat/skill checks: 58 matches, five explicitly different variant names, four unavailable cache fields and zero numeric differences**. Versioned identities remain distinct; unavailable fields are not counted as passing checks. These checks calibrate a small set of interpretations; they are not exhaustive live-game validation. [Mystic wand revision 36974539](https://runescape.wiki/w/Mystic_wand?oldid=36974539) corroborates ID 25644, Magic 50 and accuracy 850. [Torva platebody revision 37022076](https://runescape.wiki/w/Torva_platebody?oldid=37022076) corroborates Defence/Constitution 80, armour 389.6, prayer 3 and melee bonus 30; its life-point fact was retained only as external evidence.

Seven meaningful tests pass: conversion/template exclusion, duplicate-name disagreement handling, unknown/weight preservation and incompatible damage conventions, malformed/conflicting params, multi-skill pairs, exact item-name/source retention and explicit unavailable Wiki comparisons. A separate verification recomputed and matched all five output hashes and both copied-database hashes. Archive provenance is independently reviewable through the manifest. The app does not import these datasets.
