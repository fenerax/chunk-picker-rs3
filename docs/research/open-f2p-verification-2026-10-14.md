# Independent F2P batch 2: verification, 14 October 2026

`open-f2p` 0.2.0 contains 48 cells, the original 92 gathering sources,
129 activities, 13 shops, 126 positive stock rows, 11 banks or bank chests,
six deposit-box groups and one conditional boat route. Its 23 reciprocal
walking connections reach 24 of the original 47 cells from Lumbridge.
The new activities comprise 18 supply purchases, 17 banking/deposit services
and two ferry directions. The [batch plan](f2p-batches-plan-2026-10-13.md)
records the selected order and scope.

## Sources and implementation

All factual rows retain RuneScape Wiki page titles, pinned revision IDs and
revision URLs under the existing CC BY-NC-SA 3.0 scope. The 93 requested pins
support 91 distinct pages used by playable rows. API retrieval remains serial,
at most 20 pages per request, with the descriptive User-Agent, `maxlag=5`, a
one-second gap and a 45-second timeout. The final pinned fetch reported
93 requested and zero fetched. Responses remain in `.local/wiki-open-f2p`.

The offline generator reads exactly `authored/batch.json` and its pinned cache
files. The new service and walking helpers have no filesystem or network
operations. No original-picker data, private rows, cache-derived rows, map
exports or images supplied gameplay data. Root licence/notice files and export
scripts were left alone; the existing Wiki folder NOTICE covers the additions
and the historical baseline.

`app/open-f2p.mjs` supplies the existing engine with reviewed shops and positive
stock. Gathering requires each tool and bait; missing either rod or bait blocks
the method. Availability establishes a shop source in the player's unlocked
map, not possession. The existing partner-source policy still applies when
shared access is enabled. Coins, purchases, inventory and stock depletion are
not tracked. Zero-stock fish and members/unknown/gated stock are excluded.

Banking activities distinguish deposits from withdrawals. Lumbridge Castle's
bank preserves plane 2 and its stairs. Gathering extraction excludes upper-floor
and gated placements. Burthorpe's admitted chest comes from an explicit free
`Bank chest` location row, rather than the conflicting members-only bank page.
The source records establish banking access, not a simulated bank inventory.

The ferry uses current Captain Tobias and Customs officer evidence, with
30 coins required in each direction. Both activities remain blocked by the
unsourced Coins condition and can be checked manually after travelling.
Neither direction creates walking topology or unlocks a cell. Removed sailor
pages, lodestone activation, canoes and unreviewed gates remain outside this batch.

Walking joins review named approaches and public town gates between adjacent
regions; they are not collision masks. The region containing the Musa Point
dock also contains disconnected mainland land. No boat arrival grants access
to all resources in that region. Unreviewed cells remain manually selectable.
The original gathering bounds are unchanged; only facility selection admits
the mapped Taverley bank immediately west of that crop.

## Accepted batch-1 receipt recovery

Before additions, the refetched pinned cache rebuilt batch 1. Deep comparison
proved that every field except `buildInputs` was identical, including every
cell, source, task, connection, coordinate record and page/revision provenance.
The original payload SHA256 was
`d7973a534981207add609ace74603c81c25dc0f471a722b1b208fa4c23459fa3`;
the envelope-receipt rebuild was
`6845541cb6c76c72d41f35e7a5b1c51d7457981deae911e9273bb45b43f47e6c`.
Player 1's brief accepted this receipt-only difference. Evidence is retained in
`.local/batch2-baseline-verification.json` and `.local/batch1-original.json`.

Future receipts hash a canonical record of requested title, resolved title,
revision, content model and exact wikitext. Request URLs/grouping, response
metadata and envelope formatting no longer affect them. Tests refetch pinned
fixtures in different request groupings and reproduce the same receipts.
Historical envelopes remain compatible, and mismatching pins are refused.
`wiki-derived/baseline-0.1.0.json` preserves the original gameplay rows for
identity and meaning checks; the generator never reads that baseline.

Final payload SHA256:
`3f4977e961a7a22f4709e756767fe8643230f458941c466ccc94db0e957a1477`.
Provider digest:
`3b14a70ecdb378b9b3f4e5217d97e6b1a1447fe7ad9bf45fa872b27955af3d1b`.

## Verification

The final focused run passed 38 tests without failures or skips. It covers
baseline identities and meanings, provenance/references for every new row,
positive/member/gated stock, exact tool-and-bait requirements, service floors,
conditional boats, canonical refetch receipts, provider compilation and
deterministic rebuilds. The guard records exactly the authored selection and
93 pinned cache reads, with explicit helper-module allowlists and 21 rejected
private/discovery probes. The forbidden-input scan also passes.
Log: `.local/batch2-focused-tests.txt`.

The heavy-locked isolation check passed with private paths physically absent.
It made 315 authenticated HTTP requests: create game, neighbour roll, activity
completion, reload, Undo, journal/note commands, backup restoration, player
sharing and viewer write refusal. Server and worker guards recorded zero
forbidden reads. The execution copy and server were removed.
Report: `.local/batch2-isolation.json`.

The quick suite passed **1,361 tests in 138 files**, without failures,
cancellations or skips. Log: `.local/batch2-quick-tests.txt`.

One completed light-locked browser/server session captured **1440 × 900**
and **390 × 844**, with no horizontal page overflow. It exercised nine lazy
surfaces, Advanced coverage and actual viewer controls. All 448 requests
stayed local, with no unexpected HTTP errors or browser exceptions. Viewer
command, restore and invitation writes each returned 403. The browser, server
and execution copy were removed. Screens:

- `.local/screens/open-f2p/open-f2p-desktop-1440.png`
- `.local/screens/open-f2p/open-f2p-phone-390.png`
- Browser report: `.local/screens/open-f2p/report.json`

An initial screen attempt captured both viewports but its final cleanup hit
a transient Windows `EBUSY` on the stopped Chrome profile and lost its report.
The profile was removed within the checked scratch directory. The harness now
retries busy-file cleanup and records cleanup failures. The completed session
above repeated all checks after that correction. Historical batch-1 PNGs in
`docs/research` were restored; final batch-2 screenshots remain in `.local`.

The first private-parity attempt stopped before comparison with a
`TypeError` at the task/access stage; the sanitized error had no further cause
or application frames, and it produced no comparison result. Its log
is `.local/batch2-private-parity-initial.txt`. The verification harness now
separates task retrieval and reports safe, query-free request/cause codes for
HTTP request or body failures. The retry used another fresh disposable save
after the quick suite completed. It reached the strict read-only byte check
and found only `state.json`
rewritten, with revision 127 and unchanged migration evidence. The harness's
October-13 clock added a daily progress observation to the later captured save.
It now pins both profiles to the latest observation already recorded in their
shared input. The byte check remains strict and no progress fields are ignored.
Four focused regression tests prove the wrong-day rewrite and unchanged bytes
with the selected instant. The intermediate diagnostic log is
`.local/batch2-private-parity-clock-failure.txt`.

The final heavy-locked parity run **passed with zero differences**, unchanged
read-only gameplay bytes and successful Undo in both default and packed
profiles. The pack, save copies and servers were removed. Its private log is
`.local/batch2-private-parity.txt`. Only verification scripts changed to repair
the clock fixture; application storage and private input files are unchanged.

The single final heavy-locked full suite passed **4,097 tests in 405 files**,
with zero failures or cancellations. One optional generated-skill-icon PNG
check was skipped because `SKILL_ICON_ASSET_ROOT` was unset (4,098 total tests).
No files were edited while the suite ran. Log: `.local/batch2-full-suite.txt`.
Final cleanup found no job-owned Node/Chrome processes or disposable
independent-game/parity directories remaining.

## Private comparison and boundaries

The [private diagnostic comparison](open-f2p-private-comparison-2026-10-13.md)
matches all 48 selected cells and all 68 comparable ore/tree groups. There are
zero Wiki-only groups and nine cache-only groups in the expanded comparison
crop. These remain review leads. Banks, stock and boats have no equivalent
rows in the two permitted resource/walkability catalogues. The diagnostic
script is never imported by generation or gameplay; no diagnostic rows were
copied into the independent dataset.

No private dataset input module, identity registry, save, `resources/`, server,
authentication, CSP, viewer or overlay policy was edited. No new private
data-pack build was required by a source-input edit; parity builds its own
disposable pack for comparison. The screenshot harness received bounded
Windows cleanup retries and preserves reports if cleanup fails.

New bound saves use 0.2.0; a 0.1.0 save is not silently upgraded. Ordinary trees,
full F2P coverage, unknown crossings, gated interiors, quests, equipment, drops,
rates and automatic paid travel remain outside this batch. Shop stock is a
reviewed subset, with omissions explicit in each shop record.

Everything remains local on `codex/f2pbatch2`. Nothing was published, pushed or
exported, and the live picker was not changed. Planner was not updated because
Player 1 explicitly said it was not needed for this job.
