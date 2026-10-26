# Chunk Picker RS3

A small, unofficial RuneScape 3 chunk challenge picker. Explore a coordinate
grid, roll a neighbouring chunk, check activities, and keep progress with
History and Undo. Pictures are deliberately simple project-authored placeholders.

## Prerequisites and checkout

Install **Node.js 24.20.0 or a newer 24.x release** with npm, Git (if cloning),
and a current browser with JavaScript and cookies enabled. Check your terminal
uses the intended Node:

```sh
node --version
npm --version
```

Node should report `v24.20.0` or a newer `v24.x`. The test runner relies on
native test-event metadata absent in Node 24.19.0, even though that version can
start the app. Clone this public repository, or extract its source archive and
open a terminal in the extracted directory:

```sh
git clone https://github.com/fenerax/chunk-picker-rs3.git
cd chunk-picker-rs3
```

Run all commands below from that directory. There are **no npm dependencies**:
no `npm install`, build, account, game client, plugin, private save or dataset
download is needed to run the included free-to-play picker.

## Start and open the picker

```sh
npm start
```

Leave this terminal running. Wait for `F2P game ready at http://127.0.0.1:8952/`.
The first launch creates a fresh `open-f2p` game for Explorer 1 and Explorer 2.
Progress is stored in `var/open-f2p`; later launches resume it. The sibling
`var/open-f2p.dataset.json` binds that storage to its dataset.

The bare address requires authentication on a fresh browser. Open
`var/open-f2p/access-token` locally in a text editor and copy its single token,
without trailing whitespace. In your browser's address bar, replace `<token>`
in this URL with that value (do not include the angle brackets):

```text
http://127.0.0.1:8952/join/<token>
```

This establishes an administrator session and redirects to `/`. Keep this
credential and the complete join URL private. Once joined, the bare address
works in the same browser until the session expires. `127.0.0.1` means the
machine running the server: a browser on another machine cannot use that
address to reach it. Stop the server with Ctrl+C.

For a second game, or if port 8952 is occupied, choose an unused port in
**8900–8999** and an empty storage directory:

```sh
npm start -- --port 8953 --data-dir var/another-game
```

Use `var/another-game/access-token` and port 8953 in the join URL for that
server. An occupied port, a nonempty unbound storage directory, or a directory
bound to another dataset is refused; the launcher does not stop another server.

## First use and invitations

Finish or skip the setup guide. A fresh game has no unlocked chunks. Select
Explorer 1, open **Search**, search for `12850` (Lumbridge), choose **View**,
then **Unlock** in the chunk panel. You now have neighbouring chunks to roll.
Use **Roll for Explorer 1** to unlock one, or choose two choices if your roll
style allows it. Check an available activity only after doing it in the game;
**Undo** reverses the last change. Reload resumes saved progress. Select
Explorer 2 and choose a starting chunk for that map separately.

**Admin → Invite links** creates separate Player, Admin and View only
invitations. Enter a label, choose the permission, and copy the new link before
closing the dialog; its full token is shown only once. Player links can edit
both maps; linking one to a player selects its initial map and permits that
player's map restore. View only links cannot change progress. Test a link in a
separate browser profile or private window; **Revoke** invalidates it and its
sessions.

The public launcher binds only to this machine and clears inherited public
hosting settings. Its invitation links work locally; they do not expose a
server to friends over the Internet. No hosting account is required for local
play. Remote hosting needs separate operator configuration
and is outside this quick start.

## Tests

In another terminal, from the checkout directory:

```sh
npm run test:quick
npm test
```

Tests use temporary/synthetic stores; no personal save or running server is
required. The full suite is heavier than quick. Linux test containers need an
init that reaps orphaned children (for example Docker's `--init`). Both suites
need enough free memory for the runner's 4 GiB floor plus 1 GiB per admitted
test worker; admission
waits when memory is insufficient. See [Testing](docs/testing.md) for selection,
concurrency and optional skips. These Node tests do not launch a browser.

## Optional datasets and plugin

`npm run start:f2p` is an alias for `npm start`, with the same port and storage.
The included `open-starter` dataset is a small invented world for trying the
picker without RuneScape data:

```sh
node scripts/start-independent-game.mjs
```

It uses port 8950 and `.local/open-starter`. Join using
`http://127.0.0.1:8950/join/<token>` with the token from
`.local/open-starter/access-token`. It also accepts `--port` and `--data-dir`.
These datasets are selected at startup; saves cannot be switched between them.
Legacy/operator pack workflows elsewhere in the repository may need separately
supplied inputs and are not prerequisites. Use these included datasets as the
public alternative.

A game plugin is optional. This repository supplies the picker-side API and a
synthetic simulator, not a game-client plugin installer. See the
[plugin API and simulator](docs/plugin-api.md#simulator) to try it on a separate
scratch game; no real account or private data is needed. Manual play works
without it.

## Coverage and licences

`open-f2p` is a reviewed slice of the free-to-play world, not all of it and not
a collision map. It covers gathering (trees, mines and fishing), shops, banks,
walking routes between towns, the F2P quests, a first set of area
achievements, and equipment you can buy, loot or make. Where the picker can't
be sure (combat, inventory, seasonal events, unmapped interiors), a task says
what to check by hand. **More → Settings → Advanced** shows coverage and gaps.
Dataset records keep their source revisions; new versions do not upgrade saves
silently.

Project code, rules and independently drawn placeholders use the [MIT licence](LICENSE).
The RuneScape Wiki contributors' adapted facts, joins and descriptions in
[`wiki-derived`](app/datasets/open-f2p/wiki-derived/NOTICE) use CC BY-NC-SA 3.0,
with per-record source/revision credits. Their licence is separate from MIT.

### Optional dataset regeneration

The generated F2P dataset is already included. Rebuilding it is a contributor
step, requires network access to `https://runescape.wiki/api.php`, and can take
time because requests are serial and retried with backoff. From the checkout,
fetch the pinned responses first; only if that succeeds, run the offline build:

```sh
node scripts/fetch-open-f2p-wiki.mjs --batch
node scripts/build-open-f2p.mjs
```

The fetch writes `.local/wiki-open-f2p`; the build needs that complete cache and
rewrites `app/datasets/open-f2p/wiki-derived/dataset.json`. Neither a private
cache nor a maintainer checkout is required, but blocked network access or an
unavailable pinned revision prevents regeneration. If fetching fails, stop
there and use the included dataset with `npm start`. Running the build without
the cache fails with a missing-file error. An optional local-cache rebuild test
skips when the cache is absent; synthetic offline generator checks still run.

Scripts that read the Wiki go through `scripts/lib/rs-wiki-client.mjs`, which
follows the Wiki's [API etiquette](https://runescape.wiki/w/Help:APIs): one
request at a time, a second apart, with maxlag, backoff and an identifying agent.
For contributor scripts that call `fetch` directly, use
`node --import ./scripts/lib/rs-wiki-preload.mjs <script>` to get the same client;
replace `<script>` with the script's repository-relative path.

RuneScape is a Jagex trademark. This project is unofficial and non-commercial.
See [third-party notices](THIRD_PARTY_NOTICES.md).
