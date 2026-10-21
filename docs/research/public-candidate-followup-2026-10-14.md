# The public copy is ready to publish

This follow-up removes the original service's client and expands the tests in the
generated public tree. The private application remains the shared source. No
remote, push, publication, deployment or live-save change is part of this job.
The first-pass artifact and counts remain recorded in
[the earlier report](public-candidate-export-2026-10-14.md).

## Original-service boundary

The export excludes these modules entirely:

| Module | Purpose removed from the public tree |
| --- | --- |
| `app/capture-maps.mjs` | Capture of original-service map documents. |
| `app/integrations/original-sync.mjs` | Original-service client, review and sync proposal. |
| `app/integrations/original-tasks.mjs` | Original-format task conversion for sync. |
| `app/integrations/original-local-changes.mjs` | Conversion of local changes for original-map reconciliation. |
| `app/web/original-sync.mjs` | Browser review and sync panel. |
| `app/data/original-data.mjs` | Original-input selection and loader; independent providers use their own pinned bytes. |

The new dataset bootstrap delegates private inputs to their existing loader.
Independent providers read their own hash-checked inputs. Capability checks run
before either the server integration or browser panel can be imported. The HTML
has no sync control; supporting private datasets mount the same control in its
previous menu position. Public sync, original import and migration-report routes
return 404 after the existing authentication checks. The existing command
capability check rejects `sync-original`. Backup restore remains available.

Private defaults, dataset inputs, identities, rule contracts, auth, CSP, viewer
permissions and overlay policy were not changed. No data-pack input edit was
needed. Tests declare synthetic fixture actors or a shared boolean rule where
their subject is storage rather than private provider defaults.

## Retained format compatibility

The following authored modules still contain original-format compatibility.
They contain no live-service client or captured catalogue payload. Removing
their compatibility branches would require a wider state/identity refactor.

| Module(s) | Reason retained |
| --- | --- |
| `app/tasks/gameplay-compat.mjs` | Its text decoder and migration markers have shared native task, label and saved-control callers. |
| `app/tasks/migration.mjs` | Also resolves canonical saved identities, projects member facts and normalizes current saves/backups. |
| `app/core/state.mjs` | Owns the shared schema, revision-checked commands, backup validation and Undo; original import commands are capability-blocked publicly. |
| `app/core/rules.mjs` | Computes native rule and roll pools; legacy manual-section fallback is part of the same calculation. |
| `app/core/player-controls.mjs` | Reads native player controls with compatibility fallback. |
| `app/core/map-markers.mjs` | Reads native persisted map markers with compatibility fallback. |
| `app/core/chunk-colours.mjs` | Reads native saved colours with compatibility fallback. |
| `app/core/task-alternatives.mjs` | Resolves native alternative choices and older saved choices. |
| `app/core/xp-choices.mjs` | Resolves native XP choices and older saved choices. |
| `app/core/roll-stats.mjs` | Computes native roll history and estimates with older-save support. |
| `app/core/progress.mjs`, `app/core/progress-index.mjs` | Index native completion and shared progress while accepting older persisted facts. |
| `app/tasks/fact-projection.mjs`, `app/tasks/identity.mjs` | Supply native canonical identities and completion projection through the selected provider. |
| `app/tasks/access.mjs` | Computes current access while accepting migrated map controls. |
| `app/tasks/activity.mjs` | Computes native task eligibility and normalizes provider labels. |
| `app/tasks/engine.mjs` | Compiles native provider tasks and preserves older saved choices. |
| `app/tasks/equipment.mjs` | Evaluates native equipment requirements and normalizes provider labels. |
| `app/tasks/collection.mjs` | Generates native collection goals and normalizes provider labels. |
| `app/tasks/presentation.mjs` | Formats native task results and normalizes provider labels. |
| `app/tasks/worker.mjs` | Runs native calculations with compatibility aliases and older saved controls. |
| `app/tasks/training-availability.mjs` | Builds native training availability and normalizes selector names. |
| `app/data/item-membership-index.mjs` | Normalizes native item membership names with the shared decoder. |
| `app/helper-progress.mjs` | Formats native quest progress with compatible label normalization. |
| `app/web/map-activity-layer-model.mjs` | Builds native map-layer results and normalizes displayed labels. |
| `app/web/rules-model.mjs`, `app/web/kept-rules.mjs`, `app/web/rules-panel.mjs` | Build native rule controls and read saved rule preferences. |
| `app/web/screen-settings.mjs`, `app/web/screen-commands.mjs` | Handle native preferences and revision-safe commands with older-state support. |
| `app/web/screen-dialogs.mjs` | Provides normal backup/restore and other dialogs; original import/report controls are capability-hidden. |
| `app/backup-transfer.mjs`, `app/web/backup-transfer.mjs` | Transport and validate native JSON/gzip backups; original-document import is capability-blocked. |
| `app/dataset-bootstrap.mjs`, `app/web/dataset-panels.mjs`, `app/web/original-sync-loader.mjs` | Provide the shared capability boundary without importing the excluded modules in a public game. |

The independent provider's `app/data/original-data*.json` key is an in-memory
compatibility alias for independently selected inputs. No original selection JSON
is exported. Private metadata, rule wording, retained exports, history and
catalogues remain excluded by the existing policy.

## Verification and artifact

The [test inventory](../../scripts/public-export/test-inventory.json) records
every private test file, inclusion status, source declarations and exclusion
reasons. For mixed files, the allowlist pins each omitted scenario's exact title
and source-block digest. Public test fixtures replace personal actor/map aliases;
application and dataset modules are copied unchanged. The export checks that its
transform implementation matches the pinned source commit and records both the
source and transformed output hashes. An uncommitted transform change blocks
export.

Ported subjects include state and commands, rules and rolling, task calculations,
storage recovery and locking, journal and backup/restore, sparse Undo, invitations
and revocation, member/viewer permissions, CSP and overlay boundaries, map
rendering/cache models, and browser controllers. Grid-dependent synthetic tests
now derive fixture geometry from the selected grid, retaining the private
coordinates and assertions. More coverage exposed and fixed a missing empty
legend fallback in map-pin search; the private legend path retains its result.

The first private parity attempt stopped at its unchanged-save-byte check. The
existing harness froze time on October 13; startup legitimately refreshed that
historical progress observation using the newer copied save's counts. Revision
and gameplay-migration markers did not change. Both profiles now pin their clock
to the latest recorded observation in one fresh captured copy. No save is
pre-normalized and no progress snapshot is excluded from the comparison. The
successful rerun found zero differences, unchanged save bytes and restored Undo
in both profiles. Both attempt logs are retained in the release receipt.

The [whole-file and scenario exclusion list](public-test-exclusions-2026-10-14.md)
gives a reason for every test omitted from this candidate. Exclusion does not
mean every scenario is inherently private: some mixed harnesses still encode
the private provider's skill, geometry or feature contract. The inventory
distinguishes those from retained-input dependencies and tests of deliberately
excluded operator tools. It does not count unported tests as public coverage.

The final policy includes **220 of 410 test files**, with **240 exact scenarios**
omitted from mixed files. All **190 excluded files** have recorded reasons. The
remaining large-save command benchmark is synthetic, but its assertion that no
whole state is copied fails in the independent provider: `preserveGameIdentity` installs
a preparation hook, and the store conservatively clones and validates states
when a hook is present. The measured count is one instead of zero. The benchmark
and its original private assertions remain unchanged and private; this job does
not alter storage validation to satisfy it. The public suite covers ordinary
native saves, durable sidecars, restore, recovery, revision conflicts and Undo.

Projection checks used a synthetic sentinel corpus to review structural scanner
rules and exact exceptions. The fresh-save export gate additionally caught one
uppercase map alias in a cache-test fixture. It refused export before creating
the destination or history. Replacing that arbitrary key with `synthetic-map`
preserves the cache-invalidation assertion; the focused test passes in both
providers. The final export passes the real private fingerprint corpus and its
literal, case, encoded and Unicode negative probes. No fingerprint waiver or
scanner-rule change was made.

Concurrent raw private probes hit existing native-worker startup deadlines in
four scenarios. Their logs are retained. All four passed the subsequent serial
recheck under the heavy lock using the normal private environment, without
changing assertions or timeouts. The final locked full run is reported below.

The light-locked browser verification used the public `npm start` launcher and
one disposable game, then stopped it before starting the private scratch server.
It completed create/start/roll/check/Undo/reload at 1440 and 390 px. Both views
had no page overflow, renderer errors, outside requests or sync controls,
including hidden controls in Settings and Advanced. No original-service client
was requested. The private gallery passed **95/95 previews** both plain and with
`FRAMED=1`. The scratch saves, servers and Chrome processes were closed.

Screens: [desktop 1440](../../.local/screens/m5polish/public-1440.png) and
[phone 390](../../.local/screens/m5polish/public-390.png). The structured browser
report and gallery logs remain beside them. Further test-only ports after this
session leave every exported application byte identical; the release receipt
checks that equality against the browser-tested runtime.

## Final candidate

The deliverable is `C:/Users/User/Projects/chunk-picker-rs3-public-m5polish`.
The earlier first-pass `chunk-picker-rs3-public` directory was left untouched.

| Identifier | Value |
| --- | --- |
| Pinned private source | `243cfbeae673f9317d9d1984f8cfda59289026f5` |
| Public files | 631 |
| Public commit | `f79fa8d34fd682cdd88b72aeb42b1db5afd71d64` |
| Public Git tree | `414b015a77d0087cf641f927a4f25958538ba5cb` |
| Export tree SHA-256 | `e4dc77b2a00c84fc1f28a14c5437e24069ec3a8d06425a3ab7a1f3fe5b452329` |
| Rule policy | `2026-10-14.7` |
| Exact scanner exceptions | 442; no fingerprint waivers |

Compared with the first milestone 5 candidate:

| Public check | First pass | Follow-up |
| --- | ---: | ---: |
| Test files | 8 | **220** |
| Quick passes | 38 | **1,095** |
| Full passes | 39 | **2,333** |
| Optional skips | 1 | 1 |

| Final verification | Result |
| --- | --- |
| Private quick, 143 files | 1,381 passed; 1 optional skip; no failures |
| Public quick, 117 files | 1,095 passed; 1 optional skip; no failures |
| Public full, 220 files | 2,333 passed; 1 optional skip; no failures; 84.37 seconds |
| Private full, 410 files | **4,118 passed; 2 optional skips; no failures**; 18 minutes 42 seconds |
| Export tooling | 33 passed; no failures |
| Re-export | Identical file bytes, tree hash, Git tree and public commit |
| Final scanner and planted leaks | Zero findings; all actual private negative probes rejected |
| Private dataset parity | Zero differences; unchanged read-only bytes; Undo restored |
| Public browser | Create/start/roll/check/Undo/reload at 1440 and 390 px; no sync entry |
| Private gallery | 95/95 plain and 95/95 with `FRAMED=1` |
| Final artifact audit | Exactly 631 expected files; clean index; one commit; zero remotes |

The private full suite ran **once**, after the public full suite, under the heavy
lock. A [source audit](../../.local/public-export/private-full-source-audit.json)
hashes tracked sources and the draft reports before and after the run: both
snapshots are identical. The full log is kept at
[private-full.log](../../.local/public-export/private-full.log).

The [private release receipt](../../.local/public-export/release-receipt.json)
links all logs, negative probes, parity evidence, source audit and screens by
digest. It verifies all 391 exported application files and the launcher package
against the bytes used in the browser session. The
[binary inventory](../../.local/public-export/binary-inventory.json) records all
13 fresh Git metadata files, including packed reachable objects. The working
tree has zero binaries and 43 authored text SVGs; no captures, screenshots,
rasters, fonts or private catalogue payloads are included.

The shared optional skip is the absent pinned Wiki cache; synthetic offline
generation still runs. The second private skip is the absent optional generated
PNG bundle. Remaining private tests, the large-save validation cost above and
the independent dataset's limited content coverage are deliberate limits of this
candidate. This job does not include the separate F2P batch or generator work.

Test-created binding sidecars were validated as synthetic open-f2p metadata and
removed before the final file audit. Disposable save copies, temporary pack and
browser data, projection trees and the duplicate export were removed. No owned
server, Chrome process or scratch-port listener remains. Resources, the live
picker, main checkout and duo-legacy storage were not changed. No remote, push,
publication or deployment was performed.

Planner was not updated: this local job has no connected Planner access.

Proposed changelog: **The public copy is ready to publish**

- Keep original-picker sync in the private app.
- Carry native task, save, map and security tests into the public copy.
- Verify the exported app on desktop and phone.

Roadmap: Milestone 5 follow-up complete locally; publication remains separate.
