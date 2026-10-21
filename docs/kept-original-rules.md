# Saved rules with no gameplay effect

Chunk Rules hides these 23 catalogue keys during normal use. With Settings → Advanced on, they appear once in a folded **Kept from the original picker, not used here** group. Each row shows the saved or inherited value without a switch. Additional historical or unknown keys in a save join the same group, including the old lowercase `Cleaning herbs` spelling when present.

The catalogue, personal overrides, inherited original-map payloads and backups retain their values. Opening, searching or exporting rules does not write anything. Original presets now apply only supported rules and preserve unused values and absent keys. Original-picker sync can still import the exact primitive values through its existing revision-checked command, with History and Undo; full backups and rule-profile exports retain them. Explicit rule-profile imports retain their existing replace-and-review behavior.

These classifications describe this checkout, not every possible upstream dataset. The previous badges called `Wield Crafted Items Override` and `Secondary MTA` partial; their only engine consumer emits an unsupported-rule diagnostic. They are now correctly marked not implemented. Other partial rules, including Skiller, Boosting, skilling relics and equipment weight, still have working effects and remain in their normal sections.

| Saved key | Why it is inert here |
| --- | --- |
| `Wield Crafted Items Override` | The engine reports it as unsupported; no crafted-output BiS recipe rerun or higher processing obligation is implemented. |
| `Secondary MTA` | The engine reports it as unsupported; no Mage Training Arena forced-primary rune restriction consumes it. |
| `Pouch` | No matching declared task category or pouch-obligation generator. |
| `Bakami` | The retained rows use malformed `Categories` metadata and are excluded independently; this key has no supported consumer or matching `Category`. |
| `HigherLander` | No declared category or generator for intermediate and veteran Pest Control lander obligations. |
| `KeyItem Bosses` | No keyed-boss acquisition-rate adjustment; the retained dataset also lacks the upstream `keyMonsters` dictionary. Ordinary item requirements remain separate. |
| `Manually Complete Tasks` | This picker offers completion controls independently of the original manual-completion display flag. |
| `Dungeoneering Journals` | A retained default without a matching declared category or journal-task generator. |
| `Quest Skill Reqs` | No unconditional quest-skill requirement generator for this WIP flag. Ordinary quest requirements have separate consumers. |
| `Not Daily DnD` | No matching declared category or non-daily source policy. |
| `Costume Room` | A historical key with no gameplay consumer; distinct from both Fill Costume Room and authored House storage tasks. |
| `Multiple Pickpockets` | A historical upstream migration input for Multiple Agility; this exact key has no authored consumer. |
| `Misc Combat Achievements` | Case differs from the working `Misc Combat achievements` category; this exact key has no matching tag. |
| `Hunter Marks Slayer` | A historical upstream migration input for XP Lamps; this exact key does not control XP Lamps here. |
| `Fill Costume Room` | No costume-room fill generator for this WIP key. Authored House storage tasks remain available separately. |
| `Collection Log Bosses` | Historical detector name with no matching category; the working key is `Boss Collection Log`. |
| `Collection Log Raids` | Historical detector name with no matching category or raid-log generator for this key. |
| `Collection Log Clues` | No matching retained category; the upstream special clue-reward feasibility algorithm is unimplemented. |
| `Collection Log Minigames` | Historical detector name with no matching category or generator for this key. |
| `Collection Log Other` | Historical detector name with no matching category or generator for this key. |
| `Stuffables` | Historical detector name without a matching category or stuffing-task generator. |
| `Fill POH` | Historical detector name without a matching category or fill-house generator. |
| `Primary Spawn` | Singular typo in an upstream preset; the working key is plural `Primary Spawns`. It is not silently treated as an alias. |

Evidence: [the original rule audit](original-rules-audit.md), especially its rule-by-rule inventory and historical-key table; `app/data/settings.mjs` behavior classification and declared-category counts; and `app/tasks/engine.mjs` unsupported-rule diagnostics. No gameplay evaluator, command schema, preference key or sync mapping changed for this cleanup.
