# R116 server child protocol

This file is a test harness. It imports only Node built-ins unless executed as the IPC child. No application, provider, browser or native worker was run during its local authoring or syntax verification.

Run the child with pinned Node `v24.19.0` and Node process IPC. The controller owns bounded startup, RPC, graceful-stop and eventual hard-stop deadlines. The child writes no JSONL; the parent flushes safe events to its JSONL journal. The source, harness and dependency mounts must be read-only; scratch must be writable and dedicated to this child. The driver does not establish container mount permissions itself.

```text
/runtime/node /harness/server-driver.mjs
  --source /source --scratch /scratch --deps /deps
  --store /scratch/reference/store
  --fixture /harness/fixture.json
  --source-commit 6f22fefa782747790e2eaefa01e4e5ea7b557323
  --source-manifest-sha256 FULL_CONTROLLER_VERIFIED_MANIFEST_SHA256
  --source-lock /harness/source-lock.json
  --initial
```

`--repo` is an alias for `--source`; they cannot both appear. `--deps` is accepted for the controller's common argument contract and is not imported or executed. Optional pack, game-data, map, terrain, icon and world-image roots are empty directories under `/scratch/assets/`. Shipped public web/resources/task-artwork roots keep their normal application defaults in the read-only source mount. `--initial` requires a completely empty store and constructs the original R79 fixture with the original `createGroupState` procedure. To start a measured store, omit `--initial` and supply an existing, fully closed copy of the reference store; both `state.json` and its existing `access-token` must be present. The child never supplies `initialState` in this mode. Copying the store is the controller's job and must follow the reference child's successful `stopped` receipt and process exit.

The fixture is pinned to SHA-256 `380ffb698ea594ccb1d375321708a4369f50da82fdc796fd91a4a8c8038b8022`. It remains the R79 authored public fixture; it is not a private save or an equivalence claim for an older unavailable fixture.

The source lock is a parent-supplied declaration, checked before importing the app:

```json
{
  "schemaVersion": 1,
  "sourceCommit": "6f22fefa782747790e2eaefa01e4e5ea7b557323",
  "manifestSha256": "64 lowercase hexadecimal characters",
  "criticalFiles": {
    "app/server.mjs": "64 lowercase hexadecimal characters",
    "app/storage/store.mjs": "64 lowercase hexadecimal characters",
    "app/datasets.mjs": "64 lowercase hexadecimal characters",
    "app/dataset-runtime.mjs": "64 lowercase hexadecimal characters",
    "app/core/state.mjs": "64 lowercase hexadecimal characters",
    "app/private-addon.mjs": "64 lowercase hexadecimal characters"
  }
}
```

Additional critical files are allowed and checked. Every listed hash is independently computed over mounted file bytes. The full source manifest/Git identity and read-only mount remain the controller's verification responsibility, explicitly labelled in the receipt. Omitting the lock accepts only the exact 6f22 commit and six built-in reviewed anchors. A declared future arm needs its own full commit and source lock; it is not forced to use the baseline's file hashes. No candidate matrix is launched here.

Before any dynamic app import, the driver removes inherited `RS3_*`, `PERF_STAGE_FD`, `NODE_OPTIONS` and `NODE_PATH`. It installs only the public dataset and scratch asset paths. It calls normal `startServer` with loopback host and port zero, the scratch store and asset roots. It does not supply a worker factory, `beforeCommit`, prediction setting or startup-warmup override. `startServer` owns the normal early listener and readiness. App code stays in its mounted source location.

Every message includes `protocol: "r116-server-driver-v1"`. Safe unsolicited events are:

- `{type:"checkpoint", phase, at}` for `before-application-import`, `before-start-server`, `application-ready`.
- `{type:"early", origin, directOrigin, at, pid}` after the normal early listener exists.
- `{type:"ready", origin, identity, sourceIdentity, fixture, dataset, workerSelection, boundOptions, owner, initialDiskState, snapshot, commitInFlight, startupTimingMs, observed}` after `early.ready`. `identity` and `sourceIdentity` are identical. The full `dataset.status()` digest is included. `workerSelection` includes its digest and hashes of static selection/overlay identity; paths, environment values and provider snapshots are omitted. These are static identities, not a custom worker configuration.
- `{type:"commit", entry}` after a synchronous journal capture. This event is supplementary; the in-memory journal is authoritative and is returned again after close.
- `{type:"startup-failed"|"driver-failed"|"command-failed", error}` on failure. Error messages, stacks, causes, state and arbitrary string fields are never forwarded.

The **credential-bearing event** is `{type:"private-invite", sensitive:true, joinUrl, inviteUrl}`. Both URL fields refer to the app's existing master invitation. The controller must consume it privately, never persist it to JSONL, print it or include it in checkpoints/errors. No token is manufactured or logged by the driver. The driver itself prints no startup or failure output.

Commands may use `command` or the compatibility field `type`. IDs are strings or numbers. Send commands sequentially:

```js
{id: 1, command: 'begin', token: 'scenario-opaque-id'}
// -> {type:'reply', id:1, ok:true, result:{tokenSha256,snapshot,ownership}, status}

{id: 2, command: 'snapshot', phase: 'before'}
{id: 3, command: 'snapshot', phase: 'before-all'}
{id: 4, command: 'snapshot', phase: 'after-frames'}
// -> {type:'reply', id, ok:true, result:{snapshot}, status}

{id: 5, command: 'finish', token: 'scenario-opaque-id'}
// -> {type:'reply', id:5, ok:true, result:{witness,journal,ownership}, status}

{id: 6, command: 'stop'}
// -> {type:'stopped', id:6, ok:true, result:{
//      closeCompleted,ownershipStable,ownershipBeforeClose,ownershipAfterClose,
//      finalSnapshot,journal,captureErrors,witnesses,commitInFlight,
//      subscriptionScope,closedStore}}
```

Each active witness requires the three phases once each, in the displayed order. `begin` and `finish` also take independent snapshots. `token` is an opaque ASCII identifier (1–160 characters from letters, digits, `.`, `_`, `:`, `-`); only its SHA-256 is returned. Reusing an identifier is an error. A rejected RPC has `{type:"reply", id, command, ok:false, error}`. The child rejects snapshot commands outside an active witness. For the initial reference, the controller may use `ready.snapshot`, then `stop` without a witness.

Both `begin` and `finish` read live ownership and return `ownership: {present,sameProcess,startVerified,ownerRecordSha256,sameOwnerAsReady}`. The finish journal is a real retained journal receipt: `{installedBeforeBegin:true,beginSequence,endSequence,witnessEndSequence,events,captureErrors,subscriptionScope}`. Its events include every commit observed since subscription, including any before the witness. `endSequence` is the actual observed journal length when the receipt is built; `witnessEndSequence` is the length at the synchronous finish snapshot. Absence of an unsolicited commit IPC event is never used to manufacture an empty journal.

Every snapshot reports independent revision readings, SHA-256 and byte length of the **exact** `store.getCalculationSnapshot().stateJSON` bytes, and SHA-256/length of `JSON.stringify(store.getState())`. `inputKey` and `taskInputKey` are supplementary only. No state values leave the child. Each capture attempts the calculation/full-state/key reads independently and retains all capture errors permanently. The synchronous subscriber increments and retains its commit row before capture. It is never unsubscribed at `finish`.

Any observed commit invalidates all frozen witnesses, even when snapshots happen to match again. A missing/out-of-order phase, any retained capture error, or any exact snapshot mismatch also prevents validity. `finish` validity is provisional. The `stopped.result.witnesses` values are authoritative after normal close and its final snapshot; the parent must also require `ownershipStable`, absent post-close owner lock, successful process exit and `closeCompleted`.

The store owns its existing process guard and `store.lock`; the driver does not open a second store or compete for its lock. It verifies the live owner PID and the unchanged hashed owner record, and verifies lock removal after close without emitting the owner nonce or hostname. There is no public store queue/in-flight counter. That limitation is reported as `observable:false`; no method wrapper or `beforeCommit` override is installed. Normal `app.close()` drains the real mutation/store/maintenance lifecycle before the final journal and snapshot are returned. The subscription begins at app-ready, so startup migrations before readiness are outside its coverage. The controller must compare the copied reference identity and measured ready/final snapshots to detect that difference.

If IPC disconnects or SIGTERM arrives, the driver attempts normal close without a log. A success receipt is emitted only for an explicit `stop`; the parent must not treat an interrupted or timed-out child as a successfully closed reference.
