# Updating the original picker data

The author publishes two public JSON files at [Source Chunk's picker](https://source-chunk.github.io/chunk-picker-rs3/). The retained frontend fetches `rs3-chunkpicker-chunkinfo-export.json` and `tasksMap.json` directly. Its [public repository](https://github.com/source-chunk/chunk-picker-rs3) is the origin of the frozen copy, commit `98a3bdc`. See [the retained reference](../reference/original-picker/README.md). No background feed updates our app.

Use Node 24 from this repository. Substitute the actual check date:

```powershell
node scripts/compare-original-data.mjs --fetch --date 2026-10-13
```

The script makes one unauthenticated GET per file, a second apart, with a 60-second timeout and 32 MiB limit. It stops on denial, redirects, invalid JSON or oversized responses. It never logs in, retries, crawls, runs upstream code or writes to the original service. Captures stay in `.local/original-data/<date>/`; an existing directory prevents another fetch.

Read `docs/research/original-data-<date>.v1.md` and its JSON. They compare all original sections against the frozen copy and the current runtime selection, including F2P and members content. The JSON includes full changed records. Item, monster and source views overlap, so their counts are not a unique-content total.

After review, reuse those captured bytes offline:

```powershell
node scripts/compare-original-data.mjs --date 2026-10-13 --adopt
```

An unchanged source records a dated provenance receipt and keeps the existing bytes. Changes create dated `app/data/original-definitions.*.json` and/or `original-task-map.*.json`. The existing task-map generator retains historical decoders and tombstones; the existing identity generator retains old tokens/aliases and gives new tasks/entities permanent IDs. A dated registry snapshot is kept. The script selects the new receipt in `app/data/original-data.mjs` last, using an atomic file replacement. Server and CLI then load its verified files through the existing adapters. Restart a stopped local server after selection. No player save changes.

The historical root export, archival seed and old dated versions stay intact. Local icons/artwork, guides, corrections, membership/access evidence and cache/training additions survive. The audit checks changed correction targets, optional modes, generated-guide collisions, map and stock preconditions, explicit identity seams, complete legacy history and pinned source selectors. It verifies local file hashes again before adoption. When the identity generator adds rows, the report records the registry's before/after hashes.

Any conflict blocks the whole batch and lists why. Resolve it with a separate evidence-backed correction decision; changing a fingerprint merely to pass the import is not a review. Fetching newer content does not verify the original author's accuracy. New names may need local icon or membership research.

If staging fails, inspect unselected snapshots and `.origdata.tmp*` files before retrying. Existing receipts and their reports are protected. Use `--version v2` for the next intentional version on the same date; reuse the capture without `--fetch`, or provide a distinct `--current-dir` for a new fetch. Reports can be regenerated until their receipt exists. Keep captures until verification and commit finish. Never rewrite historical evidence hashes to the new data.

Verify once after adoption:

```powershell
node --test --test-timeout=120000 tests/original-data-tools.test.mjs tests/original-data-update.test.mjs tests/task-map-history.test.mjs tests/repository-provenance.test.mjs
npm run test:quick
powershell -NoProfile -File .local/with-heavy.ps1 npm test
```

The final full suite uses the shared lock and runs once per data-update job. No visual interface changed, so screenshots/browser sessions are unnecessary. If source catalogue sizes change, tell the warmstart job to remeasure them. On October 13 both public files were exactly identical to the frozen copy: zero changes, zero adopted/skipped rows and zero conflicts; see [the dated check](research/original-data-2026-10-13.v1.md).
