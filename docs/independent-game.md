# Independent starter game

`open-starter`, contract 1, is a small invented game using the same application,
workers, revision-checked commands, History, Undo, backups and invitations as
the private picker. Its 6 × 5 grid has 30 cells, reciprocal walking connections
and one section per cell. Start in the clearing and explore the paper grove,
quiet pond, lookout and workshop. Five activities and two optional manual goals
have their own permanent IDs and aliases. You can add custom tasks, notes,
markers and shared goals.

All cells, activities, identities, aliases, rules, defaults, presets and text
were authored fresh for this project. The provider includes a provenance
catalogue identifying that scope and each cell, section, task, goal and rule.
It uses no exported picker data, task seed/history, captured rules, cache or Wiki
catalogues, personal configuration or game artwork. Compatibility catalogue
URLs retain the shared algorithms' existing names; their starter responses are
fresh, empty catalogues, not the private files at those paths.

## Start a separate game

From this checkout, with Node 24:

```powershell
npm run start:open
```

The default address is `http://127.0.0.1:8950/`. Storage is checkout-local
`.local/open-starter`, with a sibling `.local/open-starter.dataset.json` binding.
The first launch creates a fresh game for Explorer 1 and Explorer 2; later
launches resume it. The private picker on port 8788 keeps running. An occupied
port causes startup to fail; the launcher never stops another server.

For the first administrator session, open the local link without printing its
token in a terminal or report:

```powershell
$starterToken = (Get-Content -LiteralPath .local/open-starter/access-token -Raw).Trim()
Start-Process -WindowStyle Normal "http://127.0.0.1:8950/join/$starterToken"
Remove-Variable starterToken
```

Create player or view-only links through **Admin → Invite links**. Viewer links
have no gameplay write controls, and the server refuses their write requests.
Stop this separate server with Ctrl+C.

To create another game, choose an empty directory and another free port in
8900–8999:

```powershell
npm run start:open -- --data-dir .local/another-starter --port 8951
```

The launcher selects the provider before importing the application. It ignores
inherited private pack, map, art, hosting and loopback settings. It refuses
`.local/duo`, any mismatching bound directory and any nonempty unbound directory
before opening storage. A fresh game's initial state records dataset identity;
no new required field is added to the duo save. Backups must match this dataset,
contract and digest. Captured legacy maps cannot be imported into this game.

## Coverage

The map uses a plain grid and the existing authored placeholders. It has no
art-pack or repository-art fallback. Fresh rules control shared access,
neighbour selection, rolling and personal/shared completion. The **Starter
defaults** preset shows the five activities.

RuneScape catalogues, training/rate recommendations, BiS/equipment, skill guides,
collections, quests, transport, cache pins/interiors, Archaeology, external
account names and syncing are switched off because this world has no supporting
data. The development gallery and private project updates are also unavailable.
Capability flags hide those controls and refuse unsupported operations.

`duo-legacy` remains the default for ordinary `npm start`. Its IDs, aliases,
rules, data, integrations and storage behavior remain the private profile's
existing choices. This milestone adds no content batches, migration, public
export, repository move or publication.

## Verification

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/check-independent-game.mjs
powershell -NoProfile -File .local/with-light.ps1 node scripts/check-independent-screens.mjs
```

The first command creates and deletes a disposable execution copy with private
paths absent, rejects forbidden reads/imports/network calls in server and worker
processes, and exercises authenticated HTTP gameplay and sharing. Its JSON
report lists every excluded path and request. The second uses one disposable
browser/server session for desktop 1440 px, phone 390 px and actual viewer
controls. Screens are saved under `.local/screens/open-starter` and copied to
`docs/research`. These checks prove execution isolation for this starter;
they are not a public-export or licensing clearance.

## F2P gathering, shops and services

`open-f2p` 0.4.0 provides a separate Wiki-backed game with 52 surface cells,
120 gathering sources and 227 activities. It includes 13 shops, 126 positive
stock rows, 11 banks, six deposit boxes and one conditional paid boat route.
It uses the same plain grid and placeholder pictures. Start it with:

```powershell
npm run start:f2p
```

Its default port is 8952 and its fresh storage directory is `.local/open-f2p`.
Use `.local/open-f2p/access-token` in the administrator-link example above,
with port 8952. The launcher accepts `--port` and `--data-dir` as the starter
does, refuses occupied ports and mismatching storage, and clears private
art/data/hosting environment settings before application imports.

Choose **Lumbridge (12850)** as the start, then use **Pick Chunk**. The reviewed
automatic paths reach both Lumbridge swamp mines, Draynor, Port Sarim,
Rimmington, Falador, Taverley, Burthorpe, Varrock and Al Kharid. The 47 walking
connections reach 40 of the original 47 cells and 44 of the current 52 cells
from Lumbridge. Other included cells can be selected manually. The
[batch 3 verification](research/open-f2p-batch3-verification-2026-10-14.md)
records a reason for every remaining cell.
Coverage is still partial and does not provide a collision map. Cell details
and task names show the plain Wiki place names.

Gathering tasks use Mining, Woodcutting and Fishing levels from pinned Wiki
revisions. Each task requires a reviewed source in an unlocked cell that can
supply every listed tool and bait; each requirement may accept its recorded
alternatives. Only positive stock can supply an item. Bring coins for paid
stock and carry the supplies yourself: the game does not check inventory,
coin balances or stock depletion. Repeatable sources can establish training access; that
does not record actual skill levels. Reviewed dead trees yield normal logs at
level 1 and provide a starting Woodcutting method, including an exact placement
in Lumbridge. Generic living trees still lack reviewed coordinates. Free maple,
yew and Acadia placements extend Woodcutting coverage. Musa Point adds lobster,
tuna and swordfish with their pot or harpoon requirements. The existing
Al Kharid and Barbarian Village fishing families are retained. **Show blocked**
explains unavailable methods. Check a task after actually completing it in the
game. This slice keeps the account and training-control
screens disabled. **Extra** shows reviewed service and purchase activities.
Settings → Advanced shows coverage counts and the gaps.

Banks and deposit boxes retain their mapped floors. Lumbridge Castle's bank
is on plane 2 and requires stairs; this facility does not add upper-floor
resource regions. Deposit boxes accept items but do not withdraw them. The
free Burthorpe chest comes from explicit `Bank chest` location evidence;
the conflicting members-only Burthorpe bank article supplies no free row.

The Port Sarim–Musa Point boat is conditional source route metadata. Each
direction has a 30-coin fare and a Coins requirement in its activity. Complete
the activity manually after travelling. The boat creates no automatic section
travel and does not unlock either endpoint. Reviewed coin drops establish a
supply option; the carried fare is still checked in game.

Version `0.4.0` adds all 45 regular F2P quests, eight seasonal quests and
15 reviewed area achievements. **Quests** and **Show area achievements**
control these lists. Use **Show blocked** to inspect their gates. Prerequisite
quests require personal completion; reachable training, supplies and reviewed
cells are checked separately. Items, quantities, unreviewed interiors and
seasonal availability keep explicit manual checks. Check the task only after
finishing it in RuneScape. These tasks do not create new cells or travel links.
The [batch 4 review](research/open-f2p-batch4-verification-2026-10-14.md) records
the roster, achievement exclusions and remaining checks.

Version `0.5.0` adds seven exact equipment variants: bronze hatchet, pickaxe,
dagger, sword and full helm, plus leather body and boots. **Extra** includes
their obtain and wield/wear goals and the reviewed drop activities. Shops,
monster drops and recipes can supply item requirements. Gathering outputs
provide copper and tin for bronze bars; the reviewed Lumbridge furnace,
forge and anvil support bronze smithing. Cowhide drops, Ellis in Al Kharid,
and a needle and thread support leather crafting. Missing materials, tools
or facilities block the corresponding recipe.

Four monster families have seven reviewed cell groups and 24 drop rows.
Separate goblin variants retain their own table; members-only and conditional
drops are excluded. Rates and quantities retain the Wiki's wording. Sources
describe ways to obtain an item. They do not record kills, inventory, carried
coins, material consumption or equipped items. Combat sources use the existing
repeatable-training rules without adding kill times or XP rates. Confirm
combat ability and equipment goals in game before checking them. The equipment
and BiS screens remain outside this partial task slice. The
[batch 5 review](research/open-f2p-batch5-verification-2026-10-15.md) records
the exact selection and omissions.

Facts, joins and generated descriptions in
`app/datasets/open-f2p/wiki-derived/` have their own CC BY-NC-SA 3.0 NOTICE,
separate from authored code. Every cell, source, task and route has a Wiki page
title and revision. Activity IDs start `rs3:open-f2p:activity:`; no legacy task
identities or catalogues are imported. The optional journal goal is
`custom:open-f2p:journal`, registered for this game.

To rebuild from the pinned cache:

```powershell
node scripts/fetch-open-f2p-wiki.mjs --batch
node scripts/build-open-f2p.mjs
node --test --test-timeout=120000 tests/open-f2p.test.mjs
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/check-independent-game.mjs --dataset open-f2p
powershell -NoProfile -File .local/with-light.ps1 node scripts/check-independent-screens.mjs --dataset open-f2p
```

The fetch command makes zero requests with the complete cache. The generator
makes no requests under any conditions. The isolation check includes an actual
roll, generated activity completion, reload, Undo, backups and sharing. Run the
checks one server session at a time. The [batch plan](research/f2p-batches-plan-2026-10-13.md)
records exact scope, source limits and later batches. New dataset versions do
not silently upgrade a bound save; retain its version or start fresh storage.
