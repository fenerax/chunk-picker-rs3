# R116 fixed-input browser pilot

Prepared test-only harness. Application, provider, worker, browser, reference and measured executions are **UNRUN**. Local verification is syntax checking plus 71 named data-only controls. No product source was edited. `strict-oracle.mjs` is the unchanged R79 oracle; its absent-wire-key result is retained separately from the versioned fixed-input result.

This is one Linux public-baseline case: `explorer-1`, Group off, chunk 12850, immediate entry, original R79 public four-chunk fixture. Node must be 24.19.0, Playwright 1.62.1 and Chromium 151.0.7922.34 from the official image. It is a new browser baseline relative to the earlier native Chromium 154 preparation. It establishes no Windows performance or physical paint result.

## Pending command

The external runner must first own a Docker container with hard 2 CPU/6 GiB limits, init, read-only source/harness/dependencies/runtime mounts, writable fresh scratch, a 540-second case budget, cgroup/process observations and exact-container cleanup. No e97 guard is invoked or waived by this harness. The prior native Docker socket denial remains a denial; this command is for the separately authorized standard public GitHub Linux Docker job.

```sh
/runtime/node /harness/run-frozen-browser.mjs \
  --source /source --scratch /scratch --deps /deps \
  --source-lock /scratch/source-lock.json \
  --expected-source-pin 6f22fefa782747790e2eaefa01e4e5ea7b557323 \
  --member explorer-1 --group false --chunk 12850 --startup immediate \
  --out /scratch/case-result.json
```

`pending-command.sh` contains that payload. The wrapper supplies `PERF_PLAYWRIGHT_MODULE=file:///deps/node_modules/playwright/index.mjs`, `PERF_STAGE_FD=3`, and its own resource envelope. The controller writes only `{stage}` to fd3 using the agreed stage enum. App children clear that environment field because their fd3 is IPC. Detailed safe checkpoints go to `/scratch/r116-checkpoints.jsonl`, synchronously written and fsynced after every record. Child before-import/start/ready phases are forwarded through IPC and flushed by the controller.

The existing trusted-browser `--no-sandbox` configuration is explicit and authorized for this disposable, local-only public workload inside Docker isolation. There is no privileged container, extra capability, unconfined seccomp or adaptive sandbox bypass. Browser HTTP(S) requests outside the owned loopback origin are aborted. The controller never retries a failed container or launches Docker itself.

## What executes

1. Verify Node, fixture, harness and complete source identities before importing application code. Source may be a clean checkout at the exact expected commit, or an archive with an independently wrapper-verified lock. Source-lock schema is in `server-driver-protocol.md`; the complete files vector uses `{path,bytes,sha256}`, sorted with `localeCompare('en')`, then SHA256 of its JSON. The child independently rehashes required source anchors. The source/harness mounts remain untouched.
2. Start the normal public `duo-legacy` server in an owned disposable reference directory. Clear inherited RS3 configuration and preloads; use empty scratch roots for optional packs/game/map/terrain/icon/world images. Keep shipped public resources/artwork, startup warmup, predictions and default native workers. No custom calculator, request payload, cache, input key or production observer hook is installed.
3. Retain the complete selected-owner/chunk reference HTTP body. A separate reference browser uses the same narrow main-module attachment and source-owned shipping view. After its initial panel loads, it obtains selected-owner map task IDs from the existing map-count method. That method may refresh its own cache; this is explicitly reference setup, not a passive call or a measured preflight. All/highest/doable/blocked/map expectations are computed from the complete reference planning rows, with source-faithful ordering, category/level rules, first reasons, pagination and empty-view counter absence.
4. Close the reference browser, finish its input witness, close/drain the normal app, verify its finalized witness/lock release/process exit, then copy its fully closed owned store. The measured store's initial file hash must equal the closed reference file hash. No live or private user save is read.
5. Prelaunch a fresh measured browser before starting the measured server. Load a fresh browser context, create/open **one shipping count overlay**, and set up the real chunk Contents pane using existing screen methods. No synthetic pane is created. Immediate entry has no warmup-ready wait or pre-navigation task/RTT probes; normal app/browser/overlay startup may naturally warm caches, so this is not a cold-worker or cold-OS-cache claim.
6. Begin the independent child witness and capture exact calculator bytes/full-state hashes before native Tasks. Arm the initial view observer before the trusted Tasks-tab click. Record Tasks and optional separate Possible Tasks summary clicks/toggle events separately. Capture the **first correct initial selected-filter projection**, all initial page DOM rows including offviewport rows, exact counts/Show more/search/scope and two later consistent frame opportunities.
7. Select a native contrasting filter: Blocked when the reference has any available task; otherwise Doable. Capture the second independent child snapshot before the All interval. Arm the exact existing All chip/list, click natively, require a direct-list mutation, exact first 60 All projection and two later frame checks. This warm filter interval is never called Opening Possible Tasks.
8. Capture the third child snapshot after frames, finish the witness, compare the entire retained measured body against the complete reference (including rows beyond 60), and audit both endpoints. Then measure direct and bridged health RTT. Only measured total RTT within 40 +/-2ms establishes that calibration; adding 20ms each way alone does not.
9. Close browser/relay/app and await child exit. Require the acknowledged stop receipt, lock release, zero retained journal/capture errors, matching finalized witness and final exact snapshots. A delayed commit after `finish` still invalidates the case. Remove owned authored stores only after verified cleanup. The controller has a 480-second deadline plus bounded browser/server shutdown; the outer 540-second envelope remains authoritative.

## Proof and output

The three measured snapshots hash the actual `store.getCalculationSnapshot().stateJSON` bytes and complete `getState()` serialization. A synchronous subscription retains every observed commit and capture error; equal before/after hashes cannot hide a changed-then-reverted input. Source/data/fixture/static options and independent exact input identities must match. Stable taskInputKey is supplementary only. The child cannot inspect the private store queue; normal close drains it and the final journal remains authoritative. Startup writes before readiness are outside subscription coverage, so effective ready-state/reference identities are compared explicitly.

Observed `/api/action-session` requests are classified as receipt-only only for their exact source-proven request keys and successful response. Their raw values are never retained. Any semantic mutation attempt, unclassified write, store commit, capture error, identity drift or missing receipt blocks fixed-input acceptance. Other metadata routes are not silently whitelisted.

Both view endpoints use shipping chunk-pane DOM and later frame opportunities. Global main-list `taskRenderDone` is diagnostic only. Missing planning task IDs require unique label/meta/blocked projection across the complete owner body; ambiguity blocks. Nonavailable exact statuses are checked against complete backend/reference rows, while the DOM checks the visible blocked state and first reason.

`case-result.json` separates opening, All projection, final frozen-input, strict-R79, RTT and cleanup outcomes. Browser clock metrics distinguish:

- `tasksCaptureToCorrectDOMMs` and `tasksCaptureToLaterFrameOpportunityMs` for initial opening;
- optional `expansionCaptureToCorrectDOMMs` and its later-frame counterpart;
- `trustedCaptureToCorrectDOMMs` and its later-frame counterpart for the later All transition.

Node dispatch/episode timestamps remain separate. Whole-episode time includes instrumentation and the explicit contrasting step. No estimated instrumentation cost is subtracted. A correct fixed-output result does not close mutation, fault, cancellation, stale reply, generation, restart, live-swap, Group-on, other-input, engine-correctness or physical-paint gates. A resource-envelope pass is not a semantic pass. Fully recorded blocked/incorrect cases exit 0; harness/runtime failures exit 1.

Only sanitized case summaries/checkpoints belong in public job output. **Never publish `/scratch/r116-owned-*`, raw state, access tokens, invitation/overlay credentials, cookies, child IPC dumps or a whole scratch archive.** `r116-public-task-evidence.json` is a controller-internal capture of authored public task output and sanitized browser evidence; publish only reviewed allowlisted summaries. `r116-final-proof.json` preserves the authoritative post-close snapshots, finalized witnesses, journals and ownership hashes, omitting store paths/nonces/hostnames; its SHA is included in the case result. Stores are deleted only after that proof is retained and cleanup completes. In forced termination, the outer runner must destroy the exact owned container and preserve the safe last checkpoint/resource receipt.

## Verification and packaging

`verification.json` records local pure tests and syntax-only checks, with all application/native counts zero. `harness-manifest.json` lists immutable harness payload files and their SHA256 hashes; its raw bytes have their own SHA in `SHA256SUMS`. The manifest excludes itself, the packaging patch and `SHA256SUMS` to avoid circular hashes. `R116-harness.patch` creates these test-only files at `docs/research/codex-cloud-capture/` on the dedicated public asset branch; it does not edit implementation files. No runtime readiness claim follows until the guarded reference and measured case actually finish.
