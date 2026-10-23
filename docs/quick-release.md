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
   - Builds the game data from that export: the data and rules-text packs come
     from the commit, so a data fix ships like any code fix. Only the art pack
     is copied from live, plus the six local map and game caches the public
     repository lacks, each checked against its live hash.
   - Builds the profile and addon from the commit. The member defaults come
     from the live profile on the PC, because public source has placeholders.
   - Runs startup probes on disposable copies of the live save: the live
     code, then the new code on that result, then the live code again on the
     new result. Every saved record, task identity and history event must
     survive both directions. The live save is only read.
   - When the data differs from live, the save's dataset binding has to change
     with the release. The probes then give the new side the new binding and
     add a fourth step, the new code reopening the swapped-back save, and the
     build writes `pack-transition.json` with both bindings.
   - Writes `quick-build.json` with the commit, the GitHub checks, whether the
     data changed, the probe counts and the time each step took.
   - While it runs, `release-build-active.json` in the live local folder names
     the build's PID and process start. The watchdog then leaves a picker that
     fails health checks but still holds both listeners running, instead of
     restarting it. The mark is removed when the build ends; a dead or reused
     PID, or a mark over an hour old, does not hold anything.
3. Go live, after the owner's OK for that release:
   `Quick-Release.ps1 -GoLive -ReleaseDir <folder> -ExpectLive <live id>`.
   It rechecks the folder against its commit and pins. When the data differs,
   it runs the probes again on the latest save before anything stops. Then it
   holds the watchdog and operator locks, stops the live picker, switches the
   save's binding if the data differs, swaps the pointer and starts the new
   release. If the start fails it puts the pointer and binding back and
   restarts the previous release. A swap back later is the same call with the
   previous folder; it uses the newer release's `pack-transition.json` and
   first checks that the previous release opens the latest save.

Paths live in `.local/quick-release.json`, which is never committed: `Repo`,
`Current`, `Releases`, `Operator` and `WatchdogLog`. The swap uses the
installed operator scripts (`Operator-Common.ps1`, `ReleaseV2-Common.ps1`) and
does not change them or the watchdog task.

Focused checks: `node --test tests/quick-release.test.mjs` and, for the build
mark, `node --test tests/watchdog-core.test.mjs`.
