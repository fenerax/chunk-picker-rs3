# Personal progress sources

In **Activity Info → Progress sync**, choose **Sync progress**. The review names
its source: **Game plugin**, **RuneMetrics**, or **RuneScape API**. Review changes,
then apply or cancel. Raw skill IDs, mapping reasons and save revision appear
only with **Settings → Advanced**. Viewers have no sync controls.

Accepted live-world plugin progress is the first source for that member for ten
minutes. Skills have separate observation times; quest lists have their own time.
Position, item and achievement reports do not refresh levels or quests. Stale,
beta-world, unknown-world and far-future reports cannot take priority. Missing
fields leave saved facts alone. Applying, dismissing or undoing a review does not
erase the source observations. Observations live in memory and clear on restart;
without an active plugin key, they cannot supply a sync preview.
Plugin progress does not need a saved RuneScape account name.

Otherwise the configured web source supplies progress. Jagex announced that
RuneMetrics closes on **10 November 2026**, but the picker keeps using it until
it actually stops answering (decided 31 October 2026): HTTP **404** or **410
Gone** retires RuneMetrics for this server process, including requests in
flight. `RUNE_METRICS_SUNSET_AT` in `app/integrations/progress-source-policy.mjs`
records the announced date for reference only.
No unpublished JSON error code or text is guessed. Private profiles, missing
names, rate limits and temporary failures keep their existing meanings.

After retirement, the replacement adapter supplies either progress or a normal
unavailable result. The placeholder says the new API is not available yet and
levels sync from the game plugin now. This is HTTP 200, has no Apply token, writes
nothing and is shown as information. Fresh live plugin observations still work.

## Adding the official web API

The selector is `app/integrations/progress-sources.mjs`. A source implements
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
  message: 'The new RuneScape API is not available yet. Levels sync from the game plugin now.' }
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

No new save fields or commands are added. Plugin observations use the existing
`apply-game-progress` command and `game-plugin` provenance. Web observations use
`apply-runemetrics`; its optional `source: 'official-api'` records the true source
in the existing skill/quest facts and `runeMetricsSync` fields. Existing commands
default to `runemetrics`. This additive allowed source value is necessary to
avoid labelling future API observations as RuneMetrics; older app versions will
reject saves containing it. Current validation, backups and Undo support both.
The placeholder creates no such facts.

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
