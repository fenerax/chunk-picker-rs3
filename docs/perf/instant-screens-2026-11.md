# Instant screens, November 2026

START `a9e2cd27b744e529fc44df8e917b966a6387423a`. Branch `perf/u1-instant-screens`.
Comparison uses START, not the cached origin/main. Browser source SHA-256:

- START: `f85bc65850e4666de64576a746267dd2e8c1d0be3372fa6ba11f32b8b86045d1`.
- Candidate: `401d61f472c40ebc1daaebf6577cdcd9f82fd12f1ffb1c8bb1823c63b44f10bb`.

The browser shows known answers as **Updating…**, then accepts current responses through the existing request guards. Cached answers never become acknowledged state, a command baseline or a settled foreground calculation. Server, calculator, storage and core game source changes: **0**. New server fields: **0**. No game-result changes are intended.

## What waits today

| Surface | START between action and answer | Candidate |
| --- | --- | --- |
| Play | Keeps old rows after a save; first load waits for a task reply. | Explicit updating status; bounded known-result reuse; cached first paint survives state hydration and remains searchable. |
| Roll controls | State supplies eligibility; optional before/after task comparison holds roll controls. | Roll saves alongside the comparison; controls release after the save; two-choice rolls skip an unused comparison. |
| Preview | Working text; same-page exact-repeat promises already reuse answers. | Known deltas render immediately, labelled updating, including after reload when small enough. |
| How? / Why | Checking text while proof or full details arrive. | Known proof/derived explanation first; stale or missing current tasks cannot become fresh explanations. |
| Pool / ranking | Loading text after reload or a revision reset; current rows already survive close/reopen. | Cached rows and counts are provisional until a matching poll returns. |
| Chunk planning | Loading text; exact in-memory planning requests already coalesce. | Known focused rows/filter controls first; current evidence replaces them without losing focus or filters. |
| Progress | Clears to loading text on each mount. | Known saved totals/charts first, then a guarded refresh. |
| First load | Static shell, then state/world metadata, then task rows. | Authenticate first, show a small inert saved summary and up to 60 task labels, then hydrate live state and calculations. |

Published real-size context already in `docs/perf/`, not new U1 private runs: the wake report has first-list medians **14.39 [12.04–15.17] s** and **19.92 [16.46–58.66] s**; the Preview report has first-Preview medians **12.56 [9.64–13.19] s** and **7.66 [6.38–8.68] s**. The How/Why report has sampled How medians **0.365–1.014 s** after its optimization, with individual spread reaching **0.272–1.220 s**, and first saved Why medians **0.295 [0.217–0.353] s** / **0.389 [0.377–0.491] s**. The older hotspots pool-stage median is **5.54 [4.81–7.65] s**. These are component/calculator timings, not browser paint timings at this exact START. Separate real-size Progress and focused-planning paint timings were not available in those reports.

## Cache and interaction contract

The memory tier has a 64-entry, 8 MiB estimated JSON payload budget, with a 2 MiB entry limit. IndexedDB keeps at most 512 KiB of estimated payload and omits entries above 96 KiB. These are payload budgets, not a hard bound on JavaScript object/RSS overhead. Storage denial, quota failure and blocked storage fall back to live reads. There are no credentials in cache records.

One authenticated member scope is retained. Dataset/digest, picker/route, actor, permission, member and Sandbox changes invalidate it. Epoch checks reject late reads and serialized writes prevent a retired scope from resurrecting its records. On reload, authentication and dataset selection precede any cached gameplay display. The selected member is recorded only after it matches the live roster.

Every cached display is provisional, including an exact revision hit until its live loader validates it. A fresh empty answer removes old content. Startup data stays separate from `state` and `result`; it cannot authorize a roll or start advisory work. The live map and roll controls hydrate from authoritative state. Ticks, task notes and backlog changes use a separate pending projection and roll back on refusal; chunk-note drafts already provided immediate local editing and conflict handling. Current revision/member/picker/dataset/generation guards remain in force. Update messages are polite statuses; replacement retains focus, selection, filters and scroll where the control still exists.

## Browser measurements

Linux 6.18.57, Node 24.21.0, Chromium 154.0.8037.57; 4 CPU quota and 16 GiB memory limit. The production browser modules and process calculators run against fresh synthetic stores: **2 members, 3 chunks, 2 tasks**. The public dataset's training/catalogue UI surfaces are enabled for this fixture. No private save or pack is used.

Five independent server/profile runs per version, one run at a time, with no tests running during the final measurements. Cold starts with fresh browser storage. Warm reload retains HTTP/IndexedDB storage and server caches; it is not a same-page repeat, which already had some memory reuse. Relevant synthetic response bodies are held for **600 ms** through CDP. This exercises waiting behavior; it does not claim to accelerate the calculator.

First-load summary and Play use the app document's navigation time origin and the first painted state/task frame. Other panels use the action-to-result frame, after an additional animation frame. Planning includes its valid empty-result/filter view. The live roll-control paint is a separate five-run `--startup-only` supplement, measured after state adoption and control binding; cached summaries do not enable commands. The full fixture is deliberately small, so these figures do not establish full-catalogue rendering performance.

All cells are **median [minimum–maximum]**, five runs, milliseconds.

### Cold

| View | START, ms | Candidate, ms |
| --- | ---: | ---: |
| First-load saved summary | 1438.0 [1384.2–1489.8] | 1451.3 [1375.2–1485.5] |
| Play task rows | 2019.7 [1965.1–2071.7] | 2028.2 [1942.2–2059.8] |
| Live roll controls | 1460.5 [1453.2–1597.9] | 1474.4 [1443.0–1513.7] |
| How? | 639.7 [635.2–645.6] | 637.7 [633.1–645.5] |
| Why | 913.8 [913.0–946.4] | 931.6 [920.3–960.1] |
| Roll pool and ranking | 630.5 [629.4–644.9] | 633.5 [627.2–637.5] |
| Preview | 633.2 [632.5–647.9] | 637.0 [635.4–650.8] |
| Chunk planning | 631.1 [630.9–647.2] | 631.0 [629.7–647.4] |
| Progress | 675.0 [654.3–683.7] | 676.2 [662.1–697.6] |

### Warm reload

| View | START, ms | Candidate, ms |
| --- | ---: | ---: |
| First-load saved summary | 1171.4 [1128.7–1195.3] | 495.8 [458.7–533.0] |
| Play task rows | 1749.1 [1706.9–1764.4] | 495.8 [458.7–533.0] |
| Live roll controls | 1236.7 [1199.7–1283.6] | 1192.8 [1186.9–1255.9] |
| How? | 635.3 [627.0–639.4] | 8.8 [5.3–18.5] |
| Why | 646.9 [630.0–661.1] | 22.6 [20.5–30.0] |
| Roll pool and ranking | 630.2 [627.9–645.7] | 22.0 [20.7–27.9] |
| Preview | 636.0 [625.8–642.2] | 25.4 [19.2–26.2] |
| Chunk planning | 631.2 [627.8–645.2] | 22.2 [17.8–28.7] |
| Progress | 653.5 [640.3–654.9] | 39.0 [30.3–98.6] |

All 5 warm candidate runs showed their known panel data with an updating mark. Cached startup painting occurred in all 5. Blank task frames between the cached first paint and the fresh calculation: **0 in all 5 runs**. Fresh answers still have the synthetic response delay; the smaller warm number measures usable known content while updating.

| Measurement | START | Candidate |
| --- | ---: | ---: |
| Shell first contentful paint, cold, ms | 248.0 [220.0–288.0] | 240.0 [216.0–320.0] |
| Shell first contentful paint, warm, ms | 128.0 [112.0–144.0] | 124.0 [112.0–152.0] |
| Sampled Chrome process-tree peak RSS, MiB | 732.1 [723.5–750.6] | 741.6 [721.4–743.9] |
| Chrome process-tree idle RSS, MiB | 709.4 [708.2–712.4] | 721.3 [716.8–726.0] |

RSS sums the owned browser process and descendants, sampled every 200 ms from numeric `ps` output. It includes shared pages more than once; it is not PSS or VPS/server memory. Idle is one second after the final UI flow without forced GC. The median peak increases by **9.4 MiB**, and idle by **11.9 MiB** in this fixture. Preliminary zero-RSS samples from the unavailable `/proc/.../children` interface were discarded; all published RSS samples use the corrected sampler. This is not a memory soak or a real-pack capacity measurement.

Reproduce from the candidate checkout, supplying an untouched START worktree:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/instant-screens.mjs --root /path/to/START --runs 5 --output /tmp/before.json
node scripts/perf/instant-screens.mjs --runs 5 --expect-cache --output /tmp/after.json
node scripts/perf/instant-screens.mjs --root /path/to/START --runs 5 --startup-only --output /tmp/roll-before.json
node scripts/perf/instant-screens.mjs --runs 5 --startup-only --expect-cache --output /tmp/roll-after.json
```

## Validation and visual checks

- Final targeted run: **561 passed, 0 failed, 1 skipped**, 19 files, 30.188 s. Covers all touched/added test files plus authenticated module serving, planning, ranking, startup, comparison renderer, gallery and screenshot mode. The existing skip requires a paired public/private browser harness, absent in this single checkout.
- Final `npm run test:quick`: **3433 passed, 0 failed, 68 skipped**, 346 files, 301.524 s. The full `npm test` was not run.
- Earlier quick attempts exposed the Admin proxy's undeclared cache fields and a versionless current-result fixture. Their original assertions remain; fixtures now declare the new context and actual member/revision. The final gates above pass.
- Seven separate settled 1440 × 900 screenshot pairs: **3 exact RGB matches; 4 pairs differ by 12 pixels each, maximum channel delta 1; 0 pixels differ by more than one channel step**. Those pixels are native checkbox-border antialiasing, with no geometry difference. Captures wait for both group members, hide blinking carets equally, and are separate from timing trials. Raw RGB hashes and counts are in the JSON evidence. Existing gallery and screenshot-mode tests pass; the full CI gallery matrix was not run locally.
- Calculator/core/server changed-source count: **0**; a calculator q2 differential and private full-result hash campaign are not applicable to this browser-only change. The comparison VM's four tests pass with its explicit display-state accessor.
- Private-save server starts: **0**. Private-save calculator runs: **0**; skipped for this UI task. Private credential creation: **0**. Private checkout changed files: **0**. No private save was opened and no lab content was copied into this checkout.

## Changed files

| File | Change |
| --- | --- |
| `app/web/browser-state.mjs` | Bounded display JSON, optional IndexedDB, scope epochs, serialized invalidation, and focus/scroll preservation. |
| `app/web/screen-context.mjs` | Declare cache/session/startup fields and bind the cache to dataset, route, picker, actor, permissions, member and Sandbox. |
| `app/web/screen-settings.mjs` | Clear cached and visible calculations, abort requests and close stale dialogs when session scope changes. |
| `app/web/screen-save-status.mjs` | Clear display storage and startup snapshots when a picker session stops. |
| `app/web/screen-map.mjs` | Synchronize cache scope before rendering a changed member or view. |
| `app/web/screen-loading.mjs` | Restore the inert startup snapshot; reuse known Play rows as display only; save accepted results and small startup summaries. |
| `app/web/screen-startup.mjs` | Start cached painting after authentication; remember the validated roster selection for the next load. |
| `app/web/screen-tasks.mjs` | Label stale Play results, retain/filter the cached first paint through hydration, project pending statuses, and cache guarded explanations. |
| `app/web/screen-task-dialogs.mjs` | Mark old details as updating, hydrate full evidence, and replace the displayed status with the current answer. |
| `app/web/task-how.mjs` | Show cached planning paths immediately and retain scope, close and abort guards. |
| `app/web/task-why.mjs` | Cache the small derived explanation instead of a full result or rule function. |
| `app/web/task-why-chain.mjs` | Show known requirement trees while a guarded current read runs. |
| `app/web/screen-chunks.mjs` | Show known Preview deltas with an updating label; reject mismatched and late responses. |
| `app/web/chunk-planning.mjs` | Show cached focused planning data and preserve filters, disclosure state and focus on replacement. |
| `app/web/pool-ranking.mjs` | Reuse summaries provisionally and include the actor epoch in polling guards. |
| `app/web/helper-progress.mjs` | Show cached saved progress, refresh in place and keep known data labelled after read failure. |
| `app/web/helper.mjs` | Pass the shared cache into the lazy Progress renderer. |
| `app/web/screen-panels.mjs` | Pass the cache to planning and Helper contexts. |
| `app/web/command-state.mjs` | Project queued challenge ticks, task notes and backlog changes without modifying acknowledged state. |
| `app/web/screen-commands.mjs` | Extend optimistic feedback to all task-status fields and bulk backlog restore; show calculation feedback after 300 ms. |
| `app/web/screen-ui.mjs` | Keep checkbox input usable and roll back only the latest failed local change. |
| `app/web/screen-roll.mjs` | Save alongside a display-only baseline read; release controls after acknowledgement; omit the unused comparison for two-choice rolls. |
| `scripts/compare-cache-access.mjs` | Declare the display-state accessor and startup field in the snapshot-renderer VM. |
| `scripts/perf/instant-screens.mjs` | Reproducible synthetic browser timing, memory and screenshot harness; no private-save input option. |
| `scripts/test-selection.mjs` | Classify the new unit file as quick. |
| `tests/instant-screens.test.mjs` | Eleven cache, persistence-race, isolation, stale-label, snapshot, optimistic-projection and focus checks. |
| `tests/web-browser.test.mjs` | Wired stale/empty replacement, optimistic rollback, startup continuity, roster selection and usable roll-control regressions. |
| `tests/browser-screen-harness.mjs` | Supply the new browser imports with isolated in-memory storage. |
| `tests/admin-menu.test.mjs` | Declare optional cache fields in the proxy fixture. |
| `tests/picker-audit-a.test.mjs` | Supply the cache import and startup collaborator in its VM fixture. |
| `tests/task-blocker-guidance.test.mjs` | Give the current-result fixture its explicit member and revision. |
| `docs/perf/instant-screens-2026-11.md` | Method, measurements, validation and limitations. |
| `docs/perf/instant-screens-2026-11.json` | Numeric measurements, source hashes, screenshot hashes and validation counts. |

## Limits and recommendation

Cold answers still require computation. An evicted or oversized result uses the existing loading/error path; persistence is intentionally limited to small display data. First-load cached content waits for authentication and dataset bootstrap, and the startup snapshot is inert and capped at 60 labels. The live map and command controls wait for authoritative state. Multiple tabs/members can replace the single persisted namespace, reducing cache hits without crossing permissions.

The synthetic browser fixture and short RSS run do not prove full-catalogue frame time, long-term memory use or production VPS capacity. No server, worker-retirement or game-result semantics were changed. There are no blocking open questions from the completed local gates.

Recommendation: **MERGE-CANDIDATE**. Status: **SHIP**.
