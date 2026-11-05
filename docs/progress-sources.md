# Personal progress sources

In **Activity Info → Progress sync**, choose **Sync progress**. The review names
its source: **Game plugin**, **Platform API**, **RS3 hiscores**, or a configured legacy source. Review changes,
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

The default web source is the published RuneScape Platform API: main Hiscores JSON plus Player Quests. It uses whole XP and shows official quest points in the preview only. See [Account progress sync](runemetrics.md) for endpoint contracts, limits and persistence. Plugin observations continue to win per field; a failed paired web snapshot leaves saved progress alone and preserves the existing levels-only fallback policy.

An explicitly configured `webSource: 'runemetrics'` retains policy B: it keeps using RuneMetrics until HTTP 404 or 410 retires it for the process. The announced 10 November closure date remains reference metadata, not a timer. Private-profile, rate-limit and account errors keep their meanings. The optional `official-api` adapter slot remains available for custom adapters.

## Custom adapter contract

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

To configure a custom adapter:

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

Web observations use the existing `apply-runemetrics` command. Platform commands use `source: 'platform-api'`, while saved skills, quests and sync metadata use the main-compatible `official-api` value. Older commands default to `runemetrics`. Plugin observations retain `apply-game-progress` and `game-plugin` provenance. Official quest points stay in the preview; no new saved field or extension is added. Existing source values remain supported.
