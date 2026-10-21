# Captured reference comparison

This review found and corrected saved-setting, source-access, and persistence omissions using the October 6 snapshot. A separate offline execution now supplies actual QXA reference output. The comparison remains bounded: it covers that historical own-access payload, while Player 2's map and both shared views have authored checks rather than direct original-output comparisons.

## Evidence and scope

- Public maps were captured at **2026-10-06T21:10:05.126695+00:00**, with upstream version **6.9.68**. QXA had **136 unlocked / 13 selected** bases; QXB had **113 unlocked / 20 selected**. These are historical captures, not current account state.
- Source evidence is [public-map-capture.json](<C:/Users/User/Projects/personal assistant/out/rs3-chunk-picker-audit-2026-10-06/evidence/public-map-capture.json>), [public-map-fixtures.json](<C:/Users/User/Projects/personal assistant/out/rs3-chunk-picker-audit-2026-10-06/evidence/public-map-fixtures.json>), and [qxa-worker-payload.json](<C:/Users/User/Projects/personal assistant/out/rs3-chunk-picker-audit-2026-10-06/evidence/qxa-worker-payload.json>).
- Every top-level reference-data category in the captured QXA `chunkInfo` is structurally identical to the repository JSON. Both contain **20,375 declared challenge records**. Dataset SHA-256: `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`.
- `qxa-worker-payload-output.txt` is a JSON string containing the same **input payload**, despite its filename. It does not contain `globalValids`, `tempChallengeArrSaved`, or `savedChunks` output. [qxa-worker-benchmark.json](<C:/Users/User/Projects/personal assistant/out/rs3-chunk-picker-audit-2026-10-06/evidence/qxa-worker-benchmark.json>) retains signatures of evaluated results, without the underlying labels. The QXB browser check retains only six search labels for `yew`.
- On October 7, the reference-verification lane executed the original worker offline against a cloned October 6 QXA payload. Network APIs throw, CDN imports are not resolved, and the VM has no Firebase frontend, credentials, or filesystem API. The actual output is [original-qxa-output.json](C:/Users/User/Projects/chunk-picker-rs3/out/reference-comparison/original-qxa-output.json); methodology and boundaries are in [reference-output-comparison.md](C:/Users/User/Projects/chunk-picker-rs3/docs/reference-output-comparison.md). Its initial 25-extra checkpoint predates the access corrections below; the current numerical result is pinned in [comparison.json](C:/Users/User/Projects/chunk-picker-rs3/out/reference-comparison/comparison.json).
- This access lane evaluated the authored engine against imported, migrated captured maps, first with each member's own ownership, then with shared ownership. It made no network request and changed no original map or fixture.

Comparison keys preserve category and exact decoded raw label. Readable labels remove wiki markup only for display. A repeated label in two categories never proves those tasks have the same identity.

## Authored-engine results after corrections

| Evaluation | Available declared tasks | Unsupported declared tasks | Unlocked bases | Accessible sections | Accessible named areas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Player 1, QXA ownership | 1,183 | 34 | 136 | 162 | 68 |
| Player 2, QXB ownership | 1,363 | 34 | 113 | 156 | 77 |
| Player 1, shared ownership | 1,384 | 34 | 153 | 187 | 84 |
| Player 2, shared ownership | 1,430 | 34 | 153 | 190 | 83 |

Shared ownership adds **201** available tasks for Player 1 and **67** for Player 2 relative to their own ownership; neither loses an available task. These are declared eligibility counts, before the final next-task and equipment selectors. Shared ownership is an intended group-rule difference from evaluating each original map separately.

Migration preserved 545 challenge-completion statuses, 45 backlogs, two notes, eight section overrides, 306 saved task-rule entries, one area override, and one source backlog across the two maps. Challenge checkmarks were not converted into personal quest completion or personal skill levels.

Measured authored-engine eligibility evaluation took approximately **0.82–1.02 seconds** for own ownership and **1.00–1.04 seconds** for shared ownership in this run, using Node 24.19.0. Those timings exclude full browser rendering and the original bespoke BiS calculation. The offline original worker took 12.657 seconds, and the captured browser worker measured 9.8–11.4 seconds for QXA's full calculation. These stages differ, so this review does not claim a matched end-to-end speedup.

## Evidence-backed corrections

| Captured evidence | Incorrect behavior found | Corrected behavior and classification |
| --- | --- | --- |
| QXA `backloggedSources.objects.Sawmill = true` | The Sawmill remained an available object. Construction “Make planks at a sawmill” and “Make oak planks at a sawmill” were available and promoted reachable Construction to 20. | Source backlog removes the object and its yields. Those tasks are blocked. Reachable Construction is 3, from preserved passive evidence, with no primary method. This was an implementation omission. |
| QXB `manualAreas["New-_-20Varrock"] = false` | The encoded key failed to block New Varrock. “Train Magic in New Varrock” was available. | Access normalizes encoded legacy keys at one boundary. New Varrock and that training task are blocked for Player 2; the override stays personal when ownership is shared. This was an import-boundary omission. |
| Both maps' `Rare Drop Amount = "5000"`; captured worker `rareDropNum = "1/5000"` | Eligibility used a default 1/1000 cutoff. | The engine derives the configured fraction and uses it for source filtering. Secondary-primary numerical settings are also derived. This was a saved-setting omission. |
| QXA saved `passiveSkill`, `maxSkill`, and assigned quest XP; QXB assigned XP | Account-input settings were retained in legacy data without affecting evaluation. | The engine consumes decoded passive levels, skill caps, Slayer limits, and valid-source assigned XP. Unassigned `None` choices do not invent a skill reward. These were saved-input omissions. |
| QXA manual rune hatchet/pickaxe; both maps' manually added equipment, including splitbark armour | Explicit items were absent, and Player 2's “Wear a piece of splitbark armour” became blocked when crafted-item source restrictions were applied. | Manual items and equipment become explicit sources, respecting item backlogs. The splitbark task is available. These were manual-source omissions. |
| QXA `manualPrimary.Woodcutting = false`; upstream primary-check code only forces availability when the value is true | A first correction mistakenly demoted ordinarily trainable Woodcutting. | False does not prohibit a normal primary method. Player 1 retains primary Woodcutting, with saved passive level 77 and reachable ceiling 110. This was a semantic correction during verification. |
| Disabled `Shortcut`, `Token`, `InsidePOH Primary`, and similar primary-method modifiers | Such modifiers blocked activities entirely. | Where upstream treats them as primary-method controls, activities can remain available without granting primary training. This separates activity eligibility from training eligibility. |
| Hard-mode giant mole occurs in `Mole lair`; its source gate names missing `Giant mole Lair` | The stale gate was silently bypassed, allowing hard-mode drop sources despite disabled Hard Mode Bosses. | Access diagnoses the dangling source location and fails closed for that source. An exhaustive source-gate location scan found this one missing location. This is a declarative reference-data inconsistency; no speculative alias was added. |
| Original QXA unlocked sections include `12337-2`, with `12337-1` absent | Named-area whole-base abbreviations and Rune Essence mine/Zanaris backlinks seeded the unentered Wizard Tower section. Tower resources incorrectly enabled Imp Catcher, Rune Mysteries, and several connected areas. | Area abbreviations resolve to declared section entrances. The reference's disconnected travel hubs expose resources without bridging other geographic sections. Initial authored access now has only `12337-2`, and the Rune Essence mine entrance is `12853-1`. This was a traversal omission. |
| Every command prepares imported gameplay state again | Deleting a migrated note or returning a section/area override to automatic reintroduced its old legacy value. | Conversion is recorded once per member and source map. Explicit false values and deletions survive commands, repeated preparation, and JSON restart. A version-1 upgrade converts only newly added fields. This was a persistence defect. |

The QXA false section overrides `12085-2` and `12342-2` remain inaccessible. Its explicit true entries seed their corresponding sections. Base ownership does not automatically expose every section, and selected or locked teleport destinations do not seed resource access.

Access verification includes 18 passing tests for separated sections, personal/shared isolation, gated entrances, named-area cycles, disconnected travel hubs, missing references, manual overrides, encoded area blocks, source backlogs, object yields, nested drops, source alternatives, and the real reference schema. The resolved `blockedAreas` mask distinguishes reachable entrance evidence from an explicit personal prohibition. Access and migration checks together passed 29 tests after adding that mask; the preceding access/migration/task checkpoint passed 51 tests.

## What can be compared to saved task targets

The maps retain selected `activeTasks`. They are useful identity checks, but are not a complete evaluated availability set and may contain persistent selections.

- QXA's Attack target “Wield a corrupt dragon weapon” and Defence target “Wear a piece of corrupt dragon armour” resolve by category and are available in the corrected engine.
- QXB's Medium/Hard Lumbridge achievement completion targets and Dragon Slayer completion target resolve and are available.
- QXB's saved Magic target “Blast and Hellfire” and Runecrafting target “Not Waving But Drowning” refer to underlying **Diary** records in the dataset. Upstream projects achievement tasks into skill lists. Their absence under the saved skill category is a presentation difference, not proof that the underlying Diary task is missing.
- Nine saved BiS targets across the maps are outside the declared challenge catalogue: Player 1's amulet of glory and corrupt dragon gear targets, plus Player 2's explorer's ring 4 and monk's robe targets. Equipment recommendations and generated BiS tasks require their own integration verification. These targets cannot be certified through the challenge eligibility count above.

The new offline reference supplies exact labels for one bounded QXA comparison. All four original selected ordinary tasks are eligible in the authored result: corrupt dragon weapon, corrupt dragon armour, infernal yew incense sticks, and the Falador crumbling wall. The original active Quest/Diary/Extra result is empty after saved progress and backlog filtering. At this checkpoint the authored special result still contains **seven extra rows**: two City of Um achievements, Altar of War furniture plans, Command Skeleton Warrior, a steel mattock, and the Breaking the Seal/Prison Break Archaeology mysteries. All seven exist in the original definitions but were ineligible in that captured original execution. The original-side missing count for this special-row comparison is zero. These remaining differences require cause classification; this is not full parity, and global eligibility totals are not final displayed next-task counts.

## Remaining boundaries and reproduction

Thirty-four declared records currently fail closed as unsupported. Examples include missing aliases for second-age magic armour, chaotic necromancy weapons and dye kits, plus special category prerequisites for bakami activities. Some also fail membership checks. The count does not establish that every free-to-play action or every source is supported.

This lane does not validate live personal account progress, real in-game travel, bespoke upstream BiS scoring, complete displayed task pruning, or the final browser workflow. Matching the captured data and preserving saved settings establishes a bounded input comparison; switching readiness also needs the representative application checks owned by the parent task.

The ignored reproduction script is [out/comparison/inspect.mjs](C:/Users/User/Projects/chunk-picker-rs3/out/comparison/inspect.mjs), run with `node out/comparison/inspect.mjs` from this repository. Its [summary.json](C:/Users/User/Projects/chunk-picker-rs3/out/comparison/summary.json) retains exact source hashes, migration counts, category totals, diagnostics, and examples. Full own/shared results and the pre-correction outputs remain under the same ignored directory.

This report's numerical checkpoint used the following hashes. The subsequent additive `blockedAreas` API regression is described above; the ignored comparison records identify any later engine checkpoint separately.

- Access SHA-256: `da0852b81be72ab6c54efadcd19dbc0528d5a7acd3a1aabe27e61542ce85f1cc`.
- Engine SHA-256: `41c40182999179207740af0a9f772219ea3497a3d03e0e2ae2d22d4c5c4d78ff`.
- Migration SHA-256: `b98a4516f8d21ebfce23e22a8717372fd7c3770545af9a338af20cd5f2ff5b92`.
