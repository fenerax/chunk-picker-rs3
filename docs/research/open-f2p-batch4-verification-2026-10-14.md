# Independent F2P batch 4: verification, 14 October 2026

`open-f2p` 0.4.0 has 52 cells, 120 gathering source groups, 47 walking connections and 227 activities. It adds 53 quests (45 regular and eight seasonal) and 15 area achievements. Every batch 1–3 cell, source, task, connection and service row is preserved exactly.

## Sources and gates

The pinned Wiki free-quest navigation fixes the roster. Historical quests and miniquests are excluded. Main quest pages and quick guides establish skills, items, starts and required stops. `Module:Questreq/data`, with its rendering implementation, establishes implicit quest prerequisites. The generator reads the Lua string lists without executing Lua. Every generated quest, achievement, location and task has revision provenance under the existing Wiki-derived CC BY-NC-SA 3.0 scope. No artwork is added.

Generic authored engine fields `ManualChecks` and `CompletedTasks` retain unsupported and unresolved gates. The latter requires all named tasks to have personal completion evidence; reachable quests, partner completion and challenge checkmarks do not qualify. Unsupported references fail closed, including transitively. Genuine manually recorded completion uses the existing command, History and Undo path.

Start coordinates and precise reviewed map markers supply existing cells. Required cells are conjunctive; optional supplier stops do not become mandatory cells. Locations outside the 52-cell review, interiors, floors and instances retain explicit manual checks. An unreviewed start is shown with the catalogue in an existing cell and remains blocked; its original coordinate and source region remain evidence rather than a new playable cell. No walking connection is added.

Inventory, quantities, tool-belt alternatives, combat ability, partial quest stages and seasonal availability remain manual. Skills without reviewed primary training stay blocked. Recommended levels are kept separate from mandatory gates. Only quest points are modelled as quest rewards; no item, XP or equipment reward supplies are introduced.

## Achievement slice

The first slice contains nine Lumbridge, three Varrock and three Falador achievements. Every selected page explicitly marks free membership. Tools and recipe inputs also cite the existing pinned rock, fishing and supply pages where needed.

| Selected Wiki page | Mandatory skills above level 1 | Existing mapped cells |
| --- | --- | --- |
| [Belter of a Smelter](https://runescape.wiki/w/Belter_of_a_Smelter?oldid=36635563) | Smithing 20 | Manual location check |
| [Clay More](https://runescape.wiki/w/Clay_More?oldid=36637117) | None stated | 12595 |
| [Dog and Bone](https://runescape.wiki/w/Dog_and_Bone?oldid=36635089) | None stated | Manual location check |
| [Fill Yer Bucket](https://runescape.wiki/w/Fill_Yer_Bucket?oldid=36694369) | None stated | 11828 |
| [Hotpot](https://runescape.wiki/w/Hotpot?oldid=36925445) | None stated | Manual location check |
| [Iron On](https://runescape.wiki/w/Iron_On?oldid=36635567) | Mining 10 | 12593 |
| [Just Add Water](https://runescape.wiki/w/Just_Add_Water?oldid=36818606) | None stated | Manual location check |
| [Mudskip the Light Fantastic](https://runescape.wiki/w/Mudskip_the_Light_Fantastic?oldid=37045049) | None stated | Manual location check |
| [Pot Stop](https://runescape.wiki/w/Pot_Stop?oldid=37002465) | Crafting 8 | Manual location check |
| [Ratatouille](https://runescape.wiki/w/Ratatouille?oldid=37057112) | None stated | Manual location check |
| [Read All About It](https://runescape.wiki/w/Read_All_About_It?oldid=36635105) | None stated | Manual location check |
| [Shrimpin' Ain't Easy](https://runescape.wiki/w/Shrimpin'_Ain't_Easy?oldid=36634856) | None stated | 12849 |
| [Take Your Pick](https://runescape.wiki/w/Take_Your_Pick?oldid=36635225) | None stated | 12849 |
| [You Doity Rat](https://runescape.wiki/w/You_Doity_Rat?oldid=36637125) | None stated | Manual location check |
| [Chain Store](https://runescape.wiki/w/Chain_Store?oldid=36692092) | Defence 25 | Manual location check |

| Reviewed exclusion | Reason |
| --- | --- |
| [Jackanory](https://runescape.wiki/w/Jackanory?oldid=36907982) | Explicitly members-only. |
| [Tinkle the Ivories](https://runescape.wiki/w/Tinkle_the_Ivories?oldid=36757997) | The individual page omits an explicit members field, so F2P eligibility is not established. |
| [Going Along With the 'Fro](https://runescape.wiki/w/Going_Along_With_the_'Fro?oldid=36696055) | Its required Party Room interior has no reviewed existing dataset cell assignment; omit rather than invent an interior placement. |
| [What Is This Place?](https://runescape.wiki/w/What_Is_This_Place%3F?oldid=36634863) | Requires a floor inside Wizards' Tower, while the dataset only has the outside tower cell and no reviewed interior placement. |
| [Slippery When Wet](https://runescape.wiki/w/Slippery_When_Wet?oldid=36635564) | The required Water Altar is an interior location and has no reviewed existing cell placement; omit rather than add a cell or imply unreviewed interior access. |

## Rebuild evidence

The supplied batch-3 cache was copied into this worktree without changing the saved copy. Its 126-pin fetch made zero requests and reproduced 0.3.0 byte for byte, SHA256 `103db893fd5a190d6892419c26e0a62085eebaf55c6f0f473e4c34042e420c3e`. The retained 0.3.0 payload is verification evidence and cannot be read by the generator.

The final build uses 266 pinned cache files; 246 distinct Wiki pages support content or reviewed exclusions. A separate empty cache refetched all 266 revisions in reverse request order with the existing serial, at-most-20-page API batches, User-Agent, maxlag, timeout and one-second gaps. All canonical receipts matched. After final review, both caches rebuilt the committed bytes with zero further requests. Logs: `.local/batch4-initial-pinned-refetch.txt`, `.local/batch4-pinned-refetch.txt` and `.local/batch4-pinned-refetch.json`.

Payload SHA256: `52eb2d1949d5dde50bd03b32ceae35fda641382bb2834fe59c2fe97d692e5a2f`.
Provider digest: `cd8567ad0b04bc9eb8c68befa648d56089cd5663abbaf46d0386c8d3beea043d`.

The [0.4.0 input cache manifest](open-f2p-cache-inputs-0.4.0.txt) names every required file, requested/resolved title, revision and receipt. Retain one complete copy from `.local/wiki-open-f2p/` or `.local/batch4-pinned-refetch/`.

## Checks

Focused: 38 passed, no failures or skips. Includes byte-for-byte batch-3 row preservation, source provenance, stable unique identities, resolved quest requirements, actual skill/QP gates, unsupported-reference rejection, manual completion and Undo, reproducible receipts, guarded offline rebuild and forbidden-input probes. Log: `.local/batch4-focused-tests.txt`.

Quick suite: 1,398 passed, no failures, cancellations or skips. Log: `.local/batch4-quick-tests.txt`.

One final successful light-locked browser/server session captured the map and quest list at 1440 × 900 and 390 × 844. It made 454 local requests, exercised nine lazy surfaces and Advanced coverage, and verified viewer command/restore/invite writes return 403. No overflow, unexpected HTTP errors, browser errors or outside requests occurred. Browser, server and disposable copy were removed. Screens and the report remain under `.local/screens/open-f2p/`.

The first capture placed phone quest names below the viewport. A corrected run saved visible rows but logged Chrome `ERR_NO_BUFFER_SPACE` during auxiliary checks. The final whole session passed after the quick suite finished; earlier reports remain as `.local/batch4-initial-screen-report.json` and `.local/batch4-buffer-error-screen-report.json`.

The final heavy-locked isolation check passed for the delivered digest. It made 319 authenticated requests with private paths physically absent and zero forbidden reads. Cook's Assistant was manually recorded, reloaded, undone and recorded again. The server, workers and disposable execution copy were removed. Reports: `.local/batch4-isolation.json` and `.local/batch4-isolation.txt`.

The heavy-locked private parity comparison passed with zero differences. Default and packed profiles used fresh disposable copies of one captured save, preserved read-only gameplay bytes and passed Undo. Copies and servers were removed. Log: `.local/batch4-private-parity.txt`.

The single final heavy-locked `npm test` run executed 4,132 tests in 410 files: **4,125 passed, six failed, one skipped**, with no cancellations. The skip is the optional generated skill-icon asset check. All six failures were stale complete-output prediction fingerprints after the two generic requirement names joined `coverage.supportedFields`. No files were edited during the run; `.local/batch4-full-source-audit.json` verifies all 19 changed source files against their before-run hashes. Full log: `.local/batch4-full-suite.txt`.

After that run, a strict audit removed only `ManualChecks` and `CompletedTasks` from the baseline and prediction-result supported-field arrays. This restored all six previous complete JSON hashes exactly, proving the 24 added metadata entries were the sole change in those fixtures. Only the six expected hashes and their audit comment were refreshed in `tests/prediction-output.test.mjs`; production code did not change. The affected prediction file plus all F2P and generic gate tests then passed **48/48**, with no failures or skips. No second full suite was run, respecting the one-run limit. Evidence: `.local/prediction-batch4-audit.json` and `.local/batch4-post-full-targeted.txt`.

Final cleanup found no job-owned server, calculator or browser process and no disposable isolation/parity save directories. Caches, logs and screens remain in this worktree.

## Private comparison and boundary

The updated [private diagnostic](open-f2p-private-comparison-2026-10-13.md) still matches all 52 cells and 85 ore/tree groups. Eight dead-tree classification differences and three cache-only review leads remain. These catalogues contain no equivalent quest/achievement rows, so those task families are reported as independently sourced totals only. No private comparison row feeds generation.

No private dataset input, original save, resource asset, shared UI, authentication, CSP, viewer or overlay behavior changed. Root licence/notice files, changelog/roadmap data and public-export ownership paths were left alone. Existing saves remain bound to their version and digest; use fresh 0.4.0 storage. Nothing is pushed, published or exported.
