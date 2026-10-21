# Chunk Picker RS3

A small, unofficial RuneScape 3 chunk challenge picker. Explore a coordinate
grid, roll a neighbouring chunk, check activities, and keep progress with
History and Undo. Pictures are deliberately simple project-authored placeholders.

Use Node.js 24. No dependency installation is needed.

```sh
npm start
```

Open `http://127.0.0.1:8952/`. The first launch creates a fresh `open-f2p`
game for Explorer 1 and Explorer 2. Progress is stored in `var/open-f2p`.
Open the administrator invitation locally by appending the contents of
`var/open-f2p/access-token` to the address followed by `/join/`.
Keep this credential private. Admin → Invite links creates separate player
and view-only invitations. Stop the server with Ctrl+C.

```sh
npm start -- --port 8953 --data-dir var/another-game
npm run test:quick
npm test
```

Choose an empty storage directory for a new game. A directory bound to another
dataset is refused. Roll with **Roll 1**, check an available activity, and
use **Undo** to reverse it. Reload resumes saved progress.

`open-f2p` is a reviewed slice of the free-to-play world, not all of it and not
a collision map. It covers gathering (trees, mines and fishing), shops, banks,
walking routes between towns, the F2P quests, a first set of area
achievements, and equipment you can buy, loot or make. Where the picker can't
be sure (combat, inventory, seasonal events, unmapped interiors), a task says
what to check by hand. Settings → Advanced
shows coverage and gaps. Dataset records keep their source revisions; new
versions do not upgrade saves silently.

Project code, rules and independently drawn placeholders use the [MIT licence](LICENSE).
The RuneScape Wiki contributors' adapted facts, joins and descriptions in
[`wiki-derived`](app/datasets/open-f2p/wiki-derived/NOTICE) use CC BY-NC-SA 3.0,
with per-record source/revision credits. Their licence is separate from MIT.
The generator can rebuild from explicitly pinned Wiki API responses; run
`node scripts/fetch-open-f2p-wiki.mjs --batch` then `node scripts/build-open-f2p.mjs`.
Scripts that read the Wiki go through `scripts/lib/rs-wiki-client.mjs`, which
follows the Wiki's [API etiquette](https://runescape.wiki/w/Help:APIs): one
request at a time, a second apart, with maxlag, backoff and an identifying agent.
A script that calls `fetch` directly runs with
`node --import ./scripts/lib/rs-wiki-preload.mjs <script>` to get the same client.
An optional local-cache rebuild test skips when that cache is absent; synthetic
offline generator checks still run.

RuneScape is a Jagex trademark. This project is unofficial and non-commercial.
See [third-party notices](THIRD_PARTY_NOTICES.md).
