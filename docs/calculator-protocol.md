# Calculator protocol

The calculator is everything that turns a saved game into tasks, predictions and
estimates. Today it is `app/tasks/worker.mjs`, hosted as a worker thread or an
owned child process (`app/tasks/process-worker.mjs`) and driven by
`app/tasks/scheduler.mjs`. This document fixes the boundary so two lanes can work
at once: the multiplayer lane changes the server side, the engine lane replaces
what sits behind it. See `docs/rebuild-lanes.md` for who owns what.

Version 1 describes today's messages in a language-neutral form. A calculator
written in any language is a separate program that speaks it. The current
JavaScript worker, wrapped in a small adapter, is the reference implementation
and the oracle for `docs/calculator-check.md`.

Source references were verified at core commit `a490498`.

## Transport

A calculator is a child process. The server writes frames to its stdin and
reads frames from its stdout. Each frame is:

1. a 4-byte little-endian unsigned header length `H`;
2. `H` bytes of UTF-8 JSON, the header;
3. a 4-byte little-endian unsigned body length `B`;
4. `B` bytes of body, possibly empty.

Large JSON (states, results) travels in the body as raw UTF-8 bytes, never
escaped inside the header. A header may describe a body made of several parts:
`parts: [{ "name": "play", "bytes": 1234 }, …]`, concatenated in that order.

stderr is for operator logs only. A calculator receives private gameplay; it
must never write state contents, member names or task text to stderr or to disk.
Counts, durations and error kinds are fine.

## Lifetime

1. The server starts the program with `--protocol 1`.
2. The server sends `init`. Its body is the init bundle (below).
3. The calculator compiles, then sends `ready`.
4. Requests and controls follow, one active request at a time per calculator
   (the scheduler queues; `progress` keeps the watchdog quiet).
5. The server ends a calculator by closing stdin, then killing it after a grace
   period. A calculator exits on stdin EOF.

The server may run several calculators. A calculator serves any picker that uses
its dataset digest; it never assumes one picker.

## Init bundle

Version 1 bundle is today's `workerData` (`app/server.mjs:291`–`300`):

| Field | Meaning |
| --- | --- |
| `definitions` | Server-prepared definitions JSON, reviewed overlays applied (`app/server.mjs:475`–`478`). |
| `datasetSelection`, `datasetDigest`, `datasetOptions`, `preparedDatasetStages` | Which pack and which preparation stages. A calculator refuses a digest it cannot verify. |
| `world` | `{ chunks, areas, surface? }`: topology used by roll pools, transport and map locations. |
| `extraRules` | Rule definitions added to the built-in registry. |
| `skillGuideCatalogue` | Reviewed skill-guide identities. |
| `omitReadyCatalogue` | When true, `ready` carries no catalogue (advisory lanes). |

The JavaScript worker also reads values straight from the selected pack
(`datasetValue(...)`, `selectedDataset`). A non-JavaScript calculator cannot. The
engine lane's first job is to make the bundle self-contained, so that
everything a calculator needs is either in the bundle or in a named pack file,
and to update this table. Until then the reference adapter is the only complete
implementation.

## Messages from the server

Every request header has `v: 1`, an integer `id` unique within the calculator,
and `type`. Request headers also carry `pickerId` (`p_` + 32 hex, or
`legacy-shared`). It partitions caches and supersession only, and must never
change a result.

| `type` | Extra header fields | Today |
| --- | --- | --- |
| `evaluate` | `memberId`, `view` (`play-v1` or `full`), `projections` (subset of `duo`, `duo-sidebar`) | the task list (`worker.mjs:343`) |
| `predict` | `memberId`, `chunkId` | "what if I unlock this chunk": delta for the owner, then a full reusable result for owner and partner (`worker.mjs:356`–`380`) |
| `death-estimates` | `memberId`, `chunkIds` | per-candidate death estimates, cancellable between candidates (`worker.mjs:221`) |
| `chunk-planning` | `memberId`, `chunkId` | tasks and clue locations tied to one chunk (`worker.mjs:182`) |
| `sandbox` | `memberId`, `draft` | hypothetical unlocks/locks/completions (`worker.mjs:189`); today the draft rides in `chunkId` |
| `area-check` | `memberId`, `draft` | area audit for a hypothetical (`worker.mjs:333`); today the draft rides in `chunkId` |
| `prepare-rules` | none | precompile a rule set before it is saved (`worker.mjs:329`) |
| `roll-pool` | `memberId`, optional `draft` | **new.** Eligible chunks to roll. Today `evaluateRollPool` runs on the HTTP thread (`app/server.mjs:656`, `1602`, `1798`) and in game commands (`app/core/state.mjs:2014`); Phase 0 measured 6.3 s of blocked HTTP loop for the duo. |
| `cancel` | `id` of the request to abandon | `worker.mjs:299` |
| `supersede` | `pickerId`, `revision` | drop work for older revisions of that picker only (`worker.mjs:300`) |

### State

Every calculating request names the state it applies to:

- `revision`: the picker's state revision;
- `input`: the task-input fingerprint (a string). Display-only saves keep it, so
  a calculator may reuse work across revisions with the same input;
- `snapshotKey`: `JSON.stringify([revision, input])`;
- `state`: `"body"` when the body is the full state JSON, or `"ref"` when the
  calculator should reuse the state it last received under the same
  `pickerId` and `input`, rebound to `revision`.

A calculator keeps a bounded LRU of states keyed by `(pickerId, input)`
(`STATE_SNAPSHOT_LIMIT`). If a `ref` misses, it replies with error kind
`snapshot-missing` and the server resends the body. The state schema is the saved
game (`schemaVersion: 1`, `members`, `tasks`, `history`, rules); the calculator
must reject a body whose members do not match the header (`worker.mjs:272`–`296`).

## Messages from the calculator

| `type` | Header | Body |
| --- | --- | --- |
| `ready` | `v`, `datasetDigest`, `engine: { name, version }`, `supports` (request types it implements), `compileMs` | the catalogue (`worker.mjs:421`–`423`) unless omitted |
| `progress` | `id` | none. At most one a second during long work. |
| `prediction-prepared` | `id`, `memberId`, `taskInputKey`, `sourceRevision`, `priority`, `parts` | the owner's reusable result, sent before partner work starts (`worker.mjs:368`) |
| `result` | `id`, `parts`, `timingMs`, `evaluationMs`, optional `cancelled`, `cache` | see below |
| `error` | `id`, `error: { kind, message }` | none |

Result parts by request type:

| Request | Parts |
| --- | --- |
| `evaluate` | `play` always; `full` when `view: "full"`; `duo` / `duo-sidebar` when asked |
| `predict` | `delta` (`{ delta, coverage, metrics }`); plus `owner-reuse` and `partner-reuse`, each with `play`, `duo`, `duo-sidebar` and their own `memberId`, `taskInputKey`, `sourceRevision`, `priority` |
| `death-estimates` | `estimates` (`{ memberId, stateRevision, estimates, cancelled }`) |
| `chunk-planning` | `planning` (`chunk-planning-v1`) |
| `sandbox` | `sandbox` (`SANDBOX_FORMAT`) |
| `area-check` | `area-check` |
| `roll-pool` | `pool` (the `evaluateRollPool` result) |
| `prepare-rules` | `prepared` |

Parts are plain JSON. Today's worker also gzips the reusable parts
(`worker.mjs:261`). A calculator may add `encoding: "gzip-sync-prefix"` parts
with `crc32` and `rawLength`; the server must accept results without them.

Error kinds: `invalid` (today's `TypeError`; the server reports a bad request),
`snapshot-missing` (resend the body), `failed` (anything else; the server retries
or restarts the calculator). Messages must not quote state contents.

`timingMs` uses fixed stage names (`engineMs`, `collectionMs`, `equipmentMs`,
`presentationMs`, `currentBiSMs`, `activityMs`, `predictionMs`, `deathMs`,
`totalMs`, …). A calculator may add stages; it may not rename these.

## Rules both sides keep

- **Same input, same output.** A result depends only on the bundle, the state and
  the request fields above. Not on `pickerId`, request order, cache state,
  wall-clock time, randomness or thread count.
- **Supersession is per picker.** A higher revision in picker A never cancels
  work for picker B. Today `latestRevision` is one number per worker
  (`worker.mjs:150`); version 1 calculators key it by `pickerId`.
- **Cancellation is cooperative.** A calculator checks between units of work
  (candidates, prediction steps) and returns `cancelled: true` with whatever it
  completed. The scheduler's deadline and restart remain the hard limit.
- **Unknown types are refused**, not ignored: `error` with kind `invalid`. The
  server routes a type that is not in `supports` to the reference calculator.
  This lets a new engine take over one request type at a time.
- **Bounded memory.** A calculator declares nothing about its limits; the
  server enforces them (RSS cap, process count). A calculator must survive being
  killed at any point without leaving files behind.

## Changing this protocol

Changes go through a pull request that edits this file first, then the reference
adapter, then the server. Bump `v` for a change that an older calculator or
server would misread. Adding an optional header field or a new request type
(declared in `supports`) does not need a bump.
