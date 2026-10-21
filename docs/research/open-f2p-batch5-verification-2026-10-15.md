# Independent F2P batch 5: verification, 15 October 2026

`open-f2p` 0.5.0 adds seven equipment variants, seven monster cell groups,
24 drop rows, four facilities, nine recipes and 37 acquisition records. Its
44 new tasks bring the total to 271. Every batch 1–4 cell, gathering source,
task, connection, shop, stock, service, route, quest, achievement and reviewed
achievement exclusion is preserved exactly. The 52 cells and 47 walking
connections are unchanged.

## Equipment and acquisition review

| Exact item | Reviewed acquisition | Wield or use evidence |
| --- | --- | --- |
| Bronze hatchet | Bob's free stock; Lumbridge smithing | Attack 1 to wield; Woodcutting 1 to use |
| Bronze pickaxe | Bob's free stock; Lumbridge smithing | Mining 1 in the bonuses and pickaxe infoboxes |
| Bronze dagger | Level-11 Varrock goblins, free-world replacement at 4/256; Lumbridge smithing | Attack 1 |
| Bronze sword | Lumbridge smithing | Attack 1 |
| Bronze full helm | Lumbridge smithing | Bonuses infobox says None; prose says Defence 1, the default starting level |
| Leather body | Reviewed cowhide → Ellis → leather → sewing | Bonuses infobox says None |
| Leather boots | Reviewed cowhide → Ellis → leather → sewing | Bonuses infobox says None |

Item IDs come from each exact Wiki item infobox. A single explicit free item
variant is required. Mixed or ambiguous item infoboxes fail closed. Gilded,
upgraded, off-hand and members variants are not substituted for these items.
Wield and tool-use requirements are recorded separately. Task identities are
new `rs3:open-f2p:` identities and remain separate from the private profile.

The smithing chain requires a reviewed gathering source for both copper and
tin, a Lumbridge furnace for bronze bars, and a hammer, anvil and forge for
equipment. One bar makes a bronze hatchet; two make each other selected bronze
item. Leather requires a cowhide source and Ellis in Al Kharid. His page
explicitly resolves the dialogue's price discrepancy: soft leather tanning
actually costs nothing. Leather body and boots each require one leather, a
needle and thread. The thread page establishes the sewing supply omitted from
the individual recipe infoboxes. These are source checks; the stated material
quantities and consumption must be checked in game.

Positive shop stock, admitted drops and reachable recipe outputs satisfy
ordinary item requirements through the existing engine. Gathering activities
now expose their reviewed outputs as recipe supplies. Removing a required
tool, material, facility or tanner removes the corresponding recipe source.
A shop acquisition requires its particular shop; a drop acquisition requires
its exact monster variant and cell. Wield goals accept any reviewed source
for the exact item, without requiring its first listed acquisition cell.

## Monsters and drops

| Reviewed monster | Cell groups | Drop rows | Selected items |
| --- | ---: | ---: | --- |
| Ordinary chickens at Fred's farm | 1 | 4 | Bones, raw chicken, feathers in separate quantities 5 and 15 |
| Standard cows at Astram Farm | 1 | 3 | Bones, cowhide, raw beef |
| Regular level-4 giant rats in Lumbridge Swamp | 3 | 3 | Bones |
| Level-11 Varrock goblins, table 1 | 2 | 14 | Bones, five distinct coin rows, bronze dagger |

Explicit free location rows are joined to reviewed NPC variants and existing
cells only. The Wiki location-template implementation pins establish omitted
map and floor defaults as surface map 28 and plane 0. Those Lua modules are
read as evidence strings, never executed.

Every drop names its item, exact quantity and raw Wiki rate. `Always`,
`64/128`, `32/128`, `4/256` and the other stated fractions retain their original
strings; the existing rate evaluator derives probabilities and applies its
cutoffs. Separate quantity rows keep separate IDs and display labels. No
rarity label is converted into invented numerical precision.

Monster access describes a potential repeatable source. Existing engine
semantics can establish combat training potential from a reviewed monster;
they do not prove successful kills, actual levels, kill time or XP rates.
Drop tasks retain a manual combat-ability check. Wield/wear tasks retain an
in-game equipment check. Completion, reload and Undo still use the existing
revision-checked command system.

## Omissions and limits

- Seven starter equipment variants are reviewed. Higher tiers, most weapons
  and armour, other tools, upgrades, spawns, reward equipment and new shops
  remain unreviewed. Equipment and BiS screens remain disabled; no ranking
  policy or shared UI is added.
- Portable leather sewing is conservatively presented in the reviewed
  Al Kharid cell. This does not claim sewing needs a fixed in-game station.
- Other monster families and locations remain unreviewed. The Lumbridge cow
  placement IDs differ from the selected standard infobox IDs, so the cowhide
  chain uses the reviewed Astram Farm variants.
- Other drops on these pages, including runes and unreviewed equipment, have
  no individual item-variant review in this slice and are omitted.
- Goblin table 2 is not joined to mixed-level Port Sarim rows or missing
  Lumbridge placements. Table 1 is explicitly linked to the selected level-11
  variants. The members-only bronze spear is excluded; only its explicitly
  marked free-world dagger replacement is admitted.
- Astram Farm coin drops require the Burthorpe path and are excluded. Quest,
  event, equipment-conditioned, members-only, transcluded and uncertain drops
  are excluded. Giant-rat meat has an exception note and remains omitted.
  Unreviewed unknown-rate drops do not enter automatic supplies.
- Coins from reviewed goblins provide a possible fare source. Neither the
  30-coin carried fare nor any other inventory quantity is counted. The boat
  remains manual and grants no automatic travel connection.
- Quest rewards, personal account sync, additional training methods, dungeons,
  gates and travel remain under the earlier batch boundaries.

The generated `equipmentReview` rows retain four reviewed exclusion reasons
with pinned provenance. This is partial coverage, not a whole-F2P catalogue.

## Rebuild and receipts

The supplied batch-4 cache was copied into this worktree. The saved copy was
not edited. Before implementation, all 266 pins were cache hits and rebuilt
the committed 0.4.0 JSON byte for byte, SHA256
`52eb2d1949d5dde50bd03b32ceae35fda641382bb2834fe59c2fe97d692e5a2f`.
Evidence: `.local/batch5-baseline-rebuild.json`. The retained 0.4.0 payload is
verification evidence and cannot be read by the generator.

The final build reads 296 pinned inputs; 274 distinct Wiki pages support
content or reviewed exclusions. A separate empty cache refetched all 296
revisions in reverse order. Requests retained the existing User-Agent,
serial batches of at most 20, one-second gaps, maxlag and timeout. Every
canonical receipt matched. Both caches subsequently rebuilt the final bytes
with zero requests. Evidence: `.local/batch5-pinned-refetch.txt`,
`.local/batch5-pinned-refetch-final.txt` and `.local/batch5-repro.json`.

Payload SHA256:
`9e3ea91dff0ea6e85184a15d1e355d6dc5de0348d91e882332d8cc978677cea7`.

Provider digest:
`49967620f627770c6d3efe9c414fa850da17547104ea7db1dd4997f3ef5a00e6`.

The [0.5.0 input cache manifest](open-f2p-cache-inputs-0.5.0.txt) names every
filename, requested/resolved title, revision and canonical receipt. Retain a
complete copy of `.local/wiki-open-f2p/` or `.local/batch5-pinned-refetch/`.

## Verification evidence

Focused checks: **41 passed**, no failures or skips. They cover batch 1–4
preservation, exact free variants, requirements, quantity/rate strings,
provenance, unique stable IDs, resolved acquisition/drop/recipe links,
required materials/tools/facilities, deterministic guarded offline builds,
reproducible receipts and generic forbidden-input probes. Log:
`.local/batch5-focused-final.txt`.

Quick suite: **1,434 passed**, no failures, cancellations or skips. Log:
`.local/batch5-quick-tests.txt`.

One light-locked browser/server session passed at 1440 × 900 and 390 × 844.
It captured the map and visible equipment acquisition rows at both widths,
made 456 local requests, exercised nine lazy surfaces and Advanced coverage,
and verified viewer command/restore/invite writes return 403. There was no
horizontal overflow, browser error, unexpected HTTP error or outside request.
The equipment screenshots were also inspected visually. Browser, server and
disposable copy were removed. Screens and report: `.local/screens/open-f2p/`.
Run log: `.local/batch5-screens.txt`.

The heavy-locked private parity comparison passed with **zero differences**.
Default and packed profiles used fresh disposable copies of one captured
save, preserved read-only gameplay bytes and passed Undo. Copies and servers
were removed. Log: `.local/batch5-private-parity.txt`; concise evidence:
`.local/batch5-private-parity-summary.json`.

The heavy-locked isolation check passed for the delivered digest: **324
authenticated requests**, no forbidden reads, and no module-closure failures.
A bronze-hatchet equipment task was recorded, reloaded, undone and recorded
again through the existing command system. Quests, backups, sharing, worker
lanes and viewer restrictions also passed. Server, workers and disposable
execution copy were removed. Reports: `.local/batch5-isolation.json` and
`.local/batch5-isolation.txt`.

The first isolation attempt completed the equipment workflow, then found a
stale verification expectation: disabled import routes return 404 under the
current server contract, while the check expected 422. Only that check was
corrected. Restore-provenance rejection remains 422. No server, authentication
or feature behavior changed. Initial evidence is retained in
`.local/batch5-initial-isolation.json` and `.local/batch5-initial-isolation.txt`.

The single final heavy-locked `npm test` run executed **4,172 tests in 415
files: 4,171 passed, zero failed, one skipped**, with no cancellations. The skip
is the optional generated skill-icon asset check. No files were edited during
the run; `.local/batch5-full-source-audit.json` confirms all 20 changed files
matched their before-run hashes. Full log: `.local/batch5-full-suite.txt`.
Only this report was completed after the run; production and test code stayed
unchanged.

Final cleanup found no job-owned server or browser process and no disposable
parity or isolation saves. Caches, logs and screenshots remain in this worktree.

## Private comparison and ownership

The updated [private diagnostic](open-f2p-private-comparison-2026-10-13.md)
still matches 52 cells and 85 ore/tree groups. Eight dead-tree classification
differences and three cache-only review leads remain. Equipment, quests and
achievements are independently sourced totals because the comparison inputs
have no equivalent reviewed records. No private row feeds generation.

No private dataset input, original save, resource asset, shared UI,
authentication, CSP, viewer or overlay behavior is changed. Root licence and
notice files, changelog/roadmap data, public-export paths, dataset profile and
add-on/cutover seams are untouched. Existing saves stay bound to their version
and digest; use fresh 0.5.0 storage. Nothing is pushed, published or exported.
