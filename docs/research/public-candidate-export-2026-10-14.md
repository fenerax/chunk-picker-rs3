# Public candidate export — 14 October 2026

The [milestone 5 follow-up](public-candidate-followup-2026-10-14.md) supersedes
this first-pass candidate for publication readiness and test counts.

Milestone 5 is complete locally. The candidate is
`C:/Users/User/Projects/chunk-picker-rs3-public`: **416 working-tree files**, one
initial commit, no remotes, no private history. Nothing was published or uploaded.

The [release receipt](../../.local/public-export/release-receipt.json) contains
the source mapping, scan result, verification logs/digests, media provenance and
re-export comparison. It contains no plaintext save member values.

## Reproduce

Use Node 24 and Git, from this private worktree:

```powershell
node scripts/public-export/candidate.mjs HEAD C:/path/to/new-public-candidate --save .local/export-input/state.json --receipt .local/public-export/new-candidate.json
```

Supply a fresh disposable save copy for identity checks. The copy used for this
job has been deleted. Never use or modify live storage. The destination must be
absent, outside this repository, with an existing ordinary parent. Receipt paths
must stay under this repository's `.local` or `docs/research`, outside the output.
See [the operator documentation](../public-export.md).

The exporter reads pinned Git blobs. Reviewed public README/package/licence/test
templates replace private documentation and configuration; gameplay modules are
copied unchanged. The F2P dataset subtree and generator/test filename families
grow automatically. Other new files need an explicit allowlist entry.

Inside the candidate, `npm start` selects `open-f2p` and `var/open-f2p`, with
Explorer 1, Explorer 2 and the generic Administrator role. Use the README's local
invitation instructions. To repeat the checked workflow, Search for `12850`,
View Lumbridge, Unlock, then Pick Chunk. Check an available activity, reload and
Undo. The launcher refuses the live port and incompatible storage.

## Exact artifact

| Field | Value |
| --- | --- |
| Hardened exporter source commit | `feaeea7` (full ID in receipt) |
| Public commit | `b6cfbf9d9eb922868fe88b59b572f8e2cef388f2` |
| Git tree | `cbffa6daf10e05fdecbfa677214171e09c6936a8` |
| Working-tree SHA-256 | `727ecc2db44a993a8fe1cbe2e83dae89e00ff88004255865e072129e94787163` |
| Public author and committer | `fenerax <fenerax@users.noreply.github.com>` |
| Commits / remotes / refs | 1 / 0 / `refs/heads/main` only |

Two exports from the same pinned source produced identical file bytes, Git trees
and commits. The hardened exporter subsequently reproduced that exact public
artifact. Duplicate exports were removed after comparison. The retained candidate
was rechecked byte-for-byte against its receipt after tests; its index is clean.
All Git objects are reachable from its sole public commit; no unrelated objects
or alternate history remain.

## Included and excluded

Included: reviewed authored app modules and selected-provider adapters, the
independent F2P authored/Wiki-derived data, independent starter support shared by
that provider, the F2P generator/fetch helper and offline build guard, seven cheap
public test files plus one server integration file, authored placeholder SVGs,
public README, MIT code licence and third-party notices. Wiki adaptations keep
their separate CC BY-NC-SA 3.0 NOTICE and per-record revisions.

Excluded: private player defaults, capture/CLI and private metadata inventories,
legacy inputs/export/history, retained and cache JSON, resources/Jagex artwork,
community terrain, fonts, reference/archive trees, research, captured fixtures,
private tests, changelog/roadmap content, screenshots, saves, credentials, export
tooling/corpus and the source Git object database. Gallery assets are excluded;
the independent provider returns 404 for gallery routes. Plain and FRAMED gallery
checks therefore do not apply.

Authored compatibility algorithms, logical catalogue keys, route names, legacy
prefix checks and inert compatibility wording remain in shared modules. These
are not retained catalogue payloads or captured source. The scanner has **172
reviewed exact-line exceptions**, each bound to path, category, SHA-256 and a
reason in [the review manifest](../../scripts/public-export/reviewed-exceptions.json).
This includes the independently authored starter's two synthetic IDs and public
source/API URL builders. A changed line requires review; filenames and private
HMAC findings cannot be waived.

## Privacy checks

The scanner passed with zero findings. It rejects identities, user paths, local
state paths, network bindings, credential formats, invitations, legacy task IDs,
cache catalogues, original-source signatures, unexpected binaries and all raster
images. Scratch negative tests plant every requested category. Actual private
member names and both RuneScape names were covered by the private HMAC corpus;
literal, case, Unicode and encoded probes all failed safely without reporting
their values. The corpus retains a private key, lengths, HMAC digests and keyed
prefilter values.

Focused regressions also prove that an old corpus without a fresh save-copy
check cannot build a candidate, and that receipts cannot be placed inside the
public tree or its Git metadata. Git templates, hooks, inherited Git environment
and global configuration are isolated when creating fresh history.

The scanner checks known patterns and fingerprints. Deliberate obfuscation and
rights clearance require separate review. Source allowlisting, independent
generator read guards, provenance review and runtime checks provide separate
checks. No uncertain third-party media or catalogue payload was admitted.

## Binary and image inventory

There are **zero binary working-tree files**. The **43 external SVG files** are
text: 42 hand-written placeholders plus the authored grid favicon. Their exact
paths, byte counts, SHA-256 and authorship records are in the release receipt's
`media.svgFiles`. Four small CSS data-URI SVGs are authored toolbar symbols, also
recorded there. No PNG/JPG/WebP, fonts, archives, screenshots or embedded raster
data is present.

For completeness, [binary-inventory.json](../../.local/public-export/binary-inventory.json)
lists **every one of the 437 binary Git metadata files** by path, size, SHA-256
and provenance: fresh reachable Git objects and the generated Git index. These
are created from the verified public tree, not copied from private history.

## Verification

| Check | Result |
| --- | --- |
| Private quick | 1,364 passed, 1 skipped, 0 failed |
| Public quick | 38 passed, 1 skipped, 0 failed |
| Public full | 39 passed, 1 skipped, 0 failed |
| Private full, 407 files | **4,097 passed, 2 skipped, 0 failed** |
| Final export-gate regressions | 10 passed, 0 failed |
| Disposable private dataset parity | Zero differences; read-only save bytes unchanged; Undo restored |
| Public browser | Create, choose start, roll, check task, reload, Undo at 1440 and 390 px |
| Public history audit | One fixed public author/commit; no remotes; clean index |
| Final file audit | Exact receipt bytes; no additional working-tree files |

The private full suite ran once, at the end, under the shared heavy lock. No source
files were edited during it. A prior logging preflight stopped before either full suite
started; its log is retained. Full logs, durations and digests are linked from the
release receipt. The two private skips are the absent optional pinned Wiki cache
and optional generated PNG bundle. Synthetic offline generation remains tested.

The locked browser session used the actual public launcher and a separate scratch
save, with external requests blocked. Screens:
[desktop 1440](../../.local/screens/public-export/public-f2p-1440.png) and
[phone 390](../../.local/screens/public-export/public-f2p-390.png).
Both have no horizontal page overflow and use the generic players/grid/pictures.
All workflow assertions passed. The harness initially classified two background
409 responses as errors; recorded routes were task refresh and prediction
preparation. Source review confirmed existing stale-revision guards and client
recovery/ignored abandoned preparation. The structured browser report records that
review, no renderer errors and no outside requests. App code was unchanged.

## Private side and remaining work

Private defaults now load through a small optional configuration seam. Private
capture remains lazy, and independent sync refuses before it can import capture
code. Auth, CSP, viewer and overlay policy were not changed. One private input
adapter, `app/data/map-corrections.mjs`, lost only unused provenance/helper
declarations containing an upstream URL. This required a disposable pack rebuild;
parity passed. Identity modules/registry, F2P data/generator, resources, live
storage and the main checkout were not edited.

The runtime app files were unchanged between the parity check and the final full
suite/export. All servers and browser processes started for this job stopped.
Save copies, browser scratch, temporary parity data and duplicate exports were
removed; the public candidate, private receipts/logs and screens remain.

The candidate intentionally has limited F2P coverage. A real pinned-cache rebuild
and the optional private PNG bundle check remain unperformed here. No unresolved
binary provenance item was included. Shadow deployment with private packs and the
source-of-truth cutover remain milestones 6–7; this job does not perform them.
Planner was not updated because the job explicitly remains local; no external
task update was attempted.

Proposed changelog: **A clean public copy can be built**

- Build a fresh public copy with one command.
- Start with the F2P dataset and placeholder pictures.
- Block private data and artwork before export.

Roadmap: Milestone 5 complete locally; publication and private shadow deployment remain separate.
