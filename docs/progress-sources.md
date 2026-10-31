# Personal progress sources

In **Activity Info → Progress sync**, choose **Sync progress**. The review names
its source: **Game plugin**, **RuneMetrics**, or **RuneScape API**. Review changes,
then apply or cancel. Raw skill IDs, mapping reasons and save revision appear
only with **Settings → Advanced**. Viewers have no sync controls.

Accepted live-world plugin reports supply fresh per-field observations for ten
minutes. Position, item and achievement pings do not refresh levels or quests;
beta, unknown-world, stale and far-future reports cannot become fresh evidence.
For each skill and quest, plugin evidence wins over the web. Web fields that the
plugin has not reported can still fill gaps. Already applied `game-plugin` facts
in `skillProgress` and `questProgress` remain authoritative after restart, key
revocation or live-report expiry. They belong to the member, not a web account
name. Unapplied live reports retain the existing in-memory lifetime and review
semantics. No plugin protocol or client changes are needed.

RuneMetrics stops at **10 November 2026, 00:00 UTC**, including cached results
and requests crossing that boundary (`RUNE_METRICS_SUNSET_AT`). HTTP **404** and
**410** retire its endpoint for the server process. A JSON unknown-player error
retains its meaning. DNS/connection failures and timeouts take the unavailable
path for that request; they do not permanently retire the adapter. When closed,
Sync progress shows this one informational message, including when a fallback
review is available:

> RuneMetrics has closed; levels and quests come from the game plugin until the new Jagex API is connected

An unavailable result is HTTP 200 without an Apply token and writes nothing.
A successful fallback still requires review and Apply. Missing fields never
remove saved facts or completions. Existing successful RuneMetrics decreases
remain reviewable, except that they cannot replace stored plugin evidence.

### Operator switch

Set `RS3_RUNEMETRICS_ENABLED=0` in the server environment to disable RuneMetrics,
including its cache, without a code release. Restart the service after changing
its deployment environment. Omit the variable or set it to `1` to reenable it
before the sunset (an HTTP-retired process must restart). Tests/embedders can use
`progressSources: { runeMetricsEnabled: false }` or an injected function; the
function and environment are checked on every request.

### Levels fallback

`app/integrations/hiscores.mjs` implements the official RS3 lite endpoint:
`https://secure.runescape.com/m=hiscore/index_lite.ws?player=Player%20x`.
Its documented CSV format is overall `rank,total level,total XP`, then 29 rows
of `rank,level,XP` in the canonical skill-ID order; later activity rows are
ignored. XP is whole XP, not RuneMetrics tenths. Missing/unranked values are
skipped; valid levels/XP remain useful even without a rank. Short/malformed
responses fail without producing observations. Requests are on demand, bounded
by ten seconds and 1 MiB, with redirects disabled.

Hiscores is attempted only when the web source fails/is disabled/retired, the
replacement is unavailable, and the member has neither live nor stored plugin
levels/quests. It supplies **no quests or quest points**. It never decreases a
saved level or XP or clears a completion. A failing fallback keeps the closed
result (or the original actionable error for private/unknown/rate-limited and
other temporary web errors). The [public API format reference](https://runescape.wiki/w/Application_programming_interface#Hiscores)
and official endpoint describe the format; live shape is **unverified in this
sandbox**, whose network policy excludes the host. No live player was queried.
All tests use synthetic local fixtures and injected fetches.

## Adding the official web API

Implement the replacement in `app/integrations/official-api.mjs` and keep callers
unchanged. Its factory is already wired into the selector. The RuneMetrics
disable switch selects it before the sunset; retirement selects it automatically
afterwards. Tests may also inject a different adapter below. The selector is
`app/integrations/progress-sources.mjs`. A source implements
`async snapshot(member)` and optionally `close()`. A successful snapshot is:

```js
{
  source: 'official-api', sourceLabel: 'RuneScape API',
  fetchedAt: '2026-11-02T12:00:00.000Z', cached: false,
  skills: [{ skill: 'Mining', level: 6, xp: 550.5 }],
  quests: [{ title: 'Vampyre Slayer', status: 'COMPLETED' }],
  // Optional rows to explain missing or unrecognized skills:
  unmatchedSkills: []
}
```

XP is actual XP, never RuneMetrics tenths. Skill names are the canonical names in
`app/core/game-progress.mjs`; levels are integers from 1 to 120, XP from 0 to
200,000,000. Quest statuses are `COMPLETED`, `STARTED`, `NOT_STARTED`.
Only completed quests can add personal completions. Omitted data never removes
saved facts. `quest-mapping.mjs` owns whole-quest matching, spelling aliases and
intentional omissions for every source; do not add another title map.

For an unavailable service return:

```js
{ available: false, source: 'official-api', sourceLabel: 'RuneScape API',
  message: RUNE_METRICS_CLOSED_MESSAGE }
```

Once the contract is published, implement one adapter and configure:

```js
createServer({
  // Other existing options...
  progressSources: { webSource: 'official-api', officialApi: createOfficialWebSource() }
});
```

Fill in the documented endpoint URLs, authentication/privacy requirements,
account binding checks, skill IDs and XP units, quest status conversion, request
limits, cache policy, timeout/abort and explicit unavailable errors in that
adapter. Confirm the reply belongs to the saved account. Keep requests on demand,
bounded and server-side. Add sanitized contract fixtures and fake-fetch tests;
do not infer these details from the client/plugin API. If Jagex documents a
RuneMetrics retirement payload in addition to HTTP Gone, recognize that exact
payload in its adapter and raise `SOURCE_RETIRED`.

`previewProgress` builds the same revision-bound proposal regardless of source.
The existing `/api/runemetrics/preview` and `/api/runemetrics/apply` names and
`runeMetrics` dataset capability remain compatibility names in `game-profile.mjs`.
They do not force a particular source. Authentication, viewer restrictions,
server-held review tokens and ten-minute expiry are unchanged.

No new member save fields or command types are added. Plugin observations use
the existing
`apply-game-progress` command and `game-plugin` provenance. Web observations use
`apply-runemetrics`; its optional `source: 'official-api'` records the true source
in the existing skill/quest facts and `runeMetricsSync` fields. Existing commands
default to `runemetrics`. This additive allowed source value is necessary to
avoid labelling future API observations as RuneMetrics; older app versions will
reject saves containing it. Current validation, backups and Undo support both.
Hiscores uses the same command with `source: 'hiscores'`. Mixed web/plugin
reviews add an optional `plugin: { fetchedAt, skills, quests }` to the server-held
command: both parts validate and apply in one revision with distinct per-field
provenance. Backup/restore and Undo preserve them. Older versions reject hiscores
facts and mixed commands; upgrade all readers before enabling them. The
placeholder creates no facts.

## Public API check — 27 October 2026

- [Jagex's 26 October news](https://secure.runescape.com/m=news/the-week-ahead-october-patch-week),
  “RuneMetrics Web-API Changes”, confirms retirement on 10 November. It says the
  replacement is separate from the client/plugin API and promises more details
  by the following Monday (2 November), possibly sooner. It does not publish
  endpoint, authentication or response schemas.
- [developer.runescape.com](https://developer.runescape.com/rs/) currently presents
  the RuneScape Client API and plugin documentation. No replacement web profile
  or quest API contract was found in the portal or targeted public searches.
- Searches also checked [the Wiki's RuneMetrics page](https://runescape.wiki/w/RuneMetrics)
  and [upcoming updates](https://runescape.wiki/w/Upcoming_updates); no replacement
  contract was found. Direct Wiki access was robots-blocked, so this is a search
  limitation, not proof that no documentation exists anywhere.

The source tests use fake fetches, reports and clocks. They do not establish
availability or correctness of a live replacement service.
