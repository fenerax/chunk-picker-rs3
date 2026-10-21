# Fresh public map capture

`app/capture-maps.mjs` takes a read-only snapshot of the public gameplay branches for `qxa` and
`qxb`. It sends individual unauthenticated HTTP `GET` requests to the original public Firebase REST
endpoint. It never reads a whole map, authentication branch, PIN, password, account record, or
private Firebase user endpoint, and it has no write operation.

The requested branches exactly match the `importLegacyMaps` gameplay whitelist: `rules`,
`chunkOrder`, `settings`, `chunkinfo`, `chunks`, `activeSubTabs`, `topbarSelection`, `manualPrimary`,
`recentFancyRollTime`, `recent`, `recentTime`, `randomLoot`, `chunkNotes`, `userTasks`, `friends`, and
`friendsAlt`. The common public `version` value is optional; its failure produces a warning without
discarding a complete gameplay capture.

Run the package capture command, or invoke the module directly:

```powershell
node app/capture-maps.mjs
node app/capture-maps.mjs --output .local/imports/my-maps.json
```

The collision-safe default is `.local/imports/maps-<UTC timestamp>.json`. Existing files are never
overwritten. Requests use bounded concurrency, per-request timeouts, and limited exponential retry
for timeouts, transport failures, rate limits, and transient server responses. A permanent field
failure aborts the snapshot so a partial document is not written.

The output is `{ maps, metadata }`. `maps` has the direct shape accepted by `importLegacyMaps`.
`metadata` records the UTC `capturedAt`, SHA-256 hash of the maps object, source origin and exact
source fields, map IDs, and optional source version. Pass the timestamp explicitly during import:

```js
const imported = importLegacyMaps(snapshot, {
  members,
  capturedAt: snapshot.metadata.capturedAt,
});
```

The importer intentionally reports `metadata` as a non-gameplay root field and keeps capture
provenance through its `capturedAt` option. The CLI prints only the destination, hash, counts, field
names, source version, and warnings; it does not echo gameplay payloads.
