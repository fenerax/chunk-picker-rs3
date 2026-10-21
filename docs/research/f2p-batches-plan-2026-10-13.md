# Independent F2P batches, 13 October 2026

Milestone 4 starts a separate `open-f2p` dataset at version `0.1.0`. It preserves
the invented `open-starter` game and the private profile. Batch 1 remains the
historical gathering slice. Player 1 selected shops, banks and transport for
batch 2, version `0.2.0`; the previously planned gathering expansion is deferred
to batch 3. Version `0.3.0` implements that gathering expansion within the
reviewed boundary below. Later batches require their own source and gameplay review.

| Order | Coverage | Planned Wiki pages | Licence scope |
| --- | --- | --- | --- |
| 1, built here | Real surface cells and gathering sources. Start with Lumbridge, Draynor, Port Sarim and Rimmington; include reviewed coordinates around Varrock, Al Kharid, Falador, Edgeville, Taverley and Burthorpe. Add oak/willow trees, six ungated surface mines and three fishing-spot families. | The town/location pages; Lumbridge forest, Lumbridge lodestone, Lumbridge south-east/south-west mines, Varrock south-east/south-west mines, Al Kharid mine, Rimmington mine; Oak, Willow; Copper, Tin, Iron, Coal, Mithril, Adamantite, Clay, Gold, Silver and Limestone rocks; Fishing spot (crayfish), Fishing spot (lure, bait), Fishing spot (small fishing net, bait); Template:Map/doc and RuneScape:Map. | All adapted facts, joins and generated dataset descriptions in `app/datasets/open-f2p/wiki-derived/`: CC BY-NC-SA 3.0 with per-row revisions and NOTICE. |
| 2, selected by Player 1 | Shops, banks and transport, with reviewed walking approaches. Establish tools and bait supply; distinguish automatic walking links from conditional paid travel. | Lumbridge Fishing Supplies (formerly Hank's Fishing Shop), Gerrant's Fishy Business, selected general/tool shops and stock pages, individual bank pages, Bank chest, Bank deposit box, Port Sarim and Musa Point ferry evidence. | Wiki facts/stock/joins in the Wiki folder. Fresh rules and algorithms remain project-authored code. No images. |
| 3, built here | Fill reviewed world and gathering gaps. Level-1 dead trees provide normal logs; add free maple, yew and Acadia placements, five further surface mines, Musa Point cage/harpoon fishing and 24 further walking approaches. Generic living trees remain unsourced. | Tree, Dead tree, Evergreen, Maple Tree, Yew, Acadia tree, Mining sites, Fishing spot; reviewed mine, location and gate pages. | Same separate Wiki scope; each addition receives its own revision provenance. |
| 4, built here | Quests and achievements, including their actual F2P gates and location requirements. | Free-to-play quests, individual quest pages and quick guides, Lumbridge achievements, Varrock achievements, Falador achievements and each selected achievement page. | Wiki adaptations separately credited and share-alike; fresh task expressions use new independent identities. No copied picker task lists or presets. |
| 5, built here | Equipment and drops, limited to reviewed F2P acquisitions and exact variants. | Individual equipment/item pages, monster pages and their drop tables, plus source pages established in earlier batches. | Wiki stats and drop adaptations in the Wiki folder; independently specified task policy in authored code. No game artwork. |

The batch-1 authored selection recorded 38 requested pages, including
redirects, that resolved to the revisions used by the generator. Thirty-six distinct
pages supported playable rows. Two further pages documented the coordinate
inputs. `app/datasets/open-f2p/authored/batch.json` now records the active batch's
exact titles and pinned revisions; Git retains the batch-1 selection.

## Batch 1 boundary

The historical batch-1 slice had 47 cells, 92 source groups, 92 generated activities and
five reciprocal walking links. There are 48 tree groups, 20 mining groups and
24 fishing groups. One source group describes a resource/product in one cell,
with all admitted Wiki placements recorded. It is not an object or spot count.

Cells are 64-tile surface regions. Their numeric keys are calculated as
`floor(x / 64) * 256 + floor(y / 64)`, the game-region convention documented in
the dependency inventory. Per-row Wiki provenance establishes the coordinates,
place and membership facts; the conversion is authored arithmetic. The consulted
Wiki technical pages did not state the numeric ID formula itself. That evidence
limit is retained in the dataset rather than attributed to a Wiki page that does
not say it.

The coordinate crop is an authored selection, not an assertion of the whole
F2P boundary. A cell containing a reviewed free resource does not make every
tile in that cell free or reachable. Most F2P regions, boundary crossings and
interiors remain unreviewed. Only the named land paths from Lumbridge to its
south-east mine and forest, through the forest to Draynor, and from Draynor to
Port Sarim and Rimmington become automatic links. Their place endpoints are in
adjacent regions. This is a place-level route review, not tile collision data.
Other cells remain manually selectable; geometric adjacency grants no walking
access under the default connected-neighbour rule.

The first batch omits gated locations, ordinary trees without exact coordinates,
unreviewed tree species, islands, dungeons, seasonal content and later content
families. A few northern oak placements have explicit free Wiki rows; this is
not a reviewed Wilderness travel network. Missing or gated resource locations
stay out. Unknowns use short wording in Advanced coverage.

Activities mean one successful gather. The source level is read from its pinned
Wiki page. Bring the required tool or bait; inventory and supply routes are not
checked yet. Existing repeatable-source evaluation can establish training access
up to the highest source level in this batch, without recording actual levels,
XP rates or inventory. The automatic list cannot establish a starting
Woodcutting method until ordinary trees have exact locations. Tree tasks can
be shown as blocked and manually checked after they are actually performed;
an oak completion supplies its entry-level completion evidence. Account and
training-control screens remain disabled. The engine's coverage ceilings are
not a new catalogue of RuneScape skill maximums.

## Batch 2 boundary

Version `0.2.0` adds reviewed free shops, positive stock with known prices,
banks, deposit boxes and a conditional Port Sarim–Musa Point paid boat route.
The resulting dataset has 48 cells, 23 walking connections, 92 gathering
sources and 129 activities, supported by 91 distinct Wiki pages. Services
comprise 13 shops, 126 positive stock rows, 11 banks and six deposit boxes.
The 37 new activities comprise 18 purchases, 17 banking/deposit services and
two directions of the one paid boat route. The original five walking links
plus 18 new links reach 24 of the original 47 cells from Lumbridge.
It retains the batch-1 gathering IDs and coordinates. New service and purchase
activities have their own `rs3:open-f2p:` identities. Reviewed surface walking
approaches extend the connection graph; adjacency alone still grants no access.

Gathering supply checks require every listed tool and bait. Alternative items
can satisfy an individual requirement, but zero stock cannot supply anything.
A reviewed shop must be in an unlocked cell. These checks establish a supply
option; they do not count carried items, coins, purchases or stock depletion.

Bank and deposit-box records preserve their mapped floors. The Lumbridge Castle
bank remains on plane 2, reached by stairs; retaining this facility does not
add upper-floor resource regions. The reviewed Burthorpe bank chest uses the
explicit free `Bank chest` ObjectLocLine evidence. The conflicting Burthorpe
bank article, which marks membership as yes, supplies no free bank row.
Deposit boxes permit deposits and do not establish withdrawal access.

The boat source is route metadata with a 30-coin fare in each direction. Its
activities have a Coins condition and are checked manually after the crossing.
They do not create an automatic section connection or unlock either endpoint.
Unreviewed lodestones, canoes, gates and other travel remain outside this batch.
Existing saves stay bound to their original dataset version and digest; use a
fresh data directory for `0.2.0`.

Canonical Wiki receipts hash requested title, resolved title, revision,
content model and exact wikitext. Request grouping and cache-envelope JSON
formatting do not change them. The accepted batch-1 baseline rebuild matches
every dataset field except historical `buildInputs`; that receipt-only change
does not establish new source facts. The preserved `0.1.0` gameplay rows are in
`app/datasets/open-f2p/wiki-derived/baseline-0.1.0.json`.

## Batch 3 boundary

Version `0.3.0` has 52 cells, 120 gathering source groups, 159 activities and
47 walking connections. It retains all batch 1–2 identities, labels and meanings.
Twenty-eight new gathering groups comprise eight dead-tree groups, nine yew
groups, one maple group, one Acadia group, six mining groups and three fishing
groups. Two additional purchase activities cover lobster pots and harpoons.
Shops, stock, banks, deposit boxes and the conditional boat route retain their
batch-2 records.

Dead trees have exact free surface placements and yield normal logs at level 1.
Generic living trees and evergreens have no reviewed coordinate table and are
not added by inference. The free maples north of Gower farm are included;
resource-dungeon maples retain their Dungeoneering gate and are omitted.
Only the three free Acadia placements west of Het's Oasis are admitted.

New mine selection covers Gunnarsgrunn, Gunnarsgrunn south, Draynor, Falador
west and Silvarea quarry. Dwarven Mine rocks have underground coordinates and
remain excluded. Musa Point adds lobster, tuna and swordfish. The original
Al Kharid and Barbarian Village fishing families were already present.

The walking graph reaches 40 of the original 47 cells from Lumbridge and
44 of all 52 cells. The remaining eight cells have individual reasons in the
[verification report](open-f2p-batch3-verification-2026-10-14.md). Wilderness
warning crossings, uncertain Crafting Guild fence access, the unreviewed
Taverley bank shoreline approach and island access remain manual. The boat
arrival region contains disconnected mainland terrain; no walking link is
created from that region to Musa Point fishing.

The build reads 126 pinned cache files. The
[complete cache manifest](open-f2p-cache-inputs-0.3.0.txt) lists every filename,
requested and resolved title, revision and canonical receipt. Historical
`0.1.0` and `0.2.0` payloads are retained for preservation tests; generation
cannot read them. Existing bound saves are not silently upgraded.

## Batch 4 boundary

Version `0.4.0` adds 53 quest tasks (45 regular and eight seasonal) and
15 area-achievement tasks, for 227 activities. The 52 cells, 120 gathering
source groups and 47 walking connections retain every batch 1�3 row unchanged.
The Wiki free-quest navigation fixes the roster; historical quests and
miniquests are excluded. All seasonal quests require an event-availability
check. The Wiki prerequisite module supplies implicit quest gates that the
main quest pages transclude. Personal completion is required for every full
quest prerequisite. No prerequisite is inferred from sequel wording.

The first achievement slice contains nine Lumbridge, three Varrock and three
Falador tasks. Five reviewed candidates are excluded with individual reasons.
Precise map coordinates and existing reviewed placements supply required
cells; uncertain starts, floors, dungeons, instances and route segments retain
manual checks. Optional supply locations do not become mandatory cells.
Skills without reviewed training methods remain blocked rather than receiving
invented methods. Items and quantities still require an in-game inventory
check. No equipment/drop slice, additional travel network or personal-account
sync is added. See the [verification report](open-f2p-batch4-verification-2026-10-14.md).

## Batch 5 boundary

Version `0.5.0` adds seven exact equipment variants, seven monster cell groups,
24 drop rows, four crafting/smithing facilities and nine recipes. Thirty-seven
acquisition tasks and seven wield/wear tasks bring the total to 271 activities.
Every batch 1-4 row retains its identity, wording, coordinates and requirements.
No cell or walking connection is added.

Equipment covers bronze hatchet, pickaxe, dagger, sword and full helm, leather
body and leather boots. Positive batch-2 shop stock, reviewed drops and recipe
outputs supply item checks. Existing gathering outputs now supply recipe
materials. Recipes require every material and tool plus their reviewed facility;
quantities and consumption are checked in game. Tool use and wield requirements
remain separate facts. Wield goals require the exact item without forcing one
particular acquisition cell.

The monster slice covers chickens at Fred's farm, cows at Astram Farm, regular
level-4 giant rats in Lumbridge Swamp and level-11 Varrock goblins. Exact NPC
variants join only to their own reviewed drop table. Wiki quantity and rate
strings are retained. Quest, event, membership and equipment conditions,
transcluded drops and uncertain table mappings are omitted. The existing
source evaluator handles drop rates and repeatable combat training; source
availability does not record successful kills or actual levels.

This is a starter equipment slice. Higher equipment tiers, other monsters,
unreviewed shops, dungeons, spawns, upgrades and BiS ranking remain outside it.
See the [verification report](open-f2p-batch5-verification-2026-10-15.md) and
[input cache manifest](open-f2p-cache-inputs-0.5.0.txt).

## Input and licence boundaries

The fetcher uses only the RuneScape Wiki MediaWiki API, a descriptive User-Agent,
serial requests of at most 20 pages, `maxlag=5`, a one-second gap and a 45-second
request timeout. Responses stay under this worktree's ignored
`.local/wiki-open-f2p/`. The pinned-batch command requests old revisions when its
cache is empty; a complete cache causes zero requests. A mismatching cache is
refused. No automatic refresh is part of the build.

`scripts/build-open-f2p.mjs` is offline. It reads the one authored selection and
its pinned cache files, and writes deterministic JSON. It does not import the
private provider, discover directories, fetch pages, read the original export,
task map/history, `reference/`, cache-derived catalogues or map exports. Tests
audit the actual reads against an exact allowlist and scan the dataset folder.

The Wiki API's `rightsinfo` reports CC BY-NC-SA 3.0. The derived folder has its
own NOTICE and per-row revision URLs. Project-authored scripts, rules,
independent identities and placeholders remain in the authored code scope.
There are no Jagex or Wiki images.

The private cache comparison is a separate diagnostic under `docs/research`.
Its script is never imported by the generator or provider. A cache match is a
cross-check; a difference is a lead for new Wiki review, not permission to copy
the private row. Nothing in this milestone is published, pushed or exported.
