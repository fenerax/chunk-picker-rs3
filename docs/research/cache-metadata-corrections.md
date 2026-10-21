# Cache-backed metadata corrections — 2026-10-08

The picker now applies **732 reviewed field corrections to 728 authored task rows**. Each correction records its exact old value, cache artifact/record/field and current RuneScape Wiki revision permalink. The retained export is preserved; the overlay changes only matching labels and reviewed old values. Custom datasets with different metadata remain untouched. Task IDs, text, steps, item requirements, dependencies, authored resources and personal progress are preserved.

This work was made in `codex/metafix`, starting at `cccf866`. The main checkout's game-data exports were read-only sources. The live picker, private duo save, resource catalogue, chunk info and `app/data/world.mjs` were outside this change.

## Lodestones

All **29 current Wiki scenery pages** were checked, including all 28 retained surface destinations. Each Wiki coordinate was converted with `r = (x >> 6) * 256 + (y >> 6)`. Surface agreement improves from **27/28 to 28/28**. The [versioned lodestone review](cache-lodestone-corrections.2026-10-08.v1.json) lists every coordinate, cache variant, plane, projection and permalink.

Anachronia's [Wiki revision 37122513](https://runescape.wiki/w/Special:PermanentLink/37122513) gives scenery `(3894,4258)`, hence `60 * 256 + 66 = 15426`. Cache structs **24324 and 33446**, coordinate param **2941**, give source `(5431,2339,0)` and exact map-28 projection `(3895,4259,0)`, also region **15426**. The surface lodestone destination and Diary activation task both move from `15683-1` to bare `15426`. Dynamic cache entry evidence moves with that destination, and the obsolete entry no longer certifies region 15683. No section suffix or walking component is inferred: Anachronia's exact landing remains unresolved in the existing component resolver. This is a location correction, not an access grant.

The remaining 27 surface regions agree with Wiki scenery anchors. **26** surface destinations have corroborating cache plane-0 projections after the correction. Ashdale's cache coordinates encode **plane 2** and Prifddinas's encode **plane 1**; neither has a map-28 plane-0 projection. Their Wiki base regions corroborate the existing locations, while their cache plane uncertainty remains explicit. Their authored section handling and personal activation gates are preserved.

City of Um is the additional underground destination. Cache/Wiki `(1083,1768,1)` agree exactly, but cache membership candidates **0 and 1** conflict. It remains outside the surface travel table. No surface route, activation, membership resolution or access is invented. Al Kharid's quest-only members scenery variant is recorded separately from its ordinary free lodestone.

## Correction counts

Counts below are fields, so a row with both membership and RuneScore changes appears in both classes.

| Class | Fields | Examples |
| --- | ---: | --- |
| Quest membership | 35 | Beneath Scabaras' Sands: 14 members gates; Princess and the Pauper: 9; Gertrude's Cat: 2 free restorations; Benedict's World Tour: 10 free start/item rows |
| Quest association | 1 | Kili's Knowledge: `BaseQuest` Kindred Spirits → Kili's Knowledge |
| Achievement RuneScore | 173 | Ghost Hunter 15→5; Undead to Rites 25→10; Owl Be Seeing You 25→15 |
| Achievement membership | 517 | 505 missing members gates; 12 explicit free restorations, including Layering Up and Mask of Dragith Nurn |
| Lodestone task location | 1 | Anachronia activation: `Chunks` `["15683-1"]` → `["15426"]` |
| Plain numeric quest requirements | 5 | Listed separately below |
| Quest reward points | 0 | No independently agreed reward-point error; Kili remains 0 QP |
| Quest difficulty/length | 0 | Neither is stored anywhere in the retained export |

The quest review swept all **3,515 Quest rows**, including **428 completion-marker rows**, **685 plain numeric skill fields** and all **8 numeric QP requirements**. There are 3,011 unique quest-list matches. Difficulty and length were searched recursively through the complete export; no fields were added.

The achievement review swept all **2,650 Diary rows**, with **2,446 unique cache matches**. It queried **753 current Wiki titles**, verifying the matching achievement ID and tier before applying metadata. Of the original **162 RuneScore disagreements**, **161** are corrected. Another **12** scores were absent and now receive verified values, giving 173 score corrections. Scores are metadata; they do not bypass requirements. Membership changes can block or enable tasks under the existing F2P rule and can affect downstream sources and dependencies.

Kili's authored completion aggregates its Knowledge achievements, not Kindred Spirits. Cache achievements **3347–3356** have distinct Knowledge identities/states and reference **Kili Row (500)** in their miniquest prerequisite field; their associated-quest-reference arrays are empty. These fields remain distinct. [Kili's Knowledge revision 37080308](https://runescape.wiki/w/Special:PermanentLink/37080308) corroborates the group. The correction changes only `BaseQuest`; its **0 QP**, steps and dependencies remain intact. The existing RuneMetrics mapper excludes this lore completion row; no new quest alias or prerequisite is introduced.

### Plain numeric requirements

These are the only authored requirements changed, each on its exact start row and supported by an explicit cache requirement plus current Wiki revision.

| Task | Field | Before → after | Wiki revision |
| --- | --- | --- | --- |
| A Clockwork Syringe | Thieving | 62 → 74 | [37199963](https://runescape.wiki/w/Special:PermanentLink/37199963) |
| Devious Minds | Smithing | 50 → 65 | [37186856](https://runescape.wiki/w/Special:PermanentLink/37186856) |
| Doric's Task II | Smithing | 10 → 20 | [37152749](https://runescape.wiki/w/Special:PermanentLink/37152749) |
| Hunt for Red Raktuber | Thieving | 45 → 38 | [37167799](https://runescape.wiki/w/Special:PermanentLink/37167799) |
| Tears of Guthix | Quest points needed | 43 → 44 | [37182729](https://runescape.wiki/w/Special:PermanentLink/37182729) |

Recipe for Disaster's Skrach step keeps **30 Cooking**: it cooks a chompy, whereas the global 41 requirement applies to a later jubbly operation. Benedict's seven members-only item branches and full completion keep their members gates; a globally free quest flag does not make every location free. Princess step 1 already has the recognized `NotF2P` alias, which is preserved.

## Evidence and remaining review

The [quest review](cache-quest-metadata-corrections.2026-10-08.v1.json) and [achievement review](cache-achievement-metadata-corrections.2026-10-08.v1.json) bind the work to the retained export hash, cache manifests/artifact hashes, pinned decoder and schema provenance. Schema build 950 remains inferred compatibility. Tavily supplied discovery; current public Wiki API revisions supplied the facts. Compact correction entries retain field facts and permanent revision links, rather than whole articles.

Unchanged review records include **74 achievement membership conflicts**, **188 unmatched achievement rows**, **16 ambiguous achievement rows**, and **Gotta Catch 'Em Both!**: its authored score is 10 and Wiki is 0, but cache score is null, so the two-source rule is not met. Quest review records retain the mixed Benedict branches, Princess alias, RFD operation difference and **80 skill values lacking comparable cache evidence**. Anachronia component landing, Ashdale/Prifddinas plane projection and City of Um travel policy remain open.

The runtime [correction bundle](../../app/data/metadata-corrections.2026-10-08.v1.json) contains every applied field and SHA-256 references to the three reviews. Regenerate it offline after an intentional evidence update:

```powershell
node scripts/research/build-metadata-corrections.mjs
```

## Read-only task-impact preview

Claude can run this on a **private copy** of the real save. Copy `state.json` together with its sibling `static/` directory when the save uses sidecars.

```powershell
node scripts/preview-metadata-corrections.mjs --state C:/private-copy/state.json
node scripts/preview-metadata-corrections.mjs --state C:/private-copy/state.json --json
```

The command hydrates raw state, portable backup envelopes and compact sidecar envelopes without opening a store or server. It verifies sidecar IDs, decompressed SHA-256 values, allowed fields and directory containment, rejecting missing or altered dependencies. It never writes state, locks, backups or outputs.

For **each member**, it evaluates all tasks against identical personal facts before and after the metadata overlay and lodestone correction. It lists changed metadata plus changed availability, blockers, visibility, obligation, sources and explanations, including downstream tasks with no direct correction. Zero-change members are included. Completed facts stay unchanged. Both machine-readable JSON and readable output are available. Optional `--definitions` and `--corrections` support isolated fixtures.

No real save was read or previewed in this work. Fixture tests cover two members, metadata-only changes, downstream item/quest-point gates, relocated obligations, travel-table changes, raw/backup/sidecar hydration, corrupted dependencies and a read-only CLI run.

A default CLI run with the complete retained catalogue and a synthetic two-member state also succeeded: **20,375 tasks checked per member**, all **728 directly corrected rows** reported for each, and **553/554 availability changes** in that fixture. These counts describe synthetic geography, not either player's save.

## Changed files and verification

- Runtime: `app/data/lodestones.mjs`, `cache-topology.mjs`, `metadata-corrections.mjs`, versioned metadata JSON, `app/tasks/access.mjs`, `engine.mjs`, and `app/integrations/runemetrics.mjs`.
- Preview/research: `scripts/preview-metadata-corrections.mjs` and three helpers under `scripts/research/`.
- Evidence/docs: this report, three versioned correction reviews and `docs/access-logic.md`.
- Tests: metadata overlay, lodestones, preview, quest evidence, achievement evidence; existing object-writer tests now use isolated scratch paths and clean up after themselves. `.gitattributes` keeps hashed evidence bytes stable on Windows.

The **27 focused correction tests passed**, followed by the full **`npm test`: 1,036/1,036 passed**, with no failures or skips (85.7 seconds). The full run's log is `.local/metafix-tests/npm-test.log`. All full-suite scratch directories were routed inside this worktree; test servers used isolated state and ephemeral ports. A research helper initially wrote its Wiki scratch responses to system temp; its default was corrected to this worktree, and its 31 verified response files and exact scratch directory were removed.
