# Release pipeline v2

The kit is versioned private tooling. Each candidate exports exact Git object bytes into its own core directory, builds its own pinned addon/profile/config and captures complete inventories. One heavy worker owns both full gates. Exact successful receipts can be reused; new executable inputs require full gates. A prose release can use the bounded text lane only against the accepted running v2 release with identical core, executable addon, gallery, profile, packs and tooling. Managed handover holds the watchdog tick and helper ownership through Stop, verification, atomic current-pointer replacement, Start and authenticated readiness. Failed verification leaves the watchdog paused and performs no automatic save restore or restart.

```text
private/
  release-v2/
    current.json --------------------------+
    current.json.*.previous                |
    operator/     # stable watchdog action  |
    installation.json + original task XML  |
  releases/relpipe-v2-staged-r2/               |
    tools/ operator/ checks/ packs/         |
    requests/area-check.json                |
    releases/area-check-90bbcb1/             |
      pointer.json                         |
      config.json <------------------------+
      core/          # exact immutable commit export
      addons/ profile.json companion.json text/
      release-plan.json release.json
      release-gate/  # exact receipts and acceptance
      .local/        # logs; disposable assembly is removed
    releases/legacy-rel1-7ce633d/ # immutable migration rollback
```

Do not edit a frozen kit or candidate. Build a new kit for tooling changes and an absent release ID for changed inputs. The running server never serves a development checkout. After a successful release the current and direct rollback roots are retained. Pack-transition endpoints and evidence are also retained; otherwise up to three accepted/adopted roots are kept in this kit. Unaccepted candidates and old rel1 installation files are never pruned.

## Go-live order

Every go-live is three commands, in this order, against the same kit, candidate and current pointer:

```powershell
& $node "$kit/tools/release-v2.mjs" release --kit $kit --release $candidate --current $current --gates-only
& $node "$kit/tools/release-v2.mjs" freeze  --kit $kit --release $candidate --current $current
& $node "$kit/tools/release-v2.mjs" release --kit $kit --release $candidate --current $current   # same as promote
```

`freeze` seals `frozen-bundle.json` after the gates pass. The final `release` (or `promote`) only activates that sealed bundle; it never runs gates itself. Without the freeze step it refuses with "run freeze first" before any Stop. rel8's first go-live attempt (r25) skipped `freeze` and was refused this way. `run` performs prepare plus all three steps. Older text below that says the plain `release` command "performs the handover" assumes `freeze` has already run.

## Build the staged kit once

These commands create an absent directory and do not install or operate the live picker.

```powershell
$private = 'C:/Users/User/Projects/chunk-picker-rs3-private'
$kit = "$private/releases/relpipe-v2-staged-r2"
$source = "$private/checks/private-source"
$node = 'C:/Program Files/nodejs/node.exe'
$shared = 'C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools'
& $node "$source/scripts/private-companion/stage-release-v2.mjs" --source $source --accepted "$private/releases/rel1" --output $kit --heavy-lock "$shared/with-heavy.ps1" --light-lock "$shared/with-light.ps1" --concurrency 1
```

This conservative kit uses the existing shared wrappers, whose exact bytes are part of every new release identity. Retained and rollback releases validate their historical wrapper records against their own pinned kit and exact gate receipts, without reading current shared wrapper bytes. Their gate-platform execution digest is historical too; retention validates the acceptance identity, digest format and exact recorded suite/gallery receipt fields rather than requiring today's shell environment to reproduce the old platform digest. New preparation, gates and forward release still require the pinned current wrappers. New memory-reservation wrappers are supplied but optional. A separately built kit can select `--memory-admission` instead of the two wrapper arguments. They reserve 4 GiB for heavy work and 1 GiB for light work, retaining 3 GiB after outstanding reservations. They never terminate processes or reclaim ambiguous owners. Cross-lane reservations become fully effective only after other shared workers adopt those wrappers; CPU admission is not implemented. Choose concurrency when building the kit; changing it invalidates receipts.

## Prepare and prove the Area candidate

```powershell
& $node "$kit/tools/release-v2.mjs" prepare --kit $kit --repo 'C:/Users/User/Projects/chunk-picker-rs3-core' --ref 90bbcb162721b25e4d589edfb3ac0412286623c0 --base 7ce633d15e2cf367fb7b46d01343a4483d5c8287 --previous-config "$private/operator/candidate-rel1.json" --input "$kit/requests/area-check.json" --legacy-rollback
$candidate = "$kit/releases/area-check-90bbcb1"
& $node "$kit/tools/release-v2.mjs" release --kit $kit --release $candidate --gates-only
```

`--gates-only` has no Stop, Start, pointer publication, task registration or pruning stage. It scans exact public commit trees, runs both suites under one heavy acquisition, validates plain/framed gallery under the light lock, verifies all pinned installation bytes and reports timings. The private assembly is hashed before testing and removed before successful receipts are committed. The public lane clears private environment selectors. The legacy snapshot is an explicit copy of the accepted running distribution, with Git cleanliness and all pins checked; its adoption marker is rollback evidence, never a fabricated full-suite receipt or forward-release authority.

The original Area commit `8a6a964` failed the approved public author/committer metadata rule before suites ran. `90bbcb1` on `relpipe` has the identical Git tree, with approved noreply metadata. The original feature branch and core main remain unchanged. Use the normalized candidate above for this proof and eventual release.

## One-time install, with MaÃ«lle's authorization

Dry run first; it reads task/config ownership and performs no writes. Use the exact prepared candidate above.

```powershell
$install = "$private/release-v2"
$installArgs = @('-NoProfile','-File',"$kit/operator/Install-ReleaseV2.ps1",'-SourceRoot',$kit,'-InstallRoot',$install,'-InitialPointer',"$candidate/initial-current-pointer.json",'-WatchdogTaskName','RS3 Chunk Picker watchdog','-BackupTaskName','RS3 Chunk Picker daily backup')
powershell @installArgs -DryRun
# After reviewing the dry run and obtaining MaÃ«lle's OK:
powershell @installArgs
```

The install is one scripted transaction. It snapshots exact task XML and original trigger/action bytes, creates a separate operator directory, points only the watchdog action at `current.json`, preserves logon/time triggers and the backup task, then verifies registration. It does not restart the server. No installed v1 files are overwritten. Original configuration bytes remain selected until the first managed release.

Before any v2 release, undo that installation with:

```powershell
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -InstallRoot $install -Restore -DryRun
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -InstallRoot $install -Restore
```

Restore checks retained XML/plan pins and exact current tasks, restores the original task XML and keeps the watchdog paused for explicit config/task review. It retains files and snapshots. This undo procedure applies only before the first v2 release. Managed rollback to the adopted legacy snapshot selects different immutable core/profile/addon paths and does not restore the initial configuration hash, so it does not make task restoration eligible. Uninstalling after a v2 release requires a separately reviewed return to the original exact configuration and pointer. Never resume an original task that pins a different running configuration.

## Ship and subsequent releases

The already prepared Area release needs one command after the one-time install:

```powershell
& $node "$kit/tools/release-v2.mjs" release --kit $kit --release $candidate --current "$install/current.json"
```

Exact matching suites and gallery receipts are reused. Installation verification and final identity checks still run. The helper validates candidate/previous ownership and every identity before Stop, after verification and before Start. The pointer commits config path and hash in a single replacement; original pointer bytes are retained in unique history files. Authenticated readiness must succeed before the watchdog pause is removed.

For each later release, author an absent input JSON with a unique `releaseId`, one changelog entry and an existing roadmap item ID/note. Then use one command:

```powershell
& $node "$kit/tools/release-v2.mjs" run --kit $kit --repo 'C:/Users/User/Projects/chunk-picker-rs3-core' --ref '<exact core ref>' --input '<absolute input JSON>' --current "$install/current.json"
```

The current v2 pointer supplies the accepted base and previous release automatically. Source prose is copied from the currently selected addon, so consecutive text releases retain earlier entries. Only candidate text copies change. Text releases run schema/delta checks, focused addon/render/tamper tests and authenticated disposable candidate endpoint/banner checks; gallery and pinned installation checks remain required. Any unrecognized change takes the full lane. Missing, failed, stale or incomplete evidence never grants reuse.

## Rollback

Keep the current storage; do not restore an older save. Select the previous retained root (the first v2 release records `rollbackRelease` for the legacy snapshot; later releases record `previousRelease`) and use:

```powershell
& $node "$kit/tools/release-v2.mjs" rollback --kit $kit --release '<previous retained release root>' --current "$install/current.json"
```

This uses exact current-process Stop ownership, verifies the retained target/current storage, atomically returns the pointer, then starts and authenticates the previous code. It requires distinct immutable roots and matching listeners, origin and storage. Changed pack pins require the explicit retained transition described below. It never restores gameplay data. After a failure keep the watchdog paused and inspect private logs, runtime ownership, storage locks and pointer history before taking another action.

## Refresh helpers in an existing installation

Stage a new kit with pinned `operatorFiles` and run these commands before a pack release:

```powershell
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -SourceRoot $kit -InstallRoot $install -UpdateHelpers -DryRun
# Live operation, only in the separately authorized deployment:
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -SourceRoot $kit -InstallRoot $install -UpdateHelpers
```

Dry run validates the existing installation, installed file hashes, new kit pins, current pointer and exact watchdog/backup task XML without writes. Deployment holds the watchdog tick and helper locks, preserves the pause state, snapshots installed operator bytes in a unique `helper-backup-*/`, journals the target pins in `helper-current.json`, copies and verifies each pinned file, and rechecks pointer and task definitions. It never registers tasks or restarts the picker. The refreshed helpers support the existing rel2 schema-2 pointer and schema-1 configuration before rel3 promotion.

Restore the matching snapshot using the new kit's installer:

```powershell
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -InstallRoot $install -RestoreHelpers -DryRun
powershell -NoProfile -File "$kit/operator/Install-ReleaseV2.ps1" -InstallRoot $install -RestoreHelpers
```

Restore requires the same release pointer as at helper update (roll back the release first if necessary), validates the snapshot and current helper pins, holds both locks, and restores exact prior helper and pause bytes. Snapshots and original installation/task receipts remain retained. A partial copy leaves the watchdog paused and a `deploying` journal; restore accepts only the recorded old/new bytes for each file. Unknown drift is refused. Failure details stay in the installation's private `helper-update.failure.txt`.

## Pack upgrades (new kits only)

Every newly prepared release owns a complete `packs/` copy, selection, profile/catalogue, config and compatibility evidence. Previous releases retain their own original roots, including roots in an older kit. Keep those kits and their tooling, wrappers and gate receipts. Never replace a pack, selection, profile or config inside an existing kit/release. This tooling is for future absent kits; installing it into an existing stable operator directory is a separate authorized operation. Do not use an older installed Start/watchdog helper for a pack handover: the stable helpers must include the pack-journal Start guard before enabling upgrades.

The data manifest's dataset digest covers **all data and Rules-text input bytes**. Adding explanations changes that digest, even if the gameplay data and rule contract stay unchanged. The already built `rel2-pack-1.0.4` cannot simply be combined with new Rules text. Build a matching pair in a new output root, preserving the Fortress correction, and choose new immutable versions for the resulting manifests. Keep the existing 1.0.4 build for evidence; do not edit it. A version may be reused only in a distinct unpublished build root with explicit distinct hashes; using a fresh version avoids ambiguity.

For rel3, first integrate its approved public feature and reapply the missing catalogue/test changes described in `.local/rel2ship/ruleexplain-reapply/README.md`. Do not apply the complete archived files over later changes. The source catalogue must declare `app/data/rule-explanations.2026-10-17.v1.json`. Build from an isolated complete private assembly with explicit frozen metadata input directories:

```powershell
# $assembly is the complete rel3 private assembly; $newPacks is an absent output root.
& $node "$assembly/scripts/build-data-pack.mjs" --source-root $assembly --packs-dir $newPacks --version '<new data version>' --rules-text-version '<new Rules-text version>' --include-explanations --map-assets '<frozen map inputs>' --game-data '<frozen game inputs>'
# Include the retained art version/payloads and its exact selection entry in $newPacks.
# The builder preserves an art selection already present in the output root.
& $node "$source/scripts/private-companion/stage-release-v2.mjs" --source $source --accepted '<accepted distribution with corpus/checker>' --packs $newPacks --output '<absent new kit>' --heavy-lock "$shared/with-heavy.ps1" --light-lock "$shared/with-light.ps1" --concurrency 1
```

`--include-explanations` routes the JSON to Rules text only. It builds and verifies the matching data manifest with the combined digest; it does not modify the default rel2 source catalogue. `--rules-text-version` defaults to the data version. Existing version directories are refused before either pack is installed. No gameplay storage is opened by the builder. Profile generation retains the early required-input and manifest check before suites or gallery.

The release request must include `packTransition.old` and `.new`, each with exactly `datasetId`, `datasetContractVersion`, `digest`, and `bindingSha256`. Use the actual manifest descriptors and actual current binding-file SHA-256 for `old`. The `new` binding uses UTF-8, two-space JSON indentation, this field order, and one trailing LF:

```json
{
  "schemaVersion": 1,
  "datasetId": "duo-legacy",
  "datasetContractVersion": 1,
  "digest": "<new combined dataset digest>",
  "requiresPack": true
}
```

The exported `bindingBytes(descriptor)` in `tools/release-pack-check.mjs` produces those exact bytes. Hash them with SHA-256; do not hash compact JSON or PowerShell JSON. Preparation validates both explicit descriptors and config pins, retains the old and new binding bytes, and runs packed startup against disposable copies of the current save with both selections. It additionally opens the new-startup result using the old selection, checks stable authored IDs/aliases and saved task resolutions, and retains `pack-transition.json` with the evidence. An absent addition list retains strict saved-resolution equality. Transition schemaVersion 2 optionally declares savedIdentityAdditions as an exact array of { "key": "saved reference", "target": "permanent task ID" }. Schema 1 cannot declare additions. Every authored ID and alias remains identical; every old saved resolution remains unchanged. The new saved set must equal the old set plus exactly the declared additions: extra, missing, removed or retargeted references refuse. Each declared key and target must be authored by the new prepared dataset definitions and absent from the old definitions; saved registries cannot establish authorship. Duplicate declarations refuse. No alias remapping is silently approved.

Compatibility starts a disposable old-selection copy, migrates a copy of that checked result under the new selection, then opens the migrated new copy under the retained old selection, then opens that result under the new selection again. All probes start a scratch server on a free port 8900–8999, authenticate locally and serve tasks. Existing task IDs, member ticks/statuses and non-catalogue gameplay state must survive exactly. Startup may append catalogue-refresh history events and migration audit archives, as the storage contract already does. The checker hydrates all retained history, requires every existing event and migration archive/conversion/conflict to retain its exact hash and position, permits only catalogue-refresh events after the old history prefix, and rejects nonzero lostRecords. History sidecar layout and taskIdentityMigration bookkeeping are kept outside the gameplay hash; all other provenance remains in it. Copy roots and credentials are deleted in finally; live storage and bindings are read only. The schema-2 compatibility receipt records the four probe counts and progress hashes. Identity/catalogue changes outside this bounded contract still require a separately designed migration.

Prepare with the new kit and the installed current pointer, then run its gates:

```powershell
& $node "$kit/tools/release-v2.mjs" prepare --kit $kit --repo '<approved core repo>' --ref '<exact core commit>' --input '<new request JSON including packTransition>' --current "$install/current.json"
& $node "$kit/tools/release-v2.mjs" release --kit $kit --release $candidate --gates-only
```

Changed packs always use the full lane. Their complete identities enter both full-suite gate keys, the packed gallery key and installation verification. Only receipts from the exact same frozen upgrade may be reused after interruption; previous-release full/gallery receipts cannot grant upgrade authority. Do not copy receipts. After all gates pass, run `freeze`; then the ordinary managed `release` command performs the handover (see Go-live order).

Under one watchdog-tick/helper ownership hold, the helper pauses, verifies identities/gates, performs an owned Stop, confirms storage release, verifies installation, and repeats both-direction compatibility on the latest stopped save. It durably journals the expected source/target pointer and binding hashes before a compare-and-swap binding replacement. It then promotes the pointer, verifies identity, Starts with the same helper owner and confirms authenticated readiness. Journal states are `journaled`, `binding-swapped`, `pointer-swapped`, `starting`, `ready`. Exact pointer/binding history, compatibility evidence, and both pack roots remain retained. Gameplay saves are never restored.

An interruption keeps `picker-paused`. Ordinary Start rejects a pending journal. Inspect the private logs and exact runtime owner, then reconcile explicitly with the **new kit's** tooling:

```powershell
& $node "$kit/tools/release-v2.mjs" recover --kit $kit --current "$install/current.json"
```

Recovery reacquires watchdog/helper ownership, Stops only an exactly owned runtime, rechecks gates and current-save compatibility, and observes the actual binding/pointer pair. It can finish source/source, target-binding/source-pointer, or target/target pairs. Unknown hashes, the inverse partial pair, uncertain process ownership, or any failed check leave it paused. A failure before journal creation leaves the original pair intact: retry the managed release after resolving the failed check. Recovery during Start stops the exactly recorded current runtime before rechecking and restarting; it does not assume a previous readiness result.

For rollback, use the ordinary `rollback` command with the retained previous release root and the **new kit**. It validates the latest gameplay save using the retained old selection, then reverses the exact binding/pointer transition under the same journal and ownership rules. Rollback does not require the code being replaced to start successfully. It restores only old binding bytes and the old pointer, never an older gameplay save.

The rollback command also accepts a pending forward journal after failed verification or Start. Under ownership it validates the original source/source, target-binding/source-pointer, or target/target pair, retains the forward journal in history, and durably records the reverse intent before replacing either file. A reverse journal may therefore retain the original partial pair with `allowInversePartial`; this permission applies only to an explicitly requested reversal of that verified pending forward transition. Unknown hashes and uncertain runtime ownership still stay paused. If the reverse transaction is interrupted, `recover` follows the recorded reverse intent and starts the old release. A failure before the reverse journal is committed requires retrying `rollback`.

Keep both pack roots and transition evidence after rollback. Completed journals are retained when superseded; do not manually delete a pending journal, pause marker, storage lock or runtime record to bypass recovery.

## Boundaries

The relnext addendum below defines exact-SHA hosted public evidence and stable local receipts. Private full, gallery, install and lifecycle authority remain required. Affected-test selection supplies feedback and never replaces a release full. Readiness, server stop/start and real scheduler installation need the separately authorized live acceptance run. Memory admission is optional and CPU admission remains deferred. The text lane uses actual candidate endpoints and the real render module in a disposable DOM; it does not claim physical-phone acceptance. Keep logs private: application output can contain credentials and invitation addresses.


## Relnext: paired candidates and one-shot idle release

Use a fresh kit made from the exact core main SHA and private Git commit. The new stager accepts `--private-repo`, `--private-commit`, `--core-repo`, `--core-ref`, and `--base`; `--private-source-dir` and `--source` retain the directory fallback. All paired intake uses committed Git objects, independent of the core worktree's HEAD. The private integration checkout must be clean and have no remotes.

`release-v2.mjs release --gates-only --evidence-dir <shared-local-evidence>` runs advisory preflight first, reuses exact passing gate receipts, and executes missing lanes through the pinned admission wrappers. `--public-ci-ref refs/heads/main` or a checked-candidate ref selects the kit's pinned GitHub verifier. Add `--public-ci-local-fallback` to explicitly permit a recorded local public-full fallback. Hosted promotion also needs local public proof for offline rollback; if missing, that flag earns it once while reusing the other gates.

`release-v2.mjs promote --kit <kit> --release <candidate> --current <stable-pointer> --idle-state <duo-state-file> --evidence-dir <shared-local-evidence> --public-ci-local-fallback` validates the frozen candidate and complete receipts, then invokes the existing managed transaction. Run `freeze` after gates-only first; without `frozen-bundle.json` promotion refuses with "run freeze first". It does not rerun matching gates. Activation still checks current-pointer CAS, exact process ownership, latest stopped-save compatibility, binding journals and authenticated readiness. Retained rollback uses its original evidence and tooling.

`release-worker.mjs --config <absolute-private-json>` performs one selection/validation/activation attempt. The configuration explicitly supplies repositories, trunk receipts, local pair receipts, accepted corpus/checker, selected production packs, current pointer, new-kit and evidence destinations, request, wrappers, jobs and the duo save path. It chooses the newest eligible first-parent main candidate, or a strictly newer private descendant paired with the same already-live core. A merge receipt alone is not behavioral evidence.

Idle means the newest regular file write recursively under the duo directory is at least 45 minutes old. This is the existing watcher's rule. The worker returns a durable waiting-idle status for the scheduler to retry; it holds no heavy/light lane while waiting. Resumed activity prevents another phase or handover. An owned verification phase finishes cleanup before the attempt aborts; an owned live handover always finishes through its existing recovery rules.

`build-dev-pack.mjs --help` describes isolated `0.0.0-dev.h<digest>` builds from one exact commit of this repository, exported with `export-repo-source.mjs`. Use this on demand when accepted packs lack required inputs. Development output never authorizes production prepare. Cut a matching stable data/text version using the existing builders at release planning, include its exact pins and profile hash in the local pair, and retain explicit pack-transition descriptors. This change does not allocate production semantic versions or approve a data migration automatically.

The staged bundle's APPLY.md owns first adoption and source hashes. Do not apply the old preflight or cipub release-v2 patches on top of this reconciled version. Schedule installation, helper updates, first real-kit acceptance and main migration remain with the release owner.
# Release-loop acceptance and file evidence (relloop)

Pipeline tooling changes must pass a practice release of the currently live
revision before preparing a different candidate. `prepare` verifies the practice
receipt against the exact tooling, gate policy and immutable live payload. A
missing, changed, stale or unverified practice receipt refuses preparation.
The release session owns the source/staging window and reviews each new kit.
Do not patch an existing sealed kit or installed helper to get past a refusal.

Use the adopted tooling kit with the unchanged live packs. Choose an absent
scratch directory outside the live kit, save, packs, operator and source trees:

```powershell
node "$ToolingKit/tools/release-v2.mjs" release --practice --kit $ToolingKit --current $CurrentPointer --repo $CoreRepo --output $AbsentPracticeRoot --evidence-dir $SharedEvidence
```

Acceptance is exactly `no-op verified`. The practice copies immutable inputs,
rebuilds the live profile/addon without changing prose, runs preflight and gates,
then runs the managed helper forward and rollback with `-DryRun`. All deployment
paths, credentials and origin in those dry runs are synthetic scratch inputs.
It never calls promotion, Stop, Start, a real rollback or the live save. The
unchanged live pointer and immutable payload are checked before and after.
Practice output and the checksummed acceptance receipt are retained for review.

Focused tooling contracts follow the gates' flaky policy (`retry-policy.mjs`):
when the combined run fails cleanly and node's failure summary pins every
failure or cancellation to a selected contract file, each such file reruns once,
alone, in fresh scratch. A pass is recorded in `flakyFiles` of the contract
receipt and the retry logs sit beside `tooling-contracts.log`. A timeout of the
whole run, leaked or unverified cleanup, a skip, an unattributed failure or a
second failure still refuses. `retryOnceInIsolation: false` in kit.json or
`--no-retry-once-in-isolation` turns it off, as for the gates.

A practice killed mid-certificate leaves
`tooling-certificates/<digest>.json.pending`. The next practice checks the
recorded owner pid: a dead owner's marker is renamed to `.pending.failed-<uuid>`
(never deleted) and issuing continues; a live or unreadable owner still refuses.
A failed validation moves its own marker aside the same way.

Gates run Chrome/gallery, copied synthetic-save startup, the seven pipeline
integration files, and all previously failed files for the same repository/base
line before the full lanes. Early checks collect failures together. Their
target is five minutes; the enforced execution cap is thirty minutes
(`earlyBudgetMs`): cold on the release PC, gallery took up to 296 s and the
pipeline stage with private assembly over 14 minutes. The cap is
separate from shared-wrapper admission waits, and `release-gate/early.json`
records each check's seconds.
An early failure publishes no successful round. Existing sealing, pack transition,
latest-save preservation, single-writer, handover and rollback guards still apply.

Both full lanes use the adaptive per-file runner. New admissions require at least
4 GiB free plus a conservative 1 GiB reserve per active/new worker; starts ramp
from two to a cap of six. A lower explicit concurrency cap remains supported.
Memory pressure stops new admissions and lets active files finish. It does not
suspend memory-holding processes. Receipt metrics separate controller lifetime,
Node FileTest lifetime and top-level test-body duration without double-counting
nested tests. The owned compile cache is empty on entry and removed on exit.

Passes are keyed by effective test bytes, the file's static closure across
public/private source (imports, literal dynamic imports, `new URL('literal',
import.meta.url)` files and reviewed computed-import targets), every
package.json, runner/scanner/tracer/policy, OS and actual child execution pins.
When any module in the closure can reach other inputs (fs, children, workers,
loaders, network, evaluation, computed or unresolved imports), the key also binds
`<data-floor>` (every non-code entry except changelog/roadmap text) and `<tree>`
(every entry name). So a code edit reruns only files whose closure holds that
module, while a data edit or an added/removed file reruns every such open file.
Each reused file records its original kit and receipt. Missing, stale,
malformed, incomplete or changed proof reruns the file. Failures retain peer
passes and update the candidate-line failure list. The plain `release` command,
after `freeze`, consumes the exact valid result already earned by gates-only; it
reruns the same gate path only when that evidence no longer validates.

The static closure is only a hypothesis. Every lane file runs with
`scripts/test-trace.mjs` preloaded (`--import`, inherited by Node children and
workers), which records module loads, reads, listings, stats, writes, sockets and
children. A pass takes the reusable receipt slot only when `traceVerdict` finds
every observation bound by its key: project files in the closure (or the floor),
directories only through `<tree>` or a bound entry, other names absent at lane
start and made by the file itself, no paths outside the assembly or lane scratch
(a stat of an ancestor directory of either is implied by the run starting there),
no scratch file older than the lane, connections only to ports the file opened,
nothing another file in the same run wrote or made (listings and copied trees also
see names another file made beneath them; a stat does not, and making a directory
that existed at lane start changes nothing), and no hazard (non-Node or shell
child, native addon, inspector, custom loader thread, UDP, unresolved package).
The only non-Node child allowed is the store's exact `Get-Process` start-time
probe, matched on its whole argument list in `test-trace.mjs`.
A flaky pass is never reusable. Unverified passes still prove the gate; they are
stored under a unique name and never read back. Lex failures, module mocks,
nested test runners, escaped specifiers and imports from outside the project
leave no checkable hypothesis and always run.

Each file has a 15-minute deadline (`deadlineMs` in the tree's test policy
overrides it). Past it the file's process tree is killed and the file counts as
failed, so the ordinary isolated retry applies.

`plan-files --kit ... --release ...` reports every always-run reason without
running checks or taking admission. Optional `scripts/test-inputs.json`
(`rs3-test-inputs-v2`) lists reviewed targets for computed imports, keyed by the
importing module and the exact expression text the scanner prints:

```json
{
  "schema": "rs3-test-inputs-v2",
  "volatile": [],
  "modules": {
    "app/example-loader.mjs": {
      "computedImports": { "import.meta.resolve(name)": ["app/example-adapter.mjs"] },
      "reads": ["tests/fixtures/example.json", "tests/fixtures/dir/"]
    }
  }
}
```

Listed targets join the closure of every file that reaches the module; the
module stays open and the trace still checks what actually loaded, so a stale or
wrong list makes files rerun, never skip. `reads` binds bytes a module reads as
data (a `dir/` prefix binds every entry under it); a listed code module is still
scanned for its own imports. The checked-in file declares `app/server.mjs`
(`APP_VERSION` hashes all of `app/`, so any app edit reruns every server test)
and `app/datasets.mjs` (the catalogue's source inputs). Do not add entries just
to turn a red test green.

The release session calls `post-merge-private.mjs <40-hex-core-main-SHA>` after
each merge. It deduplicates per SHA and current input pins, queues a hidden
dispatcher, and runs through the existing heavy wrapper's live-save admission
and BelowNormal priority. Configure one shared evidence directory for that lane,
practice and release gates. Its per-file proof is the same format consumed by
release gates. Trunk's future merge-core hook belongs to its owner; this bundle
does not edit either merge flow. Configuration and exact call sites are in the
staged APPLY.md.

# Request inspection before staging

Run `node tools/release-v2.mjs check-request --kit KIT --input REQUEST --current POINTER`
from tooling containing this command. It copies the previous pointer's pinned addon text
to disposable scratch and applies the same text update as prepare. It creates no candidate,
lease or lock and prints digests or a fixed refusal rule, never request prose.
To check while staging, add `--request REQUEST --current POINTER` to
`stage-release-v2.mjs`. This optional check runs before export or kit creation and also
supports `--packs NEW_PACK_ROOT`. It checks text application only; release preflight,
practice acceptance and pack transition validation still apply in their usual lanes.

Paired staging exports the exact private commit into an owned temporary directory
outside the legacy companion and copies that verified source into the new kit. A kit
under `COMPANION/releases/KIT` works with an explicit `--packs NEW_PACK_ROOT`.
Output overlapping canonical `checks/private-source` still refuses before export.
The temporary export is removed after success or failure; the low-level exporter's
legacy-companion overlap guard is unchanged. The system temporary directory must
be an ordinary directory outside the companion and other protected inputs.

The focused paired/exporter regression tests live in private Git at
`tools/tests/stage-release-paired-v2.test.mjs`. They require repository management
tools/history and are intentionally excluded from metadata-free release exports.

