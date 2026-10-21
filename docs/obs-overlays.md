# OBS overlays

Admins open **Admin → OBS overlays**, choose a widget, players, layout and text size,
then **Create overlay link → Copy link**. Paste the link into an OBS browser
source. The page background is transparent; pale text has a dark outline and
shadow. The new link stays masked on screen, including when stream-safe mode is
off. Closing the panel clears its copyable secret. To replace a lost link, create
a new one and revoke the old one under **Saved links**.

Three pages are available:

- **Active goals:** choose **Personal pins**, **Group goals**, or **Both** under
  **Show goals**. Personal pins are unfinished pinned tasks, grouped by player.
  Group goals show the duo's open plans in saved order, with read-only ticks for
  each-player goals. Done goals are hidden. Group goals always include both
  players; **Players** chooses whose personal pins appear when showing Both.
  Journal text, task notes, linked task/item details and unpinned tasks are excluded.
- **Last roll:** the latest active saved roll for the chosen player or duo;
  an outstanding choice is labelled **Choose your chunk**. Undone rolls are
  excluded. No History attribution, timestamps or private roll details are sent.
  Older rolls are looked up in archived History when needed. Imported saves
  without recorded rolls show the empty state until a roll is saved here.
- **Chunk count:** distinct unlocked surface chunks divided by all surface chunks
  in the picker. The duo count uses the union, so shared chunks count once.

The routes are `/overlay/goals`, `/overlay/roll` and `/overlay/count`. URL options
are `player=duo` or a saved player ID, `variant=full|compact`, and
`size=small|medium|large`. Active goals also accepts
`goals=personal|group|both`, defaulting to personal pins for existing links.
Group-only links use `player=duo`. Compact uses tighter spacing; all the same
goals remain visible. Player, widget and goal source are bound to the credential;
changing any requires a new link. Layout and text size may be changed in OBS
without replacing it.
Suggested browser-source dimensions are 600 × 360, 600 × 180 and 460 × 120,
respectively; enlarge the goals source for longer lists.

## Existing access and updates

The private administrator token authenticates through a bearer header or the
legacy cookie only on trusted private connections. `/join/<token>` exchanges an
invitation or administrator link for an opaque `duo_access` HttpOnly session
cookie, then redirects to `/`. Invitation tokens themselves are not API bearer
credentials. Invitation and session secrets are stored as hashes, and revoking
an invitation removes its sessions. `/api/session` tells the app its label,
administrator status, write capability and linked player. Viewer invitations can
read the picker state and other ordinary read APIs, so they grant more access than
an overlay needs.

The normal app uses `/api/events` server-sent events for revisions, worker status
and calculated results. `screen-live.mjs` reloads the relevant state after a
revision. Group-goal edits, ticks, reordering, removal and Undo use that same
revision mechanism. Overlays subscribe to the committed-store notification through a
separate `/overlay/events` stream that sends only revisions. They load the small
`/overlay/data` projection when needed, with no task calculation or regular save
poll. Streams send a 20-second heartbeat. Connection failures reconnect with
exponential delay from two seconds to one minute, plus small jitter; fetches
have a deadline and a stalled stream reconnects. Revocation ends open streams
and the next authenticated read clears the displayed overlay.

Archive searches process at most ten pages of 100 map changes per read, retaining
only roll records. A deeper search resumes on the next reconnect. Finished roll
projections stay cached through unrelated changes. An intervening save or
revocation is checked again before any asynchronous response; a conflict returns
only a small retry message.

## Overlay access boundary

Overlay links use an independent random credential in the URL fragment. The
fragment never reaches the HTTP request URL or server request logs. The page
keeps the credential in memory and sends it as a bearer header only to the two
overlay read routes, without browser cookies. It cannot authenticate any normal
picker API, establish a picker session, read the full save, or write commands.
Only the three shells and their exact CSS/module paths are public; they contain
no save data. Every projection and stream checks the widget/player scope and
current revocation state. All responses retain the strict picker CSP and private
no-store policy.

`GET /api/overlays`, `POST /api/overlays` and
`POST /api/overlays/:id/revoke` require administrator authentication. Creation and
revocation also use the normal mutation-origin checks and serialized queue, with
authentication checked again before the change. Only creation returns the secret.
Listings expose metadata only. SHA-256 credential hashes and revocations live in
`overlays.json` beside `invites.json`, under the save directory's exclusive lock.
This access sidecar is outside gameplay revisions, History, Undo and gameplay
backups; keep it with the private data directory for server recovery.

The goals projection selects personal pins and shared plans separately. A group
row sends only its display label, plus player display names and boolean ticks
when completion is per player. Group-only payloads omit personal pins. Goal IDs,
completion-mode fields, saved references and History do not cross this boundary.
Calculation snapshots omit shared goals; the overlay reads only their existing
saved JSON field before parsing, without cloning the full save or Undo graphs.
Public HTTPS/OBS reachability still depends on the operator's existing picker
hosting setup; local screenshots do not establish external connectivity.

## Verification — 2026-10-13

`test:quick` passed 1,066 tests. The one locked full run covered 3,730 tests:
3,728 passed, one generated-map-asset fixture skipped, and one simulated startup
fixture lacked the new panel factory. That fixture was fixed; the affected browser,
startup, route, model and panel files then passed all 282 targeted tests. The full
suite was not repeated.

The final locked browser session used port 9201 and a disposable save copy, with
four sample pins staged through commands and the save's existing last roll.
It verified live command updates, revocation, transparent backgrounds, masked
links and a personal compact/large variant without runtime or CSP errors.
Nine screenshots and their sizes are listed in
`../.local/screens/overlay-acceptance.json`: all three widgets on dark/light
backgrounds, the panel at 1440 px, and two panel positions at 390 px. The browser,
server and save copy were removed afterward. OBS itself was not launched.

### Shared-goal follow-up — 2026-10-13

The focused overlay model, panel, client and route tests passed all 40 tests.
The final quick suite passed 1,124 tests. Coverage includes exact payload fields,
source-scoped credentials, legacy personal links, validation, cache separation,
revision-only events, live edits and ticks, Done hiding, removal and Undo.
The existing classified test files were extended; no new test files were added.
The single final locked full run passed 3,794 of 3,795 tests, with zero failures
and one skipped fixture. It ran after browser/server/copy cleanup under the same
lock; the complete output is in `../.local/ovgoals-full.log`.

One successful locked browser session used a disposable duo-save copy on port
9221 and an owned headless Chrome on port 9223. Three sample group goals and two
personal pins showed the Group goals and Both choices over dark and light test
backgrounds. The panel was captured at 1440 × 900 and 390 × 844. It verified
masked link creation, the Players control, phone bounds, transparent page styles,
live edits, Done hiding and Undo, with no browser exceptions or CSP errors.
All six screenshots and checks are listed in
`../.local/screens/ovgoals-acceptance.json`. The browser, server and save copy were
removed, and the original save hash matched. OBS and public hosting were not tested.
