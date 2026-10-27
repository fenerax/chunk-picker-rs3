# Sharing the picker

Player 1 can keep using the original private master link. Player 2 can use a separate revocable invitation over Tailscale Funnel without installing Tailscale. Both connections use the same desktop server and gameplay store; the desktop must stay awake.

## Create and revoke invitations

[Stream-safe mode and feedback](stream-safe.md) explains masking private links,
the owner's unread feedback count, and authors' handled notes.

Open the private master link, then **Admin → Invite links**. Create an invitation labelled `Player 2`, choosing **Player**. Copy the generated link and send it privately. The full token is shown when created; the invitation list retains its label and status, not a recoverable token. Create a replacement if the link is lost. Last used updates on joining and at most once per minute during session activity.

A player invitation grants editing access to both maps. Link it to its intended player using **Player** in the invite list. A fresh browser opens that player's map; a valid map selection remembered by that browser takes precedence. Invitations without a linked player and the private master link keep the first-player default. Selecting a map changes the gameplay view, not the invitation's permissions. Administrator invitations can also create, list and revoke invitations and retrieve the private master link, but administrator access is private only. The public interface does not offer the Admin controls.

Choose **View only** for someone who wants to watch. A viewer can see both maps, task lists, notes, History and existing Helper information, including live updates. They cannot roll, unlock, tick tasks, edit notes, change rules or settings, pin tasks, undo, import or restore maps, use backups, send feedback, sync RuneMetrics or manage invitations. A **View only** badge stays in the top bar. Theme, chunk IDs and the chosen map are remembered only in that viewer's browser.

Viewer links use the same public HTTPS origin and revocation flow as player links. They have no linked player and cannot also be administrator links. Anyone holding a viewer link can see the duo's gameplay and notes; it is a sharing link, not a stream-safe filter. Keep the full link private. Revoke it from **Admin → Invite links** to immediately close its open sessions.

Viewers read task results already loaded by a player. They cannot wake a sleeping task calculator, request a fresh task calculation or start predictions. If no current list has been loaded yet, the page explains that it is waiting for a player to load it; live updates show it when available. This keeps spectators from adding calculation work on Player 1's desktop.

Both players' saved lists and previously opened details remain readable while the calculator sleeps. Compact lists have a 32 MiB budget; compressed full details have a separate 16 MiB budget, so large details cannot evict the other map's list. Display-only player changes keep those results; gameplay changes wait for a player to load the new list.

Revoking an invitation immediately invalidates its existing sessions as well as its join link. A browser already open under that invitation cannot continue saving. Create a new invitation to restore access.

History uses the invitation label for convenient attribution. Anyone holding the link can act under that label; it is not proof that Player 2 or Player 1 personally made an edit. Keep invitation links private.

The session API exposes the same safe actor identity used in History: master access has `kind` and `label`; invite access also has a stable `inviteId` and, when linked, `memberId`. It excludes credentials and remains the same when a browser rejoins that invitation. Linked player attribution is saved with each new event, so changing the link's player later does not change old History entries.

## Seeing each other's changes

Partner saves appear as brief notices with an **Open History** link. On returning to the picker, **Since you were last here** shows up to five recent summaries of the other player's changes. Consecutive task ticks close together share a summary. The browser remembers the last revision it saw for this player or invitation; a first visit has no catch-up list. These notices use the most recent 100 partner changes in retained History, so a long absence can exceed their coverage. Open History for more detail.

**Undo** names the latest reversible change and who made it. Undoing another player's change asks for confirmation and names the action. When your latest change differs, **Undo my last change** is available only when it can be reversed safely without changing later work. If later work depends on it, the undo review explains why it is unavailable. A newer save makes an older undo review stale; review the refreshed action before continuing. These controls change neither ownership nor the invitation's editing permissions.

Older own Undo searches active History. Archived changes remain in full backups.

## Enable public HTTPS with Funnel

These are operator instructions. The picker does not change Tailscale settings or enable Funnel automatically.

1. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), enable MagicDNS and HTTPS certificates. In Access controls, grant the `funnel` node attribute to this desktop only. Use a dedicated tag such as `tag:rs3-picker`, with an appropriate `tagOwners` entry, assigned only to this machine. Avoid the default grant to every tailnet member:

   ```json
   "nodeAttrs": [
     { "target": ["tag:rs3-picker"], "attr": ["funnel"] }
   ]
   ```

   Merge this entry into the existing policy. See [Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel) and the [tailnet policy reference](https://tailscale.com/docs/reference/syntax/policy-file).

2. Replace `<tailnet>` with the desktop's actual tailnet DNS domain. Set the public origin in the PowerShell environment used to launch the picker, then restart the configured picker so its child process inherits it:

   ```powershell
   $env:RS3_PUBLIC_ORIGIN = 'https://<computer>.<tailnet>.ts.net'
   $env:RS3_LOOPBACK_ROLE = 'public'
   ./scripts/Stop-Picker.ps1
   ./scripts/Start-Picker.ps1 -HostAddress <tailscale-ip>
   ```

   Alternatively, put the origin on the first line of `.local/public-origin`; `Start-Picker.ps1` reads it when the variable is unset, so later restarts keep it. The origin is an HTTPS origin without a path. Use the same environment for later launches. Running Start while the old process remains alive reuses it and does not reload environment variables.

3. On the desktop, enable the proxy:

   ```powershell
   tailscale funnel --bg http://127.0.0.1:8789
   ```

   Funnel can only reach a loopback address on Windows (proxying to `<tailscale-ip>:8788` returns 502 after a timeout). With a public origin configured, `Start-Picker.ps1` sets `RS3_LOOPBACK_PORT` to the picker port plus one, so the picker also listens on `127.0.0.1:8789`; the Tailscale address keeps working for private links. Set `RS3_LOOPBACK_ROLE=public` for the Funnel listener; the programmatic `createServer` option is `loopbackRole: 'public'`. The primary listener's `ingressRole` option defaults to `private`. Use the private listener for administration and master credentials.

   The public URL is `https://<computer>.<tailnet>.ts.net`. The [Funnel CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel) explains background persistence and disabling a configured Funnel. Stopping the picker does not remove Funnel configuration.

4. Create Player 2's invitation after configuring the public origin. Test the link in a fresh browser on a connection outside the tailnet, check that it opens the correct shared state, then revoke a temporary invitation and confirm its open browser loses access. Automated local tests do not establish internet reachability.

Funnel terminates HTTPS on this desktop and forwards HTTP to the picker's loopback listener. Checked 2026-10-08: proxying to the desktop's own Tailscale address timed out with 502, so use the loopback target.

## Listener roles and reverse proxies

The default role is `private` for both listeners, preserving existing deployments
until the operator opts in. Set `RS3_LOOPBACK_PORT=8789` and
`RS3_LOOPBACK_ROLE=public` for the local Funnel or Caddy target, then restart.
The primary listener stays private. Programmatic options are `ingressRole` and
`loopbackRole`, each accepting only `private` or `public`.

A public listener is always public, including while startup is warming. Missing,
malformed, chained or private-valued `X-Forwarded-For` cannot grant privileges.
Public Host values must match the host (and port) of `RS3_PUBLIC_ORIGIN`, or a
literal loopback IP (`127.0.0.1`, another `127/8` literal, or `[::1]`, with an
optional port). `localhost` and arbitrary domains are refused. Forwarded Host,
when accepted from the exact loopback proxy peer, must pass the same allowlist.
Forward HTTPS scheme and the public Host through the proxy for browser use.
Do not publish the private listener through that proxy.

All administrator routes require a private connection, including overlays,
invites, feedback administration, usage reads, backup status, master-link reads,
shutdown, worker restart and full-save import/restore and previews. Public
refusals return 403. `/api/session` reports `adminAvailable: false` publicly,
and the browser hides administrator controls. Existing administrator invitations
also require private ingress. Player plugin-key management remains available;
plugin bearer requests deliberately allow no Origin, including a literal loopback
Host. Scoped OBS reads and streams remain public. There is no CORS allowance.

## Credentials, sessions and recovery

Invitation tokens contain 256 random bits. Only their SHA-256 digests are stored. An invite token is accepted at `/join/<token>` to establish an opaque session; it is not an API bearer credential. Session secrets are also stored only as hashes. HTTPS sessions use `Secure`, `HttpOnly` and `SameSite=Lax` cookies. Authentication responses prevent referrer disclosure and caching; HTTPS responses include HSTS.

The original master token in `.local/duo/access-token` remains a separate private administrator credential. Keep that file and your saved master URL private. Server startup logs show only the address, without the token; invitation paths in errors and feedback are redacted. Use it through a private listener over loopback or a direct Tailscale connection (`100.64.0.0/10` or `fd7a:115c:a1e0::/48`). Public ingress rejects master links, bearer tokens and existing master cookies, as well as administrator invitations and sessions. Administration requires a private connection.

Authentication records live in `.local/duo/invites.json` beside gameplay state. Sessions expire after 30 days, with at most 32 active sessions per invitation. **Download full backup**, gameplay restore, migration, undo and reference sync exclude that sidecar and the master token. Restoring an older gameplay backup does not restore invitations or clear revocations. Keep `invites.json` and `access-token` separately when preserving server access, and retain the complete private data directory for machine recovery. Do not publish either credential file.

The server treats a public listener as public regardless of supplied headers. On a public listener, only the exact loopback proxy peers `127.0.0.1` and `::1` can supply forwarding metadata. It is used for rate-limit buckets, scheme and effective origin, never privileges. The legacy private listener trusts loopback or its exact bound Tailscale address, never every Tailscale peer. Direct peers cannot claim public proxy identity by adding forwarded headers. Any Funnel marker disables private administrator credentials, including a spoofed marker. Current [Tailscale proxy source](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go) retains the original Host, supplies the client IP in `X-Forwarded-For`, sets `X-Forwarded-Proto` for HTTPS, and replaces `Tailscale-Funnel-Request` with `?1` for Funnel. Public mutations require HTTPS and the exact configured origin. An accepted save finishes before revocation returns; later queued writes recheck authentication.

The plugin and OBS overlay endpoints use their own scoped credentials and access rules; the private-only administrator rule does not replace those rules. Keep their credentials private and use only the access each integration needs.

Failed joins are limited to 10 per client in 15 minutes; unauthenticated requests are limited to 60 per client per minute. Client addresses come from trusted proxy metadata only when the connection is from the local proxy. Limits reset on server restart.

## Authentication API

| Route | Access and purpose |
| --- | --- |
| `GET /api/session` | Current session label, administrator and write capabilities, read-only status, linked `memberId` (or `null`), and History-compatible `actor`. |
| `GET /api/coordination` | Recent safe History metadata, current revision, and exact latest-change / own-change undo eligibility. Private, never cached. |
| `GET /api/tasks` | Players may load tasks; viewers may only read retained results. Unavailable current results return `409` with `TASK_RESULTS_UNAVAILABLE`. |
| `GET /api/invites` | Administrator: list invitation metadata without secrets. |
| `POST /api/invites` | Administrator: create a player, administrator or viewer (`viewer: true`) invitation; returns its link once. |
| `POST /api/invites/:id/revoke` | Administrator: revoke the invitation and all its sessions. |
| `GET /api/admin/master-link` | Administrator: retrieve the private master URL. |
| `POST /api/feedback` | Player or administrator: send a bug, idea or other note (`kind`, `text`, optional small `context`). Stored in `.local/duo/feedback.json`, outside the save and History. |
| `GET /api/feedback`, `POST /api/feedback/:id/status` | Administrator: read feedback and mark it handled or reopen it. |
| `GET /api/feedback/summary`, `GET /api/feedback/own` | Player or administrator: unread summary (count for administrators only), or that player's own notes and handled status. |
| `POST /api/feedback/seen` | Player or administrator: acknowledge the displayed feedback IDs in the sidecar, outside gameplay revisions. |

Mutations require the same origin protections as gameplay commands. Player 2's normal invitation can use the gameplay APIs and download backups, but cannot manage invitations, retrieve the master link, or restore/import the whole save (`/api/restore`, `/api/import` and their previews are administrator-only). An invitation can be linked to a player (**Player** in the invite list, or `POST /api/invites/:id/player`); that link may then replace only its own player's map from a backup or retained snapshot through `/api/member-restore` (with `/preview`). This is an ordinary undoable change: the other map, shared rules and History stay. Admins can choose a single player's map too.

The server refuses every viewer write before reading its body, including every gameplay command and any unrecognized write route. Viewer access is checked again before queued work. Calculation routes also require a write-capable session unless they serve existing task results. These checks apply to private links and Funnel alike; hiding browser controls is an additional convenience. Route and command coverage tests require an explicit permission decision when a new endpoint or command is added.

Retained full task responses use a single gzip stream, or stream uncompressed bytes when requested. Their JSON keeps the revision when the details were loaded; `X-RS3-State-Revision` supplies the current matching revision after display-only changes. The browser applies that header only to successful viewer task reads. This keeps large results reusable without decompressing or recompressing them on every display change. A client accepting only Brotli and refusing gzip and uncompressed bytes receives `406` for those retained full details.

All response cache policies are private. Static and reference responses can revalidate
with representation-specific ETags; authentication and revocation checks still run
before returning a cached 200 or 304, including HEAD requests. Content-digest asset
paths may use immutable caching. Sessions, errors, joins, SSE and volatile calculation
responses use private no-store. Compact play views grant the same access as their
full routes; they do not bypass invitation or origin checks.
