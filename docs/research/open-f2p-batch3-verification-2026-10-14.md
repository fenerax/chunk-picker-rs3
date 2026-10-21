# Independent F2P batch 3: verification, 14 October 2026

`open-f2p` 0.3.0 contains 52 cells, 120 gathering source groups, 159 activities
and 47 reciprocal walking connections. Walking from Lumbridge reaches 40 of the
original 47 cells and 44 of the current 52. Batch 2 reached 24 original cells.
The 13 shops, 126 positive stock rows, 11 banks, six deposit-box groups and
conditional paid ferry retain their batch-2 records.

## Gathering additions

The 28 new source groups generate 28 gathering activities. Two new purchase
activities cover the lobster pot and harpoon already stocked by Gerrant's
Fishy Business. No shop stock or supply semantics change.

| Source | New cell groups | Level | Reviewed placement |
| --- | ---: | ---: | --- |
| Dead tree, normal logs | 8 | 1 | Exact free surface rows, including Lumbridge at 3248, 3233 |
| Maple | 1 | 40 | Three trees north of Gower farm |
| Yew | 9 | 70 | Free surface rows around the reviewed mainland towns |
| Acadia | 1 | 50 | Three free placements west of Het's Oasis |
| Mining | 6 | 1–20 | Gunnarsgrunn coal, Gunnarsgrunn south clay, Draynor clay, Falador west coal/silver and Silvarea limestone |
| Cage/harpoon fishing | 3 | 35, 40, 50 | Musa Point tuna, lobster and swordfish |

The [Dead tree revision](https://runescape.wiki/w/Dead_tree?oldid=37151953)
identifies choppable variants, normal logs, level 1 and a hatchet. This supplies
a starting Woodcutting method in Lumbridge without an invented completion.
The generic Tree and Evergreen articles have no exact reviewed placements;
no living ordinary tree coordinate is inferred from a town or tutor position.

The [Maple Tree revision](https://runescape.wiki/w/Maple_Tree?oldid=37135152)
supports the free Gower farm placements. Its resource-dungeon trees require
30 Dungeoneering and remain excluded. The
[Yew revision](https://runescape.wiki/w/Yew?oldid=37195444) supplies level 70 and
the free placements. Only the explicit free row west of Het's Oasis from the
[Acadia revision](https://runescape.wiki/w/Acadia_tree?oldid=37166118) is used;
members and quest-gated Menaphos placements are excluded.

All five added mine pages explicitly mark free membership and have blank
entry requirements. Resource rows must also have surface coordinates and no
gate. Dwarven Mine rock rows use underground map 18, not surface map 28; they
remain excluded. Its public surface approach is covered by the reviewed
Ice Mountain routes, without dungeon or Mining Guild access. Karamja
north-west mine is explicitly members-only and is omitted.

The [cage/harpoon revision](https://runescape.wiki/w/Fishing_spot_(cage,_harpoon)?oldid=37196214)
supplies tuna 35 with a harpoon, lobster 40 with a lobster pot and swordfish 50
with a harpoon. Only its ungated free Musa Point coordinates fall within this
batch's crop. Other free rows outside the crop or behind quests remain out.
Al Kharid net/bait and Barbarian Village lure/bait fishing were already present
and keep their IDs and coordinates.

## Walking review and remaining cells

Twenty-four added connections review the Lumbridge swamp and farms, Al Kharid,
Taverley, Burthorpe, western Falador, Ice Mountain, northern/eastern Varrock,
the Archaeology Campus and Silvarea quarry. Exact free surface anchors and
named route or public-gate prose support every join. Geometry alone creates
none. These remain place-level approaches, not collision masks or a claim
that every tile or facility in a cell is accessible.

The south-west swamp route uses the mine page's stated run south-west. The
Enlightened amulet page locates that route's starting point at 3216, 3180,
within the already reachable eastern swamp cell. Its members-only teleport
is neither supplied nor required. Only the subsequent walking approach is
admitted. The Al Kharid route follows the bridge and opening in the rocks;
it does not use a toll gate, the conflicting members-marked jetty article or
the oasis Agility course. Silvarea's road grants no Paterdomus or Morytania entry.

Seven original cells remain manual. The batch-2 Taverley bank is the eighth
manual cell. All four newly added cells, 11830, 12086, 13106 and 13366, have
reviewed walking approaches.

| Manual cell | Reason |
| --- | --- |
| 11569, Musa Point fishing | Sea separates the island. The conditional ferry runs from 12082 to 11825; the arrival region also contains disconnected mainland. Joining the island fishing cell to that region would admit Karamja through the mainland graph. |
| 11827, Crafting Guild surroundings | The proposed guild approach has unresolved fence access. The article describes the eastern cow enclosure as reached through an upper-floor door. Free surface placements do not resolve the fence side. No alternate approach to this cell's Falador yew has been reviewed. |
| 11831, north of Goblin Village | Its oak at 2979, 3528 is beyond the Wilderness wall. Crossing requires a click and warning. |
| 12087, north of Edgeville | The oaks at 3044, 3532 and 3049, 3525 are beyond the same warning crossing. |
| 12343, north of Edgeville | The oaks at 3081, 3527; 3115, 3526; and 3101, 3535 are beyond the wall. |
| 12855, north of Varrock | The oaks at 3209, 3526 and 3217, 3527 are beyond the wall. The southern placements belong to reachable cell 12854. |
| 13111, north of Varrock | Its oak at 3266, 3527 is beyond the wall. |
| 11317, Taverley bank | The bank at 2876, 3417 is free and mapped, immediately outside the gathering/walking crop. A specific town-to-shore walking approach has not been reviewed. |

The authored selection records the exact exclusion evidence and every manual
cell's reason. Tests compare the graph's actual reachability with that list
and check the exclusion needles against the pinned cache. Wilderness warnings
remain explicit boundaries rather than automatic reciprocal links.

## Provenance, rebuild and input manifest

All factual gameplay rows retain RuneScape Wiki titles, revision IDs and oldid
URLs under the existing CC BY-NC-SA 3.0 folder scope. The build reads 126 pinned
cache files; 113 distinct Wiki pages support playable rows. Review-only pins
also preserve the exclusions and the coordinate/licence context. No image is used.

The saved batch-2 cache was copied into this worktree before task work and was
not edited. Before additions, the 93-pin fetch made zero requests and the
0.2.0 build reproduced the committed bytes, SHA256
`3f4977e961a7a22f4709e756767fe8643230f458941c466ccc94db0e957a1477`.
Evidence: `.local/batch3-baseline-verification.json` and
`.local/batch2-original.json`.

The final complete-cache fetch made zero requests. A separate empty cache then
refetched all 126 old revisions in reverse request order. All canonical receipts
matched and that cache rebuilt the committed payload byte for byte. Retrieval
retains the existing User-Agent, serial batches of at most 20, `maxlag=5`,
one-second gaps and 45-second request timeouts. Only the Wiki API was used.
Reports: `.local/batch3-initial-pinned-refetch.txt`,
`.local/batch3-pinned-refetch.json` and `.local/batch3-pinned-refetch.txt`.
The first log records the 126-page empty-cache retrieval; final wording changes
reuse that cache and reproduce the final bytes with zero further requests.

Payload SHA256:
`103db893fd5a190d6892419c26e0a62085eebaf55c6f0f473e4c34042e420c3e`.
Provider digest:
`91cabb9495d97243ecfe9b9178e856f92da8b1a8f778a7d92e4074bd367b38bf`.

The [complete input cache manifest](open-f2p-cache-inputs-0.3.0.txt) lists every
one of the 126 required filenames, requested/resolved titles, revisions and
canonical receipt hashes. Save all listed files from this worktree's
`.local/wiki-open-f2p/`. The independent pinned-refetch folder is an equivalent
copy; only one complete copy is necessary.

The offline build's audited reads remain limited to the authored selection and
its pins. Generation cannot read either historical baseline, diagnostic inputs,
private files, discovery directories or the network. All batch 1–2 IDs and
meanings are preserved; cell provenance may grow. The new 0.2.0 baseline is
verification evidence and is never a generation input.

## Verification

The final focused run passes 24 tests without failures or skips. It covers
baseline preservation, unique IDs, provenance, references, natural level-1
Woodcutting access, independent pot/harpoon/tool/bait gates, ungated mines,
walking reachability, manual exclusions, canonical receipts, deterministic
rebuild and the forbidden-input scan. The guarded build records only allowed
inputs and rejects 33 explicit forbidden read/discovery probes.
Log: `.local/batch3-focused-tests.txt`.

The quick suite passes 1,383 tests in 142 files with zero failures, cancellations or skips.
Log: `.local/batch3-quick-tests.txt`.

One completed light-locked browser/server session captured 1440 × 900 and
390 × 844. It exercised nine lazy surfaces, Advanced coverage and actual viewer
controls. All 450 requests stayed local, with no unexpected HTTP errors or
browser exceptions and no horizontal page overflow. Viewer command, restore
and invitation writes returned 403. The server, browser and disposable execution
copy were removed. Screens remain local:

- `.local/screens/open-f2p/open-f2p-desktop-1440.png`
- `.local/screens/open-f2p/open-f2p-phone-390.png`
- `.local/screens/open-f2p/report.json`

The repository screen harness was used through a local copy that only changes
its imports and output destinations. It preserves the tracked historical PNGs
in `docs/research` and makes no shared UI or browser-harness source change.

The heavy-locked isolation check passed for 0.3.0 with private paths physically
absent. It made 315 authenticated HTTP requests covering a new game, neighbour
roll, generated activity completion, reload, Undo, notes, journal goals, backup
restoration, sharing and viewer write refusal. Server and worker guards recorded
zero forbidden reads or module failures. The server and disposable execution
copy were removed. Report: `.local/batch3-isolation.json`.

The final heavy-locked private parity run passed with zero differences. Both
default and packed profiles preserved the read-only gameplay bytes and passed
Undo. Each used a fresh disposable copy of the same captured save, with the
existing observation-based clock and all strict comparisons retained. Copies,
pack and servers were removed. Log: `.local/batch3-private-parity.txt`.

The first local runner stopped on a normal Node stderr progress message because
of Windows PowerShell's native-command error handling. It was corrected locally;
no application or tracked verification script changed. A subsequent parity run
lost the packed profile's `/api/tasks` response body with `UND_ERR_SOCKET` and
produced no comparison result. The entire comparison was restarted on another
fresh copy and passed. No individual task request was retried, no cache flags
were ignored and no checks were relaxed. Diagnostics remain in
`.local/batch3-final-checks-initial-runner-error.txt` and
`.local/batch3-private-parity-socket-failure.txt`. Neither attempt ran the full suite.

The single final heavy-locked full suite passed **4,117 tests in 409 files**,
with zero failures or cancellations. One optional generated skill-icon PNG
check was skipped because `SKILL_ICON_ASSET_ROOT` was unset, for 4,118 tests
total. No files were edited during that run. Log: `.local/batch3-full-suite.txt`.

Final cleanup found no job-owned picker server, calculator or browser process
and no disposable parity or independent-game directories. The Codex agent host
is excluded from the process check. Input caches, reports and screenshots remain
in the worktree for Claude to retain.

## Private comparison and boundaries

The updated [private diagnostic comparison](open-f2p-private-comparison-2026-10-13.md)
matches all 52 selected cells and 85 ore/tree class groups. Eight Wiki-only
groups are the dead-tree classification gap: the private catalogue calls them
`tree:unknown:dead-tree`, which is not promoted into a verified log-source class.
Three cache-only groups remain review leads. No diagnostic row supplies a
gameplay fact or correction. Fishing products and service families have no
equivalent records in these two permitted catalogues.

No private dataset input, save, resource asset, shared UI, server, authentication,
CSP, viewer or overlay behavior changed. Root licence/notice files, publication
scripts and the parallel public-export job's paths were left alone. Everything
remains local on `codex/f2pbatch3`; nothing is pushed, published or exported.
Existing saves remain bound to their original version and digest. Use fresh
storage for 0.3.0.
