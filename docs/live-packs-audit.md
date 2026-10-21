# Can live use the packs tested on GitHub?

Audit date: 2026-10-21. Source baseline: `7f1e39d`; job `gh-livepacks`.

The public packs preserve the gameplay catalogue, rules, geometry and images. They deliberately remove automatic RuneMetrics account bindings and replace identities in gallery samples. Existing, explicitly saved account names survive; missing names need to be entered. This audit does not inspect the real save, so it cannot establish which case applies to either current player.

The current quick path cannot adopt these packs: it copies the current packs and rejects changed dataset descriptors. A quick pack upgrade is feasible, but requires a retained transition plan and a transaction covering both the dataset binding and release pointer. Adding `-PackUpgrade` to the existing swap is insufficient.

## Evidence and boundaries

The private inputs were exclusively the authorized **byte copy** of `rel10-bb29261/packs`, never an active release or save. The public inputs were the three assets fetched from `fenerax/chunk-picker-rs3`, tag `packs-public-2026-10-21`, using the names, compressed sizes and SHA-256 values at [.github/packs/pack-pin.json](../.github/packs/pack-pin.json). All three archive hashes/sizes, selected manifest hashes and every listed payload's hash/size were checked. Comparisons used raw bytes, then recursive JSON field differences, decompressing gzip JSON before comparison. No private field values are included here.

Only text under the installed `release-v2/operator/` was inspected; nothing there was executed or imported. Installed script identities at inspection:

| Script | SHA-256 |
|---|---|
| `Operator-Common.ps1` | `e8f979f52fc932e89df60943beff5b93a42b9ce817d25fef5cbe21b5fc377ff9` |
| `ReleaseV2-Common.ps1` | `f6348b9daf9d0168f3eff73908a265127fd4295a83cf57f234ce044e0f604bb8` |
| `Managed-ReleaseV2.ps1` | `e9ceeae7c54854f7666db67e39ce67f1099d6800857a387386f61c96dcc5a966` |

Installed source references below mean these inspected files, not the similarly named repository copies. No live operation, real-save test, push, workflow change or code change was performed.

## Exact pack differences

Counts exclude each pack's `pack.json` unless stated. All file names and their ordering are unchanged; there are no added or removed payload files.

| Pack | Private → public version | Payloads | Byte-identical | Changed | Total payload bytes, private → public |
|---|---|---:|---:|---:|---:|
| Data | `1.0.6` → `1.0.6-public.3` | 99 | 74 | 25 | 163,629,526 → 187,240,494 |
| Art | `1.0.0` → `1.0.0-public.1` | 15,297 | 15,295 | 2 | 240,614,960 → 240,614,010 |
| Rules text | `1.0.6` → `1.0.6` | 5 | 5 | 0 | 679,695 → 679,695 |

Data `pack.json` changes only `version`, `datasetDigest` and `files`: 25 `sha256` receipts and 18 `bytes` receipts change. Art `pack.json` changes only `version` and `files`: two hashes and two sizes. The rules-text manifest is byte-identical. Requirements, capabilities, distribution (`private-local`), rule contract, and all other manifest fields remain equal. Selection changes the data/art version and manifest hash; rules text stays equal. Including manifests, there are 26 changed data files and three changed art files.

The data changes comprise **588 complete provenance/path string replacements**, **32 nested hash-reference changes**, **one paired byte-count change**, **four account-default property removals across two mirrors**, and **29 gallery fixture identity substitutions**. There are no other parsed JSON differences. Re-encoding changed JSON with indentation also explains the roughly 23.6 MB increase; increased file size does not mean more gameplay records.

### Complete changed data-file inventory

In the table, `H` counts strings replaced with `redacted-local-source`; `R` counts repaired hash-reference leaves inside the payload, separately from `pack.json` receipts. Array/map wildcards identify repeated fields without exposing private values. Paths in the first 20 rows are relative to `app/data/`.

| File | Bytes, private → public | Exact differing fields / counts |
|---|---:|---|
| `cache-divination.2026-10-13.v1.json` | 2,325 → 2,977 | H2: `provenance.directory`, `provenance.walkability.file` |
| `cache-interiors.2026-10-08.v2.json` | 27,261,974 → 27,239,658 | H272, detailed below; R1: `assets.manifestSha256` |
| `cache-npcs.2026-10-08.v1.json` | 4,935,197 → 8,330,032 | H1: `reference.path` |
| `cache-resource-selectors.2026-10-08.v1.json` | 497,115 → 1,094,938 | R1: `provenance.catalogueSha256` |
| `cache-resources.2026-10-08.v1.json` | 4,846,362 → 11,258,583 | H1: `provenance.reference.path`; R1: `provenance.surfaceCorrections.sha256` |
| `cache-shops.2026-10-08.v1.json` | 34,329 → 56,743 | H2: `provenance.reference.path`, `provenance.wikiSnapshot.path` |
| `cache-surface-corrections.2026-10-08.v1.json` | 37,468 → 37,301 | H4: `provenance.sourceDirectory`, `.cacheDirectory`, `.toolDirectory`; `regionLabelProvenance.sourceFile` |
| `legacy-dataset-values.2026-10-13.v1.json` | 5,487,237 → 5,487,171 | `values["app/core/game-progress.mjs#defaultRuneScapeNames"]`: two member-to-account defaults removed, leaving `{}` |
| `map-connections.2026-10-09.v1.json` | 9,995,570 → 17,472,082 | H137: `inputs[].path` (7); `connections[].from/to.coordinateEvidence.file` (42/43), `.mapBoundsEvidence.file` (18/27). R2: `inputs[].sha256` |
| `map-pin-details.2026-10-08.v2.json` | 3,260,472 → 4,787,818 | R1: `sources[].sha256` |
| `monster-membership-review.2026-10-12.v1.json` | 965,418 → 965,418 | R2: `provenance.inputs[].sha256` |
| `npc-metadata-corrections.2026-10-08.v1.json` | 12,298 → 11,829 | H7: `corrections[].cache.artifact` |
| `original-data.2026-10-13.v1.json` | 18,738 → 18,738 | R16: `protectedFiles[].sha256` |
| `skill-guides.2026-10-08.v1.json` | 5,917,604 → 9,923,836 | H3: `provenance.guide.path`, `.manifest.path`, `.combat.path` |
| `skillguide-combat-corrections.2026-10-08.v1.json` | 427,294 → 427,036 | H5: `provenance.wikiSources[].path` |
| `source-incidental-outputs.2026-10-08.v1.json` | 4,160 → 4,160 | R1: `provenance.sourceCatalogue.sha256` |
| `source-membership.2026-10-08.v1.json` | 5,946,362 → 5,946,362 | R2: `provenance.identityInputs[].sha256` |
| `source-method-requirements.2026-10-08.v1.json` | 2,935 → 2,935 | R1: `provenance.sourceCatalogue.sha256` |
| `source-row-membership.2026-10-08.v1.json` | 207,385 → 207,385 | R1: `provenance.sourceCatalogue.sha256` |
| `transport-routes.2026-10-09.v2.json` | 533,527 → 727,280 | H144: `stations[].componentWitness.evidence.file` (52), `.coordinateEvidence.file` (40), `.coordinateEvidence.mapBoundsEvidence.file` (23); `routes[].rollDestination.evidence.sourcePath` (29) |
| `app/web/gallery-fixture-data.json` | 120,054 → 120,109 | 29 sample identity leaves, detailed below |
| `indexes/values.json` | 5,487,237 → 5,487,171 | Same two account-default removals as the authored legacy-values mirror |
| `local-game/chunk-sections.cache-audit-2026-10-07-v4-v1/manifest.json` | 908 → 908 | R2: `sha256`, `provenance.repositoryHashes["app/data/cache-surface-corrections.2026-10-08.v1.json"]`; `bytes` changes to 294,278 |
| `local-game/chunk-sections.cache-audit-2026-10-07-v4-v1/sections.v1.json.gz` | 291,118 → 294,278 | R1: the same `provenance.repositoryHashes` entry; geometry/components/masks unchanged |
| `local-map/manifest.cache-2026-10-08-05932552f7af-v1.json` | 204,221 → 203,528 | H10: `outputs[].path` (9), `baselinePins.path` (1) |

The 272 interior path replacements are `inputs[].file` (1); under `areas[].entrances[]`, `from/to.coordinateEvidence.file` (41/41), `from/to.coordinateEvidence.mapBoundsEvidence.file` (9/41), and `from.componentWitness.evidence.file` (2); under `areas[].declaredConnections[]`, `from/to.coordinateEvidence.file` (42/43) and `from/to.coordinateEvidence.mapBoundsEvidence.file` (19/28); `review.placesCopyOrigin.path` (1); and `v2Review.priority.inputs[].path` (4).

The gallery's 29 changed leaves are `state.members[].id/name/runescapeName` (2 each); `state.history[].command.memberId/actor.label` (2 each); `state.taskClaims.*.memberId` (1); `results[].memberId`, `.currentBiS.memberId`, `.activityInfo.memberId` (2 each); `results[].partnerConnections.regions[].ownerId/ownerName` (2 each) and `.byChunk.*.ownerId/ownerName` (2 each); `rollStats.members[].id/name` (2 each). They replace player/member identities and account bindings with generic samples. They do not change actual saved members.

### Complete changed art-file inventory

| File | Bytes, private → public | Exact differing fields |
|---|---:|---|
| `map-assets/interiors.cache-2026-10-08-v2-reviewed/manifest.json` | 114,391,678 → 114,391,421 | H5: `inputs[].file` (1), `sources[].path` (4) |
| `map-assets/manifest.cache-2026-10-08-05932552f7af-v1.json` | 204,221 → 203,528 | H10: `outputs[].path` (9), `baselinePins.path` (1) |

There are no other art JSON differences. Every image and every other payload is byte-identical.

### How the public variants were made

[docs/pack-assets.md:124](pack-assets.md#L124) documents art-first scrubbing, then data scrubbing with both `--art-source` and `--art-public`. [scripts/packs/scrub-public-pack.mjs:111](../scripts/packs/scrub-public-pack.mjs#L111) empties only the two reviewed account-default mirrors and replaces entire JSON strings containing home paths. It processes gzip JSON too. It refuses home paths in keys, unlisted files, invalid receipts, links, protected locations and overwrites. Its hash-transition repair updates exact SHA-256 references and paired sizes until stable (:137, :166, :279); it recalculates the dataset digest and preserves the rule contract (:306).

The data/art pairing seeds changed art hashes into data receipt repair (:222). This is essential for `assets.manifestSha256`: [docs/pack-assets.md:133](pack-assets.md#L133) records that `public.2` retained the private interior-manifest pin and lost interior tiles; `public.3` fixes it. The published pair's pin matches the public art manifest.

The gallery replacement is an additional preparation step beyond the built-in scrub. The public payload is byte-identical to tracked `app/web/gallery-fixture-data.json`. [scripts/build-gallery-fixtures.mjs:24](../scripts/build-gallery-fixtures.mjs#L24) builds a synthetic roster, claims/history, derived results and roll statistics (:31, :36, :48). No committed assembly step found in `scripts/` or `docs/` proves precisely when that tracked fixture replaced the private pack's fixture. The bytes and replacement fields are verified; a complete historical build recipe for that extra substitution is not established.

## What the players would notice

The raw definition export and task map are byte-identical. The export still contains 2,556 chunks, 20,375 challenge rows in 34 categories, 431 quest entries, 3,550 equipment entries, 573 sections, and 574 walkable chunk entries (162 F2P). Recursive comparison found no changed gameplay field, coordinate, geometry component, mask, requirement or rule text outside the differences above.

| Differing data | Readers and practical effect |
|---|---|
| Removed account defaults | `app/core/game-progress.mjs:4` reads the binding. `app/core/state.mjs:678` fills `member.runescapeName` only when that property is absent. Explicit saved names survive. A missing binding stays absent on public packs. `app/web/runemetrics.mjs:26,93` then shows a blank account field and asks for a saved name before fetching; `profile-view.mjs:17` shows the unset-name label. |
| Facts tied to account names | `app/web/profile-model.mjs:11`, `helper-model.mjs:22`, `finish-line-model.mjs:11`, `helper-training.mjs:64`, `mining-settings.mjs:11`, and `woodcutting-settings.mjs:11` require matching account names for observed facts. Existing observations without a matching saved name may stop informing those views until the matching name is saved. The pack swap does not fetch new facts by itself. |
| Profile member defaults | `quick-build.mjs:178` retains the local profile's roster/map defaults. This does not restore account defaults: profile member keys allow only `id`, `name`, `mapId` (`app/dataset-profile.mjs:44`; `app/legacy-game-defaults.mjs:33`). |
| Redacted provenance | Evidence may display a generic source marker instead of a local source location; e.g. `app/data/cache-resources.mjs:143` retains provenance in evidence. Coordinates, rates and access logic remain equal. These paths are not runtime input locations for packed payloads. |
| Changed receipts | Integrity checks must follow the new bytes. `app/core/chunk-sections.mjs:94` checks geometry bundle/input hashes; `app/server.mjs:501` checks the interior art-manifest pin. Correctly repaired receipts retain geometry and interior images. A startup pass alone would not prove interior tiles work, because the server can mark them unavailable instead of refusing startup. |
| Gallery sample identities | `app/web/gallery-fixtures.mjs:2,8` loads independent samples; `gallery-preview.mjs:23` renders them. `app/gallery-route.mjs:20` restricts gallery routes to administrators. Samples show generic identities consistently in roster, history, ownership labels and roll statistics. With an addon installed, its fixture takes priority over the pack fixture (:34). Ordinary gameplay state is unaffected. |

For both players, task eligibility, rolling and map rendering should therefore remain equal **when their saved account bindings are explicit**. The account-default exception prevents an unconditional claim of identical behavior. No live-save inference is made here.

### Synthetic verification

Both pack sets ran the baseline source and the same freshly built addon. Each used its own freshly built, SHA-pinned profile, selection and dataset binding. The fixture had two invented members with explicit invented account names, one unlocked chunk each, journal sentinels, no completed tasks and initially no history. It was never based on a real save. Probes used the same `release-pack-check.mjs probe` entrypoint and process-worker environment as `quick-build.mjs:122`, with a lower 768 MiB V8 heap limit instead of 2,048 MiB for this PC audit. All servers used the probe's temporary loopback port selection in 8900–8999 and closed after use.

| Successful linked startup | Seconds | Tasks | Authored IDs | Saved identity references | History events | Lost records |
|---|---:|---:|---:|---:|---:|---:|
| Private packs | 48.3 | 23,935 | 39,984 | 71,751 | 1 | 0 |
| Public packs, retry | 68.4 | 23,935 | 39,984 | 71,751 | 1 | 0 |
| Private packs on public result | 37.3 | 23,935 | 39,984 | 71,751 | 1 | 0 |
| Public packs on rollback result | 31.4 | 23,935 | 39,984 | 71,751 | 1 | 0 |

Every successful probe served `/api/tasks`. `assertStableIdentities()` and `assertPreserved()` passed across the linked outputs; registry digests stayed equal, and both explicit account names survived. Saved-reference counts include the generated catalogue/registry; they are not counts of player accomplishments. The single history event is the allowed catalogue refresh. This proves synthetic startup/task-service compatibility, not parity of every interactive feature or of a populated live save.

An initial fixture was rejected because it used raw state instead of storage's backup envelope; that setup error was corrected. One subsequent public probe attempt failed before producing a report; its diagnostic was not retained, so the cause is unresolved. The public retry and following rollback/reopening passed. Do not treat the table as an uninterrupted first-attempt success rate.

A fifth successful probe started public packs on a fresh copy of the first private output in 46.6 seconds. Stable identities, progress/history and registry checks passed against that private report, serving the same 23,935 tasks. This verifies that successful public startup did not depend on state left by the failed attempt; it does not explain that failure.

Separate in-memory normalization checks used both private default-binding keys without serializing or printing those keys/values. The private pack filled two missing account names; the public pack filled zero. Both preserved two explicit invented names. This confirms the conditional account-binding difference directly.

The focused command `node --max-old-space-size=768 --test --test-timeout=120000 tests/pack-public-scrub.test.mjs` passed **15 tests, zero failures, zero skipped**, with the `RS3_PUBLIC_SCRUB_*` settings pointing to the downloaded public packs and the authorized copied geometry source. Its actual-pack cases verified runtime resolution, geometry receipts and equality of source/public geometry components, plus all art metadata and image samples from every component without fallback. Runtime was 6.6 seconds; reported validation peak RSS was 207,576 KiB. No full suite ran locally.

## Proposed quick pack-upgrade path

This is a proposal only. Keep same-pack releases supported and detect a pack transition whenever the selection hash **or any** data/text/art manifest hash changes. Art-only changes count too (installed `ReleaseV2-Common.ps1:160`).

### Build and retain the exact inputs

1. In `quick-build.mjs`, read the pin from the **exported target commit**, after the existing exact-commit GitHub checks and blob verification. Download the named assets from the fixed public repository; verify compressed length/SHA-256 before extraction. Validate archive entries before writing: reject traversal, links/hardlinks, duplicate or case-colliding destinations and anything outside staging. Verify manifest SHA-256 against `pin.selection`, identity/version/kind, safe payload paths and every payload's length/hash. Generate an independent `selection.json` matching that pin. Recheck cached inputs against the current pin, including selection equality.
2. Separate download/extraction from checkout hydration. The existing [.github/packs/fetch-packs.mjs:44](../.github/packs/fetch-packs.mjs#L44) verifies payloads, but `placePacks()` adds missing files to the checkout and leaves tracked files authoritative. Its CLI also trusts an existing cached `tree/selection.json` to skip downloads (:82). Neither behavior alone proves that the immutable release core uses the newly pinned packs. Keep packs outside the exported core and load them through the packed configuration.
3. Replace copying/refusing changed live packs (`quick-build.mjs:164`) and the same-descriptor refusal (:206) with a transition branch. Build the candidate profile against candidate packs and retain local roster defaults. Retain the complete old config, old profile/addon and old packs for rollback. Never repoint old config paths at new pack bytes.
4. Write and pin a transition alongside the candidate receipt. Expand `quick-build.json` to include asset/pin identity, both config pins/descriptors, all probe evidence, transition/checker pins and phase timings. Expand `verify()` (:246) to recheck full pack payload integrity, addon payloads, the exact pin and transition, rather than only the top-level config input files. Recheck GitHub evidence for the exact commit before adoption.

The transition shape already accepted by `scripts/private-companion/release-pack-check.mjs:123` is:

```js
{
  schemaVersion: 2,
  old: { datasetId, datasetContractVersion, digest, bindingSha256 },
  new: { datasetId, datasetContractVersion, digest, bindingSha256 },
  oldConfig: { path, sha256 },
  newConfig: { path, sha256 },
  oldBindingBase64,
  newBindingBase64
  // savedIdentityAdditions: [{ key, target }] only for real, exact new identities
}
```

Config pins hash raw file bytes. Descriptors derive from each selected data manifest and must agree with that side's profile. Preserve the original binding bytes exactly, including formatting; generate the new side with `bindingBytes()` (:14). Both configs must name the same storage. Do not use `digestValue()` (sorted JSON hashing) as a substitute for raw-file SHA-256. This pack pair needs no authored identity additions. There is no signing requirement in the inspected transition/operator contract; SHA pins and compatibility evidence are required.

### Prove both directions with each side's own packs

Use whole configs at every step: **old code + old packs/profile/addon → new code + new packs/profile/addon → old code + old packs/profile/addon**. Each disposable snapshot gets its corresponding dataset-binding sidecar. The current quick loop writes the same live binding for all steps (`quick-build.mjs:207`), which cannot be retained for differing dataset digests.

Reuse `checkPackTransition()` rather than weaken its assertions. It adds a fourth **new** reopening, giving old→new→old→new (`release-pack-check.mjs:145`). Require task service, stable authored/saved identities, retained progress/tasks, complete history and migration prefixes, zero lost records and registry equality on rollback/reopening. Leave `savedIdentityAdditions` absent for this scrub-only transition. Hash the source save before/after snapshots and retry a moving source as the quick builder already does (:103).

Also check the stopped source save's account bindings through the storage decoder. An old startup can materialize fallback names in its disposable output; a chained probe can therefore pass even if the untouched source lacks those saved names. Require explicit matching bindings for both players before this adoption, or test a separate new-side copy made directly from the raw source. If a required binding is absent, save it through the existing player UI before upgrading. Keeping local roster defaults in the profile does not address this case.

The existing CI `test` job hydrates missing checkout files; tracked files win. Thus green CI is not automatically proof of an entirely packed startup. Add exact-pinned-pack startup/geometry/interior validation to GitHub in a later implementation. The optional actual-pack cases at `tests/pack-public-scrub.test.mjs:220,269` are useful, but need their explicit `RS3_PUBLIC_SCRUB_*` settings; `test.yml` does not set them. This audit adds no job.

### Commit the binding and pointer as one recoverable operation

Installed `Assert-ReleaseV2Transition` (`ReleaseV2-Common.ps1:33`) still requires stable executable, storage, listeners and origin, plus independent selection paths. `-PackUpgrade` only waives equality of selection/pack hashes. It does not validate the plan, rewrite the binding or provide rollback safety.

Implement a quick-specific transaction in `Quick-Release.ps1`, using the installed ownership/transition/journal/binding/pointer helpers and their state ordering. `Invoke-ReleaseV2Managed` is not a drop-in wrapper: it requires companion root/receipt/release-root inputs and invokes frozen kit installation/identity verifiers (`Managed-ReleaseV2.ps1:1`; `ReleaseV2-Common.ps1:168,222,235,242,315`). The quick receipt does not satisfy that contract. These verifier calls validate evidence; they do not themselves rerun nine hours of suites. Reusing that entrypoint would require a separate compatible admission design. Do not fabricate full-kit evidence or weaken its verifiers.

The quick transaction must:

1. Verify candidate, retained old release, current pointer, exact CI evidence, transition and checker identities. External checker use pins both the checker and its adjacent identity module (installed `ReleaseV2-Common.ps1:188`). Establish expected current release/config and recognized binding before mutation.
2. Hold operator ownership and the watchdog tick lock, pause, stop the writer and verify store release. Recheck compatibility against a fresh snapshot of the **current stopped save**, with the transition's actual two configs. A build-time probe can be stale by go-live (installed :245).
3. Durably journal both endpoints, original/new binding bytes and pinned successful evidence before changing storage. Compare-and-swap the binding first, then the release pointer, journaling intermediate state (installed :268, :283). Start with `-PackTransitionReady`, validate readiness and final pointer/binding, mark `ready`, then unpause (:314, :320).
4. Replace quick's unconditional pointer-back catch (`Quick-Release.ps1:84`). Before any storage mutation, previous-service restoration is allowed. After a binding/pointer mutation, retain pause and the journal on failure; recovery must recognize the exact partial pair and finish or explicitly reverse it. Unknown binding, uncertain process ownership or failed verification must remain stopped/paused (installed :341).

A later swap back uses the transition retained with the forward release, even when the old folder has no new quick receipt. Validate reversed config endpoints, probe the retained old code/packs against the **latest** save without requiring broken new code to start, and restore the original binding bytes plus old pointer through the inverse journaled transaction (installed :173; checker :145). Preserve progress made after upgrade. Never restore a pre-upgrade save merely to make old packs start. A failure partway through forward commit must also support this inverse recovery.

Before implementation acceptance, cover pin/cache tampering, all three pack kinds, actual per-side probe configuration, changed binding formatting, gallery/interior receipt handling, failed new start, interruption at each journal/binding/pointer boundary, inverse recovery, unknown bindings and uncertain process ownership. Use disposable fixtures adapted from `tests/release-pack-upgrade-v2.test.mjs:29`; run these suites on GitHub. Existing `tests/quick-release.test.mjs:12` covers check evaluation/export, not pack transactions.

## PC time and remaining uncertainty

Measured here on the PC, with other jobs running:

| Work | Observed time |
|---|---:|
| Fetch pinned assets, verify compressed hashes/sizes and extract | 57.0 s, about 110.3 MiB compressed |
| Independently verify both private/public payload sets | about 57.8 s, including 49.2 s for art |
| Build both profiles and one common addon | 0.7 s |
| Four successful linked startup probes above | 185.4 s total, including snapshot work except the isolated retry's snapshot |
| Focused scrub/actual-pack test file | 6.6 s; belongs on GitHub in releases |

These are audit measurements, not an end-to-end quick-upgrade benchmark. They exclude failed attempts, export/CI lookup, real-save size, moving-save retries, locking, actual stop/start and transactional recovery. Filesystem warmth and concurrent PC work affected the timings. The audit's full two-sided receipt comparison is more work than checking only newly downloaded payloads.

For the proposed conservative design, allow roughly **3 minutes for the build's four probes plus another 3 minutes for the required stopped-save recheck**, then pack preparation/verification and swap/start time. The measured components suggest roughly **7–9 minutes for a cold upgrade**, before unusual save size or retries; a warm cache reduces asset work but does not establish a five-minute total. This is a planning estimate, not a measured release. A later reverse swap needs one old-target startup compatibility probe plus verification and transaction/start time; the synthetic old reopen took 37.3 seconds.

The current 180-second timeout is per probe, not an overall five-minute bound (`quick-build.mjs:128`; `release-pack-check.mjs:65`). Meeting the PC target requires measuring and reducing repeated pack verification/startup work while retaining stopped-save compatibility and recovery guarantees. Do not promise five minutes by counting only the pointer swap or deleting required checks.

No installed operator transaction, real-save upgrade/rollback, phone/browser play session or new GitHub run was exercised. The initial unexplained probe failure also prevents an unconditional reliability claim. This job delivers evidence and a design only; live adoption should wait for implementation, GitHub coverage of the exact packed runtime, and a measured stopped-save upgrade with a retained rollback target.
