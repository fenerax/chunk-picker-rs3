# Hosted release checks

`release-check.yml` runs the full single-repository test inventory on Ubuntu and
Windows, verifies selected release packs, builds their profile/addon, scans the
candidate's tree and reachable history for public secret patterns, and starts a
disposable scrubbed save to exercise task serving. It uses Node 24.20.0 and no
dependencies. It never contacts the live installation.

Tags matching `release-*` trigger the workflow. Manual dispatch takes a full
40-character lowercase candidate commit. Dispatch the workflow from an approved
workflow-source commit; that source commit can differ from the candidate. Input
passes through environment variables and Actions checkout, not shell commands.
No workflow publishes a release or uploads release assets.

The gate-by-gate source audit and migration plan are in the local consolidation
handoff `RELEASE-CI-PLAN.md`. The legacy PC release runner remains unchanged.

## Assets

The pack-assets job owns `.github/packs/pack-pin.json` and its existing fetcher.
The workflow downloads the pinned archives from this repository's release tag,
checks size/SHA-256, and lets the fetcher verify every selected manifest/file.
It then builds profile/addon files outside the source and pack trees. Tests use
the existing sanitized lane environment, per-file dataset policy, memory
admission and a concurrency cap of two. The Windows process uses the same
default-owner adjustment as the existing Windows slice. The browser harness
reference is copied from committed Git blobs into a separate directory before
tests execute; it is neither the executing file nor a hardlink.

The save-copy integration pin is optional at `.github/packs/save-pin.json`:

```json
{
  "schema": "rs3-ci-save-pin-v1",
  "tag": null,
  "asset": null
}
```

For a published copy, `tag` is the approved release tag and `asset` has `name`,
`bytes` and `sha256`. The asset is a JSON application backup produced and
validated by the save-copy job, with `format: "rs3-chunk-picker"`,
`schemaVersion: 1` and a scrubbed `state`. The workflow reruns the save-copy
job's `scrub-save.mjs --check` with matching public packs. Only the state is
written to a fresh runner-owned directory. The asset is bounded to 128 MiB. No credential files,
original local paths, private scrubbing maps or raw save reports are copied.

The startup probe opens/migrates that disposable copy, disables external profile
and sync fetches, uses scratch ports 8900-8999, serves tasks, checks for lost
migration records, then closes its children. Its report stays on the runner.
This proves startup/task serving for the pinned scrubbed bytes. It does not
prove progress preservation across old/new packs, rollback compatibility, or
equality to the current live save.

An absent save pin or either empty pin prints a skip reason and produces
diagnostic evidence. Such a run may be green but cannot pass the PC verifier.
Malformed pins, changed bytes, failed builds, failed tests and failed startup
are failures. No skip is converted into a pass. The save pin takes the
`scrubbed-save.json` size/hash emitted by the pack-assets job's optional
`--save-copy` output. It stays separate from the pack pin, whose fetcher expects
every asset to be a tar archive. Integrate the save-copy job's scripts before
the first asset-backed run; this job
does not create, scrub, commit or upload a real save.

## Evidence

The final `release-ci-evidence-<attempt>` artifact contains only
`release-ci-evidence.json`. Separate lane artifacts contain the same safe
per-gate results. There are no test logs, local absolute paths or save records
in these artifacts. Upload-artifact v4 provides immutable artifacts and a
SHA-256 archive digest in GitHub's artifact metadata. See GitHub's
[artifact API](https://docs.github.com/en/rest/actions/artifacts).

The summary schema is `rs3-release-ci-evidence-v1`:

| Field | Binding |
| --- | --- |
| `repository` | Fixed public repository |
| `candidate.commit`, `candidate.tree` | Exact checked-out commit and Git tree |
| `candidate.testInventorySha256` | SHA-256 of `JSON.stringify(sortedRepositoryRelativeTestNames)` |
| `workflow` | Exact workflow path, source commit, run ID, attempt, event and ref |
| `inputs.packPinSha256` | SHA-256 of committed pack pin bytes, including whitespace |
| `inputs.packs`, `inputs.selection` | Archive names/sizes/SHA-256 and selected manifest pins |
| `inputs.savePinSha256` | SHA-256 of committed save pin bytes; null if absent |
| `inputs.saveArchiveSha256` | SHA-256 of downloaded scrubbed backup bytes |
| `inputs.saveStateSha256` | SHA-256 of `JSON.stringify(backup.state) + '\n'` before startup |
| `lanes` | OS, Node version, per-gate result and actual per-file test counts |
| `blockedGates` | Exact legacy/PC gates this artifact cannot authorize |

`source-tests` records the complete discovered inventory on both OSes. A file
must pass on at least one OS; partial OS-specific skips remain visible. Both
lanes require `pack-integrity` and `scrubbed-save-startup`; Linux also requires
`secret-scan`. Every required gate must pass. Missing files, all-skipped files
on both OSes, zero aggregate tests, malformed counts, unknown/duplicate gates,
wrong pins and incomplete assets are refused. Test retries are disabled for
these lanes so a failure cannot disappear into a rerun.

The summary is a workflow sign-off authenticated by GitHub run/artifact
metadata. It is not a private-key signature or an OIDC attestation. No new secret
is needed. A JSON checksum supplied by that same editable JSON is not proof.

## PC verifier

Create an independently approved expectation JSON containing exactly
`candidate`, `workflow` and `inputs` from the schema above. Derive candidate/tree
and test inventory from the approved checkout, pin digests from its committed
bytes, and scrubbed state digest from the already approved public asset.
Select the expected workflow source, event/ref, run ID and attempt explicitly.
Never build expectations by copying the artifact being verified.

Read a downloaded summary using an independently authenticated JSON digest:

```powershell
node scripts/release/verify-ci-evidence.mjs --expect expected.json --file release-ci-evidence.json --sha256 <trusted-json-sha256>
```

Or let the verifier download the immutable artifact for the approved run:

```powershell
node scripts/release/verify-ci-evidence.mjs --expect expected.json --run-id <approved-run-id> --attempt <approved-attempt>
```

Online verification uses GitHub's REST API with `GH_TOKEN` or `GITHUB_TOKEN`
when available. Public unauthenticated reads may work subject to GitHub limits.
Only read access is needed; no new secret is introduced. It checks the exact
run attempt, successful completion, repository, workflow path/source and event,
artifact association/expiry and immutable ZIP digest. It sends authentication
only to the GitHub API, never to redirected artifact storage. ZIP extraction is
bounded, in memory and limited to one root summary file. It writes no files.
Offline verification is only as authentic as the independently supplied digest.

Success is deliberately scoped:

```json
{"verified":true,"scope":"portable-checks","releaseReady":false}
```

Every refusal exits nonzero with a value-free message. There is no mismatch
override. An expired, missing, skipped or mismatched result means run the
affected checks locally or refuse the release. The CLI does not run a local
fallback by itself.

## Claude's consumer wiring

This artifact cannot be dropped into the old private/neutral lane importer.
Those schemas bind different repositories, frozen kit paths, wrapper bytes,
profiles, addons and private corpus identities. Add an explicit importer for
this schema, with independently derived expectations and a required-gate policy.
Do not rewrite old receipts to make them look hosted.

The artifact always lists these unapproved gates:

- `kit-practice`: tooling certificate and exact accepted-baseline compatibility.
- `kit-gallery`: exact prepared receipt with the separately supplied browser checker.
- `kit-copied-startup`: receipt-bound synthetic startup.
- `kit-install`: exact prepared addon/profile/core/pack receipt validation.
- `kit-pack-transition`: old/new/rollback/forward preservation on a save copy.
- `kit-text-lane`: accepted-baseline proof and exact text endpoint checks.
- `pc-freeze`: seal real local paths, executables, current pointer and rollback target.
- `pc-activation`: latest-save check, actual stop/swap/start, readiness and rollback.

Claude should move the portable portions of the first six to a sanitized
prepared envelope with explicit baseline/request/profile/addon/policy digests.
The accepted baseline needs a private local bridge to its sanitized public
counterpart. Preserve local corpus scanning before publication; a pattern-only
hosted scan cannot replace that private check. Never upload a corpus, actual
current pointer, live identity defaults or real release config.

On the PC, verify evidence and payload bytes, rebind local paths and live member
identities, perform final current-pointer/ACL/owner/save admission, reseal, and
retain the existing per-release go-live approval. Only then swap and check both
listeners and the watchdog. The new PC runner refuses until this consumer
integration exists. Do not treat `portable-checks` as READY FOR GO-LIVE.

After consumer/envelope integration, budget 2-5 minutes of PC work plus network
transfer and save-size-dependent checks. This estimate needs measurement. The
current unmodified release runner still performs its roughly 64-minute private
lane. Publishing the workflow/assets and launching the first hosted release run
remain separate approved actions.

## Running a release from GitHub evidence

Copy `docs/release-pc.example.json` to `.local/release-pc.json` and replace
its placeholder paths. The real config is ignored by Git and must stay local.
Every config path also has a matching PowerShell parameter. `ExpectedEvidence`
points to the independently approved expectation JSON described above;
`Request` points to the approved release request. Use a clean checkout at the
exact candidate. Each kit and its work directory must be new.

```powershell
Copy-Item docs/release-pc.example.json .local/release-pc.json
$candidate = '<approved-40-character-commit>'
$run = '<approved-run-id>'
& scripts/release/pc/release-run-ci.ps1 -Release rel-example -Kit r-example -ExpectLive rel-example-old -CandidateCommit $candidate -RunId $run -PreflightOnly
& scripts/release/pc/release-run-ci.ps1 -Release rel-example -Kit r-example -ExpectLive rel-example-old -CandidateCommit $candidate -RunId $run
# After preparation and approval for this release:
& scripts/release/pc/release-run-ci.ps1 -Release rel-example -Kit r-example -ExpectLive rel-example-old -CandidateCommit $candidate -RunId $run -GoLive
```

Omit `-RunId` (or use `-RunId latest`) to resolve the newest successful
`release-check.yml` run with this commit as its GitHub head SHA. Its run ID and
current attempt must still match the independent expectation record; a newer
run requires fresh approval of that record. For manual dispatch from a different
workflow-source SHA, supply the run ID explicitly. Missing/expired evidence,
changed pins or bytes, a rerun, a dirty candidate or the wrong live ID refuses.
There is no override or local-test fallback.

Preflight uses only Git reads, `gh api --method GET` and the existing verifier.
It authenticates the immutable ZIP in memory without downloading files, writing
receipts, recording failures in the clock or importing candidate code. Success
means portable checks passed; it also reports a missing consumer integration.
Normal failures record the same failure clock command as the legacy runner and
stop without retries. Refused kits remain evidence and cannot be reused.

The PC keeps candidate staging/local path and identity binding, final live
pointer/ACL/owner/save admission, forward and rollback dry runs, the freeze seal,
and the existing go-live/listener/watchdog checks. Tests, pack verification and
portable kit gates belong on GitHub. The orchestrator never calls legacy
practice, prepare, gates-only or a heavy-lock wrapper.

**Current integration limit:** this branch's artifact approves portable checks
only, its pack pin is empty and it has no save pin. It cannot prepare or activate
a release. The candidate must first provide the versioned
`scripts/private-companion/release-ci-consumer.mjs` contract enforced by
`scripts/release/pc/ci-consumer.mjs`. That consumer must authenticate separate
hosted evidence for all six kit gates listed above, validate the private baseline
bridge, stage the exact candidate and bind local inputs. Its admission must
validate paths, ACLs, owners, the save and rollback; adapted kit tools must still
validate those receipts during freeze/activation. A filename or portable pass
alone grants no authority. Until that work lands, the runner refuses before
staging and cannot print READY FOR GO-LIVE.

## Validation

Run only the focused verifier and workflow-driver harness tests locally:

```powershell
node --test --test-timeout=120000 tests/release-ci-evidence-harness.test.mjs tests/release-ci-evidence-workflow-harness.test.mjs
node --test --test-timeout=120000 tests/release-run-ci.test.mjs
node --test --test-timeout=120000 tests/release-run-ci-powershell.test.mjs
```

The workflow harness uses synthetic modules and a disposable fixture Git repository;
it never runs the repository suite or starts a server. Full real checks belong
on GitHub after publication. `test.yml` is unchanged; its existing Windows
slice remains a separate signal. The new harness filenames fit the existing
full-only test selection pattern, so no inventory source edit is needed here.
