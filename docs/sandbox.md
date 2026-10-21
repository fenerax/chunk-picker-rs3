# Sandbox

Choose **Sandbox** in the map toolbar to try a sequence of changes for the selected player. Opening prepares a separate calculation worker. The persistent banner says **Sandbox: nothing here is saved**.

- Click or Shift-click surface chunks to unlock or lock them temporarily. Gold hatching marks changes; temporary locks have a dashed outline. Search or the map's context menu opens Chunk Info.
- Challenge checkboxes add hypothetical challenge credit. Saved challenge checks cannot be unchecked here. Personal quest, achievement and skill completion stays separate.
- **Chunk Rules** opens a personal Sandbox task-rule editor. Each override is one undoable step. The ordinary saved profile/preset editor is available after Exit.
- **Undo last step**, **Reset**, and **Exit sandbox** discard draft changes. Exit restores the captured saved map, task result and roll pool. Switching players or receiving a newer saved revision closes the experiment and loads the real view.

Active Tasks uses the hypothetical calculation, marks added active goals **new**, and the banner compares unfinished presented goals and the roll pool with the saved baseline. Possible-task counts retain the engine's broader meaning. Preview and focused Chunk Tasks/Clues use the hypothetical base, including every previous draft step. Saved controls and write requests are guarded throughout Sandbox.

**Show chunks that would add the most tasks** compares up to eight current roll-pool chunks by new possible tasks, matching Preview's broader count. Its results explicitly name the sample size; it does not claim an exhaustive ranking. Existing draft/Preview caches are reused. Item, equipment, training, BiS and Activity views that require full saved-only detail are available after Exit; Sandbox search offers Chunks and Tasks.

Drafts exist only in browser memory. Closing/reloading the page discards them. Another browser has its own draft.

## API

Authenticated same-origin `POST /api/sandbox/evaluate` accepts:

```json
{
  "memberId": "player1",
  "baseRevision": 123,
  "changes": {
    "unlockChunks": ["12341", "12342"],
    "lockChunks": [],
    "doneTasks": [],
    "taskRules": { "Multi Step Processing": false }
  },
  "previewChunkId": "12343",
  "planningChunkId": "12342"
}
```

Both optional location fields can be omitted. Chunk arrays and `doneTasks` describe the whole accumulated draft, rather than just the last step; omitted arrays default to empty. IDs must be known, duplicate-free and exact; unlock/lock arrays cannot overlap. Limits are 40 changed surface chunks, 500 challenge checks, 128 scalar rules and 64 KiB. Unknown fields and invalid rule values are rejected. A stale revision returns HTTP 409, including if a real save arrives during calculation.

The `sandbox-v1` response contains a compact `play-v1` task `result`, `possibleCount`, ordinary `rollPool`, and saved-baseline `delta` arrays for unfinished tasks, items and reachable access. Optional `prediction` compares the requested unlock with the hypothetical base; optional `planning` gives location evidence from that same calculation. Task deltas honor challenge completion modes and completion families.

The endpoint never dispatches a saved command, writes gameplay state or appends History. It uses the existing advisory worker lane independently of saved foreground calculation, native shared snapshot transport and bounded caches keyed by member, revision and normalized draft. User requests precede background prewarming. Two full hypothetical snapshots reuse engine work across Preview/planning requests. Changing the draft or leaving Sandbox cancels pending advisory requests. Normal saved-task caches and prediction goldens are unchanged.

## Verification

`npm test` includes strict request/auth/origin/stale/no-write tests, native multi-step and delta fixtures, cache/scheduler regressions, controller race/undo/exit checks, and shipped main-module save guards. Prepare a worktree-local copy of the private duo save, removing `store.lock`, `invites.json`, `feedback.json` and `access-token`; delete that source copy after checking. The browser check below creates/deletes its own disposable store and Chrome profile:

```powershell
$env:RS3_GAME_DATA_DIR = 'C:\Users\User\Projects\chunk-picker-rs3\.local\game-data'
$env:RS3_MAP_ASSETS_DIR = 'C:\Users\User\Projects\chunk-picker-rs3\.local\map-assets'
node scripts/research/sandbox-smoke.mjs --source .local/sandbox-real-save
```

It checks both players' real-save sandbox sequences, byte-identical gameplay state and History, browser challenge/Undo/Exit behavior, guarded saving controls, and 390px light/gray layout. Desktop/phone captures and the small scalar report remain under ignored `.local/`. Death-estimate requests are stubbed only for this focused browser check; the normal `npm run perf` comparison measures unchanged advisory behavior separately. These headless checks do not certify a physical phone or Player 2's device. Paired measurements are recorded in [performance.md](performance.md).

## Changed files

| Area | Files |
| --- | --- |
| Evaluation | `app/sandbox.mjs`, `app/server.mjs`, `app/tasks/worker.mjs`, `app/tasks/scheduler.mjs` |
| Browser | `app/web/sandbox.mjs`, `sandbox-rules.mjs`, `sandbox.css`, `main.mjs`, `map.mjs`, `index.html` |
| Sandbox regressions | `tests/sandbox.test.mjs`, `sandbox-server.test.mjs`, `sandbox-client.test.mjs` |
| Existing browser harnesses | `tests/web-browser.test.mjs`, `map.test.mjs`, `map-overlay.test.mjs`, `chunk-resource-ui.test.mjs`, `web-personal.test.mjs`, `original-sync-web.test.mjs` |
| Smoke and documentation | `scripts/research/sandbox-smoke.mjs`, `README.md`, `docs/sandbox.md`, `docs/performance.md` |
