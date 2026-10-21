# Quick release

GitHub runs every test suite. The release PC only builds, probes and swaps,
in a few minutes, with no test suite of its own.

1. Push the commit. Every GitHub Actions job on that exact commit must be
   green, and these must all be among them: `test`, `windows`, `coverage` and
   `secrets` (`test.yml`), `gallery` (`gallery.yml`), and
   `rehearsal (ubuntu-latest)` and `rehearsal (windows-latest)`
   (`release-rehearsal.yml`). The build checks this through `gh api`.
2. Build: `scripts/release/pc/Quick-Release.ps1 -Release <id> -Commit <sha>`.
   - Exports the commit into a new release folder and proves every file
     equals its blob.
   - Copies the live packs. A pack change refuses, because pack upgrades need
     a transition plan.
   - Builds the profile and addon from the commit. The member defaults come
     from the live profile on the PC, because public source has placeholders.
   - Runs three startup probes on disposable copies of the live save: the live
     code, then the new code on that result, then the live code again on the
     new result. Every saved record, task identity and history event must
     survive both directions. The live save is only read.
   - Writes `quick-build.json` with the commit, the GitHub checks, the probe
     counts and the time each step took.
3. Go live, after the owner's OK for that release:
   `Quick-Release.ps1 -GoLive -ReleaseDir <folder> -ExpectLive <live id>`.
   It rechecks the folder against its commit and pins, holds the watchdog
   and operator locks, stops the live picker, swaps the pointer and starts the
   new release. If the start fails it points back and restarts the previous
   release. A swap back later is the same call with the previous folder.

Paths live in `.local/quick-release.json`, which is never committed: `Repo`,
`Current`, `Releases`, `Operator` and `WatchdogLog`. The swap uses the
installed operator scripts (`Operator-Common.ps1`, `ReleaseV2-Common.ps1`) and
does not change them or the watchdog task.

Focused check: `node --test tests/quick-release.test.mjs`.
