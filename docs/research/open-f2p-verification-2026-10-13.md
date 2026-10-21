# First independent F2P slice: verification, 13 October 2026

`open-f2p` 0.1.0 contains 47 surface cells, 92 gathering source groups and
92 generated activities, supported by 36 Wiki pages. Five reviewed reciprocal
land paths connect the Lumbridge start, south-east mine, forest, Draynor,
Port Sarim and Rimmington. Other included cells remain manually selectable.
The invented starter and private profile keep their own dataset selection.

## Implementation and provenance

- Provider: `app/open-f2p.mjs`; launcher: `npm run start:f2p`, fresh
  `.local/open-f2p`, default port 8952.
- Offline generator: `scripts/build-open-f2p.mjs`. Exact authored input:
  `app/datasets/open-f2p/authored/batch.json`; 38 pinned API responses under
  this worktree's `.local/wiki-open-f2p`.
- Dataset: `app/datasets/open-f2p/wiki-derived/dataset.json` and its separate
  CC BY-NC-SA 3.0 NOTICE. Payload SHA256:
  `d7973a534981207add609ace74603c81c25dc0f471a722b1b208fa4c23459fa3`.
- Final provider digest:
  `2e6b67535331d67f45c599571f893fef7611b7a081468ea4c46699252199e072`.
- Batch order, licence boundaries and limitations:
  `docs/research/f2p-batches-plan-2026-10-13.md`.

Each factual cell, resource, task and connection carries source page titles,
revision IDs and revision URLs. Coordinate arithmetic and activity IDs were
authored independently. The Wiki pages establish the tile coordinates; they
do not state the numeric region-ID formula. The dependency inventory documents
that standard game convention. This distinction is explicit in the generated
coordinate record and batch plan.

The API `rightsinfo` response reports CC BY-NC-SA 3.0. The fetcher uses serial
MediaWiki requests, a descriptive User-Agent, at most 20 pages per request,
`maxlag=5`, a one-second gap and a 45-second timeout. A pinned-batch rerun
reported **38 requested, zero fetched**. The build itself is offline. No Jagex
sites, game client, images, original picker list or private catalogue supplied
public rows.

The shared edits are limited to explicit provider selection, independent
identity recognition, launch/check wiring and Advanced coverage text.
`server.mjs`, `resources/`, `app/data` source files, authentication, CSP, overlay
policy and viewer policy were not edited. All gameplay checks use the existing
revision-checked command path.

## Verification evidence

Focused run: **21 passed, zero failures or skips**, including the nine new F2P
tests and the starter tests. Log: `.local/open-f2p-focused-tests.txt`.
Quick suite: **1,352 passed in 137 files**, zero failures, cancellations or
skips. Log: `.local/open-f2p-quick-tests.txt`.

The final identity review also caught an absent-capability boolean edge: the
private provider does not declare `independent`. Requiring `independent === true`
keeps its old strict `false` result for unknown IDs. A focused private-identity
regression passed **1/1**, and the 21 starter/F2P tests were rerun successfully
after that correction. Log: `.local/open-f2p-private-identity-test.txt`. This
late regression was run separately after the full run had passed that file.

The F2P tests cover every row's provenance and cell references, unique stable
source/activity/connection IDs, independent registry aliases, manual journal
rendering and state validation, provider byte receipts and digest refusal,
shared world/task compilation, and membership/gate/interior exclusion. A
synthetic pinned fixture includes nested requirement templates and rejected
members/interior rows. Two builds produce identical bytes. The actual pinned
cache also reproduces the committed JSON byte for byte.

`scripts/lib/open-f2p-build-guard.mjs` audits every generator data read against
an exact allowlist. It rejects 21 negative read/discovery probes. A folder scan
rejects unexpected inputs, images, forbidden source paths and legacy task IDs.
These checks prove the reviewed build's input boundary; they are not a future
public-export leak gate or a review of the repository's old history.

The heavy-locked isolation check passed against a disposable execution copy
with private paths physically absent. It made **315 authenticated HTTP
requests**, including a real neighbour roll, completion of
`rs3:open-f2p:activity:crayfish:12850`, reload, Undo of that completion, a second
completion, manual goals, note Undo, backups, player sharing and a viewer
write refusal. The module/lazy-route closure and worker guard recorded zero
forbidden reads and zero outside resource edges. Report:
`.local/open-f2p-isolation.json`. The server and copy were removed.

`scripts/dataset-parity.mjs` ran under the heavy lock, using fresh disposable
copies of the duo save with credentials and lock files excluded. It reports
**zero differences**, unchanged read-only gameplay bytes and successful Undo
restoration in both default and packed private profiles. The copies and packs
were deleted. Private output: `.local/open-f2p-private-parity.json`.

The single heavy-locked full run covered **403 files / 4,083 tests**:
**4,066 passed, 16 failed, one skipped**, zero cancellations. Complete output
is retained at `.local/open-f2p-full-suite.txt`. The skip is the optional
generated-PNG byte/hash/dimension/alpha check.

The 16 failures were in `runemetrics-server` (3), `sandbox-server` (5) and
`scheduling-server` (8). I changed the pinned identity source while those test
processes were running. Fourteen rejected the now-different provider fingerprint
at startup, one worker reported `DATASET_PACK_INVALID`, and one exhausted worker
restarts with HTTP 503. No failed feature assertion appeared. This was a test-run
sequencing mistake; the full log retains it. The full suite was not repeated.

The affected files and the complete private identity file passed a sequential
heavy-locked rerun: **36 passed, zero failures or skips**, with the source fixed.
Output is retained at `.local/open-f2p-targeted-recovery.txt`. Private parity was
refreshed after the final source correction.

## Screens and private comparison

One light-locked Chrome/server session captured desktop **1440 × 900** and
phone **390 × 844**, without horizontal page overflow. It exercised nine lazy
surfaces, Advanced coverage and real viewer controls. All 448 browser requests
stayed local, with no unexpected HTTP errors or browser exceptions. Viewer
command, restore and invitation writes each returned 403. Browser/server and
disposable copies were closed and removed.

- `.local/screens/open-f2p/open-f2p-desktop-1440.png`
- `.local/screens/open-f2p/open-f2p-phone-390.png`
- Browser report: `.local/screens/open-f2p/report.json`
- Copies: `docs/research/open-f2p-desktop-1440.png` and
  `docs/research/open-f2p-phone-390.png`

The screens show the final 47-cell/92-activity layout. The browser session
preceded the final metadata-only datasetId/fallback fix and the correction of
one omission sentence; the focused tests cover the final browser identity
payload. There was no later layout change.

The [private comparison](open-f2p-private-comparison-2026-10-13.md) uses only
the new dataset and two approved cache-derived diagnostic inputs. All 47 cells
match cache coverage and all 68 comparable ore/tree groups match. There are
seven cache-only groups within the comparison crop; one is in an unselected
cell. Twenty-four fishing groups have no equivalent product-specific cache
class. These differences identify future Wiki-review work; no cache rows were
copied or promoted to public data.

## Limits

This is a useful gathering slice, not the whole F2P surface or a collision map.
Cell membership establishes a reviewed free place/resource in that region;
it does not make every tile in that region free. Named paths are reviewed
between adjacent place regions, without an exact tile mask. Unknown crossings,
gated places, interiors, ordinary trees and later content families remain out.

Tools and bait must be brought; no inventory or supply-route check is supplied.
Mining/Fishing starter sources support repeatable training. Ordinary trees
still need exact locations, so the automatic list cannot establish a starting
Woodcutting method. Tree tasks can be shown as blocked and checked after
actually completing them; oak completion supplies its entry-level evidence.
The account/training-control screens remain disabled. Shops, banks, transport,
quests, achievements, equipment, drops and rates await later batches.

All changes remain on `codex/f2pbatch1`. There was no deployment, push,
publication or export, and the live picker was not changed.
