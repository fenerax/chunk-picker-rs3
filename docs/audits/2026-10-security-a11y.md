# Security and accessibility review: public core, 2026-10

This was a read-only review of the public core at commit `535ffe4`. No app code
was changed. Line numbers refer to that commit.

**Method**
- **Code reading:** the server, storage, integrations and browser client.
- **Live checks:** the `open-f2p` dataset, started with the public launcher on a
  port in the 8900–8999 range against a fresh synthetic save. Tests used:
  - curl requests as the master, a player invite and a view-only invite;
  - headless Chromium (Playwright) for focus order, dialogs, names, contrast,
    touch targets and viewer controls;
  - small Node scripts that import the storage modules directly.
- **Environment caveat:** the container only had Node 22, not Node 24. Everything
  started and behaved normally on 22.

**Severity**
- **High:** a remote party can crash the server or lose data, or a core task is
  blocked for a disability group.
- **Medium:** a real exposure or barrier that needs some precondition.
- **Low:** defence in depth, polish or limited reach.

Under "Reachable by" below:
- *player* means any invite that can write.
- *viewer* means a view-only link.

---

## Fix now

### Security

#### S1. High: a small gzip upload from any player invite exhausts server memory

- **Location:**
  - `app/server.mjs:1581` reads the upload before the ownership check at `app/server.mjs:1836`.
  - Limits: `app/backup-transfer.mjs:9` and `app/backup-transfer.mjs:39-41`, plus `app/storage/json-stream.mjs:27-30`.
- **Reachable by:** player.
- **Cause:** `/api/member-restore` and `/api/member-restore/preview` only need `write` permission. Both are import routes, so the body is decompressed and parsed in full (up to 256 MiB) *before* the "own player only" check runs. The stream parser caps depth but not the number of values.
- **Scenario:** a player invite, even one with no assigned player, posts a gzip body of `[[],[],[],…]`.
- **Measured live:**
  - A 96 KiB upload (96 MiB decompressed) took the server's resident memory from 230 MB to 2.2 GB and held the import slot for 32 s.
  - The 256 MiB cap allows about 2.7× more. On a typical home PC that is past V8's default heap, so the process dies with "heap out of memory".
  - Viewer requests stayed responsive during the parse, because the parser yields, so the risk is the memory, not CPU lockup.
  - I did not run the full 256 MiB case to the crash.
- **Fix sketch:**
  1. Run the player/admin ownership check before reading the body. The `memberId` can come from the `x-rs3-import` header that the upload already sends.
  2. Give member restore a much smaller decompressed limit, since one map is small (for example 16 MiB).
  3. Add a `maxValues` counter to `parseJSONStream` (for example 2 million values) and reject when it is exceeded.

#### S2. Medium: error responses reveal the absolute install path to any viewer

- **Location:**
  - `app/server.mjs:264-270` (`containedFile` calls `realpath`).
  - `app/server.mjs:2051-2053` (an `ENOENT` becomes a 404 that carries `error.message`).
  - Allow-list entries for files missing from the repo: `/core/tasks.mjs` (`app/server.mjs:1985`) and `/tasks/gameplay-facts.mjs` (`app/server.mjs:1970`).
  - The `resources/` fallback for the font at `app/server.mjs:2024`.
- **Reachable by:** viewer (any signed-in link).
- **Measured live:** requesting `/core/tasks.mjs` returned `{"message":"ENOENT: no such file or directory, realpath '<absolute install path>/app/core/tasks.mjs'"}`.
- **Scenario:** on the Windows host that path contains the account name (`C:\Users\<name>\…`). A stream viewer opening a stale route sees it, which is a private name crossing the public boundary.
- **Fix sketch:**
  - For any error with a system `code` (`ENOENT`, `EACCES`, …), send the fixed text "Not found." or a generic message, never `error.message`.
  - Remove the dead allow-list entries.
  - Add a test that requests every allow-listed static route and expects 200.

#### S3. Medium: player invites can grow the save without bound

- **Location:**
  - `MAX_BODY` at `app/server.mjs:98` (32 MiB for `/api/command`).
  - No length or count caps on these fields:

    | Command | Field | Location |
    |---|---|---|
    | `set-note` | note text | `app/core/state.mjs:1628` |
    | `set-task-status` | `note` | `app/core/state.mjs:1705` |
    | `set-teleport` | label and count | `app/core/state.mjs:1593-1598` |
    | `add-task` | label and count | `app/core/state.mjs:1635-1641` |
    | `set-area` | any string `areaId` | `app/core/state.mjs:1891` |
    | `set-source-backlog` | name | `app/core/state.mjs:1883` |
    | stickers | text | `app/core/map-markers.mjs:26` |
    | `set-slayer-lock` | text | `app/core/player-controls.mjs:18` |

  - Backups are kept for 90 days (`app/storage/store.mjs:699`), with one per command (`app/storage/store.mjs:877`).
- **Reachable by:** player. Signed-in users have no request rate limit.
- **Measured** (with a direct storage script):
  - A 4 MiB note adds about 12 MiB to the save, because the command and its undo each keep a copy.
  - After one 2 MiB teleport label, every further teleport change adds about 4 MiB, because undo stores the whole list before and after.
  - Ten small journal edits after a 1 MiB note left 19.8 MiB of backups.
  - Live, a 31 MiB `/api/command` body was read and parsed in full before an unknown-field error.
- **End states:**
  - The home PC's disk fills.
  - Past 256 MiB, `/api/backup` refuses to export (`app/backup-transfer.mjs:90`).
  - Near V8's string limit, save writes would fail. I did not test this.
- **Fix sketch:**
  - Cap each text field: notes at 10k characters like the journal; labels, names and sticker text at about 200.
  - Check `areaId` against the world.
  - Cap teleports, custom tasks and source backlogs per player.
  - Drop the `/api/command` body limit to about 64 KiB.
  - Refuse a commit that would push the serialized save past a total budget.

#### S4. Medium (deployment): any loopback proxy is trusted as "private"

- **Location:** `app/security/request.mjs:40-52`.
- **Cause:** a loopback peer is a trusted proxy. With no forwarding headers, the client address is the peer itself, which counts as private, so `masterAllowed` is true.
- **Scenario (proxy sends no client address):** someone exposes the picker through nginx (whose default `proxy_pass` sends no `X-Forwarded-For`), cloudflared or a similar tunnel instead of Tailscale Funnel. Then every internet client:
  1. is treated as local, so the master token works from anywhere;
  2. shares one rate-limit key, so ten bad invite attempts lock everyone out of joining for 15 minutes (`app/security/request.mjs:67-97`).
- **Scenario (proxy passes the client's header through):** a proxy that forwards the client's own `X-Forwarded-For` lets an attacker send `X-Forwarded-For: 127.0.0.1` and look local.
- **Why this matters now:** this is safe for the intended Funnel setup, but likely for other people who self-host after the open-source release.
- **Fix sketch:**
  - Treat a loopback peer as a proxy only when the operator opts in, for example with a `trustProxy` option or env flag.
  - On the dedicated Funnel loopback listener (`loopbackPort`), treat every request as public.
  - Say in the README which front doors are supported.

#### S5. Medium: any admin invite can read the master link, and it cannot be revoked

- **Location:** `app/server.mjs:1191` (`/api/admin/master-link` only needs `requireAdmin()`). The token is created once at `app/storage/store.mjs:780-785` and never rotated.
- **Reachable by:** admin invite.
- **Scenario:**
  1. An admin invite is issued to a second device or person.
  2. That holder fetches the master link.
  3. The admin invite is later revoked.
  4. The master token still works from loopback or the tailnet, and there is no rotation control.
- **Fix sketch:**
  - Return the master link only when `identity.kind === 'master'`.
  - Add an admin action that rotates `access-token` and ends master sessions.

### Accessibility

#### A1. High: roll results are not announced to screen-reader users

- **Location:** `app/web/screen-roll.mjs:52-73` (`presentRoll`) and `app/web/screen-roll.mjs:5-12` (`renderRollControls`).
- **Cause:**
  - The `role=status` section only exists when the cinematic roll is on.
  - It is inserted already filled, which is often not announced, and removed after 800 ms.
  - With reduced motion it is removed at once.
  - With the cinematic roll off, nothing names the new chunk.
  - Disabling the focused Roll button while busy drops focus to `<body>`.
- **Impact:** the core action of the app gives a blind player no result and loses their place.
- **Fix sketch:**
  - Always write "Rolled <chunk> for <player>" into a persistent live region (`#notice` or a dedicated sr-only status).
  - Use `aria-disabled` during the roll, or restore focus to Roll afterwards.

#### A2. High: error and danger text is unreadable in light themes

- **Location:** `--danger` is set once in `app/web/style.css:200`. Neither the light-scheme block (`app/web/style.css:205`) nor `applyTheme` (`app/web/map-tools.mjs:52-71`) overrides it.
- **Measured live** (`--danger` on `--panel`):
  - light: 1.84:1
  - winter: 1.56:1
  - autumn: 2.86:1
- **Impact:** errors and the destructive "Untick" confirmation are hard to read. Uses include `completed-view.css:32`, `completed-view.css:58`, `task-ui.css:37`, `helper.css:46` and `sandbox.css:8`.
- **Fix sketch:** derive `--danger` in `applyTheme` with the existing `readableColorAgainst(…, [panel, surface], 4.5)` pattern. `teleports.css:16` already does this.

#### A3. High: a keyboard user cannot pick a chunk on the map

- **Location:**
  - `app/web/map.mjs:744-767`: arrows pan and +/− zoom, but Enter and the context-menu key act on `hoverId`, which only pointer movement sets (`app/web/map.mjs:663`, `app/web/map.mjs:770`).
  - The Help text at `app/web/screen-map.mjs:13` lists only mouse gestures.
- **Measured live:** with the canvas focused, Enter, Space and arrows opened nothing.
- **Workaround that exists:** Search → Chunks lists every chunk, and the canvas label points to it. Without that this would be a blocker.
- **Fix sketch:**
  - On focus, place a keyboard cursor on the centre chunk. Arrows move the cursor, Shift+arrows pan, and a drawn focus box shows the cursor.
  - Enter opens chunk info; Shift+F10 or the context-menu key opens the chunk menu.
  - Announce "<name>, <status>, N tasks" in a polite live region.
  - Use `role="application"` with `aria-roledescription="map"` instead of `role="img"`.
  - List the keys in Help.

#### A4. Medium: gold and ok accents fail in the winter and autumn themes

- **Location:** fixed per scheme in `app/web/style.css:201` and `app/web/style.css:205`, not derived per theme.
- **Measured live:**

  | Token | Theme | Against | Ratio |
  |---|---|---|---|
  | gold | autumn | panel | 2.52 |
  | gold | winter | bg | 2.78 |
  | gold | winter | panel | 3.86 |
  | gold | light | bg | 3.91 |
  | ok | autumn | panel | 2.88 |
  | ok | winter | panel | 3.98 |

- **Also:** the `.invite-*` text in `app/web/style.css:590-594` uses raw `--muted` (autumn 2.83).
- **Fix sketch:** derive `--gold`, `--ok` and `--danger` in `applyTheme` the same way text, muted and link already are. Use `--panel-muted` in dialogs.

#### A5. Medium: text field borders are below 3:1 in every theme

- **Location:** `app/web/style.css:214`.
- **Measured live** (border against field fill):
  - dark 1.57
  - light 1.31
  - gray 1.99
  - winter 1.17
  - autumn 1.10
  - voyage 2.08
- **Impact:** low-vision users cannot find the search and filter fields (WCAG 1.4.11).
- **Fix sketch:** add a derived `--control-border` token at 3:1 or more.

#### A6. Medium: opening chunk info does not move focus

- **Location:**
  - `app/web/screen-chunks.mjs:89-102` (`showChunk` unhides the panel silently).
  - From Search, `app/web/screen-search.mjs:43-47` closes the dialog, and `app/web/screen-dialogs.mjs:11-20` then returns focus to the Search button.
- **Impact:** a screen-reader user hears nothing, and a keyboard user has to tab past the whole toolbar.
- **Fix sketch:** give `#chunk-title` `tabindex=-1` and focus it when the panel opens from the keyboard or Search. Skip the opener restore on that path.

#### A7. Medium: repeated buttons have identical names

- **Location:**
  - Every Search result is "View" (`app/web/screen-search.mjs:84`).
  - Duo rows have "Backlog…"/"Restore…" (`app/web/duo-task-view.mjs:96`).
  - Chunk contents rows have "Backlog source", "Use source" and "View" (`app/web/screen-chunks.mjs:368-369`).
- **Impact:** a screen-reader list of buttons shows dozens of identical entries.
- **Fix sketch:** add an `aria-label` such as `View ${label}`. Single-player rows already do this (`app/web/screen-tasks.mjs:69`, `app/web/screen-tasks.mjs:90-91`).

---

## Later

### Security

- **S6. Medium: viewers can run expensive reads with no limit.**
  - **Where:**
    - `/api/roll-stats` (`app/server.mjs:1227`) and filtered `/api/history` (`app/server.mjs:1240`) decompress and scan every history archive (`app/storage/store.mjs:977-1043`).
    - `/api/history/<large id>` scans every archive before it 404s.
    - Bare `/api/history`, `/api/xp-choices` and `/api/migration` `structuredClone` the whole save.
  - **Scenario:** a viewer link loops these requests, and latency rises for everyone on a long-running save.
  - **Datasets with more features:** `/api/area-check` and `/api/helper-drops` are `read` routes that queue worker jobs, but `open-f2p` answers both with 422 (checked live). They matter only for datasets that enable those features.
  - **Fix sketch:**
    - Cache roll-stats per revision.
    - 404 straight away above the current revision.
    - Run one history scan at a time.
    - Add a light per-identity limit for signed-in requests.
- **S7. Low: unknown POST routes read the whole body before refusing.**
  - **Where:** `requirePermission` (`app/server.mjs:1147-1151`) does nothing when the permission is `undefined`, so `/api/<unknown>` reads up to 32 MiB.
  - **Measured live:** about 1.1 s, then 404.
  - The comment at `app/server.mjs:104-105` says unknown writes are refused first.
  - **Fix sketch:** throw 404 when `apiPermission` returns `undefined`, before any body is read.
- **S8. Low: connection limits are Node's defaults.**
  - **Where:** `app/server.mjs:2086-2088` leaves `headersTimeout` at 60 s, `requestTimeout` at 300 s and `maxConnections` unlimited.
  - SSE streams (`app/server.mjs:1562-1573`, `app/overlays.mjs:269-276`) are unlimited per identity or overlay link.
  - Unauthenticated bodies are refused before reading, but slow headers can hold sockets for 60 s each.
  - **Fix sketch:** set `headersTimeout` to about 15 s and set `maxConnections`. Cap SSE at about 4 per identity or overlay link, closing the oldest.
- **S9. Low: RuneMetrics has no global outbound throttle.**
  - **Where:** `app/integrations/runemetrics.mjs:133-169`.
  - Failures are not cached, so a player can loop preview against a private profile and get the home IP rate-limited upstream.
  - The body is read in full before its 1 MB check (`app/integrations/runemetrics.mjs:123-124`).
  - **SSRF:** none. The host is constant, the name is validated to `[A-Za-z0-9 _-]{1,12}`, and redirects are refused.
  - **Fix sketch:** one fetch every 10 s globally, cache failures for a few minutes, honour 429, and cap the streamed body in bytes.
- **S10. Low: rate limits key on the full IPv6 address and share one overflow bucket.**
  - **Where:** `app/security/request.mjs:73-83`.
  - **Scenario:** a client rotating addresses in its /64 fills the 10,000-key table. New legitimate clients then share the `overflow` bucket, which that client can exhaust.
  - **Fix sketch:** key IPv6 by /64, and give overflow its own stricter handling.
- **S11. Low: login CSRF on the invite join route.**
  - **Where:** `app/server.mjs:1121-1130` joins on a GET with a `SameSite=Lax` cookie.
  - **Scenario:** a cross-site link can sign a visitor into an attacker's invite.
  - **Fix sketch:** have the GET show a confirm page that POSTs, with an Origin check.
- **S12. Low: some command IDs are loosely validated.**
  - `add-task` accepts any ID, including real catalogue IDs and `__proto__`, and a non-`custom:` row can then never be edited (`app/core/state.mjs:1635-1641`, `app/core/state.mjs:208-231`).
  - `set-area` with `__proto__` is accepted as a no-op that still writes history (`app/core/state.mjs:1891-1895`).
  - Admin-imported backups keep own `__proto__` keys in `provenance`, `legacy` and `history[].command`.
  - `Object.prototype` stayed clean in every probe. The stream parser uses `defineProperty`, and gameplay keys go through `propertyKey`.
  - **Fix sketch:**
    - Require the `custom:` prefix on `add-task` IDs.
    - Run `propertyKey` on all IDs.
    - Reject unsafe keys in `assertJson` (`app/core/state.mjs:593`).
    - Reject `provenance.historyArchive` on public import.
- **S13. Low (admin only): each restore copies all earlier history into the live save.**
  - **Where:** `app/storage/store.mjs:944-953`.
  - **Fix sketch:** keep it as an archive reference.
- **S14. Info: hardening left to do.**
  - The public launcher clears `RS3_*` overrides but not `RS3_WORKER_MEMORY_PROBE_IMPORT`, which adds `--import` to the worker (`scripts/start-independent-game.mjs:21-23`, `app/tasks/process-worker.mjs:19`).
  - The CSP (`app/server.mjs:1103`) has no `form-action 'self'`.
  - There is no Host-header allow-list as a second layer against DNS rebinding. Cookies already stop rebinding from reaching signed-in routes.
  - A `backup` sent as a JSON string skips the stream parser's limits (`app/server.mjs:620`).

### Accessibility

- **A8. Medium: buttons sit inside `<summary>`.**
  - **Where:** `#completed-review` at `app/web/index.html:208`, `app/web/screen-backlog.mjs:111-126` and `app/web/duo-backlog-view.mjs:113`.
  - Assistive technology may flatten or skip the nested control.
  - **Fix sketch:** move these controls beside the `<details>`.
- **A9. Medium: the task hover card closes when the pointer leaves the row.**
  - **Where:** `app/web/task-hover.mjs:107`.
  - The card cannot be hovered to read or scroll it (WCAG 1.4.13).
  - **Fix sketch:** keep it open while the pointer is over the row or the card.
- **A10. Low: focus falls back to the map when the opener is re-rendered.**
  - **Seen live:** opening Backup & Import from the "Review backups" banner, then pressing Esc, put focus on the map canvas. The banner's button is replaced while the dialog is open (`app/web/backup-status.mjs:48`), so `restoreDialogFocus` (`app/web/screen-dialogs.mjs:11-20`) uses its fallback.
  - **Fix sketch:** give the banner a stable button and update its text instead of replacing it.
- **A11. Low: smaller items.**
  - Pending and hand-added pool chunks differ mostly by hue, at 1.32:1 (`app/web/map.mjs:1003-1016`).
  - `#roll-two` is labelled "Roll two choices" but shows "Roll 2 choices" (`app/web/screen-roll.mjs:10-12`, WCAG 2.5.3).
  - There is no skip link.
  - The helper page has a second `<h1>`.
  - Chunk info jumps from h2 to h4.
  - Errors use `role=status`, not `alert` (`app/web/screen-ui.mjs:28`).
  - The chunk menu has a `<p>` inside `role=menu` (`app/web/screen-chunks.mjs:198`).
  - Smooth scrolling ignores reduced motion (`app/web/rules-panel.mjs:69`).
  - The OBS overlay makes the whole `<main>` an atomic live region.
- **A12. Low: some desktop targets are small.**
  - **Measured live:** the group-view switch is 29×16 px at desktop width, and sticker colour dots are 20 px.
  - On phones (390 px, coarse pointer) there were 0 controls under 24 px and 1 of 12 under 44 px, thanks to `app/web/phone-layout.css:66-90`.

---

## Reviewed and fine

### Viewer refusal (all checked live)
- Every POST, PUT, PATCH and DELETE to every API route, including unknown ones, was refused with 403.
- Every `write` or `admin` GET (backups, invites, master link, predictions, teleports, training plan, usage, overlays) was refused.
- The viewer page showed no Roll, Undo, import or restore controls and sent no non-GET requests.
- The one viewer POST exception, `/api/usage`, is rate limited.

### Authentication
- **Tokens:** invite and session tokens are 256-bit and stored only as SHA-256 hashes. Comparisons are timing-safe.
- **Join:** the token syntax is checked before hashing, and joins are rate limited.
- **Sessions:** 30-day sessions, at most 32 per link. Revoking a link ends its sessions and live SSE streams.
- **Re-checks:** credentials are checked again after slow bodies and before delayed results are released.
- **Master token:** refused through Funnel, even when the funnel marker is spoofed.

### Headers
- The CSP is strict (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`).
- Also set: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS when secure, and `no-store` on API responses.
- The gallery preview relaxes framing only to `'self'`.

### Cross-site requests
- Mutations need an Origin that matches. Public requests must carry it, and `Sec-Fetch-Site: cross-site` is refused.

### Static serving
- An exact allow-list plus `realpath` containment.
- `..`, `.`, backslash and NUL are refused after decoding. Encoded traversal returned 404 live.
- Art packs refuse symlinks and junctions segment by segment (`lstat`), drive letters, alternate data streams and reserved device names. Their bytes are pinned by SHA-256.

### Commands
- Every command type has a field allow-list, and raw review-only commands are blocked at the server.
- The revision check is atomic: five concurrent commands on one revision gave 1 success and 4 conflicts.
- History is trimmed at 2,000 events, then archived.

### Backups
- Gzip size is capped and the stream is cut at 256 MiB. Retained-backup and archive IDs are pattern-checked and contained.
- `restore-picker` creates its folder exclusively and refuses symlinked parents.
- Backups do not contain the access token.

### Secrets and logging
- No access logs. The server prints only an origin and redacted errors.
- Invite paths are redacted from error messages, feedback and labels.

### Accessibility basics
- `lang`, titles and a zoomable viewport are set.
- A global `:focus-visible` ring is at least 3:1 in all ten themes. Every stop in a 45-key Tab walk showed a ring.
- Body text, muted text and links are at least 4.5:1 in all ten themes. The live scan found no failing visible text in dark, gray or light.
- The main dialog is a native modal `<dialog>` with a name, Esc closes it and focus returns. Search is deliberately modeless and returns focus on Esc.
- The chunk colour picker, chunk menu, tabs and other panels handle focus and Esc.
- Icon-only buttons have labels. No control without an accessible name was found live.
- Task-row checkboxes name the task and player.
- Map alternatives exist through Search → Chunks and the icon list.
- Reduced motion turns off the dialog and roll animations. The remaining transitions are 0.12 s colour fades.

## Not checked

- **Node 24:** not available here. Everything ran on Node 22.22.
- **Windows-only behaviour:** case folding, junctions and the exact path text in S2 were reviewed from the code only.
- **Screen readers:** no NVDA, JAWS or VoiceOver run. Names and live regions were checked through the DOM and code.
- **S1 crash:** the full 256 MiB case was not run to the crash. The outcome is extrapolated from the 96 MiB measurement.
- **Tailscale Funnel:** front-door behaviour was reasoned from the code, not exercised.
- **Disabled features:** routes turned off in `open-f2p` (original-picker sync, area check, helper drops, gallery data) were reviewed from the code only.
- **Contrast scope:** the live contrast scan covered the screens reachable in a fresh save. Token-level ratios were computed for all ten themes.
